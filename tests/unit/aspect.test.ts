import { describe, expect, it } from 'vitest'
import { ASPECT_RATIOS, aspectLabel, nextAspect, pictureInsets } from '@shared/aspect'

describe('nextAspect', () => {
  it('goes through the ratios in VLC order, from the original and back to it', () => {
    const seen: (string | null)[] = []
    let at: (typeof ASPECT_RATIOS)[number] | null = null
    do {
      at = nextAspect(at)
      seen.push(at)
    } while (at !== null)
    expect(seen).toEqual(['16:9', '4:3', '1:1', '16:10', '2.21:1', '2.35:1', '2.39:1', '5:4', null])
  })
})

describe('aspectLabel', () => {
  it('names a chosen ratio as it is', () => {
    expect(aspectLabel('2.35:1', 1.78)).toBe('2.35:1')
  })

  it('names the file’s own ratio by its usual name', () => {
    expect(aspectLabel(null, 16 / 9)).toBe('Default (16:9)')
    expect(aspectLabel(null, 4 / 3)).toBe('Default (4:3)')
  })

  it('gives any other ratio as a number to one', () => {
    expect(aspectLabel(null, 2.388889)).toBe('Default (2.39:1)')
  })

  it('says only Default until the file’s ratio is known', () => {
    expect(aspectLabel(null, null)).toBe('Default')
  })
})

describe('pictureInsets', () => {
  it('gives mpv’s margins as shares of the window, so they survive display scaling', () => {
    expect(pictureInsets({ w: 1280, h: 720, ml: 160, mr: 160, mt: 0, mb: 0 })).toEqual({ left: 0.125, right: 0.125, top: 0, bottom: 0 })
    expect(pictureInsets({ w: 1000, h: 1000, ml: 0, mr: 0, mt: 100, mb: 250 })).toEqual({ left: 0, right: 0, top: 0.1, bottom: 0.25 })
  })

  it('is null for anything mpv reports before a window exists', () => {
    expect(pictureInsets(null)).toBeNull()
    expect(pictureInsets({ w: 0, h: 0, ml: 0, mr: 0, mt: 0, mb: 0 })).toBeNull()
    expect(pictureInsets({ w: 1280 })).toBeNull()
  })
})
