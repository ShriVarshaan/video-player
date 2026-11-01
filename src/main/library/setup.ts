import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialog, ipcMain, net, protocol, safeStorage, type BrowserWindow } from 'electron'
import { broadcast } from '../broadcast'
import type { Db } from '../db'
import { createImageCache } from '../images/cache'
import { parsePosterUrl } from '../images/posterUrl'
import { registerDomain } from '../ipc'
import { grabFrame, toWebp } from '../media/ffmpeg'
import { probe } from '../media/probe'
import { quickHash } from '../media/quickHash'
import { createCredentialStore } from '../metadata/credential'
import { createTmdbClient } from '../metadata/tmdbClient'
import { binaryPath } from '../paths'
import { getShow, getTitle, listFolders, listLibrary, listSearchDocs, listWall } from './queries'
import { createLimiter } from './queue'
import { createLibraryService, type LibraryService } from './service'

// Must run before app 'ready': poster:// serves cached artwork to the renderer.
export function registerPosterScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'poster', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

export function setupLibrary(opts: {
  db: Db
  userDataPath: string
  binaryBase: string
  // Project root in development (for TMDB fixtures); null when packaged.
  devRoot: string | null
  getWindow: () => BrowserWindow | null
}): LibraryService {
  const { db } = opts
  const ffmpeg = binaryPath('ffmpeg', opts.binaryBase)
  const ffprobe = binaryPath('ffprobe', opts.binaryBase)

  // VP_TMDB_MODE=fixtures (tests) reads tests/fixtures/tmdb instead of the network.
  const fixtures = opts.devRoot !== null && process.env['VP_TMDB_MODE'] === 'fixtures'
  const mode = fixtures ? 'fixtures' : 'live'
  const fixturesDir = join(opts.devRoot ?? '', 'tests', 'fixtures', 'tmdb')

  const credential = createCredentialStore(db, safeStorage)
  const client = createTmdbClient({ credential: () => credential.get(), mode, fixturesDir })
  const tmdbLimit = createLimiter(4) // every TMDB request, API and images alike
  const images = createImageCache({
    db,
    dir: join(opts.userDataPath, 'cache', 'images'),
    client,
    toWebp: (input, output, width) => toWebp(ffmpeg, input, output, width),
    grabFrame: (input, atS, output, width) => grabFrame(ffmpeg, input, atS, output, width),
    limit: createLimiter(2),
    downloadLimit: tmdbLimit,
    now: Date.now
  })

  const emit = broadcast

  const library = createLibraryService({
    db,
    scan: { probe: (file) => probe(ffprobe, file), quickHash, now: Date.now, limit: createLimiter(4) },
    tmdbLimit,
    client,
    checkKey: async (key) => {
      await createTmdbClient({ credential: () => key, mode, fixturesDir }).get('authentication')
    },
    images,
    credential,
    emit,
    exists: existsSync,
    now: Date.now
  })

  registerDomain(ipcMain, 'library', {
    addFolder: async () => {
      const win = opts.getWindow()
      const pick = { properties: ['openDirectory' as const], title: 'Add a movie or TV folder' }
      const result = win ? await dialog.showOpenDialog(win, pick) : await dialog.showOpenDialog(pick)
      const path = result.filePaths[0]
      return result.canceled || !path ? null : library.addFolderPath(path)
    },
    removeFolder: async ({ id }) => library.removeFolder(id),
    listFolders: async () => listFolders(db, existsSync),
    rescan: () => library.rescan(),
    list: async () => listLibrary(db),
    getShow: async ({ key }) => getShow(db, key),
    getTitle: async ({ key }) => getTitle(db, key),
    wall: async () => listWall(db),
    searchDocs: async () => listSearchDocs(db)
  })
  registerDomain(ipcMain, 'metadata', {
    setTmdbKey: ({ key }) => library.setTmdbKey(key),
    status: async () => library.metadataStatus()
  })

  protocol.handle('poster', async (request) => {
    const ref = parsePosterUrl(request.url)
    const file = ref ? await images.resolve(ref).catch(() => null) : null
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 })
  })

  return library
}
