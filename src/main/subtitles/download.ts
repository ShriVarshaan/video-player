import { mkdir, open } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { toOpenSubtitles } from '@shared/lang'
import type { TrackKind } from '@shared/player'

// Where a downloaded subtitle goes: next to the video as <video>.<lang>[.sdh|.forced].<ext>,
// never over an existing file (.2, .3… instead), or in fallbackDir when the video's
// folder can't be written. Returns the path written.
export async function saveDownload(p: {
  videoPath: string
  lang: string
  kind: TrackKind
  format: string
  content: Buffer
  fallbackDir: string
}): Promise<string> {
  const base = basename(p.videoPath, extname(p.videoPath))
  const flag = p.kind === 'sdh' ? '.sdh' : p.kind === 'forced' ? '.forced' : ''
  const ext = /^[a-z0-9]{2,4}$/i.test(p.format) ? p.format.toLowerCase() : 'srt'
  const name = (n: number) => `${base}.${toOpenSubtitles(p.lang)}${flag}${n > 1 ? `.${n}` : ''}.${ext}`

  async function writeIn(dir: string): Promise<string> {
    for (let n = 1; n < 100; n++) {
      const path = join(dir, name(n))
      try {
        const f = await open(path, 'wx') // fails if the file exists: never overwrite
        try {
          await f.writeFile(p.content)
        } finally {
          await f.close()
        }
        return path
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
    throw new Error('Too many subtitle files with this name')
  }

  try {
    return await writeIn(dirname(p.videoPath))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === undefined) throw e
    await mkdir(p.fallbackDir, { recursive: true })
    return writeIn(p.fallbackDir)
  }
}
