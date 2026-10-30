import { describe, expect, it } from 'vitest'
import { LANGUAGES, languageName, normalizeLang, toOpenSubtitles } from '@shared/lang'

describe('normalizeLang', () => {
  it('accepts ISO 639-1 and 639-2 codes in any case', () => {
    expect(normalizeLang('en')).toBe('eng')
    expect(normalizeLang('ENG')).toBe('eng')
  })
  it('maps 639-2/T codes to the /B codes mpv uses', () => {
    expect(normalizeLang('fra')).toBe('fre')
    expect(normalizeLang('deu')).toBe('ger')
    expect(normalizeLang('zho')).toBe('chi')
  })
  it('accepts English names and locale tags', () => {
    expect(normalizeLang('English')).toBe('eng')
    expect(normalizeLang('french')).toBe('fre')
    expect(normalizeLang('pt-BR')).toBe('por')
    expect(normalizeLang('en-US')).toBe('eng')
  })
  it('returns null for unknown or undetermined', () => {
    expect(normalizeLang('und')).toBeNull()
    expect(normalizeLang('xx')).toBeNull()
    expect(normalizeLang(null)).toBeNull()
    expect(normalizeLang(undefined)).toBeNull()
    expect(normalizeLang('')).toBeNull()
  })
})

describe('toOpenSubtitles', () => {
  it('gives the code OpenSubtitles uses', () => {
    expect(toOpenSubtitles('eng')).toBe('en')
    expect(toOpenSubtitles('chi')).toBe('zh-cn')
    expect(toOpenSubtitles('fre')).toBe('fr')
  })
})

describe('languageName', () => {
  it('names ISO codes', () => {
    expect(languageName('jpn')).toBe('Japanese')
    expect(languageName('fre')).toBe('French')
  })
  it('falls back to the code in capitals', () => {
    expect(languageName('xx1')).toBe('XX1')
  })
})

describe('LANGUAGES', () => {
  it('has at least 40 languages, alphabetical by name, with unique codes', () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(40)
    const names = LANGUAGES.map((l) => l.name)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
    expect(new Set(LANGUAGES.map((l) => l.code2)).size).toBe(LANGUAGES.length)
  })
})
