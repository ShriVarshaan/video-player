import { basename, join } from 'node:path'
import type { API, ApiEvents } from '@shared/api'
import { throwAppError } from '@shared/appError'
import type { TitleDetail } from '@shared/library'
import type { Cue, PlayerCommand, PlayerState, Track, TrackRef } from '@shared/player'
import type { Db } from '../db'
import { getTitle } from '../library/queries'
import { isFinished, nextEpisode, type ProgressEpisode } from '../library/showProgress'
import type { MpvClient } from './mpvIpc'
import { savePosition } from './resume'
import { getPrefs, savePrefs } from './titlePrefs'
import { toCue } from '../subtitles/cue'
import type { ExternalSub, LoadedSub } from '../subtitles/match'
import type { StyleStore } from '../subtitles/styleStore'
import { originalLanguage } from '../subtitles/titleInfo'
import type { ParsedCue } from '../subtitles/parse'
import { TEXT_CODECS } from '../subtitles/extract'
import { subtitleKeyForFile } from '../subtitles/transforms'
import { offsetForCue } from '@shared/subtitleTiming'
import { createSubtitleDelay } from './subtitleDelay'
import { audioStreamIndex, pickSubtitle, pickTrack, preferSynced, refOf, subtitlePrefFor, toTracks } from './tracks'

// One running mpv. onExit's flag is true when we asked it to quit.
export type MpvProcess = { client: MpvClient; onExit(cb: (expected: boolean) => void): void; quit(): Promise<void> }

type Emit = <K extends keyof ApiEvents>(event: K, payload: ApiEvents[K]) => void

export type PlayerService = API['player'] & {
  shutdown(): Promise<void>
  // What is playing, for subtitle search and style changes.
  current(): { videoId: number; titleKey: string; path: string } | null
  // Re-sends the playing title's subtitle style after a change.
  notifyStyle(): void
  // Adds a subtitle file and shows it; remembers it for the title unless remember is false.
  addSubtitle(sub: ExternalSub, opts?: { remember?: boolean }): Promise<void>
  // Timing of the showing subtitle (milestone 6). null: no subtitle showing.
  nudgeSubtitle(deltaS: number): Promise<number | null>
  setSubtitleOffset(offset: number): Promise<number | null>
  syncSubtitleTo(cueStart: number): Promise<number | null>
  resetSubtitleTiming(): Promise<void>
  currentSubtitle(): { videoId: number; videoPath: string; track: Track; offset: number } | null
  // The showing text subtitle's lines, read by the app itself.
  subtitleCues(): Promise<ParsedCue[]>
  // The selected audio track as ffmpeg's 0:a:<n> (null: none or external), for auto sync.
  currentAudio(): { audioStream: number | null; durationS: number | null } | null
}

// Where the app reads a subtitle's lines from.
export type SubtitleCueSource =
  | { kind: 'file'; path: string; lang: string | null }
  | { kind: 'embedded'; video: string; ffIndex: number; codec: string; signal?: AbortSignal }

// Finds a video's subtitle files and turns one into a path mpv can read (UTF-8).
export type SubtitleSource = {
  find(video: { path: string; season: number | null; episode: number | null }, opts: { userLang: string; extraDirs: string[] }): Promise<ExternalSub[]>
  load(sub: ExternalSub): Promise<string>
  userData: string
  cues(src: SubtitleCueSource): Promise<ParsedCue[]>
}

const NEEDS_TEXT = 'Sync to a line needs a text subtitle'

const SAVE_EVERY_MS = 10_000
const STATE_EVERY_MS = 33 // about 30 updates a second to the overlay
const LIMITER = '@limiter:lavfi=[alimiter=limit=0.97]'
const CANT_PLAY = "Can't play this file"

type Current = {
  title: TitleDetail
  videoId: number
  path: string
  season: number | null
  episode: number | null
  heading: string
  startAt: number
  loaded: boolean
  // Positions are saved only once the resume seek has landed, so mpv's first
  // time-pos (0) never overwrites a good resume point.
  ready: boolean
  seeking: 'no' | 'sent' | 'started'
  ended: boolean
  // Running once mpv has opened the file: externals, tracks, the subtitle pick.
  setup: Promise<void> | null
  // The subtitle pick for this file is made; its lines may be shown.
  picked: boolean
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clampVolume = (v: number) => Math.min(200, Math.max(0, Math.round(v)))

function headingFor(title: TitleDetail, videoId: number): string {
  if (title.kind === 'movie') return title.title
  const ep = title.seasons.flatMap((s) => s.episodes).find((e) => e.videoId === videoId)
  if (!ep) return title.title
  return `${title.title} · S${ep.season} E${ep.episode}${ep.title ? ` · ${ep.title}` : ''}`
}

export function createPlayerService(deps: {
  db: Db
  launch: () => Promise<MpvProcess>
  emit: Emit
  window: { setFullScreen(on: boolean): void; isFullScreen(): boolean }
  overlay: { show(): void; hide(): void }
  now: () => number
  subtitles: SubtitleSource
  styles: StyleStore
}): PlayerService {
  const { db } = deps
  let proc: MpvProcess | null = null
  let launching: Promise<MpvProcess> | null = null
  let cur: Current | null = null
  let closing: Promise<void> | null = null
  let limiterOn = false
  let lastSave = 0
  let lastEmit = 0
  let emitTimer: NodeJS.Timeout | null = null
  let crashes = 0
  // Where to pick up after mpv crashed. The subtitle is kept by reference, not id:
  // files are added again on the respawn and their ids can move.
  let restore: { positionS: number; aid: number | null; sub: TrackRef | 'off' } | null = null
  const st = {
    paused: false,
    positionS: 0,
    durationS: null as number | null,
    volume: 100,
    muted: false,
    tracks: [] as Track[],
    aid: null as number | null,
    sid: null as number | null,
    // Subtitle files added to this file, with the path mpv was given.
    externals: [] as LoadedSub[]
  }
  let lastCue = 'null'
  // Cues the app has read for the current file, by subtitle key; aborted when the file changes.
  let cueCache = new Map<string, Promise<ParsedCue[]>>()
  let cueAbort = new AbortController()

  // Commands other than loadfile are best effort: a failed one must not break playback.
  const cmd = (...args: unknown[]) =>
    proc?.client.command(...args).catch((e: unknown) => console.warn('mpv command failed:', args[0], e)) ?? Promise.resolve()

  const delay = createSubtitleDelay({
    db,
    setDelay: async (s) => void (await cmd('set_property', 'sub-delay', s)),
    emit: (offset) => deps.emit('subtitles.timing', offset === null ? null : { offset }),
    now: deps.now
  })

  function newFile() {
    delay.clear()
    cueAbort.abort()
    cueAbort = new AbortController()
    cueCache = new Map()
  }

  function emitCue(cue: Cue | null) {
    const json = JSON.stringify(cue)
    if (json === lastCue) return
    lastCue = json
    deps.emit('subtitles.cue', cue)
  }

  // Text subtitles are drawn by the overlay; mpv draws only picture-based ones.
  async function selectSubtitle(id: number | null) {
    // The track's own timing fix (or none) is in place before it shows.
    const track = id === null ? undefined : st.tracks.find((t) => t.type === 'sub' && t.id === id)
    if (cur) await delay.select(cur.videoId, track?.key ?? null)
    await cmd('set_property', 'sid', id ?? 'no')
    // Known at once (mpv's sid observer confirms it shortly after).
    st.sid = id
    const image = st.tracks.some((t) => t.type === 'sub' && t.id === id && t.image)
    await cmd('set_property', 'sub-visibility', image)
  }

  function notifyStyle() {
    if (cur) deps.emit('subtitles.style', deps.styles.effective(cur.title.key))
  }

  async function addExternals(mine: Current): Promise<void> {
    const { language } = deps.styles.subtitleSettings()
    const extraDirs = [join(deps.subtitles.userData, 'subtitles', String(mine.videoId))]
    const found = await deps.subtitles
      .find({ path: mine.path, season: mine.season, episode: mine.episode }, { userLang: language, extraDirs })
      .catch(() => [])
    st.externals = []
    for (const sub of found) {
      if (cur !== mine) return
      const path = await deps.subtitles.load(sub).catch(() => null)
      if (!path) continue
      st.externals.push({ ...sub, path, original: sub.path })
      await cmd('sub-add', path, 'auto', basename(sub.path), sub.lang ?? '')
    }
  }

  function state(): PlayerState {
    return {
      titleKey: cur!.title.key,
      videoId: cur!.videoId,
      heading: cur!.heading,
      paused: st.paused,
      positionS: st.positionS,
      durationS: st.durationS,
      volume: st.volume,
      muted: st.muted,
      audio: st.tracks.filter((t) => t.type === 'audio'),
      subtitles: st.tracks.filter((t) => t.type === 'sub'),
      audioId: st.aid,
      subtitleId: st.sid,
      fullScreen: deps.window.isFullScreen()
    }
  }

  function emitState(force = false) {
    if (!cur) return
    const wait = STATE_EVERY_MS - (deps.now() - lastEmit)
    if (force || wait <= 0) {
      if (emitTimer) clearTimeout(emitTimer)
      emitTimer = null
      lastEmit = deps.now()
      deps.emit('player.state', state())
    } else if (!emitTimer) {
      emitTimer = setTimeout(() => {
        emitTimer = null
        emitState(true)
      }, wait)
    }
  }

  function save(ended = false) {
    if (!cur?.ready) return
    savePosition(db, { videoId: cur.videoId, positionS: st.positionS, durationS: st.durationS, ended }, deps.now())
    lastSave = deps.now()
  }

  function resumePoint(videoId: number): number {
    const p = db.prepare('SELECT position_s, duration_s, completed FROM playback_state WHERE video_id = ?').get(videoId) as
      | { position_s: number; duration_s: number | null; completed: number }
      | undefined
    if (!p || isFinished({ positionS: p.position_s, durationS: p.duration_s, completed: p.completed === 1 })) return 0
    return p.position_s
  }

  async function applyVolume(v: number) {
    st.volume = v
    await cmd('set_property', 'volume', v)
    if (v > 100 && !limiterOn) {
      limiterOn = true
      await cmd('af', 'add', LIMITER)
    } else if (v <= 100 && limiterOn) {
      limiterOn = false
      await cmd('af', 'remove', '@limiter')
    }
  }

  // Tracks and the subtitle pick for a file mpv has opened. A download that lands
  // meanwhile waits for this, so the automatic pick can't replace it.
  async function onLoaded() {
    if (!cur) return
    cur.loaded = true
    cur.setup = setUp()
    await cur.setup
  }

  async function setUp() {
    if (!cur) return
    const mine = cur
    const prefs = getPrefs(db, cur.title.key)
    const target = restore ?? { positionS: cur.startAt }
    if (target.positionS > 0) {
      const mine = cur
      mine.seeking = 'sent'
      const ok = await proc!.client.command('seek', target.positionS, 'absolute').then(
        () => true,
        () => false
      )
      // A seek mpv refused leaves playback where it is; that is now the truth.
      if (!ok && mine.seeking === 'sent') Object.assign(mine, { seeking: 'no', ready: true })
    } else {
      cur.ready = true
    }
    await applyVolume(prefs.volume)
    await addExternals(mine)
    if (cur !== mine) return
    st.tracks = toTracks(await cmd('get_property', 'track-list'), st.externals)
    const audio = st.tracks.filter((t) => t.type === 'audio')
    const subs = st.tracks.filter((t) => t.type === 'sub')
    if (restore) {
      if (restore.aid !== null) await cmd('set_property', 'aid', restore.aid)
      await selectSubtitle(restore.sub === 'off' ? null : (preferSynced(subs, pickTrack(subs, restore.sub))?.id ?? null))
    } else {
      const settings = deps.styles.subtitleSettings()
      const a = pickTrack(audio, prefs.audio)
      if (a) await cmd('set_property', 'aid', a.id)
      // Untagged audio: TMDB's original language, else assume it is the user's.
      const audioLang = (a ?? audio.find((t) => t.default) ?? audio[0])?.lang ?? originalLanguage(db, mine.videoId) ?? settings.language
      const s = preferSynced(subs, pickSubtitle(subs, prefs.subtitle, { audioLang, userLang: settings.language, preferSdh: settings.preferSdh }))
      await selectSubtitle(s ? s.id : null)
    }
    // Lines are shown only from here on: before the pick, mpv's own default track could speak.
    mine.picked = true
    restore = null
    emitState(true)
  }

  async function onEof() {
    if (!cur || cur.ended || !cur.loaded) return
    cur.ended = true
    save(true)
    deps.emit('library.changed', {})
    const title = cur.title
    if (title.kind === 'show') {
      const episodes = title.seasons.flatMap((s) => s.episodes)
      const progress: ProgressEpisode[] = episodes.map((e) => ({ ...e, completed: e.finished, lastPlayedAt: null }))
      const next = nextEpisode(progress, cur.videoId)
      const ep = next && episodes.find((e) => e.videoId === next.videoId)
      if (ep) {
        deps.emit('player.ended', { next: { videoId: ep.videoId, season: ep.season, episode: ep.episode, title: ep.title, stillUrl: ep.stillUrl } })
        return
      }
    }
    await stop()
  }

  function fail() {
    deps.emit('player.error', { message: CANT_PLAY })
  }

  function attach(p: MpvProcess) {
    const c = p.client
    limiterOn = false
    void c.observe('time-pos', (v) => {
      const t = num(v)
      if (t === null || !(cur?.ready || cur?.seeking === 'started')) return
      st.positionS = t
      if (!st.paused && deps.now() - lastSave >= SAVE_EVERY_MS) save()
      emitState()
    })
    void c.observe('pause', (v) => {
      st.paused = v === true
      if (st.paused) save()
      emitState(true)
    })
    void c.observe('duration', (v) => (st.durationS = num(v)))
    void c.observe('volume', (v) => {
      const n = num(v)
      if (n !== null) st.volume = Math.round(n)
    })
    void c.observe('mute', (v) => (st.muted = v === true))
    void c.observe('aid', (v) => (st.aid = num(v)))
    void c.observe('sid', (v) => (st.sid = num(v)))
    void c.observe('sub-text/ass', (v) => {
      // Lines from a file that is no longer (or not yet) the current one are dropped.
      if (cur?.picked) emitCue(toCue(v))
    })
    void c.observe('eof-reached', (v) => {
      if (v === true) void onEof()
    })
    c.on('file-loaded', () => void onLoaded())
    c.on('seek', () => {
      if (cur?.seeking === 'sent') cur.seeking = 'started'
    })
    c.on('playback-restart', () => {
      if (cur?.seeking === 'started') Object.assign(cur, { seeking: 'no', ready: true })
      save()
      emitState(true)
    })
    c.on('end-file', (m) => {
      if (m['reason'] === 'error') fail()
    })
    p.onExit((expected) => void onExit(p, expected))
  }

  // One launch at a time: overlapping plays (or a play during a respawn) share it.
  function ensureProcess(): Promise<MpvProcess> {
    if (proc) return Promise.resolve(proc)
    launching ??= deps
      .launch()
      .then((p) => {
        proc = p
        attach(p)
        return p
      })
      .finally(() => (launching = null))
    return launching
  }

  // Nothing is playing any more (stopped while mpv was starting): don't leave it running.
  async function quitIfIdle() {
    if (cur || !proc) return
    const p = proc
    proc = null
    await p.quit().catch(() => {})
  }

  // mpv died on its own: respawn once where it was, then give up.
  async function onExit(p: MpvProcess, expected: boolean) {
    if (p !== proc) return
    proc = null
    if (expected || !cur || closing) return
    save()
    if (++crashes > 1) return fail()
    const showing = st.tracks.find((t) => t.type === 'sub' && t.id === st.sid)
    restore = { positionS: st.positionS, aid: st.aid, sub: showing ? refOf(showing) : 'off' }
    Object.assign(cur, { loaded: false, ready: false, seeking: 'no', setup: null, picked: false })
    try {
      const next = await ensureProcess()
      if (!cur) return quitIfIdle()
      await next.client.command('loadfile', cur.path, 'replace')
    } catch {
      fail()
    }
  }

  async function play(p: { key: string; videoId?: number; from?: 'resume' | 'start' }) {
    const title = getTitle(db, p.key)
    if (!title) throwAppError({ code: 'invalid_argument', message: 'That title is no longer in the library.' })
    const videoId = p.videoId ?? title.main.videoId
    const from = p.videoId === undefined ? (p.from ?? title.main.from) : (p.from ?? 'resume')
    const row = db.prepare('SELECT path, season, episode FROM videos WHERE id = ?').get(videoId) as
      | { path: string; season: number | null; episode: number | null }
      | undefined
    if (!row) throwAppError({ code: 'invalid_argument', message: 'That file is no longer in the library.' })

    // Let a stop that is still closing finish first, so it can't close this session.
    if (closing) await closing.catch(() => {})
    if (cur && cur.videoId !== videoId) save()
    newFile()
    const mine: Current = {
      title,
      videoId,
      path: row.path,
      season: row.season,
      episode: row.episode,
      heading: headingFor(title, videoId),
      startAt: from === 'resume' ? resumePoint(videoId) : 0,
      loaded: false,
      ready: false,
      seeking: 'no',
      ended: false,
      setup: null,
      picked: false
    }
    cur = mine
    crashes = 0
    restore = null
    lastSave = deps.now()
    Object.assign(st, { paused: false, positionS: mine.startAt, durationS: null, tracks: [], aid: null, sid: null, externals: [] })
    st.volume = getPrefs(db, title.key).volume
    emitCue(null)
    notifyStyle()

    const p2 = await ensureProcess()
    // Stopped, or replaced by a newer play, while mpv was starting.
    if (cur !== mine) return quitIfIdle()
    deps.overlay.show()
    await p2.client.command('loadfile', row.path, 'replace')
    // --keep-open leaves mpv paused at the end of the last file.
    await cmd('set_property', 'pause', false)
    emitState(true)
  }

  async function stop() {
    if (closing) return closing
    if (!cur) return
    closing = (async () => {
      save()
      newFile()
      deps.emit('library.changed', {})
      const p = proc
      proc = null
      if (p) await p.quit().catch(() => {})
      if (deps.window.isFullScreen()) deps.window.setFullScreen(false)
      deps.overlay.hide()
      const titleKey = cur!.title.key
      cur = null
      emitCue(null)
      if (emitTimer) clearTimeout(emitTimer)
      emitTimer = null
      deps.emit('player.closed', { titleKey })
    })()
    try {
      await closing
    } finally {
      closing = null
    }
  }

  async function command(c: PlayerCommand) {
    if (!proc || !cur) return
    const key = cur.title.key
    switch (c.type) {
      case 'pause':
        return void (await cmd('set_property', 'pause', c.paused))
      case 'seek':
        return void (await cmd('seek', c.toS, 'absolute'))
      case 'seekBy':
        return void (await cmd('seek', c.s, 'relative'))
      case 'mute':
        st.muted = c.muted
        await cmd('set_property', 'mute', c.muted)
        return emitState(true)
      case 'volume': {
        const v = clampVolume(c.value)
        await applyVolume(v)
        savePrefs(db, key, { volume: v }, deps.now())
        return emitState(true)
      }
      case 'audio': {
        await cmd('set_property', 'aid', c.id)
        const track = st.tracks.find((t) => t.type === 'audio' && t.id === c.id)
        if (track) savePrefs(db, key, { audio: refOf(track) }, deps.now())
        return
      }
      case 'subtitle': {
        const showing = st.tracks.find((t) => t.type === 'sub' && t.id === st.sid)
        const choice = c.id === null ? null : (st.tracks.find((t) => t.type === 'sub' && t.id === c.id) ?? null)
        emitCue(null)
        await selectSubtitle(c.id)
        // Off over nothing changes nothing; Off over a showing track is remembered.
        if (choice || showing) savePrefs(db, key, { subtitle: subtitlePrefFor(choice, showing !== undefined) }, deps.now())
        // Paused, nothing else would tell the overlay (its menu, the sync card) of the change.
        return emitState(true)
      }
      case 'fullScreen':
        deps.window.setFullScreen(c.on)
        return emitState(true)
    }
  }

  async function addSubtitle(sub: ExternalSub, opts: { remember?: boolean } = {}) {
    if (!proc || !cur?.loaded) return
    const mine = cur
    await mine.setup?.catch(() => {})
    const path = await deps.subtitles.load(sub)
    if (cur !== mine) return
    const key = subtitleKeyForFile(sub.path)
    // The file may have been written again (a re-export): its old track and its old
    // lines go, so the menu lists it once and the sync card reads the new text.
    cueCache.delete(key)
    for (const old of st.tracks.filter((t) => t.type === 'sub' && t.key === key)) await cmd('sub-remove', old.id)
    st.externals = st.externals.filter((e) => !e.original || subtitleKeyForFile(e.original) !== key)
    st.externals.push({ ...sub, path, original: sub.path })
    emitCue(null)
    await cmd('sub-add', path, 'select', basename(sub.path), sub.lang ?? '')
    st.tracks = toTracks(await cmd('get_property', 'track-list'), st.externals)
    const added = st.tracks.find((t) => t.type === 'sub' && t.key === key)
    if (added) {
      await selectSubtitle(added.id)
      if (opts.remember !== false) savePrefs(db, mine.title.key, { subtitle: refOf(added) }, deps.now())
    }
    emitState(true)
  }

  const showing = () => (cur ? st.tracks.find((t) => t.type === 'sub' && t.id === st.sid) : undefined)

  async function syncSubtitleTo(cueStart: number): Promise<number | null> {
    if (!showing() || !delay.current()) return null
    const pos = num(await cmd('get_property', 'time-pos')) ?? st.positionS
    return delay.set(offsetForCue(cueStart, pos))
  }

  function currentSubtitle() {
    const track = showing()
    const d = delay.current()
    if (!cur || !track || !d) return null
    return { videoId: cur.videoId, videoPath: cur.path, track, offset: d.offset }
  }

  async function subtitleCues(): Promise<ParsedCue[]> {
    const track = showing()
    if (!cur || !track?.key) throwAppError({ code: 'invalid_argument', message: 'Choose a subtitle first.' })
    if (track.image) throwAppError({ code: 'invalid_argument', message: NEEDS_TEXT })
    const known = cueCache.get(track.key)
    if (known) return known
    let src: SubtitleCueSource
    const ext = track.external ? st.externals.find((e) => e.original && subtitleKeyForFile(e.original) === track.key) : undefined
    if (ext) src = { kind: 'file', path: ext.original!, lang: ext.lang }
    else if (!track.external && track.key.startsWith('embedded:') && track.codec && TEXT_CODECS.has(track.codec)) {
      src = { kind: 'embedded', video: cur.path, ffIndex: Number(track.key.slice('embedded:'.length)), codec: track.codec, signal: cueAbort.signal }
    } else throwAppError({ code: 'invalid_argument', message: NEEDS_TEXT })
    const key = track.key
    const p = deps.subtitles.cues(src)
    cueCache.set(key, p)
    // A failed read is tried again next time.
    p.catch(() => cueCache.get(key) === p && cueCache.delete(key))
    return p
  }

  return {
    play,
    stop: () => stop(),
    command,
    shutdown: () => stop(),
    current: () => (cur ? { videoId: cur.videoId, titleKey: cur.title.key, path: cur.path } : null),
    notifyStyle,
    addSubtitle,
    nudgeSubtitle: async (deltaS) => (showing() ? delay.nudge(deltaS) : null),
    setSubtitleOffset: async (offset) => (showing() ? delay.set(offset) : null),
    syncSubtitleTo,
    resetSubtitleTiming: async () => void (await delay.set(0)),
    currentSubtitle,
    subtitleCues,
    currentAudio: () =>
      cur ? { audioStream: audioStreamIndex(st.tracks.filter((t) => t.type === 'audio'), st.aid), durationS: st.durationS } : null
  }
}
