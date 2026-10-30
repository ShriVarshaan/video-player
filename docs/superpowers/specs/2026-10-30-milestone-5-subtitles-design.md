# Milestone 5 — Subtitles: design

Status: draft, awaiting the user's approval.

## Intent

Make subtitles look and behave like Apple TV's, and make them easy to get. Most of the user's subtitles are `.srt` files sitting next to their videos; those must just appear. When there is nothing local, the user can search OpenSubtitles from the player, on request. Every subtitle is drawn by the app itself in the style the user chose, at the height they chose.

Why now: playback (milestone 4) works, but text subtitles are still mpv's default look and external files are ignored. Manual sync (6) and ML sync (7) move subtitles in time; they need subtitles that load and draw well first.

## Goals

- **Local files found automatically**: `.srt`, `.vtt`, `.ass`/`.ssa` next to the video or in a `Subs`/`Subtitles` folder, labelled by language and type, in odd encodings without garbled text.
- **Search online, only when asked**: "Search online…" in the Subtitles menu searches OpenSubtitles; the picked result downloads, shows at once and is saved next to the video for next time.
- **Apple TV-style renderer** for every text subtitle, drawn in the overlay window.
- **Everything Apple TV's subtitle settings offer**, plus a **position slider** 0–100 (0 = bottom of the screen, 100 = top).
- **Style while watching**: a style panel in the player with a live preview; changes stay with that movie/show unless "Use for all movies and shows" is pressed.
- **Style in Settings**: always global.

## Non-goals

- Moving subtitles in time: offsets, sync hotkeys, sync-to-line, export (milestone 6); automatic sync (7).
- Restyling picture-based subtitles (PGS/VobSub/DVB). mpv keeps drawing them as they are.
- Keeping the original look of styled `.ass` files (karaoke, signs, positioned text). Their text is drawn in the user's style. *(My call; see "Left open".)*
- Subtitle sources other than OpenSubtitles; uploading subtitles; searching automatically on play.
- Two subtitles at once (dual subtitles).

## Anti-goals (would make this a failure even if it works)

- A subtitle that shows late or lingers: timing must be as exact as mpv's own.
- Garbled characters from a file mpv itself would have shown correctly.
- Overwriting or renaming any file the user already has.
- Any network request the user did not ask for (no background searches, no lookups on play).
- The OpenSubtitles password or API key ending up in plain text anywhere: a file, a log, the renderer, a commit.
- Subtitles hidden behind the control bar, or the control bar jumping because of them.

## Decided with the user

### Sources
- Mostly local `.srt` files next to the videos, found automatically.
- Online search only when the user chooses "Search online…" from the Subtitles menu.
- OpenSubtitles is the one online source.

### Rendering — approach A
mpv loads and times the subtitles (embedded tracks, local files, downloaded files) and reports the current line; the app draws that line in the overlay window. See "Approaches considered".

### Style
- Everything Apple TV offers (presets plus a custom style; list below), plus a position slider 0–100, where 0 is the bottom of the screen and 100 the top.
- Changes made **while a movie is playing** stay with that movie (or the whole show) unless the user presses **"Use for all movies and shows"**.
- Changes made **in Settings** are global.
- A movie stores **only the settings the user changed for it**. Everything else follows the global style, including later changes to it. (Example: Dune's bigger text stays; a new global font reaches Dune.)

## Approaches considered (who reads and times subtitles)

- **A. mpv times, the app draws (chosen).** mpv loads every track and decodes encodings; the main process observes the current line and the overlay draws it. Exact timing, embedded tracks with no extraction step, least new code. Milestone 6 adds the app's own subtitle reader where sync-to-line and export need it.
- **B. The app parses and times everything.** Own SRT/VTT/ASS parsing, ffmpeg extraction of embedded tracks (seconds of delay on long films), timing from the playback position (can trail the picture). Would give milestone 6 its reader early. Rejected: more work and worse timing now.
- **C. mpv draws with its own styling (`--sub-font`, `--sub-color`, `--sub-pos`…).** Cheapest, but cannot do Apple TV's typography, raised/depressed edges, or a smooth live preview. Rejected.

## How it works

### Loading and timing (main process, `src/main/subtitles/`)

- **Text tracks are drawn by the app**: when the selected track is text, mpv's own drawing is off (`sub-visibility=no`); the main process observes mpv's current subtitle text and sends it to the overlay. When the selected track is picture-based, `sub-visibility=yes` and mpv draws it.
- **Spike first (Task 1):** confirm with the vendor mpv that the current-line property (`sub-text`, and the formatted `sub-text/ass` for italics/bold) still updates with `sub-visibility=no`, how fast change notifications arrive, and that `sub-codepage` auto-detection decodes a cp1252 and a cp1256 `.srt`. If the line stops updating when hidden, hide mpv's drawing another way (fully transparent `sub-color`/`sub-border-color`/`sub-shadow-color`) and record which in `mpv-ipc`. If auto-detection is not good enough, decode in main (jschardet + iconv-lite, as `subtitle-formats` describes) and hand mpv a UTF-8 copy in the app's cache folder.
- **Formatting kept**: italics, bold and line breaks. Every other ASS tag is dropped. A cue tagged top-aligned (`{\an8}`, or VTT `line:0`) is drawn at the top. Text is always set as text, never HTML.
- **External files** are added on `file-loaded`, before the track pick, with mpv `sub-add <path> auto <title> <lang>`, so they appear in `track-list`. `--sub-auto=no` stays: the app decides what is found.

### Finding local files (`subtitles/match.ts`, pure)

For `Movie.Name.2019.mkv`, look in this order (from `subtitle-formats`): the same folder for `Movie.Name.2019*.{srt,vtt,ass,ssa}`, then `Subs/`, `Subtitles/`, `Subs/<basename>/`, `Subtitles/<basename>/`. Case-insensitive. Parse language and flags from the suffix: `.en`, `.eng`, `.English`, `.forced`, `.sdh`, `.hi`, `.cc`. A folder with exactly one video also accepts subtitle files whose names don't start with the video's name (common for downloads). **Episodes** also match by season and episode number (my call): a subtitle whose name parses (with the library's own name parser) to the same S/E as the episode is accepted even when the rest of the name differs, e.g. `Show.S01E02.WEB.en.srt` for `Show - 1x02.mkv`. The scan runs once per play; the result is not stored in the database.

**Files with no language in the name** (`Movie.Name.2019.srt`) are taken to be in the user's subtitle language (my call; that is almost always why the file is there), labelled with that language. So a remembered choice matches across a show's episodes by language, not by file name.

Labels in the Subtitles menu use the existing rules (`tracks.ts`): "English", "English (SDH)", "English (Forced)", and the file's own track title, if any, otherwise the language name. Externals are marked "External" in a secondary line; duplicates of the same language get the file name as their secondary line. Kind (forced/SDH) for externals comes from the file name, mapped by `external-filename` in mpv's `track-list`.

### Which subtitle shows

- A remembered per-title choice (milestone 4's `TrackRef`) still wins. External tracks match by language and kind like embedded ones.
- New global **Subtitle language** (default: the Windows display language, falling back to English) and **Prefer SDH** settings in Settings.
- **Nothing remembered**, in order:
  1. **A subtitle file next to the video in the user's language comes on every time** (decided with the user), whatever the audio language. SDH first if preferred, otherwise plain; a forced-only file last.
  2. Otherwise, if the audio is not in the user's subtitle language, show an embedded subtitle in the user's language (my call, Apple TV's "Auto").
  3. Otherwise show only a forced track in the audio language, as milestone 4 does.
- Turning subtitles **Off** when the app had turned one on by itself is remembered as `'off'` for that title, so it stays off next time (extends milestone 4's rule, which remembered Off only over a forced track). **Audio with no language tag** (or `und`) takes the TMDB original language of the title; with no TMDB match it counts as the user's language (my call).

### Searching online (`subtitles/openSubtitles.ts`)

- **Setup in Settings**: an "OpenSubtitles" section with API key, username and password, saved encrypted with DPAPI exactly like the TMDB key (`settings` rows, `safeStorage`), never sent to the renderer. A "Test" result shows the account name and downloads left today. A link explains where to get a free API key.
- **API**: the REST API at `api.opensubtitles.com/api/v1`, with the `Api-Key` header and a `User-Agent` of `VideoPlayer v<version>`. `POST /login` once per app run for a token (kept in memory only); `GET /subtitles`; `POST /download` for a temporary link, then fetch the file.
- **Query**: the file's OpenSubtitles hash (64-bit sum of size + first and last 64 KB, computed on demand; not the app's `quick_hash`) plus the TMDB id — `tmdb_id` for a movie, `parent_tmdb_id` + `season_number` + `episode_number` for an episode. With no TMDB match, the parsed title (and year / season / episode). Languages: the user's subtitle language; a language picker in the panel changes it for that search only.
- **Results panel** (opens from "Search online…" in the Subtitles menu, in the overlay; the video keeps playing): one row per file with language, release name, an "Matches your file" badge for hash matches (listed first), SDH and forced flags, download count. Then the rest ordered by download count. Shows downloads left today.
- **States**: not set up ("Add your OpenSubtitles account in Settings"), searching, no results, offline/server error, daily limit reached (with the reset time the API gives), wrong login.
- **Download**: saved next to the video as `<video basename>.<lang>[.sdh|.forced].srt` (ASS/VTT keep their extension). If that name exists, add `.2`, `.3`… — never overwrite. If the folder can't be written, save under the app's data folder (`subtitles/<videoId>/`) and still use it; the local matcher also looks there. Then `sub-add` with `select`, and remember it as this title's choice.
- No request is made until "Search online…" is chosen.
- **Fixture mode**: `VP_OPENSUBS_MODE=fixtures` (dev builds only, like `VP_TMDB_MODE`) reads recorded responses from `tests/fixtures/opensubtitles/` and serves a local `.srt` for downloads. A recording script takes the user's credentials from environment variables for one command only and never writes them anywhere.

### Style (`src/shared/subtitleStyle.ts`, pure)

```ts
type SubtitleStyle = {
  font: 'default' | 'arial' | 'georgia' | 'courier' | 'consolas' | 'trebuchet' | 'casual' | 'cursive' | 'smallCaps'
  size: number            // % of the base size, 50–200
  textColor: string; textOpacity: number           // #rrggbb, 0–100
  edge: 'none' | 'dropShadow' | 'raised' | 'depressed' | 'outline'
  backgroundColor: string; backgroundOpacity: number   // per-line box
  windowColor: string; windowOpacity: number           // box around the whole cue
  position: number        // 0 = bottom of the screen, 100 = top
}
```
- **Fonts** are ones that ship with Windows 11, mapped like Apple TV's list: default = Segoe UI Variable Display; Arial (Helvetica); Georgia; Courier New; Consolas (Menlo); Trebuchet MS; Comic Sans MS (Casual); Segoe Script (Cursive); default with `font-variant: small-caps` (Small Capitals). No bundled fonts.
- **Presets** (Apple TV's): **Default** — white, soft drop shadow, no box; **Large Text** — Default at 150 %; **Classic** — Consolas, white on a black box at 100 %; **Outline Text** — white with a black outline, no shadow. "Custom" is whatever doesn't match a preset. A preset sets every field except `position` (my call: a preset is a whole look, as on Apple TV); so picking a preset in the player panel overrides the look for that title but never its position.
- **Colours**: Apple TV's set — white, yellow, cyan, green, magenta, red, blue, black.
- **Storage**: the global style is the `settings` row `subtitle.style` (full object). A title's overrides live in a new `title_prefs.style_json` column (migration 4): **only the fields the user changed in the player panel**. Effective style = `{ ...global, ...overrides }`. Choosing a preset in the panel counts as changing the fields the preset sets.
- **Player panel buttons**: "Use for all movies and shows" (global := effective style; clear this title's overrides) and "Reset to my global style" (clear this title's overrides; shown only when there are any).
- Overrides follow the show key through `rekeyPrefs` like the rest of `title_prefs`.

### Drawing (overlay, `SubtitleView.tsx`)

- Follows the `subtitle-formats` renderer spec (per-line box with `box-decoration-break: clone`, `text-wrap: balance`, 120 ms fade in / 160 ms fade out, no movement on cue change, `prefers-reduced-motion` respected, `pointer-events: none`), with the user's style replacing its fixed values.
- **Measured against the window, not the picture** (my call): 0 means the bottom of the screen, as the user said, so on wide films the subtitles sit in the black bar. Base size is 4.5 % of the window height, minimum 18 px, times `size`.
- **Position**: a small safe margin (about 4 % of the height) at both ends; 0 puts the bottom of the subtitle block on the bottom margin, 100 puts its top on the top margin, linear in between.
- **Controls showing**: if the block would overlap the control bar, it lifts just above it (250 ms spring) and drops back when the controls fade. Top-aligned cues and high positions never move.
- **Edges**: drop shadow = soft offset shadow; raised / depressed = light-and-dark 1 px offset pair; outline = 4-way `text-shadow` at 0.06 em (or `-webkit-text-stroke` with `paint-order`, whichever looks cleaner).

### The style panel in the player

- "Style…" at the bottom of the Subtitles menu opens a panel on the right of the overlay; the video keeps playing and the current subtitle stays visible behind it. If no line is on screen, a sample line ("The quick brown fox jumps over the lazy dog.") shows while the panel is open.
- Controls: presets, font, size, text colour, text opacity, edge style, background colour + opacity, window colour + opacity, position slider. Every change applies live.
- Keyboard: ↑/↓ between rows, ←/→ change a value, Esc closes the panel only. The player's own keys don't act while it is open (as with the track menus).

### Settings page

A "Subtitles" section: Subtitle language, Prefer SDH, the same style controls with a 16:9 preview (a backdrop from the library with a sample line), and the OpenSubtitles account. Everything here is global.

### IPC (one contract in `src/shared/api.ts`)
- `subtitles.getStyle` / `subtitles.setGlobalStyle` / `subtitles.setTitleStyle({ key, overrides })` / `subtitles.useForAll({ key })` / `subtitles.resetTitle({ key })`
- `subtitles.search({ language? })` / `subtitles.download({ fileId })` for the playing video only
- `subtitles.account` (status, set, test) — never returns the secrets
- `subtitles.settings` (language, prefer SDH)
- events: `subtitles.cue` (`{ text, top } | null`, sent on every change), `subtitles.style` (effective style for the playing title, on change)

## Testing

- **Unit**: file matching and suffix parsing (all patterns above, case, the one-video folder rule, `Subs/<basename>/`); auto-pick rules; style merge, presets and "changed fields only"; migration 4; OpenSubtitles hash against a known vector; the OpenSubtitles client against recorded fixtures (login, search by hash + TMDB id, episode query, quota and error states); download naming (`.2` when taken, fallback folder when read-only); ASS tag cleanup (italics/bold kept, `\an8` → top, the rest dropped).
- **E2E** (real vendor mpv):
  - a `.srt` next to a fixture movie comes on by itself on first play, is listed in the Subtitles menu, and its line appears in the overlay at the right time and disappears after;
  - a cp1252 `.srt` shows accented characters correctly;
  - the embedded subtitle of `tracks.mkv` is drawn by the overlay;
  - a style change in the player panel applies only to that title; "Use for all" applies to another title; a Settings change reaches a title with overrides except for the overridden field;
  - the position slider moves the line (0 near the bottom, 100 near the top); with the controls showing, a line at 0 sits above the control bar;
  - "Search online…" in fixture mode lists results, downloads one, shows it, and the file appears next to the video; with no account it says to add one.
- **Fixtures**: `make-fixtures.mjs` writes `.srt` files next to the fake library's videos (English, an `.en.forced.srt`, a cp1252 French file, one in `Subs/`), with lines at known times.
- **Manual**: real films with long lines, two-line cues, italics; a 2.39:1 film (subtitles in the black bar); full screen at 125 % scaling; a real OpenSubtitles search and download with the user's account.

## Left to the builder

- Exact visual values (shadow blur, box padding and radius, margins, spring) within the spec, following `apple-design` / `emil-design-eng`.
- How the panel lays out its controls (list rows with pickers vs. swatches), within Apple TV's look.
- The OpenSubtitles result row layout.
- Whether `subtitles.cue` carries mpv's `sub-start`/`sub-end` too.

## Left open (my calls, for the user to check)

- Styled `.ass` files lose their own look and take the user's style.
- Subtitles are positioned against the window, not the picture.
- With nothing remembered and no local file, an embedded subtitle in your language turns on when the audio isn't in your language; untagged audio takes TMDB's original language.
- The default subtitle language comes from Windows' display language.
- Episodes also match subtitle files by season/episode number; files with no language in the name count as your language.
- A preset sets the whole look except position.
