# Milestone 6 — Manual sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a subtitle's timing while watching — G/H nudges, "Sync to a line" (press S when the shown line is heard), reset, and export to `<video>.<lang>[.sdh|.forced].synced.srt` — saved per video and subtitle.

**Architecture:** mpv keeps timing every subtitle; the main process applies the stored offset with mpv's `sub-delay` every time the subtitle selection changes. The app gains its own subtitle reader (decode → parse SRT/VTT/ASS → cues) and ffmpeg extraction of embedded text tracks, used only for the sync card's lines and for export. Offsets live in the existing `subtitle_transforms` table (no migration).

**Tech Stack:** Electron 45, React 19/TS, mpv JSON IPC, vendor ffmpeg, `node:sqlite`, Vitest, Playwright-Electron.

**Spec:** `docs/superpowers/specs/2026-10-31-milestone-6-manual-sync-design.md`

## Global Constraints

- Never write to, rename or delete the user's original subtitle file. A `.synced.srt` is replaced only after the user confirms (`replace: true`), via temp file + rename in the same folder.
- Displayed time = `scale * t + offset`; positive offset = subtitles later. Manual sync changes only `offset`; `scale` stays 1.
- Offset clamped to ±600 s. G/H = ∓/± 0.05 s; Shift+G/H = ∓/± 0.5 s.
- Fix stored per `(video_id, subtitle_key)` in `subtitle_transforms` with `source = 'manual'`; `subtitle_key` = `file:<sha1 hex of the original absolute path>` or `embedded:<ff-index>`. No new migration.
- `sub-delay` is set on **every** subtitle selection change (Off → 0).
- Export writes SRT only: `HH:MM:SS,mmm`, UTF-8 without BOM, CRLF, renumbered from 1, `<i>…</i>` for italic cues, `{\an8}` prefix for top cues, times clamped ≥ 0, cues ending ≤ 0 dropped.
- Export does **not** change the title's remembered subtitle (`title_prefs`).
- Note copy: `Subtitles +0.35 s` / `Subtitles −0.35 s` (U+2212) / `Subtitles in sync`; two decimals. Card copy: `Press S when you hear`, hint `← → other lines · Esc cancel`, loading `Reading subtitles…`. Picture subtitle: `Sync to a line needs a text subtitle`. Confirm: `Replace the existing synced subtitles?` (Replace / Cancel). Saved note: `Saved <file name>`.
- Cue text is React text, never HTML. Use `components/Select` patterns, never native `<select>`; edit files with the Edit tool (CRLF).
- E2E picks the main window by URL and closes with `closeApp`; tests that write files copy fixtures to a temp dir first.

## Review Focus

1. **Key repeat on G/H** (held down for a second): every change reaches mpv in order, SQLite isn't written per press, and the final offset is saved even if the player closes within the debounce window. → unit in Task 6 (`flushes a pending nudge on stop`).
2. **Switching subtitle tracks after nudging one**: the other track starts at its own offset (usually 0), and switching back restores the first. → unit in Task 6 (`each subtitle keeps its own delay`).
3. **Next episode / crash respawn**: `sub-delay` from the previous file or before the crash must not leak; it's re-applied from the store. → unit in Task 6 (`a new file resets the delay`, `crash restore re-applies the delay`).
4. **Messy real-world SRT** (BOM, CR-only line ends, missing index, `1:02:03,5`, trailing coordinates, blank lines inside a cue). → unit in Task 1.
5. **Exporting the synced track itself** (the selected subtitle *is* `Movie.en.synced.srt` with a further nudge): it reads before it writes, asks before replacing, and ends with offset 0 on the new file. → unit in Task 5 (`exporting the synced file over itself`).

---

### Task 1: Subtitle reader — decode and parse

**Files:**
- Modify: `src/main/subtitles/decode.ts` (export `decodeSubtitle`; `ensureUtf8` uses it)
- Create: `src/main/subtitles/parse.ts`
- Test: `tests/unit/subtitleParse.test.ts`

**Interfaces:**
- Produces:
  - `decodeSubtitle(buf: Buffer, lang: string | null): string` (same detection order as `ensureUtf8`; BOM stripped).
  - `type ParsedCue = { start: number; end: number; lines: string[]; italic: boolean; top: boolean }` (seconds).
  - `parseSubtitle(text: string): ParsedCue[]` — normalises CRLF/CR, detects by content (`WEBVTT` first line → VTT, `[Script Info]` → ASS, else SRT), cleans (drop empty, `end <= start` → `start + 2`, merge exact duplicates, sort by start).
  - `readSubtitleFile(path: string, lang: string | null): Promise<ParsedCue[]>`.

- [ ] **Step 1: Write the failing tests** — one `it` per rule in `subtitle-formats` → "Loading pipeline": SRT (missing index, `00:01,5` with no hour → 1.5 s, `,5` → .500, trailing `X1:…`, `<i>` → italic, `<b>/<font>` dropped, `{\an8}` → top, other `{\…}` dropped, BOM, CR-only); VTT (header/`NOTE`/`STYLE`/`REGION` skipped, `line:0` → top, `<v Bob>Hi` → `Hi`, `<00:00:01.000>` stripped); ASS (a `Format:` line in a non-default field order, `Text` with commas, `\N` → new line, `\i1` → italic, `\an8` → top, `{\p1}…{\p0}` dropped, a `Sign` style dropped when a `Default` style exists, `H:MM:SS.cc`); cleaning (duplicate layers merged, `end <= start`); `decodeSubtitle` on a cp1252 buffer with `lang = 'fre'` gives `Café`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/subtitleParse.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `parse.ts` and the `decode.ts` export. Keep `ensureUtf8`'s behaviour identical (its existing tests must still pass).
- [ ] **Step 4: Run** `npx vitest run tests/unit/subtitleParse.test.ts tests/unit/subtitleMatch.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: the app's own subtitle reader (SRT, VTT, ASS)`

### Task 2: SRT writer and timing maths (pure)

**Files:**
- Create: `src/shared/subtitleTiming.ts` (shared with the overlay), `src/main/subtitles/srt.ts`
- Test: `tests/unit/subtitleTiming.test.ts`, `tests/unit/srtWriter.test.ts`

**Interfaces:**
- Produces (`src/shared/subtitleTiming.ts`):
  - `MAX_OFFSET_S = 600`, `NUDGE_S = 0.05`, `NUDGE_BIG_S = 0.5`, `REACTION_LEAD_S = 0` (value revisited in Task 9's manual check).
  - `clampOffset(s: number): number` — clamps to ±600 and rounds to the millisecond.
  - `offsetForCue(cueStart: number, positionS: number): number` = `clampOffset(positionS - REACTION_LEAD_S - cueStart)`.
  - `firstCueAfter(starts: number[], offset: number, positionS: number): number` — index of the first cue with `start + offset > positionS`, else the last index; `-1` for no cues.
  - `formatOffset(s: number): string` — `+0.35 s`, `−1.50 s` (U+2212), `in sync` for 0.
- Produces (`src/main/subtitles/srt.ts`): `writeSrt(cues: ParsedCue[], offset: number): string`.

- [ ] **Step 1: Write the failing tests**
  - `clampOffset(700) === 600`, `clampOffset(-0.12349) === -0.123`.
  - `offsetForCue(5, 9) === 4` (with `REACTION_LEAD_S` subtracted: assert `4 - REACTION_LEAD_S`).
  - `firstCueAfter([1,5], 0, 0.5) === 0`, `firstCueAfter([1,5], 0, 1.5) === 1`, `firstCueAfter([1,5], 2, 2.5) === 0`, `firstCueAfter([1,5], 0, 30) === 1`, `firstCueAfter([], 0, 0) === -1`.
  - `formatOffset(0.35) === '+0.35 s'`, `formatOffset(-1.5) === '\u22121.50 s'`, `formatOffset(0) === 'in sync'`.
  - `writeSrt([{start:1,end:4,lines:['Hi','there'],italic:true,top:true}], 2)` === `'1\r\n00:00:03,000 --> 00:00:06,000\r\n{\\an8}<i>Hi\r\nthere</i>\r\n\r\n'`; a cue at 1–2 with offset −3 is dropped; a cue at 1–4 with offset −2 starts at `00:00:00,000`; output has no BOM; `3725.5` formats as `01:02:05,500`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/subtitleTiming.test.ts tests/unit/srtWriter.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: subtitle timing maths and SRT writer`

### Task 3: Stored offsets and subtitle keys

**Files:**
- Create: `src/main/subtitles/transforms.ts`
- Modify: `src/shared/player.ts` (`Track` gains `key: string | null`, `synced: boolean`), `src/main/player/tracks.ts` (`toTracks` fills them), `src/main/subtitles/match.ts` (see below)
- Test: `tests/unit/transforms.test.ts`, `tests/unit/tracks.test.ts` (extend), `tests/unit/subtitleMatch.test.ts` (extend)

**Interfaces:**
- Produces:
  - `subtitleKeyForFile(originalPath: string): string` = `'file:' + sha1hex(originalPath)`; `subtitleKeyForEmbedded(ffIndex: number): string` = `'embedded:' + ffIndex`.
  - `getOffset(db: Db, videoId: number, key: string): number` (0 when no row); `setOffset(db, videoId, key, offset, now: number): void` (upsert, `source='manual'`, `scale=1`; offset 0 deletes the row).
  - `ExternalSub` gains `synced: boolean`; a new `LoadedSub = ExternalSub & { original: string }` (`path` = what mpv was given, `original` = the user's file). `toTracks(trackList, externals: LoadedSub[])`.
  - `parseSubName` returns `{ lang, kind, synced }`; the word `synced` sets `synced` and is never read as a language.
  - `Track.key`: externals → `subtitleKeyForFile(ext.original)`; embedded subs → `subtitleKeyForEmbedded(raw['ff-index'])` when it's a number; audio → `null`. `Track.synced` from the external. Label of a synced track: the usual label + `' · Synced'` (e.g. `English (SDH) · Synced`).
  - `Track` also gains `codec: string | null` (from mpv's `codec`), used by Task 4 to pick the extraction format.

- [ ] **Step 1: Write the failing tests**
  - transforms: `getOffset` 0 for nothing; `setOffset(…, 0.35)` then `getOffset` → 0.35; second `setOffset` updates (one row); `setOffset(…, 0)` removes the row; rows of another key / video untouched; deleting the video cascades.
  - match: `Movie.en.synced.srt` → `{lang:'eng', kind:'plain', synced:true}`; `Movie.fr.sdh.synced.srt` → `{lang:'fre', kind:'sdh', synced:true}`; `Movie.synced.srt` → `lang: null` (then the user's language from `findSubtitles`), `synced: true`; `Movie.en.srt` → `synced:false`.
  - tracks: embedded sub with `'ff-index': 3` → `key === 'embedded:3'`; external → `key === subtitleKeyForFile(original)` (not the cache path); synced external label `English · Synced`, `synced: true`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/transforms.test.ts tests/unit/tracks.test.ts tests/unit/subtitleMatch.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Update the existing callers of `toTracks` / `ExternalSub` (service `addExternals`/`addSubtitle` push `{ ...sub, path: loaded, original: sub.path }`; `subtitles/setup.ts` download passes `synced: false`). `npm run typecheck` must pass.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS (whole unit suite, existing tests adjusted only where the `Track`/`ExternalSub` shape grew).
- [ ] **Step 5: Commit** `feat: per-subtitle stored offsets and synced-file recognition`

### Task 4: Extracting embedded text subtitles

**Files:**
- Create: `src/main/subtitles/extract.ts`
- Test: `tests/unit/subtitleExtract.test.ts` (integration: vendor ffmpeg + `tests/fixtures/media/tracks.mkv`; skip with a clear message if the vendor binary or fixture is missing, like `media.test.ts`)

**Interfaces:**
- Produces:
  - `TEXT_CODECS = new Set(['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'])`.
  - `extractSubtitle(p: { ffmpegPath: string; video: string; ffIndex: number; codec: string; cacheDir: string; signal?: AbortSignal }): Promise<string>` — returns a cached file path. `ass`/`ssa` → `.ass` with `-c:s copy`; others → `.srt` with `-c:s srt`. Args: `-y -v error -i <video> -map 0:<ffIndex> -c:s <…> <tmp>` then rename into place. Cache name = sha1(`video|size|mtimeMs|ffIndex`).16 + ext. Timeout 5 min; `signal` kills ffmpeg.
- Consumes: `readSubtitleFile` (Task 1).

- [ ] **Step 1: Write the failing tests** — `extracts the embedded subtitle of tracks.mkv` (parse result has one cue `Hello there.` from 1 to 19 s); `second call reuses the cached file` (same path, mtime unchanged); `an aborted extraction rejects and leaves no file in the cache` .
- [ ] **Step 2: Run** `npx vitest run tests/unit/subtitleExtract.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** with `execFile` + `windowsHide: true`, like `media/ffmpeg.ts`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: extract embedded text subtitles with ffmpeg`

### Task 5: Export and the synced file standing in

**Files:**
- Create: `src/main/subtitles/export.ts`
- Modify: `src/main/player/tracks.ts` (`preferSynced`), `src/renderer/overlay/ControlBar.tsx` (`subtitleItems` lists synced tracks first)
- Test: `tests/unit/subtitleExport.test.ts`, `tests/unit/tracks.test.ts` (extend)

**Interfaces:**
- Produces:
  - `syncedName(videoPath: string, lang: string | null, kind: TrackKind): string` — `<base>.<toOpenSubtitles(lang)>[.sdh|.forced].synced.srt`, or `<base>.synced.srt` with no language.
  - `exportSynced(p: { videoPath: string; lang: string | null; kind: TrackKind; cues: ParsedCue[]; offset: number; replace: boolean; fallbackDir: string }): Promise<{ saved: string; fallback: boolean } | { exists: string }>` — target next to the video; if it exists and `!replace` → `{ exists }`; writes `writeSrt(cues, offset)` to `<target>.tmp-<random>` in the same folder and renames over the target; `EACCES`/`EPERM`/`EROFS` on the video's folder → same logic in `fallbackDir` (created).
  - `preferSynced(subs: Track[], picked: Track | null): Track | null` — if `picked` is not synced and a synced track with the same `lang` and `kind` exists, return it; else `picked`.

- [ ] **Step 1: Write the failing tests**
  - `syncedName('D:/m/Movie.mkv','eng','plain') === 'Movie.en.synced.srt'`, `('fre','sdh')` → `Movie.fr.sdh.synced.srt`, `(null,'plain')` → `Movie.synced.srt`.
  - writes CRLF SRT with the offset applied next to the video; the source `.en.srt` is byte-identical afterwards.
  - existing target + `replace:false` → `{exists}` and the file unchanged; `replace:true` → replaced; no `.tmp-` files left either way.
  - `exporting the synced file over itself`: cues read from `Movie.en.synced.srt`, export with `replace:true` → file holds the shifted times.
  - read-only folder (make the dir read-only with `chmod 0o555` / `attrib +r`; skip on platforms where that can't block writes) → saved in `fallbackDir`.
  - `preferSynced`: picked plain English + synced English plain → synced; synced English SDH doesn't replace plain English; `null` stays `null`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/subtitleExport.test.ts tests/unit/tracks.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; in `subtitleItems`, stable-sort synced tracks before the rest.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat: export synced subtitles; a synced file stands in for its language`

### Task 6: PlayerService — applying, nudging and syncing

**Files:**
- Create: `src/main/player/subtitleDelay.ts`
- Modify: `src/main/player/service.ts`, `src/main/player/setup.ts`
- Test: `tests/unit/subtitleDelay.test.ts`, `tests/unit/playerService.test.ts` (new `describe('subtitle timing (milestone 6)')`)

**Interfaces:**
- Produces (`subtitleDelay.ts`): `createSubtitleDelay(deps: { db: Db; setDelay(s: number): Promise<void>; emit(offset: number | null): void; now(): number; saveAfterMs?: number /* default 500 */ })` returning:
  - `select(videoId: number, key: string | null): Promise<void>` — flushes any pending save, reads the stored offset (0 for null key), `setDelay`, `emit` (null when key is null).
  - `nudge(deltaS: number): Promise<number | null>` — null when nothing selected; else clamp, `setDelay` at once, debounce the DB write, `emit`, return the new offset.
  - `set(offset: number): Promise<number | null>` (used by sync-to-line and reset); `current(): { videoId: number; key: string; offset: number } | null`; `flush(): void`.
- Produces (`PlayerService` additions):
  - `nudgeSubtitle(deltaS: number): Promise<number | null>`, `resetSubtitleTiming(): Promise<void>`, `syncSubtitleTo(cueStart: number): Promise<number | null>` (reads mpv `time-pos` itself via `get_property`, then `offsetForCue`).
  - `currentSubtitle(): { videoId: number; videoPath: string; track: Track; offset: number } | null` (null when Off).
  - `subtitleCues(): Promise<ParsedCue[]>` — for the selected text track: external → `readSubtitleFile(original, lang)`; embedded → `extractSubtitle` then parse; cached per `(videoId, key)` for the current file; throws AppError `invalid_argument` "Sync to a line needs a text subtitle" for picture tracks. In-flight extraction is aborted when the file changes or the player stops.
  - `addSubtitle(sub: ExternalSub, opts?: { remember?: boolean /* default true */ })` — selects the added track by **matching `original` path**, not "last external" (fixes a milestone-5 deferred item).
  - `SubtitleSource` gains `ffmpegPath: string` and `cacheDir: string` (wired in `player/setup.ts` from `binaryPath('ffmpeg', …)` and the existing `cache/subtitles`).
- Consumes: Tasks 1–5.
- `selectSubtitle(id)` calls `delay.select(videoId, track?.key ?? null)` after setting `sid`; `setUp` applies `preferSynced` to the pick (both the normal and the crash-restore path); `stop()` and `play()` call `delay.flush()`; `onExit` keeps the offset (it's in the store) and `selectSubtitle` re-applies it.
- Emit `subtitles.timing` (`{ offset: number } | null`) from `delay`'s `emit`.

- [ ] **Step 1: Write the failing tests** (fake mpv from `playerService.test.ts`; `sub-delay` asserted from the `commands` log)
  - `selecting a subtitle applies its stored delay` (store 1.5 for the English track's key → `set_property sub-delay 1.5` after `sid`).
  - `Off sets the delay to 0`.
  - `each subtitle keeps its own delay` (nudge track 1 to +0.1, switch to track 2 → 0, back to 1 → 0.1).
  - `a new file resets the delay` (next episode with no row → 0).
  - `crash restore re-applies the delay`.
  - `nudges reach mpv at once but are saved once` (fake timers: 5 nudges → 5 `sub-delay` commands, 0 rows before 500 ms, 1 row after).
  - `flushes a pending nudge on stop`.
  - `nudge with no subtitle does nothing` (returns null, no command).
  - `syncSubtitleTo uses mpv's position` (`get_property time-pos` → 9, cue 5 → offset `4 - REACTION_LEAD_S`).
  - `a synced file stands in for the remembered English subtitle`.
  - `export-added subtitle is selected without changing the remembered choice` (`addSubtitle(sub, {remember:false})` → `getPrefs(...).subtitle` unchanged).
  - `subtitleCues rejects a picture track`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/subtitleDelay.test.ts tests/unit/playerService.test.ts` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: apply, nudge and sync subtitle delay through mpv`

### Task 7: IPC for timing, cues and export

**Files:**
- Modify: `src/shared/api.ts`, `src/main/subtitles/setup.ts`
- Test: `tests/unit/api.test.ts` (method list), `tests/unit/subtitlesApi.test.ts` (new: `createSubtitlesApi` with a fake player)

**Interfaces:**
- Produces (`API['subtitles']`):
  - `nudge(p: { deltaS: number }) => Promise<{ offset: number | null }>` — `deltaS` must be finite and |deltaS| ≤ 600, else `invalid_argument`.
  - `resetTiming(p: Record<string, never>) => Promise<void>`
  - `syncCues(p: Record<string, never>) => Promise<{ cues: { start: number; text: string }[]; offset: number }>` — all cues; `text` = lines joined with `\n`.
  - `syncToCue(p: { start: number }) => Promise<{ offset: number | null }>`
  - `exportSynced(p: { replace: boolean }) => Promise<{ saved: string; fallback: boolean } | { exists: string }>` (`fallback`: saved in the app's folder because the video's folder couldn't be written; the note then reads `Saved <name> in the app's folder`) — reads the selected track's cues via `player.subtitleCues()`, `exportSynced(…)` with the track's lang/kind and current offset, `fallbackDir = userData/subtitles/<videoId>`; on `saved`: `setOffset(db, videoId, subtitleKeyForFile(saved), 0, now)` then `player.addSubtitle({ path: saved, lang, kind, format: 'srt', synced: true }, { remember: false })`. Returns the file **name** (basename) in `saved`/`exists`, not the full path.
  - Event `'subtitles.timing': { offset: number } | null`.
  - All throw `invalid_argument` "Nothing is playing." / "Choose a subtitle first." / "Sync to a line needs a text subtitle" as appropriate.

- [ ] **Step 1: Write the failing tests** — `exportSynced` returns `{exists}` without writing when the file is there; with `replace:true` writes, resets that key's stored offset, and calls `addSubtitle` with `remember:false`; `nudge` rejects `NaN` and `1e6`; `syncCues` maps cues to `{start,text}`; the `apiMethods` test lists the five new methods.
- [ ] **Step 2: Run** `npx vitest run tests/unit/subtitlesApi.test.ts tests/unit/api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: subtitle timing, cues and export over IPC`

### Task 8: Overlay — G/H, the note, the sync card, menu items, replace confirm

Invoke `apple-design` and `emil-design-eng` before the visuals; match the glass of `.style-panel` / `.track-menu` in `overlay.css`.

**Files:**
- Create: `src/renderer/overlay/SyncCard.tsx`, `src/renderer/overlay/TimingNote.tsx`, `src/renderer/overlay/ConfirmCard.tsx`
- Modify: `src/renderer/overlay/Overlay.tsx`, `src/renderer/overlay/ControlBar.tsx`, `src/renderer/overlay/overlay.css`
- Test: `tests/e2e/subtitleSync.spec.ts` (new)

**Interfaces:**
- Consumes: Task 7's API and event; `formatOffset`, `firstCueAfter`, `NUDGE_S`, `NUDGE_BIG_S` from `@shared/subtitleTiming`.
- Behaviour:
  - **Keys** (Overlay's window handler, only when no menu/panel/card is open and a subtitle is selected): `g`/`h` → `nudge(∓/± NUDGE_S)`, `G`/`H` (Shift) → `∓/± NUDGE_BIG_S`; `s`/`S` → open the sync card (picture track → note `Sync to a line needs a text subtitle`; Off → nothing).
  - **TimingNote** (`data-testid="timing-note"`): top centre, text `Subtitles ${formatOffset(o)}` or `Saved <name>`; each new message restarts it; fades out 1.5 s after the last one; `role="status"`.
  - **SyncCard** (`data-testid="sync-card"`): on open calls `syncCues` (shows `Reading subtitles…` until it resolves; an error shows the error text and closes on any key), picks `firstCueAfter(starts, offset, livePosition)` using the overlay's frame clock position; shows `Press S when you hear` + the line (`data-testid="sync-line"`) + hint row. Registers a **capture-phase** window `keydown` listener that calls `stopImmediatePropagation()` + `preventDefault()` for every key while open: `←/→` move the index (clamped), `S`/`Enter` → `syncToCue({start})`, show the note, close; `Esc` closes. The card doesn't keep the controls visible.
  - **Subtitles menu actions** (in this order, after the existing ones, only when a subtitle is selected): `Sync to a line…` (text tracks), `Reset timing` (offset ≠ 0), `Export synced .srt` (text tracks). The selected track's row shows `formatOffset(offset)` as its `detail` when offset ≠ 0 (offset from the `subtitles.timing` event).
  - **Export**: `exportSynced({replace:false})`; `{exists}` → `ConfirmCard` (`data-testid="confirm-replace"`, buttons `Replace` / `Cancel`, Esc = Cancel, focus on Cancel); `Replace` → `exportSynced({replace:true})`; `{saved}` → note `Saved <name>`; errors → note with the error message.

- [ ] **Step 1: Write the failing E2E tests** (`launchApp` on a temp copy of `The.Matrix.1999.1080p.BluRay.x264.{mkv,en.srt}`; Matrix cues: `Wake up, Neo.` 1–4 s, `Follow the white rabbit.` 5–8 s; use `holdAt` from `subtitles.spec.ts`)
  - `Shift+H four times moves the subtitles 2 s later and it is remembered`: note shows `Subtitles +2.00 s`; `holdAt(2.5)` → no line; `holdAt(3.5)` → `Wake up, Neo.`; close, play again, `holdAt(3.5)` → line shown.
  - `a fix stays with its film`: after the above, play Amélie, `holdAt(1.5)` → its first line shows.
  - `sync to a line`: `holdAt(0.5)`, press `s` → card shows `Wake up, Neo.`; `→` → `Follow the white rabbit.`; press Space → still paused (player key blocked); seek to 9 via API, press `s` → note shows `Subtitles +${(4 - REACTION_LEAD_S).toFixed(2)} s`, card gone.
  - `Esc on the sync card changes nothing`: open, Esc → no note, `subtitles.timing` offset unchanged (menu row has no detail).
  - `export writes a synced file and selects it`: Shift+H ×2, menu → `Export synced .srt` → note `Saved The.Matrix.1999.1080p.BluRay.x264.en.synced.srt`; file exists with first block `00:00:02,000 --> 00:00:05,000`; original `.en.srt` byte-identical; Subtitles menu's checked item is `English · Synced`; export again → `confirm-replace` visible → Cancel → file unchanged.
  - `embedded subtitle: sync card reads it` (copy `tracks.mkv` as `Track Test (2020).mkv`, as `subtitles.spec.ts` does): select its subtitle, press `s` → `Hello there.` appears in the card (after `Reading subtitles…`).
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e/subtitleSync.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the components and wiring.
- [ ] **Step 4: Run** `npm run test:e2e -- tests/e2e/subtitleSync.spec.ts tests/e2e/subtitles.spec.ts tests/e2e/controls.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: G/H nudges, sync to a line, reset and export in the player`

### Task 9: Docs, manual check, full verification

**Files:**
- Modify: `.claude/skills/subtitle-formats/SKILL.md` (as-built: `sub-delay` approach, keys, synced naming, stand-in rule, `REACTION_LEAD_S` value, two-point dropped), `.claude/skills/mpv-ipc/SKILL.md` (`sub-delay` set on every selection), `docs/PROJECT_PLAN.md` (milestone 6 row text: drop two-point; "Manual sync" section), design doc "As built" section, `CLAUDE.md` (codebase map: `parse`, `extract`, `export`, `transforms`, `subtitleDelay`, `SyncCard`; `.synced.srt` naming in Conventions).

- [ ] **Step 1: Manual check with `/run`**: a real film with a subtitle a few seconds off — sync to a line five times; if the resulting offsets are consistently late by a similar amount, set `REACTION_LEAD_S` to the median lateness (rounded to 0.05 s) and re-run Task 2/8 tests. Hold G for 2 s — no stutter, offset correct after reopening.
- [ ] **Step 2: Run** `npm run typecheck && npx vitest run && npm run test:e2e` — Expected: all PASS.
- [ ] **Step 3: Update the docs** listed above (milestone Status column is set only after the final review and merge).
- [ ] **Step 4: Commit** `docs: milestone 6 manual sync as built`
