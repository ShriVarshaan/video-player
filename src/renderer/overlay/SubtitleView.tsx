import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Cue } from '@shared/player'
import type { SubtitleStyle } from '@shared/subtitleStyle'
import { styleToCss, subtitleBottom } from './subtitleLayout'
import './subtitles.css'

const FADE_OUT_MS = 160

function useWindowHeight(): number {
  const [h, setH] = useState(() => window.innerHeight)
  useEffect(() => {
    const on = () => setH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return h
}

// The subtitle line, Apple TV style: drawn as text over the video, in the user's
// style, at their height, lifted above the controls while they show.
export function SubtitleView({ cue, style, controlsTop, sample }: { cue: Cue | null; style: SubtitleStyle; controlsTop: number | null; sample?: string | null }) {
  const windowH = useWindowHeight()
  const block = useRef<HTMLDivElement>(null)
  const [blockH, setBlockH] = useState(0)
  const showing: Cue | null = cue ?? (sample ? { top: false, lines: [[{ text: sample, italic: false, bold: false }]] } : null)
  // The last cue stays drawn while it fades out.
  const [drawn, setDrawn] = useState<Cue | null>(showing)
  const showingKey = JSON.stringify(showing)
  useEffect(() => {
    const next = JSON.parse(showingKey) as Cue | null
    if (next) return setDrawn(next)
    const t = setTimeout(() => setDrawn(null), FADE_OUT_MS)
    return () => clearTimeout(t)
  }, [showingKey])

  useLayoutEffect(() => {
    const el = block.current
    if (!el) return
    const measure = () => setBlockH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bottom = subtitleBottom({ position: style.position, windowH, blockH, controlsTop, top: drawn?.top ?? false })

  return (
    <div
      ref={block}
      className="subs"
      data-testid="subtitle"
      data-shown={showing !== null}
      data-position={Math.round(bottom)}
      aria-live="off"
      style={{ ...styleToCss(style, windowH), transform: `translateY(${-bottom}px)` }}
    >
      {drawn && (
        <div className="subs-window">
          {drawn.lines.map((line, i) => (
            <div className="subs-line" key={i}>
              <span>
                {line.map((s, j) => (
                  <span key={j} style={{ fontStyle: s.italic ? 'italic' : undefined, fontWeight: s.bold ? 700 : undefined }}>
                    {s.text}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
