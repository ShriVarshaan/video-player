import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

const CHUNK = 64 * 1024

// Identity that survives renames without reading whole files: size plus the
// first and last 64 KB. Edits in the middle of a file don't change it.
export async function quickHash(file: string, size: number): Promise<string> {
  const hash = createHash('sha1').update(String(size))
  const handle = await open(file, 'r')
  try {
    const head = Buffer.alloc(Math.min(CHUNK, size))
    await handle.read(head, 0, head.length, 0)
    hash.update(head)
    if (size > CHUNK) {
      const tail = Buffer.alloc(Math.min(CHUNK, size - CHUNK))
      await handle.read(tail, 0, tail.length, size - tail.length)
      hash.update(tail)
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}
