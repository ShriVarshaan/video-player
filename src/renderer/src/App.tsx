import { useEffect, useState } from 'react'
import type { AppInfo, BinaryName } from '@shared/api'
import { catchAppError } from '@shared/appError'
import './app.css'

const BINARIES: BinaryName[] = ['mpv', 'ffmpeg', 'ffprobe']

// Placeholder shell; the poster wall replaces it in milestone 3.
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.app
      .getInfo({})
      .then(setInfo)
      .catch((e: unknown) => catchAppError(e, { DEFAULT: ({ message }) => setError(message) }))
  }, [])

  const missing = info ? BINARIES.filter((name) => !info.binaries[name].exists) : []

  return (
    <main className="shell">
      <h1>Video Player</h1>
      {error && <p role="alert">{error}</p>}
      {info && (
        <dl>
          <dt>Version</dt>
          <dd data-testid="version">{info.version}</dd>
          <dt>Library database</dt>
          <dd data-testid="db-path">{info.dbPath}</dd>
          {BINARIES.map((name) => (
            <div key={name} className="row" data-testid={`bin-${name}`} data-exists={String(info.binaries[name].exists)}>
              <dt>{name}</dt>
              <dd>{info.binaries[name].exists ? 'found' : 'missing'}</dd>
            </div>
          ))}
        </dl>
      )}
      {missing.length > 0 && <p className="hint">Run npm run fetch-vendor to download mpv and ffmpeg.</p>}
    </main>
  )
}
