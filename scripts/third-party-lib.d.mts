export interface SourcePin {
  name: string
  repo: string
  commit: string
  // FFmpeg-Builds: also mirror every library its scripts pin for this build.
  dependencies?: { target: string; variant: string; addins: string }
}
export interface VendorPackage {
  name: string
  version: string
  url: string
  upstream?: string
  sha256: string
  from: string
  keep: string[]
  sources: SourcePin[]
}
export interface VendorManifest {
  mirror: { repo: string; tag: string }
  packages: VendorPackage[]
}
export interface ScriptPin {
  kind: 'git' | 'svn'
  repo: string
  ref: string
  mirror?: string
}
export function mirrorPage(m: VendorManifest): string
export function mirrorRelease(
  m: VendorManifest,
  body: string,
  commit: string
): { tag_name: string; target_commitish: string; name: string; body: string; draft: false; prerelease: true; make_latest: 'false' }
export function mirrorDownload(m: VendorManifest, file: string): string
export function offMirror(m: { mirror: { repo: string; tag: string }; packages: { name: string; url: string }[] }): string[]
export function parseScriptPins(text: string): ScriptPin[]
export function scriptEnabled(
  text: string,
  env: { target: string; variant: string; addins: string },
  readScript: (path: string) => string
): boolean
export function svnListing(html: string): { name: string; dir: boolean }[]
export function archiveName(repo: string, ref: string): string
