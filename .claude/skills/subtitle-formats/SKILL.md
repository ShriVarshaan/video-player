---
name: subtitle-formats
description: Subtitle handling for this app — parsing SRT/WebVTT/ASS into cues, encoding detection, image-sub (PGS/VobSub) fallback, auto-matching external subtitle files, timing transforms (offset + scale), manual sync (hotkeys, sync-to-line, two-point), exporting .synced.srt, and the Apple TV-style subtitle renderer spec. Use for any work in SubtitleService, src/main/subtitles/*, SubtitleView.tsx, SyncPanel.tsx, or subtitle styling/timing bugs.
---

# Subtitles

## How it works now (milestone 5, design: `docs/superpowers/specs/2026-10-30-milestone-5-subtitles-design.md`)
- **mpv reads and times every subtitle**; the app draws the line. Files are added with `sub-add`, mpv's drawing is off for text tracks (`sub-visibility=no`), and `PlayerService` observes `sub-text/ass` and broadcasts `subtitles.cue` (`Cue | null` from `src/shared/player.ts`: lines of `{text, italic, bold}` spans plus `top`). `src/main/subtitles/cue.ts` keeps only line breaks, italics, bold and `\an7–9` (top); every other tag is dropped. Picture-based tracks are drawn by mpv (`sub-visibility=yes`).
- **Encodings:** mpv's `sub-codepage=auto` garbles legacy code pages, so `decode.ts` `ensureUtf8(path, cacheDir, lang)` hands mpv a UTF-8 copy in `cache/subtitles/`: BOM → UTF-16; valid UTF-8 → the file itself; else the language's Windows code page (Arabic 1256, Russian 1251, Polish 1250, Chinese GB18030…); else a ≥ 0.9-confidence `jschardet` guess; else windows-1252. The user's file is never changed.
- **The pipeline below (own parser, cue list, extraction of embedded tracks) is milestone 6's**, where sync-to-line and export need cues in the app. Milestone 5 doesn't parse files itself.
- **Which subtitle shows** (`tracks.ts` `pickSubtitle`): remembered choice → a subtitle *file* in the user's language, every time (SDH first if "Prefer SDH", forced last) → an embedded one in the user's language when the audio is foreign → a forced track in the audio language. Untagged audio takes TMDB's `original_language` (migration 4), else counts as the user's language. Turning Off a showing track is remembered as `'off'`.
- **Style** (`src/shared/subtitleStyle.ts`): Apple TV's options plus `position` 0–100 (0 = bottom of the window). Global style is the `subtitle.style` settings row; a title's own changes are `title_prefs.style_json` holding **only the changed fields**; effective = `{...global, ...overrides}`. Presets (Default, Large Text, Classic, Outline Text) set every field except `position`. Everything read back goes through `sanitizeStyle`/`sanitizePatch`.
- **Online:** OpenSubtitles REST (`openSubtitles.ts`), only from the player's "Search online…". Query = OpenSubtitles file hash (`osHash.ts`) + TMDB id (`parent_tmdb_id` + season/episode for episodes), else the parsed name. Downloads are saved by `download.ts` as `<video>.<lang>[.sdh|.forced].<ext>` next to the video (`.2`, `.3`… when taken, opened with `wx`), or in `userData/subtitles/<videoId>/` when the folder can't be written. `VP_OPENSUBS_MODE=fixtures` reads `tests/fixtures/opensubtitles/`.

## Cue model (milestone 6: the app's own reader)
```ts
type Cue = { start: number; end: number; lines: string[]; italic?: boolean; top?: boolean }; // seconds (float)
type Transform = { scale: number; offset: number };   // displayed = scale * t + offset
```
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
- Text tracks (`subrip`, `ass`, `mov_text`, `webvtt`): extract with ffmpeg to a temp `.srt`/`.ass` (see the `ffmpeg` skill), then parse as above. Cache by `(file mtime, stream index)`.
- Image tracks (`hdmv_pgs_subtitle`, `dvd_subtitle`, `dvb_subtitle`) can't be parsed. Let mpv draw them (`mpv-ipc`: `sid` + `sub-visibility yes`). Manual offset still works through mpv's `sub-delay`. ML sync isn't available for these.

## Auto-matching external files (`subtitles/match.ts`, as built)
For the video `Movie.Name.2019.mkv`, look in: the same folder, `Subs/`, `Subtitles/`, `Subs/<basename>/`, `Subtitles/<basename>/`, then `userData/subtitles/<videoId>/` (downloads that couldn't go next to the video). Accept `.srt/.vtt/.ass/.ssa` when:
- the name starts with the video's name (case-insensitive plain string compare, never a regex or glob built from the name: names have `[]()`), or
- the folder holds only one video, or
- (episodes) the name parses to the same season and episode (`Show.S01E02.WEB.en.srt` for `Show - 1x02.mkv`), or
- it is in `Subs/<basename>/` or the download folder.

Language and kind come from the words after the video's name, last word first: `.en`, `.eng`, `.English`, `fr`; `.forced`/`.foreign` → forced; `.sdh`/`.hi`/`.cc` → SDH. A file with no language word is taken to be in the user's subtitle language. Language codes everywhere go through `src/shared/lang.ts` `normalizeLang` (→ ISO 639-2/B, as mpv names them).

Always list `*.synced.srt` first and label it "Synced".

## Timing maths
Displayed time for a cue time `t` is `scale * t + offset`. Positive `offset` means subtitles appear **later**. At video time `v`, show cues where `scale*start + offset <= v < scale*end + offset`. Use binary search on `start` with a small back-scan for long cues.

| Action | Effect |
|---|---|
| `G` / `H` | `offset -= 0.05` / `offset += 0.05` |
| `Shift+G` / `Shift+H` | ±0.5 s |
| Reset | `{scale: 1, offset: 0}` |
| **Sync to this line** (user picks cue `c` heard at video time `v`) | `offset = v - scale * c.start` |
| **Two-point** (cue `s1` heard at `v1`, cue `s2` at `v2`) | `scale = (v2 - v1) / (s2 - s1)`, `offset = v1 - scale * s1` |

Two-point guards:
- Require `|s2 - s1| > 60 s`.
- Reject a `scale` outside `[0.9, 1.1]`.
- Snap `scale` to a known framerate ratio when it's within 0.0005:
  - `25/23.976 = 1.04271`
  - `23.976/25 = 0.95904`
  - `24/23.976 = 1.001`
  - `23.976/24 = 0.999`

Store the transform per `(movieId, subtitlePathHash)` in SQLite and apply it immediately. Show a toast like "Subtitles +0.35 s".

## Export
- `Export synced .srt` writes `<video basename>.synced.srt` next to the video, with the transform applied, times clamped to ≥ 0, `HH:MM:SS,mmm`, UTF-8 without BOM, and CRLF line endings.
- **Never overwrite the original subtitle file.** If the `.synced.srt` already exists, ask before replacing it.
- Re-wrap italics as `<i>…</i>` and top cues with `{\an8}`.

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
