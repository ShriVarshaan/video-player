import { useEffect, useRef } from 'react'

// detail: a quieter second label ("External", or the file name when two look alike).
export type MenuItem = { id: number | null; label: string; detail?: string | null }
// Commands listed below the tracks ("Style…", "Search online…").
export type MenuAction = { label: string; onPick: () => void }

// The Audio or Subtitles menu: a list of radio items above its button.
// ↑/↓ move, Enter picks, Esc closes just the menu.
export function TrackMenu({
  label,
  items,
  selected,
  onPick,
  onClose,
  actions = []
}: {
  label: string
  items: MenuItem[]
  selected: number | null
  onPick: (id: number | null) => void
  onClose: () => void
  actions?: MenuAction[]
}) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checked = root.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? root.current?.querySelector<HTMLElement>('[role^="menuitem"]')
    checked?.focus()
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    const all = [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
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
          {it.detail && <span className="detail">{it.detail}</span>}
        </button>
      ))}
      {actions.length > 0 && <hr className="menu-separator" />}
      {actions.map((a) => (
        <button key={a.label} type="button" role="menuitem" className="menu-action" onClick={a.onPick}>
          {a.label}
        </button>
      ))}
    </div>
  )
}
