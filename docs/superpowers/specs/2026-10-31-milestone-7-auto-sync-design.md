# Milestone 7 — Auto sync (design)

## Intent

When a subtitle is out of time with the film, the user asks the player to fix it and it's done in about a minute without touching G/H. Milestone 6 handled this by hand (nudges, offset slider, sync to a line). This milestone does it automatically: the app finds where people speak in the audio and moves the subtitle's timing so its lines land on that speech.

The user's subtitles are usually off by a **fixed delay**, sometimes with **drift** (a subtitle made for 25 fps played against 23.976 fps, so the gap grows through the film). Those two cases are the whole job.

## Goals

- An **Auto sync** action in the player that syncs the subtitle currently showing to the audio track currently playing.
- It fixes a fixed delay and a speed (framerate) difference.
- The result is a `<movie>.<lang>[.sdh|.forced].synced.srt` file, the same name and rules as milestone 6's export. It is selected straight away and from then on stands in for the original, as milestone 6 already does.
- When the match isn't convincing, it says so and changes nothing. A bad guess is never applied without telling the user.
- Playback continues while it runs; it can be cancelled.

## Non-goals

- **No speech recognition.** Whisper / faster-whisper is dropped from the project (user's decision): no transcription, no model download. This replaces the plan's "Whisper as a fallback" decision.
- **No cuts / piecewise sync** (subtitles from a different edition or a TV broadcast with breaks). The user said fixed delay and drift are enough.
- **No automatic syncing.** It runs only when the user asks for it. Nothing runs on its own when a subtitle is picked or downloaded.
- No syncing from the library or Settings, and no batch sync. It runs only from the player.
- Picture subtitles (PGS/VobSub) aren't synced.

## Anti-goals

- Quietly applying a wrong sync, for example to a subtitle from the wrong film. (A translation of the right film is fine: its timing matches the speech, so syncing it is correct. There's no language check; my call.)
- Overwriting the user's own subtitle file.
- A large install: the helper should add tens of MB, not hundreds.

## Constraints

- This laptop: Intel Core Ultra 7 155U, 16 GB, no CUDA GPU. That doesn't matter now that there's no ML model, but sync must stay CPU-light so playback doesn't stutter while it runs.
- Python 3.12 is installed (`py -3.12`) alongside 3.14. The sidecar's venv must use 3.12 (wheels for `webrtcvad` lag on newer Pythons).
- The vendor ffmpeg is an LGPL build. Audio decoding only, so that's fine.
- Repo conventions (CLAUDE.md): never overwrite a user's subtitle; `paths.ts` is the only place that knows binary locations; the IPC contract lives in `src/shared/api.ts`.

## Approaches considered

1. **Python sidecar running ffsubsync (chosen).** ffsubsync is the established open-source tool for exactly this: WebRTC voice activity detection on the audio, FFT alignment against the subtitle's on/off signal, and a search over common framerate ratios. It reports offset, scale and whether the sync succeeded, so the "say so when unsure" rule can be built on it. Cost: a Python 3.12 venv for development and a PyInstaller bundle of roughly 40–60 MB. Without Whisper it's much smaller than originally planned.
2. **Our own TypeScript implementation in main.** The alignment maths is simple and would need no Python and no bundle. But there's no good WebRTC VAD for Node, and a loudness-based detector gets fooled by music and effects, which is where syncs go quietly wrong. Rejected on accuracy.
3. **Bundle `alass` (Rust CLI) like mpv.** One small exe. Unmaintained since 2020, it reports no confidence (which the "never apply a bad guess" rule needs), and its progress is hard to read. Rejected.

The user picked approach 1.

## How it works (as decided)

### The user's side

- **Starting it:** the player's subtitle menu gets an **Auto sync** item next to the existing timing tools ("Sync to a line", offset slider, Reset, Export). There's also a hotkey: **A** (my call; it's unused and next to S and G/H). The item is disabled when no subtitle is showing. For a picture subtitle it reads "Picture subtitles can't be auto-synced".
- **While it runs:** a small card in the same place and style as the sync card says "Syncing subtitles…" with a progress bar and a stage ("Reading audio" → "Matching"). The film keeps playing. **Esc** cancels the sync while the card is open; it does not close the player. Playback controls keep working.
- **When it succeeds:** the app writes the synced file, selects it, and shows a short note through the existing `TimingNote`: "Synced · 3.2 s later", "Synced · 1.4 s earlier", or with drift "Synced · 3.2 s later, speed 25 → 23.976 fps". If the result is a no-op (|offset| < 0.05 s and scale 1), say "Already in sync" and write nothing.
- **When a synced file already exists:** the existing Replace prompt (`ConfirmCard`) appears **after** a successful sync, never before (my call). The prompt doesn't appear when the sync fails or is a no-op. Main holds the pending result, tied to the subtitle `key`, until the user answers, so Replace writes the file without running the sync again. Declining keeps the old file and changes nothing. If the subtitle or file changes while the prompt is open, the pending result is dropped.
- **Syncing a synced track** (my call): the source is always the track showing. If that's already a `.synced.srt` (milestone 6 makes it stand in for the original), auto sync measures that file and, if it needs a change, replaces it after the same Replace prompt. There's no lookup back to the original file; the app doesn't record that link.
- **When it isn't confident:** "Couldn't sync this subtitle confidently" and timing is left alone.
- **Other failures:** an audio-less file says "This video has no audio to sync to". If the helper is missing or broken, the note says "Auto sync isn't available" and the details go to the log.
- **Undo:** there's no special undo. Reset timing, or picking the original track in the menu, gets back what the user had, as in milestone 6.
- **Manual offset:** the sync measures the subtitle file's own timing, ignoring any stored offset. The note's wording ("3.2 s later") is relative to the file, not to what was on screen (my call). After a successful sync the synced file has no stored offset (offset 0). On "Already in sync", the source's stored offset is cleared (my call), because only that offset was making it play out of time. The note then says "Already in sync · offset cleared".
- **Interruption:** changing the subtitle or the file, or closing the player, cancels a running sync. As in milestone 6, main refuses a result for a subtitle other than the one the sync was started for (match on the subtitle `key`).

### Division of work

- **Electron prepares the input and writes the output; the sidecar only measures.** Main writes the selected subtitle's parsed cues (milestone 6's reader: external files, OpenSubtitles downloads and extracted embedded tracks alike), at their original timing, to a temp SRT. It sends that, the video path and the audio stream to the sidecar. The sidecar returns `{ offset, scale, confidence details }`. Main writes the synced file through `subtitles/export.ts`.
  - Why: one SRT writer, and the naming, never-overwrite, ask-to-replace and read-only-folder fallback rules already live in TS. This changes the `subtitle-sync-ml` skill, where the sidecar wrote the output; update the skill.
- `writeSrt` and `exportSynced` take a transform `{ scale, offset }` (displayed = scale·t + offset; positive offset = later) instead of a bare offset. Manual export passes `scale: 1`.
- Drift is baked into the written file, so mpv never needs `sub-speed`. The stored transform for the new synced file is identity.
- **Audio stream:** sync against the audio track currently selected in mpv, mapped to ffmpeg's audio-relative index (`a:<n>`). The builder works out the mapping from the track list (mpv's `ff-index` is already read in `player/tracks.ts`).

### The sidecar

```
sidecar/
  vp_sync/__main__.py   JSON-lines loop on stdin/stdout, logs on stderr
  vp_sync/sync.py       audio extraction + ffsubsync call + confidence
  tests/                pytest
  requirements.txt      pinned (ffsubsync and its deps; no torch, no faster-whisper)
  build.spec            PyInstaller onedir → sidecar/dist/vp-sync/
```

Protocol (the skill's protocol, trimmed):

```jsonc
→ {"id":1,"method":"sync","params":{"video":"…","subtitle":"<temp srt>","audioStream":0}}
← {"id":1,"event":"progress","stage":"audio"|"match","pct":0.42}
← {"id":1,"result":{"offset":3.21,"scale":1.0,"confidence":0.87}}
← {"id":1,"error":{"code":"NO_MATCH"|"NO_AUDIO"|"FFMPEG_FAILED"|"CANCELLED"|"BUSY"|"INTERNAL","message":"…"}}
→ {"id":2,"method":"cancel","params":{"target":1}}
→ {"id":3,"method":"ping"}
```

- One job at a time; a second `sync` while one runs gets `BUSY`.
- ffmpeg path comes in `VP_FFMPEG`.
- **Progress:** reading the audio takes most of the time. The sidecar should report a real percentage for it (for example, extract 16 kHz mono with ffmpeg `-progress` against the known duration, then run ffsubsync on the extracted audio). The exact mechanism is the builder's call. "Matching" can be indeterminate.
- **Cancel** kills the running ffmpeg and abandons the job promptly (under ~1 s).
- **ffsubsync as a library:** call it in-process and read its result numbers (offset, framerate scale factor, success flag, and its alignment score if exposed). Don't parse CLI output. Verify the API against the pinned version. Convert to our sign convention, with a unit test that pins it.
- **Max offset:** search ±120 s. A result at or within a few seconds of the bound is treated as not confident.
- **Confidence:** `NO_MATCH` when ffsubsync reports failure, or the score falls below a threshold. The builder sets the threshold from fixtures so that the correct-subtitle variants pass and the wrong-subtitle fixture fails. The rule and threshold are recorded in the skill.

### Electron side

- `src/main/sync/sidecar.ts`: spawns lazily on the first sync, keeps the process alive, restarts it after a crash (failing any pending job with an error), and kills it on app quit. It's a typed request/response/event client.
- Where the sidecar runs from (in `paths.ts`): dev = `sidecar/.venv/Scripts/python.exe -m vp_sync` (cwd `sidecar/`); packaged = `resources/sidecar/vp-sync/vp-sync.exe`. When neither exists, the result is "Auto sync isn't available".
- IPC: new endpoints in the `subtitles` domain (or a new `sync` domain, builder's call): start (with the subtitle `key`), cancel, plus a progress event to the overlay. Follow `electron-skills`.
- After writing, the new track is added and selected through the same path manual export uses (`addSubtitle` by file key), and its stored offset is cleared.

## Testing

- **Fixtures** (`scripts/make-fixtures.mjs`, following `test-media-fixtures`): a ~5 min `speech.mkv` from Windows SAPI TTS over a test pattern, with a ground-truth `speech.srt`. Variants are written with the TS SRT writer: `shift+3.2`, `shift-7.5`, drift `×25/23.976` and `×23.976/25`, plus a **wrong subtitle** (cues from different text and timing) that must be rejected. No cut variant. Gitignored like the other fixtures.
- **pytest (sidecar):** protocol (ping, sync, BUSY, cancel, malformed input), sign convention, error codes (no audio stream, bad path), and integration on the fixtures. Pass mark: every correct variant recovered with median cue error < 0.10 s and 95th percentile < 0.30 s; the wrong subtitle returns `NO_MATCH`.
- **Vitest:** `writeSrt`/`exportSynced` with a scale; the sidecar client against a fake child process (lazy start, crash restart fails pending, cancel, progress); the result-to-message wording; the audio-index mapping; the start/cancel flow tied to the subtitle key.
- **E2E (Playwright-Electron):** play `speech.mkv` with the shifted subtitle, press A, see the progress card, then the synced track is selected, the file exists next to the video, and the note shows the offset. The wrong subtitle shows the "couldn't sync" note and leaves the track unchanged. Esc during sync cancels it and the player stays open. These need the dev venv; skip with a clear message if it's missing.
- **Packaging check:** `npm run build-sidecar` produces `sidecar/dist/vp-sync/`; the built exe answers `ping` and syncs the shifted fixture from the command line. The NSIS installer itself stays in milestone 9; record the sidecar's licenses (ffsubsync MIT, webrtcvad MIT, numpy/scipy BSD, etc.) for milestone 9's notices.

## Docs to update in the same branch

- `docs/PROJECT_PLAN.md`: decisions (no Whisper, no cuts), the ML sync section, milestone 7 row, verification list (drop the cut and Whisper criteria).
- `CLAUDE.md`: the intro and stack lines (remove Whisper/faster-whisper), setup commands (venv + `build-sidecar`), codebase map (`sidecar/`, `src/main/sync/`).
- `.claude/skills/subtitle-sync-ml`: rewrite for fast-only; Electron writes the output; confidence rule.
- `.claude/skills/test-media-fixtures`: drop the cut variant, add the wrong-subtitle one.

## Left to the builder

- ffsubsync's exact in-process API and the confidence threshold (from fixtures).
- How progress is measured during audio reading.
- Endpoint names and which IPC domain.
- The card's exact layout, within the existing sync card's style (`apple-design`, `emil-design-eng`).

## Needs the user's check (after building)

- Time a real 2-hour film on this laptop: the aim is under ~90 s, with no playback stutter while it runs.
- A real subtitle a few seconds off, and one made for the other framerate.

## As built

- **Accuracy on the speech fixtures:** about 10 ms median and p95 error on every correct copy (shift +3.2 s and −7.5 s; drift 24/23.976, 23.976/25 and 25/23.976).
- **Confidence check:** NO_MATCH when any of these hold:
  - ffsubsync reports failure;
  - |offset| > 115 s;
  - fewer than 20 lines fall inside the audio;
  - z < **8.5**;
  - the best shift is more than 0.5 s off.

  z is the correlation of the retimed subtitle against our own WebRTC speech mask, measured in robust standard deviations above the median over ±120 s. Fixture scores were 13.3–13.9 for correct copies and 3.7 for the wrong-film subtitle. ffsubsync on its own said "success" for the wrong subtitle, so the extra check matters.
- **Speed:** the 7.5 min clip syncs in about 0.25 s. Audio extraction of the 90 min looped clip takes about 2.3 s, which suggests a 2-hour film takes seconds, not minutes. This still needs the user's check on a real film.
- **Bundle:** 58 MB (PyInstaller onedir). auditok (GPLv3) is excluded; licences are listed in `docs/third-party-sidecar.md`.
- **Deviations from the plan:**
  - `subtitles/showSynced.ts` is shared by manual export and auto sync.
  - A local PyInstaller hook for webrtcvad-wheels.
  - `speech-long.mkv` added for E2E tests that act during a sync.
  - The fixture is about 7.5 min, not 5.
  - The "second run asks before replacing" E2E re-syncs the original track. Re-syncing the synced track itself answers "Already in sync · offset cleared", as the design says.
- **Real films may score lower than TTS** (music, effects, SDH lines with no speech). If correct syncs get rejected, re-measure on real films before moving the threshold.
