import { parseAppError } from '@shared/appError'

// A startup failure must never leave a windowless process running: it would hold
// the single-instance lock and make every later launch exit silently.
export async function startOrQuit(
  start: () => void | Promise<void>,
  { report, quit }: { report: (message: string) => void; quit: () => void }
): Promise<void> {
  try {
    await start()
  } catch (e) {
    report(parseAppError(e)?.message ?? (e instanceof Error ? e.message : String(e)))
    quit()
  }
}
