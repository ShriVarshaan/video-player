---
name: subtitle-sync-ml
description: The Python sidecar that auto-syncs subtitles to a movie's audio — JSON-lines protocol with Electron, audio extraction, fast sync via ffsubsync (voice activity detection), deep sync via faster-whisper transcription + fuzzy text anchors + RANSAC/piecewise fitting, confidence and fallback rules, model caching, tests/benchmarks, and PyInstaller packaging. Use for any work in sidecar/, src/main/sync/*, the "Auto sync" UI, or sync accuracy problems.
---

# ML subtitle sync (Python sidecar)

```
sidecar/
  vp_sync/__main__.py   # JSON-lines server loop
  vp_sync/audio.py      # ffmpeg → 16 kHz mono
  vp_sync/fast.py       # ffsubsync wrapper
  vp_sync/deep.py       # faster-whisper + alignment
  vp_sync/align.py      # anchors, RANSAC, piecewise
  vp_sync/srt.py        # read/write (mirror the TS parser's rules, see subtitle-formats)
  tests/  bench.py  requirements.txt  build.spec
```

**Python version:** pin **3.11 or 3.12** in a venv (`sidecar/.venv`). Wheels for `ctranslate2`, `webrtcvad-wheels` and others often lag on newer Pythons, even if the system has 3.14.

## Protocol (stdin/stdout, one JSON object per line; logs go to stderr)

```jsonc
→ {"id":1,"method":"sync","params":{"video":"C:\\M\\x.mkv","subtitle":"C:\\M\\x.srt","mode":"fast"|"deep"|"auto","audioStream":0,"language":"en"}}
← {"id":1,"event":"progress","stage":"extract_audio"|"vad"|"transcribe"|"align"|"write","pct":0.42}
← {"id":1,"result":{"scale":1.0,"offset":3.21,"segments":[{"from":0,"scale":1.0,"offset":3.21}],
                    "method":"fast","confidence":0.91,"output":"C:\\M\\x.synced.srt"}}
← {"id":1,"error":{"code":"NO_SPEECH"|"NO_MATCH"|"FFMPEG_FAILED"|"MODEL_DOWNLOAD_FAILED"|"CANCELLED"|"INTERNAL","message":"..."}}
→ {"id":2,"method":"cancel","params":{"target":1}}      → {"id":3,"method":"ping"}
```

- One job at a time. Reject a second `sync` with an error unless the first is cancelled.
- Electron side (`src/main/sync/sidecar.ts`): spawn the process lazily, keep it alive, restart it if it crashes, and fail any pending request.
- The sidecar never overwrites the original file. Output is always `<video>.synced.srt`, and Electron applies the returned transform straight away.

## Audio extraction
```
ffmpeg -nostdin -v error -i <video> -map 0:a:<audioStream> -ac 1 -ar 16000 -f s16le -
```
- Read the output into a NumPy `int16` array, or write a temp WAV for the deep path.
- Use `ffmpeg` from `vendor/`. Its path is passed by Electron as the env var `VP_FFMPEG`.

## Fast mode (default): ffsubsync
- Call it as a library and request the numbers. Don't parse its CLI output. Its `run(args)` returns a dict with `offset_seconds`, `framerate_scale_factor` and `sync_was_successful`; check that this still holds for the pinned version.
- Args: `reference=<video>`, `srtin=<sub>`, `srtout=<tmp>`, `vad="webrtc"`, `reference_stream="a:<n>"`, `ffmpeg_path=<dir of VP_FFMPEG>`, `max_offset_seconds=120`.
- Result: `scale = framerate_scale_factor` and `offset = offset_seconds`, then convert to our convention (displayed = scale·t + offset). Write a unit test for the sign convention.

## When to fall back (mode `"auto"`)
Escalate from fast to deep when any of these is true:
- `sync_was_successful` is false
- `|offset| > 110 s`
- the user previously rejected the fast result for this file

Otherwise accept fast. The UI also has an explicit **Deep sync** button.

## Deep mode: faster-whisper + alignment
1. **Transcribe:**
   ```python
   WhisperModel(size, device="cuda" if cuda_ok else "cpu",
                compute_type="float16" if cuda_ok else "int8",
                download_root=<models dir>)
   ```
   - Model size: default `small`, user option `medium`.
   - Call `transcribe(audio, word_timestamps=True, vad_filter=True, language=hint or None)`.
   - Report progress as `segment.end / duration`.
   - Models are cached in `%APPDATA%/<app>/models`, passed in as `VP_MODELS_DIR`. If the download fails, return `MODEL_DOWNLOAD_FAILED` with a retry hint.
2. **Normalize text** on both sides:
   - lowercase, NFKD, strip punctuation
   - remove `♪`, `[bracketed sounds]`, `(parentheticals)` and `NAME:` speaker labels
   - collapse whitespace
   - drop cues with fewer than 2 words
3. **Anchors:** for each cue, search transcript windows (runs of words, length = cue words ± 2).
   - If a fast-mode offset exists, search only ±30 s around `fast_offset + cue.start`. Otherwise search the whole transcript.
   - Score with `rapidfuzz.fuzz.ratio` on the joined strings.
   - Keep the best window if its score is ≥ 80 **and** beats the runner-up by ≥ 8. Ambiguous lines are dropped.
   - Anchor = `(cue.start, first_word.start)`.
4. **Global fit (RANSAC):**
   - Repeat 500 times: pick 2 anchors at least 60 s apart, compute `(scale, offset)`, and reject `scale` outside `[0.95, 1.05]`.
   - Inliers are anchors with residual < 0.4 s.
   - Refine with least squares on the best inlier set, then snap `scale` to known framerate ratios (see `subtitle-formats`).
5. **Piecewise (cuts, ad breaks, different editions):**
   - Walk anchors in time order. Where residuals against the global fit shift by more than 1 s and stay shifted for ≥ 6 consecutive anchors, start a new segment.
   - Each segment shares `scale` and gets its own `offset`.
   - Return `segments`. The SRT writer applies the matching segment per cue, and cues between segments use the nearer one.
6. **Confidence** = inliers / cues with ≥ 2 words.
   - Return `NO_MATCH` if there are fewer than 20 inliers or confidence < 0.25. Usual causes: wrong-language subtitles or the wrong movie.
   - Check the language first: if Whisper's detected language differs from the subtitle language (judged by common stopwords), return `NO_MATCH` with that reason.

## Testing and benchmark
- Fixtures come from the `test-media-fixtures` skill: a TTS speech track with known-good SRT, plus copies shifted (+3.2 s), drifted (×1.001, ×25/23.976) and cut (a 45 s gap inserted halfway).
- Pass criteria:
  - median absolute cue error < 0.10 s
  - 95th percentile < 0.30 s
  - fast mode recovers shift and drift
  - deep mode also recovers the cut
- Commands:
  - `python -m pytest sidecar/tests -q`
  - `python sidecar/bench.py --dir <folder with movie+good srt pairs>`, which prints a per-file error table
- Unit-test `align.py` with synthetic anchors (pure maths, no audio) so it runs fast in CI.

## Packaging
- Build with PyInstaller **onedir** (`pyinstaller sidecar/build.spec` → `sidecar/dist/vp-sync/`). It starts faster than onefile.
- Include the `ctranslate2` DLLs. `faster-whisper` doesn't need `torch`, so exclude it to save hundreds of MB.
- Don't bundle Whisper models. They download on first use of deep sync, with UI consent showing the size (small ≈ 470 MB).
- electron-builder copies `sidecar/dist/vp-sync/**` into `resources/sidecar` (see `release-windows`).
