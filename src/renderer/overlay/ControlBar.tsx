import { useRef, useState } from 'react'
import type { PlayerCommand, PlayerState } from '@shared/player'
import { formatTime } from '@shared/time'
import { TrackMenu } from './TrackMenu'

export type Menu = 'audio' | 'subtitles' | null

const send = (c: PlayerCommand) => void window.api.player.command(c)

const Icon = ({ d, label }: { d: string; label?: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined}>
    <path d={d} fill="currentColor" />
  </svg>
)
const ICONS = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  back: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z',
  forward: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8Z',
  volume: 'M4 9v6h4l5 4V5L8 9H4Zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4ZM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z',
  mute: 'M4 9v6h4l5 4V5L8 9H4Zm12.6 3 2.7-2.7-1.3-1.3-2.7 2.7-2.7-2.7-1.3 1.3 2.7 2.7-2.7 2.7 1.3 1.3 2.7-2.7 2.7 2.7 1.3-1.3L16.6 12Z',
  full: 'M5 5h5v2H7v3H5V5Zm9 0h5v5h-2V7h-3V5ZM5 14h2v3h3v2H5v-5Zm12 3v-3h2v5h-5v-2h3Z',
  exitFull: 'M8 5h2v5H5V8h3V5Zm6 0h2v3h3v2h-5V5ZM5 14h5v5H8v-3H5v-2Zm9 0h5v2h-3v3h-2v-5Z'
}

// The bottom bar: seek bar, then play/skip, volume, time, Audio, Subtitles, full screen.
// Time and the seek fill are written by the overlay's frame loop through the refs.
export function ControlBar({
  state,
  timeRef,
  fillRef,
  menu,
  onMenu
}: {
  state: PlayerState
  timeRef: React.RefObject<HTMLSpanElement | null>
  fillRef: React.RefObject<HTMLElement | null>
  menu: Menu
  onMenu: (m: Menu) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const duration = state.durationS ?? 0

  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration
  }

  const boost = state.volume > 100
  const volumeFill = `${(state.volume / 200) * 100}%`

  return (
    <div className="player-bottom">
      <div
        ref={track}
        className="seek"
        data-testid="seek"
        role="slider"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(state.positionS)}
        aria-valuetext={formatTime(state.positionS)}
        onPointerDown={(e) => {
          if (!duration) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setPreview(at(e.clientX))
        }}
        onPointerMove={(e) => {
          if (preview !== null) setPreview(at(e.clientX))
        }}
        onPointerUp={(e) => {
          if (preview === null) return
          send({ type: 'seek', toS: at(e.clientX) })
          setPreview(null)
        }}
      >
        <span className="seek-track">
          <i ref={fillRef} style={preview !== null && duration ? { transform: `scaleX(${preview / duration})` } : undefined} />
        </span>
        {preview !== null && (
          <span className="seek-preview" style={{ left: `${(preview / (duration || 1)) * 100}%` }}>
            {formatTime(preview)}
          </span>
        )}
      </div>

      <div className="bar-row">
        <button
          type="button"
          className="icon"
          data-testid="play-pause"
          aria-label={state.paused ? 'Play' : 'Pause'}
          onClick={() => send({ type: 'pause', paused: !state.paused })}
        >
          <Icon d={state.paused ? ICONS.play : ICONS.pause} />
        </button>
        <button type="button" className="icon" aria-label="Back 10 seconds" onClick={() => send({ type: 'seekBy', s: -10 })}>
          <Icon d={ICONS.back} />
        </button>
        <button type="button" className="icon" aria-label="Forward 10 seconds" onClick={() => send({ type: 'seekBy', s: 10 })}>
          <Icon d={ICONS.forward} />
        </button>

        <div className="volume">
          <button
            type="button"
            className="icon"
            aria-label={state.muted ? 'Unmute' : 'Mute'}
            onClick={() => send({ type: 'mute', muted: !state.muted })}
          >
            <Icon d={state.muted ? ICONS.mute : ICONS.volume} />
          </button>
          <span className="volume-track">
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={state.volume}
              aria-label="Volume"
              aria-valuetext={`${state.volume}%`}
              data-testid="volume"
              data-boost={boost}
              style={{ '--fill': volumeFill } as React.CSSProperties}
              onChange={(e) => send({ type: 'volume', value: Number(e.currentTarget.value) })}
              // After a drag, hand the keys back to the player (Space, arrows, M, F).
              onPointerUp={(e) => e.currentTarget.blur()}
            />
            <span className="volume-tick" aria-hidden="true" />
          </span>
          <span className={`volume-value${boost ? ' boost' : ''}`} data-testid="volume-value">
            {state.volume}%
          </span>
        </div>

        <span className="player-time" data-testid="player-time" ref={timeRef} data-position={state.positionS}>
          {formatTime(state.positionS)} / {formatTime(duration)}
        </span>

        <span className="bar-spacer" />

        <div className="menu-anchor">
          <button
            type="button"
            className={`text${menu === 'audio' ? ' open' : ''}`}
            data-testid="audio-button"
            aria-haspopup="menu"
            aria-expanded={menu === 'audio'}
            disabled={state.audio.length === 0}
            onClick={() => onMenu(menu === 'audio' ? null : 'audio')}
          >
            Audio
          </button>
          {menu === 'audio' && (
            <TrackMenu
              label="Audio"
              items={state.audio.map((t) => ({ id: t.id, label: t.label }))}
              selected={state.audioId}
              onPick={(id) => {
                if (id !== null) send({ type: 'audio', id })
                onMenu(null)
              }}
              onClose={() => onMenu(null)}
            />
          )}
        </div>
        <div className="menu-anchor">
          <button
            type="button"
            className={`text${menu === 'subtitles' ? ' open' : ''}`}
            data-testid="subtitles-button"
            aria-haspopup="menu"
            aria-expanded={menu === 'subtitles'}
            onClick={() => onMenu(menu === 'subtitles' ? null : 'subtitles')}
          >
            Subtitles
          </button>
          {menu === 'subtitles' && (
            <TrackMenu
              label="Subtitles"
              items={[{ id: null, label: 'Off' }, ...state.subtitles.map((t) => ({ id: t.id, label: t.label }))]}
              selected={state.subtitleId}
              onPick={(id) => {
                send({ type: 'subtitle', id })
                onMenu(null)
              }}
              onClose={() => onMenu(null)}
            />
          )}
        </div>
        <button
          type="button"
          className="icon"
          data-testid="fullscreen"
          aria-label={state.fullScreen ? 'Exit full screen' : 'Full screen'}
          onClick={() => send({ type: 'fullScreen', on: !state.fullScreen })}
        >
          <Icon d={state.fullScreen ? ICONS.exitFull : ICONS.full} />
        </button>
      </div>
    </div>
  )
}
