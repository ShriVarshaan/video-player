import { useEffect, useRef } from 'react'

// Asks before replacing an existing synced subtitle file. Focus starts on Cancel;
// Esc cancels; the player's keys don't act while it is open.
export function ConfirmCard({ name, onReplace, onCancel }: { name: string; onReplace: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  return (
    <div
      className="confirm-card"
      data-testid="confirm-replace"
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-name"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
        e.stopPropagation()
      }}
    >
      <p id="confirm-title" className="confirm-title">
        Replace the existing synced subtitles?
      </p>
      <p id="confirm-name" className="confirm-name">
        {name}
      </p>
      <div className="confirm-actions">
        <button type="button" ref={cancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={onReplace}>
          Replace
        </button>
      </div>
    </div>
  )
}
