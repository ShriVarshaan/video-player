import { useEffect, useRef, useState } from 'react'
import { catchAppError } from '@shared/appError'
import type { WallItem } from '@shared/library'
import { Backdrop } from './Backdrop'
import { WallEngine } from './engine'
import { InfoCard } from './InfoCard'
import './wall.css'

const CARD_DELAY = 400 // ms focus must rest before the card and backdrop change

type Props = {
  active: boolean // false while the menu is open or another page is shown
  onSearch: () => void
  onSettings: () => void
}

// The home screen. WallEngine moves the tiles; React only hears about focus changes.
export function Wall({ active, onSearch, onSettings }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const engine = useRef<WallEngine | null>(null)
  const search = useRef(onSearch)
  search.current = onSearch
  const [items, setItems] = useState<WallItem[] | null>(null)
  const [focused, setFocused] = useState<WallItem | null>(null)
  const [card, setCard] = useState<WallItem | null>(null)

  useEffect(() => {
    const e = new WallEngine(root.current!, plane.current!, {
      onFocus: setFocused,
      onActivate: setCard,
      onSearch: () => search.current()
    })
    engine.current = e
    return () => e.destroy()
  }, [])

  useEffect(() => {
    const load = () =>
      window.api.library
        .wall({})
        .then(setItems)
        .catch((err: unknown) => catchAppError(err, { DEFAULT: ({ message }) => console.error(message) }))
    void load()
    return window.api.on('library.changed', () => void load())
  }, [])

  useEffect(() => {
    if (items) engine.current?.setItems(items)
  }, [items])

  useEffect(() => {
    engine.current?.setActive(active && !!items && items.length > 0)
  }, [active, items])

  // The card follows focus once it rests; an activated tile's card is already up.
  useEffect(() => {
    setCard((c) => (c && focused && c.key === focused.key ? c : null))
    if (!focused) return
    const timer = setTimeout(() => setCard(focused), CARD_DELAY)
    return () => clearTimeout(timer)
  }, [focused])

  const empty = items !== null && items.length === 0

  return (
    <div className="wall" ref={root} role="application" aria-label="Poster wall" tabIndex={-1} data-testid="wall">
      <Backdrop url={card ? (card.backdropUrl ?? card.posterUrl) : null} />
      <div className="wall-plane" ref={plane} data-testid="wall-plane" />
      <div className="wall-shade" aria-hidden="true" />
      <InfoCard item={card} />
      <p className="sr-only" aria-live="polite" data-testid="wall-live">
        {focused ? (focused.year !== null ? `${focused.title}, ${focused.year}` : focused.title) : ''}
      </p>
      {empty && (
        <div className="wall-empty">
          <h1>Your wall is empty</h1>
          <p className="muted">Choose a folder of movies or shows to fill it.</p>
          <button type="button" className="primary" onClick={onSettings}>
            Choose a folder
          </button>
        </div>
      )}
    </div>
  )
}
