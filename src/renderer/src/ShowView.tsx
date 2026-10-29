import { useEffect, useState } from 'react'
import { catchAppError } from '@shared/appError'
import type { ShowDetail } from '@shared/library'

// Placeholder show page: the real one (and playback) arrive in milestones 3–4.
export function ShowView({ showKey, onBack }: { showKey: string; onBack: () => void }) {
  const [show, setShow] = useState<ShowDetail | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // A show opened before TMDB matched it changes key ('local:…' → 'tmdb:…').
  const [key, setKey] = useState(showKey)

  useEffect(() => {
    const load = () =>
      window.api.library
        .getShow({ key })
        .then((s) => {
          setShow(s)
          if (s && s.key !== key) setKey(s.key)
        })
        .catch((e: unknown) => catchAppError(e, { DEFAULT: ({ message }) => setError(message) }))
    void load()
    return window.api.on('library.changed', () => void load())
  }, [key])

  const next = show?.nextUp
  return (
    <section className="show">
      <button type="button" onClick={onBack}>
        Back
      </button>
      {error && <p role="alert">{error}</p>}
      {show === null && <p className="muted">This show is no longer in the library.</p>}
      {show && (
        <>
          <h2>{show.name}</h2>
          {show.overview && <p className="muted">{show.overview}</p>}
          {next && (
            <div data-testid="next-up" className="actions">
              {next.action === 'continue' ? (
                <>
                  <button type="button" disabled>
                    Continue watching
                  </button>
                  <button type="button" disabled>
                    Restart episode
                  </button>
                </>
              ) : (
                <button type="button" disabled>
                  Play episode
                </button>
              )}
              <span>
                S{next.season} · E{next.episode}
              </span>
              <span className="muted small">Playback arrives in a later milestone.</span>
            </div>
          )}
          {show.seasons.map((s) => (
            <div key={s.season}>
              <h3>{s.name}</h3>
              <ol className="episodes">
                {s.episodes.map((e) => (
                  <li key={e.videoId} data-testid="episode-item">
                    <span>
                      E{e.episode} · {e.title ?? `Episode ${e.episode}`}
                    </span>
                    {e.finished && <span className="muted"> watched</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
