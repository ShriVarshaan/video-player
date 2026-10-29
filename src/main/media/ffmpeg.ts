import { execFile } from 'node:child_process'

function run(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-y', '-v', 'error', ...args], { timeout: 60_000, windowsHide: true }, (error) =>
      error ? reject(error) : resolve()
    )
  })
}

// One frame at atS seconds, scaled to width (height keeps the aspect, even).
export function grabFrame(ffmpegPath: string, input: string, atS: number, output: string, width: number): Promise<void> {
  return run(ffmpegPath, ['-ss', String(atS), '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, output])
}

// WebP at quality 80; libwebp keeps an alpha channel when the input has one.
export function toWebp(ffmpegPath: string, input: string, output: string, width: number): Promise<void> {
  return run(ffmpegPath, ['-i', input, '-vf', `scale=${width}:-2`, '-c:v', 'libwebp', '-quality', '80', '-frames:v', '1', output])
}
