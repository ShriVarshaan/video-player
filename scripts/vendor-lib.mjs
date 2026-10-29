// Download, verify and unpack the pinned third-party binaries (release-windows §1).
// download/extract are passed in so tests can run without the network.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const INSTALLED = '.installed.json'

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export function readInstalled(vendorDir) {
  const file = join(vendorDir, INSTALLED)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

export function needsInstall(pkg, installed, vendorDir) {
  return installed[pkg.name] !== pkg.sha256 || !existsSync(join(vendorDir, pkg.name))
}

const globToRegExp = (glob) =>
  new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')

export async function installPackage(pkg, { vendorDir, download, extract, tmpRoot }) {
  const work = mkdtempSync(join(tmpRoot, `vp-${pkg.name}-`))
  const staging = join(vendorDir, `${pkg.name}.tmp`)
  try {
    const archive = join(work, 'archive')
    await download(pkg.url, archive)

    const actual = await sha256File(archive)
    if (actual !== pkg.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${pkg.name}: expected ${pkg.sha256}, got ${actual}. Bump vendor/manifest.json.`
      )
    }

    // Extract into a fresh empty directory; nothing inside it is ever run.
    const unpacked = join(work, 'unpacked')
    mkdirSync(unpacked)
    await extract(archive, unpacked)

    const source = join(unpacked, pkg.from)
    const patterns = pkg.keep.map(globToRegExp)
    const files = readdirSync(source, { withFileTypes: true })
      .filter((e) => e.isFile() && patterns.some((p) => p.test(e.name)))
      .map((e) => e.name)
    if (files.length === 0) throw new Error(`No files matching ${pkg.keep.join(', ')} in ${pkg.from || 'archive root'}`)

    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging)
    for (const f of files) copyFileSync(join(source, f), join(staging, f))

    const target = join(vendorDir, pkg.name)
    rmSync(target, { recursive: true, force: true })
    renameSync(staging, target)

    // Written last, so an interrupted run is retried next time.
    const installed = { ...readInstalled(vendorDir), [pkg.name]: pkg.sha256 }
    writeFileSync(join(vendorDir, INSTALLED), JSON.stringify(installed, null, 2) + '\n')
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}
