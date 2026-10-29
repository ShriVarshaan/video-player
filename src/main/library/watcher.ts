import { watch } from 'node:fs'

// Calls onChange once per burst of changes anywhere under path. Windows supports
// recursive watching natively. Watchers miss changes while the app is closed and
// can be unreliable on network drives; the startup and manual rescans cover those.
export function watchFolder(path: string, onChange: () => void, debounceMs = 2000): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: ReturnType<typeof watch>
  try {
    watcher = watch(path, { recursive: true }, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, debounceMs)
    })
  } catch {
    return () => {}
  }
  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
    watcher.close()
  }
  // A drive that is unplugged errors the watcher; the next rescan notices.
  watcher.on('error', stop)
  return stop
}
