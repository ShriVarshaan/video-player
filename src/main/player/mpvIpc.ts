import { connect, type Socket } from 'node:net'
import { AppErrorClass, appErrorMessages } from '@shared/appError'

// Typed client for mpv's JSON IPC over a Windows named pipe (mpv-ipc skill).
// Newline-delimited JSON; responses carry our request_id; events and property
// changes arrive unasked.
export type MpvClient = {
  command(...args: unknown[]): Promise<unknown>
  observe(name: string, cb: (value: unknown) => void): Promise<void>
  on(event: string, cb: (msg: Record<string, unknown>) => void): () => void
  onClose(cb: () => void): void
  close(): void
}

type Opts = { retryMs?: number; timeoutMs?: number; commandTimeoutMs?: number }

const mpvError = (message: string) =>
  new AppErrorClass(JSON.stringify({ code: 'mpv', message: message || appErrorMessages.mpv }))

function tryConnect(pipe: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = connect(pipe)
    socket.once('connect', () => resolve(socket))
    socket.once('error', () => resolve(null))
  })
}

// mpv creates the pipe a few hundred ms after it starts, so retry until it exists.
export async function connectMpv(pipe: string, opts: Opts = {}): Promise<MpvClient> {
  const { retryMs = 50, timeoutMs = 5000, commandTimeoutMs = 5000 } = opts
  const deadline = Date.now() + timeoutMs
  let socket: Socket | null = null
  while (!(socket = await tryConnect(pipe))) {
    if (Date.now() >= deadline) throw mpvError(`mpv did not start within ${timeoutMs / 1000} s.`)
    await new Promise((r) => setTimeout(r, retryMs))
  }
  const s = socket

  let nextRequest = 1
  let nextObserve = 1
  let closed = false
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }>()
  const observers = new Map<number, (value: unknown) => void>()
  const listeners = new Map<string, Set<(msg: Record<string, unknown>) => void>>()
  const closeCallbacks: (() => void)[] = []

  const handle = (msg: Record<string, unknown>) => {
    if (typeof msg['request_id'] === 'number' && pending.has(msg['request_id'])) {
      const p = pending.get(msg['request_id'])!
      pending.delete(msg['request_id'])
      clearTimeout(p.timer)
      if (msg['error'] === 'success') p.resolve(msg['data'] ?? null)
      else p.reject(mpvError(`mpv: ${String(msg['error'])}`))
      return
    }
    const event = msg['event']
    if (typeof event !== 'string') return
    if (event === 'property-change' && typeof msg['id'] === 'number') observers.get(msg['id'])?.(msg['data'])
    for (const cb of listeners.get(event) ?? []) cb(msg)
  }

  let buf = ''
  s.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      try {
        handle(JSON.parse(line) as Record<string, unknown>)
      } catch {
        // Not JSON: ignore the line, keep the connection.
      }
    }
  })

  const onClosed = () => {
    if (closed) return
    closed = true
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(mpvError('mpv closed the connection.'))
    }
    pending.clear()
    for (const cb of closeCallbacks) cb()
  }
  s.on('close', onClosed)
  s.on('error', onClosed)

  const command = (...args: unknown[]): Promise<unknown> => {
    if (closed) return Promise.reject(mpvError('mpv closed the connection.'))
    const id = nextRequest++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(mpvError(`mpv did not answer "${String(args[0])}".`))
      }, commandTimeoutMs)
      pending.set(id, { resolve, reject, timer })
      s.write(JSON.stringify({ command: args, request_id: id }) + '\n')
    })
  }

  return {
    command,
    async observe(name, cb) {
      const id = nextObserve++
      observers.set(id, cb)
      await command('observe_property', id, name)
    },
    on(event, cb) {
      const set = listeners.get(event) ?? new Set()
      listeners.set(event, set)
      set.add(cb)
      return () => void set.delete(cb)
    },
    onClose(cb) {
      if (closed) cb()
      else closeCallbacks.push(cb)
    },
    close() {
      s.destroy()
      onClosed()
    }
  }
}
