import { throwAppError, type AppErrorCode } from '@shared/appError'
import type { Db } from '../db'

export type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

// A secret (API key, login), encrypted with Windows DPAPI (Electron safeStorage)
// and kept in settings as base64. Never stored in plain text, never sent to the renderer.
export function createSecretStore(db: Db, safe: SafeStorageLike, key: string, unavailable: AppErrorCode) {
  const select = db.prepare('SELECT value FROM settings WHERE key = ?')
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  return {
    get(): string | null {
      const row = select.get(key) as { value: string } | undefined
      if (!row) return null
      return safe.decryptString(Buffer.from(JSON.parse(row.value) as string, 'base64'))
    },
    set(secret: string): void {
      if (!safe.isEncryptionAvailable()) throwAppError(unavailable)
      upsert.run(key, JSON.stringify(safe.encryptString(secret).toString('base64')))
    },
    has(): boolean {
      return select.get(key) !== undefined
    }
  }
}

export type SecretStore = ReturnType<typeof createSecretStore>

// The TMDB key.
export const createCredentialStore = (db: Db, safe: SafeStorageLike): SecretStore =>
  createSecretStore(db, safe, 'tmdb.credential', 'tmdb_storage_unavailable')

export type CredentialStore = SecretStore
