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
  const entries = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (open) entries.current[ENTRIES.findIndex((e) => e.page === page)]?.focus()
  }, [open, page])

  function close() {
    onOpenChange(false)
    button.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const i = entries.current.indexOf(document.activeElement as HTMLButtonElement)
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
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true" />
      </button>
      <div className={`scrim${open ? ' open' : ''}`} onClick={close} aria-hidden="true" />
      <nav id="main-drawer" aria-label="Main" className={`drawer${open ? ' open' : ''}`} onKeyDown={onKeyDown}>
        <ul>
          {ENTRIES.map((e, i) => (
            <li key={e.page}>
              <button
                ref={(el) => {
                  entries.current[i] = el
                }}
                type="button"
                aria-current={e.page === page ? 'page' : undefined}
                onClick={() => {
                  onNavigate(e.page)
                  onOpenChange(false)
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
