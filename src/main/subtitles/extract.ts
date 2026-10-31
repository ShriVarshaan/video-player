import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Subtitle codecs inside a video that the app can read as text.
export const TEXT_CODECS = new Set(['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'])

const TIMEOUT_MS = 5 * 60_000 // ffmpeg reads the whole file; long films take a while

// Copies one subtitle stream out of a video into cacheDir (ASS kept as .ass, the
// rest as .srt) and returns its path. Cached by file size, mtime and stream index.
export async function extractSubtitle(p: {
  ffmpegPath: string
  video: string
  ffIndex: number
  codec: string
  cacheDir: string
  signal?: AbortSignal
}): Promise<string> {
  const ass = p.codec === 'ass' || p.codec === 'ssa'
  const s = await stat(p.video)
  const id = createHash('sha1').update(`${p.video}|${s.size}|${s.mtimeMs}|${p.ffIndex}`).digest('hex').slice(0, 16)
  const out = join(p.cacheDir, `${id}.${ass ? 'ass' : 'srt'}`)
  try {
    await access(out)
    return out
  } catch {
    // not cached yet
  }
  await mkdir(p.cacheDir, { recursive: true })
  const tmp = join(p.cacheDir, `${id}.${randomBytes(4).toString('hex')}.tmp.${ass ? 'ass' : 'srt'}`)
  const args = ['-y', '-v', 'error', '-i', p.video, '-map', `0:${p.ffIndex}`, '-c:s', ass ? 'copy' : 'srt', tmp]
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(p.ffmpegPath, args, { timeout: TIMEOUT_MS, windowsHide: true, signal: p.signal }, (error) => (error ? reject(error) : resolve()))
    })
    await rename(tmp, out)
    return out
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}
