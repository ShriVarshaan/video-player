import { describe, expect, it } from 'vitest'
import { REACTION_LEAD_S, clampOffset, firstCueAfter, formatOffset, offsetForCue } from '@shared/subtitleTiming'

describe('clampOffset', () => {
  it('caps at ±600 s', () => {
    expect(clampOffset(700)).toBe(600)
    expect(clampOffset(-700)).toBe(-600)
  })
  it('rounds to the millisecond', () => {
    expect(clampOffset(-0.12349)).toBe(-0.123)
    expect(clampOffset(0.1 + 0.2)).toBe(0.3)
  })
})

describe('offsetForCue', () => {
  it('lines the cue up with the position, less the reaction lead', () => {
    expect(offsetForCue(5, 9)).toBeCloseTo(4 - REACTION_LEAD_S)
  })
})

describe('firstCueAfter', () => {
  it('is the first cue still to come with the current offset', () => {
    expect(firstCueAfter([1, 5], 0, 0.5)).toBe(0)
    expect(firstCueAfter([1, 5], 0, 1.5)).toBe(1)
    expect(firstCueAfter([1, 5], 2, 2.5)).toBe(0)
  })
  it('falls back to the last cue, or -1 with none', () => {
    expect(firstCueAfter([1, 5], 0, 30)).toBe(1)
    expect(firstCueAfter([], 0, 0)).toBe(-1)
  })
})

describe('formatOffset', () => {
  it('signs and rounds to two decimals', () => {
    expect(formatOffset(0.35)).toBe('+0.35 s')
    expect(formatOffset(-1.5)).toBe('−1.50 s')
    expect(formatOffset(2)).toBe('+2.00 s')
  })
  it('says in sync at zero', () => {
    expect(formatOffset(0)).toBe('in sync')
    expect(formatOffset(-0.0001)).toBe('in sync')
  })
})
