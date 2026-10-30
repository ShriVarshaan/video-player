// Language codes as each party spells them: mpv and Matroska use ISO 639-2/B
// ('fre'), OpenSubtitles ISO 639-1 with a few regional forms ('pt-br'), file
// names anything from 'fr' to 'French'.

export type Lang = { code2: string; code1: string; name: string }

// [639-2/B, OpenSubtitles code, English name, 639-2/T when it differs]
const TABLE: [string, string, string, string?][] = [
  ['ara', 'ar', 'Arabic'],
  ['baq', 'eu', 'Basque', 'eus'],
  ['bul', 'bg', 'Bulgarian'],
  ['cat', 'ca', 'Catalan'],
  ['chi', 'zh-cn', 'Chinese', 'zho'],
  ['hrv', 'hr', 'Croatian'],
  ['cze', 'cs', 'Czech', 'ces'],
  ['dan', 'da', 'Danish'],
  ['dut', 'nl', 'Dutch', 'nld'],
  ['eng', 'en', 'English'],
  ['est', 'et', 'Estonian'],
  ['per', 'fa', 'Persian', 'fas'],
  ['fil', 'tl', 'Filipino'],
  ['fin', 'fi', 'Finnish'],
  ['fre', 'fr', 'French', 'fra'],
  ['ger', 'de', 'German', 'deu'],
  ['gre', 'el', 'Greek', 'ell'],
  ['heb', 'he', 'Hebrew'],
  ['hin', 'hi', 'Hindi'],
  ['hun', 'hu', 'Hungarian'],
  ['ice', 'is', 'Icelandic', 'isl'],
  ['ind', 'id', 'Indonesian'],
  ['ita', 'it', 'Italian'],
  ['jpn', 'ja', 'Japanese'],
  ['kor', 'ko', 'Korean'],
  ['lav', 'lv', 'Latvian'],
  ['lit', 'lt', 'Lithuanian'],
  ['may', 'ms', 'Malay', 'msa'],
  ['mal', 'ml', 'Malayalam'],
  ['nor', 'no', 'Norwegian'],
  ['pol', 'pl', 'Polish'],
  ['por', 'pt-pt', 'Portuguese'],
  ['rum', 'ro', 'Romanian', 'ron'],
  ['rus', 'ru', 'Russian'],
  ['srp', 'sr', 'Serbian'],
  ['slo', 'sk', 'Slovak', 'slk'],
  ['slv', 'sl', 'Slovenian'],
  ['spa', 'es', 'Spanish'],
  ['swe', 'sv', 'Swedish'],
  ['tam', 'ta', 'Tamil'],
  ['tel', 'te', 'Telugu'],
  ['tha', 'th', 'Thai'],
  ['tur', 'tr', 'Turkish'],
  ['ukr', 'uk', 'Ukrainian'],
  ['urd', 'ur', 'Urdu'],
  ['vie', 'vi', 'Vietnamese']
]

export const LANGUAGES: readonly Lang[] = TABLE.map(([code2, code1, name]) => ({ code2, code1, name })).sort((a, b) =>
  a.name.localeCompare(b.name)
)

const lookup = new Map<string, string>()
for (const [code2, code1, name, t] of TABLE) {
  for (const k of [code2, code1, code1.split('-')[0]!, name, t]) if (k) lookup.set(k.toLowerCase(), code2)
}
// Common extras seen in file names.
for (const [k, v] of Object.entries({ pb: 'por', pob: 'por', 'pt-br': 'por', 'zh-tw': 'chi', 'zh-hans': 'chi', 'zh-hant': 'chi', chs: 'chi', cht: 'chi', nob: 'nor', nno: 'nor', nb: 'nor', iw: 'heb', in: 'ind', tgl: 'fil', farsi: 'per', brazilian: 'por', castilian: 'spa', espanol: 'spa', francais: 'fre', deutsch: 'ger' })) {
  lookup.set(k, v)
}

// Any spelling → the 639-2/B code, or null when it isn't a language we know.
export function normalizeLang(code: string | null | undefined): string | null {
  if (!code) return null
  const k = code.trim().toLowerCase().replace(/_/g, '-')
  return lookup.get(k) ?? lookup.get(k.split('-')[0]!) ?? null
}

export function toOpenSubtitles(code2: string): string {
  return TABLE.find((r) => r[0] === code2)?.[1] ?? code2
}

const names = new Intl.DisplayNames(['en'], { type: 'language' })

export function languageName(code: string): string {
  const known = TABLE.find((r) => r[0] === code)
  if (known) return known[2]
  try {
    const name = names.of(code)
    if (name && name.toLowerCase() !== code.toLowerCase()) return name
  } catch {
    // Not a language code Intl knows.
  }
  return code.toUpperCase()
}
