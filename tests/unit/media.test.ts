import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { grabFrame, toWebp } from '../../src/main/media/ffmpeg'
import { parseProbeJson, probe } from '../../src/main/media/probe'
import { quickHash } from '../../src/main/media/quickHash'

const FFMPEG = join('vendor', 'ffmpeg', 'ffmpeg.exe')
const FFPROBE = join('vendor', 'ffmpeg', 'ffprobe.exe')
const MEDIA = join('tests', 'fixtures', 'media')
const haveBinaries = existsSync(FFMPEG) && existsSync(FFPROBE)

describe('parseProbeJson', () => {
  it('reads duration, container, codec, size and HDR', () => {
    const json = JSON.stringify({
      format: { format_name: 'matroska,webm', duration: '5400.5' },
      streams: [
        { codec_type: 'audio', codec_name: 'eac3' },
        { codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, color_transfer: 'smpte2084' }
      ]
    })
    expect(parseProbeJson(json)).toEqual({
      durationS: 5400.5,
      container: 'matroska,webm',
      videoCodec: 'hevc',
      width: 3840,
      height: 2160,
      hdr: true,
      json
    })
  })

  it('returns nulls when there is no video stream', () => {
    const json = JSON.stringify({ format: { format_name: 'mp3' }, streams: [{ codec_type: 'audio' }] })
    expect(parseProbeJson(json)).toMatchObject({
      durationS: null,
      videoCodec: null,
      width: null,
      height: null,
      hdr: false
    })
  })
})

describe.skipIf(!haveBinaries)('with the vendor binaries', () => {
  let out: string
  beforeAll(() => {
    execFileSync(process.execPath, ['scripts/make-fixtures.mjs'], { stdio: 'inherit' })
    out = mkdtempSync(join(tmpdir(), 'vp-media-'))
  }, 300_000)
  afterAll(() => rmSync(out, { recursive: true, force: true }))

  it('probes a clip', async () => {
    const r = await probe(FFPROBE, join(MEDIA, 'h264_like.mp4'))
    expect(r.durationS).toBeGreaterThan(19.5)
    expect(r.durationS).toBeLessThan(20.5)
    expect(r.width).toBe(640)
    expect(r.height).toBe(360)
  })

  it('does not hang on a truncated file', async () => {
    const r = await probe(FFPROBE, join(MEDIA, 'truncated.mp4')).catch(() => null)
    expect(r === null || r.durationS === null || r.durationS < 20).toBe(true)
  }, 35_000)

  it('quick-hashes by size, head and tail', async () => {
    const mp4 = join(MEDIA, 'h264_like.mp4')
    const size = statSync(mp4).size
    const a = await quickHash(mp4, size)
    expect(await quickHash(mp4, size)).toBe(a)
    const webm = join(MEDIA, 'webm_vp9_opus.webm')
    expect(await quickHash(webm, statSync(webm).size)).not.toBe(a)

    // Only the head and tail are read: a change in the middle keeps the hash.
    const copy = join(out, 'copy.mp4')
    copyFileSync(mp4, copy)
    const fd = openSync(copy, 'r+')
    writeSync(fd, Buffer.from([0x42]), 0, 1, Math.floor(size / 2))
    closeSync(fd)
    expect(await quickHash(copy, size)).toBe(a)
  })

  it('grabs a frame and writes a 400 px WebP', async () => {
    const png = join(out, 'frame.png')
    await grabFrame(FFMPEG, join(MEDIA, 'h264_like.mp4'), 2, png, 400)
    const webp = join(out, 'frame.webp')
    await toWebp(FFMPEG, png, webp, 400)
    const bytes = readFileSync(webp)
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
    expect((await probe(FFPROBE, webp)).width).toBe(400)
  })
})
