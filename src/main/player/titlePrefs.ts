import type { TitlePrefs } from '@shared/player'
import type { Db } from '../db'

type Row = { volume: number | null; audio_json: string | null; subtitle_json: string | null }

const parse = <T>(json: string | null): T | null => (json === null ? null : (JSON.parse(json) as T))

export function getPrefs(db: Db, key: string): TitlePrefs {
  const r = db.prepare('SELECT volume, audio_json, subtitle_json FROM title_prefs WHERE title_key = ?').get(key) as Row | undefined
  return {
    volume: r?.volume ?? 100,
    audio: parse(r?.audio_json ?? null),
    subtitle: parse(r?.subtitle_json ?? null)
  }
}

export function savePrefs(db: Db, key: string, patch: Partial<TitlePrefs>, now: number): void {
  const next = { ...getPrefs(db, key), ...patch }
  db.prepare(
    `INSERT INTO title_prefs (title_key, volume, audio_json, subtitle_json, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(title_key) DO UPDATE SET volume = excluded.volume, audio_json = excluded.audio_json,
       subtitle_json = excluded.subtitle_json, updated_at = excluded.updated_at`
  ).run(
    key,
    next.volume,
    next.audio === null ? null : JSON.stringify(next.audio),
    next.subtitle === null ? null : JSON.stringify(next.subtitle),
    now
  )
}

// A show's key changes from 'local:<name>' to 'tmdb:<id>' when TMDB first matches it.
export function rekeyPrefs(db: Db, from: string, to: string): void {
  if (db.prepare('SELECT 1 FROM title_prefs WHERE title_key = ?').get(to)) return
  db.prepare('UPDATE title_prefs SET title_key = ? WHERE title_key = ?').run(to, from)
}
