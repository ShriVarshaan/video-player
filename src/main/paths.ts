import { join } from 'node:path'
import type { BinaryName } from '@shared/api'

const BINARIES: Record<BinaryName | 'sidecar', string[]> = {
  mpv: ['vendor', 'mpv', 'mpv.exe'],
  ffmpeg: ['vendor', 'ffmpeg', 'ffmpeg.exe'],
  ffprobe: ['vendor', 'ffmpeg', 'ffprobe.exe'],
  sidecar: ['sidecar', 'vp-sync', 'vp-sync.exe']
}

// The only place that knows where bundled binaries live (release-windows §2).
// base is process.resourcesPath when packaged, the project root in development.
export function binaryPath(name: BinaryName | 'sidecar', base: string): string {
  return join(base, ...BINARIES[name])
}

export function userDataOverride(argv: string[]): string | null {
  const prefix = '--user-data-dir='
  const arg = argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}
