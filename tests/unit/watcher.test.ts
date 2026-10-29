import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchFolder } from '../../src/main/library/watcher'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-watch-'))
  mkdirSync(join(dir, 'Show', 'Season 1'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('watchFolder', () => {
  it('reports changes in subfolders once per burst', async () => {
    const onChange = vi.fn()
    const stop = watchFolder(dir, onChange, 100)
    writeFileSync(join(dir, 'Show', 'Season 1', 'a.mkv'), 'a')
    writeFileSync(join(dir, 'Show', 'Season 1', 'b.mkv'), 'b')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 })
    await settle(300)
    expect(onChange).toHaveBeenCalledOnce()
    stop()
  })

  it('stays quiet after stop', async () => {
    const onChange = vi.fn()
    watchFolder(dir, onChange, 100)()
    writeFileSync(join(dir, 'c.mkv'), 'c')
    await settle(500)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('returns a no-op stop for a folder that is not there', () => {
    expect(() => watchFolder(join(dir, 'missing'), vi.fn())()).not.toThrow()
  })
})
