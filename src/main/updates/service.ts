import type { API } from '@shared/api'
import type { UpdateOffer, UpdateState } from '@shared/updates'

// What the service needs from an updater: electron-updater when installed, a stand-in otherwise.
export type UpdateAdapter = {
  check(): Promise<{ version: string; notes: unknown } | null>
  download(onPercent: (n: number) => void): Promise<void>
  quitAndInstall(): void
}

const SKIPPED = 'updates.skipped'
const MAX_NOTE_LINES = 6

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&amp;': '&' }

// Release notes can arrive as HTML, as a list per version, or not at all. The card shows a few
// lines of plain text.
export function toPlainNotes(notes: unknown): string {
  let text = ''
  if (typeof notes === 'string') text = notes
  else if (Array.isArray(notes)) {
    text = notes.map((n: unknown) => (n && typeof n === 'object' && 'note' in n && typeof n.note === 'string' ? n.note : '')).join('\n')
  }
  const lines = text
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    // One pass, so "&amp;lt;" becomes the text "&lt;" and isn't decoded twice.
    .replace(/&(?:lt|gt|quot|#39|nbsp|amp);/g, (e) => ENTITIES[e]!)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.slice(0, MAX_NOTE_LINES).join('\n')
}

export function createUpdateService(deps: {
  adapter: UpdateAdapter
  settings: Pick<API['settings'], 'get' | 'set'>
  emit: (state: UpdateState) => void
}): API['updates'] {
  let state: UpdateState = { phase: 'idle' }
  // "Remind me later" lasts until the app next opens, so it's kept in memory only.
  let laterVersion: string | null = null

  const set = (next: UpdateState) => {
    state = next
    deps.emit(next)
  }
  const currentOffer = (): UpdateOffer | null => ('offer' in state ? state.offer : null)
  const busy = () => state.phase === 'downloading' || state.phase === 'ready'

  return {
    state: async () => state,

    check: async ({ manual }) => {
      if (busy()) return
      const showing = state.phase === 'available' ? state : null
      if (manual) set({ phase: 'checking' })
      let found: Awaited<ReturnType<UpdateAdapter['check']>>
      try {
        found = await deps.adapter.check()
      } catch (e) {
        console.warn('update check failed:', e instanceof Error ? e.message : e)
        if (manual) set({ phase: 'failed', step: 'check', offer: null })
        return
      }
      if (busy()) return // an install began while this check was out
      if (!found) {
        if (manual) set({ phase: 'upToDate' })
        else if (!showing && state.phase !== 'idle') set({ phase: 'idle' })
        return
      }
      if (!manual) {
        if (found.version === laterVersion) return
        if ((await deps.settings.get({ key: SKIPPED })) === found.version) return
      }
      set({ phase: 'available', offer: { version: found.version, notes: toPlainNotes(found.notes) }, manual })
    },

    install: async () => {
      const offer = currentOffer()
      if (!offer || busy()) return
      set({ phase: 'downloading', offer, percent: 0 })
      try {
        await deps.adapter.download((percent) => set({ phase: 'downloading', offer, percent }))
        set({ phase: 'ready', offer })
      } catch (e) {
        console.warn('update download failed:', e instanceof Error ? e.message : e)
        set({ phase: 'failed', step: 'download', offer })
      }
    },

    later: async () => {
      const offer = currentOffer()
      if (!offer || busy()) return
      laterVersion = offer.version
      set({ phase: 'idle' })
    },

    skip: async () => {
      const offer = currentOffer()
      if (!offer || busy()) return
      await deps.settings.set({ key: SKIPPED, value: offer.version })
      set({ phase: 'idle' })
    },

    restart: async () => {
      if (state.phase === 'ready') deps.adapter.quitAndInstall()
    }
  }
}
