// Usage: node scripts/make-fixtures.mjs
// Generates test media into tests/fixtures/media and a fake library into
// tests/fixtures/library (both gitignored). Only missing files are made.
// The vendor ffmpeg is an LGPL build, so there is no x264/x265: clips use
// mpeg4, VP9 and AV1 instead (test-media-fixtures).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// ---- Speech track with ground truth, for auto sync (test-media-fixtures). ----
// 80 TTS lines (Windows SAPI) placed at known times over low pink noise. Each
// cue starts and ends where its WAV is actually loud, so speech.srt is exact.

const speechTruth = join(media, 'speech.srt')
const speechVideo = join(media, 'speech.mkv')

// Small seeded generator so the fixture is the same on every machine.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The one SRT formatter for every speech variant: displayed = scale * t + offset.
function toSrt(cues, scale = 1, offset = 0) {
  const stamp = (s) => {
    const ms = Math.max(0, Math.round(s * 1000))
    const p = (n, w = 2) => String(n).padStart(w, '0')
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
  }
  return cues
    .map((c, i) => `${i + 1}\r\n${stamp(scale * c.start + offset)} --> ${stamp(scale * c.end + offset)}\r\n${c.text}\r\n`)
    .join('\r\n')
}

// 16-bit PCM WAV → { rate, samples } (SAPI writes plain mono PCM).
function readWav(file) {
  const b = readFileSync(file)
  let pos = 12
  let rate = 0
  let channels = 1
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4)
    const size = b.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      channels = b.readUInt16LE(pos + 10)
      rate = b.readUInt32LE(pos + 12)
      if (b.readUInt16LE(pos + 22) !== 16) throw new Error(`${file}: not 16-bit PCM`)
    } else if (id === 'data') {
      const n = Math.floor(size / 2 / channels)
      const samples = new Int16Array(n)
      for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(pos + 8 + i * 2 * channels)
      return { rate, samples }
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error(`${file}: no data chunk`)
}

// Where the line is actually audible inside its WAV (SAPI pads both ends).
function loudSpan(samples, rate) {
  const win = Math.round(rate * 0.01)
  const loud = []
  for (let i = 0; i + win <= samples.length; i += win) {
    let peak = 0
    for (let j = i; j < i + win; j++) peak = Math.max(peak, Math.abs(samples[j]))
    loud.push(peak > 600)
  }
  const first = loud.indexOf(true)
  const last = loud.lastIndexOf(true)
  return { from: (first * win) / rate, to: ((last + 1) * win) / rate }
}

function makeSpeech() {
  const all = readFileSync(join(root, 'tests', 'fixtures', 'lines.txt'), 'utf8').split(/\r?\n/).filter(Boolean)
  const lines = all.slice(0, 80)
  const tmp = join(media, 'speech-tmp')
  mkdirSync(tmp, { recursive: true })
  const list = join(tmp, 'lines.txt')
  writeFileSync(list, lines.join('\n'), 'utf8')
  console.log('speaking 80 lines with Windows TTS…')
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    `$lines = Get-Content -Encoding UTF8 '${list}'`,
    '$i = 0',
    'foreach ($l in $lines) {',
    '  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `  $s.SetOutputToWaveFile((Join-Path '${tmp}' ('line_{0:000}.wav' -f $i)))`,
    '  $s.Speak($l); $s.Dispose(); $i++',
    '}'
  ].join('\n')
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' })

  const random = rng(7)
  const parts = lines.map((text, i) => ({ text, ...readWav(join(tmp, `line_${String(i).padStart(3, '0')}.wav`)) }))
  const rate = parts[0].rate
  if (parts.some((p) => p.rate !== rate)) throw new Error('TTS lines differ in sample rate')
  let t = 2
  const cues = []
  const placed = []
  for (const p of parts) {
    const span = loudSpan(p.samples, rate)
    placed.push({ at: t, samples: p.samples })
    cues.push({ start: t + span.from, end: t + span.to, text: p.text })
    t += p.samples.length / rate + 0.8 + random() * 3.2
  }
  const total = Math.ceil(t + 2)
  const mix = new Int16Array(total * rate)
  for (const { at, samples } of placed) mix.set(samples, Math.round(at * rate))
  const raw = join(tmp, 'speech.pcm')
  writeFileSync(raw, Buffer.from(mix.buffer))
  run([
    '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw,
    '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.02:sample_rate=${rate}:duration=${total}`,
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=24:duration=${total}`,
    '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0[a]',
    '-map', '2:v', '-map', '[a]', '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'aac', '-b:a', '96k',
    '-metadata:s:a:0', 'language=eng',
    speechVideo
  ])
  writeFileSync(speechTruth, toSrt(cues))

  // Variants of the truth, each a known transform.
  const variants = {
    'speech.shift+3.2.srt': [1, 3.2],
    'speech.shift-7.5.srt': [1, -7.5],
    'speech.drift1001.srt': [24 / 23.976, 0],
    'speech.pal.srt': [23.976 / 25, 0],
    'speech.ntsc.srt': [25 / 23.976, 0]
  }
  for (const [name, [scale, offset]] of Object.entries(variants)) writeFileSync(join(media, name), toSrt(cues, scale, offset))
  writeFileSync(join(media, 'speech.few.srt'), toSrt(cues.slice(0, 6)))

  // A subtitle for some other film: other lines, timings from another seed.
  const other = rng(99)
  const spare = all.slice(80)
  const wrong = []
  let w = 1 + other() * 4
  for (let i = 0; i < cues.length; i++) {
    const len = 1 + other() * 2.5
    wrong.push({ start: w, end: w + len, text: spare[i % spare.length] })
    w += len + 0.5 + other() * 5
  }
  writeFileSync(join(media, 'speech.wrong.srt'), toSrt(wrong.filter((c) => c.end < total)))
  rmSync(tmp, { recursive: true, force: true })
}

if (process.platform === 'win32' && !existsSync(speechVideo)) makeSpeech()
else if (!existsSync(speechVideo)) console.warn('skipping speech.mkv: Windows TTS needed')

// The speech looped to ~90 min under a tiny picture: a sync that takes a few
// seconds, so E2E can cancel it or use the player while it runs.
make(join(media, 'speech-long.mkv'), (f) =>
  run([
    '-f', 'lavfi', '-i', 'color=c=0x223344:s=64x36:r=1',
    '-stream_loop', '11', '-i', speechVideo,
    '-map', '0:v', '-map', '1:a', '-shortest', '-c:v', 'mpeg4', '-c:a', 'copy', f
  ])
)

// The same picture with no audio stream at all.
make(join(media, 'speech-noaudio.mkv'), (f) =>
  run(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=10', '-c:v', 'mpeg4', '-q:v', '8', f])
)

console.log('fixtures ready')
