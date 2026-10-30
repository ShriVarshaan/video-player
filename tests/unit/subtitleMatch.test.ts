import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureUtf8 } from '../../src/main/subtitles/decode'
import { findSubtitles, parseSubName } from '../../src/main/subtitles/match'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-subs-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const touch = (...parts: string[]) => {
  const p = join(dir, ...parts)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, '1\n00:00:01,000 --> 00:00:02,000\nHi\n')
  return p
}
const movie = (name = 'Movie.Name.2019.mkv') => ({ path: touch(name), season: null, episode: null })
const names = (subs: { path: string }[]) => subs.map((s) => basename(s.path)).sort()

describe('parseSubName', () => {
  it('reads language and kind from the suffix', () => {
    expect(parseSubName('Movie.en.srt', 'Movie')).toEqual({ lang: 'eng', kind: 'plain' })
    expect(parseSubName('Movie.English.forced.srt', 'Movie')).toEqual({ lang: 'eng', kind: 'forced' })
    expect(parseSubName('Movie.eng.sdh.srt', 'Movie')).toEqual({ lang: 'eng', kind: 'sdh' })
    expect(parseSubName('Movie_fr_hi.srt', 'Movie')).toEqual({ lang: 'fre', kind: 'sdh' })
    expect(parseSubName('Movie.cc.srt', 'Movie')).toEqual({ lang: null, kind: 'sdh' })
    expect(parseSubName('Movie.srt', 'Movie')).toEqual({ lang: null, kind: 'plain' })
  })
})

describe('findSubtitles', () => {
  it('finds files named after the video with their language and kind', async () => {
    const v = movie()
    for (const s of ['', '.en', '.English.forced', '.eng.sdh', '.fr', '.hi']) touch(`Movie.Name.2019${s}.srt`)
    const subs = await findSubtitles(v, { userLang: 'spa' })
    const by = Object.fromEntries(subs.map((s) => [basename(s.path), [s.lang, s.kind, s.format]]))
    expect(by).toEqual({
      'Movie.Name.2019.srt': ['spa', 'plain', 'srt'],
      'Movie.Name.2019.en.srt': ['eng', 'plain', 'srt'],
      'Movie.Name.2019.English.forced.srt': ['eng', 'forced', 'srt'],
      'Movie.Name.2019.eng.sdh.srt': ['eng', 'sdh', 'srt'],
      'Movie.Name.2019.fr.srt': ['fre', 'plain', 'srt'],
      'Movie.Name.2019.hi.srt': ['spa', 'sdh', 'srt']
    })
  })

  it('looks in Subs and Subtitles folders but not unrelated ones', async () => {
    const v = movie()
    touch('Other.mkv')
    touch('Subs', 'Movie.Name.2019.en.srt')
    touch('Subtitles', 'Movie.Name.2019.de.srt')
    touch('Subs', 'Movie.Name.2019', '2_English.srt')
    touch('Extras', 'Movie.Name.2019.it.srt')
    expect(names(await findSubtitles(v, { userLang: 'eng' }))).toEqual(['2_English.srt', 'Movie.Name.2019.de.srt', 'Movie.Name.2019.en.srt'])
  })

  it('accepts any subtitle name when the folder holds one video', async () => {
    const v = movie()
    touch('English.srt')
    expect(names(await findSubtitles(v, { userLang: 'eng' }))).toEqual(['English.srt'])
    touch('Another.Video.mkv')
    expect(names(await findSubtitles(v, { userLang: 'eng' }))).toEqual([])
  })

  it('matches episodes by season and episode number', async () => {
    touch('Show - 1x01.mkv')
    const v = { path: touch('Show - 1x02.mkv'), season: 1, episode: 2 }
    touch('Show.S01E02.WEB.en.srt')
    touch('Show.S01E03.en.srt')
    expect(names(await findSubtitles(v, { userLang: 'eng' }))).toEqual(['Show.S01E02.WEB.en.srt'])
  })

  it('handles names with brackets, parentheses and accents', async () => {
    const a = movie('Amélie (2001).mp4')
    touch('[Group] Show - 01.mkv')
    touch('amélie (2001).EN.srt')
    touch('[Group] Show - 01.srt')
    expect(names(await findSubtitles(a, { userLang: 'eng' }))).toEqual(['amélie (2001).EN.srt'])
    const b = { path: join(dir, '[Group] Show - 01.mkv'), season: null, episode: null }
    expect(names(await findSubtitles(b, { userLang: 'eng' }))).toEqual(['[Group] Show - 01.srt'])
  })

  it('returns nothing, without throwing, for missing folders', async () => {
    expect(await findSubtitles({ path: join(dir, 'gone', 'Movie.mkv'), season: null, episode: null }, { userLang: 'eng' })).toEqual([])
  })

  it('ignores other files and reads the format from the extension', async () => {
    const v = movie()
    for (const e of ['nfo', 'txt', 'idx', 'vtt', 'ass', 'ssa']) touch(`Movie.Name.2019.${e}`)
    const subs = await findSubtitles(v, { userLang: 'eng' })
    expect(subs.map((s) => s.format).sort()).toEqual(['ass', 'ssa', 'vtt'])
  })

  it('searches extra folders without a name check', async () => {
    const v = movie()
    touch('Second.mkv')
    const extra = join(dir, 'appdata', 'subtitles', '7')
    mkdirSync(extra, { recursive: true })
    writeFileSync(join(extra, 'download.en.srt'), 'x')
    expect(names(await findSubtitles(v, { userLang: 'eng', extraDirs: [extra, join(dir, 'nope')] }))).toEqual(['download.en.srt'])
  })
})

describe('ensureUtf8', () => {
  const srt = (body: Buffer) => Buffer.concat([Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\n'), body, Buffer.from('\r\n')])
  const cache = () => join(dir, 'cache')

  it('hands back a UTF-8 file as it is', async () => {
    const p = join(dir, 'a.srt')
    writeFileSync(p, srt(Buffer.from('Café señor', 'utf8')))
    expect(await ensureUtf8(p, cache(), 'fre')).toBe(p)
  })

  it('converts cp1252 French to a UTF-8 copy', async () => {
    const p = join(dir, 'b.srt')
    writeFileSync(p, srt(Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x73, 0x65, 0xf1, 0x6f, 0x72])))
    const out = await ensureUtf8(p, cache(), 'fre')
    expect(out).not.toBe(p)
    expect(readFileSync(out, 'utf8')).toContain('Café señor')
    expect(readFileSync(p)[37]).toBe(0xe9) // original untouched: still cp1252 'é'
  })

  it('uses the language to pick cp1256 for Arabic', async () => {
    const p = join(dir, 'c.srt')
    writeFileSync(p, srt(Buffer.from([0xe3, 0xd1, 0xcd, 0xc8, 0xc7])))
    expect(readFileSync(await ensureUtf8(p, cache(), 'ara'), 'utf8')).toContain('مرحبا')
  })

  it('converts UTF-16 with a byte order mark', async () => {
    const p = join(dir, 'd.srt')
    writeFileSync(p, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nÜber\r\n', 'utf16le')]))
    expect(readFileSync(await ensureUtf8(p, cache(), null), 'utf8')).toContain('Über')
  })
})
