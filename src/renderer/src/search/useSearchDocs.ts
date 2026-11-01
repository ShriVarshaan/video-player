import { useEffect, useState } from 'react'
import type { SearchDoc } from '@shared/library'

// The search documents: fetched once, refetched when the library changes
// (a scan finishing while search is open refreshes the results in place).

export type DocsStore = {
  get(): SearchDoc[] | null
  subscribe(cb: () => void): () => void
  dispose(): void
}

export function createDocsStore(fetchDocs: () => Promise<SearchDoc[]>, onChanged: (cb: () => void) => () => void): DocsStore {
  let docs: SearchDoc[] | null = null
  const listeners = new Set<() => void>()
  let live = true
  const load = () =>
    fetchDocs().then(
      (d) => {
        if (!live) return
        docs = d
        listeners.forEach((l) => l())
      },
      (e: unknown) => console.error('Search: could not load the library', e)
    )
  void load()
  const off = onChanged(() => void load())
  return {
    get: () => docs,
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    dispose() {
      live = false
      off()
      listeners.clear()
    }
  }
}

// The store lives inside the effect, so StrictMode's mount → unmount → mount
// never leaves a disposed one behind.
export function useSearchDocs(): SearchDoc[] | null {
  const [docs, setDocs] = useState<SearchDoc[] | null>(null)
  useEffect(() => {
    const store = createDocsStore(() => window.api.library.searchDocs({}), (cb) => window.api.on('library.changed', cb))
    const off = store.subscribe(() => setDocs(store.get()))
    return () => {
      off()
      store.dispose()
    }
  }, [])
  return docs
}
