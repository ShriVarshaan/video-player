// An update on offer, and where the update flow is (milestone 10).
export type UpdateOffer = { version: string; notes: string }

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'upToDate' }
  | { phase: 'available'; offer: UpdateOffer; manual: boolean }
  | { phase: 'downloading'; offer: UpdateOffer; percent: number }
  | { phase: 'ready'; offer: UpdateOffer }
  | { phase: 'failed'; step: 'check' | 'download'; offer: UpdateOffer | null }
