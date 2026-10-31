import { randomBytes } from 'node:crypto'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { toOpenSubtitles } from '@shared/lang'
import type { TrackKind } from '@shared/player'
import type { ParsedCue } from './parse'
import { writeSrt } from './srt'

// <video>.<lang>[.sdh|.forced].synced.srt — the words the matcher reads back.
export function syncedName(videoPath: string, lang: string | null, kind: TrackKind): string {
  const base = basename(videoPath, extname(videoPath))
  const flag = kind === 'sdh' ? '.sdh' : kind === 'forced' ? '.forced' : ''
  return `${base}${lang ? `.${toOpenSubtitles(lang)}` : ''}${flag}.synced.srt`
}

const exists = (p: string) => access(p).then(
  () => true,
  () => false
)

const CANT_WRITE = new Set(['EACCES', 'EPERM', 'EROFS'])

// Writes the cues, shifted by offset, as a synced SRT next to the video (or in
// fallbackDir when that folder can't be written). An existing synced file is
// replaced only with replace; the user's own subtitle file is never touched.
export async function exportSynced(p: {
  videoPath: string
  lang: string | null
  kind: TrackKind
  cues: ParsedCue[]
  offset: number
  replace: boolean
  fallbackDir: string
}): Promise<{ saved: string; fallback: boolean } | { exists: string }> {
  const name = syncedName(p.videoPath, p.lang, p.kind)
  const text = writeSrt(p.cues, p.offset)

  async function writeIn(dir: string): Promise<{ saved: string } | { exists: string }> {
    const target = join(dir, name)
    if (!p.replace && (await exists(target))) return { exists: target }
    // Written beside the target and renamed, so a failure never leaves half a file.
    const tmp = `${target}.tmp-${randomBytes(4).toString('hex')}`
    try {
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, target)
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {})
      throw e
    }
    return { saved: target }
  }

  try {
    const r = await writeIn(dirname(p.videoPath))
    return 'saved' in r ? { ...r, fallback: false } : r
  } catch (e) {
    if (!CANT_WRITE.has((e as NodeJS.ErrnoException).code ?? '')) throw e
    await mkdir(p.fallbackDir, { recursive: true })
    const r = await writeIn(p.fallbackDir)
    return 'saved' in r ? { ...r, fallback: true } : r
  }
}
