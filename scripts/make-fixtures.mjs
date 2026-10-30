// Usage: node scripts/make-fixtures.mjs
// Generates test media into tests/fixtures/media and a fake library into
// tests/fixtures/library (both gitignored). Only missing files are made.
// The vendor ffmpeg is an LGPL build, so there is no x264/x265: clips use
// mpeg4, VP9 and AV1 instead (test-media-fixtures).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ffmpeg = join(root, 'vendor', 'ffmpeg', 'ffmpeg.exe')
const media = join(root, 'tests', 'fixtures', 'media')
const library = join(root, 'tests', 'fixtures', 'library')
const tmdbImage = join(root, 'tests', 'fixtures', 'tmdb', 'image.png')

if (!existsSync(ffmpeg)) {
  console.error('vendor/ffmpeg/ffmpeg.exe is missing. Run npm run fetch-vendor first.')
  process.exit(1)
}

const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
const has = (name) => new RegExp(`\\s${name}\\s`).test(encoders)
const run = (args) => execFileSync(ffmpeg, ['-y', '-v', 'error', ...args], { stdio: 'inherit' })
const SRC = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '20']

function make(file, build) {
  if (existsSync(file)) return
  mkdirSync(dirname(file), { recursive: true })
  console.log(`making ${file.slice(root.length + 1)}`)
  build(file)
}

make(join(media, 'h264_like.mp4'), (f) => run([...SRC, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', f]))
make(join(media, 'webm_vp9_opus.webm'), (f) =>
  run([...SRC, '-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', f])
)
make(join(media, 'xvid_mp3.avi'), (f) =>
  run([...SRC, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', has('libmp3lame') ? 'libmp3lame' : 'aac', f])
)
make(join(media, 'truncated.mp4'), (f) => {
  const whole = readFileSync(join(media, 'h264_like.mp4'))
  writeFileSync(f, whole.subarray(0, Math.floor(whole.length * 0.3)))
})

// Each library file is a remux with its own title tag, so no two files share
// a quick hash.
const remux = (src, title) => (f) => run(['-i', join(media, src), '-c', 'copy', '-metadata', `title=${title}`, f])
const LIBRARY = [
  ['The.Matrix.1999.1080p.BluRay.x264.mkv', 'h264_like.mp4'],
  ['Amélie (2001).mp4', 'h264_like.mp4'],
  ['inception_2010_720p.webm', 'webm_vp9_opus.webm'],
  ['Some Unknown Home Video.avi', 'xvid_mp3.avi'],
  ['Breaking Bad/Season 1/Breaking.Bad.S01E01.mkv', 'h264_like.mp4'],
  ['Breaking Bad/Season 1/Breaking.Bad.S01E02.mkv', 'h264_like.mp4'],
  ['Breaking Bad/Season 2/Breaking.Bad.S02E01.mkv', 'h264_like.mp4'],
  ['The.Matrix.1999.sample.mkv', 'h264_like.mp4']
]
for (const [name, src] of LIBRARY) make(join(library, name), remux(src, name))

// Subtitle files next to the library's videos, with lines at 1–4 s and 5–8 s.
const srt = (a, b) => `1\r\n00:00:01,000 --> 00:00:04,000\r\n${a}\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,000\r\n${b}\r\n`
const SUBTITLES = [
  ['The.Matrix.1999.1080p.BluRay.x264.en.srt', Buffer.from(srt('Wake up, Neo.', 'Follow the white rabbit.'))],
  // Saved in Windows-1252, as old French subtitle files often are.
  ['Amélie (2001).fr.srt', Buffer.from(srt("Le fabuleux destin d'Amélie", 'Café des Deux Moulins'), 'latin1')],
  ['Breaking Bad/Season 1/Subs/Breaking.Bad.S01E01.English.srt', Buffer.from(srt('Say my name.', 'You got me.'))],
  ['inception_2010_720p.en.forced.srt', Buffer.from(srt('[Japanese] Are you here to kill me?', 'Dream within a dream.'))]
]
for (const [name, data] of SUBTITLES) make(join(library, name), (f) => writeFileSync(f, data))

// Stand-in for every TMDB image in fixtures mode (committed).
make(tmdbImage, (f) => run(['-f', 'lavfi', '-i', 'color=c=0x335577:s=500x750', '-frames:v', '1', f]))

// Two audio tracks and three English subtitle tracks (plain, SDH, forced) for the
// player's Audio and Subtitles menus and per-title track memory.
make(join(media, 'tracks.mkv'), (f) => {
  const srt = join(media, 'tracks.srt')
  writeFileSync(srt, '1\n00:00:01,000 --> 00:00:19,000\nHello there.\n')
  run([
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
    '-i', srt,
    '-t', '20',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-map', '3:s', '-map', '3:s',
    '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-ac:a:0', '6', '-ac:a:1', '2', '-c:s', 'srt',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn',
    '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English',
    '-metadata:s:s:1', 'language=eng', '-metadata:s:s:1', 'title=English SDH', '-disposition:s:1', 'hearing_impaired',
    '-metadata:s:s:2', 'language=eng', '-disposition:s:2', 'forced',
    f
  ])
})

console.log('fixtures ready')
