import { describe, expect, it } from 'vitest'
import { parsePosterUrl, posterUrl } from '../../src/main/images/posterUrl'

describe('poster URLs', () => {
  it('round-trips a reference', () => {
    expect(posterUrl({ type: 'poster', owner: 'video', id: 12 })).toBe('poster://poster/video/12')
    expect(parsePosterUrl('poster://poster/video/12')).toEqual({ type: 'poster', owner: 'video', id: 12 })
    expect(parsePosterUrl('poster://still/show/1396/')).toEqual({ type: 'still', owner: 'show', id: 1396 })
  })

  it('ignores a version query, which only busts the browser cache', () => {
    expect(posterUrl({ type: 'poster', owner: 'video', id: 12 }, 'm603')).toBe('poster://poster/video/12?v=m603')
    expect(parsePosterUrl('poster://poster/video/12?v=m603')).toEqual({ type: 'poster', owner: 'video', id: 12 })
  })

  it.each(['poster://poster/video/abc', 'poster://x/video/1', 'poster://poster/file/1', 'https://poster/video/1', ''])(
    'rejects %s',
    (url) => {
      expect(parsePosterUrl(url)).toBeNull()
    }
  )
})
