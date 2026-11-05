import { useState } from 'react'
import type { AppInfo, BinaryName } from '@shared/api'
import type { LinkId } from '@shared/links'
import type { UpdateState } from '@shared/updates'
import tmdbLogo from '../assets/tmdb.svg'

const BINARIES: BinaryName[] = ['mpv', 'ffmpeg', 'ffprobe']

function updateStatus(state: UpdateState): string | null {
  switch (state.phase) {
    case 'checking':
      return 'Checking…'
    case 'upToDate':
      return "You're up to date"
    case 'available':
      return `Cinewall ${state.offer.version} is available`
    case 'downloading':
      return `Downloading Cinewall ${state.offer.version}: ${state.percent}%`
    case 'ready':
      return `Restarting to install Cinewall ${state.offer.version}`
    case 'failed':
      return state.step === 'check' ? "Couldn't check for updates. Check your internet connection." : "Couldn't download the update. Try again from Home."
    case 'idle':
      return null
  }
}

export function About({ info, update, onHome, onError }: { info: AppInfo | null; update: UpdateState; onHome: () => void; onError: (e: unknown) => void }) {
  const [notices, setNotices] = useState<string | null>(null)
  const status = updateStatus(update)
  const open = (id: LinkId) => void window.api.app.openLink({ id }).catch(onError)
  const busy = update.phase === 'checking' || update.phase === 'downloading' || update.phase === 'ready'
  // In an installed app a missing file is a broken install, not something to fix with npm.
  const missing = info ? BINARIES.filter((name) => !info.binaries[name].exists) : []

  async function toggleNotices() {
    if (notices !== null) return setNotices(null)
    try {
      setNotices(await window.api.app.notices({}))
    } catch (e) {
      onError(e)
    }
  }

  return (
    <>
      {info && (
        <dl>
          <dt>Version</dt>
          <dd data-testid="version">{info.version}</dd>
          {!info.packaged && (
            <>
              <dt>Library database</dt>
              <dd data-testid="db-path">{info.dbPath}</dd>
              {BINARIES.map((name) => (
                <div key={name} className="row" data-testid={`bin-${name}`} data-exists={String(info.binaries[name].exists)}>
                  <dt>{name}</dt>
                  <dd>{info.binaries[name].exists ? 'found' : 'missing'}</dd>
                </div>
              ))}
            </>
          )}
        </dl>
      )}
      {missing.length > 0 && (
        <p className={info?.packaged ? 'error' : 'muted'} data-testid="binaries-missing">
          {info?.packaged ? "Some of Cinewall's files are missing, so films may not play. Reinstalling Cinewall will fix this." : 'Run npm run fetch-vendor to download mpv and ffmpeg.'}
        </p>
      )}

      <div className="actions">
        <button type="button" disabled={busy} onClick={() => void window.api.updates.check({ manual: true }).catch(onError)}>
          Check for updates
        </button>
        <span className="muted" aria-live="polite" data-testid="update-status">
          {status}
        </span>
        {update.phase === 'available' && (
          <button type="button" className="primary" onClick={onHome}>
            Show on Home
          </button>
        )}
      </div>

      <p className="muted small">
        Cinewall is free software under the MIT licence.{' '}
        <button type="button" className="setup-link" onClick={() => open('repo')}>
          Source on GitHub ↗
        </button>
      </p>

      <p className="tmdb-credit">
        <button type="button" className="tmdb-logo" aria-label="The Movie Database" onClick={() => open('tmdb')}>
          <img src={tmdbLogo} alt="" data-testid="tmdb-logo" />
        </button>
        <span className="muted small">This product uses the TMDB API but is not endorsed or certified by TMDB.</span>
      </p>

      <h3 className="about-heading">Third-party software</h3>
      <p className="muted small">
        <button type="button" className="setup-link" onClick={() => open('mpvSource')}>
          mpv source ↗
        </button>{' '}
        <button type="button" className="setup-link" onClick={() => open('ffmpegSource')}>
          FFmpeg source ↗
        </button>
      </p>
      <button type="button" aria-expanded={notices !== null} onClick={() => void toggleNotices()}>
        {notices === null ? 'Show third-party notices' : 'Hide third-party notices'}
      </button>
      {notices !== null && (
        <pre className="notices" data-testid="notices" tabIndex={0}>
          {notices}
        </pre>
      )}
    </>
  )
}
