import { describe, expect, it } from 'vitest'
import { createAppInfo } from '../../src/main/appInfo'

describe('app.getInfo', () => {
  it('reports version, paths and which binaries exist', async () => {
    const app = createAppInfo({
      version: '0.1.0',
      userDataPath: 'C:\\data',
      dbPath: 'C:\\data\\library.db',
      resolve: (n) => `C:\\vendor\\${n}.exe`,
      exists: (p) => p.endsWith('mpv.exe')
    })
    expect(await app.getInfo({})).toEqual({
      version: '0.1.0',
      userDataPath: 'C:\\data',
      dbPath: 'C:\\data\\library.db',
      binaries: {
        mpv: { path: 'C:\\vendor\\mpv.exe', exists: true },
        ffmpeg: { path: 'C:\\vendor\\ffmpeg.exe', exists: false },
        ffprobe: { path: 'C:\\vendor\\ffprobe.exe', exists: false }
      }
    })
  })
})
