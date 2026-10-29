import { decay, glideDistance, springStep } from './physics'

export type CameraMode = 'idle' | 'spring' | 'glide' | 'drag' | 'drift'

const STOP_SPEED = 5 // px/s
const SETTLE = 0.5 // px
const DRIFT_AFTER = 8000 // ms without input
const DRIFT_SPEED = 10 / Math.SQRT2 // px/s on each axis: 10 px/s diagonally

// The wall's viewpoint in world pixels. Pure: the rAF loop calls step() and
// copies x/y into a transform; nothing here touches the DOM.
export class Camera {
  x = 0
  y = 0
  mode: CameraMode = 'idle'
  private vx = 0
  private vy = 0
  private tx = 0
  private ty = 0
  private lastInput = 0

  springTo(x: number, y: number): void {
    if (this.mode !== 'spring') this.vx = this.vy = 0
    this.tx = x
    this.ty = y
    this.mode = 'spring'
  }

  dragBy(dx: number, dy: number): void {
    this.mode = 'drag'
    this.vx = this.vy = 0
    this.x += dx
    this.y += dy
  }

  release(vx: number, vy: number): void {
    this.vx = vx
    this.vy = vy
    this.mode = Math.hypot(vx, vy) < STOP_SPEED ? 'idle' : 'glide'
  }

  panBy(dx: number, dy: number): void {
    this.stop()
    this.x += dx
    this.y += dy
  }

  stop(): void {
    this.mode = 'idle'
    this.vx = this.vy = 0
  }

  input(now: number): void {
    this.lastInput = now
    if (this.mode === 'drift') this.stop()
  }

  get target(): { x: number; y: number } {
    return this.mode === 'spring' ? { x: this.tx, y: this.ty } : { x: this.x, y: this.y }
  }

  // Advances dt ms. Returns true while the camera is still moving.
  step(dt: number, now: number, reducedMotion: boolean): boolean {
    switch (this.mode) {
      case 'spring': {
        const sx = springStep(this.x, this.vx, this.tx, dt)
        const sy = springStep(this.y, this.vy, this.ty, dt)
        ;[this.x, this.vx, this.y, this.vy] = [sx.pos, sx.vel, sy.pos, sy.vel]
        const settled =
          Math.abs(this.tx - this.x) < SETTLE && Math.abs(this.ty - this.y) < SETTLE && Math.hypot(this.vx, this.vy) < STOP_SPEED
        if (settled) {
          this.x = this.tx
          this.y = this.ty
          this.stop()
        }
        return !settled
      }
      case 'glide': {
        this.x += glideDistance(this.vx, dt)
        this.y += glideDistance(this.vy, dt)
        this.vx = decay(this.vx, dt)
        this.vy = decay(this.vy, dt)
        if (Math.hypot(this.vx, this.vy) < STOP_SPEED) {
          this.stop()
          return false
        }
        return true
      }
      case 'drag':
        return false
      case 'idle':
        if (reducedMotion || now - this.lastInput < DRIFT_AFTER) return false
        this.mode = 'drift'
      // falls through
      case 'drift':
        if (reducedMotion) {
          this.stop()
          return false
        }
        this.x += (DRIFT_SPEED * dt) / 1000
        this.y += (DRIFT_SPEED * dt) / 1000
        return true
    }
  }
}
