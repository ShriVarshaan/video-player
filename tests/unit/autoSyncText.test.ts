import { describe, expect, it } from 'vitest'
import { describeOutcome, describeSync } from '@shared/autoSync'

describe('describeSync', () => {
  it('says how far and which way', () => {
    expect(describeSync({ offset: 3.2, scale: 1 })).toBe('Synced · 3.2 s later')
    expect(describeSync({ offset: -1.44, scale: 1 })).toBe('Synced · 1.4 s earlier')
  })

  it('names a known framerate change', () => {
    expect(describeSync({ offset: 3.2, scale: 25 / 23.976 })).toBe('Synced · 3.2 s later, speed 25 → 23.976 fps')
    expect(describeSync({ offset: 0.01, scale: 23.976 / 25 })).toBe('Synced · speed 23.976 → 25 fps')
    expect(describeSync({ offset: 0, scale: 24 / 23.976 })).toBe('Synced · speed 24 → 23.976 fps')
  })

  it('an unknown scale is just "speed adjusted"', () => {
    expect(describeSync({ offset: 2, scale: 1.02 })).toBe('Synced · 2.0 s later, speed adjusted')
  })

  it('mentions the fallback folder', () => {
    expect(describeSync({ offset: 3.2, scale: 1, fallback: true })).toBe("Synced · 3.2 s later · saved in the app's folder")
  })
})

describe('describeOutcome', () => {
  it('words every finished outcome', () => {
    expect(describeOutcome({ status: 'synced', offset: -3.2, scale: 1, saved: 'M.en.synced.srt', fallback: false })).toBe('Synced · 3.2 s earlier')
    expect(describeOutcome({ status: 'inSync', clearedOffset: false })).toBe('Already in sync')
    expect(describeOutcome({ status: 'inSync', clearedOffset: true })).toBe('Already in sync · offset cleared')
    expect(describeOutcome({ status: 'noMatch' })).toBe("Couldn't sync this subtitle confidently")
  })

  it('says nothing for a pending replace or a cancel', () => {
    expect(describeOutcome({ status: 'exists', offset: 1, scale: 1, name: 'x' })).toBeNull()
    expect(describeOutcome({ status: 'cancelled' })).toBeNull()
  })
})
