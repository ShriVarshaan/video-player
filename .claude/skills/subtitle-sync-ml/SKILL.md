---
name: subtitle-sync-ml
description: The Python sidecar that auto-syncs a subtitle to a movie's audio — JSON-lines protocol with Electron, audio extraction with progress, ffsubsync (WebRTC voice activity detection) for offset + framerate scale, the confidence check, cancellation, tests on the TTS speech fixtures, and PyInstaller packaging. Use for any work in sidecar/, src/main/sync/*, the "Auto sync" UI, or sync accuracy problems.
---

# Auto sync (Python sidecar)

Speech detection only: **no speech recognition, no Whisper, no model downloads** (user's decision, milestone 7). It fixes a **fixed delay** and a **framerate drift**; cuts (different editions) are out of scope.

```
sidecar/
  vp_sync/__main__.py   stdin/stdout JSON-lines loop (UTF-8 both ways)
  vp_sync/protocol.py   Server: one job at a time on a worker thread, cancel, BUSY
  vp_sync/sync.py       ffmpeg → 16 kHz WAV with progress, ffsubsync, the check
  vp_sync/signals.py    10 ms speech/cue masks, alignment score, enough_cues
  tests/                pytest (protocol, signals, sync on the speech fixtures)
  requirements.txt      pinned; requirements-dev.txt (pytest, pyinstaller)
  build.spec            PyInstaller onedir → sidecar/dist/vp-sync/
```

- **Python 3.12** venv at `sidecar/.venv` (`npm run setup-sidecar`). Wheels lag on 3.14.
- Tests: `npm run test:sidecar`. Fixture tests skip with a reason when `speech.mkv` or the vendor ffmpeg is missing.

## Division of work

Electron writes the showing subtitle's parsed cues (original timing, the app's own reader) to a temp SRT and sends it. The sidecar **only measures** and returns `{offset, scale, score}`. Main writes `<video>.<lang>[.sdh|.forced].synced.srt` through `subtitles/export.ts`. The sidecar never writes next to the user's files.

## Protocol

```jsonc
→ {"id":1,"method":"sync","params":{"video":"…","subtitle":"<temp srt>","audioStream":0,"durationS":451.0}}
← {"id":1,"event":"progress","stage":"audio"|"match","pct":0.42|null}
← {"id":1,"result":{"offset":-3.19,"scale":1.0,"score":13.9}}
← {"id":1,"error":{"code":"NO_MATCH"|"NO_AUDIO"|"FFMPEG_FAILED"|"CANCELLED"|"BUSY"|"INTERNAL","message":"…"}}
→ {"id":2,"method":"cancel","params":{"target":1}}      → {"id":3,"method":"ping"}  ← {"id":3,"result":"pong"}
```

- Displayed time = `scale * t + offset` (positive = later). A subtitle 3.2 s late returns offset ≈ −3.2.
- `audioStream` is ffmpeg's audio-relative index (`0:a:<n>`).
- One job at a time; a second `sync` gets `BUSY`. `cancel` answers `CANCELLED` at once, kills ffmpeg, and the abandoned job's result is never written. A `sync` right after a cancel is accepted and starts when the abandoned thread ends.
- At stdin EOF the server lets a running job reply, and a cancelled one finish its cleanup (up to 10 s), before exiting.
- **Shutdown:** main's `dispose()` sends cancel and closes stdin, and kills the helper only if it's still running 2 s later. A kill on Windows is TerminateProcess, which skips Python's `finally` and leaves the WAV (about 115 MB per hour of film) in %TEMP%. At startup, `clean_stale()` deletes `vp-sync-*` dirs and `vp-autosync-*.srt` files older than 10 minutes.
- Main's `autoSync` keeps its own cancel flag per start: a cancel during cue reading (embedded tracks can take seconds) returns `cancelled` before the sidecar is called. A sidecar `BUSY` (the last job is still stopping) shows "Still stopping the last sync. Try again in a moment."
- stdout carries protocol lines only. ffsubsync runs under `redirect_stdout(sys.stderr)`; logs go to stderr.
- Env: `VP_FFMPEG` (vendor ffmpeg), `PYTHONIOENCODING=utf-8`, `PYTHONUNBUFFERED=1`.

## The job (`sync.run`)

1. Read the SRT with `srt`.
2. `ffmpeg -nostdin -v error -nostats -stats_period 0.05 -i <video> -map 0:a:<n> -af aresample=async=1:first_pts=0 -ac 1 -ar 16000 -f wav <tmp> -progress pipe:1`. `first_pts=0` pads audio that starts after the file does (common in .ts/.m2ts and remuxes); without it, the sync is off by that gap and the check can't notice (`test_audio_starting_after_the_video_keeps_its_delay`). Progress = `out_time_us / durationS`. "matches no streams" → `NO_AUDIO`; other failures → `FFMPEG_FAILED`.
3. ffsubsync 0.5.1 in-process: `make_parser().parse_args([wav, "-i", srt, "-o", tmp_out, "--max-offset-seconds", "120", "--vad", "webrtc", "--ffmpeg-path", dir])`, then `run(args)` → `offset_seconds`, `framerate_scale_factor`, `sync_was_successful`. Its framerate search covers 24/23.976, 25/23.976, 25/24 and their inverses. `snap_scale` snaps to those within 0.05 %.
4. **The check** (ffsubsync alone said "success" for the wrong-subtitle fixture, so this matters). `NO_MATCH` when any of these hold:
   - ffsubsync reports failure;
   - |offset| > 115 s (the edge of the ±120 s search);
   - fewer than 20 transformed cues start inside the audio;
   - z < **8.5**, where z is the correlation of the transformed cue mask against our own WebRTC speech mask (mode 2, 10 ms) at shift 0, in robust standard deviations (1.4826·MAD) above the median of all shifts within ±120 s;
   - the best shift is more than 50 frames (0.5 s) from 0.
5. Return `{offset, scale, score: z}`. The temp folder is removed in `finally`.

**Threshold, measured 2026-10-31** on the speech fixtures: correct variants z 13.3–13.9, wrong subtitle 3.7, so the threshold is set midway at 8.5. Recovered cue error was about 0.01 s median and p95 on every variant. Real films (music, effects, SDH lines with no speech) will score lower. If correct syncs get rejected on real films, re-measure there before moving the threshold.

## Testing

- Fixtures from `test-media-fixtures`: `speech.mkv` (~7.5 min of SAPI TTS over pink noise), `speech.srt` (truth), plus `shift+3.2`, `shift-7.5`, `drift1001`, `pal`, `ntsc`, `wrong` and `few` variants, and `speech-noaudio.mkv`.
- Pass mark: median cue error < 0.10 s and p95 < 0.30 s on every correct variant; `wrong` and `few` give `NO_MATCH`.
- `test_sync_unicode_path` runs a real `python -m vp_sync` on a path containing `é` and spaces.

## Packaging

- `npm run build-sidecar` (PyInstaller onedir) → `sidecar/dist/vp-sync/vp-sync.exe`. Exclude torch and other heavy unused packages.
- electron-builder copies it to `resources/sidecar/vp-sync/` (`release-windows`). In dev, main runs `sidecar/.venv/Scripts/python.exe -m vp_sync` with cwd `sidecar/`. `paths.ts` decides which.
