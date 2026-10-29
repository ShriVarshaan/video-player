import { existsSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
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

async function findVideos(root: string): Promise<{ path: string; parsed: ParsedVideo }[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const found: { path: string; parsed: ParsedVideo }[] = []
  for (const e of entries) {
    if (!e.isFile() || !isVideoFile(e.name)) continue
    const full = join(e.parentPath, e.name)
    const rel = relative(root, full)
    const dirs = rel.split(sep).slice(0, -1)
    if (dirs.some((d) => d.startsWith('.') || SKIPPED_DIRS.has(d.toLowerCase()))) continue
    const parsed = parseVideoPath(rel)
    if (parsed) found.push({ path: full, parsed })
  }
  return found
}

export async function scanFolder(db: Db, folder: { id: number; path: string }, deps: ScanDeps): Promise<ScanResult> {
  const result: ScanResult = { added: 0, updated: 0, renamed: 0, missing: 0, unchanged: 0, offline: false, failed: [] }
  const now = deps.now()

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

  let found: { path: string; parsed: ParsedVideo }[]
  try {
    found = await findVideos(folder.path)
  } catch {
    return offline() // the drive went away while we were listing it
  }
  const foundPaths = new Set(found.map((f) => f.path))
  const rows = db.prepare('SELECT * FROM videos WHERE folder_id = ?').all(folder.id) as Row[]
  const byPath = new Map(rows.map((r) => [r.path, r]))
  const byHash = db.prepare('SELECT * FROM videos WHERE quick_hash = ?')
  const claimed = new Set<number>()

  // Do the slow, async work first, then write in batches.
  const writes: (() => void)[] = []
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

  // A file can vanish or be locked between listing and reading it; record it
  // and carry on with the rest.
  const safely = (fn: (f: { path: string; parsed: ParsedVideo }) => Promise<void>) => async (f: { path: string; parsed: ParsedVideo }) => {
    try {
      await fn(f)
    } catch (e) {
      result.failed.push({ path: f.path, error: e instanceof Error ? e.message : String(e) })
      tick()
    }
  }

  await Promise.all(
    found.map(safely(async ({ path, parsed }) => {
      const s = await stat(path)
      const size = s.size
      const mtime = Math.floor(s.mtimeMs)
      const cols = parsedColumns(parsed)
      const existing = byPath.get(path)

      if (existing && existing.size_bytes === size && existing.mtime_ms === mtime) {
        result.unchanged++
        if (existing.missing_since !== null) {
          writes.push(() => db.prepare('UPDATE videos SET missing_since = NULL WHERE id = ?').run(existing.id))
        }
        return tick()
      }

      const hash = await deps.limit(() => deps.quickHash(path, size))

      if (existing) {
        const probed = await tryProbe(path)
        const p = probeColumns(probed)
        result.updated++
        writes.push(() =>
          db
            .prepare(
              `UPDATE videos SET size_bytes = ?, mtime_ms = ?, quick_hash = ?, wall_key = ?, kind = ?, parsed_title = ?,
                 parsed_year = ?, parsed_show = ?, season = ?, episode = ?, episode_end = ?, duration_s = ?, container = ?,
                 video_codec = ?, width = ?, height = ?, hdr = ?, probe_json = ?, missing_since = NULL,
                 match_status = CASE WHEN ? THEN match_status ELSE 'pending' END
               WHERE id = ?`
            )
            .run(size, mtime, hash, wallKey(hash), cols.kind, cols.parsed_title, cols.parsed_year, cols.parsed_show,
              cols.season, cols.episode, cols.episode_end, p.duration_s, p.container, p.video_codec, p.width, p.height,
              p.hdr, p.probe_json, sameParse(existing, cols) ? 1 : 0, existing.id)
        )
        return tick()
      }

      // A new path with the content of a row whose file is gone: a rename.
      const moved = (byHash.all(hash) as Row[]).find((r) => !foundPaths.has(r.path) && !claimed.has(r.id))
      if (moved) {
        claimed.add(moved.id)
        result.renamed++
        writes.push(() =>
          db
            .prepare(
              `UPDATE videos SET path = ?, folder_id = ?, size_bytes = ?, mtime_ms = ?, kind = ?, parsed_title = ?,
                 parsed_year = ?, parsed_show = ?, season = ?, episode = ?, episode_end = ?, missing_since = NULL,
                 match_status = CASE WHEN ? THEN match_status ELSE 'pending' END
               WHERE id = ?`
            )
            .run(path, folder.id, size, mtime, cols.kind, cols.parsed_title, cols.parsed_year, cols.parsed_show,
              cols.season, cols.episode, cols.episode_end, sameParse(moved, cols) ? 1 : 0, moved.id)
        )
        return tick()
      }

      const probed = await tryProbe(path)
      const p = probeColumns(probed)
      result.added++
      writes.push(() =>
        db
          .prepare(
            `INSERT INTO videos (folder_id, path, size_bytes, mtime_ms, quick_hash, wall_key, kind, parsed_title,
               parsed_year, parsed_show, season, episode, episode_end, duration_s, container, video_codec, width,
               height, hdr, probe_json, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(folder.id, path, size, mtime, hash, wallKey(hash), cols.kind, cols.parsed_title, cols.parsed_year,
            cols.parsed_show, cols.season, cols.episode, cols.episode_end, p.duration_s, p.container, p.video_codec,
            p.width, p.height, p.hdr, p.probe_json, now)
      )
      tick()
    }))
  )

  for (const r of rows) {
    if (!foundPaths.has(r.path) && !claimed.has(r.id) && r.missing_since === null) {
      result.missing++
      writes.push(() => db.prepare('UPDATE videos SET missing_since = ? WHERE id = ?').run(now, r.id))
    }
  }

  for (let i = 0; i < writes.length; i += BATCH) {
    tx(db, () => writes.slice(i, i + BATCH).forEach((w) => w()))
  }
  return result
}
