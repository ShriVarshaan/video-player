import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import './select.css'

export type SelectOption = { value: string; label: string }

type Props = {
  label: string
  value: string | null
  options: readonly SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
}

const TYPEAHEAD_MS = 600

// A dropdown drawn by the app, so its list is glass like the rest of the UI
// (Windows draws a native <select>'s list itself). Focus stays on the button;
// the list follows it with aria-activedescendant, as in the ARIA select-only combobox.
export function Select({ label, value, options, onChange, disabled, id }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const selected = options.findIndex((o) => o.value === value)
  const [active, setActive] = useState(0)

  function show() {
    setActive(Math.max(0, selected))
    setOpen(true)
  }

  function pick(i: number) {
    const o = options[i]
    setOpen(false)
    if (o && o.value !== value) onChange(o.value)
  }

  // The list sits in the top layer, so no scrolling panel clips it.
  useLayoutEffect(() => {
    if (open) list.current?.showPopover()
  }, [open])

  // The current choice opens in the middle of the list; moving keeps the row in view.
  const opened = useRef(false)
  useEffect(() => {
    if (!open) return void (opened.current = false)
    list.current?.querySelector(`#${uid}-${active}`)?.scrollIntoView({ block: opened.current ? 'nearest' : 'center' })
    opened.current = true
  }, [open, active, uid])

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  // Typing jumps to the first label that starts with what was typed;
  // one letter pressed again moves on to the next match.
  function typeahead(key: string): number | null {
    const now = Date.now()
    const t = typed.current
    t.text = now - t.at > TYPEAHEAD_MS ? key : t.text + key
    t.at = now
    const repeat = t.text.length > 1 && [...t.text].every((c) => c === key)
    const prefix = (repeat ? key : t.text).toLowerCase()
    const from = open ? active : Math.max(0, selected)
    const start = repeat || t.text.length === 1 ? from + 1 : from
    for (let k = 0; k < options.length; k++) {
      const i = (start + k) % options.length
      if (options[i]!.label.toLowerCase().startsWith(prefix)) return i
    }
    return null
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const last = options.length - 1
    const move = (i: number) => setActive(Math.min(last, Math.max(0, i)))
    // A space in the middle of typing ("New Zealand") is part of the text, otherwise it picks.
    const typing = typed.current.text !== '' && Date.now() - typed.current.at < TYPEAHEAD_MS
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key !== ' ' || typing)) {
      const i = typeahead(e.key)
      if (!open) show()
      if (i !== null) setActive(i)
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        show()
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        move(active + 1)
        break
      case 'ArrowUp':
        move(active - 1)
        break
      case 'PageDown':
        move(active + 10)
        break
      case 'PageUp':
        move(active - 10)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(last)
        break
      case 'Enter':
      case ' ':
        pick(active)
        break
      case 'Escape':
        setOpen(false)
        break
      case 'Tab':
        pick(active)
        return
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const anchor = `--select-${uid}`
  return (
    <div ref={root} className="select">
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        className="select-button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        disabled={disabled}
        style={{ anchorName: anchor } as React.CSSProperties}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{options[selected]?.label ?? ''}</span>
        <svg className="select-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>
      {open && (
        <ul
          ref={list}
          id={`${uid}-list`}
          role="listbox"
          aria-label={label}
          className="select-list"
          popover="manual"
          style={{ positionAnchor: anchor } as React.CSSProperties}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={i === selected}
              className={i === active ? 'active' : undefined}
              onPointerMove={() => i !== active && setActive(i)}
              // Keep focus on the button so the keys keep working.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                pick(i)
                button.current?.focus()
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
