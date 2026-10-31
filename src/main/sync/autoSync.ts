import { randomBytes } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { IN_SYNC_S, type AutoSyncOutcome, type AutoSyncProgress } from '@shared/autoSync'
import { throwAppError } from '@shared/appError'
import type { Transform } from '@shared/subtitleTiming'
import type { Db } from '../db'
import type { PlayerService } from '../player/service'
import type { ParsedCue } from '../subtitles/parse'
import { writeAndShowSynced } from '../subtitles/showSynced'
import { writeSrt } from '../subtitles/srt'
import { SidecarError, type Sidecar } from './sidecar'

export type AutoSync = {
  start(key: string): Promise<AutoSyncOutcome>
  replace(key: string): Promise<AutoSyncOutcome>
  cancel(): void
}

type Showing = NonNullable<ReturnType<PlayerService['currentSubtitle']>>

// Auto sync of the showing subtitle (milestone 7): the sidecar measures, this
// writes the synced file through the same path as manual export.
export function createAutoSync(deps: {
  player: Pick<PlayerService, 'currentSubtitle' | 'subtitleCues' | 'currentAudio' | 'current' | 'addSubtitle' | 'resetSubtitleTiming'>
  sidecar: Sidecar
  db: Db
  userDataPath: string
  tempDir: string
  emit: (p: AutoSyncProgress) => void
}): AutoSync {
  const { player, sidecar } = deps
  // A result waiting for the user's answer to "Replace?".
  let pending: { key: string; sub: Showing; cues: ParsedCue[]; t: Transform } | null = null
  // The running start's own cancel flag: a cancel can come before the sidecar has the job.
  let job: { cancelled: boolean } | null = null

  function showingWith(key: string): Showing {
    const sub = player.currentSubtitle()
    if (!sub) throwAppError({ code: 'invalid_argument', message: 'Choose a subtitle first.' })
    if (sub!.track.key !== key) throwAppError({ code: 'invalid_argument', message: 'The subtitle changed. Try again.' })
    return sub!
  }

  // Still the same video and subtitle as when the sync started.
  const stillShowing = (sub: Showing) => {
    const now = player.currentSubtitle()
    return now !== null && now.videoId === sub.videoId && now.track.key === sub.track.key
  }

  async function save(sub: Showing, cues: ParsedCue[], t: Transform, replace: boolean): Promise<AutoSyncOutcome> {
    const r = await writeAndShowSynced(deps, sub, cues, t, replace)
    if ('exists' in r) {
      pending = { key: sub.track.key!, sub, cues, t }
      return { status: 'exists', ...t, name: basename(r.exists) }
    }
    return { status: 'synced', ...t, saved: basename(r.saved), fallback: r.fallback }
  }

  async function measure(sub: Showing, cues: ParsedCue[], me: { cancelled: boolean }): Promise<Transform | 'noMatch' | 'cancelled'> {
    const audio = player.currentAudio()
    if (!audio || audio.audioStream === null) throwAppError('sync_no_audio')
    const tmp = join(deps.tempDir, `vp-autosync-${randomBytes(6).toString('hex')}.srt`)
    await writeFile(tmp, writeSrt(cues, { scale: 1, offset: 0 }), 'utf8')
    try {
      if (me.cancelled) return 'cancelled'
      const m = await sidecar.sync(
        { video: sub.videoPath, subtitle: tmp, audioStream: audio!.audioStream!, durationS: audio!.durationS },
        (p) => deps.emit({ key: sub.track.key!, ...p })
      )
      return { scale: m.scale, offset: m.offset }
    } catch (e) {
      if (!(e instanceof SidecarError)) throw e
      if (e.code === 'NO_MATCH') return 'noMatch'
      if (e.code === 'CANCELLED') return 'cancelled'
      if (e.code === 'NO_AUDIO') throwAppError('sync_no_audio')
      if (e.code === 'BUSY') throwAppError('sync_busy')
      console.error(`Auto sync failed (${e.code}): ${e.message}`)
      return throwAppError('sync_unavailable')
    } finally {
      await rm(tmp, { force: true }).catch(() => {})
    }
  }

  return {
    async start(key) {
      const sub = showingWith(key)
      if (sub.track.image) throwAppError({ code: 'invalid_argument', message: "Picture subtitles can't be auto-synced" })
      pending = null
      const me = { cancelled: false }
      job = me
      // The file's own timing, whatever offset is stored for it.
      const cues = await player.subtitleCues()
      if (me.cancelled) return { status: 'cancelled' }
      const t = await measure(sub, cues, me)
      if (t === 'noMatch') return { status: 'noMatch' }
      if (t === 'cancelled' || !stillShowing(sub)) return { status: 'cancelled' }
      if (Math.abs(t.offset) < IN_SYNC_S && t.scale === 1) {
        // Only the stored offset was making it play out of time.
        const cleared = (player.currentSubtitle()?.offset ?? 0) !== 0
        if (cleared) await player.resetSubtitleTiming()
        return { status: 'inSync', clearedOffset: cleared }
      }
      return save(sub, cues, t, false)
    },

    async replace(key) {
      const p = pending
      if (!p || p.key !== key) throwAppError({ code: 'invalid_argument', message: 'Nothing to replace. Sync again.' })
      showingWith(key)
      pending = null
      return save(p!.sub, p!.cues, p!.t, true)
    },

    cancel() {
      pending = null
      if (job) job.cancelled = true
      sidecar.cancel()
    }
  }
}
