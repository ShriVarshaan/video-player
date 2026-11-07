import { describe, expect, it } from 'vitest'
import { DEFAULT_STYLE, PRESETS } from '@shared/subtitleStyle'
import { aspectLabelFont, styleToCss, subtitleArea, subtitleBottom } from '../../src/renderer/overlay/subtitleLayout'

describe('subtitleArea', () => {
  it('is the whole window at the file’s own ratio', () => {
    expect(subtitleArea(null, 1000)).toEqual({ h: 1000, bottom: 0, left: '10%', right: '10%' })
  })

  it('follows a letterboxed picture', () => {
    expect(subtitleArea({ left: 0, right: 0, top: 0.1, bottom: 0.2 }, 1000)).toEqual({ h: 700, bottom: 200, left: '10%', right: '10%' })
  })

  it('keeps the text 10 % inside a pillarboxed picture', () => {
    const a = subtitleArea({ left: 0.25, right: 0.25, top: 0, bottom: 0 }, 1000)
    expect(a).toEqual({ h: 1000, bottom: 0, left: '30%', right: '30%' })
  })
})

describe('aspectLabelFont', () => {
  it('uses the subtitle font while subtitles are on', () => {
    expect(aspectLabelFont({ ...DEFAULT_STYLE, font: 'georgia' }, true)).toEqual({ fontFamily: 'Georgia, serif', fontVariant: 'normal' })
    expect(aspectLabelFont({ ...DEFAULT_STYLE, font: 'smallCaps' }, true).fontVariant).toBe('small-caps')
  })

  it('uses the default subtitle font while they are off', () => {
    expect(aspectLabelFont({ ...DEFAULT_STYLE, font: 'georgia' }, false)).toEqual(aspectLabelFont(DEFAULT_STYLE, true))
  })
})

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

  it('measures inside the picture when given one', () => {
    const area = { h: 500, bottom: 250 }
    expect(at(0, { area })).toBe(270) // 250 up to the picture, then its 4 % margin
    expect(at(100, { area })).toBe(630) // block top on the picture's top margin
    expect(at(0, { area, top: true })).toBe(630)
  })

  it('still clears the controls, which are measured from the window', () => {
    const area = { h: 500, bottom: 50 }
    expect(at(0, { area, controlsTop: 880 })).toBe(128)
    expect(at(0, { area: { h: 500, bottom: 250 }, controlsTop: 880 })).toBe(270)
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
