import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPackage, needsInstall, readInstalled, sha256File } from '../../scripts/vendor-lib.mjs'

const ARCHIVE = 'pretend archive bytes'
const SHA = createHash('sha256').update(ARCHIVE).digest('hex')

let root: string
let vendorDir: string
let tmpRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vp-vendor-'))
  vendorDir = join(root, 'vendor')
  tmpRoot = join(root, 'tmp')
  mkdirSync(vendorDir)
  mkdirSync(tmpRoot)
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const pkg = (over: object = {}) => ({
  name: 'mpv',
  version: 'test',
  url: 'https://example.invalid/mpv.7z',
  sha256: SHA,
  from: 'bundle',
  keep: ['mpv.exe', '*.dll'],
  ...over
})

const download = vi.fn(async (_url: string, dest: string) => writeFileSync(dest, ARCHIVE))
const extract = vi.fn(async (_archive: string, outDir: string) => {
  mkdirSync(join(outDir, 'bundle'), { recursive: true })
  for (const f of ['mpv.exe', 'libmpv-2.dll', 'readme.txt']) writeFileSync(join(outDir, 'bundle', f), f)
})
const deps = () => ({ vendorDir, tmpRoot, download, extract })

describe('sha256File', () => {
  it('hashes file contents as hex', async () => {
    const f = join(root, 'a')
    writeFileSync(f, ARCHIVE)
    expect(await sha256File(f)).toBe(SHA)
  })
})

describe('installPackage', () => {
  it('copies only the kept files and records the hash', async () => {
    await installPackage(pkg(), deps())
    expect(readdirSync(join(vendorDir, 'mpv')).sort()).toEqual(['libmpv-2.dll', 'mpv.exe'])
    expect(readInstalled(vendorDir)).toEqual({ mpv: SHA })
  })

  it('makes needsInstall false until the manifest hash or the files change', async () => {
    expect(needsInstall(pkg(), readInstalled(vendorDir), vendorDir)).toBe(true)
    await installPackage(pkg(), deps())
    expect(needsInstall(pkg(), readInstalled(vendorDir), vendorDir)).toBe(false)
    expect(needsInstall(pkg({ sha256: 'f'.repeat(64) }), readInstalled(vendorDir), vendorDir)).toBe(true)
    rmSync(join(vendorDir, 'mpv'), { recursive: true })
    expect(needsInstall(pkg(), readInstalled(vendorDir), vendorDir)).toBe(true)
  })

  it('rejects a hash mismatch and installs nothing', async () => {
    const bad = pkg({ sha256: '0'.repeat(64) })
    await expect(installPackage(bad, deps())).rejects.toThrow(
      /SHA-256 mismatch for mpv.*Bump vendor\/manifest.json/
    )
    expect(existsSync(join(vendorDir, 'mpv'))).toBe(false)
    expect(readInstalled(vendorDir)).toEqual({})
  })

  it('leaves no trace when the download fails midway', async () => {
    const failing = vi.fn(async (_url: string, dest: string) => {
      writeFileSync(dest, 'partial')
      throw new Error('connection reset')
    })
    await expect(installPackage(pkg(), { ...deps(), download: failing })).rejects.toThrow('connection reset')
    expect(existsSync(join(vendorDir, 'mpv'))).toBe(false)
    expect(readInstalled(vendorDir)).toEqual({})
  })

  it('keeps a good install when an update fails', async () => {
    await installPackage(pkg(), deps())
    const update = pkg({ sha256: '0'.repeat(64) })
    await expect(installPackage(update, deps())).rejects.toThrow(/SHA-256 mismatch/)
    expect(readFileSync(join(vendorDir, 'mpv', 'mpv.exe'), 'utf8')).toBe('mpv.exe')
    expect(readInstalled(vendorDir)).toEqual({ mpv: SHA })
  })

  it('removes its temp directories whether it succeeds or fails', async () => {
    await installPackage(pkg(), deps())
    await installPackage(pkg({ sha256: '0'.repeat(64) }), deps()).catch(() => {})
    expect(readdirSync(tmpRoot)).toEqual([])
  })
})
