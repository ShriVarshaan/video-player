import { join } from 'node:path'
import { normalizeLang } from '@shared/lang'
import type { Track } from '@shared/player'
import type { Transform } from '@shared/subtitleTiming'
import type { Db } from '../db'
import type { PlayerService } from '../player/service'
import { exportSynced } from './export'
import type { ExternalSub } from './match'
import type { ParsedCue } from './parse'
import { setOffset, subtitleKeyForFile } from './transforms'

// Writes <video>.<lang>[.sdh|.forced].synced.srt and shows it, for manual export
// and auto sync alike. { exists } when one is there and replace is false.
export async function writeAndShowSynced(
  deps: { db: Db; player: Pick<PlayerService, 'current' | 'addSubtitle'>; userDataPath: string },
  sub: { videoId: number; videoPath: string; track: Track },
  cues: ParsedCue[],
  transform: Transform,
  replace: boolean
): Promise<{ saved: string; fallback: boolean } | { exists: string }> {
  const lang = normalizeLang(sub.track.lang)
  const r = await exportSynced({
    videoPath: sub.videoPath,
    lang,
    kind: sub.track.kind,
    cues,
    transform,
    replace,
    fallbackDir: join(deps.userDataPath, 'subtitles', String(sub.videoId))
  })
  if ('exists' in r) return r
  // The timing is baked into the new file: it starts with no fix of its own.
  setOffset(deps.db, sub.videoId, subtitleKeyForFile(r.saved), 0, Date.now())
  const added: ExternalSub = { path: r.saved, lang, kind: sub.track.kind, format: 'srt', synced: true }
  if (deps.player.current()?.videoId === sub.videoId) await deps.player.addSubtitle(added, { remember: false })
  return r
}
