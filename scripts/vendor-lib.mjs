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

// A missing or damaged record means "nothing installed", so the next run reinstalls.
export function readInstalled(vendorDir) {
  try {
    return JSON.parse(readFileSync(join(vendorDir, INSTALLED), 'utf8'))
  } catch {
    return {}
  }
}

function writeInstalled(vendorDir, installed) {
  const file = join(vendorDir, INSTALLED)
  writeFileSync(`${file}.tmp`, JSON.stringify(installed, null, 2) + '\n')
  renameSync(`${file}.tmp`, file)
}

// Windows briefly refuses renames of freshly written .exe/.dll files while
// antivirus scans them, so retry EPERM/EBUSY/EACCES for a few seconds.
async function renameWithRetry(rename, from, to, delayMs) {
  for (let attempt = 0; ; attempt++) {
    try {
      return rename(from, to)
    } catch (e) {
      if (attempt >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) throw e
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
}

export function needsInstall(pkg, installed, vendorDir) {
  return installed[pkg.name] !== pkg.sha256 || !existsSync(join(vendorDir, pkg.name))
}

const globToRegExp = (glob) =>
  new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')

export async function installPackage(
  pkg,
  { vendorDir, download, extract, tmpRoot, rename = renameSync, retryDelayMs = 300 }
) {
  const work = mkdtempSync(join(tmpRoot, `vp-${pkg.name}-`))
  const staging = join(vendorDir, `${pkg.name}.tmp`)
  const old = join(vendorDir, `${pkg.name}.old`)
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

    // Swap through <name>.old so a failed move puts the previous install back.
    const target = join(vendorDir, pkg.name)
    rmSync(old, { recursive: true, force: true })
    const hadOld = existsSync(target)
    if (hadOld) await renameWithRetry(rename, target, old, retryDelayMs)
    try {
      await renameWithRetry(rename, staging, target, retryDelayMs)
    } catch (e) {
      if (hadOld) await renameWithRetry(rename, old, target, retryDelayMs)
      throw e
    }
    rmSync(old, { recursive: true, force: true })

    // Written last, so an interrupted run is retried next time.
    writeInstalled(vendorDir, { ...readInstalled(vendorDir), [pkg.name]: pkg.sha256 })
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}
