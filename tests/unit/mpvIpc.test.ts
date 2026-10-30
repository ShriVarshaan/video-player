import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAppError } from '@shared/appError'
import { connectMpv, type MpvClient } from '../../src/main/player/mpvIpc'

let pipe: string
let server: Server | null = null
let client: MpvClient | null = null
const sockets: Socket[] = []

const newPipe = () => `\\\\.\\pipe\\vp-test-${process.pid}-${Math.random().toString(36).slice(2)}`

// A fake mpv: records each request and lets the test answer it.
function serve(onLine: (msg: Record<string, unknown>, socket: Socket) => void = () => {}): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((socket) => {
      sockets.push(socket)
      let buf = ''
      socket.on('data', (d) => {
        buf += d.toString()
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          if (line) onLine(JSON.parse(line) as Record<string, unknown>, socket)
        }
      })
    })
    server.listen(pipe, resolve)
  })
}

const send = (socket: Socket, msg: unknown) => socket.write(JSON.stringify(msg) + '\n')
const codeOf = (e: unknown) => parseAppError(e)?.code
const messageOf = (e: unknown) => parseAppError(e)?.message ?? ''

afterEach(async () => {
  client?.close()
  client = null
  for (const s of sockets.splice(0)) s.destroy()
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server = null
})

describe('connectMpv', () => {
  it('retries until the pipe exists', async () => {
    pipe = newPipe()
    setTimeout(() => void serve(), 200)
    client = await connectMpv(pipe, { timeoutMs: 3000 })
    expect(client).toBeTruthy()
  })

  it('fails after the connect timeout', async () => {
    pipe = newPipe()
    const err = await connectMpv(pipe, { timeoutMs: 300 }).catch((e: unknown) => e)
    expect(codeOf(err)).toBe('mpv')
    expect(messageOf(err)).toContain('mpv did not start')
  })

  it('matches responses to requests by request_id', async () => {
    pipe = newPipe()
    const pending: { id: number; socket: Socket; cmd: unknown[] }[] = []
    await serve((msg, socket) => {
      pending.push({ id: msg['request_id'] as number, socket, cmd: msg['command'] as unknown[] })
      if (pending.length === 2) {
        for (const p of [...pending].reverse()) send(p.socket, { request_id: p.id, error: 'success', data: p.cmd[1] })
      }
    })
    client = await connectMpv(pipe)
    const [a, b] = await Promise.all([client.command('get_property', 'a'), client.command('get_property', 'b')])
    expect([a, b]).toEqual(['a', 'b'])
  })

  it('handles messages split across chunks and several in one chunk', async () => {
    pipe = newPipe()
    await serve((msg, socket) => {
      const id = msg['request_id'] as number
      if (id === 1) {
        const text = JSON.stringify({ request_id: 1, error: 'success', data: 'one' }) + '\n'
        socket.write(text.slice(0, 10))
        setTimeout(() => socket.write(text.slice(10)), 30)
      } else {
        socket.write(
          JSON.stringify({ event: 'seek' }) + '\n' + JSON.stringify({ request_id: id, error: 'success', data: 'two' }) + '\n'
        )
      }
    })
    client = await connectMpv(pipe)
    const events: string[] = []
    client.on('seek', (m) => events.push(String(m['event'])))
    expect(await client.command('x')).toBe('one')
    expect(await client.command('y')).toBe('two')
    expect(events).toEqual(['seek'])
  })

  it('rejects a command after commandTimeoutMs', async () => {
    pipe = newPipe()
    await serve()
    client = await connectMpv(pipe, { commandTimeoutMs: 100 })
    const err = await client.command('get_property', 'pause').catch((e: unknown) => e)
    expect(codeOf(err)).toBe('mpv')
  })

  it('rejects when mpv answers with an error', async () => {
    pipe = newPipe()
    await serve((msg, socket) => send(socket, { request_id: msg['request_id'], error: 'property not found' }))
    client = await connectMpv(pipe)
    const err = await client.command('get_property', 'nope').catch((e: unknown) => e)
    expect(codeOf(err)).toBe('mpv')
    expect(messageOf(err)).toContain('property not found')
  })

  it('observe sends observe_property with a fresh id and delivers property-change data', async () => {
    pipe = newPipe()
    const observed: unknown[][] = []
    await serve((msg, socket) => {
      const cmd = msg['command'] as unknown[]
      observed.push(cmd)
      send(socket, { request_id: msg['request_id'], error: 'success' })
      if (cmd[0] === 'observe_property') {
        send(socket, { event: 'property-change', id: cmd[1], name: cmd[2], data: cmd[2] === 'pause' ? true : 12.5 })
      }
    })
    client = await connectMpv(pipe)
    const pause: unknown[] = []
    const time: unknown[] = []
    const got = new Promise<void>((r) => {
      let n = 0
      const done = () => ++n === 2 && r()
      void client!.observe('pause', (v) => (pause.push(v), done()))
      void client!.observe('time-pos', (v) => (time.push(v), done()))
    })
    await got
    expect(observed.map((c) => c.slice(0, 3))).toEqual([
      ['observe_property', 1, 'pause'],
      ['observe_property', 2, 'time-pos']
    ])
    expect(pause).toEqual([true])
    expect(time).toEqual([12.5])
  })

  it('delivers events and stops after unsubscribe', async () => {
    pipe = newPipe()
    await serve()
    client = await connectMpv(pipe)
    while (sockets.length === 0) await new Promise((r) => setTimeout(r, 5))
    const socket = sockets[0]!
    const seen: unknown[] = []
    const off = client.on('end-file', (m) => seen.push(m['reason']))
    send(socket, { event: 'end-file', reason: 'eof' })
    await new Promise((r) => setTimeout(r, 50))
    off()
    send(socket, { event: 'end-file', reason: 'stop' })
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual(['eof'])
  })

  it('calls onClose and rejects pending commands when the pipe closes', async () => {
    pipe = newPipe()
    await serve((_msg, socket) => socket.destroy())
    client = await connectMpv(pipe)
    const closed = new Promise<void>((r) => client!.onClose(r))
    const err = await client.command('quit').catch((e: unknown) => e)
    await closed
    expect(codeOf(err)).toBe('mpv')
  })
})
