import { describe, expect, it } from 'vitest'
import { binaryPath, sidecarCommand, userDataDir, userDataOverride } from '../../src/main/paths'

describe('binaryPath', () => {
  it('puts mpv under vendor/mpv', () => {
    expect(binaryPath('mpv', 'C:\\base')).toBe('C:\\base\\vendor\\mpv\\mpv.exe')
  })

  it('puts ffmpeg and ffprobe under vendor/ffmpeg', () => {
    expect(binaryPath('ffmpeg', 'C:\\base')).toBe('C:\\base\\vendor\\ffmpeg\\ffmpeg.exe')
    expect(binaryPath('ffprobe', 'C:\\base')).toBe('C:\\base\\vendor\\ffmpeg\\ffprobe.exe')
  })

  it('puts the sync sidecar under sidecar/vp-sync', () => {
    expect(binaryPath('sidecar', 'C:\\base')).toBe('C:\\base\\sidecar\\vp-sync\\vp-sync.exe')
  })
})

describe('userDataOverride', () => {
  it('reads --user-data-dir=<dir>, spaces included', () => {
    expect(userDataOverride(['electron', '.', '--user-data-dir=C:\\t\\x y'])).toBe('C:\\t\\x y')
  })

  it('returns null when the flag is absent', () => {
    expect(userDataOverride(['electron', '.'])).toBeNull()
  })
})

describe('userDataDir', () => {
  it('is %APPDATA%\\video-player however the app was launched', () => {
    expect(userDataDir(['electron', 'out/main/index.js'], 'C:\\Users\\a\\AppData\\Roaming')).toBe(
      'C:\\Users\\a\\AppData\\Roaming\\video-player'
    )
  })

  it('prefers --user-data-dir', () => {
    expect(userDataDir(['electron', '--user-data-dir=D:\\t'], 'C:\\AppData')).toBe('D:\\t')
  })
})

describe('sidecarCommand', () => {
  const all = () => true
  const none = () => false

  it('dev: runs the venv python as a module from sidecar/', () => {
    expect(sidecarCommand('C:\\base', false, all)).toEqual({
      cmd: 'C:\\base\\sidecar\\.venv\\Scripts\\python.exe',
      args: ['-m', 'vp_sync'],
      cwd: 'C:\\base\\sidecar'
    })
  })

  it('packaged: runs the bundled exe from its folder', () => {
    expect(sidecarCommand('C:\\res', true, all)).toEqual({
      cmd: 'C:\\res\\sidecar\\vp-sync\\vp-sync.exe',
      args: [],
      cwd: 'C:\\res\\sidecar\\vp-sync'
    })
  })

  it('missing: null', () => {
    expect(sidecarCommand('C:\\base', false, none)).toBeNull()
    expect(sidecarCommand('C:\\res', true, none)).toBeNull()
  })
})
