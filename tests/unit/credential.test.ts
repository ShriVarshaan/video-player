import { describe, expect, it } from 'vitest'
import { parseAppError } from '@shared/appError'
import { openDb } from '../../src/main/db'
import { createCredentialStore, type SafeStorageLike } from '../../src/main/metadata/credential'

const reversing = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...s].reverse().join('')),
  decryptString: (b) => [...b.toString()].reverse().join('')
})

describe('credential store', () => {
  it('stores the key encrypted and reads it back', () => {
    const db = openDb(':memory:')
    const store = createCredentialStore(db, reversing())
    expect(store.has()).toBe(false)
    expect(store.get()).toBeNull()
    store.set('secret-key-1')
    expect(store.has()).toBe(true)
    expect(store.get()).toBe('secret-key-1')
    const raw = (db.prepare(`SELECT value FROM settings WHERE key = 'tmdb.credential'`).get() as { value: string }).value
    expect(raw).not.toContain('secret-key-1')
  })

  it('refuses to store when Windows cannot encrypt', () => {
    const store = createCredentialStore(openDb(':memory:'), reversing(false))
    let error: unknown
    try {
      store.set('k')
    } catch (e) {
      error = e
    }
    expect(parseAppError(error)?.code).toBe('tmdb_storage_unavailable')
    expect(store.has()).toBe(false)
  })
})
