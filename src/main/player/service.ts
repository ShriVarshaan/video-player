import type { API, ApiEvents } from '@shared/api'
import { throwAppError } from '@shared/appError'
import type { TitleDetail } from '@shared/library'
import type { PlayerCommand, PlayerState, Track } from '@shared/player'
import type { Db } from '../db'
import { getTitle } from '../library/queries'
import { isFinished, nextEpisode, type ProgressEpisode } from '../library/showProgress'
import type { MpvClient } from './mpvIpc'
import { savePosition } from './resume'
import { getPrefs, savePrefs } from './titlePrefs'
import { pickSubtitle, pickTrack, refOf, subtitlePrefFor, toTracks } from './tracks'

// One running mpv. onExit's flag is true when we asked it to quit.
export type MpvProcess = { client: MpvClient; onExit(cb: (expected: boolean) => void): void; quit(): Promise<void> }

type Emit = <K extends keyof ApiEvents>(event: K, payload: ApiEvents[K]) => void

export type PlayerService = API['player'] & { shutdown(): Promise<void> }

const SAVE_EVERY_MS = 10_000
const STATE_EVERY_MS = 33 // about 30 updates a second to the overlay
const LIMITER = '@limiter:lavfi=[alimiter=limit=0.97]'
const CANT_PLAY = "Can't play this file"

type Current = {
  title: TitleDetail
  videoId: number
  path: string
  heading: string
  startAt: number
  loaded: boolean
  // Positions are saved only once the resume seek has landed, so mpv's first
  // time-pos (0) never overwrites a good resume point.
  ready: boolean
  seeking: 'no' | 'sent' | 'started'
  ended: boolean
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
  let restore: { positionS: number; aid: number | null; sid: number | null } | null = null
  const st = {
    paused: false,
    positionS: 0,
    durationS: null as number | null,
    volume: 100,
    muted: false,
    tracks: [] as Track[],
    aid: null as number | null,
    sid: null as number | null
  }

  // Commands other than loadfile are best effort: a failed one must not break playback.
  const cmd = (...args: unknown[]) =>
    proc?.client.command(...args).catch((e: unknown) => console.warn('mpv command failed:', args[0], e)) ?? Promise.resolve()

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

  async function onLoaded() {
    if (!cur) return
    cur.loaded = true
    const prefs = getPrefs(db, cur.title.key)
    const target = restore ?? { positionS: cur.startAt, aid: null, sid: null }
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
    st.tracks = toTracks(await cmd('get_property', 'track-list'))
    const audio = st.tracks.filter((t) => t.type === 'audio')
    const subs = st.tracks.filter((t) => t.type === 'sub')
    if (restore) {
      if (restore.aid !== null) await cmd('set_property', 'aid', restore.aid)
      await cmd('set_property', 'sid', restore.sid ?? 'no')
    } else {
      const a = pickTrack(audio, prefs.audio)
      if (a) await cmd('set_property', 'aid', a.id)
      const audioLang = (a ?? audio.find((t) => t.default) ?? audio[0])?.lang ?? null
      const s = pickSubtitle(subs, prefs.subtitle, audioLang)
      await cmd('set_property', 'sid', s ? s.id : 'no')
    }
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
    restore = { positionS: st.positionS, aid: st.aid, sid: st.sid }
    Object.assign(cur, { loaded: false, ready: false, seeking: 'no' })
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
    const row = db.prepare('SELECT path FROM videos WHERE id = ?').get(videoId) as { path: string } | undefined
    if (!row) throwAppError({ code: 'invalid_argument', message: 'That file is no longer in the library.' })

    // Let a stop that is still closing finish first, so it can't close this session.
    if (closing) await closing.catch(() => {})
    if (cur && cur.videoId !== videoId) save()
    const mine: Current = {
      title,
      videoId,
      path: row.path,
      heading: headingFor(title, videoId),
      startAt: from === 'resume' ? resumePoint(videoId) : 0,
      loaded: false,
      ready: false,
      seeking: 'no',
      ended: false
    }
    cur = mine
    crashes = 0
    restore = null
    lastSave = deps.now()
    Object.assign(st, { paused: false, positionS: mine.startAt, durationS: null, tracks: [], aid: null, sid: null })
    st.volume = getPrefs(db, title.key).volume

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
      deps.emit('library.changed', {})
      const p = proc
      proc = null
      if (p) await p.quit().catch(() => {})
      if (deps.window.isFullScreen()) deps.window.setFullScreen(false)
      deps.overlay.hide()
      const titleKey = cur!.title.key
      cur = null
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
        await cmd('set_property', 'sid', c.id ?? 'no')
        savePrefs(db, key, { subtitle: subtitlePrefFor(choice, showing?.kind === 'forced') }, deps.now())
        return
      }
      case 'fullScreen':
        deps.window.setFullScreen(c.on)
        return emitState(true)
    }
  }

  return {
    play,
    stop: () => stop(),
    command,
    shutdown: () => stop()
  }
}
