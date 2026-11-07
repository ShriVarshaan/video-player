import { useEffect, useState } from 'react'
import { aspectLabel, type AspectRatio } from '@shared/aspect'
import type { SubtitleStyle } from '@shared/subtitleStyle'
import { aspectLabelFont } from './subtitleLayout'

const SHOW_MS = 2000

// The aspect ratio in use, top right: while the controls show, and for a moment after
// C or Shift+C. pressed counts the presses (0: none yet).
export function AspectLabel({
  aspect,
  native,
  style,
  subtitlesOn,
  controlsShown,
  pressed
}: {
  aspect: AspectRatio | null
  native: number | null
  style: SubtitleStyle
  subtitlesOn: boolean
  controlsShown: boolean
  pressed: number
}) {
  const [justPressed, setJustPressed] = useState(false)
  useEffect(() => {
    if (!pressed) return
    setJustPressed(true)
    const t = setTimeout(() => setJustPressed(false), SHOW_MS)
    return () => clearTimeout(t)
  }, [pressed])
  return (
    <p className="aspect-label" data-testid="aspect-label" data-shown={controlsShown || justPressed} style={aspectLabelFont(style, subtitlesOn)}>
      {aspectLabel(aspect, native)}
    </p>
  )
}
