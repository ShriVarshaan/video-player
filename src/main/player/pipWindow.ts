import type { PipGesture } from '@shared/player'
import { movePip, pipBounds, resizePip, type Rect } from './pip'

// Picture in picture: the main window itself becomes the small floating player, so mpv
// (drawing into it with --wid) and the overlay (following it) carry on untouched.
export type PipWindow = {
  isOn(): boolean
  enter(): Promise<void>
  exit(): Promise<void>
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
  save(r: Rect): void
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
    deps.frame.remove()
    win.setAlwaysOnTop(true)
    win.setBounds(pipBounds(saved, deps.workAreas(), deps.workAreaFor(bounds)))
    on = true
    deps.overlay.setPip(true)
  }

  async function exit() {
    if (!on) return
    deps.save(win.getBounds())
    on = false
    gesture = null
    deps.overlay.setPip(false)
    win.setAlwaysOnTop(false)
    deps.frame.restore()
    const b = before
    before = null
    if (!b) return
    win.setBounds(b.bounds)
    if (b.maximized) win.maximize()
    if (b.fullScreen) win.setFullScreen(true)
  }

  return {
    isOn: () => on,
    enter: () => queue(enter),
    exit: () => queue(exit),
    gesture(g) {
      if (!on) return
      if (g.phase === 'start') {
        gesture = { start: win.getBounds() }
        return
      }
      if (!gesture) return
      const { start } = gesture
      const area = deps.workAreaFor(start)
      win.setBounds(g.edge === 'move' ? movePip(start, g.dx, g.dy, area) : resizePip(start, g.edge, g.dx, g.dy, area))
      if (g.phase === 'end') {
        gesture = null
        deps.save(win.getBounds())
      }
    }
  }
}
