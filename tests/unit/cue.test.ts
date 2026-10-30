import { describe, expect, it } from 'vitest'
import { toCue } from '../../src/main/subtitles/cue'

const span = (text: string, italic = false, bold = false) => ({ text, italic, bold })

describe('toCue', () => {
  it('keeps line breaks and italics, and reads top alignment', () => {
    expect(toCue('{\\an8}{\\i1}Hello{\\i0}\\Nthere')).toEqual({ top: true, lines: [[span('Hello', true)], [span('there')]] })
  })

  it('keeps bold, splits spans where the style changes', () => {
    expect(toCue('Say {\\b1}hi{\\b0} now')).toEqual({ top: false, lines: [[span('Say '), span('hi', false, true), span(' now')]] })
  })

  it('drops other tags, positioning included', () => {
    expect(toCue('{\\pos(10,10)\\c&H00FF00&}<b>Hi</b> <font color="red">there</font>')).toEqual({
      top: false,
      lines: [[span('Hi', false, true), span(' there')]]
    })
  })

  it('accepts newlines as line breaks and drops empty lines', () => {
    expect(toCue('One\nTwo\r\n\\N')?.lines).toEqual([[span('One')], [span('Two')]])
  })

  it('has no cue for empty or missing text', () => {
    expect(toCue('')).toBeNull()
    expect(toCue('{\\an8}')).toBeNull()
    expect(toCue(undefined)).toBeNull()
  })

  it('drops ASS drawings (sign masks) and turns soft breaks into spaces (review)', () => {
    // As the vendor mpv reports them: one event per line, drawing commands raw.
    expect(toCue('{\\p1}m 0 0 l 100 0 100 40 0 40{\\p0}\nHello')?.lines).toEqual([[span('Hello')]])
    expect(toCue('soft\\nbreak')?.lines).toEqual([[span('soft break')]])
    expect(toCue('{\\p1}m 0 0 l 1 1{\\p0}')).toBeNull()
  })

  it('keeps text that looks like markup as text', () => {
    expect(toCue('<script>alert(1)</script> & <3')?.lines).toEqual([[span('alert(1) & <3')]])
  })
})
