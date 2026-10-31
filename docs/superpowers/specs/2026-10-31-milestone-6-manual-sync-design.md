# Milestone 6 — Manual sync: design

Status: approved by the user (2026-10-31).

## Intent

When a subtitle is out of time with the film, the user can fix it while watching, in a second or two, and the fix sticks. The user's subtitles are usually off by a **constant delay** (typically a subtitle made for another release). What they really want is subtitles synced by the ML model (milestone 7); this milestone is the quick manual fix *and* the groundwork that ML sync builds on: the app's own subtitle reader, extraction of embedded text subtitles, stored per-subtitle timing, and `<movie>.synced.srt` export that comes back as a "Synced" track.

## Goals

- **G / H** nudge the showing subtitle ±50 ms; **Shift+G / Shift+H** ±500 ms. Works whenever a subtitle is showing.
- **Sync to a line** (option B, chosen by the user): a small card shows the next line; press **S** the moment it is spoken and the subtitles snap to it.
- The fix is **saved per video and subtitle** and applied on every play.
- **Export synced .srt** writes `<video basename>.synced.srt` next to the video; from then on it is listed first as "Synced".
- **Reset timing** clears the fix.

## Non-goals

- **Two-point sync** for drift: dropped with the user; growing gaps are left to ML sync (milestone 7). The stored transform keeps its `scale` column so milestone 7 can use it.
- A timing panel with a list of lines (option A, considered and not chosen).
- Automatic sync of any kind (milestone 7).
- Editing subtitle text or individual line times.
- Line lists or export for picture-based subtitles (PGS/VobSub/DVB): the app can't read their text.

## Anti-goals

- Any loss of timing accuracy compared with milestone 5, or a visible blink of the subtitle when nudging.
- Overwriting or changing the user's original subtitle file. Replacing an existing `.synced.srt` only after asking.
- A nudge that silently applies to the wrong subtitle (e.g. a fix for the English file showing up on the French one, or on the next episode).
- The player's keys acting while the sync card is open (except the card's own keys), or the card's keys leaking into the player.

## Decided with the user

- Usual problem is a constant delay; ML sync is the real goal. Manual sync is the quick fix and the fallback.
- Two-point sync is dropped.
- "Sync to a line" works by pressing a key when the shown line is heard (option B), not by picking from a list.
- **Approach 1**: mpv keeps timing subtitles and applies the shift itself.

## Approaches considered (how the shift is applied)

1. **mpv applies the shift with `sub-delay` (chosen).** The app sets mpv's subtitle delay to the stored offset whenever a text or picture subtitle is selected. Nudges are instant, timing stays exactly as in milestone 5, works for picture-based tracks too. The app reads the subtitle's cues only for the sync card and for export.
2. **The app times subtitles from its own cues.** Lines would be shown from the playback position reported by mpv, which can trail the picture. Undoes milestone 5's main timing decision; no gain because ML sync writes a real file. Rejected.
3. **Rewrite a shifted copy and reload it into mpv on every change.** Each nudge would blink the subtitle and quick presses would pile up. Rejected.

## How it works

### Timing model

- `Transform = { scale, offset }`, displayed time = `scale * t + offset`, positive offset = later (as in `subtitle-formats`). Manual sync only ever changes `offset`; `scale` stays 1 (milestone 7 may set it; with approach 1, a non-1 scale would be applied with mpv's `sub-speed` — out of scope here).
- Applied with mpv `set_property sub-delay <offset>`. `sub-delay` is a player-wide property, not per track: the main process sets it **every time the subtitle selection changes** (including Off → 0, a new file, mpv crash restore) to that subtitle's stored offset, or 0.
- The offset is clamped to ±10 minutes (my call: catches runaway key repeat; a minute-plus offset is still reachable with Shift).

### Which subtitle a fix belongs to

- Stored in the existing `subtitle_transforms` table (migration 1, renamed to `video_id` in migration 2): `(video_id, subtitle_key)`, `source = 'manual'`. **No new migration needed.**
- `subtitle_key`: `file:<sha1 of the original absolute path>` for external files (the path of the user's file, not the UTF-8 cache copy), `embedded:<ffmpeg stream index>` for tracks inside the video (mpv's `ff-index`).
- A fix is per video, so it never carries to the next episode (my call: different episodes' subtitle files have different delays).
- A `.synced.srt` is its own subtitle with its own (normally zero) offset.

### The app's own subtitle reader (`src/main/subtitles/parse.ts`, pure)

- Follows the `subtitle-formats` loading pipeline: decode (reuse `decode.ts`), normalise line endings, detect format by content (`WEBVTT` → VTT, `[Script Info]` → ASS, else SRT), parse tolerant SRT / VTT / ASS into `ParsedCue = { start, end, lines, italic?, top? }` (seconds), clean (drop empty, fix `end <= start`, merge exact duplicates, sort by start).
- Used for: the next line on the sync card, and export. It does **not** drive what is drawn on screen (mpv still does, via `sub-text/ass`).

### Embedded text subtitles (`src/main/subtitles/extract.ts`)

- For text tracks inside the video (`subrip`, `ass`/`ssa`, `mov_text`, `webvtt`), extract with the vendor ffmpeg to `.srt` (or `.ass` for ASS) in `cache/subtitles/extracted/`, then parse. Cached by `(video path, file size, mtime, stream index)`.
- Extraction happens **only when needed** (when "Sync to a line" or export is chosen for an embedded track), never on every play. While it runs the card says "Reading subtitles…". It can be cancelled with Esc; if the file closes, it's abandoned.
- Picture-based tracks: no extraction.

### Sync to a line (overlay: `SyncCard.tsx`)

- **Start**: "Sync to a line…" in the Subtitles menu, or the **S** key while a text subtitle is showing. If the subtitle is picture-based or Off, S does nothing visible except a short note: "Sync to a line needs a text subtitle" (picture) / no-op when Off.
- **Card**: a small glass card in the middle of the lower screen, above the subtitle area. "Press **S** when you hear" + the line's text, plus a hint row: "← → other lines · Esc cancel". The film keeps playing; the subtitle itself stays visible.
- **Which line first**: the first cue whose *shifted* start (`start + current offset`) is after the current position (the line that should come next with the current fix). If there is none (end of the film), the last cue.
- **← / →** step to the previous / next cue in the file; holding repeats. The card shows the line only, not its time (my call: the time is meaningless to the user and makes the card busy).
- **S again** (or Enter): `offset = position − cue.start` (scale 1), where `position` is mpv's `time-pos` read in the main process at the moment of the key press. Saved, applied, card closes, note "Subtitles +0.35 s".
- **Esc**: closes, changes nothing.
- While the card is open, only S, Enter, ←, →, Esc act; the player's other keys (Space, F, M, ↑/↓, G/H) don't. Clicking elsewhere does nothing special (my call: keep it keyboard-first like the rest of the player).
- **Reaction time**: people press slightly after hearing a line. The builder should measure on the fixtures and subtract a small fixed lead (expected ~0.15–0.25 s) if it makes results consistently better; record the value in `subtitle-formats`.

### G / H

- G = earlier (−), H = later (+), 50 ms; with Shift 500 ms (`subtitle-formats` table). Act only when a subtitle (text or picture) is selected; otherwise nothing.
- Each change saves and applies at once, and shows a brief note at the top centre: "Subtitles +0.35 s" (or "Subtitles in sync" at 0). Rapid presses update the same note; it fades ~1.5 s after the last press.
- Saving is debounced in main (my call) so key repeat doesn't write to SQLite on every press; mpv gets every change at once. A pending save is written when the file changes or playback stops.

### Subtitles menu

Added under the existing items (only when a subtitle is selected):
- **Sync to a line…** (text subtitles only).
- **Reset timing** — only when the current subtitle has a non-zero offset.
- **Export synced .srt** — text subtitles only; allowed at any offset, including 0 (my call: exporting an embedded track as a file is useful on its own).
- The menu's subtitle row shows the current offset as a secondary line, e.g. "+0.35 s", when non-zero (my call).

### Export (`src/main/subtitles/export.ts`)

- **Name** (my call): `<video basename>.<lang>[.sdh|.forced].synced.srt`, e.g. `Movie.en.synced.srt`, `Movie.fr.sdh.synced.srt` — the same words the downloads use, so the matcher reads the language and kind back on the next play and a video can have one synced file per language and kind. With no known language, plain `<video basename>.synced.srt`. Still "`<movie>…synced.srt`" as `CLAUDE.md` asks; update `subtitle-formats` and `CLAUDE.md` to the exact pattern.
- Writes the file next to the video: transform applied, times clamped ≥ 0, cues ending ≤ 0 dropped, `HH:MM:SS,mmm`, UTF-8 without BOM, CRLF, renumbered from 1, italics re-wrapped as `<i>…</i>`, top cues prefixed `{\an8}`.
- **Never** the original file. If `.synced.srt` exists, the overlay asks "Replace the existing synced subtitles?" (Replace / Cancel). Written to a temp file in the same folder and renamed, so a failure never leaves a half file.
- Folder not writable: save under `userData/subtitles/<videoId>/` (the matcher already looks there), as downloads do, and say where.
- After export the new file is added to mpv and **selected**, with its own offset 0 (the shift is baked in; replacing an existing synced file also resets its stored offset to 0). The note says "Saved Movie.Name.en.synced.srt". The original subtitle keeps its own stored shift.
- **Remembered choice is not changed by export** (my call): for a show it is shared by every episode, and one episode's export must not change what later episodes pick. Instead, a **synced file stands in for the subtitle of the same language and kind**: whenever the pick (remembered or automatic) lands on a subtitle and that video has a `.synced` file of the same language and kind, the synced file is used. So the film or episode that was synced gets its synced file every time; other episodes are unaffected.
- `match.ts`: the `synced` word is recognised (it isn't a language or kind); the track is labelled **"Synced"** ("English · Synced", "English (SDH) · Synced") and listed first.
- The ffmpeg-free path for exporting an ASS source: export is always SRT; ASS styling is lost (consistent with milestone 5's dialogue-only rendering).

### IPC (in `src/shared/api.ts`)

- `subtitles.nudge({ deltaS })` → new offset; `subtitles.resetTiming()`; `subtitles.syncCues()` → `{ cues: {text, start}[], offset } | { error }` for the playing subtitle (may take a while for embedded); `subtitles.syncToCue({ start })` → new offset (main reads `time-pos` itself); `subtitles.exportSynced({ replace })` → `{ saved: path } | { exists: true } | { error }`.
- Event `subtitles.timing` (`{ offset } | null`) when the current subtitle's offset changes or the selection changes, so the overlay can show the note and the menu label.
- All act on the **playing** video and **selected** subtitle only (as with `search`/`download`).

## Testing

- **Unit**: SRT/VTT/ASS parsing (messy SRT: missing index, missing hours, short ms, CR-only line ends, coordinates; VTT header/NOTE/STYLE, `line:0`, `<v>`; ASS `Format:` order, commas in Text, `\N`, `\i1`, `\an8`, drawings, sign styles), encodings through `decode.ts`, cleaning rules; transform + `syncToCue` maths; offset clamp; subtitle key (external original path, embedded ff-index); first-line choice for the card; SRT writer (CRLF, no BOM, clamping, renumbering, `<i>`, `{\an8}`); export naming and the never-overwrite / ask-to-replace / read-only fallback; `.synced.srt` labelling and auto-pick preference; extraction cache key.
- **Integration** (vendor ffmpeg): extract the embedded subtitle of `tracks.mkv` and parse it; cache hit on second call.
- **E2E** (real mpv):
  - H ×3 then reopen the film: the line appears 150 ms later than before (check via the `subtitles.cue` event time against known cue times), and the note shows "+0.15 s";
  - G/H on one subtitle doesn't change another subtitle's offset or the next episode's;
  - Sync to a line: open the card, step with →, press S at a known time, offset equals the expected value within 100 ms;
  - Esc on the card changes nothing; Space doesn't pause while the card is open;
  - Export writes `.synced.srt` next to the fixture, it's selected and labelled "Synced", the original file is byte-identical; exporting again asks before replacing;
  - embedded track: "Sync to a line" shows "Reading subtitles…" then a line from `tracks.mkv`.
- **Manual**: a real film with a downloaded subtitle that's off by a few seconds; a real MKV with embedded SRT/ASS; key repeat on G/H.

## Left to the builder

- Exact card and note visuals (glass, type, motion) per `apple-design` / `emil-design-eng`, matching the style and search panels.
- The reaction-time lead value, if any (measure first).
- Debounce interval for saving.
- Whether `subtitles.syncCues` sends all cues or a window around the position.

## Left open (my calls, for the user to check)

- A fix is per video and subtitle file; it doesn't carry to other episodes.
- S opens "Sync to a line" directly (as well as the menu item).
- The card shows the line's text only, not its time.
- Synced files are named `Movie.en.synced.srt` (language and kind in the name), and one stands in for the subtitle of the same language and kind on that video; export doesn't change a show's remembered subtitle.
- Export is allowed even at offset 0 (handy for turning an embedded subtitle into a file).
- Offsets are capped at ±10 minutes.

## Addition: set the offset with a slider (decided with the user, 2026-10-31)

- **"Set offset…"** in the Subtitles menu, for any selected subtitle (picture-based too: the shift goes through mpv). A small glass panel: the offset at the top right (`formatOffset`), a slider from −10 s to +10 s, **Reset** and **Done**. The film keeps playing and the subtitles move live while dragging.
- Keys: ←/→ 0.05 s, Shift+←/→ 0.5 s, Home → 0, Esc or Enter closes. The player's keys don't act while it is open.
- An offset already beyond ±10 s (from "Sync to a line") shows its real value with the thumb at the end; dragging replaces it with a value in range. (±10 s is my call.)
- Saved like G/H (per video and subtitle, debounced). New IPC `subtitles.setTiming({ offset, key })`, refused when the subtitle changed or the value isn't finite within ±600 s.

## As built (2026-10-31)

Differences from the design, and why:
- **No reaction-time lead yet** (`REACTION_LEAD_S = 0`): it has to be measured by pressing S on real films, which needs the user (see below).
- **`sub-delay` is set before `sid`**, so a newly picked track never shows with the previous track's delay. `selectSubtitle` records the selection at once instead of waiting for mpv's `sid` observer, so the sync card and export know the track right away.
- **Cue reading is injected** into `PlayerService` (`SubtitleSource.cues`), wired in `player/setup.ts` to `readSubtitleFile` / `extractSubtitle`, so the service stays unit-testable.
- **`addSubtitle` finds the added track by its file key**, not "the last external track" (fixes a milestone-5 deferred item).
- The sync card and the note open without animation (they come from key presses); the note only fades out.
- **E2E windows open on the second display** when there is one (`toSecondDisplay` in `tests/e2e/pages.ts`), at the user's request.

Fixed after the final review:
- A second export of a synced file re-reads its new lines and replaces its old track, instead of reusing stale lines and listing the file twice.
- A file change clears the timing selection, so a G/H or "Sync to a line" during loading can't land on the previous video's subtitle.
- The sync card and the Replace prompt close when the subtitle changes, and main refuses a sync or export for a subtitle other than the one the card or prompt was opened for (`key`). Picking a subtitle now updates the overlay at once, even while paused.
- SRT cues keep text after a blank line inside the cue.
- An embedded track's language tag is normalised before it goes into the synced file's name, and only a plain code is allowed (no path characters).

Deferred (minor, from the final review):
- `addSubtitle` adds with `select` before applying the new track's delay, so a re-exported file can show doubly shifted for a few ms.
- The sync card's double-S guard resets if ← or → is pressed between S and the reply.
- Esc during "Reading subtitles…" doesn't stop ffmpeg (the result is cached; CPU only).
- The Replace prompt's keys only work while focus is inside it.
- Export's offset reset bypasses the delay module: a still-pending debounced save for the same key could write the old offset back.
- Read-only folder with an existing synced file: Replace writes a second copy in the app's folder, and the folder copy keeps winning.
- The overlay keeps the last offset after the player closes, until the next selection.
- `writeSrt` italicises a whole cue if any part was italic; an exported commentary track reads back as plain.
- mpv keeps `sub-visibility` across `loadfile`, so a picture-based default track in the next file can show briefly before the pick.
- E2E: `subtitleStyle.spec.ts` "style changes… stay with that title" lost one key press once in a full run (16/16 when repeated).

Needs the user's check: on a real film with a subtitle a few seconds off, use "Sync to a line" five times. If the result is always late by about the same amount, that amount becomes `REACTION_LEAD_S`. Also: hold G for two seconds (no stutter, right offset after reopening), and a real MKV with an embedded SRT/ASS track.
