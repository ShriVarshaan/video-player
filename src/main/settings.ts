import type { API, Json } from '@shared/api'
import { throwAppError } from '@shared/appError'
import type { Db } from './db'

export function createSettings(db: Db): API['settings'] {
  const select = db.prepare('SELECT value FROM settings WHERE key = ?')
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  const checkKey = (key: string) => {
    if (typeof key !== 'string' || key === '') {
      throwAppError({ code: 'invalid_argument', message: 'Setting key must be a non-empty string.' })
    }
    // tmdb.* holds the encrypted TMDB credential; only the metadata service touches it.
    if (key.startsWith('tmdb.')) {
      throwAppError({ code: 'invalid_argument', message: `Setting ${key} is not available here.` })
    }
  }

  return {
    get: async ({ key }) => {
      checkKey(key)
      const row = select.get(key) as { value: string } | undefined
      return row ? (JSON.parse(row.value) as Json) : null
    },
    set: async ({ key, value }) => {
      checkKey(key)
      upsert.run(key, JSON.stringify(value))
    }
  }
}
