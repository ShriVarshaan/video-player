import { describe, expect, it } from 'vitest'
import iconv from 'iconv-lite'
import { decodeSubtitle } from '../../src/main/subtitles/decode'
import { parseSubtitle } from '../../src/main/subtitles/parse'

describe('SRT', () => {
  it('reads a plain block', () => {
    expect(parseSubtitle('1\n00:00:01,000 --> 00:00:04,000\nHello\nthere\n')).toEqual([
      { start: 1, end: 4, lines: ['Hello', 'there'], italic: false, top: false }
    ])
  })

  it('works without an index line and with a wrong one', () => {
    const cues = parseSubtitle('00:00:01,000 --> 00:00:02,000\nA\n\n7\n00:00:03,000 --> 00:00:04,000\nB\n')
    expect(cues.map((c) => c.lines[0])).toEqual(['A', 'B'])
  })

  it('takes a missing hour as 0 and right-pads milliseconds', () => {
    const [c] = parseSubtitle('1\n01:02,5 --> 01:03,25\nHi\n')
    expect(c!.start).toBeCloseTo(62.5)
    expect(c!.end).toBeCloseTo(63.25)
  })

  it('reads hours past 9 and a dot before the milliseconds', () => {
    const [c] = parseSubtitle('1\n1:02:05.500 --> 01:02:06,000\nHi\n')
    expect(c!.start).toBeCloseTo(3725.5)
  })

  it('ignores trailing coordinates', () => {
    const [c] = parseSubtitle('1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:200 Y1:10 Y2:20\nHi\n')
    expect(c).toMatchObject({ start: 1, end: 2, lines: ['Hi'] })
  })

  it('turns <i> into italic and drops <b>, <u> and <font>', () => {
    const [c] = parseSubtitle('1\n00:00:01,000 --> 00:00:02,000\n<i><font color="#fff"><b>Hi</b> <u>you</u></font></i>\n')
    expect(c).toMatchObject({ lines: ['Hi you'], italic: true })
  })

  it('reads {\\an8} as top and strips other override blocks', () => {
    const [c] = parseSubtitle('1\n00:00:01,000 --> 00:00:02,000\n{\\an8}{\\pos(10,10)}Up here\n')
    expect(c).toMatchObject({ lines: ['Up here'], top: true })
  })

  it('handles a BOM, CRLF and CR-only line ends', () => {
    expect(parseSubtitle('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n\r\n')[0]!.lines).toEqual(['A'])
    expect(parseSubtitle('1\r00:00:01,000 --> 00:00:02,000\rB\r\r')[0]!.lines).toEqual(['B'])
  })

  it('keeps going after a broken block', () => {
    const cues = parseSubtitle('1\nnonsense\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n')
    expect(cues.map((c) => c.lines[0])).toEqual(['B'])
  })
})

describe('WebVTT', () => {
  const vtt = [
    'WEBVTT - title',
    '',
    'NOTE a comment',
    'over two lines',
    '',
    'STYLE',
    '::cue { color: red }',
    '',
    'REGION',
    'id:fred',
    '',
    'intro',
    '00:01.000 --> 00:04.000 line:0 align:center',
    '<v Bob>Hello <c.loud>there</c>',
    '',
    '00:00:05.000 --> 00:00:06.000',
    'Karaoke <00:00:05.500>words',
    ''
  ].join('\n')

  it('skips header, NOTE, STYLE and REGION blocks and cue ids', () => {
    expect(parseSubtitle(vtt).map((c) => c.lines)).toEqual([['Hello there'], ['Karaoke words']])
  })

  it('reads line:0 as top and strips voice, class and karaoke tags', () => {
    const [a, b] = parseSubtitle(vtt)
    expect(a).toMatchObject({ start: 1, end: 4, top: true })
    expect(b).toMatchObject({ start: 5, end: 6, top: false })
  })
})

describe('ASS', () => {
  const ass = (events: string[], styles = ['Style: Default,Arial,20', 'Style: Sign,Arial,20']) =>
    [
      '[Script Info]',
      'Title: x',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize',
      ...styles,
      '',
      '[Events]',
      'Format: Layer, Style, Start, End, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...events
    ].join('\n')

  it('reads fields by the Format line and keeps commas in Text', () => {
    const [c] = parseSubtitle(ass(['Dialogue: 0,Default,0:00:01.50,0:00:04.00,,0,0,0,,Well, then, go.']))
    expect(c).toMatchObject({ start: 1.5, end: 4, lines: ['Well, then, go.'] })
  })

  it('follows a Format line in another order', () => {
    const text = [
      '[Script Info]',
      '',
      '[Events]',
      'Format: Start, End, Style, Text',
      'Dialogue: 0:00:02.00,0:00:03.00,Default,Hi'
    ].join('\n')
    expect(parseSubtitle(text)[0]).toMatchObject({ start: 2, end: 3, lines: ['Hi'] })
  })

  it('splits \\N and \\n into lines, \\h is a space', () => {
    const [c] = parseSubtitle(ass(['Dialogue: 0,Default,0:00:01.00,0:00:02.00,,0,0,0,,One\\Ntwo\\nthree\\hfour']))
    expect(c!.lines).toEqual(['One', 'two', 'three four'])
  })

  it('reads \\i1 as italic and \\an8 as top, drops other tags', () => {
    const [c] = parseSubtitle(ass(['Dialogue: 0,Default,0:00:01.00,0:00:02.00,,0,0,0,,{\\an8\\i1\\fs20}Up']))
    expect(c).toMatchObject({ lines: ['Up'], italic: true, top: true })
  })

  it('drops drawings', () => {
    const cues = parseSubtitle(ass(['Dialogue: 0,Default,0:00:01.00,0:00:02.00,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}']))
    expect(cues).toEqual([])
  })

  it('drops sign styles when a dialogue style exists', () => {
    const cues = parseSubtitle(
      ass([
        'Dialogue: 0,Default,0:00:01.00,0:00:02.00,,0,0,0,,Talk',
        'Dialogue: 0,Sign,0:00:01.00,0:00:02.00,,0,0,0,,EXIT'
      ])
    )
    expect(cues.map((c) => c.lines[0])).toEqual(['Talk'])
  })

  it('keeps sign styles when they are all there is', () => {
    const cues = parseSubtitle(ass(['Dialogue: 0,Sign,0:00:01.00,0:00:02.00,,0,0,0,,EXIT'], ['Style: Sign,Arial,20']))
    expect(cues.map((c) => c.lines[0])).toEqual(['EXIT'])
  })
})

describe('cleaning', () => {
  it('drops empty cues, fixes end before start, sorts by start', () => {
    const cues = parseSubtitle(
      ['1', '00:00:05,000 --> 00:00:04,000', 'Late', '', '2', '00:00:01,000 --> 00:00:02,000', '', '', '3', '00:00:00,500 --> 00:00:01,000', 'Early', ''].join('\n')
    )
    expect(cues).toEqual([
      { start: 0.5, end: 1, lines: ['Early'], italic: false, top: false },
      { start: 5, end: 7, lines: ['Late'], italic: false, top: false }
    ])
  })

  it('merges exact duplicates (ASS layers)', () => {
    const block = '00:00:01,000 --> 00:00:02,000\nSame\n\n'
    expect(parseSubtitle(block + block)).toHaveLength(1)
  })
})

describe('decodeSubtitle', () => {
  it('decodes a cp1252 French file', () => {
    expect(decodeSubtitle(iconv.encode('Café', 'windows-1252'), 'fre')).toBe('Café')
  })

  it('strips a UTF-8 BOM and reads UTF-16LE', () => {
    expect(decodeSubtitle(Buffer.from('﻿Hi', 'utf8'), null)).toBe('Hi')
    expect(decodeSubtitle(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hé', 'utf16le')]), null)).toBe('Hé')
  })
})

describe('SRT with blank lines inside a cue (review)', () => {
  it('keeps the text after the blank line with its cue', () => {
    const cues = parseSubtitle('1\n00:00:01,000 --> 00:00:03,000\nLine A\n\nLine B\n\n2\n00:00:04,000 --> 00:00:05,000\nNext\n')
    expect(cues.map((c) => c.lines)).toEqual([['Line A', 'Line B'], ['Next']])
  })
  it('does not take the next index number as text', () => {
    const cues = parseSubtitle('1\n00:00:01,000 --> 00:00:03,000\nA\n\n\n12\n00:00:04,000 --> 00:00:05,000\nB\n')
    expect(cues.map((c) => c.lines)).toEqual([['A'], ['B']])
  })
  it('keeps a number that is part of the text in a file without index lines', () => {
    const cues = parseSubtitle('00:00:01,000 --> 00:00:03,000\nThe year was\n1984\n\n00:00:04,000 --> 00:00:05,000\nNext\n')
    expect(cues.map((c) => c.lines)).toEqual([['The year was', '1984'], ['Next']])
  })
})
