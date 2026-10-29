import { describe, expect, it } from 'vitest'
import { binaryPath, userDataOverride } from '../../src/main/paths'

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
