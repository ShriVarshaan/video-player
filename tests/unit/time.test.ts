import { describe, expect, it } from 'vitest'
import { formatTime, timeLeft } from '@shared/time'

describe('formatTime', () => {
  it('formats minutes and seconds, and hours when there are any', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(7.9)).toBe('0:07')
    expect(formatTime(19 * 60 + 42)).toBe('19:42')
    expect(formatTime(3600 + 2 * 60 + 5)).toBe('1:02:05')
  })
  it('treats bad input as zero', () => {
    expect(formatTime(-3)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})

describe('timeLeft', () => {
  it('says how long is left in hours and minutes', () => {
    expect(timeLeft(72 * 60)).toBe('1 h 12 min left')
    expect(timeLeft(21 * 60 + 20)).toBe('21 min left')
    expect(timeLeft(2 * 3600)).toBe('2 h left')
    expect(timeLeft(30)).toBe('1 min left')
  })
})
