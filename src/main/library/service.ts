import { statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import type { ApiEvents } from '@shared/api'
import { throwAppError } from '@shared/appError'
import type { LibraryFolder, MetadataStatus, ScanProgress } from '@shared/library'
import type { Db } from '../db'
import type { ImageCache } from '../images/cache'
import { parsePosterUrl, type PosterRef } from '../images/posterUrl'
import type { CredentialStore } from '../metadata/credential'
import { matchPending } from '../metadata/match'
import type { TmdbClient } from '../metadata/tmdbClient'
import { listFolders, listLibrary } from './queries'
import { throttle, type Limiter } from './queue'
import { scanFolder, type ScanDeps } from './scanner'
import { watchFolder } from './watcher'

type Emit = <K extends keyof ApiEvents>(event: K, payload: ApiEvents[K]) => void

export type LibraryServiceDeps = {
  db: Db
  scan: Omit<ScanDeps, 'onProgress'>
  tmdbLimit: Limiter
  client: TmdbClient
  // Checks a TMDB key before it is stored (one TMDB request).
  checkKey: (key: string) => Promise<void>
  images: ImageCache
  credential: CredentialStore
  emit: Emit
  exists: (path: string) => boolean
  now: () => number
  watch?: typeof watchFolder
}

const PROGRESS_INTERVAL_MS = 200 // at most 5 progress events a second

export function createLibraryService(deps: LibraryServiceDeps) {
  const { db } = deps
  const watch = deps.watch ?? watchFolder
  const watchers = new Map<number, () => void>()

  // Progress: a new phase goes out at once; updates within a phase are throttled.
  let lastPhase: ScanProgress['phase'] | null = null
  const sendProgress = throttle((p: ScanProgress) => deps.emit('library.progress', p), PROGRESS_INTERVAL_MS)
  const progress = (phase: ScanProgress['phase'], done = 0, total = 0) => {
    if (phase !== lastPhase) {
      sendProgress.cancel()
      lastPhase = phase
      deps.emit('library.progress', { phase, done, total })
    } else {
      sendProgress({ phase, done, total })
    }
  }

  async function runOnce(): Promise<void> {
    try {
      const folders = db.prepare('SELECT id, path FROM library_folders ORDER BY id').all() as { id: number; path: string }[]
      for (const f of folders) {
        progress('scanning')
        try {
          await scanFolder(db, f, { ...deps.scan, onProgress: (d, t) => progress('scanning', d, t) })
          db.prepare('UPDATE library_folders SET last_scan_at = ? WHERE id = ?').run(deps.now(), f.id)
        } catch (e) {
          console.error(`Scanning ${f.path} failed:`, e) // one bad folder must not stop the others
        }
      }

      if (deps.credential.has()) {
        progress('matching')
        await matchPending(db, deps.client, {
          now: deps.now,
          limit: deps.tmdbLimit,
          onProgress: (d, t) => progress('matching', d, t)
        })
      }

      const { movies, shows } = listLibrary(db)
      const refs = [...movies, ...shows].map((i) => parsePosterUrl(i.posterUrl)).filter((r): r is PosterRef => r !== null)
      progress('images', 0, refs.length)
      let done = 0
      // Artwork is best effort: a missing image is drawn as a generated tile.
      await Promise.all(
        refs.map((r) =>
          deps.images
            .resolve(r)
            .catch(() => null)
            .finally(() => progress('images', ++done, refs.length))
        )
      )
    } finally {
      deps.emit('library.changed', {})
      progress('idle')
    }
  }

  // Never two scans at once. Calls made during a scan share one follow-up run.
  let running: Promise<void> | null = null
  let followUp: Promise<void> | null = null
  function rescan(): Promise<void> {
    if (running) {
      followUp ??= running
        .catch(() => {})
        .then(() => {
          followUp = null
          return rescan()
        })
      return followUp
    }
    running = runOnce().finally(() => {
      running = null
    })
    return running
  }

  // For rescans nobody awaits (watcher, new folder, new key).
  const rescanInBackground = () => {
    rescan().catch((e: unknown) => console.error('Library rescan failed:', e))
  }

  function startWatch(folder: { id: number; path: string }) {
    watchers.get(folder.id)?.()
    watchers.set(folder.id, watch(folder.path, rescanInBackground))
  }

  return {
    async addFolderPath(path: string): Promise<LibraryFolder> {
      const full = resolvePath(path)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        // falls through to the error below
      }
      if (!isDir) throwAppError({ code: 'invalid_argument', message: `${full} is not a folder.` })
      if (db.prepare('SELECT 1 FROM library_folders WHERE path = ?').get(full)) {
        throwAppError({ code: 'invalid_argument', message: `${full} is already in the library.` })
      }
      const id = Number(db.prepare('INSERT INTO library_folders (path, added_at) VALUES (?, ?)').run(full, deps.now()).lastInsertRowid)
      startWatch({ id, path: full })
      rescanInBackground()
      return listFolders(db, deps.exists).find((f) => f.id === id)!
    },

    removeFolder(id: number): void {
      watchers.get(id)?.()
      watchers.delete(id)
      db.prepare('DELETE FROM library_folders WHERE id = ?').run(id)
      deps.emit('library.changed', {})
    },

    rescan,

    startWatching(): void {
      for (const f of db.prepare('SELECT id, path FROM library_folders').all() as { id: number; path: string }[]) startWatch(f)
    },

    stopWatching(): void {
      for (const stop of watchers.values()) stop()
      watchers.clear()
    },

    metadataStatus(): MetadataStatus {
      const count = (status: string) =>
        Number(
          (db.prepare('SELECT count(*) AS n FROM videos WHERE match_status = ? AND missing_since IS NULL').get(status) as { n: number }).n
        )
      return { hasKey: deps.credential.has(), pending: count('pending'), unmatched: count('unmatched') }
    },

    async setTmdbKey(key: string): Promise<void> {
      const trimmed = typeof key === 'string' ? key.trim() : ''
      if (!trimmed) throwAppError({ code: 'invalid_argument', message: 'Enter a TMDB API key or read access token.' })
      await deps.checkKey(trimmed)
      deps.credential.set(trimmed)
      rescanInBackground()
    }
  }
}

export type LibraryService = ReturnType<typeof createLibraryService>
