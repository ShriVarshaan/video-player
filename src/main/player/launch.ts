import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { connectMpv, type MpvClient } from './mpvIpc'
import type { MpvProcess } from './service'

// mpv flags from the mpv-ipc skill. --sub-visibility=no: the overlay draws text
// subtitles; the service turns it on only for picture-based tracks.
const FLAGS = [
  '--idle=yes',
  '--keep-open=yes',
  '--force-window=yes',
  '--no-osc',
  '--osd-level=0',
  '--no-osd-bar',
  '--no-input-default-bindings',
  '--input-vo-keyboard=no',
  '--input-cursor=no',
  '--hwdec=auto-safe',
  '--vo=gpu-next',
  '--volume-max=200',
  '--sub-auto=no',
  '--audio-file-auto=no',
  '--sub-visibility=no',
  '--msg-level=all=warn'
]

let launches = 0

// mpv's child window is created below Chromium's own surfaces inside the app
// window, so it must be raised once it exists (see the milestone 4 design).
type User32 = {
  FindWindowExW(parent: bigint, after: bigint, cls: string, name: string | null): bigint | number
  SetWindowPos(h: bigint | number, after: bigint, x: number, y: number, cx: number, cy: number, flags: number): boolean
}
let user32: User32 | null = null
function loadUser32(): User32 {
  if (user32) return user32
  const koffi = createRequire(__filename)('koffi') as {
    load(name: string): { func(signature: string): (...args: unknown[]) => unknown }
  }
  const lib = koffi.load('user32.dll')
  user32 = {
    FindWindowExW: lib.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)') as User32['FindWindowExW'],
    SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr h, intptr after, int x, int y, int cx, int cy, uint flags)') as User32['SetWindowPos']
  }
  return user32
}

const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010

async function raiseMpvWindow(parent: bigint, timeoutMs = 3000): Promise<boolean> {
  const u = loadUser32()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const child = u.FindWindowExW(parent, 0n, 'mpv', null)
    if (child && BigInt(child) !== 0n) return u.SetWindowPos(child, 0n, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
    await new Promise((r) => setTimeout(r, 20))
  }
  return false
}

// Every mpv still running, so none can outlive the app (see killAllMpv).
const running = new Set<{ kill(): boolean }>()

export function killAllMpv(): void {
  for (const child of running) child.kill()
  running.clear()
}

type Deps = {
  spawn: typeof spawn
  connect: (pipe: string) => Promise<MpvClient>
  raise: (hwnd: bigint) => Promise<boolean>
}
const realDeps: Deps = { spawn, connect: (pipe) => connectMpv(pipe), raise: (hwnd) => raiseMpvWindow(hwnd) }

export async function launchMpv(opts: { mpvPath: string; hwnd: bigint }, deps: Deps = realDeps): Promise<MpvProcess> {
  const pipe = `\\\\.\\pipe\\vp-mpv-${process.pid}-${++launches}`
  const child = deps.spawn(opts.mpvPath, [`--wid=${opts.hwnd}`, `--input-ipc-server=${pipe}`, ...FLAGS], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })
  running.add(child)
  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)))

  let quitting = false
  const exitCallbacks: ((expected: boolean) => void)[] = []
  const exited = new Promise<void>((resolve) => {
    child.once('exit', (code) => {
      running.delete(child)
      if (!quitting) console.error(`mpv exited unexpectedly (code ${code}):\n${stderr}`)
      for (const cb of exitCallbacks) cb(quitting)
      resolve()
    })
  })

  let client: MpvClient
  try {
    client = await deps.connect(pipe)
    if (!(await deps.raise(opts.hwnd))) console.warn('mpv window not found; the picture may be hidden')
  } catch (e) {
    quitting = true
    child.kill()
    throw e
  }

  return {
    client,
    onExit: (cb) => void exitCallbacks.push(cb),
    // Ask mpv to quit, then kill it if it hasn't exited within 1 s.
    async quit() {
      quitting = true
      if (child.exitCode !== null) return
      await client.command('quit').catch(() => {})
      const timer = setTimeout(() => child.kill(), 1000)
      await exited
      clearTimeout(timer)
      client.close()
    }
  }
}
