---
name: subtitle-formats
description: Subtitle handling for this app — parsing SRT/WebVTT/ASS into cues, encoding detection, image-sub (PGS/VobSub) fallback, auto-matching external subtitle files, timing transforms (offset + scale), manual sync (hotkeys, sync-to-line, two-point), exporting .synced.srt, and the Apple TV-style subtitle renderer spec. Use for any work in SubtitleService, src/main/subtitles/*, SubtitleView.tsx, SyncPanel.tsx, or subtitle styling/timing bugs.
---

# Subtitles

## Cue model
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

## Auto-matching external files
For the video `Movie.Name.2019.mkv`, check these in order:
1. the same folder, `Movie.Name.2019*.{srt,vtt,ass,ssa}`
2. `Subs/`, `Subtitles/`, `Subs/<basename>/`

Parse the language and flags from the suffix: `.en`, `.eng`, `.English`, `.forced`, `.sdh`, `.hi`. Prefer the user's language first, then non-forced, then non-SDH.

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

## Apple TV-style renderer (`SubtitleView.tsx`)
Draw cues as HTML in the overlay window, positioned against the **video rectangle** (from mpv `osd-dimensions` / `video-params`), not the window.

```css
--sub-font: -apple-system, "SF Pro Display", "Inter Variable", "Segoe UI Variable Display", system-ui, sans-serif;
--sub-size: calc(var(--video-h) * 0.045);          /* min 18px; user scale S .8 | M 1 | L 1.25 | XL 1.5 */
--sub-weight: 600;   --sub-color: #fff;   --sub-line: 1.22;   --sub-tracking: -0.005em;
--sub-box: rgba(18, 18, 20, 0.62);   --sub-box-blur: 18px;   --sub-radius: 0.28em;   --sub-pad: 0.12em 0.42em;
--sub-bottom: calc(var(--video-h) * 0.075);   --sub-max-width: 80%;
```

- **Per-line box:** use an inline `<span>` with `background`, `border-radius` and `box-decoration-break: clone` so every wrapped line gets its own rounded pill. Don't draw one big rectangle. Add `backdrop-filter: blur(var(--sub-box-blur))` where supported.
- Use `text-wrap: balance`, centre alignment, and `font-optical-sizing: auto`. Italics come from `font-style`, not synthetic slant.
- **Motion:** fade in 120 ms and fade out 160 ms, `ease-out`. No movement on cue change. When the controls appear, lift the subtitles by the control bar's height with a 250 ms spring. Under `prefers-reduced-motion`, switch instantly.
- `top` cues anchor to `--sub-bottom` from the top instead.
- **Settings:** size, box opacity (0–100 %), and style presets *Apple TV (boxed)*, *Outline* (`text-shadow` 4-way, 0.06em, no box) and *Large Text*.
- Treat cue text as text (`textContent`), never as HTML.
