import { expect, it } from 'vitest'
import { LINKS } from '@shared/links'

it('every link is an https address', () => {
  for (const url of Object.values(LINKS)) expect(new URL(url).protocol).toBe('https:')
})

it('source links point at the exact pinned builds', () => {
  expect(LINKS.mpvSource).toContain('mpv-winbuild-cmake/releases/tag/20261021')
  expect(LINKS.ffmpegSource).toContain('FFmpeg-Builds/releases/tag/autobuild-2026-10-29-19-17')
})
