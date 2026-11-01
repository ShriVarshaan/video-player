import { useCallback, useEffect, useState } from 'react'
import { Menu } from './nav/Menu'
import { SearchOverlay, type SearchState } from './search/SearchOverlay'
import { Settings } from './pages/Settings'
import { TitlePage } from './pages/Title'
import { Wall } from './wall/Wall'
import './app.css'

// 'search' is the menu entry; search itself is an overlay over Home (milestone 8).
export type Page = 'home' | 'search' | 'settings'

export function App() {
  const [page, setPage] = useState<Exclude<Page, 'search'>>('home')
  // A title page belongs to Home: it opens over the wall, and Esc goes back to it.
  const [titleKey, setTitleKey] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // mpv draws over this window while playing; the page underneath is blanked.
  const [playing, setPlaying] = useState(false)
  // The open search, and where back from a title page opened from it returns to.
  const [search, setSearch] = useState<{ initial: string; restore: SearchState | null } | null>(null)
  const [fromSearch, setFromSearch] = useState<SearchState | null>(null)

  useEffect(() => {
    const offs = [
      window.api.on('player.state', () => setPlaying(true)),
      window.api.on('player.closed', ({ titleKey: key }) => {
        setPlaying(false)
        setPage('home')
        setSearch(null)
        setTitleKey(key)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const openSearch = useCallback((initial: string) => {
    setTitleKey(null)
    setFromSearch(null)
    setPage('home')
    setSearch({ initial, restore: null })
  }, [])

  const navigate = (p: Page) => {
    if (p === 'search') return openSearch('')
    setSearch(null)
    setFromSearch(null)
    setTitleKey(null)
    setPage(p)
  }
  const back = useCallback(() => {
    setTitleKey(null)
    ;(document.activeElement as HTMLElement | null)?.blur()
    if (fromSearch) {
      setSearch({ initial: fromSearch.query, restore: fromSearch })
      setFromSearch(null)
    }
  }, [fromSearch])
  const openFromWall = useCallback((key: string) => {
    setFromSearch(null)
    setTitleKey(key)
  }, [])
  const openFromSearch = useCallback((key: string, state: SearchState) => {
    setSearch(null)
    setFromSearch(state)
    setTitleKey(key)
  }, [])
  const closeSearch = useCallback(() => setSearch(null), [])

  const onTitle = page === 'home' && titleKey !== null
  const searching = page === 'home' && !onTitle && search !== null

  return (
    <>
      <Menu page={searching ? 'search' : page} open={menuOpen} onOpenChange={setMenuOpen} onNavigate={navigate} />
      {/* The page behind the open drawer is dimmed and out of the tab order. */}
      <div className="pages" inert={menuOpen || playing}>
        {/* The wall stays mounted on other pages so it keeps its place. */}
        <div className="home" hidden={page !== 'home' || onTitle} data-testid="wall-home" inert={searching}>
          <Wall
            active={page === 'home' && !onTitle && !searching && !menuOpen && !playing}
            onOpen={openFromWall}
            onSearch={openSearch}
            onSettings={() => navigate('settings')}
          />
        </div>
        {searching && (
          <SearchOverlay
            key={search.restore ? `restore:${search.restore.query}` : `new:${search.initial}`}
            initial={search.initial}
            restore={search.restore}
            active={!menuOpen && !playing}
            onOpen={openFromSearch}
            onClose={closeSearch}
          />
        )}
        {onTitle && <TitlePage titleKey={titleKey} active={!menuOpen && !playing} onBack={back} />}
        {page === 'settings' && <Settings />}
      </div>
      {playing && <div className="player-cover" aria-hidden="true" />}
    </>
  )
}
