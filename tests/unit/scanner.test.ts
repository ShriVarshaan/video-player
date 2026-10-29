import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { createLimiter } from '../../src/main/library/queue'
import { scanFolder, wallKey, type ScanDeps } from '../../src/main/library/scanner'
import type { ProbeResult } from '../../src/main/media/probe'

const PROBE: ProbeResult = {
  durationS: 100,
  container: 'matroska,webm',
  videoCodec: 'h264',
  width: 640,
  height: 360,
  hdr: false,
  json: '{}'
}

let root: string
let lib: string
let db: Db
let clock: number

function put(rel: string, content: string) {
  const file = join(lib, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function deps(over: Partial<ScanDeps> = {}): ScanDeps & { probe: ReturnType<typeof vi.fn> } {
  return {
    probe: vi.fn(async () => PROBE),
    quickHash: async (file: string) => createHash('sha1').update(readFileSync(file)).digest('hex'),
    now: () => clock,
    limit: (fn) => fn(),
    ...over
  } as ScanDeps & { probe: ReturnType<typeof vi.fn> }
}

const folder = () => ({ id: 1, path: lib })
const row = (pathEnd: string) =>
  db.prepare(`SELECT * FROM videos WHERE path LIKE ?`).get(`%${pathEnd}`) as Record<string, unknown> | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vp-scan-'))
  lib = join(root, 'Library')
  mkdirSync(lib)
  db = openDb(':memory:')
  db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'x', 0)`)
  clock = 1000
  put('A.2001.mkv', 'movie a')
  put('Show/Season 1/Show.S01E01.mkv', 'episode 1')
  put('notes.txt', 'not a video')
  put('A.2001.sample.mkv', 'sample')
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('scanFolder', () => {
  it('adds movies and episodes, skipping non-videos and samples', async () => {
    const r = await scanFolder(db, folder(), deps())
    expect(r.added).toBe(2)
    const movie = row('A.2001.mkv')!
    expect(movie).toMatchObject({ kind: 'movie', parsed_title: 'A', parsed_year: 2001, match_status: 'pending', duration_s: 100 })
    expect(movie['wall_key']).toBe(wallKey(movie['quick_hash'] as string))
    expect(row('Show.S01E01.mkv')).toMatchObject({
      kind: 'episode',
      parsed_title: 'Show',
      parsed_show: 'show',
      season: 1,
      episode: 1,
      episode_end: null
    })
  })

  it('skips unchanged files without probing again', async () => {
    await scanFolder(db, folder(), deps())
    const d = deps()
    const r = await scanFolder(db, folder(), d)
    expect(r.unchanged).toBe(2)
    expect(d.probe).not.toHaveBeenCalled()
  })

  it('re-probes a changed file', async () => {
    await scanFolder(db, folder(), deps())
    put('A.2001.mkv', 'movie a, re-encoded and longer')
    const d = deps()
    const r = await scanFolder(db, folder(), d)
    expect(r.updated).toBe(1)
    expect(d.probe).toHaveBeenCalledOnce()
  })

  it('keeps the row and its progress when a file is renamed', async () => {
    await scanFolder(db, folder(), deps())
    const id = row('A.2001.mkv')!['id']
    db.exec(`INSERT INTO playback_state (video_id, position_s, last_played_at) VALUES (${id}, 42, 0)`)
    renameSync(join(lib, 'A.2001.mkv'), join(lib, 'A (2001).mkv'))
    const r = await scanFolder(db, folder(), deps())
    expect(r.renamed).toBe(1)
    expect(row('A (2001).mkv')!['id']).toBe(id)
    expect(row('A.2001.mkv')).toBeUndefined()
    expect(db.prepare('SELECT position_s FROM playback_state').get()).toEqual({ position_s: 42 })
  })

  it('marks a deleted file missing and restores it when it returns', async () => {
    await scanFolder(db, folder(), deps())
    const id = row('Show.S01E01.mkv')!['id']
    unlinkSync(join(lib, 'Show/Season 1/Show.S01E01.mkv'))
    clock = 2000
    expect((await scanFolder(db, folder(), deps())).missing).toBe(1)
    expect(row('Show.S01E01.mkv')!['missing_since']).toBe(2000)

    put('Show/Season 1/Show.S01E01.mkv', 'episode 1')
    await scanFolder(db, folder(), deps())
    expect(row('Show.S01E01.mkv')).toMatchObject({ id, missing_since: null })
  })

  it('records a file ffprobe cannot read and carries on', async () => {
    put('bad.mkv', 'garbage')
    const probe = vi.fn(async (file: string) => {
      if (file.endsWith('bad.mkv')) throw new Error('Invalid data found when processing input')
      return PROBE
    })
    const r = await scanFolder(db, folder(), deps({ probe }))
    expect(r.failed).toEqual([{ path: join(lib, 'bad.mkv'), error: 'Invalid data found when processing input' }])
    expect(row('bad.mkv')).toMatchObject({ duration_s: null, width: null })
    expect(r.added).toBe(3)
  })

  it('carries on when a file vanishes or is locked mid-scan', async () => {
    const quickHash = async (file: string) => {
      if (file.endsWith('A.2001.mkv')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      return createHash('sha1').update(readFileSync(file)).digest('hex')
    }
    const r = await scanFolder(db, folder(), deps({ quickHash }))
    expect(r.failed).toEqual([{ path: join(lib, 'A.2001.mkv'), error: 'EBUSY: resource busy or locked' }])
    expect(r.added).toBe(1)
    expect(row('A.2001.mkv')).toBeUndefined()
  })

  it('keeps everything when the folder is offline and restores it when it is back', async () => {
    await scanFolder(db, folder(), deps())
    const id = row('A.2001.mkv')!['id']
    db.exec(`INSERT INTO playback_state (video_id, position_s, last_played_at) VALUES (${id}, 42, 0)`)
    renameSync(lib, `${lib}-unplugged`)
    clock = 3000

    const r = await scanFolder(db, folder(), deps())
    expect(r.offline).toBe(true)
    expect(db.prepare('SELECT count(*) AS n FROM videos WHERE missing_since = 3000').get()).toEqual({ n: 2 })

    renameSync(`${lib}-unplugged`, lib)
    await scanFolder(db, folder(), deps())
    expect(db.prepare('SELECT count(*) AS n FROM videos WHERE missing_since IS NULL').get()).toEqual({ n: 2 })
    expect(db.prepare('SELECT position_s FROM playback_state').get()).toEqual({ position_s: 42 })
  })

  it('skips a subfolder it cannot read instead of calling the folder offline', async () => {
    put('locked/Hidden.2003.mkv', 'hidden')
    const readDir = async (dir: string) => {
      if (dir.endsWith('locked')) throw Object.assign(new Error('EPERM: operation not permitted, scandir'), { code: 'EPERM' })
      return readdir(dir, { withFileTypes: true })
    }
    const r = await scanFolder(db, folder(), deps({ readDir }))
    expect(r.offline).toBe(false)
    expect(r.added).toBe(2)
  })

  it('calls the folder offline only when the folder itself cannot be read', async () => {
    await scanFolder(db, folder(), deps())
    const readDir = async () => {
      throw Object.assign(new Error('EIO'), { code: 'EIO' })
    }
    const r = await scanFolder(db, folder(), deps({ readDir }))
    expect(r.offline).toBe(true)
  })

  it('does not take over a row whose file still exists in another folder', async () => {
    const other = join(root, 'Backup')
    mkdirSync(other)
    writeFileSync(join(other, 'A.2001.mkv'), 'movie a')
    db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (2, 'y', 0)`)
    await scanFolder(db, folder(), deps())
    const id = Number(row(join('Library', 'A.2001.mkv'))!['id'])
    const r = await scanFolder(db, { id: 2, path: other }, deps())
    expect(r.renamed).toBe(0)
    expect(r.added).toBe(1)
    expect({ ...db.prepare('SELECT id, folder_id FROM videos WHERE id = ?').get(id) }).toEqual({ id, folder_id: 1 })
  })

  it('does not take over the row of a folder on an unplugged drive', async () => {
    await scanFolder(db, folder(), deps())
    renameSync(lib, `${lib}-unplugged`)
    await scanFolder(db, folder(), deps())
    const other = join(root, 'Other')
    mkdirSync(other)
    writeFileSync(join(other, 'A.2001.mkv'), 'movie a')
    db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (2, 'y', 0)`)
    const r = await scanFolder(db, { id: 2, path: other }, deps())
    expect(r).toMatchObject({ renamed: 0, added: 1 })
  })

  it('uses the library folder name for a show added directly', async () => {
    const show = join(root, 'Breaking Bad')
    mkdirSync(join(show, 'Season 1'), { recursive: true })
    writeFileSync(join(show, 'Season 1', '01 - Pilot.mkv'), 'pilot')
    writeFileSync(join(show, 'Season 1', 'S01E02.mkv'), 'two')
    await scanFolder(db, { id: 1, path: show }, deps())
    const shows = db.prepare(`SELECT DISTINCT parsed_title, parsed_show FROM videos WHERE kind = 'episode'`).all()
    expect(shows.map((s) => ({ ...s }))).toEqual([{ parsed_title: 'Breaking Bad', parsed_show: 'breaking bad' }])
  })

  it('commits rows in batches of 50 while the scan is still running', async () => {
    for (let i = 0; i < 118; i++) put(`Batch/Film ${i} (2001).mkv`, `film ${i}`)
    let probed = 0
    const seen: { rows: number; probed: number }[] = []
    const probe = vi.fn(async () => {
      probed++
      await new Promise((r) => setTimeout(r, 1))
      return PROBE
    })
    await scanFolder(db, folder(), {
      ...deps({ probe }),
      limit: createLimiter(2),
      onFlush: () => seen.push({ rows: Number((db.prepare('SELECT count(*) AS n FROM videos').get() as { n: number }).n), probed })
    })
    expect(seen.map((s) => s.rows)).toEqual([50, 100, 120])
    expect(seen[0]!.probed).toBeLessThan(120)
  })

  it('reports progress over the files it found', async () => {
    const onProgress = vi.fn()
    await scanFolder(db, folder(), deps({ onProgress }))
    expect(onProgress).toHaveBeenLastCalledWith(2, 2)
  })
})

describe('wallKey', () => {
  it('is a stable unsigned 32-bit number', () => {
    expect(wallKey('abc')).toBe(wallKey('abc'))
    expect(wallKey('abc')).not.toBe(wallKey('abd'))
    expect(wallKey('abc')).toBeGreaterThanOrEqual(0)
    expect(wallKey('abc')).toBeLessThan(2 ** 32)
  })
})
