import { fnv1a32 } from '@shared/hash'
import type { WallItem } from '@shared/library'
import { Camera } from './camera'
import { assignSlots, poolSize, tileSize, visibleRange, type Cell, type Range, type TileSize } from './geometry'
import { chooseStride, itemIndex, nearestCell } from './mapping'
import { VelocityTracker } from './physics'

export type WallCallbacks = {
  onFocus: (item: WallItem | null) => void
  onActivate: (item: WallItem) => void // Space / i: show the info card now
  onOpen: (item: WallItem) => void // Enter / click: open the title page
  onSearch: () => void
}

type Slot = {
  el: HTMLDivElement
  img: HTMLImageElement
  title: HTMLSpanElement
  bar: HTMLElement
  cell: Cell | null
  key: string | null
  poster: string | null
  token: number
}

const DRAG_THRESHOLD = 6 // px before a press becomes a drag
const HOVER_REST = 80 // ms the pointer rests before hover moves focus
const REPEAT_DELAY = 250 // ms a held arrow waits before repeating
const REPEAT_MIN = 6 // tiles/s when repeating starts…
const REPEAT_MAX = 12 // …accelerating to this over REPEAT_RAMP ms
const REPEAT_RAMP = 1000
const DRIFT_AFTER = 8000
// Focus may sit anywhere in this part of the viewport before the camera follows.
// Kept above the bottom so the info card never covers the focused tile.
const SAFE = { left: 0.2, right: 0.8, top: 0.15, bottom: 0.62 }

const ARROWS: Record<string, Cell> = {
  ArrowLeft: { col: -1, row: 0 },
  ArrowRight: { col: 1, row: 0 },
  ArrowUp: { col: 0, row: -1 },
  ArrowDown: { col: 0, row: 1 }
}

const sameCell = (a: Cell | null, b: Cell | null) => !!a && !!b && a.col === b.col && a.row === b.row
const sameRange = (a: Range | null, b: Range) => !!a && a.c0 === b.c0 && a.c1 === b.c1 && a.r0 === b.r0 && a.r1 === b.r1

// The poster wall's imperative core: a recycled pool of tile nodes moved by one
// transform per frame. React renders the shell around it and hears about focus.
export class WallEngine {
  private camera = new Camera()
  private tracker = new VelocityTracker()
  private items: WallItem[] = []
  private stride = 1
  private slots: Slot[] = []
  private range: Range | null = null
  private size: TileSize = tileSize(1280)
  private vw = 0
  private vh = 0
  private focus: Cell = { col: 0, row: 0 }
  private active = false
  private raf = 0
  private last = 0
  private driftTimer = 0
  private hoverTimer = 0
  private held: { dir: Cell; key: string; start: number; next: number } | null = null
  private press: { id: number; x: number; y: number; dragging: boolean } | null = null
  private reducedMotion: MediaQueryList
  private observer: ResizeObserver

  constructor(
    private root: HTMLElement,
    private plane: HTMLElement,
    private cb: WallCallbacks
  ) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.observer = new ResizeObserver(([entry]) => {
      if (entry) this.resize(entry.contentRect.width, entry.contentRect.height)
    })
    this.observer.observe(root)
    root.addEventListener('pointerdown', this.onPointerDown)
    root.addEventListener('pointermove', this.onPointerMove)
    root.addEventListener('pointerup', this.onPointerUp)
    root.addEventListener('pointercancel', this.onPointerUp)
    root.addEventListener('wheel', this.onWheel, { passive: true })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onKeyUp)
  }

  destroy(): void {
    this.setActive(false)
    this.observer.disconnect()
    this.root.removeEventListener('pointerdown', this.onPointerDown)
    this.root.removeEventListener('pointermove', this.onPointerMove)
    this.root.removeEventListener('pointerup', this.onPointerUp)
    this.root.removeEventListener('pointercancel', this.onPointerUp)
    this.root.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onKeyUp)
  }

  setActive(active: boolean): void {
    // Refetches re-send the same value; re-running would cancel a held key and drift.
    if (active === this.active) return
    this.active = active
    this.held = null
    if (active) {
      this.camera.input(performance.now())
      this.kick()
    } else {
      cancelAnimationFrame(this.raf)
      this.raf = 0
      this.last = 0
      clearTimeout(this.driftTimer)
      clearTimeout(this.hoverTimer)
      if (this.camera.mode !== 'idle') this.camera.stop()
    }
  }

  setItems(items: WallItem[]): void {
    const keep = this.focusedItem()?.key
    const focusVisible = this.vw > 0 && this.cellOnScreen(this.focus)
    this.items = items
    this.stride = chooseStride(items.length)
    for (const slot of this.slots) this.fill(slot)
    // n changed, so every cell may show something else: follow the focused title.
    const index = keep ? items.findIndex((i) => i.key === keep) : -1
    if (index >= 0 && this.focusedItem()?.key !== keep) {
      const near = nearestCell(index, this.focus, items.length, this.stride)
      this.setFocus(near)
      // Only chase it if the user was looking at it; a wall panned or drifted
      // away keeps its camera (the next arrow starts from the centre).
      if (focusVisible) this.follow(near)
    }
    this.markFocus()
    this.cb.onFocus(this.focusedItem())
  }

  // ---- layout ----

  private resize(vw: number, vh: number): void {
    if (vw === 0 || vh === 0) return // hidden while another page is shown
    const first = this.vw === 0
    const focusVisible = !first && this.cellOnScreen(this.focus)
    const old = { size: this.size, vw: this.vw, vh: this.vh }
    this.vw = vw
    this.vh = vh
    this.size = tileSize(vw)
    this.plane.style.setProperty('--tile-w', `${this.size.w}px`)
    this.plane.style.setProperty('--tile-h', `${this.size.h}px`)
    if (first) {
      // Start with tile (0, 0) centred.
      this.camera.x = this.size.w / 2 - vw / 2
      this.camera.y = this.size.h / 2 - vh * 0.38
    } else {
      // Keep the old centre of the screen at the new centre, scaled with the tiles.
      this.camera.x = ((this.camera.x + old.vw / 2) * this.size.pitchX) / old.size.pitchX - vw / 2
      this.camera.y = ((this.camera.y + old.vh / 2) * this.size.pitchY) / old.size.pitchY - vh / 2
      this.camera.stop()
    }
    const count = poolSize(vw, vh, this.size)
    while (this.slots.length < count) this.slots.push(this.makeSlot())
    while (this.slots.length > count) this.slots.pop()!.el.remove()
    this.range = null
    for (const slot of this.slots) slot.cell = null
    this.render()
    this.markFocus()
    if (focusVisible && this.items.length > 0) this.follow(this.focus)
  }

  private makeSlot(): Slot {
    const el = document.createElement('div')
    el.className = 'tile'
    el.dataset.testid = 'wall-tile'
    el.hidden = true
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    const title = document.createElement('span')
    title.className = 'tile-title'
    const bar = document.createElement('i')
    bar.className = 'tile-progress'
    el.append(img, title, bar)
    this.plane.append(el)
    return { el, img, title, bar, cell: null, key: null, poster: null, token: 0 }
  }

  private render(): void {
    const { x, y } = this.camera
    this.plane.style.transform = `translate3d(${-x}px, ${-y}px, 0)`
    const range = visibleRange(this.camera, this.vw, this.vh, this.size)
    if (sameRange(this.range, range)) return
    this.range = range
    const prev = new Map<number, Cell>()
    this.slots.forEach((s, i) => s.cell && prev.set(i, s.cell))
    const { assign, changed } = assignSlots(prev, range, this.slots.length)
    this.slots.forEach((s, i) => {
      if (!assign.has(i)) {
        s.cell = null
        s.el.hidden = true
      }
    })
    for (const i of changed) {
      const slot = this.slots[i]!
      slot.cell = assign.get(i)!
      slot.el.style.transform = `translate3d(${slot.cell.col * this.size.pitchX}px, ${slot.cell.row * this.size.pitchY}px, 0)`
      slot.el.dataset.focused = String(sameCell(slot.cell, this.focus))
      this.fill(slot)
    }
  }

  // Shows the cell's title in a slot. Until the new poster has decoded off-screen
  // the slot shows its title's colour (never another title's poster, never blank);
  // a load that finishes after the slot moved on is dropped.
  private fill(slot: Slot): void {
    const item = this.itemAt(slot.cell)
    slot.el.hidden = !item
    if (!item) return
    slot.el.style.setProperty('--progress', item.progress === null ? '0' : String(item.progress))
    slot.el.classList.toggle('has-progress', item.progress !== null)
    if (slot.key === item.key && slot.poster === item.posterUrl) return
    const token = ++slot.token
    slot.key = item.key
    slot.poster = item.posterUrl
    slot.el.dataset.key = item.key
    slot.el.dataset.title = item.title
    slot.el.dataset.poster = item.posterUrl
    slot.el.style.setProperty('--hue', String(fnv1a32(item.key) % 360))
    slot.title.textContent = item.title
    slot.el.classList.remove('generated')
    slot.el.classList.add('loading')
    const img = new Image()
    img.alt = ''
    img.draggable = false
    img.src = item.posterUrl
    img.decode().then(
      () => {
        if (slot.token !== token) return
        slot.img.replaceWith(img)
        slot.img = img
        slot.el.classList.remove('loading')
      },
      () => {
        if (slot.token !== token) return
        slot.el.classList.remove('loading')
        slot.el.classList.add('generated')
      }
    )
  }

  private itemAt(cell: Cell | null): WallItem | null {
    if (!cell || this.items.length === 0) return null
    return this.items[itemIndex(cell.col, cell.row, this.items.length, this.stride)] ?? null
  }

  private focusedItem(): WallItem | null {
    return this.itemAt(this.focus)
  }

  // ---- focus ----

  private setFocus(cell: Cell): void {
    if (sameCell(cell, this.focus)) return
    this.focus = cell
    this.markFocus()
    this.cb.onFocus(this.focusedItem())
  }

  private markFocus(): void {
    this.root.classList.toggle('has-focus', this.items.length > 0)
    for (const s of this.slots) s.el.dataset.focused = String(sameCell(s.cell, this.focus))
  }

  // Judged against where the camera is heading, so fast key presses mid-spring
  // keep moving from the focused tile instead of snapping back to the centre.
  private cellOnScreen(cell: Cell): boolean {
    const { pitchX, pitchY, w, h } = this.size
    const cam = this.camera.target
    const x = cell.col * pitchX - cam.x
    const y = cell.row * pitchY - cam.y
    return x + w > 0 && x < this.vw && y + h > 0 && y < this.vh
  }

  private cellAtPoint(px: number, py: number): Cell | null {
    const { pitchX, pitchY, w, h } = this.size
    const wx = this.camera.x + px
    const wy = this.camera.y + py
    const col = Math.floor(wx / pitchX)
    const row = Math.floor(wy / pitchY)
    return wx - col * pitchX <= w && wy - row * pitchY <= h ? { col, row } : null
  }

  private cellNearestCentre(): Cell {
    const { pitchX, pitchY, w, h } = this.size
    return {
      col: Math.round((this.camera.x + this.vw / 2 - w / 2) / pitchX),
      row: Math.round((this.camera.y + this.vh * 0.38 - h / 2) / pitchY)
    }
  }

  private moveFocus(dir: Cell): void {
    // After drift or a drag the focused tile may be off screen: start from the middle.
    const from = this.cellOnScreen(this.focus) ? this.focus : this.cellNearestCentre()
    const cell = { col: from.col + dir.col, row: from.row + dir.row }
    this.setFocus(cell)
    this.follow(cell)
  }

  // Springs the camera only when the focused tile leaves the safe part of the viewport.
  private follow(cell: Cell): void {
    const { pitchX, pitchY, w, h } = this.size
    const base = this.camera.target
    const x0 = cell.col * pitchX
    const y0 = cell.row * pitchY
    let tx = base.x
    let ty = base.y
    if (x0 < base.x + this.vw * SAFE.left) tx = x0 - this.vw * SAFE.left
    else if (x0 + w > base.x + this.vw * SAFE.right) tx = x0 + w - this.vw * SAFE.right
    if (y0 < base.y + this.vh * SAFE.top) ty = y0 - this.vh * SAFE.top
    else if (y0 + h > base.y + this.vh * SAFE.bottom) ty = y0 + h - this.vh * SAFE.bottom
    if (tx !== base.x || ty !== base.y || this.camera.mode === 'spring') {
      this.camera.springTo(tx, ty)
      this.kick()
    }
  }

  // ---- loop ----

  private kick(): void {
    if (this.raf || !this.active || this.vw === 0) return
    clearTimeout(this.driftTimer)
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number): void => {
    this.raf = 0
    const dt = this.last ? Math.min(50, now - this.last) : 16.67
    this.last = now
    this.repeatHeld(now)
    const moving = this.camera.step(dt, now, this.reducedMotion.matches)
    this.render()
    if (moving || this.held) this.kick()
    else {
      this.last = 0
      this.scheduleDrift()
    }
  }

  private scheduleDrift(): void {
    if (this.reducedMotion.matches || !this.active || this.items.length === 0) return
    clearTimeout(this.driftTimer)
    this.driftTimer = window.setTimeout(() => this.kick(), DRIFT_AFTER + 16)
  }

  private input(): void {
    this.camera.input(performance.now())
  }

  private repeatHeld(now: number): void {
    if (!this.held || now < this.held.next) return
    const t = Math.min(1, (now - this.held.start - REPEAT_DELAY) / REPEAT_RAMP)
    const rate = REPEAT_MIN + (REPEAT_MAX - REPEAT_MIN) * Math.max(0, t)
    this.held.next = now + 1000 / rate
    this.moveFocus(this.held.dir)
  }

  // ---- input ----

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active || this.items.length === 0 || e.defaultPrevented) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"], nav')) return
    const onOtherButton = target.tagName === 'BUTTON'
    this.input()

    const dir = ARROWS[e.key]
    if (dir) {
      e.preventDefault()
      if (e.repeat) return
      const now = performance.now()
      this.held = { dir, key: e.key, start: now, next: now + REPEAT_DELAY }
      this.moveFocus(dir)
      this.kick()
      return
    }
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'i') && !onOtherButton) {
      if (e.repeat) return e.preventDefault()
      const item = this.focusedItem()
      if (item) {
        e.preventDefault()
        if (e.key === 'Enter') this.cb.onOpen(item)
        else this.cb.onActivate(item)
      }
      return
    }
    const typing = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)
    if (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'f') || typing) {
      e.preventDefault()
      this.cb.onSearch()
    }
  }

  private onKeyUp = (e: Event): void => {
    if (!(e instanceof KeyboardEvent) || e.key === this.held?.key) this.held = null
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.active || e.button !== 0) return
    // The info card's buttons sit over the tiles; their clicks are theirs alone.
    if ((e.target as Element | null)?.closest?.('button, a, input')) return
    this.input()
    this.root.focus({ preventScroll: true })
    this.root.setPointerCapture(e.pointerId)
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false }
    this.tracker.reset()
    this.tracker.add(e.clientX, e.clientY, e.timeStamp)
    if (this.camera.mode === 'glide' || this.camera.mode === 'spring' || this.camera.mode === 'drift') this.camera.stop()
  }

  private overCard(x: number, y: number): boolean {
    const card = this.root.querySelector('.info-card.shown')
    if (!card) return false
    const r = card.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.active) return
    this.input()
    const p = this.press
    if (p && p.id === e.pointerId) {
      if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return
      p.dragging = true
      this.camera.dragBy(p.x - e.clientX, p.y - e.clientY)
      p.x = e.clientX
      p.y = e.clientY
      this.tracker.add(e.clientX, e.clientY, e.timeStamp)
      this.kick()
      return
    }
    clearTimeout(this.hoverTimer)
    const { clientX, clientY } = e
    // Over the info card the pointer is reaching for its buttons, not the tile behind.
    if (this.overCard(clientX, clientY)) return
    this.hoverTimer = window.setTimeout(() => {
      if (this.camera.mode === 'glide' || this.camera.mode === 'drag' || this.camera.mode === 'spring') return
      const cell = this.cellAtPoint(clientX, clientY)
      if (cell) this.setFocus(cell)
    }, HOVER_REST)
  }

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.press
    if (!p || p.id !== e.pointerId) return
    this.press = null
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId)
    if (!this.active) return
    if (p.dragging) {
      const v = this.tracker.velocity(e.timeStamp)
      this.camera.release(-v.x, -v.y)
      this.kick()
      return
    }
    const cell = e.type === 'pointerup' ? this.cellAtPoint(e.clientX, e.clientY) : null
    if (!cell) return
    this.setFocus(cell)
    const item = this.focusedItem()
    if (item) this.cb.onOpen(item)
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.active) return
    this.input()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1
    let dx = e.deltaX * unit
    let dy = e.deltaY * unit
    if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0]
    this.camera.panBy(dx, dy)
    this.kick()
  }
}
