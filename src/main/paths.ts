import { dirname, join } from 'node:path'
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

// How to start the sync sidecar: the bundled exe when packaged, the venv's
// python in development (npm run setup-sidecar). null when it isn't there.
export function sidecarCommand(
  base: string,
  packaged: boolean,
  exists: (p: string) => boolean
): { cmd: string; args: string[]; cwd: string } | null {
  if (packaged) {
    const cmd = binaryPath('sidecar', base)
    return exists(cmd) ? { cmd, args: [], cwd: dirname(cmd) } : null
  }
  const cwd = join(base, 'sidecar')
  const cmd = join(cwd, '.venv', 'Scripts', 'python.exe')
  return exists(cmd) ? { cmd, args: ['-m', 'vp_sync'], cwd } : null
}

// Set at build time. Only update test builds change it: an update relaunches the app with no
// arguments, so --user-data-dir can't keep them away from the real library.
declare const __DATA_FOLDER__: string | undefined
const DATA_FOLDER = typeof __DATA_FOLDER__ === 'string' ? __DATA_FOLDER__ : 'video-player'

// Pinned to %APPDATA%\video-player so the library is in the same per-user place however Electron
// was launched (its default depends on how the app was found). It keeps this name although the app
// is now Cinewall: moving it would lose people's libraries and their encrypted logins.
export function userDataDir(argv: string[], appData: string): string {
  return userDataOverride(argv) ?? join(appData, DATA_FOLDER)
}

export function userDataOverride(argv: string[]): string | null {
  const prefix = '--user-data-dir='
  const arg = argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}
