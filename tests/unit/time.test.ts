import { describe, expect, it } from 'vitest'
import { endsAt, formatTime, timeLeft } from '@shared/time'

describe('endsAt', () => {
  const now = new Date(2026, 10, 4, 22, 0).getTime()

  it('uses a 12-hour clock with an ordinary space', () => {
    expect(endsAt(5400, now, true, 'en-US')).toBe('Ends at 11:30 PM')
  })
  it('uses a 24-hour clock', () => {
    expect(endsAt(5400, now, false, 'en-US')).toBe('Ends at 23:30')
  })
  it('writes just past midnight as 00, not 24', () => {
    expect(endsAt(7500, now, false, 'en-US')).toBe('Ends at 00:05')
  })
  it("follows the locale when Windows' setting is unknown", () => {
    expect(endsAt(5400, now, null, 'en-GB')).toBe('Ends at 23:30')
  })
})

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
