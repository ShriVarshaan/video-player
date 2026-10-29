import { describe, expect, it } from 'vitest'
import { Camera } from '../../src/renderer/src/wall/camera'
import { decay, springStep, VelocityTracker } from '../../src/renderer/src/wall/physics'

describe('springStep', () => {
  it('settles on the target within 1 s without overshooting', () => {
    let s = { pos: 0, vel: 0 }
    let max = 0
    for (let t = 0; t < 1000; t += 16.67) {
      s = springStep(s.pos, s.vel, 100, 16.67)
      max = Math.max(max, s.pos)
    }
    expect(Math.abs(s.pos - 100)).toBeLessThan(1)
    expect(max).toBeLessThanOrEqual(100.5)
  })
})

describe('decay', () => {
  it('loses 6 % per 60 Hz frame', () => {
    expect(decay(100, 16.67)).toBeCloseTo(94, 5)
  })
})

describe('VelocityTracker', () => {
  it('measures px/s over the last 100 ms only', () => {
    const v = new VelocityTracker()
    v.add(0, 0, 0)
    v.add(1000, 0, 50) // stale: a fast flick long before release
    v.add(1000, 0, 400)
    v.add(1050, 20, 450)
    expect(v.velocity(450)).toEqual({ x: 1000, y: 400 })
  })
})

describe('Camera glide', () => {
  const glide = (dt: number) => {
    const cam = new Camera()
    cam.release(1000, 0)
    let now = 0
    while (cam.step(dt, (now += dt), false) && now < 10_000);
    return { x: cam.x, mode: cam.mode }
  }

  it('travels the same distance at 30, 60 and 144 Hz', () => {
    const at60 = glide(1000 / 60).x
    expect(at60).toBeGreaterThan(200)
    for (const hz of [30, 144]) expect(Math.abs(glide(1000 / hz).x - at60) / at60).toBeLessThan(0.01)
  })

  it('stops and goes idle once slower than 5 px/s', () => {
    expect(glide(1000 / 60).mode).toBe('idle')
  })
})

describe('Camera drift', () => {
  it('starts after 8 s without input and stops on input', () => {
    const cam = new Camera()
    cam.input(0)
    expect(cam.step(16, 7_990, false)).toBe(false)
    expect(cam.x).toBe(0)
    expect(cam.step(1000, 9_000, false)).toBe(true)
    expect(cam.mode).toBe('drift')
    expect(cam.x).toBeCloseTo(10 / Math.SQRT2, 3)
    expect(cam.y).toBeCloseTo(10 / Math.SQRT2, 3)
    cam.input(9_001)
    expect(cam.mode).toBe('idle')
    const x = cam.x
    cam.step(16, 9_017, false)
    expect(cam.x).toBe(x)
  })

  it('never drifts under reduced motion', () => {
    const cam = new Camera()
    cam.input(0)
    expect(cam.step(16, 60_000, true)).toBe(false)
    expect(cam.x).toBe(0)
  })
})

describe('Camera input', () => {
  it('drags by exactly the pointer delta', () => {
    const cam = new Camera()
    cam.release(500, 0)
    cam.dragBy(-30, 12)
    expect(cam.mode).toBe('drag')
    expect([cam.x, cam.y]).toEqual([-30, 12])
  })

  it('springs to a target', () => {
    const cam = new Camera()
    cam.springTo(300, -200)
    let now = 0
    while (cam.step(16.67, (now += 16.67), false) && now < 3000);
    expect(cam.mode).toBe('idle')
    expect([cam.x, cam.y]).toEqual([300, -200])
  })

  it('pans directly and cancels a glide', () => {
    const cam = new Camera()
    cam.release(800, 0)
    cam.panBy(5, 40)
    expect(cam.mode).toBe('idle')
    expect([cam.x, cam.y]).toEqual([5, 40])
  })
})
