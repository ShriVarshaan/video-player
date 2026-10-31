import { useEffect, useState } from 'react'
import { parseAppError } from '@shared/appError'
import { firstCueAfter } from '@shared/subtitleTiming'

type Cue = { start: number; text: string }

// "Sync to a line": shows the next line; S (or Enter) when it is heard lines the
// subtitles up with that moment. ← → pick another line, Esc closes. While open,
// every key belongs to the card, never to the player.
export function SyncCard({
  getPosition,
  onSynced,
  onClose
}: {
  getPosition: () => number
  onSynced: (offset: number) => void
  onClose: () => void
}) {
  const [cues, setCues] = useState<Cue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [i, setI] = useState(-1)

  useEffect(() => {
    let live = true
    window.api.subtitles.syncCues({}).then(
      (d) => {
        if (!live) return
        setCues(d.cues)
        setI(firstCueAfter(d.cues.map((c) => c.start), d.offset, getPosition()))
      },
      (e: unknown) => live && setError(parseAppError(e)?.message ?? "Couldn't read this subtitle")
    )
    return () => {
      live = false
    }
  }, [getPosition])

  useEffect(() => {
    let sent = false
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      e.preventDefault()
      if (e.key === 'Escape' || error) return onClose()
      if (!cues || i < 0) return
      if (e.key === 'ArrowLeft') setI(Math.max(0, i - 1))
      else if (e.key === 'ArrowRight') setI(Math.min(cues.length - 1, i + 1))
      else if ((e.key === 's' || e.key === 'S' || e.key === 'Enter') && !e.repeat && !sent) {
        sent = true
        void window.api.subtitles.syncToCue({ start: cues[i]!.start }).then(
          ({ offset }) => {
            if (offset !== null) onSynced(offset)
            onClose()
          },
          () => onClose()
        )
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cues, i, error, onClose, onSynced])

  const line = cues && i >= 0 ? cues[i]!.text : null
  return (
    <div className="sync-card" data-testid="sync-card" role="dialog" aria-label="Sync to a line">
      {error ? (
        <p className="sync-line">{error}</p>
      ) : !cues ? (
        <p className="sync-hint">Reading subtitles…</p>
      ) : line === null ? (
        <p className="sync-hint">This subtitle has no lines.</p>
      ) : (
        <>
          <p className="sync-hint">
            Press <kbd>S</kbd> when you hear
          </p>
          <p className="sync-line" data-testid="sync-line" aria-live="polite">
            {line}
          </p>
          <p className="sync-hint">
            <kbd>←</kbd> <kbd>→</kbd> other lines · <kbd>Esc</kbd> cancel
          </p>
        </>
      )}
    </div>
  )
}
