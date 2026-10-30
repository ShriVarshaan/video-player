import { useCallback, useEffect, useRef, useState } from 'react'
import type { SubtitleStyle } from '@shared/subtitleStyle'
import { SubtitleStyleControls } from '../src/components/SubtitleStyleControls'

// The subtitle style panel in the player. Changes stay with this title (movie or
// whole show) unless "Use for all movies and shows" makes them global.
export function StylePanel({ titleKey, style, onClose }: { titleKey: string; style: SubtitleStyle; onClose: () => void }) {
  const root = useRef<HTMLElement>(null)
  const [hasOwn, setHasOwn] = useState(false)
  // Changes show at once and build on each other; the style main sends back is
  // taken only once nothing is in flight, so a quick run of key presses isn't lost.
  const [draft, setDraft] = useState(style)
  const pending = useRef(0)
  const latest = useRef(style)
  useEffect(() => {
    latest.current = style
    if (pending.current === 0) setDraft(style)
  }, [style])

  const refresh = useCallback(async () => {
    const { overrides } = await window.api.subtitles.getStyle({ key: titleKey })
    setHasOwn(Object.keys(overrides).length > 0)
  }, [titleKey])

  useEffect(() => {
    void refresh()
    root.current?.querySelector<HTMLElement>('.style-row')?.focus()
  }, [refresh])

  const run = (p: Promise<void>) => {
    pending.current++
    void p
      .then(refresh)
      .catch((e: unknown) => console.warn('subtitle style:', e))
      .finally(() => {
        if (--pending.current === 0) setDraft(latest.current)
      })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    // The player's own keys (Space, arrows, F, M, Esc) don't act while the panel is open.
    e.stopPropagation()
  }

  return (
    <aside ref={root} className="style-panel" data-testid="style-panel" aria-label="Subtitle style" onKeyDown={onKeyDown}>
      <h2>Subtitle style</h2>
      <p className="style-scope">{hasOwn ? 'Changed for this title' : 'Changes apply to this title only'}</p>
      <SubtitleStyleControls
        style={draft}
        onChange={(patch) => {
          setDraft((d) => ({ ...d, ...patch }))
          run(window.api.subtitles.setTitleStyle({ key: titleKey, patch }))
        }}
      />
      <div className="style-actions">
        <button type="button" className="primary" onClick={() => run(window.api.subtitles.useForAll({ key: titleKey }))}>
          Use for all movies and shows
        </button>
        {hasOwn && (
          <button type="button" onClick={() => run(window.api.subtitles.resetTitle({ key: titleKey }))}>
            Reset to my global style
          </button>
        )}
      </div>
    </aside>
  )
}
