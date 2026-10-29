import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiEvents } from '@shared/api'
import { parseAppError } from '@shared/appError'
import { openDb, type Db } from '../../src/main/db'
import type { ImageCache } from '../../src/main/images/cache'
import { createLibraryService } from '../../src/main/library/service'
import type { ProbeResult } from '../../src/main/media/probe'
import { createCredentialStore } from '../../src/main/metadata/credential'
import { createTmdbClient } from '../../src/main/metadata/tmdbClient'

const FIXTURES = join(__dirname, '..', 'fixtures', 'tmdb')
const PROBE: ProbeResult = { durationS: 100, container: 'mkv', videoCodec: 'h264', width: 640, height: 360, hdr: false, json: '{}' }
const plainSafe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString()
}

let root: string
let db: Db

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vp-svc-'))
  mkdirSync(join(root, 'Library', 'Breaking Bad', 'Season 1'), { recursive: true })
  writeFileSync(join(root, 'Library', 'The.Matrix.1999.mkv'), 'matrix')
  writeFileSync(join(root, 'Library', 'Breaking Bad', 'Season 1', 'Breaking.Bad.S01E01.mkv'), 'bb1')
  db = openDb(':memory:')
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

function setup(over: { probe?: (f: string) => Promise<ProbeResult> } = {}) {
  const events: { name: keyof ApiEvents; payload: unknown }[] = []
  const credential = createCredentialStore(db, plainSafe)
  const images: ImageCache = { resolve: vi.fn(async () => null), prefetch: vi.fn(async () => {}) }
  const probe = vi.fn(over.probe ?? (async () => PROBE))
  const service = createLibraryService({
    db,
    scan: {
      probe,
      quickHash: async (f) => createHash('sha1').update(readFileSync(f)).digest('hex'),
      now: () => 1,
      limit: (fn) => fn()
    },
    tmdbLimit: (fn) => fn(),
    client: createTmdbClient({ credential: () => credential.get(), mode: 'fixtures', fixturesDir: FIXTURES }),
    checkKey: (key) => createTmdbClient({ credential: () => key, mode: 'fixtures', fixturesDir: FIXTURES }).get('authentication').then(() => {}),
    images,
    credential,
    emit: (name, payload) => events.push({ name, payload }),
    exists: existsSync,
    now: () => 1,
    watch: () => () => {}
  })
  return { service, events, credential, images, probe }
}

const lib = () => join(root, 'Library')

describe('library service', () => {
  it('adds a folder, scans it, matches it and announces the change', async () => {
    const { service, events, credential } = setup()
    credential.set('k')
    const folder = await service.addFolderPath(lib())
    expect(folder).toMatchObject({ path: lib(), online: true })
    await service.rescan()
    expect(events.some((e) => e.name === 'library.changed')).toBe(true)
    expect(db.prepare(`SELECT count(*) AS n FROM videos WHERE match_status = 'matched'`).get()).toEqual({ n: 2 })
  })

  it('reports progress phases in order, ending idle', async () => {
    const { service, events, credential } = setup()
    credential.set('k')
    await service.addFolderPath(lib())
    await service.rescan()
    const phases = events
      .filter((e) => e.name === 'library.progress')
      .map((e) => (e.payload as ApiEvents['library.progress']).phase)
      .filter((p, i, all) => p !== all[i - 1])
    expect(phases.slice(-4)).toEqual(['scanning', 'matching', 'images', 'idle'])
  })

  it('refuses the same folder twice, and folders that do not exist', async () => {
    const { service } = setup()
    await service.addFolderPath(lib())
    expect(parseAppError(await service.addFolderPath(lib()).catch((e) => e))?.code).toBe('invalid_argument')
    expect(parseAppError(await service.addFolderPath(join(root, 'nope')).catch((e) => e))?.code).toBe('invalid_argument')
    await service.rescan()
  })

  it('finishes a rescan and announces it even when artwork fails', async () => {
    const { service, events, images } = setup()
    vi.mocked(images.resolve).mockRejectedValue(new Error('disk full'))
    db.prepare('INSERT INTO library_folders (path, added_at) VALUES (?, 0)').run(lib())
    await expect(service.rescan()).resolves.toBeUndefined()
    expect(events.at(-2)?.name).toBe('library.changed')
    expect(db.prepare('SELECT count(*) AS n FROM videos').get()).toEqual({ n: 2 })
  })

  it('removing a folder removes its videos', async () => {
    const { service } = setup()
    const f = await service.addFolderPath(lib())
    await service.rescan()
    service.removeFolder(f.id)
    expect(db.prepare('SELECT count(*) AS n FROM videos').get()).toEqual({ n: 0 })
  })

  it('never runs two scans at once, and runs one more after a busy period', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let active = 0
    let peak = 0
    const probe = async () => {
      active++
      peak = Math.max(peak, active)
      await gate
      active--
      return PROBE
    }
    const { service, probe: spy } = setup({ probe })
    db.prepare('INSERT INTO library_folders (path, added_at) VALUES (?, 0)').run(lib())

    const first = service.rescan()
    const more = [service.rescan(), service.rescan(), service.rescan()]
    await new Promise((r) => setTimeout(r, 20))
    release()
    await Promise.all([first, ...more])
    expect(peak).toBeLessThanOrEqual(2) // the two files of one scan, never a second scan's
    // First scan probes both files; the single follow-up finds them unchanged.
    expect(spy).toHaveBeenCalledTimes(2)
    expect(more[0]).toBe(more[2])
  })

  it('skips matching without a key and counts what is waiting', async () => {
    const { service } = setup()
    await service.addFolderPath(lib())
    await service.rescan()
    expect(service.metadataStatus()).toEqual({ hasKey: false, pending: 2, unmatched: 0 })
  })

  it('checks a TMDB key before saving it', async () => {
    const { service, credential } = setup()
    expect(parseAppError(await service.setTmdbKey('invalid').catch((e) => e))?.code).toBe('tmdb_key_invalid')
    expect(credential.has()).toBe(false)
    await service.setTmdbKey('  good-key  ')
    expect(credential.get()).toBe('good-key')
  })
})
