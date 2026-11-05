export function notesFor(changelog: string, version: string): string | null
export function checkRelease(s: {
  branch: string
  dirty: boolean
  head: string
  originMain: string
  version: string
  published: string[]
  hasToken: boolean
  changelog: string
  dataFolderOverride?: string
}): string[]
