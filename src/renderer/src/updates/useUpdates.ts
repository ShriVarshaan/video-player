import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/updates'

// The update state for the whole session. Once a download is ready the app restarts, wherever the
// person is, unless a film is playing: then it waits for the player to close. (Main refuses too,
// for a film that has been asked for but hasn't reached this window yet; `playing` changing
// when that film closes runs this again.)
export function useUpdates(playing: boolean): UpdateState {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })

  useEffect(() => {
    let heard = false
    const off = window.api.on('updates.state', (next) => {
      heard = true
      setState(next)
    })
    window.api.updates.state({}).then(
      (current) => {
        if (!heard) setState(current)
      },
      () => {}
    )
    return off
  }, [])

  const ready = state.phase === 'ready'
  useEffect(() => {
    if (ready && !playing) void window.api.updates.restart({}).catch(() => {})
  }, [ready, playing])

  return state
}
