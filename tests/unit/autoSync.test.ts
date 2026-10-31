import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/player'
import { parseAppError } from '@shared/appError'
import { openDb, type Db } from '../../src/main/db'
import type { ParsedCue } from '../../src/main/subtitles/parse'
import { getOffset, setOffset, subtitleKeyForFile } from '../../src/main/subtitles/transforms'
import { createAutoSync } from '../../src/main/sync/autoSync'
import { SidecarError, type Sidecar, type SyncMeasure, type SyncParams, type SyncProgress } from '../../src/main/sync/sidecar'

let dir: string
let temp: string
let db: Db
let showing: { videoId: number; videoPath: string; track: Track; offset: number } | null
let audio: { audioStream: number | null; durationS: number | null } | null
let player: {
  currentSubtitle: () => typeof showing
  currentAudio: () => typeof audio
  subtitleCues: () => Promise<ParsedCue[]>
  current: () => { videoId: number; titleKey: string; path: string } | null
  addSubtitle: ReturnType<typeof vi.fn>
  resetSubtitleTiming: ReturnType<typeof vi.fn>
}
let sidecar: Sidecar & { calls: SyncParams[]; seenText: string[]; answer: (p: SyncParams, on: (p: SyncProgress) => void) => Promise<SyncMeasure> }
let emitted: unknown[]

const track = (extra: Partial<Track> = {}): Track => ({
  id: 3, type: 'sub', label: 'English', lang: 'eng', kind: 'plain', title: null, image: false, default: false,
  external: true, fileName: 'Movie.en.srt', key: 'file:x', codec: 'subrip', synced: false, ...extra
})
const cues: ParsedCue[] = [{ start: 10, end: 12, lines: ['Wake up, Neo.'], italic: false, top: false }]

function make() {
  return createAutoSync({ player: player as never, sidecar, db, userDataPath: join(dir, 'data'), tempDir: temp, emit: (p) => emitted.push(p) })
}

async function appCode(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return parseAppError(e)
  }
  throw new Error('expected a rejection')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-autosync-'))
  temp = join(dir, 'tmp')
  mkdirSync(temp)
  db = openDb(':memory:')
  db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, added_at) VALUES (2, 1, 'x', 1, 0, 0, 'M', 0)`)
  showing = { videoId: 2, videoPath: join(dir, 'Movie.mkv'), track: track(), offset: 1.5 }
  audio = { audioStream: 1, durationS: 600 }
  emitted = []
  player = {
    currentSubtitle: () => showing,
    currentAudio: () => audio,
    subtitleCues: async () => cues,
    current: () => (showing ? { videoId: showing.videoId, titleKey: 'movie:2', path: showing.videoPath } : null),
    addSubtitle: vi.fn(async () => {}),
    resetSubtitleTiming: vi.fn(async () => {})
  }
  const s = {
    calls: [] as SyncParams[],
    seenText: [] as string[],
    answer: async (_p: SyncParams, _on: (p: SyncProgress) => void): Promise<SyncMeasure> => ({ offset: -3.2, scale: 1, score: 13 }),
    sync(p: SyncParams, on: (p: SyncProgress) => void) {
      s.calls.push(p)
      s.seenText.push(readFileSync(p.subtitle, 'utf8'))
      return s.answer(p, on)
    },
    cancel: vi.fn(),
    dispose: vi.fn()
  }
  sidecar = s
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('createAutoSync', () => {
  it('writes the source cues at original timing to a temp SRT', async () => {
    await make().start('file:x')
    expect(sidecar.calls[0]).toMatchObject({ video: join(dir, 'Movie.mkv'), audioStream: 1, durationS: 600 })
    expect(sidecar.seenText[0]).toBe('1\r\n00:00:10,000 --> 00:00:12,000\r\nWake up, Neo.\r\n\r\n')
    expect(readdirSync(temp)).toEqual([])
  })

  it('synced: exports with the transform, clears the new file offset, adds the track', async () => {
    const out = await make().start('file:x')
    const saved = join(dir, 'Movie.en.synced.srt')
    expect(out).toEqual({ status: 'synced', offset: -3.2, scale: 1, saved: 'Movie.en.synced.srt', fallback: false })
    expect(readFileSync(saved, 'utf8')).toContain('00:00:06,800 --> 00:00:08,800')
    expect(player.addSubtitle).toHaveBeenCalledWith({ path: saved, lang: 'eng', kind: 'plain', format: 'srt', synced: true }, { remember: false })
  })

  it('a fresh synced file starts with no offset of its own', async () => {
    const saved = join(dir, 'Movie.en.synced.srt')
    setOffset(db, 2, subtitleKeyForFile(saved), 4, 0)
    await make().start('file:x')
    expect(getOffset(db, 2, subtitleKeyForFile(saved))).toBe(0)
  })

  it('in sync with a stored offset clears it', async () => {
    sidecar.answer = async () => ({ offset: 0.02, scale: 1, score: 13 })
    expect(await make().start('file:x')).toEqual({ status: 'inSync', clearedOffset: true })
    expect(player.resetSubtitleTiming).toHaveBeenCalled()
    expect(existsSync(join(dir, 'Movie.en.synced.srt'))).toBe(false)
  })

  it('in sync with no stored offset writes and clears nothing', async () => {
    showing = { ...showing!, offset: 0 }
    sidecar.answer = async () => ({ offset: -0.01, scale: 1, score: 13 })
    expect(await make().start('file:x')).toEqual({ status: 'inSync', clearedOffset: false })
    expect(player.resetSubtitleTiming).not.toHaveBeenCalled()
  })

  it('a speed change alone is not "in sync"', async () => {
    sidecar.answer = async () => ({ offset: 0, scale: 25 / 23.976, score: 13 })
    expect((await make().start('file:x')).status).toBe('synced')
  })

  it('exists holds the result; replace writes it without calling the sidecar again', async () => {
    writeFileSync(join(dir, 'Movie.en.synced.srt'), 'old')
    const auto = make()
    expect(await auto.start('file:x')).toEqual({ status: 'exists', offset: -3.2, scale: 1, name: 'Movie.en.synced.srt' })
    expect(readFileSync(join(dir, 'Movie.en.synced.srt'), 'utf8')).toBe('old')
    const out = await auto.replace('file:x')
    expect(out).toMatchObject({ status: 'synced', saved: 'Movie.en.synced.srt' })
    expect(sidecar.calls).toHaveLength(1)
    expect(readFileSync(join(dir, 'Movie.en.synced.srt'), 'utf8')).toContain('00:00:06,800')
    expect(player.addSubtitle).toHaveBeenCalledTimes(1)
  })

  it('replace for another key or with nothing pending refuses', async () => {
    const auto = make()
    expect((await appCode(auto.replace('file:x')))?.code).toBe('invalid_argument')
    writeFileSync(join(dir, 'Movie.en.synced.srt'), 'old')
    await auto.start('file:x')
    showing = { ...showing!, track: track({ key: 'file:y' }) }
    expect((await appCode(auto.replace('file:y')))?.code).toBe('invalid_argument')
    expect(readFileSync(join(dir, 'Movie.en.synced.srt'), 'utf8')).toBe('old')
  })

  it('a new start drops any pending result', async () => {
    writeFileSync(join(dir, 'Movie.en.synced.srt'), 'old')
    const auto = make()
    await auto.start('file:x')
    sidecar.answer = async () => {
      throw new SidecarError('NO_MATCH', 'no')
    }
    expect(await auto.start('file:x')).toEqual({ status: 'noMatch' })
    expect((await appCode(auto.replace('file:x')))?.code).toBe('invalid_argument')
  })

  it('a result for a subtitle no longer showing writes nothing', async () => {
    sidecar.answer = async () => {
      showing = { ...showing!, track: track({ id: 4, key: 'file:other' }) }
      return { offset: -3.2, scale: 1, score: 13 }
    }
    expect(await make().start('file:x')).toEqual({ status: 'cancelled' })
    expect(existsSync(join(dir, 'Movie.en.synced.srt'))).toBe(false)
    expect(player.addSubtitle).not.toHaveBeenCalled()
  })

  it('a result after the player closed writes nothing', async () => {
    sidecar.answer = async () => {
      showing = null
      return { offset: -3.2, scale: 1, score: 13 }
    }
    expect(await make().start('file:x')).toEqual({ status: 'cancelled' })
    expect(existsSync(join(dir, 'Movie.en.synced.srt'))).toBe(false)
  })

  it('maps sidecar codes', async () => {
    const cases: [string, unknown][] = [
      ['NO_MATCH', { status: 'noMatch' }],
      ['CANCELLED', { status: 'cancelled' }]
    ]
    for (const [code, want] of cases) {
      sidecar.answer = async () => {
        throw new SidecarError(code as never, code)
      }
      expect(await make().start('file:x')).toEqual(want)
    }
    for (const [code, want] of <[string, string][]>[
      ['NO_AUDIO', 'sync_no_audio'],
      ['UNAVAILABLE', 'sync_unavailable'],
      ['INTERNAL', 'sync_unavailable'],
      ['FFMPEG_FAILED', 'sync_unavailable']
    ]) {
      sidecar.answer = async () => {
        throw new SidecarError(code as never, code)
      }
      expect((await appCode(make().start('file:x')))?.code).toBe(want)
    }
  })

  it('no audio track refuses before calling the sidecar', async () => {
    audio = { audioStream: null, durationS: 600 }
    const e = await appCode(make().start('file:x'))
    expect(e?.code).toBe('sync_no_audio')
    expect(e?.message).toBe('This video has no audio to sync to')
    expect(sidecar.calls).toHaveLength(0)
  })

  it('picture subtitle refuses', async () => {
    showing = { ...showing!, track: track({ image: true, codec: 'hdmv_pgs_subtitle' }) }
    expect((await appCode(make().start('file:x')))?.message).toBe("Picture subtitles can't be auto-synced")
  })

  it('another subtitle than the one asked for refuses', async () => {
    expect((await appCode(make().start('file:zzz')))?.code).toBe('invalid_argument')
  })

  it('progress is emitted with the key', async () => {
    sidecar.answer = async (_p, on) => {
      on({ stage: 'audio', pct: 0.5 })
      on({ stage: 'match', pct: null })
      return { offset: -3.2, scale: 1, score: 13 }
    }
    await make().start('file:x')
    expect(emitted).toEqual([
      { key: 'file:x', stage: 'audio', pct: 0.5 },
      { key: 'file:x', stage: 'match', pct: null }
    ])
  })

  it('cancel asks the sidecar to stop', () => {
    make().cancel()
    expect(sidecar.cancel).toHaveBeenCalled()
  })
})
