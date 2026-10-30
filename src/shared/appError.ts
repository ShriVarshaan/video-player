// Structured errors that survive Electron's IPC serialization.
// Main throws with throwAppError; the renderer handles with catchAppError.

export class AppErrorClass extends Error {}

export type AppErrorCode =
  | 'db_too_new'
  | 'db_migration_failed'
  | 'invalid_argument'
  | 'tmdb_key_invalid'
  | 'tmdb_unavailable'
  | 'tmdb_not_found'
  | 'tmdb_storage_unavailable'
  | 'mpv'
  | 'unknown'

export const appErrorMessages: Record<AppErrorCode, string> = {
  db_too_new:
    'The library database was created by a newer version of Video Player. Update the app to open it.',
  db_migration_failed: 'The library database could not be upgraded.',
  invalid_argument: 'An invalid value was passed.',
  tmdb_key_invalid: 'TMDB did not accept this API key.',
  tmdb_unavailable: 'TMDB could not be reached. Movie details will be fetched later.',
  tmdb_not_found: 'TMDB has no record of this title.',
  tmdb_storage_unavailable: 'Windows could not encrypt the TMDB key, so it was not saved.',
  mpv: 'The video player stopped responding.',
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

// Internal: Electron prepends text to the message, so the JSON object runs from
// some '{' to the end. Try each '{' from the left; braces inside JSON strings
// make counting them unreliable.
export const parseAppError = (error: unknown): AppError | null => {
  if (!(error instanceof Error)) return null
  const message = error.message.trim()
  for (let i = message.indexOf('{'); i !== -1; i = message.indexOf('{', i + 1)) {
    try {
      const parsed: unknown = JSON.parse(message.substring(i))
      if (parsed && typeof parsed === 'object' && typeof (parsed as AppError).code === 'string') {
        return parsed as AppError
      }
    } catch {
      // Not the start of the object; keep looking.
    }
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
