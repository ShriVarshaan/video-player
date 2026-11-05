import { describe, expect, it, vi } from 'vitest'
import type { Json } from '@shared/api'
import type { UpdateState } from '@shared/updates'
import { createUpdateService, toPlainNotes, type UpdateAdapter } from '../../src/main/updates/service'

function setup(over: Partial<UpdateAdapter> = {}, store = new Map<string, Json>()) {
  const adapter = {
    check: vi.fn(async (): Promise<{ version: string; notes: unknown } | null> => ({ version: '2.0.0', notes: 'New things' })),
    download: vi.fn(async (onPercent: (n: number) => void) => onPercent(50)),
    quitAndInstall: vi.fn(),
    ...over
  }
  const seen: UpdateState[] = []
  const make = () =>
    createUpdateService({
      adapter,
      settings: { get: async ({ key }) => store.get(key) ?? null, set: async ({ key, value }) => void store.set(key, value) },
      emit: (s) => seen.push(s),
      filmOpen: () => film.open
    })
  const film = { open: false }
  return { service: make(), make, adapter, seen, store, film }
}
const auto = { manual: false }
const manual = { manual: true }

describe('update service', () => {
  it('offers a found version and downloads nothing until asked', async () => {
    const { service, adapter } = setup()
    await service.check(auto)
    expect(await service.state({})).toEqual({ phase: 'available', offer: { version: '2.0.0', notes: 'New things' }, manual: false })
    expect(adapter.download).not.toHaveBeenCalled()
  })

  it('Later hides it for this session, and the next launch offers it again', async () => {
    const { service, make } = setup()
    await service.check(auto)
    await service.later({})
    expect(await service.state({})).toEqual({ phase: 'idle' })
    await service.check(auto)
    expect(await service.state({})).toEqual({ phase: 'idle' })
    const next = make()
    await next.check(auto)
    expect((await next.state({})).phase).toBe('available')
  })

  it('Later still offers a newer version', async () => {
    const check = vi.fn(async () => ({ version: '2.0.0', notes: '' }))
    const { service } = setup({ check })
    await service.check(auto)
    await service.later({})
    check.mockResolvedValue({ version: '2.1.0', notes: '' })
    await service.check(auto)
    expect((await service.state({})).phase).toBe('available')
  })

  it('Skip lasts across launches until a newer version', async () => {
    const check = vi.fn(async () => ({ version: '2.0.0', notes: '' }))
    const { service, make, store } = setup({ check })
    await service.check(auto)
    await service.skip({})
    expect(store.get('updates.skipped')).toBe('2.0.0')
    const next = make()
    await next.check(auto)
    expect(await next.state({})).toEqual({ phase: 'idle' })
    check.mockResolvedValue({ version: '2.1.0', notes: '' })
    await next.check(auto)
    expect((await next.state({})).phase).toBe('available')
  })

  it('a manual check ignores both Skip and Later', async () => {
    const { service } = setup()
    await service.check(auto)
    await service.skip({})
    await service.check(manual)
    expect(await service.state({})).toMatchObject({ phase: 'available', manual: true })
    await service.later({})
    await service.check(manual)
    expect((await service.state({})).phase).toBe('available')
  })

  it('a failed automatic check stays quiet; a manual one says so', async () => {
    const { service, seen } = setup({ check: vi.fn(async () => { throw new Error('offline') }) })
    await service.check(auto)
    expect(seen).toEqual([])
    await service.check(manual)
    expect(await service.state({})).toEqual({ phase: 'failed', step: 'check', offer: null })
  })

  it('a failed automatic check keeps an offer that is showing', async () => {
    const check = vi.fn<UpdateAdapter['check']>(async () => ({ version: '2.0.0', notes: '' }))
    const { service } = setup({ check })
    await service.check(auto)
    check.mockRejectedValue(new Error('offline'))
    await service.check(auto)
    expect((await service.state({})).phase).toBe('available')
  })

  it('a manual check with nothing new says up to date', async () => {
    const { service } = setup({ check: vi.fn(async () => null) })
    await service.check(manual)
    expect(await service.state({})).toEqual({ phase: 'upToDate' })
  })

  it('install downloads with progress, then is ready, and only then restarts', async () => {
    const { service, adapter, seen } = setup()
    await service.restart({})
    expect(adapter.quitAndInstall).not.toHaveBeenCalled()
    await service.check(auto)
    await service.install({})
    expect(seen.map((s) => s.phase)).toEqual(['available', 'downloading', 'downloading', 'ready'])
    expect(seen[2]).toMatchObject({ percent: 50 })
    await service.restart({})
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('restart refuses while a film is open, even one still starting', async () => {
    const { service, adapter, film } = setup()
    await service.check(auto)
    await service.install({})
    film.open = true
    await service.restart({})
    expect(adapter.quitAndInstall).not.toHaveBeenCalled()
    film.open = false
    await service.restart({})
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('a failed download offers a retry that works', async () => {
    const download = vi.fn<UpdateAdapter['download']>(async () => {
      throw new Error('dropped')
    })
    const { service } = setup({ download })
    await service.check(auto)
    await service.install({})
    expect(await service.state({})).toMatchObject({ phase: 'failed', step: 'download', offer: { version: '2.0.0' } })
    download.mockResolvedValue()
    await service.install({})
    expect((await service.state({})).phase).toBe('ready')
  })

  it('no check runs while downloading or ready', async () => {
    let finish = () => {}
    const download = vi.fn(() => new Promise<void>((r) => (finish = r)))
    const check = vi.fn<UpdateAdapter['check']>(async () => ({ version: '2.0.0', notes: '' }))
    const { service } = setup({ download, check })
    await service.check(auto)
    const installing = service.install({})
    check.mockClear()
    await service.check(manual)
    expect(check).not.toHaveBeenCalled()
    finish()
    await installing
    await service.check(auto)
    expect(check).not.toHaveBeenCalled()
    expect((await service.state({})).phase).toBe('ready')
  })

  it('install with nothing on offer does nothing', async () => {
    const { service, adapter } = setup()
    await service.install({})
    expect(adapter.download).not.toHaveBeenCalled()
  })
})

describe('toPlainNotes', () => {
  it('turns HTML into plain lines', () => {
    expect(toPlainNotes('<h2>New</h2><p>Faster &amp; better</p><script>x</script>')).toBe('New\nFaster & better')
  })
  it('copes with nothing and with a list per version', () => {
    expect(toPlainNotes(null)).toBe('')
    expect(toPlainNotes(undefined)).toBe('')
    expect(toPlainNotes([{ version: '1', note: 'One' }, { version: '2', note: null }])).toBe('One')
  })
  it('keeps long notes short', () => {
    expect(toPlainNotes('l\n'.repeat(50)).split('\n').length).toBeLessThanOrEqual(6)
  })
  it('never hands back markup', () => {
    expect(toPlainNotes('<img src=x onerror=alert(1)>Hello')).toBe('Hello')
    expect(toPlainNotes('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;')
  })
})
