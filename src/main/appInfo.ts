import type { API, AppInfo, BinaryName } from '@shared/api'

const NAMES: BinaryName[] = ['mpv', 'ffmpeg', 'ffprobe']

export function createAppInfo(deps: {
  version: string
  userDataPath: string
  dbPath: string
  resolve: (name: BinaryName) => string
  exists: (path: string) => boolean
}): API['app'] {
  return {
    getInfo: async () => {
      const binaries = Object.fromEntries(
        NAMES.map((name) => {
          const path = deps.resolve(name)
          return [name, { path, exists: deps.exists(path) }]
        })
      ) as AppInfo['binaries']
      return {
        version: deps.version,
        userDataPath: deps.userDataPath,
        dbPath: deps.dbPath,
        binaries
      }
    }
  }
}
