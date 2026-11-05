import { useEffect, useState } from 'react'
import './setup.css'

// A quiet note on Home while there's no TMDB key. Rendered only while Home is showing, so it
// rereads the key each time someone comes back to it.
export function TmdbReminder({ onSettings }: { onSettings: () => void }) {
  const [hasKey, setHasKey] = useState(true)

  useEffect(() => {
    const load = () => window.api.metadata.status({}).then((s) => setHasKey(s.hasKey), () => {})
    void load()
    return window.api.on('library.changed', () => void load())
  }, [])

  if (hasKey) return null
  return (
    <aside className="tmdb-reminder" data-testid="tmdb-reminder" data-wall-ignore="">
      <span>Add a free TMDB key to get posters.</span>
      <button type="button" onClick={onSettings}>
        Open Settings
      </button>
    </aside>
  )
}
