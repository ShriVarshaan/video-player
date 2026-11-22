import type { PipEdge, PlayerCommand, PlayerState } from '@shared/player'
import { formatTime } from '@shared/time'
import { Icon, ICONS } from './icons'
import { SeekBar } from './SeekBar'

const send = (c: PlayerCommand) => void window.api.player.command(c)

export const PIP_EDGES: PipEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

// The floating window's controls: close and back-to-full-size on top, play and skip in
// the middle, time and the seek bar at the bottom. Menus and timing tools are full size only.
export function PipControls({
  state,
  timeRef,
  fillRef,
  onClose,
  onTogglePause
}: {
  state: PlayerState
  timeRef: React.RefObject<HTMLSpanElement | null>
  fillRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  onTogglePause: () => void
}) {
  const duration = state.durationS ?? 0
  return (
    <div className="pip-controls" data-testid="pip-controls">
      <div className="pip-top">
        <button type="button" className="player-close" data-testid="player-close" aria-label="Close player" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="icon"
          data-testid="pip-exit"
          aria-label="Back to full size"
          title="Back to full size (P)"
          onClick={() => send({ type: 'pip', on: false })}
        >
          <Icon d={ICONS.pipExit} />
        </button>
      </div>
      <div className="pip-middle">
        <button type="button" className="icon" aria-label="Back 10 seconds" onClick={() => send({ type: 'seekBy', s: -10 })}>
          <Icon d={ICONS.back} />
        </button>
        <button
          type="button"
          className="icon pip-play"
          data-testid="play-pause"
          aria-label={state.paused ? 'Play' : 'Pause'}
          onClick={onTogglePause}
        >
          <Icon d={state.paused ? ICONS.play : ICONS.pause} />
        </button>
        <button type="button" className="icon" aria-label="Forward 10 seconds" onClick={() => send({ type: 'seekBy', s: 10 })}>
          <Icon d={ICONS.forward} />
        </button>
      </div>
      <div className="pip-bottom">
        <span className="player-time" data-testid="player-time" ref={timeRef} data-position={state.positionS}>
          {formatTime(state.positionS)} / {formatTime(duration)}
        </span>
        <SeekBar durationS={duration} positionS={state.positionS} fillRef={fillRef} />
      </div>
    </div>
  )
}
