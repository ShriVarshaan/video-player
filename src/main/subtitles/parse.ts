import { readFile } from 'node:fs/promises'
import { decodeSubtitle } from './decode'

// One subtitle line as the app reads it (times in seconds). Used by "Sync to a
// line" and export; what is drawn on screen still comes from mpv.
export type ParsedCue = { start: number; end: number; lines: string[]; italic: boolean; top: boolean }

type Raw = { start: number; end: number; text: string; italic: boolean; top: boolean }

// "01:02:03,5", "02:03.250" or (ASS) "1:02:03.25" → seconds. Milliseconds are right-padded.
function seconds(h: string | undefined, m: string, s: string, frac: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${frac.padEnd(3, '0')}`)
}

const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/
const TIMING = new RegExp(`${TIME.source}\\s*-->\\s*${TIME.source}(.*)$`)

function timing(line: string): { start: number; end: number; settings: string } | null {
  const m = TIMING.exec(line)
  if (!m) return null
  return { start: seconds(m[1], m[2]!, m[3]!, m[4]!), end: seconds(m[5], m[6]!, m[7]!, m[8]!), settings: m[9] ?? '' }
}

// Italic and top survive; every other tag (HTML-like or {\…}) is dropped.
function cleanTags(text: string): { text: string; italic: boolean; top: boolean } {
  let italic = false
  let top = false
  for (const t of text.matchAll(/\{([^}]*)\}/g)) {
    for (const a of t[1]!.matchAll(/\\an(\d)|\\i(\d)/g)) {
      if (a[1]) top = Number(a[1]) >= 7
      else if (a[2] === '1') italic = true
    }
  }
  if (/<(i|em)\b[^>]*>/i.test(text)) italic = true
  const out = text
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((l) => l.replace(/^[\s ​-‍﻿]+|[\s ​-‍﻿]+$/g, ''))
    .join('\n')
  return { text: out, italic, top }
}

function blocks(text: string): string[][] {
  return text.split(/\n\s*\n/).map((b) => b.split('\n')).filter((b) => b.some((l) => l.trim()))
}

// Cues run from one timing line to the next, so a blank line inside a cue keeps
// its text. The index number just before a timing line is not text.
function parseSrt(text: string): Raw[] {
  const out: Raw[] = []
  let cur: { start: number; end: number; lines: string[] } | null = null
  const finish = () => {
    if (!cur) return
    const lines = [...cur.lines]
    while (lines.length && !lines.at(-1)!.trim()) lines.pop()
    // An index stands alone after a blank line; "1984" right under text is text.
    if (lines.length && /^\s*\d+\s*$/.test(lines.at(-1)!) && (lines.length === 1 || !lines.at(-2)!.trim())) lines.pop()
    out.push({ start: cur.start, end: cur.end, ...cleanTags(lines.join('\n')) })
  }
  for (const line of text.split('\n')) {
    const t = TIMING.test(line) ? timing(line) : null
    if (t) {
      finish()
      cur = { start: t.start, end: t.end, lines: [] }
    } else if (cur) cur.lines.push(line)
  }
  finish()
  return out
}

function parseVtt(text: string): Raw[] {
  const out: Raw[] = []
  for (const block of blocks(text)) {
    const first = block[0]!.trim()
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(first)) continue
    const i = block.findIndex((l) => TIMING.test(l))
    if (i < 0) continue
    const t = timing(block[i]!)!
    const body = block
      .slice(i + 1)
      .join('\n')
      .replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, '')
    const c = cleanTags(body)
    const line = /(?:^|\s)line:(-?[\d.]+)(%?)/.exec(t.settings)
    const top = line ? (line[2] === '%' ? Number(line[1]) < 50 : Number(line[1]) >= 0 && Number(line[1]) < 3) : false
    out.push({ start: t.start, end: t.end, ...c, top: c.top || top })
  }
  return out
}

const ASS_TIME = /^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/
const SIGN_STYLE = /sign|song|karaoke|^op|^ed/i

function parseAss(text: string): Raw[] {
  let section = ''
  let format: string[] = []
  const events: { style: string; start: number; end: number; text: string }[] = []
  for (const line of text.split('\n')) {
    const head = /^\s*\[(.+)\]\s*$/.exec(line)
    if (head) {
      section = head[1]!.toLowerCase()
      continue
    }
    if (section !== 'events') continue
    const m = /^\s*(Format|Dialogue)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    if (m[1]!.toLowerCase() === 'format') {
      format = m[2]!.split(',').map((f) => f.trim().toLowerCase())
      continue
    }
    if (!format.length) continue
    // Text is the last field and may hold commas.
    const parts = m[2]!.split(',')
    const fields = [...parts.slice(0, format.length - 1), parts.slice(format.length - 1).join(',')]
    const get = (name: string) => fields[format.indexOf(name)]?.trim() ?? ''
    const t = (s: string) => {
      const x = ASS_TIME.exec(s)
      return x ? seconds(x[1], x[2]!, x[3]!, x[4]!) : NaN
    }
    const start = t(get('start'))
    const end = t(get('end'))
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    events.push({ style: get('style'), start, end, text: fields[format.indexOf('text')] ?? '' })
  }
  const hasDialogue = events.some((e) => !SIGN_STYLE.test(e.style))
  const out: Raw[] = []
  for (const e of events) {
    if (hasDialogue && SIGN_STYLE.test(e.style)) continue
    // Drawings ({\p1}…{\p0}) are vector shapes, not words.
    const noDrawings = e.text.replace(/\{[^}]*\\p[1-9][^}]*\}.*?(\{[^}]*\\p0[^}]*\}|$)/g, '')
    const text = noDrawings.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ')
    out.push({ start: e.start, end: e.end, ...cleanTags(text) })
  }
  return out
}

// Drops empty cues, fixes an end at or before the start, merges exact duplicates, sorts by start.
function clean(raw: Raw[]): ParsedCue[] {
  const seen = new Set<string>()
  const out: ParsedCue[] = []
  for (const r of raw) {
    const lines = r.text.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    const end = r.end > r.start ? r.end : r.start + 2
    const id = `${r.start}|${end}|${lines.join('\n')}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ start: r.start, end, lines, italic: r.italic, top: r.top })
  }
  return out.sort((a, b) => a.start - b.start)
}

// Text → cues, by content rather than file extension.
export function parseSubtitle(text: string): ParsedCue[] {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const head = t.trimStart()
  if (/^WEBVTT/.test(head)) return clean(parseVtt(t))
  if (/^\[Script Info\]/i.test(head)) return clean(parseAss(t))
  return clean(parseSrt(t))
}

export async function readSubtitleFile(path: string, lang: string | null): Promise<ParsedCue[]> {
  return parseSubtitle(decodeSubtitle(await readFile(path), lang))
}
