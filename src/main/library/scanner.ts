import { existsSync, statSync, type Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { normalizeTitle } from '@shared/normalize'
import { tx, type Db } from '../db'
import type { ProbeResult } from '../media/probe'
import { isVideoFile, parseVideoPath, type ParsedVideo } from './parseName'

export type ScanDeps = {
  probe: (file: string) => Promise<ProbeResult>
  quickHash: (file: string, size: number) => Promise<string>
  now: () => number
  limit: <T>(fn: () => Promise<T>) => Promise<T>
  onProgress?: (done: number, total: number) => void
  // Called after each committed batch, so the screen can show rows as they land.
  onFlush?: () => void
  // Lists one directory; defaults to fs.promises.readdir.
  readDir?: (dir: string) => Promise<Dirent[]>
}

export type ScanResult = {
  added: number
  updated: number
  renamed: number
  missing: number
  unchanged: number
  offline: boolean
  failed: { path: string; error: string }[]
}

type Row = {
  id: number
  folder_id: number
  path: string
  size_bytes: number
  mtime_ms: number
  quick_hash: string | null
  missing_since: number | null
  kind: string
  parsed_title: string
  parsed_year: number | null
  season: number | null
  episode: number | null
  episode_end: number | null
}

type Found = { path: string; parsed: ParsedVideo }

const SKIPPED_DIRS = new Set(['$recycle.bin', 'system volume information'])
const BATCH = 50

// FNV-1a, 32-bit. Gives the wall a stable order that survives renames.
export function wallKey(quickHash: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < quickHash.length; i++) {
    h ^= quickHash.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function parsedColumns(p: ParsedVideo) {
  return p.kind === 'movie'
    ? { kind: 'movie', parsed_title: p.title, parsed_year: p.year, parsed_show: null, season: null, episode: null, episode_end: null }
    : {
        kind: 'episode',
        parsed_title: p.show,
        parsed_year: p.year,
        parsed_show: normalizeTitle(p.show),
        season: p.season,
        episode: p.episode,
        episode_end: p.episodeEnd
      }
}

function probeColumns(p: ProbeResult | null) {
  return {
    duration_s: p?.durationS ?? null,
    container: p?.container ?? null,
    video_codec: p?.videoCodec ?? null,
    width: p?.width ?? null,
    height: p?.height ?? null,
    hdr: p?.hdr ? 1 : 0,
    probe_json: p?.json ?? null
  }
}

function sameParse(row: Row, cols: ReturnType<typeof parsedColumns>): boolean {
  return (
    row.kind === cols.kind &&
    row.parsed_title === cols.parsed_title &&
    row.parsed_year === cols.parsed_year &&
    row.season === cols.season &&
    row.episode === cols.episode &&
    row.episode_end === cols.episode_end
  )
}

// Walks the tree one directory at a time, so an unreadable subfolder (another
// user's recycle bin, a locked folder) is skipped instead of failing the scan.
// Only a failure to read the library folder itself is thrown.
async function findVideos(root: string, readDir: (dir: string) => Promise<Dirent[]>): Promise<Found[]> {
  const found: Found[] = []
  const rootName = basename(root)
  const pending = [root]
  while (pending.length) {
    const dir = pending.pop()!
    let entries: Dirent[]
    try {
      entries = await readDir(dir)
    } catch (e) {
      if (dir === root) throw e
      console.warn(`Skipping unreadable folder ${dir}:`, e instanceof Error ? e.message : e)
      continue
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIPPED_DIRS.has(e.name.toLowerCase())) pending.push(full)
      } else if (e.isFile() && isVideoFile(e.name)) {
        const parsed = parseVideoPath(relative(root, full), rootName)
        if (parsed) found.push({ path: full, parsed })
      }
    }
  }
  return found
}

export async function scanFolder(db: Db, folder: { id: number; path: string }, deps: ScanDeps): Promise<ScanResult> {
  const result: ScanResult = { added: 0, updated: 0, renamed: 0, missing: 0, unchanged: 0, offline: false, failed: [] }
  const now = deps.now()
  const readDir = deps.readDir ?? ((dir: string) => readdir(dir, { withFileTypes: true }))

  // Unplugged drive: keep every row so progress and offsets come back with it.
  const offline = () => {
    const r = db
      .prepare('UPDATE videos SET missing_since = ? WHERE folder_id = ? AND missing_since IS NULL')
      .run(now, folder.id)
    result.missing = Number(r.changes)
    result.offline = true
    return result
  }
  if (!existsSync(folder.path) || !statSync(folder.path).isDirectory()) return offline()

  let found: Found[]
  try {
    found = await findVideos(folder.path, readDir)
  } catch {
    return offline() // the drive went away while we were listing it
  }

  const foundPaths = new Set(found.map((f) => f.path))
  const rows = db.prepare('SELECT * FROM videos WHERE folder_id = ?').all(folder.id) as Row[]
  const byPath = new Map(rows.map((r) => [r.path, r]))
  const claimed = new Set<number>()

  const sql = {
    byHash: db.prepare(
      `SELECT v.*, f.path AS folder_path FROM videos v JOIN library_folders f ON f.id = v.folder_id WHERE v.quick_hash = ?`
    ),
    clearMissing: db.prepare('UPDATE videos SET missing_since = NULL WHERE id = ?'),
    setMissing: db.prepare('UPDATE videos SET missing_since = ? WHERE id = ?'),
    update: db.prepare(
      `UPDATE videos SET size_bytes = ?, mtime_ms = ?, quick_hash = ?, wall_key = ?, kind = ?, parsed_title = ?,
         parsed_year = ?, parsed_show = ?, season = ?, episode = ?, episode_end = ?, duration_s = ?, container = ?,
         video_codec = ?, width = ?, height = ?, hdr = ?, probe_json = ?, missing_since = NULL,
         match_status = CASE WHEN ? THEN match_status ELSE 'pending' END
       WHERE id = ?`
    ),
    move: db.prepare(
      `UPDATE videos SET path = ?, folder_id = ?, size_bytes = ?, mtime_ms = ?, kind = ?, parsed_title = ?,
         parsed_year = ?, parsed_show = ?, season = ?, episode = ?, episode_end = ?, missing_since = NULL,
         match_status = CASE WHEN ? THEN match_status ELSE 'pending' END
       WHERE id = ?`
    ),
    insert: db.prepare(
      `INSERT INTO videos (folder_id, path, size_bytes, mtime_ms, quick_hash, wall_key, kind, parsed_title,
         parsed_year, parsed_show, season, episode, episode_end, duration_s, container, video_codec, width,
         height, hdr, probe_json, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
  }

  // Writes are queued as each file finishes and committed 50 at a time, so the
  // library fills in during a long first scan and an interrupted scan keeps its work.
  let writes: (() => void)[] = []
  const flush = () => {
    if (writes.length === 0) return
    const batch = writes
    writes = []
    tx(db, () => batch.forEach((w) => w()))
    deps.onFlush?.()
  }
  const write = (w: () => void) => {
    writes.push(w)
    if (writes.length >= BATCH) flush()
  }

  let done = 0
  const tick = () => deps.onProgress?.(++done, found.length)

  const tryProbe = async (path: string): Promise<ProbeResult | null> => {
    try {
      return await deps.limit(() => deps.probe(path))
    } catch (e) {
      result.failed.push({ path, error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  // A row this file may have been renamed from: same content, its old file gone,
  // and its folder online (a copy on an unplugged drive is not a rename).
  // Rows from this folder win over rows from others.
  const renamedFrom = (hash: string): Row | undefined =>
    (sql.byHash.all(hash) as (Row & { folder_path: string })[])
      .filter(
        (r) =>
          !foundPaths.has(r.path) &&
          !claimed.has(r.id) &&
          !existsSync(r.path) &&
          (r.folder_id === folder.id || existsSync(r.folder_path))
      )
      .sort((a, b) => Number(b.folder_id === folder.id) - Number(a.folder_id === folder.id))[0]

  // A file can vanish or be locked between listing and reading it; record it
  // and carry on with the rest.
  const scanOne = async ({ path, parsed }: Found) => {
    const s = await stat(path)
    const size = s.size
    const mtime = Math.floor(s.mtimeMs)
    const cols = parsedColumns(parsed)
    const existing = byPath.get(path)

    if (existing && existing.size_bytes === size && existing.mtime_ms === mtime) {
      result.unchanged++
      if (existing.missing_since !== null) write(() => sql.clearMissing.run(existing.id))
      return
    }

    const hash = await deps.limit(() => deps.quickHash(path, size))

    if (existing) {
      const p = probeColumns(await tryProbe(path))
      result.updated++
      write(() =>
        sql.update.run(size, mtime, hash, wallKey(hash), cols.kind, cols.parsed_title, cols.parsed_year, cols.parsed_show,
          cols.season, cols.episode, cols.episode_end, p.duration_s, p.container, p.video_codec, p.width, p.height,
          p.hdr, p.probe_json, sameParse(existing, cols) ? 1 : 0, existing.id)
      )
      return
    }

    const moved = renamedFrom(hash)
    if (moved) {
      claimed.add(moved.id)
      result.renamed++
      write(() =>
        sql.move.run(path, folder.id, size, mtime, cols.kind, cols.parsed_title, cols.parsed_year, cols.parsed_show,
          cols.season, cols.episode, cols.episode_end, sameParse(moved, cols) ? 1 : 0, moved.id)
      )
      return
    }

    const p = probeColumns(await tryProbe(path))
    result.added++
    write(() =>
      sql.insert.run(folder.id, path, size, mtime, hash, wallKey(hash), cols.kind, cols.parsed_title, cols.parsed_year,
        cols.parsed_show, cols.season, cols.episode, cols.episode_end, p.duration_s, p.container, p.video_codec,
        p.width, p.height, p.hdr, p.probe_json, now)
    )
  }

  await Promise.all(
    found.map(async (f) => {
      try {
        await scanOne(f)
      } catch (e) {
        result.failed.push({ path: f.path, error: e instanceof Error ? e.message : String(e) })
      } finally {
        tick()
      }
    })
  )

  for (const r of rows) {
    if (!foundPaths.has(r.path) && !claimed.has(r.id) && r.missing_since === null) {
      result.missing++
      write(() => sql.setMissing.run(now, r.id))
    }
  }
  flush()
  return result
}
