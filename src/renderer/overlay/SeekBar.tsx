import { useRef, useState } from 'react'
import type { PlayerCommand } from '@shared/player'
import { formatTime } from '@shared/time'

const send = (c: PlayerCommand) => void window.api.player.command(c)

// The seek bar: a press or drag previews a time, letting go seeks there.
// The fill is written by the overlay's frame loop through fillRef.
export function SeekBar({
  durationS,
  positionS,
  fillRef
}: {
  durationS: number
  positionS: number
  fillRef: React.RefObject<HTMLElement | null>
}) {
  const track = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const duration = durationS

  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration
  }

  return (
    <div
      ref={track}
      className="seek"
      data-testid="seek"
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(positionS)}
      aria-valuetext={formatTime(positionS)}
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
  )
}
