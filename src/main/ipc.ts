import { apiMethods, channelFor, type API, type Domain } from '@shared/api'
import { AppErrorClass, parseAppError, throwAppError } from '@shared/appError'

type Fn = (params: unknown) => Promise<unknown>

// The slice of ipcMain we use; a plain object stands in for it in tests.
export type IpcHandle = {
  handle(channel: string, listener: (event: unknown, params: unknown) => Promise<unknown>): void
}

// Registers every method of a domain on its derived channel. Typing handlers as
// API[D] makes a missing method a compile error.
export function registerDomain<D extends Domain>(
  ipc: IpcHandle,
  domain: D,
  handlers: API[D]
): void {
  for (const method of Object.keys(apiMethods[domain])) {
    const fn = (handlers as Record<string, Fn>)[method]!
    ipc.handle(channelFor(domain, method), async (_event, params) => {
      try {
        return await fn(params)
      } catch (error) {
        if (error instanceof AppErrorClass) throw error
        const appError = parseAppError(error)
        if (appError) throw new AppErrorClass(JSON.stringify(appError))
        throwAppError({
          code: 'unknown',
          payload: { cause: error instanceof Error ? error.message : String(error) }
        })
      }
    })
  }
}
