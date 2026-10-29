// Frame-rate-independent motion maths for the wall camera. Times are in ms.

const STIFFNESS = 170
const DAMPING = 26 // about critical (2·√170 ≈ 26.08), so no visible overshoot
const MAX_SUBSTEP = 8
const FRICTION = 0.94 // velocity kept per 60 Hz frame while gliding
const FRAME = 16.67
const DECAY_RATE = -Math.log(FRICTION) / FRAME // per ms

export function springStep(pos: number, vel: number, target: number, dt: number): { pos: number; vel: number } {
  const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP))
  const h = dt / steps / 1000
  for (let i = 0; i < steps; i++) {
    vel += (STIFFNESS * (target - pos) - DAMPING * vel) * h
    pos += vel * h
  }
  return { pos, vel }
}

export const decay = (v: number, dt: number): number => v * Math.pow(FRICTION, dt / FRAME)

// Exact distance covered while v decays over dt, so a glide goes as far at 30 Hz as at 144 Hz.
export const glideDistance = (v: number, dt: number): number => ((v - decay(v, dt)) / DECAY_RATE) / 1000

const WINDOW = 100

export class VelocityTracker {
  private samples: { x: number; y: number; t: number }[] = []

  add(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t })
    while (this.samples.length > 2 && t - this.samples[0]!.t > WINDOW) this.samples.shift()
  }

  // px/s between the oldest and newest sample in the last 100 ms.
  velocity(now: number): { x: number; y: number } {
    const recent = this.samples.filter((s) => now - s.t <= WINDOW)
    const a = recent[0]
    const b = recent[recent.length - 1]
    if (!a || !b || b.t === a.t) return { x: 0, y: 0 }
    const dt = (b.t - a.t) / 1000
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
  }

  reset(): void {
    this.samples = []
  }
}
