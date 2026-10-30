import { useEffect, useRef, useState } from 'react'
import { catchAppError } from '@shared/appError'
import type { EpisodeItem, TitleButton, TitleDetail } from '@shared/library'
import { timeLeft } from '@shared/time'
import './title.css'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const runtime = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`)

function metaParts(t: TitleDetail): string[] {
  const parts: string[] = []
  if (t.year !== null) parts.push(String(t.year))
  if (t.kind === 'show' && t.episodeCount !== null) {
    if (t.seasonCount) parts.push(plural(t.seasonCount, 'season'))
    parts.push(plural(t.episodeCount, 'episode'))
  } else if (t.runtimeMin) parts.push(runtime(t.runtimeMin))
  if (t.genres.length > 0) parts.push(t.genres.slice(0, 3).join(', '))
  return parts
}

function episodeNote(e: EpisodeItem): string {
  if (e.finished) return 'Watched'
  if (e.positionS > 0 && e.durationS) return timeLeft(e.durationS - e.positionS)
  return e.durationS ? `${Math.max(1, Math.round(e.durationS / 60))} min` : ''
}

const play = (key: string, b: Pick<TitleButton, 'videoId' | 'from'>) =>
  window.api.player
    .play({ key, videoId: b.videoId, from: b.from })
    .catch((err: unknown) => catchAppError(err, { DEFAULT: ({ message }) => console.error(message) }))

// ← / → move between the buttons of one row (seasons, episodes); Tab leaves the row.
function rove(e: React.KeyboardEvent<HTMLButtonElement>) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  const row = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])]
  const next = row[row.indexOf(e.currentTarget) + (e.key === 'ArrowRight' ? 1 : -1)]
  e.preventDefault()
  next?.focus()
  next?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

// A movie's or show's page: backdrop, details, play buttons and, for shows, the episodes.
export function TitlePage({ titleKey, active, onBack }: { titleKey: string; active: boolean; onBack: () => void }) {
  const [t, setT] = useState<TitleDetail | null>(null)
  const [season, setSeason] = useState<number | null>(null)
  const main = useRef<HTMLButtonElement>(null)
  const focusedFor = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      window.api.library
        .getTitle({ key: titleKey })
        .then((d) => live && setT(d))
        .catch((err: unknown) => catchAppError(err, { DEFAULT: ({ message }) => console.error(message) }))
    void load()
    const offs = [window.api.on('library.changed', () => void load()), window.api.on('player.closed', () => void load())]
    return () => {
      live = false
      offs.forEach((off) => off())
    }
  }, [titleKey])

  // On arrival: open the next-up episode's season and put focus on the main button.
  useEffect(() => {
    if (!t || focusedFor.current === t.key) return
    focusedFor.current = t.key
    setSeason(t.openSeason)
    main.current?.focus()
  }, [t])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as Element | null)?.closest?.('input, nav')) {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onBack])

  if (!t) return <div className="title-page" data-testid="title-page" />

  const shown = t.seasons.find((s) => s.season === season) ?? t.seasons[0]
  const nextUpId = t.main.videoId
  const rovingEpisode = shown?.episodes.find((e) => e.videoId === nextUpId) ?? shown?.episodes[0]

  return (
    <div className={`title-page${t.kind === 'show' ? ' is-show' : ''}`} data-testid="title-page">
      {t.backdropUrl ? (
        <img className="title-backdrop" src={t.backdropUrl} alt="" />
      ) : (
        <div className="title-backdrop is-poster" style={{ backgroundImage: `url("${t.posterUrl}")` }} />
      )}
      <div className="title-shade" aria-hidden="true" />

      <button type="button" className="title-back" onClick={onBack}>
        ‹ Home
      </button>

      <section className="title-body" aria-labelledby="title-heading">
        <h1 id="title-heading" className="title-heading" data-testid="title-heading">
          {t.title}
        </h1>
        <p className="title-meta" data-testid="title-meta">
          {metaParts(t).join(' · ')}
          {t.rating !== null && t.rating > 0 && (
            <span className="title-rating" data-testid="title-rating">
              TMDB {t.rating.toFixed(1)}
            </span>
          )}
          {t.watched && <span className="title-watched">Watched</span>}
        </p>
        {t.overview && (
          <p className="title-synopsis" data-testid="title-synopsis">
            {t.overview}
          </p>
        )}
        <div className="title-actions">
          <button ref={main} type="button" className="primary" data-testid="title-main" onClick={() => void play(t.key, t.main)}>
            <span aria-hidden="true">▶ </span>
            {t.main.label}
          </button>
          {t.restart && (
            <button type="button" className="secondary" data-testid="title-restart" onClick={() => void play(t.key, t.restart!)}>
              <span aria-hidden="true">↺ </span>
              {t.restart.label}
            </button>
          )}
          {t.remainingS !== null && (
            <span className="title-left" data-testid="title-left">
              {timeLeft(t.remainingS)}
            </span>
          )}
        </div>
        {t.progress !== null && (
          <div className="title-progress" aria-hidden="true">
            <i style={{ transform: `scaleX(${t.progress})` }} />
          </div>
        )}
      </section>

      {t.kind === 'show' && shown && (
        <section className="title-episodes" aria-label="Episodes">
          <div className="season-row" role="group" aria-label="Seasons">
            {t.seasons.map((s) => (
              <button
                key={s.season}
                type="button"
                className="season-tab"
                data-testid="season-tab"
                aria-pressed={s.season === shown.season}
                tabIndex={s.season === shown.season ? 0 : -1}
                onClick={() => setSeason(s.season)}
                onKeyDown={rove}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="episode-strip" role="group" aria-label={shown.name}>
            {shown.episodes.map((e) => {
              const partway = !e.finished && e.positionS > 0 && e.durationS
              return (
                <button
                  key={e.videoId}
                  type="button"
                  className="episode-card"
                  data-testid="episode-card"
                  tabIndex={e === rovingEpisode ? 0 : -1}
                  onClick={() => void play(t.key, { videoId: e.videoId, from: 'resume' })}
                  onKeyDown={rove}
                >
                  <span className="episode-still">
                    <img src={e.stillUrl} alt="" loading="lazy" />
                    {partway && (
                      <span className="episode-progress" aria-hidden="true">
                        <i style={{ transform: `scaleX(${e.positionS / e.durationS!})` }} />
                      </span>
                    )}
                  </span>
                  <span className="episode-name">
                    {e.episode} · {e.title ?? `Episode ${e.episode}`}
                  </span>
                  <span className="episode-note">{episodeNote(e)}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
