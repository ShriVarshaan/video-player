import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, BinaryName } from '@shared/api'
import { catchAppError } from '@shared/appError'
import type { LibraryFolder, MetadataStatus, ScanProgress } from '@shared/library'

const PHASE_LABEL: Record<Exclude<ScanProgress['phase'], 'idle'>, string> = {
  scanning: 'Scanning',
  probing: 'Reading',
  matching: 'Matching',
  images: 'Fetching images'
}

const BINARIES: BinaryName[] = ['mpv', 'ffmpeg', 'ffprobe']

// Library folders, the TMDB key and app details. The full settings screen is milestone 9.
export function Settings() {
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [status, setStatus] = useState<MetadataStatus | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<LibraryFolder | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const report = (e: unknown) => catchAppError(e, { DEFAULT: ({ message }) => setError(message) })

  const load = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([window.api.library.listFolders({}), window.api.metadata.status({})])
      setFolders(f)
      setStatus(s)
    } catch (e) {
      report(e)
    }
  }, [])

  useEffect(() => {
    void load()
    window.api.app.getInfo({}).then(setInfo).catch(report)
    const offChanged = window.api.on('library.changed', () => void load())
    const offProgress = window.api.on('library.progress', setProgress)
    return () => {
      offChanged()
      offProgress()
    }
  }, [load])

  async function addFolder() {
    setError(null)
    try {
      if (await window.api.library.addFolder({})) await load()
    } catch (e) {
      report(e)
    }
  }

  async function removeFolder(folder: LibraryFolder) {
    setConfirmRemove(null)
    try {
      await window.api.library.removeFolder({ id: folder.id })
      await load()
    } catch (e) {
      report(e)
    }
  }

  async function saveKey(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await window.api.metadata.setTmdbKey({ key })
      setKey('')
      await load()
    } catch (e) {
      report(e)
    }
  }

  const missing = info ? BINARIES.filter((name) => !info.binaries[name].exists) : []

  return (
    <section className="page settings">
      <h1>Settings</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <h2>Library folders</h2>
      <ul className="folders">
        {folders.map((f) => (
          <li key={f.id} data-testid="folder-row">
            <span className="path">{f.path}</span>
            {!f.online && <span className="badge">Offline</span>}
            <span className="muted">{f.videoCount} videos</span>
            <button type="button" className="quiet" onClick={() => setConfirmRemove(f)}>
              Remove
            </button>
          </li>
        ))}
        {folders.length === 0 && <li className="muted">No folders yet. Add the folders that hold your movies and shows.</li>}
      </ul>
      {confirmRemove && (
        <div role="dialog" aria-labelledby="remove-title" className="confirm">
          <p id="remove-title">Remove this folder? Watch progress for its videos will be deleted.</p>
          <button type="button" onClick={() => void removeFolder(confirmRemove)}>
            Remove
          </button>
          <button type="button" className="quiet" onClick={() => setConfirmRemove(null)}>
            Cancel
          </button>
        </div>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={() => void addFolder()}>
          Add folder
        </button>
        <button type="button" onClick={() => void window.api.library.rescan({}).catch(report)}>
          Rescan
        </button>
        {progress && progress.phase !== 'idle' && (
          <span className="muted" aria-live="polite">
            {PHASE_LABEL[progress.phase]}
            {progress.total > 0 ? ` ${progress.done} of ${progress.total}` : '…'}
          </span>
        )}
      </div>

      <h2>TMDB</h2>
      <form className="tmdb" onSubmit={(e) => void saveKey(e)}>
        <label htmlFor="tmdb-key">TMDB API key or read access token</label>
        <input id="tmdb-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        <button type="submit">Save key</button>
        {status?.hasKey && <span className="muted">TMDB key saved</span>}
        <p className="muted small">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </form>

      <h2>About</h2>
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
      {missing.length > 0 && <p className="muted">Run npm run fetch-vendor to download mpv and ffmpeg.</p>}
    </section>
  )
}
