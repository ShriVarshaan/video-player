import { describe, expect, it } from 'vitest'
import { DEFAULT_STYLE, PRESETS } from '@shared/subtitleStyle'
import { styleToCss, subtitleBottom } from '../../src/renderer/overlay/subtitleLayout'

describe('subtitleBottom', () => {
  const at = (position: number, extra: Partial<Parameters<typeof subtitleBottom>[0]> = {}) =>
    subtitleBottom({ position, windowH: 1000, blockH: 100, controlsTop: null, top: false, ...extra })

  it('maps 0–100 from the bottom margin to the top margin', () => {
    expect(at(0)).toBe(40)
    expect(at(100)).toBe(860)
    expect(at(50)).toBe(450)
  })

  it('puts top-aligned cues at the top whatever the position', () => {
    expect(at(0, { top: true })).toBe(860)
  })

  it('lifts a low line above the controls while they show', () => {
    expect(at(0, { controlsTop: 880 })).toBe(128)
    expect(at(50, { controlsTop: 880 })).toBe(450)
    expect(at(0, { controlsTop: 880, top: true })).toBe(860)
  })
})

describe('styleToCss', () => {
  it('scales the size with the window height, never below 18 px', () => {
    expect(styleToCss({ ...DEFAULT_STYLE, size: 150 }, 1000).fontSize).toBe('67.5px')
    expect(styleToCss(DEFAULT_STYLE, 300).fontSize).toBe('18px')
  })

  it('applies colours with their opacity', () => {
    expect(styleToCss({ ...DEFAULT_STYLE, textOpacity: 50 }, 1000).color).toBe('rgba(255, 255, 255, 0.5)')
    expect(styleToCss({ ...PRESETS.classic, position: 0 }, 1000)['--sub-line-bg']).toBe('rgba(0, 0, 0, 1)')
    expect(styleToCss({ ...DEFAULT_STYLE, windowColor: '#0000ff', windowOpacity: 25 }, 1000)['--sub-window-bg']).toBe('rgba(0, 0, 255, 0.25)')
  })

  it('maps fonts and edges', () => {
    expect(styleToCss({ ...DEFAULT_STYLE, font: 'georgia' }, 1000).fontFamily).toBe('Georgia, serif')
    expect(styleToCss({ ...DEFAULT_STYLE, font: 'smallCaps' }, 1000).fontVariant).toBe('small-caps')
    expect(styleToCss({ ...DEFAULT_STYLE, edge: 'none' }, 1000).textShadow).toBe('none')
    expect(styleToCss({ ...DEFAULT_STYLE, edge: 'outline' }, 1000).textShadow).toContain('0.06em')
  })
})
