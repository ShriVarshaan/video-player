import { useCallback, useEffect, useState } from 'react'
import { catchAppError } from '@shared/appError'
import type { LibraryFolder, MetadataStatus, MovieItem, ScanProgress, ShowItem } from '@shared/library'
import { ShowView } from './ShowView'

const PHASE_LABEL: Record<Exclude<ScanProgress['phase'], 'idle'>, string> = {
  scanning: 'Scanning',
  probing: 'Reading',
  matching: 'Matching',
  images: 'Fetching images'
}

// Placeholder library screen (milestone 2). The wall replaces it in milestone 3.
export function Library() {
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [movies, setMovies] = useState<MovieItem[]>([])
  const [shows, setShows] = useState<ShowItem[]>([])
  const [status, setStatus] = useState<MetadataStatus | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [openShow, setOpenShow] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<LibraryFolder | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const report = (e: unknown) => catchAppError(e, { DEFAULT: ({ message }) => setError(message) })

  const load = useCallback(async () => {
    try {
      const [f, lib, s] = await Promise.all([
        window.api.library.listFolders({}),
        window.api.library.list({}),
        window.api.metadata.status({})
      ])
      setFolders(f)
      setMovies(lib.movies)
      setShows(lib.shows)
      setStatus(s)
    } catch (e) {
      report(e)
    }
  }, [])

  useEffect(() => {
    void load()
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

  if (openShow) return <ShowView showKey={openShow} onBack={() => setOpenShow(null)} />

  return (
    <section className="library">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <h2>Folders</h2>
      <ul className="folders">
        {folders.map((f) => (
          <li key={f.id} data-testid="folder-row">
            <span className="path">{f.path}</span>
            {!f.online && <span className="badge">Offline</span>}
            <span className="muted">{f.videoCount} videos</span>
            <button type="button" onClick={() => setConfirmRemove(f)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {confirmRemove && (
        <div role="dialog" aria-labelledby="remove-title" className="confirm">
          <p id="remove-title">Remove this folder? Watch progress for its videos will be deleted.</p>
          <button type="button" onClick={() => void removeFolder(confirmRemove)}>
            Remove
          </button>
          <button type="button" onClick={() => setConfirmRemove(null)}>
            Cancel
          </button>
        </div>
      )}
      <div className="actions">
        <button type="button" onClick={() => void addFolder()}>
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

      <form className="tmdb" onSubmit={(e) => void saveKey(e)}>
        <label htmlFor="tmdb-key">TMDB API key or read access token</label>
        <input id="tmdb-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        <button type="submit">Save key</button>
        {status?.hasKey && <span className="muted">TMDB key saved</span>}
        <p className="muted small">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </form>

      <h2>Movies</h2>
      <ul className="grid">
        {movies.map((m) => (
          <li key={m.videoId} data-testid="movie-item">
            <Poster src={m.posterUrl} />
            <span>{m.title}</span>
            {m.year !== null && <span className="muted"> {m.year}</span>}
          </li>
        ))}
      </ul>

      <h2>Shows</h2>
      <ul className="grid">
        {shows.map((s) => (
          <li key={s.key}>
            <button type="button" className="tile" data-testid="show-item" onClick={() => setOpenShow(s.key)}>
              <Poster src={s.posterUrl} />
              <span>{s.name}</span>
              <span className="muted"> {s.episodeCount} {s.episodeCount === 1 ? 'episode' : 'episodes'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Poster({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div className="poster placeholder" aria-hidden="true" />
  return <img className="poster" src={src} alt="" onError={() => setFailed(true)} />
}
