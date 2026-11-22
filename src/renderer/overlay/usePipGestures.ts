import { useCallback, useRef } from 'react'
import type { PipEdge, PlayerCommand } from '@shared/player'

const send = (c: PlayerCommand) => void window.api.player.command(c)
// A press on the picture becomes a drag only after it has moved this far, so a click still pauses.
const DRAG_PX = 4

// Dragging the floating window by its picture, or resizing it by an edge. Main moves the window;
// the deltas are in screen pixels, so they stay right while the window moves under the pointer.
export function usePipGestures(enabled: boolean) {
  const g = useRef<{ edge: PipEdge | 'move'; x: number; y: number; started: boolean } | null>(null)
  // Whether the last press turned into a drag (and so is not a click).
  const dragged = useRef(false)

  const begin = useCallback(
    (e: React.PointerEvent, edge: PipEdge | 'move') => {
      if (!enabled || e.button !== 0) return
      dragged.current = false
      g.current = { edge, x: e.screenX, y: e.screenY, started: edge !== 'move' }
      e.currentTarget.setPointerCapture(e.pointerId)
      if (edge !== 'move') send({ type: 'pipGesture', phase: 'start', edge, dx: 0, dy: 0 })
    },
    [enabled]
  )

  const move = useCallback((e: React.PointerEvent) => {
    const c = g.current
    if (!c) return
    const dx = e.screenX - c.x
    const dy = e.screenY - c.y
    if (!c.started) {
      if (Math.hypot(dx, dy) <= DRAG_PX) return
      c.started = true
      dragged.current = true
      send({ type: 'pipGesture', phase: 'start', edge: c.edge, dx: 0, dy: 0 })
    }
    send({ type: 'pipGesture', phase: 'move', edge: c.edge, dx, dy })
  }, [])

  const end = useCallback((e: React.PointerEvent) => {
    const c = g.current
    g.current = null
    if (c?.started) send({ type: 'pipGesture', phase: 'end', edge: c.edge, dx: e.screenX - c.x, dy: e.screenY - c.y })
  }, [])

  return { begin, move, end, wasDrag: () => dragged.current }
}
