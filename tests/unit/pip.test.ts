import { describe, expect, it } from 'vitest'
import { defaultPipBounds, movePip, pipBounds, resizePip } from '../../src/main/player/pip'

const WA = { x: 0, y: 0, width: 1920, height: 1040 }
const START = { x: 1416, y: 746, width: 480, height: 270 }

describe('pip geometry', () => {
  it('defaultPipBounds sits bottom right, 24 px in', () => {
    expect(defaultPipBounds(WA)).toEqual(START)
    expect(defaultPipBounds({ x: 1920, y: 0, width: 2560, height: 1400 })).toEqual({ x: 3976, y: 1106, width: 480, height: 270 })
  })

  it('pipBounds keeps a saved spot that is wholly on a display', () => {
    const saved = { x: 100, y: 100, width: 640, height: 360 }
    expect(pipBounds(saved, [WA], WA)).toEqual(saved)
  })

  it('pipBounds falls back to the default corner when the saved spot is off every display or missing', () => {
    expect(pipBounds({ x: 2000, y: 100, width: 480, height: 270 }, [WA], WA)).toEqual(START)
    expect(pipBounds({ x: 1700, y: 100, width: 480, height: 270 }, [WA], WA)).toEqual(START)
    expect(pipBounds(null, [WA], WA)).toEqual(START)
  })

  it('movePip moves and clamps inside the work area', () => {
    expect(movePip(START, -100, -50, WA)).toEqual({ ...START, x: 1316, y: 696 })
    expect(movePip(START, 200, 100, WA)).toEqual({ ...START, x: 1440, y: 770 })
    expect(movePip(START, -5000, -5000, WA)).toEqual({ ...START, x: 0, y: 0 })
  })

  it('resizePip keeps 16:9 and anchors the opposite side', () => {
    expect(resizePip(START, 'se', 160, 0, WA)).toEqual({ x: 1416, y: 746, width: 640, height: 360 })
    expect(resizePip(START, 'nw', -160, 0, WA)).toEqual({ x: 1256, y: 656, width: 640, height: 360 })
    expect(resizePip(START, 'w', -100, 0, WA)).toEqual({ x: 1316, y: 746, width: 580, height: 326 })
    expect(resizePip(START, 'n', 0, -90, WA)).toEqual({ x: 1416, y: 656, width: 640, height: 360 })
    expect(resizePip(START, 'se', 0, 90, WA)).toEqual({ x: 1416, y: 746, width: 640, height: 360 })
  })

  it('resizePip stays between 320 wide and the work area width', () => {
    expect(resizePip(START, 'se', -400, 0, WA)).toEqual({ x: 1416, y: 746, width: 320, height: 180 })
    expect(resizePip(START, 'e', 9000, 0, WA).width).toBe(1920)
  })
})
