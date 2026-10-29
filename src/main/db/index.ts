import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { throwAppError } from '@shared/appError'
import { migrations } from './migrations'

export type Db = DatabaseSync

export function schemaVersion(db: Db): number {
  return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function openDb(file: string, list: readonly string[] = migrations): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    // Check the version before anything writes to the file.
    const version = schemaVersion(db)
    if (version > list.length) {
      throwAppError({ code: 'db_too_new', payload: { version, supported: list.length } })
    }
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')

    for (let v = version; v < list.length; v++) {
      try {
        tx(db, () => {
          db.exec(list[v]!)
          db.exec(`PRAGMA user_version = ${v + 1}`)
        })
      } catch (e) {
        throwAppError({
          code: 'db_migration_failed',
          payload: { toVersion: v + 1, cause: e instanceof Error ? e.message : String(e) }
        })
      }
    }
    return db
  } catch (e) {
    db.close()
    throw e
  }
}
