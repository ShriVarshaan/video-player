import { useCallback, useEffect, useRef, useState } from 'react'
import type { Cue, NextEpisode, PlayerCommand, PlayerState } from '@shared/player'
import { parseAppError } from '@shared/appError'
import { DEFAULT_STYLE, type SubtitleStyle } from '@shared/subtitleStyle'
import { NUDGE_BIG_S, NUDGE_S, formatOffset } from '@shared/subtitleTiming'
import { formatTime } from '@shared/time'
import { ConfirmCard } from './ConfirmCard'
import { ControlBar, type Menu, type SubtitleAction } from './ControlBar'
import { NextCard } from './NextCard'
import { OffsetPanel } from './OffsetPanel'
import { SearchPanel } from './SearchPanel'
import { StylePanel } from './StylePanel'
import { SubtitleView } from './SubtitleView'
import { SyncCard } from './SyncCard'
import { TimingNote } from './TimingNote'

const HIDE_AFTER_MS = 2500
const send = (c: PlayerCommand) => void window.api.player.command(c)

// The player's controls, in the see-through window over the app window.
export function Overlay() {
  const [state, setState] = useState<PlayerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [next, setNext] = useState<NextEpisode | null>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [idle, setIdle] = useState(false)
  const [cue, setCue] = useState<Cue | null>(null)
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(DEFAULT_STYLE)
  const [controlsTop, setControlsTop] = useState<number | null>(null)
  // Subtitle timing (milestone 6): the showing subtitle's fix, the sync card, the note, the replace prompt.
  const [offset, setOffset] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [offsetOpen, setOffsetOpen] = useState(false)
  const [note, setNote] = useState<{ text: string; n: number } | null>(null)
  const [confirm, setConfirm] = useState<{ name: string; key: string } | null>(null)
  const stateRef = useRef<PlayerState | null>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLElement>(null)
  const clock = useRef({ pos: 0, at: 0, paused: true, duration: 0 })
  const closing = useRef(false)
  // Volume keys run ahead of the state coming back from main.
  const volume = useRef<{ value: number; sent: number | null }>({ value: 100, sent: null })
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const offs = [
      window.api.on('player.state', (s) => {
        const prev = stateRef.current
        stateRef.current = s
        setState(s)
        // A new file clears the card and any error; updates for the same file keep them.
        if (prev?.videoId !== s.videoId) {
          setNext(null)
          setError(null)
        }
        // The sync card and the replace prompt are about one subtitle: another one closes them.
        if (prev?.videoId !== s.videoId || prev?.subtitleId !== s.subtitleId) {
          setSyncing(false)
          setOffsetOpen(false)
          setConfirm(null)
        }
        clock.current = { pos: s.positionS, at: performance.now(), paused: s.paused, duration: s.durationS ?? 0 }
        const v = volume.current
        if (v.sent === null || v.sent === s.volume) volume.current = { value: s.volume, sent: null }
      }),
      window.api.on('player.ended', ({ next: n }) => setNext(n)),
      window.api.on('subtitles.cue', setCue),
      window.api.on('subtitles.style', setSubStyle),
      window.api.on('subtitles.timing', (t) => setOffset(t?.offset ?? null)),
      window.api.on('player.error', ({ message }) => setError(message)),
      window.api.on('player.closed', () => {
        stateRef.current = null
        closing.current = false
        setState(null)
        setError(null)
        setNext(null)
        setMenu(null)
        setCue(null)
        setSyncing(false)
        setOffsetOpen(false)
        setConfirm(null)
        setNote(null)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Between state updates (≈30 Hz) the clock runs on, so time and the seek bar move every frame.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const c = clock.current
      const pos = Math.min(c.duration || Infinity, c.pos + (c.paused ? 0 : (performance.now() - c.at) / 1000))
      if (timeRef.current) {
        timeRef.current.dataset['position'] = String(pos)
        timeRef.current.textContent = `${formatTime(pos)} / ${formatTime(c.duration)}`
      }
      if (fillRef.current && !fillRef.current.style.transform.includes('scaleX') && c.duration) {
        fillRef.current.style.setProperty('--progress', String(pos / c.duration))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Controls fade after 2.5 s without input while playing; they stay while paused,
  // while a menu or the next-episode card is open, or when something went wrong.
  const keepVisible = !state || state.paused || menu !== null || next !== null || error !== null
  const wake = useCallback(() => {
    setIdle(false)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setIdle(true), HIDE_AFTER_MS)
  }, [])
  const hasState = state !== null
  useEffect(() => {
    if (hasState) wake()
  }, [hasState, wake])
  useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), [])
  const hidden = idle && !keepVisible
  const showingKey = state?.subtitles.find((t) => t.id === state.subtitleId)?.key ?? null

  // Where the control bar starts while it shows, so low subtitles can sit above it.
  const hasControls = state !== null && !hidden
  useEffect(() => {
    if (!hasControls) return setControlsTop(null)
    const measure = () => setControlsTop(document.querySelector('.player-bottom .seek')?.getBoundingClientRect().top ?? null)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [hasControls])

  const say = useCallback((text: string) => setNote((n) => ({ text, n: (n?.n ?? 0) + 1 })), [])
  const sayOffset = useCallback((o: number) => say(`Subtitles ${formatOffset(o)}`), [say])
  const sayError = useCallback((e: unknown) => say(parseAppError(e)?.message ?? 'Something went wrong'), [say])
  const getPosition = useCallback(() => {
    const c = clock.current
    return c.pos + (c.paused ? 0 : (performance.now() - c.at) / 1000)
  }, [])
  const closeSync = useCallback(() => setSyncing(false), [])

  const nudge = useCallback(
    (deltaS: number) => {
      void window.api.subtitles.nudge({ deltaS }).then(({ offset: o }) => o !== null && sayOffset(o), sayError)
    },
    [sayOffset, sayError]
  )

  // key: the subtitle being exported; main refuses if another one is showing by then.
  const exportSynced = useCallback(
    async (replace: boolean, key: string) => {
      setConfirm(null)
      try {
        const r = await window.api.subtitles.exportSynced({ replace, key })
        if ('exists' in r) setConfirm({ name: r.exists, key })
        else say(r.fallback ? `Saved ${r.saved} in the app's folder` : `Saved ${r.saved}`)
      } catch (e) {
        sayError(e)
      }
    },
    [say, sayError]
  )

  // "Sync to a line" needs words the app can read; a picture subtitle only gets G/H.
  const startSync = useCallback(() => {
    const s = stateRef.current
    const track = s?.subtitles.find((t) => t.id === s.subtitleId)
    if (!track) return
    if (track.image) return say('Sync to a line needs a text subtitle')
    setMenu(null)
    setSyncing(true)
  }, [say])

  const onSubtitleAction = useCallback(
    (a: SubtitleAction) => {
      if (a === 'sync') return startSync()
      setMenu(null)
      if (a === 'offset') return setOffsetOpen(true)
      if (a === 'reset') void window.api.subtitles.resetTiming({}).then(() => sayOffset(0), sayError)
      else {
        const s = stateRef.current
        const key = s?.subtitles.find((t) => t.id === s.subtitleId)?.key
        if (key) void exportSynced(false, key)
      }
    },
    [startSync, sayOffset, sayError, exportSynced]
  )

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    void window.api.player.stop({})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      wake()
      const s = stateRef.current
      if (e.key === 'Escape') {
        e.preventDefault()
        if (menu) setMenu(null)
        else close()
        return
      }
      if (!s) return
      // A keyboard-focused volume slider keeps its own arrows; every other key stays the player's.
      if ((e.target as Element | null)?.closest?.('input') && e.key.startsWith('Arrow')) return
      const step = (by: number) => {
        const v = volume.current
        const value = Math.min(200, Math.max(0, v.value + by))
        volume.current = { value, sent: value }
        send({ type: 'volume', value })
      }
      switch (e.key) {
        case ' ':
          send({ type: 'pause', paused: !s.paused })
          break
        case 'ArrowLeft':
          send({ type: 'seekBy', s: -10 })
          break
        case 'ArrowRight':
          send({ type: 'seekBy', s: 10 })
          break
        case 'ArrowUp':
          step(5)
          break
        case 'ArrowDown':
          step(-5)
          break
        case 'm':
        case 'M':
          send({ type: 'mute', muted: !s.muted })
          break
        case 'f':
        case 'F':
          send({ type: 'fullScreen', on: !s.fullScreen })
          break
        // Subtitle timing: G earlier, H later; Shift for big steps. S: sync to a line.
        case 'g':
        case 'h':
        case 'G':
        case 'H': {
          if (s.subtitleId === null) return
          const step = e.shiftKey ? NUDGE_BIG_S : NUDGE_S
          nudge(e.key.toLowerCase() === 'g' ? -step : step)
          break
        }
        case 's':
        case 'S':
          if (s.subtitleId === null || e.repeat) return
          startSync()
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, close, wake, nudge, startSync])

  const playNext = useCallback(() => {
    const s = stateRef.current
    if (!s || !next) return
    setNext(null)
    void window.api.player.play({ key: s.titleKey, videoId: next.videoId, from: 'resume' })
  }, [next])

  return (
    <div
      className="overlay"
      data-idle={hidden}
      onPointerMove={wake}
      onPointerDown={(e) => {
        wake()
        if (menu && !(e.target as Element).closest('.menu-anchor, .style-panel')) setMenu(null)
      }}
      onDoubleClick={(e) => {
        if (state && e.target === e.currentTarget) send({ type: 'fullScreen', on: !state.fullScreen })
      }}
    >
      {state && (
        <SubtitleView cue={cue} style={subStyle} controlsTop={controlsTop} sample={menu === 'style' ? 'The quick brown fox jumps over the lazy dog.' : null} />
      )}
      <div className="controls" data-testid="controls" data-hidden={hidden}>
        <div className="player-top">
          <button type="button" className="player-close" data-testid="player-close" aria-label="Close player" onClick={close}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <span className="player-heading" data-testid="player-heading">
            {state?.heading ?? ''}
          </span>
        </div>
        {state && (
          <ControlBar
            state={state}
            timeRef={timeRef}
            fillRef={fillRef}
            menu={menu}
            onMenu={setMenu}
            offset={offset}
            onSubtitleAction={onSubtitleAction}
          />
        )}
      </div>
      {state && menu === 'style' && <StylePanel titleKey={state.titleKey} style={subStyle} onClose={() => setMenu(null)} />}
      {state && menu === 'search' && <SearchPanel key={state.videoId} onClose={() => setMenu(null)} />}
      {error && (
        <p className="player-error" data-testid="player-error" role="alert">
          {error}
        </p>
      )}
      {next && <NextCard key={next.videoId} next={next} onPlay={playNext} onCancel={() => setNext(null)} />}
      {state && offsetOpen && showingKey && (
        <OffsetPanel offset={offset ?? 0} subtitleKey={showingKey} onClose={() => setOffsetOpen(false)} />
      )}
      {state && syncing && <SyncCard getPosition={getPosition} onSynced={sayOffset} onClose={closeSync} />}
      {state && confirm && (
        <ConfirmCard name={confirm.name} onReplace={() => void exportSynced(true, confirm.key)} onCancel={() => setConfirm(null)} />
      )}
      <TimingNote message={note} />
    </div>
  )
}
