import { open } from 'node:fs/promises'

const CHUNK = 65536
const MASK = 0xffffffffffffffffn

// OpenSubtitles' file hash: size plus the first and last 64 KB summed as
// little-endian 64-bit words, mod 2^64, as 16 hex digits. Finds subtitles timed
// for this exact copy. (Not the app's quick_hash, which is SHA-1 based.)
export async function osHash(path: string): Promise<string> {
  const f = await open(path, 'r')
  try {
    const size = (await f.stat()).size
    let h = BigInt(size)
    const add = async (at: number) => {
      const buf = Buffer.alloc(Math.min(CHUNK, size))
      const { bytesRead } = await f.read(buf, 0, buf.length, at)
      for (let i = 0; i + 8 <= bytesRead; i += 8) h = (h + buf.readBigUInt64LE(i)) & MASK
    }
    await add(0)
    await add(Math.max(0, size - CHUNK))
    return h.toString(16).padStart(16, '0')
  } finally {
    await f.close()
  }
}
