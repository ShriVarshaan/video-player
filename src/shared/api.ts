// The one source of truth for renderer ↔ main IPC. Add a method here and to
// apiMethods; the compiler then points at the missing handler and bridge.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export type BinaryName = 'mpv' | 'ffmpeg' | 'ffprobe'

export type AppInfo = {
  version: string
  userDataPath: string
  dbPath: string
  binaries: Record<BinaryName, { path: string; exists: boolean }>
}

export type API = {
  app: {
    getInfo: (params: Record<string, never>) => Promise<AppInfo>
  }
  settings: {
    get: (params: { key: string }) => Promise<Json | null>
    set: (params: { key: string; value: Json }) => Promise<void>
  }
}

export type Domain = keyof API

// Runtime list of methods. The mapped type makes leaving one out a compile error.
export const apiMethods: { [D in Domain]: { [M in keyof API[D]]: true } } = {
  app: { getInfo: true },
  settings: { get: true, set: true }
}

export const channelFor = (domain: string, method: string): string => `vp:${domain}.${method}`
