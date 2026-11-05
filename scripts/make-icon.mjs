// Turns build/icon.svg into build/icon.ico (PNG entries, 16 to 256 px) with the vendor ffmpeg.
// Run: node scripts/make-icon.mjs. Both files are committed; rerun only when the artwork changes.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const svg = join('build', 'icon.svg')
const ffmpeg = join('vendor', 'ffmpeg', 'ffmpeg.exe')
const dir = mkdtempSync(join(tmpdir(), 'cinewall-icon-'))

try {
  const pngs = SIZES.map((size) => {
    const out = join(dir, `${size}.png`)
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-width', String(size), '-height', String(size), '-i', svg, '-frames:v', '1', '-update', '1', out])
    return readFileSync(out)
  })

  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(SIZES.length, 4)
  let offset = 6 + 16 * SIZES.length
  const entries = SIZES.map((size, i) => {
    const e = Buffer.alloc(16)
    e[0] = size === 256 ? 0 : size // 0 means 256
    e[1] = size === 256 ? 0 : size
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8)
    e.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    return e
  })
  writeFileSync(join('build', 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]))
  // Previews to look at, outside the repo.
  if (process.argv[2]) for (const size of [16, 32, 256]) writeFileSync(join(process.argv[2], `icon-${size}.png`), pngs[SIZES.indexOf(size)])
} finally {
  rmSync(dir, { recursive: true, force: true })
}
