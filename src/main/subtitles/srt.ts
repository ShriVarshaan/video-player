import type { ParsedCue } from './parse'

function stamp(s: number): string {
  const ms = Math.round(Math.max(0, s) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

// Cues → an SRT file (CRLF, no BOM, numbered from 1) with the offset applied.
// Cues that would end at or before 0 are dropped; starts are clamped to 0.
export function writeSrt(cues: ParsedCue[], offset: number): string {
  let n = 0
  let out = ''
  for (const c of cues) {
    const start = c.start + offset
    const end = c.end + offset
    if (end <= 0) continue
    let text = c.lines.join('\r\n')
    if (c.italic) text = `<i>${text}</i>`
    if (c.top) text = `{\\an8}${text}`
    out += `${++n}\r\n${stamp(start)} --> ${stamp(end)}\r\n${text}\r\n\r\n`
  }
  return out
}
