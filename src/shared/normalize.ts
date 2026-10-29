// Comparable form of a title, for grouping, matching and search:
// accents folded, lowercase, '&' read as 'and', punctuation collapsed to spaces.
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
