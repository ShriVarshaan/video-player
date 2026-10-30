import { describe, expect, it } from 'vitest'
import { parseAppError } from '@shared/appError'
import { openDb } from '../../src/main/db'
import { createCredentialStore, createSecretStore, type SafeStorageLike } from '../../src/main/metadata/credential'

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

describe('secret store', () => {
  it('keeps any named secret encrypted, apart from the TMDB key', () => {
    const db = openDb(':memory:')
    const os = createSecretStore(db, reversing(), 'opensubtitles.account', 'opensubtitles_storage_unavailable')
    os.set('{"apiKey":"abc"}')
    expect(os.get()).toBe('{"apiKey":"abc"}')
    expect(createCredentialStore(db, reversing()).has()).toBe(false)
    const raw = (db.prepare(`SELECT value FROM settings WHERE key = 'opensubtitles.account'`).get() as { value: string }).value
    expect(raw).not.toContain('abc')
  })

  it('refuses with its own error when Windows cannot encrypt', () => {
    const os = createSecretStore(openDb(':memory:'), reversing(false), 'opensubtitles.account', 'opensubtitles_storage_unavailable')
    let error: unknown
    try {
      os.set('x')
    } catch (e) {
      error = e
    }
    expect(parseAppError(error)?.code).toBe('opensubtitles_storage_unavailable')
  })
})
