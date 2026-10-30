import type { SubtitleSettings } from '@shared/api'
import { normalizeLang } from '@shared/lang'
import { effectiveStyle, sanitizePatch, sanitizeStyle, type SubtitleStyle } from '@shared/subtitleStyle'
import type { Db } from '../db'

export type { SubtitleSettings }

const STYLE = 'subtitle.style'
const LANGUAGE = 'subtitle.language'
const PREFER_SDH = 'subtitle.preferSdh'

// The global subtitle style and settings (settings rows) and each title's own
// changes (title_prefs.style_json, only the fields changed for that title).
export function createStyleStore(db: Db, opts: { now: () => number; defaultLanguage: string }) {
  const read = (key: string): unknown => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : undefined
  }
  const write = (key: string, value: unknown) =>
    db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))

  const global = (): SubtitleStyle => sanitizeStyle(read(STYLE))
  const setGlobal = (s: SubtitleStyle) => write(STYLE, sanitizeStyle(s))

  function overrides(key: string): Partial<SubtitleStyle> {
    const row = db.prepare('SELECT style_json FROM title_prefs WHERE title_key = ?').get(key) as { style_json: string | null } | undefined
    return row?.style_json ? sanitizePatch(JSON.parse(row.style_json)) : {}
  }

  function writeOverrides(key: string, patch: Partial<SubtitleStyle>) {
    const json = Object.keys(patch).length ? JSON.stringify(patch) : null
    db.prepare(
      `INSERT INTO title_prefs (title_key, style_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(title_key) DO UPDATE SET style_json = excluded.style_json, updated_at = excluded.updated_at`
    ).run(key, json, opts.now())
  }

  return {
    global,
    setGlobal,
    overrides,
    setOverrides: (key: string, patch: Partial<SubtitleStyle>) => writeOverrides(key, { ...overrides(key), ...sanitizePatch(patch) }),
    effective: (key: string) => effectiveStyle(global(), overrides(key)),
    useForAll(key: string) {
      setGlobal(effectiveStyle(global(), overrides(key)))
      writeOverrides(key, {})
    },
    reset: (key: string) => writeOverrides(key, {}),
    subtitleSettings: (): SubtitleSettings => ({
      language: normalizeLang(read(LANGUAGE) as string | undefined) ?? opts.defaultLanguage,
      preferSdh: read(PREFER_SDH) === true
    }),
    setSubtitleSettings(s: Partial<SubtitleSettings>) {
      const language = normalizeLang(s.language)
      if (language) write(LANGUAGE, language)
      if (typeof s.preferSdh === 'boolean') write(PREFER_SDH, s.preferSdh)
    }
  }
}

export type StyleStore = ReturnType<typeof createStyleStore>
