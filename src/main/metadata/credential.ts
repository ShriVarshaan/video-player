import { throwAppError } from '@shared/appError'
import type { Db } from '../db'

export type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

const KEY = 'tmdb.credential'

// The TMDB key, encrypted with Windows DPAPI (Electron safeStorage) and kept in
// settings as base64. Never stored in plain text, never sent to the renderer.
export function createCredentialStore(db: Db, safe: SafeStorageLike) {
  const select = db.prepare('SELECT value FROM settings WHERE key = ?')
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  return {
    get(): string | null {
      const row = select.get(KEY) as { value: string } | undefined
      if (!row) return null
      return safe.decryptString(Buffer.from(JSON.parse(row.value) as string, 'base64'))
    },
    set(key: string): void {
      if (!safe.isEncryptionAvailable()) throwAppError('tmdb_storage_unavailable')
      upsert.run(KEY, JSON.stringify(safe.encryptString(key).toString('base64')))
    },
    has(): boolean {
      return select.get(KEY) !== undefined
    }
  }
}

export type CredentialStore = ReturnType<typeof createCredentialStore>
