// Comparable form of a title, for grouping, matching and search:
// accents folded, lowercase, '&' read as 'and', punctuation collapsed to spaces.
// Letters and digits of every script are kept (Cyrillic, CJK, Greek, …).
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
