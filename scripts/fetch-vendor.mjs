// Usage: npm run fetch-vendor
// Downloads the binaries pinned in vendor/manifest.json into vendor/<name>/.
import { execFile } from 'node:child_process'
import { createWriteStream, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sevenZip from '7zip-bin'
import { installPackage, needsInstall, readInstalled } from './vendor-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join(root, 'vendor')

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}. Bump vendor/manifest.json.`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

async function extract(archive, outDir) {
  await promisify(execFile)(sevenZip.path7za, ['x', '-y', `-o${outDir}`, archive])
}

const { packages } = JSON.parse(readFileSync(join(vendorDir, 'manifest.json'), 'utf8'))
let failed = false
for (const pkg of packages) {
  if (!needsInstall(pkg, readInstalled(vendorDir), vendorDir)) {
    console.log(`${pkg.name} ${pkg.version} up to date`)
    continue
  }
  try {
    console.log(`${pkg.name} ${pkg.version} downloading…`)
    await installPackage(pkg, { vendorDir, tmpRoot: tmpdir(), download, extract })
    console.log(`${pkg.name} ${pkg.version} installed`)
  } catch (e) {
    failed = true
    console.error(`${pkg.name}: ${e instanceof Error ? e.message : e}`)
  }
}
process.exit(failed ? 1 : 0)
