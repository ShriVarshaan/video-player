import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { osHash } from '../../src/main/subtitles/osHash'

const CHUNK = 65536
let dir: string
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// The definition, written out independently: file size plus the sum of the
// first and last 64 KB read as little-endian 64-bit words, modulo 2^64.
function reference(buf: Buffer): string {
  let h = BigInt(buf.length)
  const words = (b: Buffer) => {
    for (let i = 0; i + 8 <= b.length; i += 8) h = (h + b.readBigUInt64LE(i)) & 0xffffffffffffffffn
  }
  words(buf.subarray(0, Math.min(CHUNK, buf.length)))
  words(buf.subarray(Math.max(0, buf.length - CHUNK)))
  return h.toString(16).padStart(16, '0')
}

describe('osHash', () => {
  it('matches the OpenSubtitles definition on a 200 KB file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vp-hash-'))
    const buf = Buffer.alloc(200 * 1024)
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 7919) & 0xff
    const p = join(dir, 'a.bin')
    writeFileSync(p, buf)
    const h = await osHash(p)
    expect(h).toMatch(/^[0-9a-f]{16}$/)
    expect(h).toBe(reference(buf))
  })

  it('hashes a file smaller than 64 KB without failing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vp-hash-'))
    const buf = Buffer.from('tiny file contents!!') // 20 bytes: two whole words and a tail
    const p = join(dir, 'b.bin')
    writeFileSync(p, buf)
    expect(await osHash(p)).toBe(reference(buf))
  })
})
