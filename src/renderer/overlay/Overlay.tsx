import { useCallback, useEffect, useRef, useState } from 'react'
import type { NextEpisode, PlayerCommand, PlayerState } from '@shared/player'
import { formatTime } from '@shared/time'
import { ControlBar, type Menu } from './ControlBar'
import { NextCard } from './NextCard'

const HIDE_AFTER_MS = 2500
const send = (c: PlayerCommand) => void window.api.player.command(c)

// The player's controls, in the see-through window over the app window.
export function Overlay() {
  const [state, setState] = useState<PlayerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [next, setNext] = useState<NextEpisode | null>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [idle, setIdle] = useState(false)
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
        setError(null)
        if (prev?.videoId !== s.videoId) setNext(null)
        clock.current = { pos: s.positionS, at: performance.now(), paused: s.paused, duration: s.durationS ?? 0 }
        const v = volume.current
        if (v.sent === null || v.sent === s.volume) volume.current = { value: s.volume, sent: null }
      }),
      window.api.on('player.ended', ({ next: n }) => setNext(n)),
      window.api.on('player.error', ({ message }) => setError(message)),
      window.api.on('player.closed', () => {
        stateRef.current = null
        closing.current = false
        setState(null)
        setError(null)
        setNext(null)
        setMenu(null)
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
      if (!s || (e.target as Element | null)?.closest?.('input')) return
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
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, close, wake])

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
        if (menu && !(e.target as Element).closest('.menu-anchor')) setMenu(null)
      }}
      onDoubleClick={(e) => {
        if (state && e.target === e.currentTarget) send({ type: 'fullScreen', on: !state.fullScreen })
      }}
    >
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
        {state && <ControlBar state={state} timeRef={timeRef} fillRef={fillRef} menu={menu} onMenu={setMenu} />}
      </div>
      {error && (
        <p className="player-error" data-testid="player-error" role="alert">
          {error}
        </p>
      )}
      {next && <NextCard key={next.videoId} next={next} onPlay={playNext} onCancel={() => setNext(null)} />}
    </div>
  )
}
