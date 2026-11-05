import { useEffect, useRef, useState, type ReactNode } from 'react'
import { catchAppError } from '@shared/appError'
import type { LinkId } from '@shared/links'
import './setup.css'

type StepName = 'tmdb' | 'opensubtitles' | 'folder'

const openLink = (id: LinkId) => void window.api.app.openLink({ id }).catch((e: unknown) => console.warn('open link:', e))

function SignUpLink({ id, children }: { id: LinkId; children: ReactNode }) {
  return (
    <button type="button" className="setup-link" onClick={() => openLink(id)}>
      {children}
      <span aria-hidden="true"> ↗</span>
    </button>
  )
}

function Frame(props: { step: StepName; n: number; title: string; intro: string; children: ReactNode }) {
  const root = useRef<HTMLElement>(null)
  // Each step starts at its first field, or its main button when it has none.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('input, button.primary')?.focus()
  }, [])
  return (
    <section ref={root} className="setup-step" data-testid="setup-step" data-step={props.step}>
      <div className="setup-dots">
        {[1, 2, 3].map((d) => (
          <i key={d} className={d <= props.n ? 'on' : ''} />
        ))}
        <span>Step {props.n} of 3</span>
      </div>
      <h1>{props.title}</h1>
      <p className="setup-intro">{props.intro}</p>
      {props.children}
    </section>
  )
}

function Message({ text }: { text: string | null }) {
  return text ? (
    <p className="setup-message" role="alert" data-testid="setup-message">
      {text}
    </p>
  ) : null
}

function Skip({ onSkip, loses }: { onSkip: () => void; loses: string }) {
  return (
    <p className="setup-skip">
      <button type="button" className="quiet" data-testid="setup-skip" onClick={onSkip}>
        Skip for now
      </button>
      <span>{loses} You can add this later in Settings.</span>
    </p>
  )
}

function TmdbStep({ onNext }: { onNext: () => void }) {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.metadata.status({}).then((s) => setSaved(s.hasKey), () => {})
  }, [])

  async function save(unchecked: boolean) {
    setBusy(true)
    setMessage(null)
    setUnreachable(false)
    try {
      await window.api.metadata.setTmdbKey({ key, unchecked })
      onNext()
    } catch (e) {
      catchAppError(e, {
        tmdb_unavailable: () => {
          setMessage("Couldn't reach TMDB to check this key.")
          setUnreachable(true)
        },
        DEFAULT: ({ message: m }) => setMessage(m)
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame step="tmdb" n={1} title="Get posters and film details" intro="Cinewall uses TMDB, a free film database. You need your own free key.">
      <ol className="setup-instructions">
        <li>
          <SignUpLink id="tmdbSignup">Create a free TMDB account</SignUpLink>
        </li>
        <li>
          <SignUpLink id="tmdbApiSettings">Open your API settings</SignUpLink> and request a key
        </li>
        <li>Paste the key here</li>
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (saved && !key.trim()) onNext()
          else void save(false)
        }}
      >
        <label htmlFor="setup-tmdb">TMDB API key or read access token</label>
        <input id="setup-tmdb" type="password" value={key} autoComplete="off" onChange={(e) => setKey(e.target.value)} />
        {saved && !key && (
          <p className="setup-saved" data-testid="setup-saved">
            A key is already saved.
          </p>
        )}
        <Message text={message} />
        <div className="setup-actions">
          <button type="submit" className="primary" data-testid="setup-check" disabled={busy}>
            {saved && !key.trim() ? 'Continue' : busy ? 'Checking…' : 'Check and continue'}
          </button>
          {unreachable && (
            <button type="button" data-testid="setup-unchecked" onClick={() => void save(true)}>
              Save without checking
            </button>
          )}
        </div>
      </form>
      <Skip onSkip={onNext} loses="Without it, the wall shows frames from your videos instead of posters, with no film details." />
    </Frame>
  )
}

function OpenSubtitlesStep({ onNext }: { onNext: () => void }) {
  const [form, setForm] = useState({ apiKey: '', username: '', password: '' })
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [busy, setBusy] = useState(false)
  const typed = form.apiKey.trim() !== '' || form.username.trim() !== '' || form.password !== ''

  useEffect(() => {
    window.api.subtitles.accountStatus({}).then((s) => setSaved(s.configured), () => {})
  }, [])

  async function check() {
    setBusy(true)
    setMessage(null)
    setUnreachable(false)
    try {
      await window.api.subtitles.setAccount(form)
      await window.api.subtitles.testAccount({})
      onNext()
    } catch (e) {
      catchAppError(e, {
        opensubtitles_login: () => {
          setMessage('OpenSubtitles did not accept this login. Check your username and password.')
          void window.api.subtitles.clearAccount({})
          setSaved(false)
        },
        opensubtitles_unavailable: () => {
          setMessage("Couldn't reach OpenSubtitles to check this login.")
          setUnreachable(true)
        },
        invalid_argument: ({ message: m }) => setMessage(m),
        DEFAULT: ({ message: m }) => {
          setMessage(m)
          setUnreachable(true)
        }
      })
    } finally {
      setBusy(false)
    }
  }

  // A login that was never accepted isn't kept when they move on without it.
  async function skip() {
    if (unreachable) await window.api.subtitles.clearAccount({}).catch(() => {})
    onNext()
  }

  const field = (key: keyof typeof form, label: string, type: 'text' | 'password') => (
    <>
      <label htmlFor={`setup-os-${key}`}>{label}</label>
      <input id={`setup-os-${key}`} type={type} value={form[key]} autoComplete="off" onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </>
  )

  return (
    <Frame step="opensubtitles" n={2} title="Find subtitles online" intro="Cinewall can search OpenSubtitles when a film has none. You need your own free account and API key.">
      <ol className="setup-instructions">
        <li>
          <SignUpLink id="openSubtitlesSignup">Create a free OpenSubtitles account</SignUpLink>
        </li>
        <li>
          <SignUpLink id="openSubtitlesConsumers">Open the API consumers page</SignUpLink> and create an API key
        </li>
        <li>Enter the key and your login here</li>
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (saved && !typed) onNext()
          else void check()
        }}
      >
        {field('apiKey', 'API key', 'password')}
        {field('username', 'Username', 'text')}
        {field('password', 'Password', 'password')}
        {saved && !typed && (
          <p className="setup-saved" data-testid="setup-saved">
            A login is already saved.
          </p>
        )}
        <Message text={message} />
        <div className="setup-actions">
          <button type="submit" className="primary" data-testid="setup-check" disabled={busy}>
            {saved && !typed ? 'Continue' : busy ? 'Checking…' : 'Check and continue'}
          </button>
          {unreachable && (
            <button type="button" data-testid="setup-unchecked" onClick={onNext}>
              Save without checking
            </button>
          )}
        </div>
      </form>
      <Skip onSkip={() => void skip()} loses="Without it, you can still use subtitle files you already have." />
    </Frame>
  )
}

function FolderStep({ onDone }: { onDone: () => void }) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose() {
    setBusy(true)
    setMessage(null)
    try {
      if (await window.api.library.addFolder({})) {
        await window.api.app.finishSetup({})
        onDone()
      }
    } catch (e) {
      catchAppError(e, { DEFAULT: ({ message: m }) => setMessage(m) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame step="folder" n={3} title="Your movies and shows" intro="Choose the folder they live in. You can add more later in Settings. Your files stay where they are.">
      <Message text={message} />
      <div className="setup-actions">
        <button type="button" className="primary" data-testid="setup-check" disabled={busy} onClick={() => void choose()}>
          Choose a folder
        </button>
      </div>
    </Frame>
  )
}

// The first thing a new install shows: one job per screen, in place of the whole app.
export function FirstRun({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<StepName>('tmdb')
  return (
    <main className="setup">
      {step === 'tmdb' && <TmdbStep onNext={() => setStep('opensubtitles')} />}
      {step === 'opensubtitles' && <OpenSubtitlesStep onNext={() => setStep('folder')} />}
      {step === 'folder' && <FolderStep onDone={onDone} />}
    </main>
  )
}
