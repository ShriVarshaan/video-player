export type VendorPackage = {
  name: string
  version: string
  url: string
  sha256: string
  /** Directory inside the archive that holds the files, '' for the root. */
  from: string
  /** File names or * globs to copy from `from`. */
  keep: string[]
}

export type InstallDeps = {
  vendorDir: string
  tmpRoot: string
  download: (url: string, dest: string) => Promise<void>
  extract: (archive: string, outDir: string) => Promise<void>
}

export function sha256File(path: string): Promise<string>
export function readInstalled(vendorDir: string): Record<string, string>
export function needsInstall(pkg: VendorPackage, installed: Record<string, string>, vendorDir: string): boolean
export function installPackage(pkg: VendorPackage, deps: InstallDeps): Promise<void>
