import { useEffect, useState } from 'react'
import type { PlayerState } from '@shared/player'
import { formatTime } from '@shared/time'

// The player's controls, in the see-through window over the app window.
export function Overlay() {
  const [state, setState] = useState<PlayerState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const offs = [
      window.api.on('player.state', (s) => {
        setState(s)
        setError(null)
      }),
      window.api.on('player.error', ({ message }) => setError(message)),
      window.api.on('player.closed', () => {
        setState(null)
        setError(null)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const close = () => void window.api.player.stop({})

  return (
    <div className="overlay">
      <div className="player-top">
        <button type="button" className="player-close" data-testid="player-close" aria-label="Close player" onClick={close}>
          ✕
        </button>
        <span className="player-heading" data-testid="player-heading">
          {state?.heading ?? ''}
        </span>
      </div>
      {error && (
        <p className="player-error" data-testid="player-error" role="alert">
          {error}
        </p>
      )}
      {state && (
        <div className="player-bottom">
          <span className="player-time" data-testid="player-time" data-position={state.positionS}>
            {formatTime(state.positionS)} / {formatTime(state.durationS ?? 0)}
          </span>
        </div>
      )}
    </div>
  )
}
