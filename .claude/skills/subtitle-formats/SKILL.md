---
name: subtitle-formats
description: Subtitle handling for this app — parsing SRT/WebVTT/ASS into cues, encoding detection, image-sub (PGS/VobSub) fallback, auto-matching external subtitle files, timing transforms (offset + scale), manual sync (hotkeys, sync-to-line, two-point), exporting .synced.srt, and the Apple TV-style subtitle renderer spec. Use for any work in SubtitleService, src/main/subtitles/*, SubtitleView.tsx, SyncPanel.tsx, or subtitle styling/timing bugs.
---

# Subtitles

## How it works now (milestone 5, design: `docs/superpowers/specs/2026-10-30-milestone-5-subtitles-design.md`)
- **mpv reads and times every subtitle**; the app draws the line. Files are added with `sub-add`, mpv's drawing is off for text tracks (`sub-visibility=no`), and `PlayerService` observes `sub-text/ass` and broadcasts `subtitles.cue` (`Cue | null` from `src/shared/player.ts`: lines of `{text, italic, bold}` spans plus `top`). `src/main/subtitles/cue.ts` keeps only line breaks, italics, bold and `\an7–9` (top); every other tag is dropped. Picture-based tracks are drawn by mpv (`sub-visibility=yes`).
- **Encodings:** mpv's `sub-codepage=auto` garbles legacy code pages, so `decode.ts` `ensureUtf8(path, cacheDir, lang)` hands mpv a UTF-8 copy in `cache/subtitles/`: BOM → UTF-16; valid UTF-8 → the file itself; else the language's Windows code page (Arabic 1256, Russian 1251, Polish 1250, Chinese GB18030…); else a ≥ 0.9-confidence `jschardet` guess; else windows-1252. The user's file is never changed.
- **The app's own reader (milestone 6)** — `parse.ts` (pipeline below), `extract.ts` (embedded text tracks via ffmpeg), `srt.ts` (writer) — is used only for "Sync to a line" and export. What is drawn on screen still comes from mpv.
- **Which subtitle shows** (`tracks.ts` `pickSubtitle`): remembered choice → a subtitle *file* in the user's language, every time (SDH first if "Prefer SDH", forced last) → an embedded one in the user's language when the audio is foreign → a forced track in the audio language. Untagged audio takes TMDB's `original_language` (migration 4), else counts as the user's language. Turning Off a showing track is remembered as `'off'`.
- **Style** (`src/shared/subtitleStyle.ts`): Apple TV's options plus `position` 0–100 (0 = bottom of the window). Global style is the `subtitle.style` settings row; a title's own changes are `title_prefs.style_json` holding **only the changed fields**; effective = `{...global, ...overrides}`. Presets (Default, Large Text, Classic, Outline Text) set every field except `position`. Everything read back goes through `sanitizeStyle`/`sanitizePatch`.
- **Online:** OpenSubtitles REST (`openSubtitles.ts`), only from the player's "Search online…". Query = OpenSubtitles file hash (`osHash.ts`) + TMDB id (`parent_tmdb_id` + season/episode for episodes), else the parsed name. Downloads are saved by `download.ts` as `<video>.<lang>[.sdh|.forced].<ext>` next to the video (`.2`, `.3`… when taken, opened with `wx`), or in `userData/subtitles/<videoId>/` when the folder can't be written. `VP_OPENSUBS_MODE=fixtures` reads `tests/fixtures/opensubtitles/`.

## Cue model (`subtitles/parse.ts`, as built)
```ts
type ParsedCue = { start: number; end: number; lines: string[]; italic: boolean; top: boolean }; // seconds
// displayed = scale * t + offset; manual sync only changes offset (scale stays 1)
```
`readSubtitleFile(path, lang)` = `decodeSubtitle` (same detection as `ensureUtf8`, BOM dropped) → `parseSubtitle(text)`.
- Store cues sorted by `start`.
- Overlapping cues are allowed. Show them all, stacked, with the earlier cue lower.

## Loading pipeline
1. **Read bytes and detect the encoding:**
   - Check for a BOM first: UTF-8 `EF BB BF`, UTF-16LE `FF FE`, UTF-16BE `FE FF`.
   - Then try `new TextDecoder('utf-8', { fatal: true })`.
   - If that fails, use `jschardet` to guess and `iconv-lite` to decode.
   - Default to `windows-1252`.
2. **Normalize:** CRLF/CR → LF, strip zero-width characters and NBSP at line edges.
3. **Parse by content, not extension:**
   - `WEBVTT` on the first line → VTT
   - `[Script Info]` → ASS
   - otherwise SRT
4. **Clean:** drop empty cues, clamp `end > start` (if `end <= start`, set `end = start + 2`), and merge exact duplicates (ASS often has several layers).

### SRT (be tolerant: real-world files are messy)
- Blocks are separated by one or more blank lines. The index line may be missing or wrong, so ignore it.
- Timing regex: `(\d{1,2}:)?\d{1,2}:\d{1,2}[,.]\d{1,3}\s*-->\s*...`. Treat a missing hour as 0, and right-pad milliseconds (`5` → 500).
- Ignore trailing coordinates such as `X1:... Y1:...`.
- Tags:
  - `<i>…</i>` → `italic` (or inline `<em>`)
  - drop `<b>`, `<u>` and `<font …>`
  - `{\an8}` → `top: true`
  - strip all other `{\…}` blocks

### WebVTT
- Skip the header, `NOTE`, `STYLE` and `REGION` blocks.
- Timestamps use `.` for milliseconds.
- Ignore cue settings, except `line:0` / `line:10%` → `top: true`.
- Strip `<c.*>`, `<v Name>` (keep the text) and `<00:00:01.000>` karaoke timestamps.

### ASS/SSA
- Read the `Format:` line in `[Events]` to find field positions. `Text` is the **last** field and may contain commas, so split with a limit.
- Timing is `H:MM:SS.cc` (centiseconds).
- Text: `\N` and `\n` → newline, `\h` → NBSP. Remove override blocks `{…}`, but keep `\an8` (top) and `\i1` (italic).
- Skip drawing mode (`\p1`…`\p0`) and lines whose Style name matches `/sign|song|karaoke|op|ed/i` when a dialogue style also exists.
- Fancy ASS typesetting is deliberately lost. Our renderer shows dialogue only.

### Embedded subtitles
- Text tracks (`TEXT_CODECS` in `extract.ts`: `subrip`, `ass`, `ssa`, `mov_text`, `webvtt`, `text`): `extractSubtitle` runs the vendor ffmpeg (`-map 0:<ff-index>`, ASS copied as `.ass`, the rest `-c:s srt`) into `cache/subtitles/extracted/`, cached by `(path, size, mtime, ff-index)`, written to a temp name and renamed, 5-minute timeout, abortable. Only run when "Sync to a line" or export asks; `PlayerService` caches the parsed cues per file and aborts on a file change.
- Image tracks (`hdmv_pgs_subtitle`, `dvd_subtitle`, `dvb_subtitle`) can't be parsed. Let mpv draw them (`mpv-ipc`: `sid` + `sub-visibility yes`). G/H still work through mpv's `sub-delay`; no sync card or export. ML sync isn't available for these.

## Auto-matching external files (`subtitles/match.ts`, as built)
For the video `Movie.Name.2019.mkv`, look in: the same folder, `Subs/`, `Subtitles/`, `Subs/<basename>/`, `Subtitles/<basename>/`, then `userData/subtitles/<videoId>/` (downloads that couldn't go next to the video). Accept `.srt/.vtt/.ass/.ssa` when:
- the name starts with the video's name (case-insensitive plain string compare, never a regex or glob built from the name: names have `[]()`), or
- the folder holds only one video, or
- (episodes) the name parses to the same season and episode (`Show.S01E02.WEB.en.srt` for `Show - 1x02.mkv`), or
- it is in `Subs/<basename>/` or the download folder.

Language and kind come from the words after the video's name, last word first: `.en`, `.eng`, `.English`, `fr`; `.forced`/`.foreign` → forced; `.sdh`/`.hi`/`.cc` → SDH. A file with no language word is taken to be in the user's subtitle language. Language codes everywhere go through `src/shared/lang.ts` `normalizeLang` (→ ISO 639-2/B, as mpv names them).

**Synced files** (`isSyncedName`: `*.synced.<ext>`): the word `synced` is skipped when reading the language; the track is labelled `English · Synced` and listed first. `preferSynced` (tracks.ts): whenever the pick (remembered, automatic or crash restore) lands on a subtitle and the video has a synced file of the same language and kind, the synced file is used. Export never changes the remembered choice, so other episodes of a show are unaffected.

## Manual sync (milestone 6, as built; design: `docs/superpowers/specs/2026-10-31-milestone-6-manual-sync-design.md`)
Positive `offset` means subtitles appear **later**. **mpv applies it**: `PlayerService.selectSubtitle` calls `subtitleDelay.select(videoId, track.key)` before setting `sid`, which sets `sub-delay` to that subtitle's stored offset (0 for Off, a new file, a track with none). Maths in `src/shared/subtitleTiming.ts`.

| Action | Effect |
|---|---|
| `G` / `H` | `offset -= 0.05` / `offset += 0.05` (any selected subtitle, picture ones too) |
| `Shift+G` / `Shift+H` | ±0.5 s |
| **Sync to a line** (`S` or the menu; the card shows the first cue with `start + offset > position`; ←/→ other lines; `S`/Enter when heard) | `offset = time-pos − REACTION_LEAD_S − cue.start` (main reads mpv's `time-pos` at the key press) |
| **Set offset…** (`OffsetPanel`: slider −10…+10 s, live; ←/→ 0.05 s, Shift 0.5 s, Home → 0) | `offset = value` via `subtitles.setTiming({ offset, key })`; works for picture subtitles too |
| Reset timing | `offset = 0` |

- Offsets are clamped to ±600 s and rounded to the ms. `REACTION_LEAD_S` is 0 until measured on real films.
- **Two-point sync was dropped** with the user: growing gaps are left to ML sync (milestone 7), which may set `scale` (via mpv `sub-speed`).
- **Stored** in `subtitle_transforms` (`transforms.ts`) per `(video_id, subtitle_key)`, `source='manual'`; `subtitle_key` = `file:<sha1 of the user's own path>` (not the UTF-8 cache copy) or `embedded:<ff-index>`; offset 0 deletes the row. `Track.key` carries it. mpv gets every nudge at once; the database gets the last one after 500 ms, and a pending one is written on a subtitle change, a new file and stop.
- The overlay shows `Subtitles +0.35 s` / `Subtitles in sync` (`formatOffset`) at the top and the selected track's row in the Subtitles menu shows the offset; `subtitles.timing` carries it.

## Export (`export.ts`, as built)
- `Export synced .srt` writes `<video>.<lang>[.sdh|.forced].synced.srt` (`syncedName`; plain `<video>.synced.srt` with no language) next to the video, or in `userData/subtitles/<videoId>/` when the folder can't be written ("in the app's folder"). `writeSrt`: offset applied, cues ending ≤ 0 dropped, starts clamped to 0, `HH:MM:SS,mmm`, UTF-8 without BOM, CRLF, renumbered, `<i>…</i>` and `{\an8}`.
- **Never overwrites the original subtitle file.** An existing synced file is replaced only after the user confirms (`replace: true`), via a temp file renamed over it.
- The new file is added to mpv and selected (`addSubtitle(sub, { remember: false })`), with its stored offset reset to 0 — the shift is baked in.

## Apple TV-style renderer (`src/renderer/overlay/SubtitleView.tsx`, as built)
Cues are drawn as HTML in the overlay window, measured against the **window** (the user's choice: 0 is the bottom of the screen, so wide films put subtitles in the black bar). The maths is pure and unit-tested in `subtitleLayout.ts`:
- **Size:** `max(18px, 4.5 % of the height) × size%`. Weight 600, line height 1.22, tracking −0.005em, `font-optical-sizing: auto`, `text-wrap: balance`, centred, 80 % max width.
- **Position:** margin `m = 4 %` of the height; bottom of the block = `m + position/100 × (H − 2m − blockH)`. `top` cues sit at the top margin. While the controls show, a block below the seek bar lifts to 8 px above it (250 ms spring); top cues and high positions never move.
- **Fonts** (all ship with Windows 11): Default = Segoe UI Variable Display, Arial, Georgia, Courier New, Consolas, Trebuchet MS, Casual = Comic Sans MS, Cursive = Segoe Script, Small Capitals = default + `small-caps`.
- **Edges** (`text-shadow` in em): drop shadow (soft), raised / depressed (light and dark 1-px-ish pair), outline (8-way at 0.06em).
- **Boxes:** the per-line box is an inline `<span>` with `box-decoration-break: clone` (`--sub-line-bg`); the window box wraps the whole cue (`--sub-window-bg`).
- **Motion:** fade in 120 ms, out 160 ms (the last cue stays drawn while it fades); no movement on cue change; `prefers-reduced-motion` switches instantly. `pointer-events: none`.
- Cue text is React text, never HTML.
- **Style controls** (`src/renderer/src/components/SubtitleStyleControls.tsx`) are shared by the player's style panel (title-only changes, "Use for all movies and shows", "Reset to my global style") and Settings → Subtitles (global, with a 16:9 preview). Each row is an ARIA slider: ←/→ change it, ↑/↓ move rows, Home/End jump. Panels keep a local draft so quick key presses aren't lost while changes travel to main and back.
