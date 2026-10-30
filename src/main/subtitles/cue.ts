import type { Cue, CueSpan } from '@shared/player'

// mpv's formatted current line (sub-text/ass) → what the overlay draws. Only
// line breaks, italics, bold and top alignment survive; every other ASS or
// HTML tag is dropped, and the rest stays plain text.
export function toCue(ass: unknown): Cue | null {
  if (typeof ass !== 'string' || !ass) return null
  let italic = false
  let bold = false
  let top = false
  // Inside {\p1}…{\p0} the "text" is vector drawing commands (sign masks): never shown.
  let drawing = false
  const lines: CueSpan[][] = []

  for (const raw of ass.split(/\\N|\r?\n/)) {
    const line: CueSpan[] = []
    drawing = false // a drawing never runs on into the next line
    const push = (text: string) => {
      if (!text || drawing) return
      const last = line.at(-1)
      if (last && last.italic === italic && last.bold === bold) last.text += text
      else line.push({ text, italic, bold })
    }
    // Override blocks {…}, HTML-like tags <b>, </i>, <font …>, or plain text.
    for (const m of raw.matchAll(/\{([^}]*)\}|<(\/?)([a-z]+)[^>]*>|([^{<]+|[{<])/gi)) {
      if (m[1] !== undefined) {
        for (const t of m[1].matchAll(/\\(i|b)(\d)|\\an(\d)|\\p(\d)/g)) {
          if (t[4]) drawing = t[4] !== '0'
          else if (t[3]) top = Number(t[3]) >= 7
          else if (t[1] === 'i') italic = t[2] !== '0'
          else bold = t[2] !== '0'
        }
      } else if (m[3] !== undefined) {
        const on = m[2] !== '/'
        if (m[3].toLowerCase() === 'i') italic = on
        else if (m[3].toLowerCase() === 'b') bold = on
      } else {
        // \h is a hard space; \n is ASS's soft break, a space unless wrapping needs it.
        push(m[4]!.replace(/\\h/g, ' ').replace(/\\n/g, ' '))
      }
    }
    if (line.some((s) => s.text.trim())) lines.push(line)
  }
  return lines.length ? { lines, top } : null
}
