// Structured errors that survive Electron's IPC serialization.
// Main throws with throwAppError; the renderer handles with catchAppError.

export class AppErrorClass extends Error {}

export type AppErrorCode = 'db_too_new' | 'db_migration_failed' | 'invalid_argument' | 'unknown'

export const appErrorMessages: Record<AppErrorCode, string> = {
  db_too_new:
    'The library database was created by a newer version of Video Player. Update the app to open it.',
  db_migration_failed: 'The library database could not be upgraded.',
  invalid_argument: 'An invalid value was passed.',
  unknown: 'An unknown error occurred.'
}

export type AppError = {
  message: string
  code: AppErrorCode
  payload?: unknown
}

export function throwAppError(code: AppErrorCode): never
export function throwAppError(options: {
  message?: string
  code?: AppErrorCode
  payload?: unknown
}): never
export function throwAppError(
  codeOrOptions: AppErrorCode | { message?: string; code?: AppErrorCode; payload?: unknown }
): never {
  if (typeof codeOrOptions === 'string') {
    throw new AppErrorClass(
      JSON.stringify({ message: appErrorMessages[codeOrOptions], code: codeOrOptions })
    )
  }
  const { code = 'unknown', message = appErrorMessages[code], payload } = codeOrOptions
  throw new AppErrorClass(JSON.stringify({ message, code, payload }))
}

// Internal: Electron prepends text to the message, so read the JSON object at its end.
export const parseAppError = (error: unknown): AppError | null => {
  if (!(error instanceof Error)) return null
  const message = error.message.trim()
  let depth = 0
  let start = -1
  for (let i = message.length - 1; i >= 0; i--) {
    if (message[i] === '}') depth++
    else if (message[i] === '{') {
      depth--
      if (depth === 0) {
        start = i
        break
      }
    }
  }
  if (start === -1) return null
  try {
    const parsed: unknown = JSON.parse(message.substring(start))
    if (parsed && typeof parsed === 'object' && typeof (parsed as AppError).code === 'string') {
      return parsed as AppError
    }
  } catch {
    return null
  }
  return null
}

export const catchAppError = (
  e: unknown,
  handlers: Partial<Record<AppErrorCode | 'DEFAULT', (error: AppError) => void>>
): void => {
  const appError = parseAppError(e)
  if (appError) {
    const handler = handlers[appError.code] ?? handlers.DEFAULT
    handler?.(appError)
    return
  }
  handlers.DEFAULT?.({ message: appErrorMessages.unknown, code: 'unknown', payload: e })
}
