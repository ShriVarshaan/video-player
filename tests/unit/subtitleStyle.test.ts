import { describe, expect, it } from 'vitest'
import { DEFAULT_STYLE, PRESETS, effectiveStyle, presetOf, sanitizeStyle } from '@shared/subtitleStyle'

describe('presets', () => {
  it('Default style is the Default preset at the bottom', () => {
    expect(DEFAULT_STYLE).toEqual({ ...PRESETS.default, position: 0 })
    expect(PRESETS.default).toMatchObject({ font: 'default', size: 100, textColor: '#ffffff', textOpacity: 100, edge: 'dropShadow', backgroundOpacity: 0, windowOpacity: 0 })
  })

  it('defines Large Text, Classic and Outline Text', () => {
    expect(PRESETS.largeText).toEqual({ ...PRESETS.default, size: 150 })
    expect(PRESETS.classic).toMatchObject({ font: 'consolas', edge: 'none', backgroundColor: '#000000', backgroundOpacity: 100 })
    expect(PRESETS.outline).toMatchObject({ font: 'default', edge: 'outline', backgroundOpacity: 0 })
  })

  it('recognises a preset whatever the position, and calls anything else custom', () => {
    expect(presetOf({ ...PRESETS.largeText, position: 40 })).toBe('largeText')
    expect(presetOf({ ...PRESETS.largeText, size: 120, position: 0 })).toBe('custom')
  })
})

describe('effectiveStyle', () => {
  it('lays a title’s changed fields over the global style', () => {
    const global = { ...DEFAULT_STYLE, font: 'georgia' as const }
    expect(effectiveStyle(global, { size: 150 })).toEqual({ ...global, size: 150 })
  })
})

describe('sanitizeStyle', () => {
  it('clamps numbers and replaces unknown values with the defaults', () => {
    const s = sanitizeStyle({ size: 900, font: 'comic', textColor: 'red', position: -5, edge: 'outline' })
    expect(s).toEqual({ ...DEFAULT_STYLE, size: 200, edge: 'outline' })
  })
  it('turns anything that is not an object into the default style', () => {
    expect(sanitizeStyle(null)).toEqual(DEFAULT_STYLE)
    expect(sanitizeStyle('x')).toEqual(DEFAULT_STYLE)
  })
})
