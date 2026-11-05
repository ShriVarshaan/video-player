import { describe, expect, it } from 'vitest'
import { createAppInfo } from '../../src/main/appInfo'

const app = (packaged = false) =>
  createAppInfo({
    version: '0.1.0',
    userDataPath: 'C:\\data',
    dbPath: 'C:\\data\\library.db',
    packaged,
    resolve: (n) => `C:\\vendor\\${n}.exe`,
    exists: (p) => p.endsWith('mpv.exe'),
    hour12: () => false,
    readNotices: async () => 'the notices'
  })

describe('app.getInfo', () => {
  it('reports version, paths and which binaries exist', async () => {
    expect(await app().getInfo({})).toEqual({
      version: '0.1.0',
      userDataPath: 'C:\\data',
      dbPath: 'C:\\data\\library.db',
      hour12: false,
      packaged: false,
      binaries: {
        mpv: { path: 'C:\\vendor\\mpv.exe', exists: true },
        ffmpeg: { path: 'C:\\vendor\\ffmpeg.exe', exists: false },
        ffprobe: { path: 'C:\\vendor\\ffprobe.exe', exists: false }
      }
    })
  })

  it('says whether this is an installed app', async () => {
    expect((await app(true).getInfo({})).packaged).toBe(true)
  })
})

describe('app.notices', () => {
  it('hands back the notices text', async () => {
    expect(await app().notices({})).toBe('the notices')
  })
})
