import { createRequire } from 'node:module'

const LOCALE_SSHORTTIME = 0x79
const BUFFER_CHARS = 80

// A Windows short-time pattern: "h:mm tt" is a 12-hour clock, "HH:mm" a 24-hour one.
export function hour12FromPattern(pattern: string | null): boolean | null {
  if (pattern?.includes('H')) return false
  if (pattern?.includes('h')) return true
  return null
}

// The clock the user set in Windows. Chromium's locale can't see a custom time format,
// so this asks Windows directly; null when it can't be read.
export function systemHour12(): boolean | null {
  try {
    const koffi = createRequire(__filename)('koffi') as {
      load(name: string): { func(signature: string): (...args: unknown[]) => number }
    }
    const getLocaleInfo = koffi.load('kernel32.dll').func('int __stdcall GetLocaleInfoEx(str16 name, uint type, void *buf, int size)')
    const buf = Buffer.alloc(BUFFER_CHARS * 2)
    const chars = getLocaleInfo(null, LOCALE_SSHORTTIME, buf, BUFFER_CHARS)
    return chars > 0 ? hour12FromPattern(buf.toString('utf16le', 0, (chars - 1) * 2)) : null
  } catch {
    return null
  }
}
