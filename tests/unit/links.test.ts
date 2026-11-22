import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { LINKS } from '@shared/links'
import { mirrorPage } from '../../scripts/third-party-lib.mjs'

it('every link is an https address', () => {
  for (const url of Object.values(LINKS)) expect(new URL(url).protocol).toBe('https:')
})

it('the mpv and FFmpeg source link is our own mirror of the exact builds', () => {
  expect(LINKS.thirdPartySource).toBe(mirrorPage(JSON.parse(readFileSync('vendor/manifest.json', 'utf8'))))
})
