import { useState } from 'react'
import { Menu } from './nav/Menu'
import { SearchSoon } from './pages/SearchSoon'
import { Settings } from './pages/Settings'
import './app.css'

export type Page = 'home' | 'search' | 'settings'

export function App() {
  const [page, setPage] = useState<Page>('home')
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <Menu page={page} open={menuOpen} onOpenChange={setMenuOpen} onNavigate={setPage} />
      {page === 'home' && <div data-testid="wall-home" className="home" />}
      {page === 'search' && <SearchSoon />}
      {page === 'settings' && <Settings />}
    </>
  )
}
