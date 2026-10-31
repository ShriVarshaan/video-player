import { basename, join } from 'node:path'
import { ipcMain, safeStorage } from 'electron'
import { MAX_OFFSET_S } from '@shared/subtitleTiming'
import type { API } from '@shared/api'
import { throwAppError } from '@shared/appError'
import { normalizeLang, toOpenSubtitles } from '@shared/lang'
import type { SubtitleResult } from '@shared/subtitleSearch'
import { sanitizePatch, sanitizeStyle } from '@shared/subtitleStyle'
import type { Db } from '../db'
import { registerDomain } from '../ipc'
import { createSecretStore, type SecretStore } from '../metadata/credential'
import type { PlayerService } from '../player/service'
import { saveDownload } from './download'
import { exportSynced } from './export'
import type { ExternalSub, SubFormat } from './match'
import { setOffset, subtitleKeyForFile } from './transforms'

const FORMATS: SubFormat[] = ['srt', 'vtt', 'ass', 'ssa']
import { createOpenSubtitles, type OpenSubtitles, type OpenSubtitlesSecrets, type SubtitleQuery } from './openSubtitles'
import { osHash } from './osHash'
import type { StyleStore } from './styleStore'

const keyOf = (key: unknown): string => {
  if (typeof key !== 'string' || !key) throwAppError({ code: 'invalid_argument', message: 'A title key is needed.' })
  return key
}

const nothingPlaying = (): never => throwAppError({ code: 'invalid_argument', message: 'Nothing is playing.' })

export type SubtitlesDeps = {
  db: Db
  styles: StyleStore
  player: PlayerService
  os: OpenSubtitles
  account: SecretStore // JSON of OpenSubtitlesSecrets
  userDataPath: string
}

export function readAccount(store: SecretStore): OpenSubtitlesSecrets | null {
  const raw = store.get()
  if (!raw) return null
  const a = JSON.parse(raw) as Partial<OpenSubtitlesSecrets>
  return a.apiKey && a.username && a.password ? { apiKey: a.apiKey, username: a.username, password: a.password } : null
}

type VideoRow = {
  kind: 'movie' | 'episode'
  tmdb_id: number | null
  show_tmdb_id: number | null
  season: number | null
  episode: number | null
  parsed_title: string
  parsed_year: number | null
  parsed_show: string | null
}

// What to ask OpenSubtitles for: the TMDB match when there is one, else the parsed name.
function queryFor(v: VideoRow, language: string, hash: string | undefined): SubtitleQuery {
  const q: SubtitleQuery = { language, hash }
  if (v.kind === 'movie' && v.tmdb_id !== null) return { ...q, tmdbId: v.tmdb_id }
  if (v.kind === 'episode' && v.show_tmdb_id !== null && v.season !== null && v.episode !== null) {
    return { ...q, parentTmdbId: v.show_tmdb_id, season: v.season, episode: v.episode }
  }
  const base = { ...q, query: v.kind === 'episode' ? (v.parsed_show ?? v.parsed_title) : v.parsed_title }
  if (v.kind === 'episode') return { ...base, season: v.season ?? undefined, episode: v.episode ?? undefined }
  return { ...base, year: v.parsed_year ?? undefined }
}

// Subtitle style, settings and online search. Style changes re-send the playing title's style.
export function createSubtitlesApi(deps: SubtitlesDeps): API['subtitles'] {
  const { styles, player, os, db } = deps
  const changed = () => player.notifyStyle()
  // The last search's results, so a download knows its language, kind and format.
  let lastResults = new Map<number, SubtitleResult>()

  return {
    getStyle: async ({ key }) => ({ global: styles.global(), overrides: typeof key === 'string' ? styles.overrides(key) : {} }),
    setGlobalStyle: async ({ style }) => {
      styles.setGlobal(sanitizeStyle(style))
      changed()
    },
    setTitleStyle: async ({ key, patch }) => {
      styles.setOverrides(keyOf(key), sanitizePatch(patch))
      changed()
    },
    useForAll: async ({ key }) => {
      styles.useForAll(keyOf(key))
      changed()
    },
    resetTitle: async ({ key }) => {
      styles.reset(keyOf(key))
      changed()
    },
    getSettings: async () => styles.subtitleSettings(),
    setSettings: async (s) => styles.setSubtitleSettings(s),

    search: async ({ language }) => {
      const cur = player.current() ?? nothingPlaying()
      if (!readAccount(deps.account)) throwAppError('opensubtitles_not_set_up')
      const lang = normalizeLang(language) ?? styles.subtitleSettings().language
      const video = db
        .prepare('SELECT kind, tmdb_id, show_tmdb_id, season, episode, parsed_title, parsed_year, parsed_show FROM videos WHERE id = ?')
        .get(cur.videoId) as VideoRow | undefined
      if (!video) nothingPlaying()
      const hash = await osHash(cur.path).catch(() => undefined)
      const results = await os.search(queryFor(video!, toOpenSubtitles(lang), hash))
      lastResults = new Map(results.map((r) => [r.fileId, r]))
      return { results, remaining: os.remaining() }
    },

    download: async ({ fileId }) => {
      const cur = player.current() ?? nothingPlaying()
      const r = lastResults.get(fileId)
      if (!r) throwAppError({ code: 'invalid_argument', message: 'Search again, then pick a subtitle.' })
      const d = await os.download(fileId)
      const lang = normalizeLang(r!.language) ?? styles.subtitleSettings().language
      const kind = r!.forced ? 'forced' : r!.sdh ? 'sdh' : 'plain'
      const format: SubFormat = (FORMATS as string[]).includes(r!.format) ? (r!.format as SubFormat) : 'srt'
      const path = await saveDownload({
        videoPath: cur.path,
        lang,
        kind,
        format,
        content: d.content,
        fallbackDir: join(deps.userDataPath, 'subtitles', String(cur.videoId))
      })
      // Still the same video: show it now. Otherwise it is found next time it plays.
      if (player.current()?.videoId === cur.videoId) await player.addSubtitle({ path, lang, kind, format })
      return { remaining: d.remaining }
    },

    accountStatus: async () => {
      const a = readAccount(deps.account)
      return { configured: a !== null, username: a?.username ?? null }
    },
    setAccount: async ({ apiKey, username, password }) => {
      const clean = [apiKey, username, password].map((s) => (typeof s === 'string' ? s.trim() : ''))
      if (clean.some((s) => !s)) throwAppError({ code: 'invalid_argument', message: 'Enter the API key, username and password.' })
      deps.account.set(JSON.stringify({ apiKey: clean[0], username: clean[1], password: clean[2] }))
      os.reset()
    },
    testAccount: async () => os.account(),

    nudge: async ({ deltaS }) => {
      if (typeof deltaS !== 'number' || !Number.isFinite(deltaS) || Math.abs(deltaS) > MAX_OFFSET_S) {
        throwAppError({ code: 'invalid_argument', message: 'That is not a timing change.' })
      }
      return { offset: await player.nudgeSubtitle(deltaS) }
    },
    resetTiming: async () => player.resetSubtitleTiming(),
    // Picture subtitles too: only mpv's sub-delay changes.
    setTiming: async ({ offset, key }) => {
      if (typeof offset !== 'number' || !Number.isFinite(offset) || Math.abs(offset) > MAX_OFFSET_S) {
        throwAppError({ code: 'invalid_argument', message: 'That is not a timing change.' })
      }
      const sub = player.currentSubtitle()
      if (!sub) throwAppError({ code: 'invalid_argument', message: 'Choose a subtitle first.' })
      if (typeof key !== 'string' || key !== sub.track.key) throwAppError({ code: 'invalid_argument', message: 'The subtitle changed. Try again.' })
      return { offset: await player.setSubtitleOffset(offset) }
    },
    syncCues: async () => {
      const sub = textSubtitle()
      const cues = await player.subtitleCues()
      return { cues: cues.map((c) => ({ start: c.start, text: c.lines.join('\n') })), offset: sub.offset, key: sub.track.key! }
    },
    syncToCue: async ({ start, key }) => {
      if (typeof start !== 'number' || !Number.isFinite(start)) throwAppError({ code: 'invalid_argument', message: 'Pick a line.' })
      sameSubtitle(key)
      return { offset: await player.syncSubtitleTo(start) }
    },
    exportSynced: async ({ replace, key }) => {
      const sub = sameSubtitle(key)
      const cues = await player.subtitleCues()
      const lang = normalizeLang(sub.track.lang)
      const r = await exportSynced({
        videoPath: sub.videoPath,
        lang,
        kind: sub.track.kind,
        cues,
        transform: { scale: 1, offset: sub.offset },
        replace: replace === true,
        fallbackDir: join(deps.userDataPath, 'subtitles', String(sub.videoId))
      })
      if ('exists' in r) return { exists: basename(r.exists) }
      // The shift is baked into the new file: it starts with no fix of its own.
      setOffset(db, sub.videoId, subtitleKeyForFile(r.saved), 0, Date.now())
      const added: ExternalSub = { path: r.saved, lang, kind: sub.track.kind, format: 'srt', synced: true }
      if (player.current()?.videoId === sub.videoId) await player.addSubtitle(added, { remember: false })
      return { saved: basename(r.saved), fallback: r.fallback }
    }
  }

  // The showing subtitle, which must be one the app can read as text.
  function textSubtitle() {
    const sub = player.currentSubtitle()
    if (!sub) throwAppError({ code: 'invalid_argument', message: 'Choose a subtitle first.' })
    if (sub.track.image) throwAppError({ code: 'invalid_argument', message: 'Sync to a line needs a text subtitle' })
    return sub
  }

  // The subtitle the user was looking at (its key) must still be the one showing.
  function sameSubtitle(key: unknown) {
    const sub = textSubtitle()
    if (typeof key !== 'string' || key !== sub.track.key) throwAppError({ code: 'invalid_argument', message: 'The subtitle changed. Try again.' })
    return sub
  }
}

export function setupSubtitles(opts: {
  db: Db
  styles: StyleStore
  player: PlayerService
  userDataPath: string
  // Project root in development (for OpenSubtitles fixtures); null when packaged.
  devRoot: string | null
  version: string
}): void {
  const account = createSecretStore(opts.db, safeStorage, 'opensubtitles.account', 'opensubtitles_storage_unavailable')
  // VP_OPENSUBS_MODE=fixtures (tests) reads tests/fixtures/opensubtitles instead of the network.
  const fixtures = opts.devRoot !== null && process.env['VP_OPENSUBS_MODE'] === 'fixtures'
  const os = createOpenSubtitles({
    secrets: () => readAccount(account),
    mode: fixtures ? 'fixtures' : 'live',
    fixturesDir: join(opts.devRoot ?? '', 'tests', 'fixtures', 'opensubtitles'),
    userAgent: `VideoPlayer v${opts.version}`
  })
  registerDomain(ipcMain, 'subtitles', createSubtitlesApi({ ...opts, os, account }))
}
