import { useEffect, useRef } from 'react'
import type { Page } from '../App'

const ENTRIES: { page: Page; label: string }[] = [
  { page: 'search', label: 'Search' },
  { page: 'home', label: 'Home' },
  { page: 'settings', label: 'Settings' }
]

type Props = {
  page: Page
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (page: Page) => void
}

// Top-left menu button and the drawer it opens. Text-only entries, by design.
export function Menu({ page, open, onOpenChange, onNavigate }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const entries = useRef<(HTMLButtonElement | null)[]>([])
  // Focus rings are for keyboard use: a mouse open focuses the drawer itself
  // (keys still work there), a keyboard open focuses the current page's entry.
  const byKeyboard = useRef(false)
  const current = ENTRIES.findIndex((e) => e.page === page)

  useEffect(() => {
    if (!open) return
    if (byKeyboard.current) entries.current[current]?.focus()
    else drawer.current?.focus()
  }, [open, current])

  function close(keyboard = true) {
    onOpenChange(false)
    if (keyboard) button.current?.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const focused = entries.current.indexOf(document.activeElement as HTMLButtonElement)
    const i = focused >= 0 ? focused : current
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1
      entries.current[(i + step + ENTRIES.length) % ENTRIES.length]?.focus()
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="menu-button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="main-drawer"
        onClick={(e) => {
          byKeyboard.current = e.detail === 0
          onOpenChange(!open)
        }}
      >
        <span aria-hidden="true" />
      </button>
      <div className={`scrim${open ? ' open' : ''}`} onClick={() => close(false)} aria-hidden="true" />
      <nav
        ref={drawer}
        id="main-drawer"
        aria-label="Main"
        tabIndex={-1}
        className={`drawer${open ? ' open' : ''}`}
        onKeyDown={onKeyDown}
      >
        <ul>
          {ENTRIES.map((e, i) => (
            <li key={e.page}>
              <button
                ref={(el) => {
                  entries.current[i] = el
                }}
                type="button"
                aria-current={e.page === page ? 'page' : undefined}
                onClick={(ev) => {
                  onNavigate(e.page)
                  // Focus leaves the closing drawer at once, so the next key reaches the page.
                  close(ev.detail === 0)
                }}
              >
                {e.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
