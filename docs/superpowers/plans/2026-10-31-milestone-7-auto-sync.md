# Milestone 7 — Auto sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the player, **Auto sync** (menu item or **A**) syncs the showing subtitle to the playing audio track, fixing a fixed delay and a framerate drift, and writes and selects `<movie>.<lang>[.sdh|.forced].synced.srt`.

**Architecture:** A Python 3.12 sidecar (`sidecar/vp_sync`) speaks JSON lines on stdio. It extracts 16 kHz mono audio with the vendor ffmpeg (reporting progress), runs ffsubsync in-process for `(offset, scale)`, and scores the result with its own WebRTC-VAD speech mask. Main writes the showing subtitle's parsed cues (original timing) to a temp SRT, calls the sidecar through `src/main/sync/sidecar.ts`, and writes the result with the existing `exportSynced`, now taking a `{ scale, offset }` transform. The overlay shows a progress card and the existing note and Replace prompt.

**Tech Stack:** Python 3.12, ffsubsync, webrtcvad-wheels, numpy, pytest, PyInstaller (onedir); Electron 45, React 19/TS, Vitest, Playwright-Electron.

**Spec:** `docs/superpowers/specs/2026-10-31-milestone-7-auto-sync-design.md`

## Global Constraints

- No speech recognition: no faster-whisper, no torch, no model download, anywhere.
- No cuts or piecewise sync: one `{ scale, offset }` per sync. Displayed time = `scale * t + offset`; positive offset = later.
- It runs only when the user asks for it (menu item or **A**), never automatically.
- The user's original subtitle file is never written. Output goes only through `subtitles/export.ts` (`syncedName`, temp + rename, ask before replacing, read-only fallback dir).
- The sidecar venv is `sidecar/.venv` on **Python 3.12** (`py -3.12`). Pin exact versions in `sidecar/requirements.txt` (dev-only tools in `sidecar/requirements-dev.txt`).
- The ffmpeg path reaches the sidecar only through env `VP_FFMPEG`. Set `PYTHONIOENCODING=utf-8` and `PYTHONUNBUFFERED=1` on the child process.
- Search range is ±120 s; a result with |offset| > 115 s is `NO_MATCH`.
- "Already in sync" when |offset| < 0.05 s and scale is exactly 1 (after snapping). Nothing is written, and the source's stored offset is cleared if non-zero.
- Note copy: `Synced · 3.2 s later` / `Synced · 1.4 s earlier` (one decimal) / `Synced · 3.2 s later, speed 25 → 23.976 fps` / `Synced · speed 25 → 23.976 fps` (offset under 0.05 s) / `Already in sync` / `Already in sync · offset cleared` / `Couldn't sync this subtitle confidently` / `This video has no audio to sync to` / `Auto sync isn't available` / `Picture subtitles can't be auto-synced`. When the file went to the fallback folder, append ` · saved in the app's folder`. The sign follows the applied correction: a subtitle that was 3.2 s late gives offset −3.2 → `Synced · 3.2 s earlier`.
- Card copy: title `Syncing subtitles…`; stages `Reading audio` then `Matching`; hint `Esc cancel`.
- The Replace prompt (`ConfirmCard`, existing copy) comes **after** a successful sync, never before. Main holds one pending result keyed by subtitle `key`.
- Edit files with the Edit tool (CRLF). In E2E, pick the main window by URL, close with `closeApp`, call `toSecondDisplay(app)`, and copy fixtures to a temp dir before writing.

## Review Focus

1. **Non-ASCII and spaced paths** (`Amélie (2001).mp4`) through the JSON line, Python and ffmpeg on Windows. → pytest in Task 3 (`test_sync_unicode_path`).
2. **The player closes or the next episode starts mid-sync.** The job is cancelled, and a late result writes no file and selects nothing. → Vitest in Task 6 (`a result for a subtitle no longer showing writes nothing`).
3. **The sidecar is missing (no venv) or crashes mid-job.** The note says `Auto sync isn't available`, and the next press respawns it. → Vitest in Task 5 (`missing command rejects UNAVAILABLE`, `crash fails the pending job and the next sync respawns`).
4. **Second audio track selected, or no audio at all.** Sync against the selected stream; no audio gives the no-audio note. → Vitest in Task 6 (`audioStreamIndex`), pytest in Task 3 (`test_no_audio`).
5. **A tiny subtitle** (a forced track with 6 lines): never a confident sync. → pytest in Task 3 (`test_too_few_cues_is_no_match`).

---

### Task 1: Sidecar scaffold and JSON-lines protocol

**Files:**
- Create: `sidecar/vp_sync/__init__.py`, `sidecar/vp_sync/__main__.py`, `sidecar/vp_sync/protocol.py`, `sidecar/requirements.txt`, `sidecar/requirements-dev.txt`, `sidecar/pytest.ini`, `sidecar/tests/test_protocol.py`, `scripts/setup-sidecar.mjs`
- Modify: `package.json` (scripts `setup-sidecar`, `test:sidecar`)

**Interfaces:**
- Produces: `Server(run_job: Callable[[dict, Callable[[str, float|None], None], threading.Event], dict], out: TextIO)` in `protocol.py` with `handle_line(line: str) -> None`. `run_job(params, progress, cancelled)` returns `{"offset", "scale", "score"}` or raises `SyncError(code, message)` (defined in `protocol.py`). `__main__` wires `Server(sync.run, sys.stdout)` over `sys.stdin` lines (Task 3 provides `sync.run`; until then `__main__` uses a stub that raises `SyncError("INTERNAL", "not built")`).
- Wire format: as in the spec, with the result `{"offset": float, "scale": float, "score": float}`. Error codes: `NO_MATCH`, `NO_AUDIO`, `FFMPEG_FAILED`, `CANCELLED`, `BUSY`, `INTERNAL`. Progress: `{"id", "event": "progress", "stage": "audio"|"match", "pct": float|null}`.

- [ ] **Step 1:** `scripts/setup-sidecar.mjs`: creates `sidecar/.venv` with `py -3.12 -m venv` if missing, then pip-installs both requirement files. `requirements.txt`: `ffsubsync`, `webrtcvad-wheels`, `numpy` pinned to the current versions that install on 3.12 (check `pip install` succeeds, then pin with `==`). Dev: `pytest`, `pyinstaller`. npm scripts: `"setup-sidecar": "node scripts/setup-sidecar.mjs"`, `"test:sidecar": "sidecar\\.venv\\Scripts\\python -m pytest sidecar/tests -q"`. Run `npm run setup-sidecar`.
- [ ] **Step 2: Write failing tests** in `test_protocol.py`. Drive `Server` with a fake `run_job` and a `StringIO`, parse each output line as JSON:
  - `test_ping`: `{"id":3,"method":"ping"}` → `{"id":3,"result":"pong"}`.
  - `test_sync_result`: the fake emits `progress("audio", 0.5)` and returns `{"offset":3.2,"scale":1.0,"score":12.0}` → a progress line, then `{"id":1,"result":{...}}`.
  - `test_busy`: a second `sync` while the first blocks → `{"id":2,"error":{"code":"BUSY",…}}`.
  - `test_cancel_answers_within_1s`: cancel a blocking job → `CANCELLED` for id 1 within 1 s, and the fake's `cancelled` event is set.
  - `test_sync_after_cancel_is_accepted`: after a cancel, a new `sync` is not `BUSY` (it starts once the abandoned job returns, and the abandoned job's result is never written).
  - `test_sync_error`: `SyncError("NO_MATCH","…")` → error line with that code.
  - `test_bad_json` / `test_unknown_method`: one `INTERNAL` error line (`id` null for bad JSON); the server keeps running.
  - `test_unexpected_exception`: a `ValueError` in the job → `INTERNAL` with the message; logs go to stderr, never stdout.
- [ ] **Step 3:** Run `npm run test:sidecar`. Expect FAIL (no module).
- [ ] **Step 4:** Implement `protocol.py`: the job runs on a worker thread, stdout writes are serialized by a lock, and each line is flushed.
- [ ] **Step 5:** Run `npm run test:sidecar`. Expect PASS. Also run `echo {"id":1,"method":"ping"} | sidecar\.venv\Scripts\python -m vp_sync` from `sidecar/` and expect `{"id": 1, "result": "pong"}`.
- [ ] **Step 6:** Commit `feat(sidecar): JSON-lines protocol and venv setup`.

### Task 2: Speech fixtures and the confidence score

**Files:**
- Create: `tests/fixtures/lines.txt` (committed: about 80 natural sentences of 3–12 words), `sidecar/vp_sync/signals.py`, `sidecar/tests/test_signals.py`
- Modify: `scripts/make-fixtures.mjs`, `.claude/skills/test-media-fixtures/SKILL.md` (variant table: drop `cut45` and `wronglang`, add `wrong`)

**Interfaces:**
- Produces fixtures in `tests/fixtures/media/`: `speech.mkv` (about 5 min, testsrc2 video plus one audio track of SAPI TTS lines over pink noise), `speech.srt` (ground truth), and variants written from the same in-memory cue list by the script's single SRT formatter: `speech.shift+3.2.srt`, `speech.shift-7.5.srt`, `speech.drift1001.srt` (scale 24/23.976), `speech.pal.srt` (scale 23.976/25), `speech.ntsc.srt` (scale 25/23.976), `speech.wrong.srt` (other lines from `lines.txt` with timings from a different random seed, same count), `speech.few.srt` (the first 6 ground-truth cues only). Also `speech-noaudio.mkv` (video only, 10 s).
- Produces in `signals.py`:
  - `FRAME_S = 0.01`
  - `cue_mask(cues: list[tuple[float, float]], n_frames: int, scale: float = 1.0, offset: float = 0.0) -> np.ndarray[bool]`
  - `speech_mask(pcm: np.ndarray[int16], rate: int = 16000, mode: int = 2) -> np.ndarray[bool]` (webrtcvad, 10 ms frames)
  - `score(speech: np.ndarray, subs: np.ndarray, max_shift_s: float = 120) -> tuple[float, int]` returns `(z, peak_shift_frames)`
  - `MIN_CUES = 20`; `enough_cues(cues: list[tuple[float, float]], duration_s: float) -> bool` (at least `MIN_CUES` cues starting inside the audio)

- [ ] **Step 1:** Extend `make-fixtures.mjs` to make the files above, following the skill's speech recipe (PowerShell `System.Speech` per line, measured with ffprobe, ffmpeg concat with silences of 0.8–4 s and `anoisesrc=color=pink:amplitude=0.02`). Use a fixed seed. Keep the "only missing files are made" behaviour. Run `node scripts/make-fixtures.mjs` and check that `speech.mkv` is about 5 min and `speech.srt` has the cue count of the lines used.
- [ ] **Step 2: Write failing tests** in `test_signals.py` (synthetic, no audio):
  - `test_cue_mask_applies_transform`: cue (1.0, 2.0) with scale 2, offset 0.5 sets frames 250–449 only.
  - `test_score_peaks_at_zero_when_aligned`: random speech blocks plus the identical subtitle mask → `peak_shift_frames == 0`, `z > 10`.
  - `test_score_finds_the_shift`: subtitle mask shifted by 300 frames → `peak_shift_frames == 300` (sign: the subtitle is late).
  - `test_score_low_for_unrelated`: two independent random block patterns → `z < 5`.
  - `test_enough_cues`: `enough_cues(cues, duration_s)` is False for 6 cues, and False for 20 cues that start after the audio ends. It is True for 20 cues inside the audio.
- [ ] **Step 3:** Run `npm run test:sidecar`. Expect FAIL.
- [ ] **Step 4:** Implement `signals.py`. The score algorithm (it isn't determined by the signature):
  ```
  s = 2*speech-1, u = 2*subs-1 (float32, padded to the same length)
  corr[k] = Σ s[t]·u[t-k] for |k| ≤ max_shift_s/FRAME_S, via numpy FFT
  peak = argmax(corr)
  z = (corr[0] - median(corr)) / (1.4826 * MAD(corr))   # how far "as aligned" stands out
  return z, peak_shift_frames(peak)
  ```
- [ ] **Step 5:** Run `npm run test:sidecar`. Expect PASS.
- [ ] **Step 6:** Commit `test: speech fixtures; feat(sidecar): speech masks and alignment score`.

### Task 3: Sidecar sync job (audio, ffsubsync, decision)

**Files:**
- Create: `sidecar/vp_sync/sync.py`, `sidecar/tests/test_sync.py`, `sidecar/tests/conftest.py` (fixture paths; skip the module with a clear reason if `tests/fixtures/media/speech.mkv` or `vendor/ffmpeg/ffmpeg.exe` is missing)
- Modify: `sidecar/vp_sync/__main__.py` (use `sync.run`), `.claude/skills/subtitle-sync-ml/SKILL.md` (rewrite: fast-only, Electron writes the output, this decision rule and the measured threshold)

**Interfaces:**
- Consumes: `Server`/`SyncError` (Task 1), `signals.*` (Task 2).
- Produces: `run(params: dict, progress, cancelled: threading.Event) -> dict` with `params = {"video": str, "subtitle": str, "audioStream": int, "durationS": float|None}`.
- Also `snap_scale(scale: float) -> float`: snaps to 1, 24/23.976, 23.976/24, 25/23.976, 23.976/25, 25/24 and 24/25 when within 0.0005 relative; otherwise it returns the input unchanged.

- [ ] **Step 1: Write failing tests** in `test_sync.py`. Run `run()` on the fixtures. Measure cue error by applying the returned transform to each variant's cues and comparing with `speech.srt` (parse with the `srt` package, an ffsubsync dependency):
  - `test_recovers[shift+3.2|shift-7.5|drift1001|pal|ntsc]`: median absolute cue error < 0.10 s and p95 < 0.30 s.
  - `test_ground_truth_is_in_sync`: `speech.srt` itself → |offset| < 0.05, `scale == 1.0`.
  - `test_wrong_subtitle_is_no_match`: raises `SyncError` with code `NO_MATCH`.
  - `test_too_few_cues_is_no_match`: `speech.few.srt` → `NO_MATCH`.
  - `test_no_audio`: `speech-noaudio.mkv` → `NO_AUDIO`.
  - `test_missing_video`: a non-existent path → `FFMPEG_FAILED`.
  - `test_sync_unicode_path`: copy `speech.mkv` and `speech.shift+3.2.srt` into `tmp_path / "Amélie dir" / "Amélie (2001).mkv"` and run it end to end through `Server` and the real `__main__` subprocess (UTF-8 JSON on stdin). Expect it to be recovered.
  - `test_progress_reports_audio_pct`: progress callbacks include `("audio", p)` with p rising from below 0.2 to 1.0, then `("match", None)`.
  - `test_cancel_stops_ffmpeg`: set `cancelled` 0.3 s in → `CANCELLED` raised within 1 s, and no ffmpeg child is left running.
  - `test_snap_scale`: 1.04271 → 25/23.976, 1.0003 → 1.0, 1.02 → 1.02.
- [ ] **Step 2:** Run `npm run test:sidecar`. Expect FAIL.
- [ ] **Step 3:** Implement `run` in this order:
  1. Read the subtitle with `srt`.
  2. Extract `-map 0:a:<audioStream> -ac 1 -ar 16000` to a temp WAV with `-progress pipe:1`. Turn `out_time_us / durationS` into `progress("audio", pct)`. Poll `cancelled` and kill ffmpeg on cancel. A missing stream maps to `NO_AUDIO` (probe the stream count first with ffmpeg `-i` output, or catch ffmpeg's "matches no streams"); any other ffmpeg failure is `FFMPEG_FAILED`.
  3. `progress("match", None)`.
  4. Call ffsubsync in-process on the WAV (verify the pinned version's API: `ffsubsync.ffsubsync.make_parser().parse_args([...])` and `run(args)` returning `offset_seconds`, `framerate_scale_factor` and `sync_was_successful`; use `--max-offset-seconds 120`, `--vad webrtc`, `--ffmpeg-path <dir of VP_FFMPEG>`, and an `--output` in the temp dir). Snap the scale.
  5. Decide `NO_MATCH` if any of these hold: not `sync_was_successful`, |offset| > 115, `not enough_cues`, or the score of the transformed cue mask against `speech_mask(wav)` has `z < THRESHOLD` or |peak_shift| > 50 frames.
  6. Return `{"offset", "scale", "score": z}`. Delete the temp files in `finally`.
  - Pin the sign convention with `test_recovers[shift+3.2]`: the returned offset for a subtitle that is 3.2 s late is about −3.2.
- [ ] **Step 4: Set `THRESHOLD`.** Print `z` for every variant and for `wrong` (`pytest -s`). Set it midway between the lowest correct-variant z and the wrong z, and require that the lowest correct z is at least twice the wrong z. If the margin is thinner than that, stop and report it instead of tuning toward the fixtures. Record the observed values and the threshold in the skill.
- [ ] **Step 5:** Run `npm run test:sidecar`. Expect all PASS.
- [ ] **Step 6:** Commit `feat(sidecar): sync job with ffsubsync and a confidence check`.

### Task 4: Exports take a transform

**Files:**
- Modify: `src/shared/subtitleTiming.ts` (add `export type Transform = { scale: number; offset: number }`), `src/main/subtitles/srt.ts`, `src/main/subtitles/export.ts`, `src/main/subtitles/setup.ts` (manual export passes `{ scale: 1, offset: sub.offset }`)
- Test: the existing `srt` and `export` test files

**Interfaces:**
- Produces: `writeSrt(cues: ParsedCue[], t: Transform): string`; `exportSynced({ …, transform: Transform, … })` (replaces `offset`).

- [ ] **Step 1: Write failing tests.**
  - `writeSrt applies scale then offset`: cue 10.000–12.000 with `{ scale: 25/23.976, offset: -1 }` → `00:00:09,427 --> 00:00:11,513`.
  - `writeSrt with scale 1 matches the old offset output`: the existing offset cases, rewritten to pass `{ scale: 1, offset }`.
  - `exportSynced writes a scaled file`.
- [ ] **Step 2:** Run `npx vitest run src/main/subtitles`. Expect FAIL.
- [ ] **Step 3:** Implement, update all callers, and keep clamping and dropping on the transformed times.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit `feat: synced export takes a scale and offset`.

### Task 5: Electron sidecar client

**Files:**
- Create: `src/main/sync/sidecar.ts`, `src/main/sync/sidecar.test.ts`
- Modify: `src/main/paths.ts` (`sidecarCommand`), `src/main/paths.test.ts` (if present, else add tests to the new file)

**Interfaces:**
- Produces:
  ```ts
  export type SidecarCode = 'NO_MATCH' | 'NO_AUDIO' | 'FFMPEG_FAILED' | 'CANCELLED' | 'BUSY' | 'INTERNAL' | 'UNAVAILABLE'
  export class SidecarError extends Error { constructor(public code: SidecarCode, message: string) }
  export type SyncProgress = { stage: 'audio' | 'match'; pct: number | null }
  export type SyncParams = { video: string; subtitle: string; audioStream: number; durationS: number | null }
  export type SyncMeasure = { offset: number; scale: number; score: number }
  export type Sidecar = {
    sync(p: SyncParams, onProgress: (p: SyncProgress) => void): Promise<SyncMeasure>
    cancel(): void
    dispose(): void
  }
  export function createSidecar(opts: { command: { cmd: string; args: string[]; cwd: string } | null; ffmpeg: string; spawn?: typeof import('node:child_process').spawn; log?: (line: string) => void }): Sidecar
  // paths.ts
  export function sidecarCommand(base: string, packaged: boolean, exists: (p: string) => boolean): { cmd: string; args: string[]; cwd: string } | null
  ```
  Dev: `{ cmd: <base>/sidecar/.venv/Scripts/python.exe, args: ['-m', 'vp_sync'], cwd: <base>/sidecar }`. Packaged: `{ cmd: binaryPath('sidecar', base), args: [], cwd: dirname(cmd) }`. `null` when the executable doesn't exist.

- [ ] **Step 1: Write failing tests** with a fake `spawn` (an EventEmitter child with PassThrough stdin, stdout and stderr):
  - `does not spawn until the first sync`
  - `sends one JSON line and resolves the result`
  - `forwards progress events`
  - `maps an error line to SidecarError with its code`
  - `cancel sends cancel for the running id`
  - `missing command rejects UNAVAILABLE`: `command: null`.
  - `spawn error (ENOENT) rejects UNAVAILABLE`
  - `crash fails the pending job and the next sync respawns`: rejects with `INTERNAL`, and spawn is called twice.
  - `stderr goes to log, never parsed`
  - `passes VP_FFMPEG, PYTHONIOENCODING and PYTHONUNBUFFERED`
  - `dispose kills the child`
  - `sidecarCommand dev, packaged and missing`
- [ ] **Step 2:** Run `npx vitest run src/main/sync src/main/paths`. Expect FAIL.
- [ ] **Step 3:** Implement. Read stdout by line (accept `\r\n`) and ignore lines that aren't JSON (log them).
- [ ] **Step 4:** Run `npx vitest run src/main/sync src/main/paths`. Expect PASS.
- [ ] **Step 5:** Commit `feat: sidecar client in main`.

### Task 6: Auto sync in main (job flow, IPC, wording)

**Files:**
- Create: `src/shared/autoSync.ts` (+ `.test.ts`), `src/main/sync/autoSync.ts` (+ `.test.ts`)
- Modify: `src/main/player/tracks.ts` (`audioStreamIndex`), `src/main/player/service.ts` (`currentAudio()`), `src/shared/api.ts` (endpoints and event), `src/shared/appError.ts` (codes `sync_unavailable`, `sync_no_audio`), `src/main/subtitles/setup.ts` (wire the endpoints), `src/main/index.ts` (create the sidecar from `sidecarCommand(…)` with `ffmpeg = binaryPath('ffmpeg', binaryBase)`; dispose it on `will-quit`)

**Interfaces:**
- Produces in `src/shared/autoSync.ts`:
  ```ts
  export type AutoSyncOutcome =
    | { status: 'synced'; offset: number; scale: number; saved: string; fallback: boolean }
    | { status: 'exists'; offset: number; scale: number; name: string }   // a pending result is held
    | { status: 'inSync'; clearedOffset: boolean }
    | { status: 'noMatch' }
    | { status: 'cancelled' }
  export type AutoSyncProgress = { key: string; stage: 'audio' | 'match'; pct: number | null }
  export function describeSync(o: { offset: number; scale: number; fallback?: boolean }): string   // the Synced · … copy
  export function describeOutcome(o: AutoSyncOutcome): string | null   // null for 'exists' and 'cancelled'
  ```
- `api.ts`, `subtitles` domain: `autoSync: (p: { key: string }) => Promise<AutoSyncOutcome>`, `autoSyncReplace: (p: { key: string }) => Promise<AutoSyncOutcome>`, `autoSyncCancel: (p: Record<string, never>) => Promise<void>`. Event: `'subtitles.autoSyncProgress': AutoSyncProgress`.
- `tracks.ts`: `audioStreamIndex(audio: Track[], audioId: number | null): number | null`, the position of `audioId` among non-external audio tracks in mpv order (mpv numbers each type's tracks in stream order, so this is ffmpeg's `a:<n>`). Returns null when there's no audio or the track is external.
- `PlayerService.currentAudio(): { audioStream: number | null; durationS: number | null } | null`.
- `createAutoSync(deps: { player: Pick<PlayerService, 'currentSubtitle' | 'subtitleCues' | 'currentAudio' | 'current' | 'addSubtitle' | 'resetSubtitleTiming'>; sidecar: Sidecar; db: Db; userDataPath: string; tempDir: string; emit: (p: AutoSyncProgress) => void }): { start(key: string): Promise<AutoSyncOutcome>; replace(key: string): Promise<AutoSyncOutcome>; cancel(): void }`

- [ ] **Step 1: Write failing tests.**
  - `describeSync`: `{3.2,1}` → `Synced · 3.2 s later`; `{-1.44,1}` → `Synced · 1.4 s earlier`; `{3.2,25/23.976}` → `Synced · 3.2 s later, speed 25 → 23.976 fps`; `{0.01,23.976/25}` → `Synced · speed 23.976 → 25 fps`; an unknown scale of 1.02 → `…, speed adjusted`; `fallback` adds ` · saved in the app's folder`.
  - `describeOutcome`: `inSync` with and without a cleared offset, and `noMatch`, give the global copy; `exists` and `cancelled` give null.
  - `audioStreamIndex`: second of two internal audio tracks → 1; external → null; none → null.
  - `createAutoSync` with fake player and sidecar, and a real temp dir:
    - `writes the source cues at original timing to a temp SRT`: the stored offset is ignored, and the temp file is deleted afterwards.
    - `synced: exports with the transform, clears the new file's offset, adds the track`
    - `in sync with a stored offset clears it`: `resetSubtitleTiming` is called, and the outcome is `{ inSync, clearedOffset: true }`.
    - `exists holds the result; replace writes it without calling the sidecar again`
    - `replace for another key or with nothing pending refuses` (`invalid_argument`).
    - `a result for a subtitle no longer showing writes nothing`: the key changes while the sidecar runs → `cancelled`, no file, no `addSubtitle`.
    - `NO_MATCH → noMatch`; `CANCELLED → cancelled`; `NO_AUDIO` and null `audioStream` → AppError `sync_no_audio`; `UNAVAILABLE` and `INTERNAL` → AppError `sync_unavailable`.
    - `picture subtitle refuses` (`Picture subtitles can't be auto-synced`).
    - `progress is emitted with the key`
    - `a new start drops any pending result`
- [ ] **Step 2:** Run `npx vitest run src/shared src/main/sync src/main/player`. Expect FAIL.
- [ ] **Step 3:** Implement. Copy the AppError messages from Global Constraints. Use the same `fallbackDir` as manual export. After writing, add the track with `{ path, lang, kind, format: 'srt', synced: true }` and `{ remember: false }`, exactly as manual export does.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit `feat: auto sync job and IPC`.

### Task 7: Overlay — Auto sync item, A key, progress card

**Files:**
- Create: `src/renderer/overlay/AutoSyncCard.tsx`, `tests/e2e/autoSync.spec.ts`
- Modify: `src/renderer/overlay/ControlBar.tsx` (`SubtitleAction` adds `'auto'`; item `Auto sync` placed before `Sync to a line…`, shown for picture subtitles too), `src/renderer/overlay/Overlay.tsx`, `src/renderer/overlay/overlay.css`

**Interfaces:**
- Consumes: Task 6 endpoints, event, `describeOutcome` and `describeSync`.
- `AutoSyncCard({ progress: AutoSyncProgress | null, onCancel: () => void })`: `data-testid="auto-sync-card"`, `role="status"`. It shows the title, the stage label, and a bar (`--progress` scaleX, indeterminate while `pct` is null). It listens for **Escape only** in the capture phase (`stopImmediatePropagation`). Every other key reaches the player.

- [ ] **Step 1: Write the failing E2E** `autoSync.spec.ts`. Copy `speech.mkv` as `Speech Test (2020).mkv` plus `speech.shift+3.2.srt` as `Speech Test (2020).en.srt` into a temp library, as `subtitleSync.spec.ts` sets up its library. Skip with a reason if `sidecar/.venv` is missing.
  - `A syncs the subtitle and selects the synced file`: wait for the position to move, press A, see `auto-sync-card`, then the note text matches `/^Synced · 3\.2 s earlier/`. `Speech Test (2020).en.synced.srt` exists in the temp dir, and the selected subtitle's label ends with `· Synced`.
  - `pressing A again asks before replacing`: with the synced track showing and nudged by H five times, A → the `ConfirmCard` appears after the card closes; Replace → note `Synced · …`, and the file's modified time changes.
  - `a wrong subtitle leaves timing alone`: with `speech.wrong.srt`, note `Couldn't sync this subtitle confidently`, no synced file, same track.
  - `Esc cancels the sync, the player stays open`: the card disappears, `player-close` is still visible, and no synced file is written.
  - `playback keys work while syncing`: Space pauses during the card.
- [ ] **Step 2:** Run `npm run test:e2e -- autoSync`. Expect FAIL.
- [ ] **Step 3:** Implement in `Overlay.tsx`:
  - `autoSync` state (`{ key, progress } | null`).
  - Case `a`/`A` (not on repeat, needs a showing subtitle, ignored while a job runs).
  - `onSubtitleAction('auto')`.
  - Picture subtitle → `say('Picture subtitles can't be auto-synced')`.
  - Outcome `exists` → `setConfirm` with a `kind: 'auto'` flag, so Replace calls `autoSyncReplace` instead of `exportSynced`.
  - Errors through `sayError`.
  - The subtitle/file-change branch and `player.closed` call `autoSyncCancel` when a job is running, and clear the card.
  - Card placement and style follow `.sync-card` (`apple-design`, `emil-design-eng`); honour reduced motion for the bar.
- [ ] **Step 4:** Run `npm run test:e2e -- autoSync subtitleSync subtitles` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit `feat: auto sync in the player`.

### Task 8: Package the sidecar

**Files:**
- Create: `sidecar/build.spec`, `sidecar/vp_sync/entry.py` (the PyInstaller entry point calling `__main__`'s loop), `docs/third-party-sidecar.md` (each bundled Python package with its version and licence, for milestone 9's notices)
- Modify: `package.json` (script `"build-sidecar": "sidecar\\.venv\\Scripts\\pyinstaller sidecar/build.spec --noconfirm --distpath sidecar/dist --workpath sidecar/build"`), `.claude/skills/release-windows/SKILL.md` (only if a command or path differs)

- [ ] **Step 1:** Write `build.spec`: onedir, name `vp-sync`, console app, `excludes=['torch', 'tkinter', 'matplotlib', 'IPython']`, and collect ffsubsync's data files if it has any.
- [ ] **Step 2:** Run `npm run build-sidecar`. Expect `sidecar/dist/vp-sync/vp-sync.exe`. Record the folder size; it should be well under 100 MB. Report it if it's bigger.
- [ ] **Step 3: Smoke test.** Run `echo {"id":1,"method":"ping"} | sidecar\dist\vp-sync\vp-sync.exe` and expect `pong`. Then send a `sync` line for `speech.mkv` + `speech.shift+3.2.srt` with `VP_FFMPEG` set, and expect a result with an offset of about −3.2.
- [ ] **Step 4:** Add `test_built_exe_syncs` to `test_sync.py`, skipped unless `sidecar/dist/vp-sync/vp-sync.exe` exists. It runs step 3 through `subprocess`. Run `npm run test:sidecar` and expect PASS.
- [ ] **Step 5:** Write `docs/third-party-sidecar.md` from `pip-licenses`-style output, or by reading each package's metadata.
- [ ] **Step 6:** Commit `build: package the sync sidecar with PyInstaller`.

### Task 9: Docs and the decisions record

**Files:**
- Modify: `docs/PROJECT_PLAN.md` (Decisions: no Whisper, no cuts; the ML sync section; architecture lines 26–34 and 89–93; the verification list), `CLAUDE.md` (intro and stack without Whisper; setup adds `npm run setup-sidecar`, `npm run test:sidecar`, `npm run build-sidecar`; codebase map adds `sidecar/` and `src/main/sync/`; a gotcha if one was learned), `docs/superpowers/specs/2026-10-31-milestone-7-auto-sync-design.md` (an "As built" section with the threshold, the bundle size, and deviations)

- [ ] **Step 1:** Make the edits. Don't mark the milestone ✅ yet; that happens after review and verification.
- [ ] **Step 2:** Run `npm run typecheck`, `npm test`, `npm run test:sidecar` and `npm run test:e2e`. Expect all green, and report the counts.
- [ ] **Step 3:** Commit `docs: milestone 7 auto sync as built`.
