import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, schemaVersion, type Db } from '../../src/main/db'
import { getPrefs, rekeyPrefs, savePrefs } from '../../src/main/player/titlePrefs'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
})

describe('migration 4', () => {
  it('adds per-title subtitle style and TMDB original languages', () => {
    expect(schemaVersion(db)).toBe(4)
    const cols = (t: string) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c['name'])
    expect(cols('title_prefs')).toContain('style_json')
    expect(cols('tmdb_movies')).toContain('original_language')
    expect(cols('tmdb_shows')).toContain('original_language')
  })
})

describe('migration 3', () => {
  it('adds title_prefs', () => {
    const cols = db.prepare('PRAGMA table_info(title_prefs)').all().map((c) => ({ name: c['name'], type: c['type'], pk: c['pk'], notnull: c['notnull'] }))
    expect(cols).toEqual([
      { name: 'title_key', type: 'TEXT', pk: 1, notnull: 0 },
      { name: 'volume', type: 'INTEGER', pk: 0, notnull: 0 },
      { name: 'audio_json', type: 'TEXT', pk: 0, notnull: 0 },
      { name: 'subtitle_json', type: 'TEXT', pk: 0, notnull: 0 },
      { name: 'updated_at', type: 'INTEGER', pk: 0, notnull: 1 },
      { name: 'style_json', type: 'TEXT', pk: 0, notnull: 0 }
    ])
  })
})

describe('title prefs', () => {
  const jpn = { lang: 'jpn', kind: 'plain' as const, title: null }
  const sdh = { lang: 'eng', kind: 'sdh' as const, title: 'English SDH' }

  it('defaults for an unknown key', () => {
    expect(getPrefs(db, 'movie:1')).toEqual({ volume: 100, audio: null, subtitle: null })
  })

  it('patches only the given fields', () => {
    savePrefs(db, 'movie:1', { volume: 150 }, 1)
    savePrefs(db, 'movie:1', { audio: jpn }, 2)
    expect(getPrefs(db, 'movie:1')).toEqual({ volume: 150, audio: jpn, subtitle: null })
    savePrefs(db, 'movie:1', { subtitle: sdh }, 3)
    expect(getPrefs(db, 'movie:1')).toEqual({ volume: 150, audio: jpn, subtitle: sdh })
  })

  it("round-trips subtitle 'off'", () => {
    savePrefs(db, 'tmdb:1396', { subtitle: 'off' }, 1)
    expect(getPrefs(db, 'tmdb:1396').subtitle).toBe('off')
  })

  it('keeps titles apart', () => {
    savePrefs(db, 'movie:1', { volume: 150 }, 1)
    expect(getPrefs(db, 'movie:2').volume).toBe(100)
  })

  it('rekeys a local show to its TMDB key', () => {
    savePrefs(db, 'local:breaking bad', { volume: 120 }, 1)
    rekeyPrefs(db, 'local:breaking bad', 'tmdb:1396')
    expect(getPrefs(db, 'tmdb:1396').volume).toBe(120)
    expect(getPrefs(db, 'local:breaking bad').volume).toBe(100)
  })

  it('keeps the existing target row when both exist', () => {
    savePrefs(db, 'local:breaking bad', { volume: 120 }, 1)
    savePrefs(db, 'tmdb:1396', { volume: 80 }, 2)
    rekeyPrefs(db, 'local:breaking bad', 'tmdb:1396')
    expect(getPrefs(db, 'tmdb:1396').volume).toBe(80)
  })
})
