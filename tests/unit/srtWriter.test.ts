import { describe, expect, it } from 'vitest'
import type { ParsedCue } from '../../src/main/subtitles/parse'
import { writeSrt } from '../../src/main/subtitles/srt'

const cue = (start: number, end: number, lines: string[], extra: Partial<ParsedCue> = {}): ParsedCue => ({ start, end, lines, italic: false, top: false, ...extra })

describe('writeSrt', () => {
  it('writes CRLF blocks with the offset applied, italics and top kept', () => {
    expect(writeSrt([cue(1, 4, ['Hi', 'there'], { italic: true, top: true })], 2)).toBe(
      '1\r\n00:00:03,000 --> 00:00:06,000\r\n{\\an8}<i>Hi\r\nthere</i>\r\n\r\n'
    )
  })

  it('renumbers from 1', () => {
    const out = writeSrt([cue(1, 2, ['A']), cue(3, 4, ['B'])], 0)
    expect(out).toBe('1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nB\r\n\r\n')
  })

  it('drops cues that end at or before 0 and clamps starts to 0', () => {
    const out = writeSrt([cue(1, 2, ['Gone']), cue(1, 4, ['Kept'])], -2)
    expect(out).toBe('1\r\n00:00:00,000 --> 00:00:02,000\r\nKept\r\n\r\n')
  })

  it('formats hours and milliseconds', () => {
    expect(writeSrt([cue(3725.5, 3726.0004, ['x'])], 0)).toContain('01:02:05,500 --> 01:02:06,000')
  })

  it('has no BOM', () => {
    expect(writeSrt([cue(1, 2, ['A'])], 0).charCodeAt(0)).toBe('1'.charCodeAt(0))
  })
})
