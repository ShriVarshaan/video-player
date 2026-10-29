import type { WallItem } from '@shared/library'

const runtime = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// First sentence only: the card is a glance, not a synopsis.
const firstSentence = (text: string) => /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text

export function metaLine(item: WallItem): string {
  const parts: string[] = []
  if (item.year !== null) parts.push(String(item.year))
  if (item.kind === 'show' && item.episodeCount !== null) {
    parts.push(item.seasonCount ? `${plural(item.seasonCount, 'season')} · ${plural(item.episodeCount, 'episode')}` : plural(item.episodeCount, 'episode'))
  } else if (item.runtimeMin) parts.push(runtime(item.runtimeMin))
  if (item.genres.length > 0) parts.push(item.genres.slice(0, 3).join(', '))
  if (item.rating !== null && item.rating > 0) parts.push(`★ ${item.rating.toFixed(1)}`)
  return parts.join(' · ')
}

// Details for the focused title, fixed at the bottom left of the wall.
export function InfoCard({ item }: { item: WallItem | null }) {
  return (
    <div className={`info-card${item ? ' shown' : ''}`} data-testid="info-card" aria-hidden={!item}>
      {item && (
        <>
          <h2 className="card-title">{item.title}</h2>
          <p className="card-meta">{metaLine(item)}</p>
          {item.overview && <p className="card-synopsis">{firstSentence(item.overview)}</p>}
          <div className="card-actions">
            <button type="button" className="primary" disabled>
              {item.playLabel}
            </button>
            <span className="card-hint">Playback arrives in a later update</span>
          </div>
        </>
      )}
    </div>
  )
}
