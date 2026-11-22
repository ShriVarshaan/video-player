import type { PipGesture } from '@shared/player'
import { movePip, pipBounds, resizePip, type Rect } from './pip'

// Picture in picture: the main window itself becomes the small floating player, so mpv
// (drawing into it with --wid) and the overlay (following it) carry on untouched.
export type PipWindow = {
  isOn(): boolean
  enter(): Promise<void>
  exit(): Promise<void>
  // In or out, decided after anything already queued (so two quick presses go in and back out).
  toggle(): Promise<void>
  // The app is closing: stop floating without bringing the big window back first.
  abandon(): Promise<void>
  gesture(g: PipGesture): void
}

export type PipDeps = {
  win: {
    getBounds(): Rect
    setBounds(r: Rect): void
    isMaximized(): boolean
    maximize(): void
    unmaximize(): void
    isFullScreen(): boolean
    setFullScreen(on: boolean): void
    // Resolves once full screen has been left (or after a timeout).
    leftFullScreen(): Promise<void>
    setAlwaysOnTop(on: boolean): void
  }
  // Takes the title bar and borders off the window, and puts them back.
  frame: { remove(): void; restore(): void }
  overlay: { setPip(on: boolean): void }
  workAreas(): Rect[]
  workAreaFor(r: Rect): Rect
  load(): Promise<Rect | null>
  save(r: Rect): void | Promise<void>
}

export function createPipWindow(deps: PipDeps): PipWindow {
  const { win } = deps
  let on = false
  // How the window was before floating.
  let before: { bounds: Rect; maximized: boolean; fullScreen: boolean } | null = null
  let gesture: { start: Rect } | null = null
  // Enter and exit run one at a time, in the order asked.
  let chain: Promise<void> = Promise.resolve()
  const queue = (step: () => Promise<void>) => (chain = chain.then(step, step).catch((e: unknown) => console.error('PiP failed:', e)))
  // Remembering the spot is best effort: a failed write must not break anything.
  const save = (r: Rect) => {
    try {
      void Promise.resolve(deps.save(r)).catch((e: unknown) => console.error('Saving the PiP spot failed:', e))
    } catch (e) {
      console.error('Saving the PiP spot failed:', e)
    }
  }
  const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  const onSomeDisplay = (r: Rect) => {
    const c = centre(r)
    return deps.workAreas().some((a) => c.x >= a.x && c.y >= a.y && c.x < a.x + a.width && c.y < a.y + a.height)
  }
  // The normal window's old spot, or, if its display has gone, the same size centred on the
  // display the floating window is on.
  const normalBounds = (b: Rect): Rect => {
    if (onSomeDisplay(b)) return b
    const a = deps.workAreaFor(win.getBounds())
    const width = Math.min(b.width, a.width)
    const height = Math.min(b.height, a.height)
    return { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height }
  }

  async function enter() {
    if (on) return
    const fullScreen = win.isFullScreen()
    if (fullScreen) {
      const left = win.leftFullScreen()
      win.setFullScreen(false)
      await left
    }
    const maximized = win.isMaximized()
    if (maximized) win.unmaximize()
    const bounds = win.getBounds()
    before = { bounds, maximized, fullScreen }
    const saved = await deps.load().catch(() => null)
    try {
      deps.frame.remove()
      win.setAlwaysOnTop(true)
      win.setBounds(pipBounds(saved, deps.workAreas(), deps.workAreaFor(bounds)))
      on = true
      deps.overlay.setPip(true)
    } catch (e) {
      // Never leave a half-floating window: put back what was changed.
      on = false
      deps.overlay.setPip(false)
      deps.frame.restore()
      win.setAlwaysOnTop(false)
      const now = win.getBounds()
      if (now.x !== bounds.x || now.y !== bounds.y || now.width !== bounds.width || now.height !== bounds.height) win.setBounds(bounds)
      if (maximized) win.maximize()
      if (fullScreen) win.setFullScreen(true)
      before = null
      throw e
    }
  }

  async function exit() {
    if (!on) return
    save(win.getBounds())
    on = false
    gesture = null
    deps.overlay.setPip(false)
    win.setAlwaysOnTop(false)
    deps.frame.restore()
    const b = before
    before = null
    if (!b) return
    win.setBounds(normalBounds(b.bounds))
    if (b.maximized) win.maximize()
    if (b.fullScreen) win.setFullScreen(true)
  }

  return {
    isOn: () => on,
    enter: () => queue(enter),
    exit: () => queue(exit),
    toggle: () => queue(() => (on ? exit() : enter())),
    abandon: () =>
      queue(async () => {
        if (!on) return
        save(win.getBounds())
        on = false
        gesture = null
        before = null
      }),
    gesture(g) {
      if (!on) return
      if (g.phase === 'start') {
        gesture = { start: win.getBounds() }
        return
      }
      if (!gesture) return
      // The last move already placed the window; the end only remembers where it is.
      if (g.phase === 'end') {
        gesture = null
        save(win.getBounds())
        return
      }
      const { start } = gesture
      if (g.edge === 'move') {
        // Kept on the display it is being dragged onto, so it can go from one screen to another.
        const area = deps.workAreaFor({ ...start, x: start.x + g.dx, y: start.y + g.dy })
        win.setBounds(movePip(start, g.dx, g.dy, area))
      } else {
        win.setBounds(resizePip(start, g.edge, g.dx, g.dy, deps.workAreaFor(start)))
      }
    }
  }
}
