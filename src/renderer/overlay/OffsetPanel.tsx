import { useEffect, useRef, useState } from 'react'
import { NUDGE_BIG_S, NUDGE_S, clampOffset, formatOffset } from '@shared/subtitleTiming'

const RANGE_S = 10

// "Set offset…": a slider from −10 s to +10 s for the showing subtitle. Subtitles
// move live; ←/→ 0.05 s, Shift 0.5 s, Home → 0, Esc or Enter closes. While it is
// open the player's own keys don't act. An offset already past ±10 s (from
// "Sync to a line") shows its real value with the thumb at the end.
export function OffsetPanel({ offset, subtitleKey, onClose }: { offset: number; subtitleKey: string; onClose: () => void }) {
  const [draft, setDraft] = useState(offset)
  const root = useRef<HTMLDivElement>(null)
  // Changes show at once; main's answer is taken only when nothing is in flight.
  const pending = useRef(0)
  useEffect(() => {
    if (pending.current === 0) setDraft(offset)
  }, [offset])
  useEffect(() => root.current?.querySelector<HTMLInputElement>('input')?.focus(), [])

  const set = (value: number) => {
    const v = clampOffset(value)
    setDraft(v)
    pending.current++
    void window.api.subtitles
      .setTiming({ offset: v, key: subtitleKey })
      .catch(() => onClose())
      .finally(() => pending.current--)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? NUDGE_BIG_S : NUDGE_S
    const onSlider = (e.target as Element).tagName === 'INPUT'
    switch (e.key) {
      case 'Escape':
        onClose()
        break
      case 'Enter':
        // On a button, Enter presses it; on the slider it closes the panel.
        if (onSlider) onClose()
        break
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        set(Math.min(RANGE_S, draft + step))
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        set(Math.max(-RANGE_S, draft - step))
        break
      case 'Home':
        e.preventDefault()
        set(0)
        break
      case 'Tab':
      case ' ':
        break
      default:
        e.preventDefault()
    }
    // The player's own keys (Space, F, M, G/H, S, Esc) don't act while the panel is open.
    e.stopPropagation()
  }

  const shown = Math.min(RANGE_S, Math.max(-RANGE_S, draft))
  return (
    <div ref={root} className="offset-panel" data-testid="offset-panel" role="dialog" aria-label="Subtitle offset" onKeyDown={onKeyDown}>
      <div className="offset-head">
        <span className="offset-title">Subtitle offset</span>
        <span className="offset-value" data-testid="offset-value">
          {formatOffset(draft)}
        </span>
      </div>
      <input
        type="range"
        className="offset-slider"
        aria-label="Subtitle offset"
        aria-valuetext={formatOffset(draft)}
        min={-RANGE_S}
        max={RANGE_S}
        step={NUDGE_S}
        value={shown}
        style={{ '--fill': `${((shown + RANGE_S) / (2 * RANGE_S)) * 100}%` } as React.CSSProperties}
        onChange={(e) => set(Number(e.currentTarget.value))}
      />
      <div className="offset-scale" aria-hidden="true">
        <span>−10 s</span>
        <span>0</span>
        <span>+10 s</span>
      </div>
      <div className="offset-actions">
        <button type="button" onClick={() => set(0)}>
          Reset
        </button>
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
