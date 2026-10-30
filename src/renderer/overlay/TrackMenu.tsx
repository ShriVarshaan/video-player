import { useEffect, useRef } from 'react'

export type MenuItem = { id: number | null; label: string }

// The Audio or Subtitles menu: a list of radio items above its button.
// ↑/↓ move, Enter picks, Esc closes just the menu.
export function TrackMenu({
  label,
  items,
  selected,
  onPick,
  onClose
}: {
  label: string
  items: MenuItem[]
  selected: number | null
  onPick: (id: number | null) => void
  onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checked = root.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? root.current?.querySelector<HTMLElement>('[role="menuitemradio"]')
    checked?.focus()
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    const all = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
    } else if (e.key === 'Escape') {
      onClose()
    } else if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab') {
      return
    }
    if (e.key !== 'Enter' && e.key !== ' ') e.preventDefault()
    // The player's own keys (arrows, Esc) must not act while the menu is open.
    e.stopPropagation()
  }

  return (
    <div ref={root} className="track-menu" role="menu" aria-label={label} data-testid="track-menu" onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button
          key={it.id ?? 'off'}
          type="button"
          role="menuitemradio"
          aria-checked={it.id === selected}
          onClick={() => onPick(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
