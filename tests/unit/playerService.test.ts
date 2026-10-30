import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { ApiEvents } from '@shared/api'
import { openDb, type Db } from '../../src/main/db'
import type { MpvClient } from '../../src/main/player/mpvIpc'
import { createPlayerService, type MpvProcess, type PlayerService } from '../../src/main/player/service'
import { getPrefs, savePrefs } from '../../src/main/player/titlePrefs'
import type { ExternalSub } from '../../src/main/subtitles/match'
import { createStyleStore } from '../../src/main/subtitles/styleStore'

const TRACKS = [
  { id: 1, type: 'video', codec: 'h264' },
  { id: 1, type: 'audio', lang: 'eng', 'demux-channel-count': 6, default: true },
  { id: 2, type: 'audio', lang: 'jpn' },
  { id: 1, type: 'sub', lang: 'eng', title: 'English' },
  { id: 2, type: 'sub', lang: 'eng', forced: true }
]

type Fake = {
  proc: MpvProcess
  commands: unknown[][]
  set(name: string, value: unknown): void
  fire(event: string, extra?: Record<string, unknown>): void
  crash(): void
  quit: ReturnType<typeof vi.fn<() => Promise<void>>>
}

function fakeMpv(): Fake {
  const commands: unknown[][] = []
  const observers = new Map<string, (v: unknown) => void>()
  const listeners = new Map<string, Set<(m: Record<string, unknown>) => void>>()
  let onExit: (expected: boolean) => void = () => {}
  const added: Record<string, unknown>[] = []
  const client: MpvClient = {
    command: async (...args) => {
      commands.push(args)
      if (args[0] === 'sub-add') {
        added.push({ id: 3 + added.length, type: 'sub', external: true, 'external-filename': args[1], title: args[3], lang: args[4] || undefined, codec: 'subrip' })
      }
      if (args[0] === 'loadfile') added.length = 0
      if (args[0] === 'get_property' && args[1] === 'track-list') {
        // mpv answers with the tracks as they were when the request arrived.
        const now = [...trackList, ...added]
        if (trackGate) await trackGate
        return now
      }
      return null
    },
    observe: async (name, cb) => void observers.set(name, cb),
    on: (event, cb) => {
      const set = listeners.get(event) ?? new Set()
      listeners.set(event, set)
      set.add(cb)
      return () => void set.delete(cb)
    },
    onClose: () => {},
    close: () => {}
  }
  const quit = vi.fn(async () => onExit(true))
  return {
    proc: { client, onExit: (cb) => (onExit = cb), quit },
    commands,
    set: (name, value) => observers.get(name)?.(value),
    fire: (event, extra = {}) => {
      for (const cb of listeners.get(event) ?? []) cb({ event, ...extra })
    },
    crash: () => onExit(false),
    quit
  }
}

let db: Db
let trackList: Record<string, unknown>[]
let trackGate: Promise<void> | null
let externals: ExternalSub[]
let fakes: Fake[]
let events: { event: keyof ApiEvents; payload: unknown }[]
let overlay: { show: ReturnType<typeof vi.fn<() => void>>; hide: ReturnType<typeof vi.fn<() => void>> }
let win: { full: boolean; setFullScreen: (on: boolean) => void; isFullScreen: () => boolean }
let player: PlayerService
let gate: Promise<void> | null
let failLaunch: boolean

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const mpv = () => fakes[fakes.length - 1]!
const sent = (name: string) => mpv().commands.filter((c) => c[0] === name)
const emitted = (name: keyof ApiEvents) => events.filter((e) => e.event === name).map((e) => e.payload)
const pb = (id: number) =>
  ({ ...db.prepare('SELECT position_s, duration_s, completed FROM playback_state WHERE video_id = ?').get(id) }) as Record<string, number>

async function loaded(duration = 8160) {
  mpv().set('duration', duration)
  mpv().fire('file-loaded')
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  db = openDb(':memory:')
  db.exec(`
    INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
    INSERT INTO tmdb_movies (tmdb_id, title, year, fetched_at) VALUES (603, 'The Matrix', 1999, 0);
    INSERT INTO tmdb_shows (tmdb_id, name, first_air_year, fetched_at) VALUES (1396, 'Breaking Bad', 2008, 0);
    INSERT INTO tmdb_episodes (show_tmdb_id, season, episode, name) VALUES (1396, 1, 1, 'Pilot'), (1396, 1, 2, 'Cat''s in the Bag...');
  `)
  const add = db.prepare(
    `INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, tmdb_id, kind, parsed_show, show_tmdb_id, season, episode, duration_s, added_at)
     VALUES (?, 1, ?, 1, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  )
  add.run(2, 'D:/L/matrix.mkv', 'The Matrix', 603, 'movie', null, null, null, null, 8160)
  for (const [id, s, e] of [[5, 1, 1], [6, 1, 2], [7, 2, 1], [9, 0, 1]] as const) {
    add.run(id, `D:/L/bb${id}.mkv`, 'Breaking Bad', null, 'episode', 'breaking bad', 1396, s, e, 3000)
  }
  trackList = TRACKS
  trackGate = null
  externals = []
  fakes = []
  events = []
  overlay = { show: vi.fn<() => void>(), hide: vi.fn<() => void>() }
  win = {
    full: false,
    setFullScreen(on) {
      this.full = on
    },
    isFullScreen() {
      return this.full
    }
  }
  gate = null
  failLaunch = false
  player = createPlayerService({
    db,
    launch: async () => {
      if (gate) await gate
      if (failLaunch) throw new Error('mpv would not start')
      const f = fakeMpv()
      fakes.push(f)
      return f.proc
    },
    emit: (event, payload) => events.push({ event, payload }),
    window: win,
    overlay,
    now: () => Date.now(),
    subtitles: {
      find: async () => externals,
      load: async (s) => s.path,
      userData: 'C:/data'
    },
    styles: createStyleStore(db, { now: () => 1, defaultLanguage: 'eng' })
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('play', () => {
  it("plays the title's main button: resumes a movie partway through", async () => {
    db.exec(`INSERT INTO playback_state (video_id, position_s, duration_s, last_played_at) VALUES (2, 600, 8160, 1)`)
    await player.play({ key: 'movie:2' })
    expect(sent('loadfile')).toEqual([['loadfile', 'D:/L/matrix.mkv', 'replace']])
    expect(overlay.show).toHaveBeenCalled()
    await loaded()
    expect(sent('seek')).toEqual([['seek', 600, 'absolute']])
    expect(mpv().commands).toContainEqual(['set_property', 'volume', 100])
    vi.advanceTimersByTime(50)
    const state = emitted('player.state').at(-1) as Record<string, unknown>
    expect(state).toMatchObject({ titleKey: 'movie:2', videoId: 2, heading: 'The Matrix', volume: 100 })
  })

  it('starts a finished video from 0 even when asked to resume, and never seeks for start', async () => {
    db.exec(`INSERT INTO playback_state (video_id, position_s, duration_s, completed, last_played_at) VALUES (2, 8100, 8160, 1, 1)`)
    await player.play({ key: 'movie:2', videoId: 2, from: 'resume' })
    await loaded()
    expect(sent('seek')).toEqual([])
    db.exec(`UPDATE playback_state SET position_s = 600, completed = 0`)
    await player.play({ key: 'movie:2', videoId: 2, from: 'start' })
    await loaded()
    expect(sent('seek')).toEqual([])
  })

  it('heads an episode with show, number and title', async () => {
    await player.play({ key: 'tmdb:1396', videoId: 6, from: 'start' })
    await loaded(3000)
    vi.advanceTimersByTime(50)
    expect((emitted('player.state').at(-1) as { heading: string }).heading).toBe("Breaking Bad · S1 E2 · Cat's in the Bag...")
  })

  it('applies remembered volume, audio and forced subtitles', async () => {
    savePrefs(db, 'movie:2', { volume: 150, audio: { lang: 'jpn', kind: 'plain', title: null } }, 1)
    await player.play({ key: 'movie:2' })
    await loaded()
    expect(mpv().commands).toContainEqual(['set_property', 'volume', 150])
    expect(mpv().commands).toContainEqual(['af', 'add', '@limiter:lavfi=[alimiter=limit=0.97]'])
    expect(mpv().commands).toContainEqual(['set_property', 'aid', 2])
    // Japanese audio and nothing remembered: English subtitles come on (milestone 5's Auto rule).
    expect(mpv().commands).toContainEqual(['set_property', 'sid', 1])
  })

  it('shows a forced track in the audio language when nothing is remembered', async () => {
    await player.play({ key: 'movie:2' })
    await loaded()
    expect(mpv().commands).toContainEqual(['set_property', 'sid', 2])
  })

  it('reuses the running mpv for the next file', async () => {
    await player.play({ key: 'tmdb:1396', videoId: 5, from: 'start' })
    await loaded(3000)
    await player.play({ key: 'tmdb:1396', videoId: 6, from: 'start' })
    expect(fakes).toHaveLength(1)
    expect(sent('loadfile').map((c) => c[1])).toEqual(['D:/L/bb5.mkv', 'D:/L/bb6.mkv'])
  })

  it('rejects an unknown title', async () => {
    await expect(player.play({ key: 'movie:999' })).rejects.toBeTruthy()
  })
})

describe('commands', () => {
  beforeEach(async () => {
    savePrefs(db, 'movie:2', { volume: 150 }, 1)
    await player.play({ key: 'movie:2' })
    await loaded()
  })

  it('removes the limiter at 100 % or below and remembers the volume for this title only', async () => {
    await player.command({ type: 'volume', value: 90 })
    expect(mpv().commands).toContainEqual(['af', 'remove', '@limiter'])
    expect(mpv().commands).toContainEqual(['set_property', 'volume', 90])
    expect(getPrefs(db, 'movie:2').volume).toBe(90)
    expect(getPrefs(db, 'tmdb:1396').volume).toBe(100)
  })

  it('clamps volume to 0–200', async () => {
    await player.command({ type: 'volume', value: 260 })
    expect(mpv().commands).toContainEqual(['set_property', 'volume', 200])
    await player.command({ type: 'volume', value: -5 })
    expect(mpv().commands).toContainEqual(['set_property', 'volume', 0])
  })

  it('remembers an audio choice by language and kind', async () => {
    await player.command({ type: 'audio', id: 2 })
    expect(mpv().commands).toContainEqual(['set_property', 'aid', 2])
    expect(getPrefs(db, 'movie:2').audio).toEqual({ lang: 'jpn', kind: 'plain', title: null })
  })

  it("remembers Off when it hides a forced track", async () => {
    mpv().set('sid', 2)
    await player.command({ type: 'subtitle', id: null })
    expect(mpv().commands).toContainEqual(['set_property', 'sid', 'no'])
    expect(getPrefs(db, 'movie:2').subtitle).toBe('off')
  })

  it('passes pause, seek, mute and full screen through', async () => {
    await player.command({ type: 'pause', paused: true })
    await player.command({ type: 'seek', toS: 30 })
    await player.command({ type: 'seekBy', s: -10 })
    await player.command({ type: 'mute', muted: true })
    await player.command({ type: 'fullScreen', on: true })
    expect(mpv().commands).toEqual(
      expect.arrayContaining([
        ['set_property', 'pause', true],
        ['seek', 30, 'absolute'],
        ['seek', -10, 'relative'],
        ['set_property', 'mute', true]
      ])
    )
    expect(win.full).toBe(true)
  })
})

describe('resume saving', () => {
  beforeEach(async () => {
    await player.play({ key: 'movie:2', from: 'start' })
    await loaded()
  })

  it('saves every 10 s while playing', () => {
    for (let s = 1; s <= 9; s++) {
      vi.advanceTimersByTime(1000)
      mpv().set('time-pos', s)
    }
    expect(pb(2)).toEqual({})
    vi.advanceTimersByTime(1000)
    mpv().set('time-pos', 10)
    expect(pb(2)['position_s']).toBe(10)
  })

  it('saves on pause, after a seek and on stop', async () => {
    mpv().set('time-pos', 12)
    mpv().set('pause', true)
    expect(pb(2)['position_s']).toBe(12)
    mpv().set('time-pos', 40)
    mpv().fire('playback-restart')
    expect(pb(2)['position_s']).toBe(40)
    mpv().set('time-pos', 41)
    await player.stop({})
    expect(pb(2)['position_s']).toBe(41)
  })

  it('throttles player.state to 30 per second', () => {
    const before = emitted('player.state').length
    for (let i = 0; i < 100; i++) {
      vi.advanceTimersByTime(10)
      mpv().set('time-pos', i / 100)
    }
    expect(emitted('player.state').length - before).toBeLessThanOrEqual(31)
  })
})

describe('end of file', () => {
  it('saves an episode as finished and offers the next one', async () => {
    await player.play({ key: 'tmdb:1396', videoId: 5, from: 'start' })
    await loaded(3000)
    mpv().set('time-pos', 2999)
    mpv().set('eof-reached', true)
    await flush()
    expect(pb(5)['completed']).toBe(1)
    expect(emitted('player.ended')).toEqual([
      { next: { videoId: 6, season: 1, episode: 2, title: "Cat's in the Bag...", stillUrl: 'poster://still/video/6?v=t1396' } }
    ])
    expect(emitted('player.closed')).toEqual([])
  })

  it('closes to the title page after a movie, the last episode or a Special', async () => {
    for (const [key, videoId] of [['movie:2', 2], ['tmdb:1396', 7], ['tmdb:1396', 9]] as const) {
      events = []
      await player.play({ key, videoId, from: 'start' })
      await loaded(3000)
      mpv().set('eof-reached', true)
      await flush()
      expect(emitted('player.closed')).toEqual([{ titleKey: key }])
      expect(mpv().quit).toHaveBeenCalled()
    }
    expect(overlay.hide).toHaveBeenCalledTimes(3)
  })

  it("reports Can't play this file when mpv fails to open it", async () => {
    await player.play({ key: 'movie:2' })
    mpv().fire('end-file', { reason: 'error', file_error: 'unrecognized file format' })
    await flush()
    expect(emitted('player.error')).toEqual([{ message: "Can't play this file" }])
  })
})

describe('crashes and stopping', () => {
  it('respawns once at the last position with tracks and volume restored', async () => {
    savePrefs(db, 'movie:2', { volume: 130 }, 1)
    await player.play({ key: 'movie:2', from: 'start' })
    await loaded()
    mpv().set('time-pos', 321)
    mpv().set('aid', 2)
    mpv().set('sid', 1)
    mpv().crash()
    await flush()
    expect(fakes).toHaveLength(2)
    expect(pb(2)['position_s']).toBe(321)
    await loaded()
    expect(sent('loadfile')).toEqual([['loadfile', 'D:/L/matrix.mkv', 'replace']])
    expect(mpv().commands).toEqual(
      expect.arrayContaining([['seek', 321, 'absolute'], ['set_property', 'aid', 2], ['set_property', 'sid', 1], ['set_property', 'volume', 130]])
    )
    mpv().crash()
    await flush()
    expect(fakes).toHaveLength(2)
    expect(emitted('player.error')).toEqual([{ message: "Can't play this file" }])
  })

  it('stop leaves full screen, closes once and reports the title', async () => {
    await player.play({ key: 'movie:2' })
    await loaded()
    await player.command({ type: 'fullScreen', on: true })
    await Promise.all([player.stop({}), player.stop({})])
    expect(win.full).toBe(false)
    expect(mpv().quit).toHaveBeenCalledTimes(1)
    expect(overlay.hide).toHaveBeenCalledTimes(1)
    expect(emitted('player.closed')).toEqual([{ titleKey: 'movie:2' }])
  })

  it('shutdown saves the position and quits mpv', async () => {
    await player.play({ key: 'movie:2', from: 'start' })
    await loaded()
    mpv().set('time-pos', 77)
    await player.shutdown()
    expect(pb(2)['position_s']).toBe(77)
    expect(mpv().quit).toHaveBeenCalled()
  })
})

describe('overlapping calls (mid-branch review)', () => {
  it('stop while mpv is launching quits it and stays closed', async () => {
    const g = deferred()
    gate = g.promise
    const playing = player.play({ key: 'movie:2' }).catch(() => {})
    await flush()
    await player.stop({})
    g.resolve()
    await playing
    await flush()
    expect(fakes).toHaveLength(1)
    expect(mpv().quit).toHaveBeenCalled()
    expect(overlay.show).not.toHaveBeenCalled()
    expect(sent('loadfile')).toEqual([])
  })

  it('two plays at once start one mpv and play the later file', async () => {
    const g = deferred()
    gate = g.promise
    const a = player.play({ key: 'tmdb:1396', videoId: 5, from: 'start' })
    const b = player.play({ key: 'tmdb:1396', videoId: 6, from: 'start' })
    g.resolve()
    await Promise.all([a, b])
    expect(fakes).toHaveLength(1)
    expect(sent('loadfile').at(-1)).toEqual(['loadfile', 'D:/L/bb6.mkv', 'replace'])
  })

  it('play during a closing stop keeps the new session', async () => {
    await player.play({ key: 'movie:2', from: 'start' })
    await loaded()
    const slow = deferred()
    mpv().quit.mockImplementation(() => slow.promise)
    const stopping = player.stop({})
    const playing = player.play({ key: 'tmdb:1396', videoId: 5, from: 'start' })
    slow.resolve()
    await Promise.all([stopping, playing])
    expect(emitted('player.closed')).toEqual([{ titleKey: 'movie:2' }])
    expect(overlay.show.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(overlay.hide.mock.invocationCallOrder.at(-1)!)
    await player.stop({})
    expect(emitted('player.closed')).toEqual([{ titleKey: 'movie:2' }, { titleKey: 'tmdb:1396' }])
  })

  it('unpauses when the next file starts', async () => {
    await player.play({ key: 'tmdb:1396', videoId: 5, from: 'start' })
    await loaded(3000)
    mpv().set('pause', true)
    await player.play({ key: 'tmdb:1396', videoId: 6, from: 'start' })
    expect(mpv().commands.at(-1)).toEqual(['set_property', 'pause', false])
  })
})

describe('resume point safety (mid-branch review)', () => {
  it('does not save over a resume point before the resume seek lands', async () => {
    db.exec(`INSERT INTO playback_state (video_id, position_s, duration_s, last_played_at) VALUES (2, 600, 8160, 1)`)
    await player.play({ key: 'movie:2' })
    await loaded()
    mpv().set('time-pos', 0)
    mpv().fire('playback-restart')
    mpv().set('pause', true)
    expect(pb(2)['position_s']).toBe(600)
    mpv().set('pause', false)
    mpv().fire('seek')
    mpv().set('time-pos', 600.5)
    mpv().fire('playback-restart')
    expect(pb(2)['position_s']).toBe(600.5)
  })

  it('a stop before the seek lands keeps the resume point', async () => {
    db.exec(`INSERT INTO playback_state (video_id, position_s, duration_s, last_played_at) VALUES (2, 600, 8160, 1)`)
    await player.play({ key: 'movie:2' })
    await loaded()
    mpv().set('time-pos', 0)
    await player.stop({})
    expect(pb(2)['position_s']).toBe(600)
  })
})

describe('failures and library refresh (mid-branch review)', () => {
  it("reports Can't play this file when the respawn cannot start mpv", async () => {
    await player.play({ key: 'movie:2', from: 'start' })
    await loaded()
    failLaunch = true
    mpv().crash()
    await flush()
    expect(emitted('player.error')).toEqual([{ message: "Can't play this file" }])
  })

  it('tells the library after saving on stop and at the end of a file', async () => {
    await player.play({ key: 'tmdb:1396', videoId: 5, from: 'start' })
    await loaded(3000)
    mpv().set('eof-reached', true)
    await flush()
    expect(emitted('library.changed')).toHaveLength(1)
    await player.stop({})
    expect(emitted('library.changed')).toHaveLength(2)
  })
})

describe('subtitles (milestone 5)', () => {
  const srt = (lang: string, kind: ExternalSub['kind'] = 'plain'): ExternalSub => ({ path: `D:/L/matrix.${lang}.srt`, lang, kind, format: 'srt' })
  const cues = () => emitted('subtitles.cue')

  it('adds subtitle files before reading the tracks and turns one in your language on', async () => {
    externals = [srt('eng')]
    await player.play({ key: 'movie:2' })
    await loaded()
    const cmds = mpv().commands.map((c) => c[0] + ' ' + String(c[1]))
    expect(mpv().commands).toContainEqual(['sub-add', 'D:/L/matrix.eng.srt', 'auto', 'matrix.eng.srt', 'eng'])
    expect(cmds.indexOf('sub-add D:/L/matrix.eng.srt')).toBeLessThan(cmds.lastIndexOf('get_property track-list'))
    expect(mpv().commands).toContainEqual(['set_property', 'sid', 3])
    expect(mpv().commands).toContainEqual(['set_property', 'sub-visibility', false])
    vi.advanceTimersByTime(50)
    const subs = (emitted('player.state').at(-1) as { subtitles: { id: number; external: boolean; fileName: string | null }[] }).subtitles
    expect(subs.at(-1)).toMatchObject({ id: 3, external: true, fileName: 'matrix.eng.srt' })
  })

  it('looks for subtitles with the episode numbers and the download folder', async () => {
    const find = vi.fn(async () => [])
    player = createPlayerService({
      db, launch: async () => (fakes.push(fakeMpv()), mpv().proc), emit: (event, payload) => events.push({ event, payload }),
      window: win, overlay, now: () => Date.now(),
      subtitles: { find, load: async (s) => s.path, userData: 'C:/data' },
      styles: createStyleStore(db, { now: () => 1, defaultLanguage: 'fre' })
    })
    await player.play({ key: 'tmdb:1396', videoId: 6, from: 'start' })
    await loaded(3000)
    expect(find).toHaveBeenCalledWith({ path: 'D:/L/bb6.mkv', season: 1, episode: 2 }, { userLang: 'fre', extraDirs: [join('C:/data', 'subtitles', '6')] })
  })

  it('sends the current line to the overlay as a cue, and clears it between files and on stop', async () => {
    await player.play({ key: 'tmdb:1396', videoId: 5, from: 'start' })
    await loaded(3000)
    mpv().set('sub-text/ass', '{\\i1}Say my name{\\i0}')
    expect(cues().at(-1)).toEqual({ top: false, lines: [[{ text: 'Say my name', italic: true, bold: false }]] })
    mpv().set('sub-text/ass', '')
    expect(cues().at(-1)).toBeNull()
    mpv().set('sub-text/ass', 'Still here')
    await player.play({ key: 'tmdb:1396', videoId: 6, from: 'start' })
    expect(cues().at(-1)).toBeNull()
    // A late line from the old file, before the new one has loaded, is not shown.
    mpv().set('sub-text/ass', 'Old line')
    expect(cues().at(-1)).toBeNull()
    await loaded(3000)
    mpv().set('sub-text/ass', 'New line')
    expect(cues().at(-1)).toMatchObject({ lines: [[{ text: 'New line' }]] })
    await player.stop({})
    expect(cues().at(-1)).toBeNull()
  })

  it('lets mpv draw picture subtitles and hides its drawing again for text ones', async () => {
    trackList = [...TRACKS, { id: 3, type: 'sub', lang: 'fre', codec: 'hdmv_pgs_subtitle' }]
    await player.play({ key: 'movie:2' })
    await loaded()
    await player.command({ type: 'subtitle', id: 3 })
    expect(mpv().commands.at(-1)).toEqual(['set_property', 'sub-visibility', true])
    await player.command({ type: 'subtitle', id: 1 })
    expect(mpv().commands.at(-1)).toEqual(['set_property', 'sub-visibility', false])
  })

  it('clears the line when the subtitle track changes', async () => {
    await player.play({ key: 'movie:2' })
    await loaded()
    mpv().set('sub-text/ass', 'Wake up')
    await player.command({ type: 'subtitle', id: 1 })
    expect(cues().at(-1)).toBeNull()
  })

  it('remembers Off when it hides a subtitle file the app turned on', async () => {
    externals = [srt('eng')]
    await player.play({ key: 'movie:2' })
    await loaded()
    mpv().set('sid', 3)
    await player.command({ type: 'subtitle', id: null })
    expect(getPrefs(db, 'movie:2').subtitle).toBe('off')
  })

  it('uses the TMDB original language for audio with no language tag', async () => {
    trackList = [
      { id: 1, type: 'audio', codec: 'aac' },
      { id: 1, type: 'sub', lang: 'eng', codec: 'subrip' }
    ]
    db.exec(`UPDATE tmdb_movies SET original_language = 'ja' WHERE tmdb_id = 603`)
    await player.play({ key: 'movie:2' })
    await loaded()
    expect(mpv().commands).toContainEqual(['set_property', 'sid', 1])
  })

  it('sends the title’s effective style on play and when asked', async () => {
    const styles = createStyleStore(db, { now: () => 1, defaultLanguage: 'eng' })
    styles.setOverrides('movie:2', { size: 150 })
    await player.play({ key: 'movie:2' })
    expect(emitted('subtitles.style').at(-1)).toMatchObject({ size: 150 })
    styles.setOverrides('movie:2', { size: 120 })
    player.notifyStyle()
    expect(emitted('subtitles.style').at(-1)).toMatchObject({ size: 120 })
    expect(player.current()).toEqual({ videoId: 2, titleKey: 'movie:2', path: 'D:/L/matrix.mkv' })
  })

  it('adds a downloaded subtitle, shows it and remembers it', async () => {
    await player.play({ key: 'movie:2' })
    await loaded()
    await player.addSubtitle({ path: 'D:/L/matrix.en.srt', lang: 'eng', kind: 'sdh', format: 'srt' })
    expect(mpv().commands).toContainEqual(['sub-add', 'D:/L/matrix.en.srt', 'select', 'matrix.en.srt', 'eng'])
    expect(getPrefs(db, 'movie:2').subtitle).toEqual({ lang: 'eng', kind: 'sdh', title: 'matrix.en.srt' })
  })

  it('a subtitle downloaded while the file is still being set up is not replaced by the automatic pick', async () => {
    // The order the e2e run showed: the file's own subtitle is added and the track
    // list requested; the download is added before that list comes back.
    externals = [srt('eng')]
    let release!: () => void
    trackGate = new Promise<void>((r) => (release = r))
    await player.play({ key: 'movie:2' })
    mpv().fire('file-loaded')
    await flush()
    expect(sent('sub-add')).toHaveLength(1)
    const adding = player.addSubtitle({ path: 'D:/L/matrix.en.2.srt', lang: 'eng', kind: 'plain', format: 'srt' })
    await flush()
    release()
    trackGate = null
    await adding
    await flush()
    const lastSid = sent('set_property').filter((c) => c[1] === 'sid').at(-1)
    const downloaded = (emitted('player.state').at(-1) as { subtitles: { id: number; fileName: string | null }[] }).subtitles.find(
      (t) => t.fileName === 'matrix.en.2.srt'
    )
    expect(downloaded).toBeTruthy()
    expect(lastSid).toEqual(['set_property', 'sid', downloaded!.id])
  })

  it('shows no line until the subtitle pick is made, so a remembered Off never flashes (review)', async () => {
    savePrefs(db, 'movie:2', { subtitle: 'off' }, 1)
    let release!: () => void
    trackGate = new Promise<void>((r) => (release = r))
    await player.play({ key: 'movie:2' })
    mpv().fire('file-loaded')
    await flush()
    // mpv's own default track speaks while the file is still being set up.
    mpv().set('sub-text/ass', 'Default track line')
    expect(cues().filter((c) => c !== null)).toEqual([])
    release()
    trackGate = null
    await flush()
    mpv().set('sub-text/ass', 'After the pick')
    expect(cues().at(-1)).toMatchObject({ lines: [[{ text: 'After the pick' }]] })
  })

  it('after an mpv crash, brings back the same subtitle file even if the ids moved (review)', async () => {
    const fr: ExternalSub = { path: 'D:/L/matrix.fr.srt', lang: 'fre', kind: 'plain', format: 'srt' }
    const en: ExternalSub = { path: 'D:/L/matrix.en.srt', lang: 'eng', kind: 'plain', format: 'srt' }
    externals = [fr, en]
    await player.play({ key: 'movie:2', from: 'start' })
    await loaded()
    await player.command({ type: 'subtitle', id: 4 }) // matrix.en.srt
    mpv().set('sid', 4)
    externals = [en, fr]
    mpv().crash()
    await flush()
    await loaded()
    // After the respawn English is id 3.
    expect(sent('set_property').filter((c) => c[1] === 'sid').at(-1)).toEqual(['set_property', 'sid', 3])
  })
})
