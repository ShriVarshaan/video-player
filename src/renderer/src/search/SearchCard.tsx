import { useState } from 'react'
import type { SearchDoc } from '@shared/library'

export const cardLabel = (d: SearchDoc) => (d.year ? `${d.title} (${d.year})` : d.title)

// year · runtime or "3 seasons" · genres, under the selected card.
export function cardMeta(d: SearchDoc): string {
  const parts: string[] = []
  if (d.year) parts.push(String(d.year))
  if (d.kind === 'show' && d.seasonCount) parts.push(d.seasonCount === 1 ? '1 season' : `${d.seasonCount} seasons`)
  else if (d.runtimeMin) parts.push(d.runtimeMin >= 60 ? `${Math.floor(d.runtimeMin / 60)}h ${d.runtimeMin % 60}m` : `${d.runtimeMin}m`)
  if (d.genres.length) parts.push(d.genres.slice(0, 3).join(', '))
  return parts.join(' · ')
}

type Props = {
  doc: SearchDoc
  selected: boolean
  tabbable: boolean
  onOpen: () => void
  onFocus: () => void
}

// A wide 16:9 card: backdrop with the title logo, or the title in text. With no
// backdrop, the poster sits over a blurred copy of itself.
export function SearchCard({ doc, selected, tabbable, onOpen, onFocus }: Props) {
  const [logoFailed, setLogoFailed] = useState(false)
  const [artFailed, setArtFailed] = useState(false)
  const showLogo = doc.logoUrl !== null && !logoFailed
  return (
    <div className="search-cell" data-selected={selected}>
      <div
        role="option"
        className="search-card"
        data-testid="search-card"
        data-key={doc.key}
        aria-label={cardLabel(doc)}
        aria-selected={selected}
        tabIndex={tabbable ? 0 : -1}
        onClick={onOpen}
        onFocus={onFocus}
      >
        {doc.backdropUrl && !artFailed ? (
          <img className="search-art" src={doc.backdropUrl} alt="" loading="lazy" onError={() => setArtFailed(true)} />
        ) : (
          <>
            <img className="search-art search-art-blur" src={doc.posterUrl} alt="" loading="lazy" />
            <img className="search-poster" src={doc.posterUrl} alt="" loading="lazy" />
          </>
        )}
        <div className="search-shade" />
        {showLogo ? (
          <img className="search-logo" src={doc.logoUrl!} alt="" onError={() => setLogoFailed(true)} />
        ) : (
          <span className="search-name">{doc.title}</span>
        )}
        {doc.progress !== null && (
          <span className="search-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${doc.progress})` }} />
          </span>
        )}
      </div>
      <p className="search-meta" aria-hidden={!selected}>
        {cardMeta(doc)}
      </p>
    </div>
  )
}
