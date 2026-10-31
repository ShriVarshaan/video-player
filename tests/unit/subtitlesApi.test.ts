import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/player'
import { openDb, type Db } from '../../src/main/db'
import type { PlayerService } from '../../src/main/player/service'
import type { ParsedCue } from '../../src/main/subtitles/parse'
import { createSubtitlesApi } from '../../src/main/subtitles/setup'
import { createStyleStore } from '../../src/main/subtitles/styleStore'
import { getOffset, setOffset, subtitleKeyForFile } from '../../src/main/subtitles/transforms'

let dir: string
let db: Db
let player: Partial<PlayerService> & { addSubtitle: ReturnType<typeof vi.fn> }
let api: ReturnType<typeof createSubtitlesApi>

const track: Track = {
  id: 3, type: 'sub', label: 'English', lang: 'eng', kind: 'plain', title: null, image: false, default: false,
  external: true, fileName: 'Movie.en.srt', key: 'file:x', codec: 'subrip', synced: false
}
const cues: ParsedCue[] = [
  { start: 1, end: 4, lines: ['Wake up,', 'Neo.'], italic: false, top: false },
  { start: 5, end: 8, lines: ['Follow the white rabbit.'], italic: true, top: false }
]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-subapi-'))
  db = openDb(':memory:')
  db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, added_at) VALUES (2, 1, 'x', 1, 0, 0, 'M', 0)`)
  player = {
    currentSubtitle: () => ({ videoId: 2, videoPath: join(dir, 'Movie.mkv'), track, offset: 2 }),
    subtitleCues: async () => cues,
    nudgeSubtitle: vi.fn(async (d: number) => 2 + d),
    syncSubtitleTo: vi.fn(async (s: number) => 9 - s),
    resetSubtitleTiming: vi.fn(async () => {}),
    addSubtitle: vi.fn(async () => {}),
    current: () => ({ videoId: 2, titleKey: 'movie:2', path: join(dir, 'Movie.mkv') })
  }
  api = createSubtitlesApi({
    db,
    styles: createStyleStore(db, { now: () => 1, defaultLanguage: 'eng' }),
    player: player as unknown as PlayerService,
    os: {} as never,
    account: { get: () => null, set: () => {} } as never,
    userDataPath: join(dir, 'data')
  })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('nudge', () => {
  it('moves the showing subtitle', async () => {
    expect(await api.nudge({ deltaS: 0.05 })).toEqual({ offset: 2.05 })
  })
  it('rejects nonsense', async () => {
    await expect(api.nudge({ deltaS: Number.NaN })).rejects.toThrow()
    await expect(api.nudge({ deltaS: 1e6 })).rejects.toThrow()
  })
})

describe('syncCues and syncToCue', () => {
  it('sends each line with its start', async () => {
    expect(await api.syncCues({})).toEqual({
      cues: [
        { start: 1, text: 'Wake up,\nNeo.' },
        { start: 5, text: 'Follow the white rabbit.' }
      ],
      offset: 2,
      key: 'file:x'
    })
  })
  it('syncs to a cue start', async () => {
    expect(await api.syncToCue({ start: 5, key: 'file:x' })).toEqual({ offset: 4 })
    await expect(api.syncToCue({ start: Number.NaN, key: 'file:x' })).rejects.toThrow()
  })
  it('says when nothing is showing', async () => {
    player.currentSubtitle = () => null
    await expect(api.syncCues({})).rejects.toThrow('Choose a subtitle first.')
  })
})

describe('exportSynced', () => {
  it('asks first when the synced file is there, and writes nothing', async () => {
    writeFileSync(join(dir, 'Movie.en.synced.srt'), 'old')
    expect(await api.exportSynced({ replace: false, key: 'file:x' })).toEqual({ exists: 'Movie.en.synced.srt' })
    expect(readFileSync(join(dir, 'Movie.en.synced.srt'), 'utf8')).toBe('old')
    expect(player.addSubtitle).not.toHaveBeenCalled()
  })

  it('writes, clears the new file’s stored offset and shows it without remembering it', async () => {
    const saved = join(dir, 'Movie.en.synced.srt')
    setOffset(db, 2, subtitleKeyForFile(saved), 3, 0)
    expect(await api.exportSynced({ replace: true, key: 'file:x' })).toEqual({ saved: 'Movie.en.synced.srt', fallback: false })
    expect(readFileSync(saved, 'utf8')).toContain('00:00:03,000 --> 00:00:06,000')
    expect(getOffset(db, 2, subtitleKeyForFile(saved))).toBe(0)
    expect(player.addSubtitle).toHaveBeenCalledWith({ path: saved, lang: 'eng', kind: 'plain', format: 'srt', synced: true }, { remember: false })
  })

  it('refuses a picture subtitle', async () => {
    player.currentSubtitle = () => ({ videoId: 2, videoPath: join(dir, 'Movie.mkv'), track: { ...track, image: true }, offset: 0 })
    await expect(api.exportSynced({ replace: false, key: 'file:x' })).rejects.toThrow('Sync to a line needs a text subtitle')
  })
})

describe('review fixes', () => {
  it('syncCues names the track; syncToCue and export refuse another track', async () => {
    expect((await api.syncCues({})).key).toBe('file:x')
    await expect(api.syncToCue({ start: 5, key: 'file:other' })).rejects.toThrow('The subtitle changed')
    await expect(api.exportSynced({ replace: true, key: 'file:other' })).rejects.toThrow('The subtitle changed')
    expect(player.addSubtitle).not.toHaveBeenCalled()
    expect(await api.syncToCue({ start: 5, key: 'file:x' })).toEqual({ offset: 4 })
  })

  it('names the synced file from a normalised language tag', async () => {
    player.currentSubtitle = () => ({ videoId: 2, videoPath: join(dir, 'Movie.mkv'), track: { ...track, lang: 'English' }, offset: 0 })
    expect(await api.exportSynced({ replace: false, key: 'file:x' })).toEqual({ saved: 'Movie.en.synced.srt', fallback: false })
  })

  it('never lets a language tag lead outside the folder', async () => {
    player.currentSubtitle = () => ({ videoId: 2, videoPath: join(dir, 'Movie.mkv'), track: { ...track, lang: '..\\..\\evil' }, offset: 0 })
    expect(await api.exportSynced({ replace: false, key: 'file:x' })).toEqual({ saved: 'Movie.synced.srt', fallback: false })
  })
})
