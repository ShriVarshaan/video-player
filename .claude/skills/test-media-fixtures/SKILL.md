---
name: test-media-fixtures
description: Generating and using test media for this project — ffmpeg commands for short clips in every supported container/codec, mkv with embedded subtitles, a TTS speech track with ground-truth SRT for sync tests, shifted/drifted/cut subtitle variants, odd encodings, a fake library folder with realistic filenames, TMDB offline mocks, and the commands to run vitest, Playwright-Electron and pytest. Use when writing or running tests, or when a test needs media.
---

# Test media fixtures

The generator script is committed. Its output is **not** committed (`tests/fixtures/media/` is gitignored). Run it with:

```
node scripts/make-fixtures.mjs          # uses vendor/ffmpeg/ffmpeg.exe, regenerates only missing files
```

## Clips (about 20 s each, 640×360, small)
```bash
FF="vendor/ffmpeg/ffmpeg.exe -y -v error"
SRC="-f lavfi -i testsrc2=size=640x360:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 20"

$FF $SRC -c:v libx264 -pix_fmt yuv420p -c:a aac                 h264_aac.mp4
$FF $SRC -c:v libvpx-vp9 -b:v 300k -c:a libopus                webm_vp9_opus.webm
$FF $SRC -c:v mpeg4 -c:a mp3                                   xvid_mp3.avi
$FF $SRC -c:v libx264 -c:a ac3                                 h264_ac3.mov
# HEVC + embedded subs (two tracks: eng text, fre text) — needs speech.srt / any srt first
$FF $SRC -i subs_en.srt -i subs_fr.srt -map 0:v -map 1:a -map 2 -map 3 \
    -c:v libx265 -tag:v hvc1 -c:a aac -c:s srt \
    -metadata:s:s:0 language=eng -metadata:s:s:1 language=fre      hevc_embedded_subs.mkv
$FF $SRC -c:v libsvtav1 -c:a libopus                           av1_opus.mkv   # skip if encoder missing
$FF -i h264_aac.mp4 -c copy -f mpegts                          h264.ts
```
- Check which encoders exist with `ffmpeg -hide_banner -encoders`. Skip missing ones and print a warning; don't fail.
- An LGPL ffmpeg build has no x264/x265 encoders. For HEVC/H.264 fixtures, the script falls back to a GPL ffmpeg on `PATH`, or skips them. The *app* only needs to decode, so LGPL is fine for shipping.
- **Corrupt-file case:** copy `h264_aac.mp4` and truncate it to 30 % → `truncated.mp4`. The app should show an error, not crash.

## Speech track with ground truth (for sync tests)
Windows has built-in TTS, so no downloads are needed:
```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile("line_007.wav"); $s.Speak("Where were you last night?"); $s.Dispose()
```
1. Take about 80 lines from `tests/fixtures/lines.txt`, which is committed: varied, natural sentences of 3–12 words.
2. Make one WAV per line. Place each at a known start, with random gaps of 0.8–4 s, by building an ffmpeg `concat` list with `anullsrc` silences between lines.
3. Mix in low pink noise (`anoisesrc=color=pink:amplitude=0.02`) so the VAD isn't trivially easy.
4. Write `speech.srt` with the exact start/end of each line (measure each WAV's duration with ffprobe). This is the **ground truth**.
5. Mux onto a `testsrc2` video, about 5 min long, as `speech.mkv`.

Variants, made by applying a transform to `speech.srt`. Reuse the TS or Python SRT writer; don't hand-roll a new one.

| File | Transform |
|---|---|
| `speech.shift+3.2.srt` | offset +3.2 s |
| `speech.shift-7.5.srt` | offset −7.5 s |
| `speech.drift1001.srt` | scale 1.001 |
| `speech.pal.srt` | scale 23.976/25 |
| `speech.cut45.srt` | +45 s offset for cues after the halfway point (simulates a different edition) |
| `speech.wronglang.srt` | French lines, so deep sync must return `NO_MATCH` |

## Subtitle edge cases (text fixtures, committed in `tests/fixtures/subs/`)
- `cp1252.srt` with accents, `utf16le_bom.srt`, `utf8_bom.srt`
- `messy.srt`: missing indexes, `.` in milliseconds, missing hours, extra blank lines, `{\an8}`, `<i>`, `<font>`
- `sample.vtt` with NOTE/STYLE blocks
- `sample.ass` with commas in text, `\N`, override tags, and a sign style
- `overlapping.srt`

## Fake library (`tests/fixtures/library/`, generated)
Copy or hard-link the clips under realistic names:
- `The.Matrix.1999.1080p.BluRay.x264.mkv`
- `Amélie (2001).mp4`
- `inception_2010_720p.webm`
- `Some Unknown Home Video.avi`, which must fall back to a frame thumbnail

Also add a matching `.en.srt` and `.forced.srt` next to one movie, and a `Subs/` folder next to another.

## TMDB in tests
Set `VP_TMDB_MODE=fixtures`. MetadataService then reads `tests/fixtures/tmdb/*.json` instead of the network. Never call the real TMDB API in tests.

## Running tests
```
npx vitest run                        # unit (renderer + main pure logic)
npx playwright test                   # e2e, launches Electron via _electron.launch (see playwright-best-practices)
sidecar\.venv\Scripts\python -m pytest sidecar/tests -q
```
E2E runs should point the app at a temp `userData` (`--user-data-dir`) so tests never touch the real library or settings.
