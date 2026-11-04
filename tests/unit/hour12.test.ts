import { describe, expect, it } from 'vitest'
import { hour12FromPattern } from '../../src/main/hour12'

describe('hour12FromPattern', () => {
  it('reads a lowercase h as a 12-hour clock', () => {
    expect(hour12FromPattern('h:mm tt')).toBe(true)
    expect(hour12FromPattern('hh:mm tt')).toBe(true)
  })
  it('reads an uppercase H as a 24-hour clock', () => {
    expect(hour12FromPattern('HH:mm')).toBe(false)
    expect(hour12FromPattern('H:mm')).toBe(false)
  })
  it('is unknown without a pattern', () => {
    expect(hour12FromPattern('')).toBeNull()
    expect(hour12FromPattern(null)).toBeNull()
  })
})
