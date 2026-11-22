import { describe, expect, it, vi } from 'vitest'
import { createPipWindow, type PipDeps } from '../../src/main/player/pipWindow'
import type { Rect } from '../../src/main/player/pip'

const WA = { x: 0, y: 0, width: 1920, height: 1040 }
const NORMAL = { x: 200, y: 100, width: 1280, height: 800 }
const CORNER = { x: 1416, y: 746, width: 480, height: 270 }

function fake(opts: { maximized?: boolean; fullScreen?: boolean; saved?: Rect | null; holdFullScreen?: boolean } = {}) {
  const calls: string[] = []
  let bounds = { ...NORMAL }
  let maximized = opts.maximized ?? false
  let fullScreen = opts.fullScreen ?? false
  let releaseFullScreen: () => void = () => {}
  const saved: Rect[] = []
  const deps: PipDeps = {
    win: {
      getBounds: () => ({ ...bounds }),
      setBounds: (r) => {
        calls.push(`setBounds ${r.x},${r.y} ${r.width}x${r.height}`)
        bounds = { ...r }
      },
      isMaximized: () => maximized,
      maximize: () => {
        calls.push('maximize')
        maximized = true
      },
      unmaximize: () => {
        calls.push('unmaximize')
        maximized = false
      },
      isFullScreen: () => fullScreen,
      setFullScreen: (on) => {
        calls.push(`setFullScreen ${on}`)
        fullScreen = on
      },
      leftFullScreen: () =>
        opts.holdFullScreen ? new Promise<void>((r) => (releaseFullScreen = r)) : Promise.resolve(),
      setAlwaysOnTop: (on) => calls.push(`onTop ${on}`)
    },
    frame: { remove: () => calls.push('frame.remove'), restore: () => calls.push('frame.restore') },
    overlay: { setPip: (on) => calls.push(`overlay.setPip ${on}`) },
    workAreas: () => [WA],
    workAreaFor: () => WA,
    load: async () => opts.saved ?? null,
    save: (r) => void saved.push(r)
  }
  return { deps, calls, saved, bounds: () => bounds, maximized: () => maximized, fullScreen: () => fullScreen, release: () => releaseFullScreen() }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('PipWindow', () => {
  it('enter from a normal window: frameless, on top, default corner, overlay follows', async () => {
    const f = fake()
    const pip = createPipWindow(f.deps)
    await pip.enter()
    expect(pip.isOn()).toBe(true)
    expect(f.calls).toEqual(['frame.remove', 'onTop true', 'setBounds 1416,746 480x270', 'overlay.setPip true'])
  })

  it('restores maximized', async () => {
    const f = fake({ maximized: true })
    const pip = createPipWindow(f.deps)
    await pip.enter()
    expect(f.calls[0]).toBe('unmaximize')
    f.calls.length = 0
    await pip.exit()
    expect(f.calls).toEqual(['overlay.setPip false', 'onTop false', 'frame.restore', 'setBounds 200,100 1280x800', 'maximize'])
    expect(f.maximized()).toBe(true)
  })

  it('leaves full screen first and goes back to it', async () => {
    const f = fake({ fullScreen: true, holdFullScreen: true })
    const pip = createPipWindow(f.deps)
    const entering = pip.enter()
    await flush()
    expect(f.calls).toEqual(['setFullScreen false'])
    f.release()
    await entering
    expect(f.calls).toContain('setBounds 1416,746 480x270')
    await pip.exit()
    expect(f.calls.at(-1)).toBe('setFullScreen true')
  })

  it('uses the remembered spot', async () => {
    const f = fake({ saved: { x: 100, y: 100, width: 640, height: 360 } })
    const pip = createPipWindow(f.deps)
    await pip.enter()
    expect(f.calls).toContain('setBounds 100,100 640x360')
  })

  it('gestures move and resize from where they started, and save at the end', async () => {
    const f = fake()
    const pip = createPipWindow(f.deps)
    pip.gesture({ phase: 'move', edge: 'move', dx: 5, dy: 5 })
    await pip.enter()
    f.calls.length = 0
    pip.gesture({ phase: 'start', edge: 'move', dx: 0, dy: 0 })
    pip.gesture({ phase: 'move', edge: 'move', dx: -50, dy: -20 })
    pip.gesture({ phase: 'move', edge: 'move', dx: -100, dy: -50 })
    expect(f.bounds()).toEqual({ ...CORNER, x: 1316, y: 696 })
    pip.gesture({ phase: 'end', edge: 'move', dx: -100, dy: -50 })
    expect(f.saved.at(-1)).toEqual({ ...CORNER, x: 1316, y: 696 })
    pip.gesture({ phase: 'start', edge: 'se', dx: 0, dy: 0 })
    pip.gesture({ phase: 'move', edge: 'se', dx: 160, dy: 0 })
    expect(f.bounds()).toEqual({ x: 1316, y: 696, width: 640, height: 360 })
    pip.gesture({ phase: 'end', edge: 'se', dx: 160, dy: 0 })
    pip.gesture({ phase: 'move', edge: 'move', dx: 10, dy: 10 })
    expect(f.bounds()).toEqual({ x: 1316, y: 696, width: 640, height: 360 })
  })

  it('the end of a gesture only saves: the last move already placed the window', async () => {
    const f = fake()
    const pip = createPipWindow(f.deps)
    await pip.enter()
    pip.gesture({ phase: 'start', edge: 'nw', dx: 0, dy: 0 })
    pip.gesture({ phase: 'move', edge: 'nw', dx: -160, dy: -90 })
    pip.gesture({ phase: 'end', edge: 'nw', dx: -320, dy: -180 })
    expect(f.bounds()).toEqual({ x: 1256, y: 656, width: 640, height: 360 })
    expect(f.saved.at(-1)).toEqual({ x: 1256, y: 656, width: 640, height: 360 })
  })

  it('a move gesture before entering is ignored', () => {
    const f = fake()
    const pip = createPipWindow(f.deps)
    pip.gesture({ phase: 'start', edge: 'move', dx: 0, dy: 0 })
    pip.gesture({ phase: 'move', edge: 'move', dx: 5, dy: 5 })
    expect(f.calls).toEqual([])
  })

  it('exit saves the floating spot, comes off the top and restores; exit when off does nothing', async () => {
    const f = fake()
    const pip = createPipWindow(f.deps)
    await pip.exit()
    expect(f.calls).toEqual([])
    await pip.enter()
    await pip.exit()
    expect(pip.isOn()).toBe(false)
    expect(f.saved.at(-1)).toEqual(CORNER)
    expect(f.calls).toContain('onTop false')
    expect(f.bounds()).toEqual(NORMAL)
  })

  it('overlapping enter/exit are serialised', async () => {
    const f = fake({ fullScreen: true, holdFullScreen: true })
    const pip = createPipWindow(f.deps)
    const a = pip.enter()
    const b = pip.enter()
    const c = pip.exit()
    await flush()
    f.release()
    await Promise.all([a, b, c])
    expect(pip.isOn()).toBe(false)
    expect(f.calls.filter((c) => c === 'frame.remove')).toHaveLength(1)
    expect(f.calls.filter((c) => c === 'frame.restore')).toHaveLength(1)
    expect(f.bounds()).toEqual(NORMAL)
    expect(f.fullScreen()).toBe(true)
  })

  it('a failing step still leaves the chain usable', async () => {
    const f = fake()
    const load = vi.fn(async () => {
      throw new Error('db')
    })
    const pip = createPipWindow({ ...f.deps, load })
    await pip.enter()
    expect(f.calls).toContain('setBounds 1416,746 480x270')
  })
})
