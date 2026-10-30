import { useEffect, useState } from 'react'
import type { NextEpisode } from '@shared/player'

const COUNTDOWN_S = 10

// Bottom-right card after an episode ends: plays the next one when the countdown runs out.
export function NextCard({ next, onPlay, onCancel }: { next: NextEpisode; onPlay: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(COUNTDOWN_S)

  useEffect(() => {
    if (left <= 0) {
      onPlay()
      return
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [left, onPlay])

  return (
    <aside className="next-card" data-testid="next-card" aria-label="Next episode">
      <img className="next-still" src={next.stillUrl} alt="" />
      <div className="next-text">
        <span className="next-label">Next episode</span>
        <span className="next-title">
          S{next.season} E{next.episode}
          {next.title ? ` · ${next.title}` : ''}
        </span>
        <div className="next-actions">
          <button type="button" className="primary" data-testid="next-play" onClick={onPlay}>
            Play now{' '}
            <span className="next-count" data-testid="next-count" aria-label={`in ${left} seconds`}>
              {left}
            </span>
          </button>
          <button type="button" className="secondary" data-testid="next-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </aside>
  )
}
