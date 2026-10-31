import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportSynced, syncedName } from '../../src/main/subtitles/export'
import { readSubtitleFile, type ParsedCue } from '../../src/main/subtitles/parse'

let dir: string
let fallbackDir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-export-'))
  fallbackDir = join(dir, 'fallback')
})
afterEach(() => {
  if (process.platform === 'win32') {
    try {
      execFileSync('icacls', [dir, '/reset', '/T', '/Q'])
    } catch {
      // nothing to undo
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

const cues: ParsedCue[] = [{ start: 1, end: 4, lines: ['Wake up, Neo.'], italic: false, top: false }]
const SRC = '1\r\n00:00:01,000 --> 00:00:04,000\r\nWake up, Neo.\r\n'

describe('syncedName', () => {
  it('carries the language and kind', () => {
    expect(syncedName('D:/m/Movie.mkv', 'eng', 'plain')).toBe('Movie.en.synced.srt')
    expect(syncedName('D:/m/Movie.mkv', 'fre', 'sdh')).toBe('Movie.fr.sdh.synced.srt')
    expect(syncedName('D:/m/Movie.mkv', 'eng', 'forced')).toBe('Movie.en.forced.synced.srt')
    expect(syncedName('D:/m/Movie.mkv', null, 'plain')).toBe('Movie.synced.srt')
  })
})

describe('exportSynced', () => {
  const run = (replace: boolean, c = cues, offset = 2) =>
    exportSynced({ videoPath: join(dir, 'Movie.mkv'), lang: 'eng', kind: 'plain', cues: c, offset, replace, fallbackDir })

  it('writes the shifted SRT next to the video and leaves the source alone', async () => {
    writeFileSync(join(dir, 'Movie.en.srt'), SRC)
    const r = await run(false)
    expect(r).toEqual({ saved: join(dir, 'Movie.en.synced.srt'), fallback: false })
    expect(readFileSync(join(dir, 'Movie.en.synced.srt'), 'utf8')).toBe('1\r\n00:00:03,000 --> 00:00:06,000\r\nWake up, Neo.\r\n\r\n')
    expect(readFileSync(join(dir, 'Movie.en.srt'), 'utf8')).toBe(SRC)
  })

  it('asks before replacing an existing synced file', async () => {
    writeFileSync(join(dir, 'Movie.en.synced.srt'), 'old')
    expect(await run(false)).toEqual({ exists: join(dir, 'Movie.en.synced.srt') })
    expect(readFileSync(join(dir, 'Movie.en.synced.srt'), 'utf8')).toBe('old')
    expect(await run(true)).toEqual({ saved: join(dir, 'Movie.en.synced.srt'), fallback: false })
    expect(readFileSync(join(dir, 'Movie.en.synced.srt'), 'utf8')).toContain('00:00:03,000')
    expect(readdirSync(dir).filter((n) => n.includes('.tmp'))).toEqual([])
  })

  it('exporting the synced file over itself', async () => {
    writeFileSync(join(dir, 'Movie.en.synced.srt'), SRC)
    const own = await readSubtitleFile(join(dir, 'Movie.en.synced.srt'), 'eng')
    await run(true, own, 0.5)
    expect(readFileSync(join(dir, 'Movie.en.synced.srt'), 'utf8')).toContain('00:00:01,500 --> 00:00:04,500')
  })

  it.runIf(process.platform === 'win32')('saves in the fallback folder when the video folder is read-only', async () => {
    const ro = join(dir, 'ro')
    mkdirSync(ro)
    execFileSync('icacls', [ro, '/deny', `${process.env['USERNAME']}:(W,AD)`, '/Q'])
    const r = await exportSynced({ videoPath: join(ro, 'Movie.mkv'), lang: 'eng', kind: 'plain', cues, offset: 0, replace: false, fallbackDir })
    expect(r).toEqual({ saved: join(fallbackDir, 'Movie.en.synced.srt'), fallback: true })
    expect(readFileSync(join(fallbackDir, 'Movie.en.synced.srt'), 'utf8')).toContain('Wake up, Neo.')
  })
})
