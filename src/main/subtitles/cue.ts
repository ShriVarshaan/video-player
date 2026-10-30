import type { Cue, CueSpan } from '@shared/player'

// mpv's formatted current line (sub-text/ass) → what the overlay draws. Only
// line breaks, italics, bold and top alignment survive; every other ASS or
// HTML tag is dropped, and the rest stays plain text.
export function toCue(ass: unknown): Cue | null {
  if (typeof ass !== 'string' || !ass) return null
  let italic = false
  let bold = false
  let top = false
  const lines: CueSpan[][] = []

  for (const raw of ass.split(/\\N|\r?\n/)) {
    const line: CueSpan[] = []
    const push = (text: string) => {
      if (!text) return
      const last = line.at(-1)
      if (last && last.italic === italic && last.bold === bold) last.text += text
      else line.push({ text, italic, bold })
    }
    // Override blocks {…}, HTML-like tags <b>, </i>, <font …>, or plain text.
    for (const m of raw.matchAll(/\{([^}]*)\}|<(\/?)([a-z]+)[^>]*>|([^{<]+|[{<])/gi)) {
      if (m[1] !== undefined) {
        for (const t of m[1].matchAll(/\\(i|b)(\d)|\\an(\d)/g)) {
          if (t[3]) top = Number(t[3]) >= 7
          else if (t[1] === 'i') italic = t[2] !== '0'
          else bold = t[2] !== '0'
        }
      } else if (m[3] !== undefined) {
        const on = m[2] !== '/'
        if (m[3].toLowerCase() === 'i') italic = on
        else if (m[3].toLowerCase() === 'b') bold = on
      } else {
        push(m[4]!.replace(/\\h/g, ' '))
      }
    }
    if (line.some((s) => s.text.trim())) lines.push(line)
  }
  return lines.length ? { lines, top } : null
}
