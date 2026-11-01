import type { SearchDoc } from '@shared/library'

// What search shows before anything is typed.

export type Row = { title: 'Continue watching' | 'Recently added'; docs: SearchDoc[] }

const MAX_ROW = 12

export function emptyRows(docs: SearchDoc[]): Row[] {
  const watching = docs
    .filter((d) => d.inProgress)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
    .slice(0, MAX_ROW)
  const added = [...docs].sort((a, b) => b.addedAt - a.addedAt).slice(0, MAX_ROW)
  const rows: Row[] = [
    { title: 'Continue watching', docs: watching },
    { title: 'Recently added', docs: added }
  ]
  return rows.filter((r) => r.docs.length > 0)
}
