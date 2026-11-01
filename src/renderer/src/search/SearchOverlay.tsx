import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchDoc } from '@shared/library'
import { libraryGenreChips, relatedChips, type Chip } from './chips'
import { moveInGrid } from './gridNav'
import { parseQuery } from './query'
import { buildIndex, search } from './rank'
import { emptyRows } from './rows'
import { SearchCard } from './SearchCard'
import { useSearchDocs } from './useSearchDocs'
import './search.css'

export type SearchState = { query: string; selectedKey: string | null }

type Props = {
  initial: string
  restore: SearchState | null
  active: boolean
  onOpen: (key: string, state: SearchState) => void
  onClose: () => void
}

const DEBOUNCE_MS = 120
const isTyping = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey

// Netflix-style search over the dimmed wall (milestone 8). Titles first: the
// best match is the first card, already selected, so Enter opens its page.
export function SearchOverlay({ initial, restore, active, onOpen, onClose }: Props) {
  const docs = useSearchDocs()
  const index = useMemo(() => buildIndex(docs ?? []), [docs])
  const [query, setQuery] = useState(restore?.query ?? initial)
  const [settled, setSettled] = useState(query)
  const deferred = useDeferredValue(settled)
  const [selectedKey, setSelectedKey] = useState<string | null>(restore?.selectedKey ?? null)
  const input = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const restoring = useRef(restore !== null)

  useEffect(() => {
    const t = setTimeout(() => setSettled(query), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const parsed = parseQuery(deferred)
  const results = useMemo(() => search(index, deferred), [index, deferred])
  const rows = useMemo(() => (parsed.empty ? emptyRows(docs ?? []) : []), [parsed.empty, docs])
  const chips: Chip[] = useMemo(
    () => (parsed.empty ? [] : results.length ? relatedChips(results, deferred) : libraryGenreChips(docs ?? [])),
    [parsed.empty, results, deferred, docs]
  )

  // New results select their first card, except when coming back from a title page.
  useEffect(() => {
    if (restoring.current && docs) {
      restoring.current = false
      if (selectedKey && results.some((d) => d.key === selectedKey)) return
    }
    setSelectedKey(results[0]?.key ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])

  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const state = useCallback((key: string | null): SearchState => ({ query, selectedKey: key }), [query])
  const open = useCallback((d: SearchDoc) => onOpen(d.key, state(d.key)), [onOpen, state])

  const cardEls = () => [...(grid.current?.querySelectorAll<HTMLElement>('[data-testid="search-card"]') ?? [])]
  const columns = () => {
    const g = grid.current?.querySelector<HTMLElement>('.search-grid')
    return g ? getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length : 1
  }
  const focusCard = (i: number) => cardEls()[i]?.focus()
  const focusChip = (i: number) => chipsRef.current?.querySelectorAll<HTMLElement>('button')[i]?.focus()
  const backToBox = () => input.current?.focus()

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('nav')) return
      const inBox = target === input.current
      const inChips = !!target?.closest('.search-chips')
      const cards = cardEls()
      const cardIndex = cards.indexOf(target as HTMLElement)

      if (e.key === 'Escape') {
        e.preventDefault()
        if (input.current?.value) {
          setQuery('')
          setSettled('')
          backToBox()
        } else onClose()
        return
      }
      if (e.key === 'Enter') {
        if (inChips) return // the chip button handles it
        e.preventDefault()
        if (cardIndex >= 0) {
          const key = cards[cardIndex]!.dataset['key']
          const d = (parsed.empty ? rows.flatMap((r) => r.docs) : results).find((x) => x.key === key)
          if (d) open(d)
          return
        }
        // The box: act on what is typed now, not on results still settling.
        const now = input.current?.value ?? ''
        const fresh = parseQuery(now).empty ? [] : search(index, now)
        const pick = now === deferred ? (results.find((d) => d.key === selectedKey) ?? fresh[0]) : fresh[0]
        if (pick) onOpen(pick.key, { query: now, selectedKey: pick.key })
        return
      }
      if (isTyping(e) && !inBox) {
        e.preventDefault()
        setQuery((q) => q + e.key)
        backToBox()
        return
      }
      if (inBox && e.key === 'ArrowDown') {
        e.preventDefault()
        if (chips.length) focusChip(0)
        else focusCard(0)
        return
      }
      if (inChips) {
        const buttons = [...(chipsRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
        const i = buttons.indexOf(target!)
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)))]?.focus()
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          focusCard(0)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          backToBox()
        }
        return
      }
      if (cardIndex >= 0 && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const key = e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
        if (parsed.empty) {
          // Rows: ← → within a row, ↑ ↓ between rows.
          const rowEls = [...(grid.current?.querySelectorAll<HTMLElement>('.search-row') ?? [])]
          const row = rowEls.findIndex((r) => r.contains(target))
          const inRow = [...rowEls[row]!.querySelectorAll<HTMLElement>('[data-testid="search-card"]')]
          const col = inRow.indexOf(target!)
          if (key === 'ArrowLeft' || key === 'ArrowRight') inRow[Math.max(0, Math.min(inRow.length - 1, col + (key === 'ArrowLeft' ? -1 : 1)))]?.focus()
          else {
            const next = rowEls[row + (key === 'ArrowUp' ? -1 : 1)]
            if (!next) return void (key === 'ArrowUp' && backToBox())
            const nextCards = [...next.querySelectorAll<HTMLElement>('[data-testid="search-card"]')]
            nextCards[Math.min(col, nextCards.length - 1)]?.focus()
          }
          return
        }
        const to = moveInGrid(cardIndex, key, columns(), cards.length)
        if (to === 'up-out') {
          if (chips.length) focusChip(0)
          else backToBox()
        } else focusCard(to)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const pickChip = (c: Chip) => {
    setQuery(c.query)
    setSettled(c.query)
    backToBox()
  }

  const count = results.length
  const noMatch = !parsed.empty && docs !== null && count === 0
  const library = docs ?? []

  return (
    <div className="search-overlay" data-testid="search-overlay" role="dialog" aria-label="Search">
      <div className="search-bar">
        <svg className="search-icon" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          role="searchbox"
          aria-controls="search-results"
          aria-label="Search"
          placeholder="Search titles, people, genres"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {chips.length > 0 && !noMatch && (
        <div className="search-chips" ref={chipsRef}>
          <span className="search-chips-label">Explore titles related to:</span>
          {chips.map((c) => (
            <button type="button" key={c.query} data-testid="search-chip" onClick={() => pickChip(c)}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="search-results" id="search-results" ref={grid}>
        {parsed.empty ? (
          rows.length ? (
            rows.map((r) => (
              <section className="search-row" key={r.title}>
                <h2>{r.title}</h2>
                <div className="search-row-cards" role="listbox" aria-label={r.title}>
                  {r.docs.map((d, i) => (
                    <SearchCard key={d.key} doc={d} selected={false} tabbable={i === 0} onOpen={() => open(d)} onFocus={() => {}} />
                  ))}
                </div>
              </section>
            ))
          ) : docs !== null ? (
            <p className="search-hint">Add a folder in Settings to search your library.</p>
          ) : null
        ) : noMatch ? (
          <div className="search-none">
            <p className="search-none-title">Your search for “{deferred.trim()}” did not have any matches.</p>
            <p className="search-hint">Try a different title, an actor, a director or a genre.</p>
            <div className="search-chips" ref={chipsRef}>
              {chips.map((c) => (
                <button type="button" key={c.query} data-testid="search-chip" onClick={() => pickChip(c)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="search-grid" role="listbox" aria-label="Results">
            {results.map((d) => (
              <SearchCard
                key={d.key}
                doc={d}
                selected={d.key === selectedKey}
                tabbable={d.key === selectedKey}
                onOpen={() => open(d)}
                onFocus={() => setSelectedKey(d.key)}
              />
            ))}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {parsed.empty || library.length === 0 ? '' : count === 1 ? '1 result' : `${count} results`}
      </p>
    </div>
  )
}
