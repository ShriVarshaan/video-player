import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

// The auto sync sidecar (subtitle-sync-ml): one long-lived process speaking
// JSON lines, started on the first sync and restarted after a crash.

export type SidecarCode = 'NO_MATCH' | 'NO_AUDIO' | 'FFMPEG_FAILED' | 'CANCELLED' | 'BUSY' | 'INTERNAL' | 'UNAVAILABLE'

export class SidecarError extends Error {
  constructor(
    public code: SidecarCode,
    message: string
  ) {
    super(message)
  }
}

export type SyncProgress = { stage: 'audio' | 'match'; pct: number | null }
export type SyncParams = { video: string; subtitle: string; audioStream: number; durationS: number | null }
export type SyncMeasure = { offset: number; scale: number; score: number }

export type Sidecar = {
  sync(p: SyncParams, onProgress: (p: SyncProgress) => void): Promise<SyncMeasure>
  cancel(): void
  dispose(): void
}

type Pending = {
  id: number
  resolve: (m: SyncMeasure) => void
  reject: (e: SidecarError) => void
  onProgress: (p: SyncProgress) => void
}

const CODES = new Set<string>(['NO_MATCH', 'NO_AUDIO', 'FFMPEG_FAILED', 'CANCELLED', 'BUSY', 'INTERNAL'])

export function createSidecar(opts: {
  command: { cmd: string; args: string[]; cwd: string } | null
  ffmpeg: string
  spawn?: typeof nodeSpawn
  log?: (line: string) => void
}): Sidecar {
  const spawn = opts.spawn ?? nodeSpawn
  const log = opts.log ?? ((line: string) => console.error(`[sidecar] ${line}`))
  let child: ChildProcess | null = null
  let nextId = 1
  let pending: Pending | null = null

  function fail(e: SidecarError) {
    const p = pending
    pending = null
    p?.reject(e)
  }

  function onLine(line: string) {
    let msg: { id?: number; event?: string; stage?: string; pct?: number | null; result?: SyncMeasure; error?: { code?: string; message?: string } }
    try {
      msg = JSON.parse(line)
    } catch {
      if (line.trim()) log(line)
      return
    }
    const p = pending
    if (!p || msg.id !== p.id) return
    if (msg.event === 'progress') {
      if (msg.stage === 'audio' || msg.stage === 'match') p.onProgress({ stage: msg.stage, pct: typeof msg.pct === 'number' ? msg.pct : null })
    } else if (msg.result) {
      pending = null
      p.resolve(msg.result)
    } else if (msg.error) {
      pending = null
      const code = CODES.has(msg.error.code ?? '') ? (msg.error.code as SidecarCode) : 'INTERNAL'
      p.reject(new SidecarError(code, msg.error.message ?? code))
    }
  }

  function start(cmd: { cmd: string; args: string[]; cwd: string }): ChildProcess {
    const c = spawn(cmd.cmd, cmd.args, {
      cwd: cmd.cwd,
      env: { ...process.env, VP_FFMPEG: opts.ffmpeg, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    createInterface({ input: c.stdout! }).on('line', onLine)
    createInterface({ input: c.stderr! }).on('line', (l) => log(l))
    c.on('error', (e: NodeJS.ErrnoException) => {
      if (child === c) child = null
      log(`spawn failed: ${e.message}`)
      fail(new SidecarError('UNAVAILABLE', e.message))
    })
    c.on('exit', (code, signal) => {
      if (child === c) child = null
      log(`exited (${code ?? signal})`)
      fail(new SidecarError('INTERNAL', 'The sync helper stopped.'))
    })
    return c
  }

  function send(obj: unknown) {
    child?.stdin?.write(JSON.stringify(obj) + '\n')
  }

  return {
    sync(params, onProgress) {
      if (!opts.command) return Promise.reject(new SidecarError('UNAVAILABLE', 'The sync helper is not installed.'))
      if (pending) return Promise.reject(new SidecarError('BUSY', 'A sync is already running.'))
      if (!child) child = start(opts.command)
      const id = nextId++
      return new Promise<SyncMeasure>((resolve, reject) => {
        pending = { id, resolve, reject, onProgress }
        send({ id, method: 'sync', params })
      })
    },
    cancel() {
      if (pending) send({ id: nextId++, method: 'cancel', params: { target: pending.id } })
    },
    dispose() {
      const c = child
      child = null
      fail(new SidecarError('CANCELLED', 'The app is closing.'))
      c?.kill()
    }
  }
}
