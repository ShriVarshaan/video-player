import { useCallback, useEffect, useRef, useState } from 'react'
import { catchAppError } from '@shared/appError'
import { LANGUAGES, languageName } from '@shared/lang'
import type { SubtitleResult } from '@shared/subtitleSearch'

type Status = { kind: 'searching' } | { kind: 'results' } | { kind: 'downloading'; fileId: number } | { kind: 'error'; message: string }

function errorMessage(e: unknown): string {
  let message = 'Something went wrong.'
  catchAppError(e, {
    opensubtitles_quota: ({ message: m, payload }) => {
      const at = (payload as { resetAt?: string | null } | undefined)?.resetAt
      const time = at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
      message = time ? `${m} More are available at ${time}.` : m
    },
    DEFAULT: ({ message: m }) => (message = m)
  })
  return message
}

// "Search online…": OpenSubtitles results for the playing video. Nothing is sent
// until this opens. Picking a row downloads it, saves it next to the video and shows it.
export function SearchPanel({ onClose }: { onClose: () => void }) {
  const root = useRef<HTMLElement>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [results, setResults] = useState<SubtitleResult[]>([])
  const [remaining, setRemaining] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'searching' })

  useEffect(() => {
    window.api.subtitles
      .getSettings({})
      .then((s) => setLanguage(s.language))
      .catch(() => setLanguage('eng'))
  }, [])

  const search = useCallback(async (lang: string) => {
    setStatus({ kind: 'searching' })
    try {
      const r = await window.api.subtitles.search({ language: lang })
      setResults(r.results)
      setRemaining(r.remaining)
      setStatus({ kind: 'results' })
    } catch (e) {
      setStatus({ kind: 'error', message: errorMessage(e) })
    }
  }, [])

  useEffect(() => {
    if (language) void search(language)
  }, [language, search])

  useEffect(() => {
    if (status.kind === 'results') root.current?.querySelector<HTMLElement>('[data-testid="search-result"]')?.focus()
  }, [status.kind])

  async function pick(fileId: number) {
    setStatus({ kind: 'downloading', fileId })
    try {
      await window.api.subtitles.download({ fileId })
      onClose()
    } catch (e) {
      setStatus({ kind: 'error', message: errorMessage(e) })
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-testid="search-result"]') ?? [])]
      const i = rows.indexOf(document.activeElement as HTMLElement)
      rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      e.preventDefault()
    }
    // The player's own keys don't act while the panel is open.
    e.stopPropagation()
  }

  const busy = status.kind === 'downloading'
  return (
    <aside ref={root} className="style-panel search-panel" data-testid="search-panel" aria-label="Search subtitles online" onKeyDown={onKeyDown}>
      <h2>Search online</h2>
      <div className="search-bar">
        <select
          aria-label="Language"
          value={language ?? ''}
          disabled={busy}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code2} value={l.code2}>
              {l.name}
            </option>
          ))}
        </select>
        {remaining !== null && <span className="search-left">{remaining} downloads left today</span>}
      </div>

      {status.kind === 'searching' && <p className="search-note" role="status">Searching OpenSubtitles…</p>}
      {status.kind === 'error' && (
        <p className="search-note" role="alert">
          {status.message}
        </p>
      )}
      {status.kind !== 'searching' && status.kind !== 'error' && results.length === 0 && (
        <p className="search-note">No subtitles found in {language ? languageName(language) : 'this language'}.</p>
      )}

      {(status.kind === 'results' || busy) && results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.fileId}>
              <button type="button" data-testid="search-result" disabled={busy} onClick={() => void pick(r.fileId)}>
                <span className="search-release">{r.release}</span>
                <span className="search-meta">
                  {r.hashMatch && <b className="search-badge">Matches your file</b>}
                  {r.sdh && <span className="search-flag">SDH</span>}
                  {r.forced && <span className="search-flag">Forced</span>}
                  <span>{languageName(r.language)}</span>
                  <span>{r.downloads.toLocaleString()} downloads</span>
                  {status.kind === 'downloading' && status.fileId === r.fileId && <span role="status">Downloading…</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="search-credit">Subtitles from OpenSubtitles.com</p>
    </aside>
  )
}
