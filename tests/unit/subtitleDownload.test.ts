import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveDownload } from '../../src/main/subtitles/download'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-dl-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const save = (over: Partial<Parameters<typeof saveDownload>[0]> = {}) =>
  saveDownload({
    videoPath: join(dir, 'Movie.mkv'),
    lang: 'eng',
    kind: 'plain',
    format: 'srt',
    content: Buffer.from('new'),
    fallbackDir: join(dir, 'appdata', 'subtitles', '7'),
    ...over
  })

describe('saveDownload', () => {
  it('saves next to the video as <name>.<lang>.srt', async () => {
    const p = await save()
    expect(p).toBe(join(dir, 'Movie.en.srt'))
    expect(readFileSync(p, 'utf8')).toBe('new')
  })

  it('never overwrites: a taken name gets .2, then .3', async () => {
    writeFileSync(join(dir, 'Movie.en.srt'), 'mine')
    expect(basename(await save())).toBe('Movie.en.2.srt')
    expect(basename(await save())).toBe('Movie.en.3.srt')
    expect(readFileSync(join(dir, 'Movie.en.srt'), 'utf8')).toBe('mine')
  })

  it('marks SDH and forced files, and keeps other formats', async () => {
    expect(basename(await save({ kind: 'sdh' }))).toBe('Movie.en.sdh.srt')
    expect(basename(await save({ kind: 'forced', lang: 'fre', format: 'ass' }))).toBe('Movie.fr.forced.ass')
  })

  it('saves in the app folder when the video folder cannot be written', async () => {
    writeFileSync(join(dir, 'not-a-folder'), '')
    const p = await save({ videoPath: join(dir, 'not-a-folder', 'Movie.mkv') })
    expect(p).toBe(join(dir, 'appdata', 'subtitles', '7', 'Movie.en.srt'))
    expect(existsSync(p)).toBe(true)
  })
})
