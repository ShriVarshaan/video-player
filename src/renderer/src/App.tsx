import { useCallback, useEffect, useState } from 'react'
import { Menu } from './nav/Menu'
import { SearchSoon } from './pages/SearchSoon'
import { Settings } from './pages/Settings'
import { TitlePage } from './pages/Title'
import { Wall } from './wall/Wall'
import './app.css'

export type Page = 'home' | 'search' | 'settings'

export function App() {
  const [page, setPage] = useState<Page>('home')
  // A title page belongs to Home: it opens over the wall, and Esc goes back to it.
  const [titleKey, setTitleKey] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // mpv draws over this window while playing; the page underneath is blanked.
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const offs = [
      window.api.on('player.state', () => setPlaying(true)),
      window.api.on('player.closed', ({ titleKey: key }) => {
        setPlaying(false)
        setPage('home')
        setTitleKey(key)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const navigate = (p: Page) => {
    setTitleKey(null)
    setPage(p)
  }
  const back = useCallback(() => {
    setTitleKey(null)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }, [])

  const onTitle = page === 'home' && titleKey !== null

  return (
    <>
      <Menu page={page} open={menuOpen} onOpenChange={setMenuOpen} onNavigate={navigate} />
      {/* The page behind the open drawer is dimmed and out of the tab order. */}
      <div className="pages" inert={menuOpen || playing}>
        {/* The wall stays mounted on other pages so it keeps its place. */}
        <div className="home" hidden={page !== 'home' || onTitle} data-testid="wall-home">
          <Wall
            active={page === 'home' && !onTitle && !menuOpen && !playing}
            onOpen={setTitleKey}
            onSearch={() => navigate('search')}
            onSettings={() => navigate('settings')}
          />
        </div>
        {onTitle && <TitlePage titleKey={titleKey} active={!menuOpen && !playing} onBack={back} />}
        {page === 'search' && <SearchSoon />}
        {page === 'settings' && <Settings />}
      </div>
      {playing && <div className="player-cover" aria-hidden="true" />}
    </>
  )
}
