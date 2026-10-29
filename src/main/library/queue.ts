export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>

// Runs at most n tasks at a time; the rest wait in order.
export function createLimiter(n: number): Limiter {
  let active = 0
  const waiting: (() => void)[] = []
  return async (fn) => {
    if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

// Calls fn at once, then at most once per ms with the latest arguments.
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { cancel(): void } {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null
  const fire = () => {
    timer = null
    last = Date.now()
    if (pending) {
      const args = pending
      pending = null
      fn(...args)
    }
  }
  const call = (...a: A) => {
    const wait = last + ms - Date.now()
    if (wait <= 0 && !timer) {
      last = Date.now()
      fn(...a)
      return
    }
    pending = a
    timer ??= setTimeout(fire, Math.max(wait, 0))
  }
  return Object.assign(call, {
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    }
  })
}
