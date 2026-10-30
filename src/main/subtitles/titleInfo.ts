import { normalizeLang } from '@shared/lang'
import type { Db } from '../db'

// TMDB's original language of a video's movie or show, for audio with no language tag.
export function originalLanguage(db: Db, videoId: number): string | null {
  const row = db
    .prepare(
      `SELECT COALESCE(m.original_language, s.original_language) AS lang FROM videos v
         LEFT JOIN tmdb_movies m ON m.tmdb_id = v.tmdb_id
         LEFT JOIN tmdb_shows s ON s.tmdb_id = v.show_tmdb_id
       WHERE v.id = ?`
    )
    .get(videoId) as { lang: string | null } | undefined
  return normalizeLang(row?.lang)
}
