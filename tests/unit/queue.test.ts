import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLimiter, throttle } from '../../src/main/library/queue'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createLimiter', () => {
  it('runs at most n tasks at once', async () => {
    const limit = createLimiter(2)
    let running = 0
    let peak = 0
    const gates = Array.from({ length: 5 }, deferred)
    const all = gates.map((g) =>
      limit(async () => {
        running++
        peak = Math.max(peak, running)
        await g.promise
        running--
      })
    )
    await Promise.resolve()
    expect(running).toBe(2)
    gates.forEach((g) => g.resolve())
    await Promise.all(all)
    expect(peak).toBe(2)
  })

  it('frees the slot when a task fails', async () => {
    const limit = createLimiter(1)
    await expect(limit(async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(await limit(async () => 'next')).toBe('next')
  })
})

describe('throttle', () => {
  afterEach(() => vi.useRealTimers())

  it('calls at once, then delivers the last call after the wait', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttle(fn, 200)
    for (let i = 1; i <= 10; i++) t(i)
    expect(fn.mock.calls).toEqual([[1]])
    vi.advanceTimersByTime(200)
    expect(fn.mock.calls).toEqual([[1], [10]])
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('drops a pending trailing call on cancel', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = throttle(fn, 200)
    t(1)
    t(2)
    t.cancel()
    vi.advanceTimersByTime(500)
    expect(fn.mock.calls).toEqual([[1]])
  })
})
