import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createSidecar, SidecarError, type SyncParams } from '../../src/main/sync/sidecar'

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  sent: Record<string, unknown>[] = []
  constructor() {
    super()
    let buf = ''
    this.stdin.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        this.sent.push(JSON.parse(buf.slice(0, i)))
        buf = buf.slice(i + 1)
      }
    })
  }
  reply(obj: unknown) {
    this.stdout.write(JSON.stringify(obj) + '\r\n')
  }
  kill() {
    this.killed = true
    return true
  }
}

const COMMAND = { cmd: 'C:\\py.exe', args: ['-m', 'vp_sync'], cwd: 'C:\\sidecar' }
const PARAMS: SyncParams = { video: 'C:\\m\\Amélie.mkv', subtitle: 'C:\\t\\s.srt', audioStream: 0, durationS: 100 }
const tick = () => new Promise((r) => setTimeout(r, 5))

function setup(command: typeof COMMAND | null = COMMAND) {
  const children: FakeChild[] = []
  const spawn = vi.fn(() => {
    const c = new FakeChild()
    children.push(c)
    return c
  })
  const log = vi.fn()
  const sidecar = createSidecar({ command, ffmpeg: 'C:\\vendor\\ffmpeg.exe', spawn: spawn as never, log })
  return { sidecar, spawn, children, log }
}

async function started(s: ReturnType<typeof setup>) {
  const p = s.sidecar.sync(PARAMS, () => {})
  await tick()
  return { p, child: s.children.at(-1)! }
}

describe('createSidecar', () => {
  it('does not spawn until the first sync', () => {
    const { spawn } = setup()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('sends one JSON line and resolves the result', async () => {
    const s = setup()
    const { p, child } = await started(s)
    expect(child.sent).toEqual([{ id: 1, method: 'sync', params: PARAMS }])
    child.reply({ id: 1, result: { offset: -3.2, scale: 1, score: 13 } })
    await expect(p).resolves.toEqual({ offset: -3.2, scale: 1, score: 13 })
  })

  it('forwards progress events', async () => {
    const s = setup()
    const seen: unknown[] = []
    const p = s.sidecar.sync(PARAMS, (e) => seen.push(e))
    await tick()
    const child = s.children[0]!
    child.reply({ id: 1, event: 'progress', stage: 'audio', pct: 0.4 })
    child.reply({ id: 1, event: 'progress', stage: 'match', pct: null })
    child.reply({ id: 1, result: { offset: 0, scale: 1, score: 9 } })
    await p
    expect(seen).toEqual([
      { stage: 'audio', pct: 0.4 },
      { stage: 'match', pct: null }
    ])
  })

  it('maps an error line to SidecarError with its code', async () => {
    const s = setup()
    const { p, child } = await started(s)
    child.reply({ id: 1, error: { code: 'NO_MATCH', message: 'no' } })
    await expect(p).rejects.toMatchObject({ code: 'NO_MATCH' })
    await expect(p).rejects.toBeInstanceOf(SidecarError)
  })

  it('cancel sends cancel for the running id', async () => {
    const s = setup()
    const { p, child } = await started(s)
    s.sidecar.cancel()
    await tick()
    expect(child.sent[1]).toEqual({ id: 2, method: 'cancel', params: { target: 1 } })
    child.reply({ id: 1, error: { code: 'CANCELLED', message: 'cancelled' } })
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('missing command rejects UNAVAILABLE', async () => {
    const s = setup(null)
    await expect(s.sidecar.sync(PARAMS, () => {})).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(s.spawn).not.toHaveBeenCalled()
  })

  it('spawn error (ENOENT) rejects UNAVAILABLE', async () => {
    const s = setup()
    const { p, child } = await started(s)
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    await expect(p).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })

  it('crash fails the pending job and the next sync respawns', async () => {
    const s = setup()
    const { p, child } = await started(s)
    child.emit('exit', 1, null)
    await expect(p).rejects.toMatchObject({ code: 'INTERNAL' })
    const again = s.sidecar.sync(PARAMS, () => {})
    await tick()
    expect(s.spawn).toHaveBeenCalledTimes(2)
    s.children[1]!.reply({ id: 2, result: { offset: 1, scale: 1, score: 9 } })
    await expect(again).resolves.toMatchObject({ offset: 1 })
  })

  it('stderr goes to log, never parsed', async () => {
    const s = setup()
    const { p, child } = await started(s)
    child.stderr.write('{"id":1,"result":{"offset":99}}\n')
    child.stdout.write('not json\n')
    child.reply({ id: 1, result: { offset: 2, scale: 1, score: 9 } })
    await expect(p).resolves.toMatchObject({ offset: 2 })
    expect(s.log).toHaveBeenCalledWith(expect.stringContaining('"offset":99'))
    expect(s.log).toHaveBeenCalledWith(expect.stringContaining('not json'))
  })

  it('passes VP_FFMPEG, PYTHONIOENCODING and PYTHONUNBUFFERED', async () => {
    const s = setup()
    await started(s)
    const [cmd, args, opts] = s.spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: Record<string, string>; windowsHide: boolean }]
    expect(cmd).toBe(COMMAND.cmd)
    expect(args).toEqual(COMMAND.args)
    expect(opts.cwd).toBe(COMMAND.cwd)
    expect(opts.env).toMatchObject({ VP_FFMPEG: 'C:\\vendor\\ffmpeg.exe', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' })
    expect(opts.windowsHide).toBe(true)
  })

  it('dispose cancels the job and closes stdin, so the helper cleans up and exits', async () => {
    const s = setup()
    const { p, child } = await started(s)
    let ended = false
    child.stdin.on('finish', () => (ended = true))
    vi.useFakeTimers()
    try {
      s.sidecar.dispose()
      await expect(p).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(child.sent.at(-1)).toEqual({ id: 2, method: 'cancel', params: { target: 1 } })
      await vi.advanceTimersByTimeAsync(0)
      expect(ended).toBe(true)
      expect(child.killed).toBe(false)
      child.emit('exit', 0, null)
      await vi.advanceTimersByTimeAsync(5000)
      expect(child.killed).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a broken stdin pipe is logged, not thrown', async () => {
    const s = setup()
    const { p, child } = await started(s)
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    expect(s.log).toHaveBeenCalledWith(expect.stringContaining('EPIPE'))
    child.reply({ id: 1, result: { offset: 0, scale: 1, score: 9 } })
    await p
  })

  it('dispose kills a helper that has not exited after the grace period', async () => {
    const s = setup()
    const { child } = await started(s).then((r) => (r.p.catch(() => {}), r))
    vi.useFakeTimers()
    try {
      s.sidecar.dispose()
      await vi.advanceTimersByTimeAsync(1999)
      expect(child.killed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(child.killed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
