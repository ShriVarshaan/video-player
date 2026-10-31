import { createHash } from 'node:crypto'
import type { Db } from '../db'

// Which subtitle a timing fix belongs to: a file by the user's own path (not the
// UTF-8 cache copy mpv reads), a track inside the video by its stream index.
export const subtitleKeyForFile = (originalPath: string): string => `file:${createHash('sha1').update(originalPath).digest('hex')}`
export const subtitleKeyForEmbedded = (ffIndex: number): string => `embedded:${ffIndex}`

export function getOffset(db: Db, videoId: number, key: string): number {
  const row = db.prepare('SELECT offset_s FROM subtitle_transforms WHERE video_id = ? AND subtitle_key = ?').get(videoId, key) as
    | { offset_s: number }
    | undefined
  return row?.offset_s ?? 0
}

// A manual fix (scale 1). An offset of 0 removes the row: nothing to remember.
export function setOffset(db: Db, videoId: number, key: string, offset: number, now: number): void {
  if (offset === 0) {
    db.prepare('DELETE FROM subtitle_transforms WHERE video_id = ? AND subtitle_key = ?').run(videoId, key)
    return
  }
  db.prepare(
    `INSERT INTO subtitle_transforms (video_id, subtitle_key, scale, offset_s, segments_json, source, confidence, updated_at)
     VALUES (?, ?, 1, ?, NULL, 'manual', NULL, ?)
     ON CONFLICT (video_id, subtitle_key) DO UPDATE SET
       scale = 1, offset_s = excluded.offset_s, segments_json = NULL, source = 'manual', confidence = NULL, updated_at = excluded.updated_at`
  ).run(videoId, key, offset, now)
}
