import { useState } from 'react'
import { Menu } from './nav/Menu'
import { SearchSoon } from './pages/SearchSoon'
import { Settings } from './pages/Settings'
import { Wall } from './wall/Wall'
import './app.css'

export type Page = 'home' | 'search' | 'settings'

export function App() {
  const [page, setPage] = useState<Page>('home')
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <Menu page={page} open={menuOpen} onOpenChange={setMenuOpen} onNavigate={setPage} />
      {/* The wall stays mounted on other pages so it keeps its place. */}
      <div className="home" hidden={page !== 'home'} data-testid="wall-home">
        <Wall active={page === 'home' && !menuOpen} onSearch={() => setPage('search')} onSettings={() => setPage('settings')} />
      </div>
      {page === 'search' && <SearchSoon />}
      {page === 'settings' && <Settings />}
    </>
  )
}
