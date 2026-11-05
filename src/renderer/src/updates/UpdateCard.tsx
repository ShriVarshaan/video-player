import type { UpdateState } from '@shared/updates'
import './updates.css'

const quietly = (call: Promise<void>) => void call.catch(() => {})

// The update offer on Home. App only renders it while Home is showing, so it never shows during a film.
export function UpdateCard({ state }: { state: UpdateState }) {
  const { install, later, skip, restart } = window.api.updates

  if (state.phase === 'available') {
    return (
      <aside className="update-card" data-testid="update-card" data-wall-ignore="">
        <h2>Cinewall {state.offer.version} is available</h2>
        {state.offer.notes && (
          <p className="update-notes" data-testid="update-notes">
            {state.offer.notes}
          </p>
        )}
        <div className="update-actions">
          <button type="button" className="primary" data-testid="update-install" onClick={() => quietly(install({}))}>
            Install
          </button>
          <button type="button" data-testid="update-later" onClick={() => quietly(later({}))}>
            Remind me later
          </button>
          <button type="button" className="quiet" data-testid="update-skip" onClick={() => quietly(skip({}))}>
            Skip this version
          </button>
        </div>
      </aside>
    )
  }

  if (state.phase === 'downloading') {
    return (
      <aside className="update-card" data-testid="update-card" data-wall-ignore="">
        <h2>Downloading Cinewall {state.offer.version}</h2>
        <div
          className="update-progress"
          data-testid="update-progress"
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={state.percent}
        >
          <i style={{ transform: `scaleX(${state.percent / 100})` }} />
        </div>
        <p className="update-notes">Keep browsing. Cinewall restarts when it's ready, and never during a film.</p>
      </aside>
    )
  }

  if (state.phase === 'ready') {
    return (
      <aside className="update-card" data-testid="update-card" data-wall-ignore="">
        <h2>Restarting to install Cinewall {state.offer.version}</h2>
        <div className="update-actions">
          <button type="button" data-testid="update-restart" onClick={() => quietly(restart({}))}>
            Restart now
          </button>
        </div>
      </aside>
    )
  }

  if (state.phase === 'failed' && state.step === 'download') {
    return (
      <aside className="update-card" data-testid="update-card" data-wall-ignore="">
        <h2>Couldn't download the update</h2>
        <p className="update-notes">Check your internet connection and try again.</p>
        <div className="update-actions">
          <button type="button" className="primary" data-testid="update-retry" onClick={() => quietly(install({}))}>
            Try again
          </button>
          <button type="button" data-testid="update-later" onClick={() => quietly(later({}))}>
            Remind me later
          </button>
        </div>
      </aside>
    )
  }

  return null
}
