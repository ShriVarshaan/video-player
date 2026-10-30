import type { Db } from '../db'

const FINISHED_AT = 0.95 // same rule as showProgress.isFinished

// Saves where playback is. completed follows the latest save, so a rewatch that
// saves a lower position is no longer "watched".
export function savePosition(
  db: Db,
  p: { videoId: number; positionS: number; durationS: number | null; ended?: boolean },
  now: number
): void {
  const completed = p.ended || (p.durationS !== null && p.durationS > 0 && p.positionS >= FINISHED_AT * p.durationS)
  db.prepare(
    `INSERT INTO playback_state (video_id, position_s, duration_s, completed, last_played_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET position_s = excluded.position_s,
       duration_s = COALESCE(excluded.duration_s, duration_s), completed = excluded.completed,
       last_played_at = excluded.last_played_at`
  ).run(p.videoId, p.positionS, p.durationS, completed ? 1 : 0, now)
}
