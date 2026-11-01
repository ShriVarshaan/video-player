import type { SearchDoc } from '@shared/library'

// Which card is selected after the results change. A new query starts on its
// best match; a library refresh (same query) keeps the user's card while it is
// still in the results.
export function nextSelection(prevKey: string | null, results: SearchDoc[], queryChanged: boolean): string | null {
  if (!queryChanged && prevKey !== null && results.some((d) => d.key === prevKey)) return prevKey
  return results[0]?.key ?? null
}
