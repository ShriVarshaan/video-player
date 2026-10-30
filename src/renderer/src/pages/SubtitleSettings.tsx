import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SubtitleSettings as Settings } from '@shared/api'
import { LANGUAGES } from '@shared/lang'
import { DEFAULT_STYLE, type SubtitleStyle } from '@shared/subtitleStyle'
import { SubtitleView } from '../../overlay/SubtitleView'
import { SubtitleStyleControls } from '../components/SubtitleStyleControls'

const SAMPLE = 'The quick brown fox jumps over the lazy dog.'

// The Subtitles section of Settings. Everything here is global.
export function SubtitleSettings({ onError }: { onError: (e: unknown) => void }) {
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_STYLE)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [backdrop, setBackdrop] = useState<string | null>(null)
  const preview = useRef<HTMLDivElement>(null)
  const [previewH, setPreviewH] = useState(0)

  useEffect(() => {
    window.api.subtitles.getStyle({}).then((s) => setStyle(s.global)).catch(onError)
    window.api.subtitles.getSettings({}).then(setSettings).catch(onError)
    window.api.library
      .wall({})
      .then((items) => setBackdrop(items.find((i) => i.backdropUrl)?.backdropUrl ?? null))
      .catch(() => {})
  }, [onError])

  useLayoutEffect(() => {
    const el = preview.current
    if (!el) return
    const ro = new ResizeObserver(() => setPreviewH(el.clientHeight))
    ro.observe(el)
    setPreviewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // Built on the latest change, not the last render, so quick key presses add up.
  const current = useRef(style)
  current.current = style
  function change(patch: Partial<SubtitleStyle>) {
    const next = { ...current.current, ...patch }
    current.current = next
    setStyle(next)
    window.api.subtitles.setGlobalStyle({ style: next }).catch(onError)
  }

  function changeSettings(patch: Partial<Settings>) {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    window.api.subtitles.setSettings(patch).catch(onError)
  }

  return (
    <div className="subtitle-settings">
      <div className="subtitle-prefs">
        <label htmlFor="sub-language">Subtitle language</label>
        <select id="sub-language" value={settings?.language ?? ''} onChange={(e) => changeSettings({ language: e.target.value })}>
          {LANGUAGES.map((l) => (
            <option key={l.code2} value={l.code2}>
              {l.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={settings?.preferSdh ?? false} onChange={(e) => changeSettings({ preferSdh: e.target.checked })} />
          Prefer subtitles for the deaf and hard of hearing (SDH)
        </label>
      </div>
      <div className="subtitle-style">
        <div
          ref={preview}
          className="subtitle-preview"
          data-testid="subtitle-preview"
          style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}
        >
          {previewH > 0 && <SubtitleView cue={null} sample={SAMPLE} style={style} controlsTop={null} height={previewH} />}
        </div>
        <SubtitleStyleControls style={style} onChange={change} />
      </div>
      <OpenSubtitlesAccount onError={onError} />
    </div>
  )
}

// The OpenSubtitles login used by "Search online…". Saved encrypted; the key and
// password never come back to this page.
function OpenSubtitlesAccount({ onError }: { onError: (e: unknown) => void }) {
  const [status, setStatus] = useState<{ configured: boolean; username: string | null } | null>(null)
  const [form, setForm] = useState({ apiKey: '', username: '', password: '' })
  const [test, setTest] = useState<string | null>(null)

  const load = useCallback(() => window.api.subtitles.accountStatus({}).then(setStatus).catch(onError), [onError])
  useEffect(() => void load(), [load])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setTest(null)
    try {
      await window.api.subtitles.setAccount(form)
      setForm({ apiKey: '', username: '', password: '' })
      await load()
    } catch (err) {
      onError(err)
    }
  }

  async function check() {
    setTest('Checking…')
    try {
      const a = await window.api.subtitles.testAccount({})
      setTest(`Signed in as ${a.username} · ${a.remaining} downloads left today`)
    } catch (err) {
      setTest(null)
      onError(err)
    }
  }

  const field = (key: keyof typeof form, label: string, type: 'text' | 'password') => (
    <>
      <label htmlFor={`os-${key}`}>{label}</label>
      <input id={`os-${key}`} type={type} autoComplete="off" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </>
  )

  return (
    <form className="opensubtitles" onSubmit={(e) => void save(e)}>
      <h3>OpenSubtitles</h3>
      <p className="muted small">
        Used only when you choose Search online… in the player. Needs a free account at opensubtitles.com and an API key from
        its API consumers page.
      </p>
      {field('apiKey', 'API key', 'password')}
      {field('username', 'Username', 'text')}
      {field('password', 'Password', 'password')}
      <div className="actions">
        <button type="submit">Save account</button>
        {status?.configured && (
          <button type="button" onClick={() => void check()}>
            Test
          </button>
        )}
        <span className="muted" aria-live="polite">
          {test ?? (status?.configured ? `Saved for ${status.username}` : 'Not set up')}
        </span>
      </div>
    </form>
  )
}
