import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import iconv from 'iconv-lite'
import jschardet from 'jschardet'

// The legacy Windows code page most subtitle files in a language were saved in.
const CODEPAGE: Record<string, string> = {
  ara: 'windows-1256', per: 'windows-1256', urd: 'windows-1256',
  rus: 'windows-1251', ukr: 'windows-1251', bul: 'windows-1251', srp: 'windows-1251',
  gre: 'windows-1253', tur: 'windows-1254', heb: 'windows-1255', vie: 'windows-1258', tha: 'windows-874',
  pol: 'windows-1250', cze: 'windows-1250', slo: 'windows-1250', hun: 'windows-1250', hrv: 'windows-1250',
  slv: 'windows-1250', rum: 'windows-1250',
  chi: 'gb18030', jpn: 'shift_jis', kor: 'euc-kr'
}

const isUtf8 = (buf: Buffer) => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch {
    return false
  }
}

function encodingOf(buf: Buffer, lang: string | null): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le'
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be'
  const hinted = lang ? CODEPAGE[lang] : undefined
  if (hinted) return hinted
  // Short Latin text fools detectors; only trust a confident guess.
  const guess = jschardet.detect(buf)
  if (guess.encoding && guess.confidence >= 0.9 && guess.encoding !== 'ascii' && iconv.encodingExists(guess.encoding)) {
    return guess.encoding
  }
  return 'windows-1252'
}

// A subtitle file's bytes as text: BOM, then valid UTF-8, then the language's code
// page, then a confident guess, then windows-1252. Any BOM is dropped.
export function decodeSubtitle(buf: Buffer, lang: string | null): string {
  const bom = buf[0] === 0xff || buf[0] === 0xfe
  const text = !bom && isUtf8(buf) ? buf.toString('utf8') : iconv.decode(buf, encodingOf(buf, lang))
  return text.replace(/^﻿/, '')
}

// mpv's own detection garbles legacy code pages (see mpv-ipc), so it gets a
// UTF-8 copy in cacheDir. The user's file is never changed.
export async function ensureUtf8(path: string, cacheDir: string, lang: string | null): Promise<string> {
  const buf = await readFile(path)
  const bom = buf[0] === 0xff || buf[0] === 0xfe
  if (!bom && isUtf8(buf)) return path
  const s = await stat(path)
  const id = createHash('sha1').update(`${path}|${s.size}|${s.mtimeMs}|${lang ?? ''}`).digest('hex').slice(0, 16)
  const out = join(cacheDir, `${id}${extname(path)}`)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(out, iconv.decode(buf, encodingOf(buf, lang)), 'utf8')
  return out
}
