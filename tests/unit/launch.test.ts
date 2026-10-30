import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { killAllMpv, launchMpv } from '../../src/main/player/launch'
import type { MpvClient } from '../../src/main/player/mpvIpc'

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    stderr: new EventEmitter(),
    kill: vi.fn(() => {
      child.exitCode = 1
      child.emit('exit', 1)
      return true
    })
  })
  return child
}

const client = { command: vi.fn(async () => null), close: vi.fn() } as unknown as MpvClient

describe('launchMpv', () => {
  it('kills mpv when its window cannot be raised', async () => {
    const child = fakeChild()
    const launching = launchMpv(
      { mpvPath: 'mpv.exe', hwnd: 1n },
      {
        spawn: () => child as never,
        connect: async () => client,
        raise: async () => {
          throw new Error('koffi failed to load')
        }
      }
    )
    await expect(launching).rejects.toThrow('koffi failed to load')
    expect(child.kill).toHaveBeenCalled()
  })

  it('kills mpv when the pipe never connects', async () => {
    const child = fakeChild()
    await expect(
      launchMpv({ mpvPath: 'mpv.exe', hwnd: 1n }, { spawn: () => child as never, connect: async () => Promise.reject(new Error('no pipe')), raise: async () => true })
    ).rejects.toThrow('no pipe')
    expect(child.kill).toHaveBeenCalled()
  })

  it('killAllMpv kills every mpv still running, so none outlives the app', async () => {
    const a = fakeChild()
    const b = fakeChild()
    const deps = (c: ReturnType<typeof fakeChild>) => ({ spawn: () => c as never, connect: async () => client, raise: async () => true })
    await launchMpv({ mpvPath: 'mpv.exe', hwnd: 1n }, deps(a))
    await launchMpv({ mpvPath: 'mpv.exe', hwnd: 1n }, deps(b))
    b.kill()
    b.kill.mockClear()
    killAllMpv()
    expect(a.kill).toHaveBeenCalled()
    expect(b.kill).not.toHaveBeenCalled()
  })
})
