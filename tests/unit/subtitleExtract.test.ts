import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractSubtitle } from '../../src/main/subtitles/extract'
import { readSubtitleFile } from '../../src/main/subtitles/parse'

const FFMPEG = join('vendor', 'ffmpeg', 'ffmpeg.exe')
const FFPROBE = join('vendor', 'ffmpeg', 'ffprobe.exe')
const VIDEO = join('tests', 'fixtures', 'media', 'tracks.mkv')
const ready = existsSync(FFMPEG) && existsSync(FFPROBE) && existsSync(VIDEO)

let cacheDir: string
beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'vp-extract-'))
})
afterEach(() => rmSync(cacheDir, { recursive: true, force: true }))

// The stream index of the first subtitle in the fixture, as mpv reports it (ff-index).
const subIndex = (): number =>
  Number(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 's:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', VIDEO]).toString().trim())

describe.skipIf(!ready)('extractSubtitle (vendor ffmpeg; run make-fixtures and fetch-vendor first)', () => {
  it('extracts the embedded subtitle of tracks.mkv', async () => {
    const path = await extractSubtitle({ ffmpegPath: FFMPEG, video: VIDEO, ffIndex: subIndex(), codec: 'subrip', cacheDir })
    expect(path.endsWith('.srt')).toBe(true)
    expect(await readSubtitleFile(path, null)).toEqual([{ start: 1, end: 19, lines: ['Hello there.'], italic: false, top: false }])
  })

  it('reuses the cached file on a second call', async () => {
    const opts = { ffmpegPath: FFMPEG, video: VIDEO, ffIndex: subIndex(), codec: 'subrip', cacheDir }
    const a = await extractSubtitle(opts)
    const before = statSync(a).mtimeMs
    const b = await extractSubtitle(opts)
    expect(b).toBe(a)
    expect(statSync(b).mtimeMs).toBe(before)
  })

  it('an aborted extraction rejects and leaves nothing in the cache', async () => {
    const ac = new AbortController()
    const p = extractSubtitle({ ffmpegPath: FFMPEG, video: VIDEO, ffIndex: subIndex(), codec: 'subrip', cacheDir, signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toThrow()
    expect(readdirSync(cacheDir)).toEqual([])
  })
})
