import { describe, expect, it, vi } from 'vitest'
import type { SearchDoc } from '@shared/library'
import { createDocsStore } from '../../src/renderer/src/search/useSearchDocs'

const docs = (title: string) => [{ key: title, title } as unknown as SearchDoc]
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('createDocsStore', () => {
  it('useSearchDocs refetches on library.changed', async () => {
    const fetchDocs = vi.fn().mockResolvedValueOnce(docs('A')).mockResolvedValueOnce(docs('B'))
    let changed: () => void = () => {}
    const off = vi.fn()
    const store = createDocsStore(fetchDocs, (cb) => {
      changed = cb
      return off
    })
    const seen = vi.fn()
    store.subscribe(seen)
    expect(store.get()).toBeNull()
    await flush()
    expect(store.get()?.[0]?.title).toBe('A')
    changed()
    await flush()
    expect(store.get()?.[0]?.title).toBe('B')
    expect(seen).toHaveBeenCalledTimes(2)
    store.dispose()
    expect(off).toHaveBeenCalled()
  })

  it('a failed fetch keeps the last documents', async () => {
    const fetchDocs = vi.fn().mockResolvedValueOnce(docs('A')).mockRejectedValueOnce(new Error('db'))
    let changed: () => void = () => {}
    const store = createDocsStore(fetchDocs, (cb) => ((changed = cb), () => {}))
    await flush()
    changed()
    await flush()
    expect(store.get()?.[0]?.title).toBe('A')
  })
})

describe('nextSelection', () => {
  it('a new query selects the first card', async () => {
    const { nextSelection } = await import('../../src/renderer/src/search/selection')
    const r = docs('A').concat(docs('B'))
    expect(nextSelection('B', r, true)).toBe('A')
  })
  it('a library refresh keeps the selected card while it is still there', async () => {
    const { nextSelection } = await import('../../src/renderer/src/search/selection')
    const r = docs('A').concat(docs('B'))
    expect(nextSelection('B', r, false)).toBe('B')
    expect(nextSelection('Z', r, false)).toBe('A')
    expect(nextSelection(null, [], false)).toBeNull()
  })
})

describe('docs cache', () => {
  it('a second store starts with the documents the first one loaded', async () => {
    const first = createDocsStore(vi.fn().mockResolvedValue(docs('A')), () => () => {})
    await flush()
    first.dispose()
    const second = createDocsStore(() => new Promise(() => {}), () => () => {})
    expect(second.get()?.[0]?.title).toBe('A')
    second.dispose()
  })
})
