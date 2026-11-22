import type { PlayerCommand, PlayerState, Track } from '@shared/player'
import { formatOffset } from '@shared/subtitleTiming'
import { formatTime } from '@shared/time'
import { Icon, ICONS } from './icons'
import { SeekBar } from './SeekBar'
import { TrackMenu, type MenuItem } from './TrackMenu'

// The open menu or panel; panels ('style', 'search') open from the Subtitles menu.
export type Menu = 'audio' | 'subtitles' | 'style' | 'search' | null

const send = (c: PlayerCommand) => void window.api.player.command(c)

// Subtitle timing commands in the Subtitles menu.
export type SubtitleAction = 'auto' | 'offset' | 'sync' | 'reset' | 'export'

// Subtitle files say so; when two tracks share a label, files show their name instead.
// The showing subtitle's row carries its timing fix ("+0.35 s") when it has one.
function subtitleItems(subs: Track[], selected: number | null, offset: number | null): MenuItem[] {
  const count = new Map<string, number>()
  for (const t of subs) count.set(t.label, (count.get(t.label) ?? 0) + 1)
  // Synced files the app exported come first.
  const ordered = [...subs.filter((t) => t.synced), ...subs.filter((t) => !t.synced)]
  return ordered.map((t) => {
    const file = t.external ? ((count.get(t.label) ?? 0) > 1 ? t.fileName : 'External') : null
    const timing = t.id === selected && offset ? formatOffset(offset) : null
    return { id: t.id, label: t.label, detail: [file, timing].filter(Boolean).join(' · ') || null }
  })
}

// The bottom bar: seek bar, then play/skip, volume, time, picture in picture, Audio, Subtitles, full screen.
// Time and the seek fill are written by the overlay's frame loop through the refs.
export function ControlBar({
  state,
  timeRef,
  fillRef,
  menu,
  onMenu,
  offset,
  onSubtitleAction
}: {
  state: PlayerState
  timeRef: React.RefObject<HTMLSpanElement | null>
  fillRef: React.RefObject<HTMLElement | null>
  menu: Menu
  onMenu: (m: Menu) => void
  offset: number | null
  onSubtitleAction: (a: SubtitleAction) => void
}) {
  const showing = state.subtitles.find((t) => t.id === state.subtitleId)
  const timingActions = !showing
    ? []
    : [
        { label: 'Auto sync', onPick: () => onSubtitleAction('auto') },
        { label: 'Set offset…', onPick: () => onSubtitleAction('offset') },
        ...(showing.image ? [] : [{ label: 'Sync to a line…', onPick: () => onSubtitleAction('sync') }]),
        ...(offset ? [{ label: 'Reset timing', onPick: () => onSubtitleAction('reset') }] : []),
        ...(showing.image ? [] : [{ label: 'Export synced .srt', onPick: () => onSubtitleAction('export') }])
      ]
  const duration = state.durationS ?? 0
  const boost = state.volume > 100
  const volumeFill = `${(state.volume / 200) * 100}%`

  return (
    <div className="player-bottom">
      <SeekBar durationS={duration} positionS={state.positionS} fillRef={fillRef} />

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

        <button
          type="button"
          className="icon"
          data-testid="pip-button"
          aria-label="Picture in picture"
          title="Picture in picture (P)"
          onClick={() => send({ type: 'pip', on: true })}
        >
          <Icon d={ICONS.pip} />
        </button>

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
              items={[{ id: null, label: 'Off' }, ...subtitleItems(state.subtitles, state.subtitleId, offset)]}
              selected={state.subtitleId}
              onPick={(id) => {
                send({ type: 'subtitle', id })
                onMenu(null)
              }}
              onClose={() => onMenu(null)}
              actions={[
                { label: 'Search online…', onPick: () => onMenu('search') },
                { label: 'Style…', onPick: () => onMenu('style') },
                ...timingActions
              ]}
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
