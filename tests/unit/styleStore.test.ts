import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_STYLE } from '@shared/subtitleStyle'
import { openDb, type Db } from '../../src/main/db'
import { getPrefs, rekeyPrefs, savePrefs } from '../../src/main/player/titlePrefs'
import { createStyleStore } from '../../src/main/subtitles/styleStore'
import { originalLanguage } from '../../src/main/subtitles/titleInfo'

let db: Db
let store: ReturnType<typeof createStyleStore>
beforeEach(() => {
  db = openDb(':memory:')
  store = createStyleStore(db, { now: () => 1, defaultLanguage: 'fre' })
})

describe('style store', () => {
  it('starts with the default style and no overrides', () => {
    expect(store.global()).toEqual(DEFAULT_STYLE)
    expect(store.overrides('movie:1')).toEqual({})
  })

  it('keeps a title’s changed fields and follows later global changes for the rest', () => {
    store.setOverrides('movie:1', { size: 150 })
    store.setGlobal({ ...store.global(), font: 'georgia' })
    expect(store.effective('movie:1')).toMatchObject({ font: 'georgia', size: 150 })
    expect(store.effective('movie:2')).toMatchObject({ font: 'georgia', size: 100 })
  })

  it('merges successive changes', () => {
    store.setOverrides('movie:1', { size: 150 })
    store.setOverrides('movie:1', { edge: 'outline' })
    expect(store.overrides('movie:1')).toEqual({ size: 150, edge: 'outline' })
  })

  it('“Use for all” makes the title’s look global and clears its overrides', () => {
    store.setOverrides('movie:1', { size: 150, position: 30 })
    const was = store.effective('movie:1')
    store.useForAll('movie:1')
    expect(store.global()).toEqual(was)
    expect(store.overrides('movie:1')).toEqual({})
  })

  it('reset clears the overrides and leaves the global style alone', () => {
    store.setOverrides('movie:1', { size: 150 })
    store.reset('movie:1')
    expect(store.overrides('movie:1')).toEqual({})
    expect(store.global()).toEqual(DEFAULT_STYLE)
  })

  it('does not disturb the other per-title prefs', () => {
    savePrefs(db, 'movie:1', { volume: 150 }, 1)
    store.setOverrides('movie:1', { size: 150 })
    savePrefs(db, 'movie:1', { volume: 120 }, 2)
    expect(getPrefs(db, 'movie:1').volume).toBe(120)
    expect(store.overrides('movie:1')).toEqual({ size: 150 })
  })

  it('moves overrides with the show key when TMDB matches a local show', () => {
    store.setOverrides('local:dune', { size: 150 })
    rekeyPrefs(db, 'local:dune', 'tmdb:1')
    expect(store.overrides('tmdb:1')).toEqual({ size: 150 })
  })

  it('drops unknown or bad override fields read back from the database', () => {
    db.prepare(`INSERT INTO title_prefs (title_key, style_json, updated_at) VALUES ('movie:9', ?, 1)`).run(
      JSON.stringify({ size: 9000, hack: 1, font: 'georgia' })
    )
    expect(store.overrides('movie:9')).toEqual({ size: 200, font: 'georgia' })
  })

  it('has subtitle language and Prefer SDH settings', () => {
    expect(store.subtitleSettings()).toEqual({ language: 'fre', preferSdh: false })
    store.setSubtitleSettings({ preferSdh: true })
    store.setSubtitleSettings({ language: 'eng' })
    expect(store.subtitleSettings()).toEqual({ language: 'eng', preferSdh: true })
  })
})

describe('originalLanguage', () => {
  it('reads the movie’s or show’s TMDB original language', () => {
    db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
      INSERT INTO tmdb_movies (tmdb_id, title, original_language, fetched_at) VALUES (5, 'Spirited Away', 'ja', 0);
      INSERT INTO tmdb_shows (tmdb_id, name, original_language, fetched_at) VALUES (6, 'Dark', 'de', 0);
      INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, tmdb_id, added_at) VALUES (1, 1, 'a', 1, 0, 0, 'x', 5, 0);
      INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, kind, show_tmdb_id, added_at) VALUES (2, 1, 'b', 1, 0, 0, 'x', 'episode', 6, 0);
      INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, added_at) VALUES (3, 1, 'c', 1, 0, 0, 'x', 0);`)
    expect(originalLanguage(db, 1)).toBe('jpn')
    expect(originalLanguage(db, 2)).toBe('ger')
    expect(originalLanguage(db, 3)).toBeNull()
  })
})
