import { useEffect } from 'react'
import type { AutoSyncProgress } from '@shared/autoSync'

// Auto sync running: stage and progress. Only Esc is taken (it cancels the sync,
// not the player); every other key still reaches the player.
export function AutoSyncCard({ progress, onCancel }: { progress: AutoSyncProgress | null; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const stage = progress?.stage === 'match' ? 'Matching' : 'Reading audio'
  const pct = progress?.stage === 'audio' && progress.pct !== null ? progress.pct : null
  return (
    <div className="sync-card auto-sync-card" data-testid="auto-sync-card" role="status" aria-label="Syncing subtitles">
      <p className="sync-line">Syncing subtitles…</p>
      <div
        className="auto-sync-bar"
        data-indeterminate={pct === null}
        role="progressbar"
        aria-label={stage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct === null ? undefined : Math.round(pct * 100)}
      >
        <span style={pct === null ? undefined : ({ '--progress': pct } as React.CSSProperties)} />
      </div>
      <p className="sync-hint">
        {stage} · <kbd>Esc</kbd> cancel
      </p>
    </div>
  )
}
