# Milestone 5 — Subtitles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local and online subtitles, drawn by the app in an Apple TV style the user can set globally or per title, at a height they choose.

**Architecture:** mpv loads and times every subtitle (embedded, local files added with `sub-add`, downloads); the main process observes mpv's current line and broadcasts it; the overlay window draws it with the effective style (global settings row + per-title overrides in `title_prefs.style_json`). OpenSubtitles is a main-process REST client used only from the player's "Search online…" panel.

**Tech Stack:** Electron 45, React 19/TS, mpv JSON IPC, `node:sqlite`, Vitest, Playwright-Electron.

**Spec:** `docs/superpowers/specs/2026-10-30-milestone-5-subtitles-design.md`

## Global Constraints

- Never overwrite, rename or delete any file the user has. Downloads get `.2`, `.3`… when the name is taken.
- No network request unless the user chose "Search online…" (or pressed Test in Settings).
- OpenSubtitles API key, username and password: DPAPI-encrypted in `settings` like the TMDB key; never sent to the renderer, never logged, never written to a file, commit or memory. Recording scripts take them from env vars for one command only.
- Cue text is set as text (`textContent` / React text), never HTML.
- Position 0 = bottom of the window, 100 = top. Style sizes are measured against the window, not the picture.
- A title stores only the style fields the user changed for it; effective = `{ ...global, ...overrides }`. Presets set every field except `position`.
- A subtitle file next to the video in the user's language comes on every time when nothing is remembered.
- Append migration 4; never edit migrations 1–3.
- Edit files with the Edit tool (CRLF checkouts). E2E picks the main window by URL and closes with `closeApp`.
- `VP_OPENSUBS_MODE=fixtures` works in dev builds only, like `VP_TMDB_MODE`.

## Review Focus

1. Seeking into the middle of a cue while paused: the line must show at once (mpv's observer fires on seek). → e2e in Task 6.
2. A line left on screen from the previous file when the next episode loads, a track is switched or the player closes. → unit in Task 5.
3. Video names with regex/glob characters (`Amélie (2001)`, `[Group] Show - 01`) and folders with no `Subs` dir or unreadable entries. → unit in Task 3.
4. Switching from a picture-based track back to a text track must hide mpv's drawing again (and vice versa). → unit in Task 5.
5. An OpenSubtitles request that hangs or the network is down: the panel shows an error, not a spinner forever. → unit in Task 8.

---

### Task 1: mpv spike — current line while hidden, encodings

**Files:**
- Create: `scripts/spike-sub-text.mjs` (throwaway, deleted at the end of the task)
- Modify: `.claude/skills/mpv-ipc/SKILL.md` (a "Subtitle text for the overlay" section with the findings)

**Interfaces:**
- Produces: a ledger `Ruling:` naming (a) how mpv's drawing is hidden for text tracks (`sub-visibility=no`, or transparent `sub-color`/`sub-border-color`/`sub-shadow-color` if `sub-text` stops updating when hidden), (b) the formatted-text property used (`sub-text/ass` or `sub-text-ass`, whichever this mpv build has), (c) whether mpv's `sub-codepage` auto-detect decodes cp1252 and cp1256 `.srt` correctly. Task 5 consumes (a)+(b); Task 3 consumes (c).

- [x] **Step 1:** Write the script: spawn `vendor/mpv/mpv.exe --idle=yes --no-video --ao=null --input-ipc-server=\\.\pipe\vp-spike` using `src/main/player/mpvIpc.ts`'s protocol (plain `net` + JSON lines is fine), `loadfile tests/fixtures/media/tracks.mkv`, set `sub-visibility` to `no`, observe `sub-text` and the formatted property, log each change with `performance.now()`; then `sub-add` a cp1252 and a cp1256 `.srt` written by the script (`é`, `ñ`, Arabic letters) and log their `sub-text`.
- [x] **Step 2:** Run: `node scripts/spike-sub-text.mjs`. Expected: `Hello there.` arrives within ~50 ms of 1.0 s while hidden; accented/Arabic text prints correctly, or doesn't (then the ruling says Task 3 decodes in main).
- [x] **Step 3:** Record the findings in the mpv-ipc skill, delete the script, commit.

```bash
git add .claude/skills/mpv-ipc/SKILL.md
git commit -m "docs: mpv subtitle text and encoding findings for the overlay renderer"
```

### Task 2: Languages

**Files:**
- Create: `src/shared/lang.ts`
- Modify: `src/main/player/tracks.ts` (use `languageName` from here; delete its own)
- Test: `tests/unit/lang.test.ts`

**Interfaces:**
- Produces:
  - `type Lang = { code2: string; code1: string; name: string }` — `code2` is mpv's ISO 639-2/B (`eng`, `fre`, `ger`, `chi`), `code1` OpenSubtitles' (`en`, `fr`, `de`, `zh-cn`, `pt-br`, `pt-pt`).
  - `LANGUAGES: readonly Lang[]` — at least the 40 most common subtitle languages, alphabetical by name (the Settings and search pickers list these).
  - `normalizeLang(code: string | null | undefined): string | null` → `code2`; accepts 639-1, 639-2/B and /T (`fra`, `deu`, `zho`), English names (`English`, `french`), locale tags (`en-US`, `pt-BR` → `por`); `und`/unknown → null.
  - `toOpenSubtitles(code2: string): string` → `code1`.
  - `languageName(code: string): string` (same behaviour tracks.ts has today).

- [x] **Step 1: Write the failing tests**

```ts
expect(normalizeLang('en')).toBe('eng'); expect(normalizeLang('ENG')).toBe('eng')
expect(normalizeLang('fra')).toBe('fre'); expect(normalizeLang('deu')).toBe('ger')
expect(normalizeLang('English')).toBe('eng'); expect(normalizeLang('pt-BR')).toBe('por')
expect(normalizeLang('und')).toBeNull(); expect(normalizeLang('xx')).toBeNull(); expect(normalizeLang(null)).toBeNull()
expect(toOpenSubtitles('eng')).toBe('en'); expect(toOpenSubtitles('chi')).toBe('zh-cn')
expect(languageName('jpn')).toBe('Japanese'); expect(languageName('xx1')).toBe('XX1')
```
- [x] **Step 2:** Run `npx vitest run tests/unit/lang.test.ts tests/unit/tracks.test.ts` → FAIL (module missing).
- [x] **Step 3:** Implement `src/shared/lang.ts`; point `tracks.ts` at its `languageName`.
- [x] **Step 4:** Run the same command → PASS.
- [x] **Step 5:** Commit `feat: language codes shared by tracks, subtitles and OpenSubtitles`.

### Task 3: Finding local subtitle files

**Files:**
- Create: `src/main/subtitles/match.ts`, `src/main/subtitles/decode.ts` (only if Task 1 ruled mpv's auto-detect insufficient)
- Test: `tests/unit/subtitleMatch.test.ts` (real temp dirs via `mkdtemp`)

**Interfaces:**
- Consumes: `normalizeLang` (Task 2); `parseVideoPath` from `src/main/library/parseName.ts` for S/E.
- Produces:
  - `type ExternalSub = { path: string; lang: string | null; kind: TrackKind; format: 'srt' | 'vtt' | 'ass' | 'ssa' }`
  - `parseSubName(fileName: string, videoBase: string): { lang: string | null; kind: TrackKind }` — suffix tokens after the video base, split on `.`/`_`/space; `forced` → forced; `sdh`/`hi`/`cc` → sdh; first token `normalizeLang` accepts → lang.
  - `findSubtitles(video: { path: string; season: number | null; episode: number | null }, opts: { userLang: string; extraDirs?: string[] }): Promise<ExternalSub[]>` — order: same folder, `Subs/`, `Subtitles/`, `Subs/<base>/`, `Subtitles/<base>/`, then each `extraDirs` entry (Task 8 passes the app-data fallback folder `subtitles/<videoId>/`). Accepts a file when its name starts with the video base (case-insensitive, plain string compare, no regex/glob built from the name), or the folder holds exactly one video, or (episodes) `parseVideoPath` gives the same season and episode. A file with no language token gets `opts.userLang`. Missing or unreadable folders are skipped. Results de-duplicated by path.
  - If Task 1 ruled decoding in main: `ensureUtf8(path: string, cacheDir: string): Promise<string>` returns the path to hand mpv (the original when already UTF-8, else a UTF-8 copy in `cacheDir`). Adds `jschardet` + `iconv-lite` as dependencies.

- [x] **Step 1: Write the failing tests** (one `it` each):
  - `Movie.Name.2019.mkv` with `Movie.Name.2019.srt`, `.en.srt`, `.English.forced.srt`, `.eng.sdh.srt`, `.fr.srt`, `.hi.srt` → langs `[user, eng, eng, eng, fre, user]` / kinds `[plain, plain, forced, sdh, plain, sdh]`.
  - files in `Subs/`, `Subtitles/`, `Subs/Movie.Name.2019/` are found; a file in an unrelated subfolder isn't.
  - folder with one video: `English.srt` (different name) is found; with two videos it isn't.
  - episode `Show - 1x02.mkv` finds `Show.S01E02.WEB.en.srt` but not `Show.S01E03.en.srt`.
  - `Amélie (2001).mp4` finds `amélie (2001).EN.srt`; `[Group] Show - 01.mkv` finds `[Group] Show - 01.srt` (Review Focus 3).
  - a missing `Subs` folder and a video in a folder that no longer exists → `[]`, no throw.
  - non-subtitle files (`.nfo`, `.txt`, `.idx`) are ignored; `.vtt`, `.ass`, `.ssa` accepted with `format` set.
  - `extraDirs` entries are searched and their files accepted without a name check.
- [x] **Step 2:** `npx vitest run tests/unit/subtitleMatch.test.ts` → FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Same command → PASS.
- [x] **Step 5:** Commit `feat: find local subtitle files next to a video`.

### Task 4: Style model, storage, migration 4

**Files:**
- Create: `src/shared/subtitleStyle.ts`, `src/main/subtitles/styleStore.ts`
- Modify: `src/main/db/migrations.ts` (append 4), `src/main/player/titlePrefs.ts` (keep `style_json` through `savePrefs`), `src/main/metadata/match.ts` (save `original_language`)
- Test: `tests/unit/subtitleStyle.test.ts`, `tests/unit/styleStore.test.ts`, `tests/unit/titlePrefs.test.ts` (schema version 4), `tests/unit/match.test.ts`

**Interfaces:**
- Produces:
  - `SubtitleStyle` exactly as in the spec (font ids `'default' | 'arial' | 'georgia' | 'courier' | 'consolas' | 'trebuchet' | 'casual' | 'cursive' | 'smallCaps'`; `edge: 'none' | 'dropShadow' | 'raised' | 'depressed' | 'outline'`; colours `#rrggbb`; opacities 0–100; `size` 50–200; `position` 0–100).
  - `DEFAULT_STYLE: SubtitleStyle` = Default preset + `position: 0`.
  - `type PresetId = 'default' | 'largeText' | 'classic' | 'outline'`; `PRESETS: Record<PresetId, Omit<SubtitleStyle, 'position'>>`:
    - default: font default, size 100, white 100, edge dropShadow, background black 0, window black 0
    - largeText: default with size 150
    - classic: font consolas, size 100, white 100, edge none, background black 100, window black 0
    - outline: font default, size 100, white 100, edge outline, background black 0, window black 0
  - `COLORS` = white `#ffffff`, yellow `#ffff00`, cyan `#00ffff`, green `#00ff00`, magenta `#ff00ff`, red `#ff0000`, blue `#0000ff`, black `#000000`.
  - `presetOf(s: SubtitleStyle): PresetId | 'custom'`; `effectiveStyle(global: SubtitleStyle, overrides: Partial<SubtitleStyle>): SubtitleStyle`; `sanitizeStyle(raw: unknown): SubtitleStyle` (fills/clamps bad or missing fields from `DEFAULT_STYLE`; stored JSON is untrusted).
  - `createStyleStore(db: Db, now: () => number)` with `global(): SubtitleStyle`, `setGlobal(s: SubtitleStyle): void`, `overrides(key: string): Partial<SubtitleStyle>`, `setOverrides(key: string, patch: Partial<SubtitleStyle>): void` (merges into existing overrides), `useForAll(key: string): void`, `reset(key: string): void`, `effective(key: string): SubtitleStyle`; plus `subtitleSettings(): { language: string; preferSdh: boolean }` / `setSubtitleSettings(...)`. Settings keys `subtitle.style`, `subtitle.language` (default: `normalizeLang(app.getLocale())`, else `eng` — passed in as `defaultLanguage`), `subtitle.preferSdh` (default false).
  - Migration 4: `ALTER TABLE title_prefs ADD COLUMN style_json TEXT; ALTER TABLE tmdb_movies ADD COLUMN original_language TEXT; ALTER TABLE tmdb_shows ADD COLUMN original_language TEXT;`
  - `originalLanguage(db: Db, videoId: number): string | null` in `styleStore.ts`'s sibling `src/main/subtitles/titleInfo.ts` → `normalizeLang` of the movie's or show's `original_language`.

- [x] **Step 1: Write the failing tests**
  - `presetOf({...PRESETS.largeText, position: 40})` → `'largeText'`; changing size to 120 → `'custom'`.
  - `effectiveStyle(global, { size: 150 })` keeps global font; after `setGlobal({...g, font: 'georgia'})`, `effective('movie:1')` has `font 'georgia'` and `size 150` (the Dune example).
  - `setOverrides(k, {size:150}); setOverrides(k, {edge:'outline'})` → overrides `{size:150, edge:'outline'}`.
  - `useForAll(k)` → global equals the previous effective style, `overrides(k)` → `{}`; `reset(k)` → `{}`, global unchanged.
  - `sanitizeStyle({ size: 900, font: 'comic', textColor: 'red' })` → size 200, font default, textColor `#ffffff`.
  - `rekeyPrefs` moves `style_json` (local → tmdb key).
  - `schemaVersion(db)` → 4; `title_prefs` gains `style_json`; matching a movie fixture saves `original_language = 'en'`.
- [x] **Step 2:** `npx vitest run tests/unit/subtitleStyle.test.ts tests/unit/styleStore.test.ts tests/unit/titlePrefs.test.ts tests/unit/match.test.ts` → FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Same command → PASS; then `npm test` → all pass (db/migration tests that assert version 3 are updated to 4).
- [x] **Step 5:** Commit `feat: subtitle style model, per-title overrides and migration 4`.

### Task 5: Player — external tracks, auto-pick, current line

**Files:**
- Create: `src/main/subtitles/cue.ts`
- Modify: `src/main/player/tracks.ts`, `src/main/player/service.ts`, `src/main/player/launch.ts` (flags per Task 1 ruling), `src/shared/player.ts`, `src/shared/api.ts` (event only)
- Test: `tests/unit/cue.test.ts`, `tests/unit/tracks.test.ts`, `tests/unit/playerService.test.ts`

**Interfaces:**
- Consumes: `findSubtitles`, `ExternalSub` (Task 3); `normalizeLang` (Task 2); `createStyleStore`, `originalLanguage` (Task 4); Task 1 ruling.
- Produces:
  - `Track` gains `external: boolean` and `fileName: string | null`.
  - `type Cue = { lines: CueSpan[][]; top: boolean }`, `type CueSpan = { text: string; italic: boolean; bold: boolean }` in `src/shared/player.ts`.
  - `toCue(assText: string): Cue | null` — keeps `\N`/`\n` line breaks, `{\i1}…{\i0}`, `{\b1}…{\b0}`, `<i>`/`<b>`; `{\an7|8|9}` → `top: true`; every other `{…}` tag and HTML tag dropped; empty → null.
  - `toTracks(trackList, externals: ExternalSub[])` — for `external: true` entries, matches `external-filename` to an `ExternalSub` and takes its `lang`/`kind`; label as today, `fileName` set.
  - `pickSubtitle(subs: Track[], pref: TrackRef | 'off' | null, ctx: { audioLang: string | null; userLang: string; preferSdh: boolean }): Track | null` — order from the spec: remembered → external in userLang (sdh first if preferSdh else plain; forced last) → if `audioLang !== userLang`, embedded in userLang (same ordering) → forced in audioLang → null.
  - `subtitlePrefFor(choice: Track | null, autoShowing: boolean): TrackRef | 'off' | null` — Off is remembered whenever a track the app chose by itself (forced or auto) was showing.
  - Service: on `file-loaded`, `findSubtitles` for the video then `sub-add <path> auto <title> <lang>` for each before reading `track-list`; untagged audio uses `originalLanguage(db, videoId)` then userLang; text track selected → hide mpv drawing per ruling; image track → `sub-visibility=yes`; observe the formatted text property and emit `subtitles.cue` (`Cue | null`); emit `subtitles.cue` `null` on `loadfile`, track change and stop. Also emits `subtitles.style` (effective style) on play and whenever it changes (Task 7 calls `notifyStyle()`).
  - `findSubtitles` is called with `extraDirs: [<userData>/subtitles/<videoId>]` (Task 8's download fallback folder).
  - `PlayerService` gains `addSubtitle(path: string): Promise<void>` (Task 8: `sub-add <path> select`, refresh tracks, remember it), `current(): { videoId: number; titleKey: string; path: string } | null`, and `notifyStyle(): void` (re-emits `subtitles.style` for the playing title; Task 7 calls it after every style change).
  - `ApiEvents` gains `'subtitles.cue': Cue | null` and `'subtitles.style': SubtitleStyle`.

- [x] **Step 1: Write the failing tests**
  - `toCue('{\\an8}{\\i1}Hello{\\i0}\\Nthere')` → `{ top: true, lines: [[{text:'Hello',italic:true,bold:false}], [{text:'there',italic:false,bold:false}]] }`; `toCue('{\\pos(10,10)}<b>Hi</b>')` → one bold span, top false; `toCue('')` → null; `<script>` stays literal text.
  - `pickSubtitle`: external `eng` plain chosen for English audio with userLang `eng` and nothing remembered; with `preferSdh` the external SDH is chosen; embedded `eng` NOT chosen for English audio when there is no external; embedded `eng` chosen for Japanese audio; `'off'` still wins; remembered ref still wins over an external.
  - `subtitlePrefFor(null, true)` → `'off'`; `subtitlePrefFor(null, false)` → null.
  - playerService (fake mpv; `findSubtitles` injected as a dep returning one `Movie.en.srt`): `sub-add` is sent before `get_property track-list`; the picked external's id is set as `sid`; the visibility command per ruling is sent; firing the text observer emits `subtitles.cue` with the parsed cue; a `loadfile` for the next episode emits `subtitles.cue` null before the new file's lines (Review Focus 2); `stop()` emits null; selecting an image track sends `sub-visibility yes`, then a text track sends the hide command again (Review Focus 4); untagged audio + `original_language 'ja'` row → embedded English subtitle chosen.
- [x] **Step 2:** `npx vitest run tests/unit/cue.test.ts tests/unit/tracks.test.ts tests/unit/playerService.test.ts` → FAIL.
- [x] **Step 3:** Implement; `createPlayerService` deps gain `findSubtitles` and `styles` (the style store); `setup.ts` wires the real ones.
- [x] **Step 4:** Same command → PASS; `npm test` → all pass; `npm run typecheck` clean.
- [x] **Step 5:** Commit `feat: external subtitle tracks, auto-pick and the current line for the overlay`.

### Task 6: Drawing subtitles in the overlay

**Files:**
- Create: `src/renderer/overlay/SubtitleView.tsx`, `src/renderer/overlay/subtitleLayout.ts`, `src/renderer/overlay/subtitles.css`
- Modify: `src/renderer/overlay/Overlay.tsx`, `scripts/make-fixtures.mjs`
- Test: `tests/unit/subtitleLayout.test.ts`, `tests/e2e/subtitles.spec.ts`

**Interfaces:**
- Consumes: `Cue`, `SubtitleStyle`, events `subtitles.cue` / `subtitles.style` (Tasks 4–5).
- Produces:
  - `styleToCss(s: SubtitleStyle, windowH: number): React.CSSProperties & Record<'--sub-…', string>` — font family per font id (default `"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`; arial `Arial`; georgia `Georgia`; courier `"Courier New"`; consolas `Consolas`; trebuchet `"Trebuchet MS"`; casual `"Comic Sans MS"`; cursive `"Segoe Script"`; smallCaps default + `font-variant: small-caps`), font size `max(18, 0.045 * windowH) * size/100` px, colour with opacity as `rgba`, edge as `text-shadow` per spec, background/window as `rgba`.
  - `subtitleBottom(p: { position: number; windowH: number; blockH: number; controlsTop: number | null; top: boolean }): number` — px from the window bottom to the block's bottom. Margin `m = 0.04 * windowH`; `base = m + position/100 * (windowH - 2m - blockH)`; `top` cues → `windowH - m - blockH`; when `controlsTop` is a number, the cue isn't top, and `base < windowH - controlsTop + 8`, lift to `windowH - controlsTop + 8`.
  - `<SubtitleView cue style controlsTop sample?>`: `data-testid="subtitle"`, one `<span>` per line (`box-decoration-break: clone`), text as React text, `pointer-events: none`, 120 ms fade in / 160 ms out, lift transition 250 ms (none under `prefers-reduced-motion`); `data-position` attribute with the computed bottom for tests.
  - Fixtures: `make-fixtures.mjs` writes next to the fake library (lines at 1.0–4.0 s, 5.0–8.0 s): `The.Matrix.1999.1080p.BluRay.x264.en.srt` ("Wake up, Neo." / "Follow the white rabbit."), `Amélie (2001).fr.srt` in **cp1252** ("Le fabuleux destin d'Amélie"), `Breaking Bad/Season 1/Subs/Breaking.Bad.S01E01.English.srt`, `inception_2010_720p.en.forced.srt`.

- [x] **Step 1: Write the failing unit tests** for `subtitleBottom` (windowH 1000, blockH 100: position 0 → 40; 100 → 860; 50 → 450; top cue → 860; controlsTop 880 with position 0 → 128; controlsTop 880 with position 50 → 450) and `styleToCss` (size 150 at windowH 1000 → `67.5px`; size 100 at windowH 300 → `18px`; textOpacity 50 white → `rgba(255, 255, 255, 0.5)`; classic → background `rgba(0, 0, 0, 1)`).
- [x] **Step 2: Write the failing e2e tests** in `tests/e2e/subtitles.spec.ts` (run `node scripts/make-fixtures.mjs` first):
  - Matrix plays → Subtitles menu shows an "English" item marked checked without any choice; `subtitle` shows "Wake up, Neo." between 1–4 s and is empty at 4.5 s.
  - Amélie: pick French → text contains "Amélie" (é intact).
  - `tracks.mkv` fixture (via a temp library holding it): picking its English track shows "Hello there."
  - Paused, seek to 2.0 s → "Wake up, Neo." visible within 500 ms (Review Focus 1).
  - Breaking Bad S01E01 finds its `Subs/` file.
- [x] **Step 3:** Run `npx vitest run tests/unit/subtitleLayout.test.ts` and `npm run test:e2e -- subtitles.spec.ts` → FAIL.
- [x] **Step 4:** Implement; Overlay keeps `cue`/`style` state from the events and passes `controlsTop` (control bar's top when controls are visible, else null).
- [x] **Step 5:** Same commands → PASS; `npm run test:e2e` (all) → PASS.
- [x] **Step 6:** Commit `feat: Apple TV-style subtitles drawn in the overlay`.

### Task 7: Style panel in the player and the Settings section

**Files:**
- Create: `src/renderer/src/components/SubtitleStyleControls.tsx` (shared by both; the overlay imports it via the `@renderer` alias or a shared folder per electron-vite config), `src/renderer/overlay/StylePanel.tsx`, `src/renderer/src/pages/SubtitleSettings.tsx`, `src/main/subtitles/setup.ts`
- Modify: `src/shared/api.ts`, `src/renderer/overlay/ControlBar.tsx` (menu gets "Style…"), `src/renderer/overlay/Overlay.tsx`, `src/renderer/src/pages/Settings.tsx`, `src/main/index.ts`
- Test: `tests/unit/api.test.ts`, `tests/e2e/subtitleStyle.spec.ts`

**Interfaces:**
- Consumes: style store (Task 4), `PlayerService.current()` and `notifyStyle()` (Task 5), `SubtitleView` (Task 6).
- Produces — `API.subtitles`:
  - `getStyle({ key?: string }) → { global: SubtitleStyle; overrides: Partial<SubtitleStyle> }`
  - `setGlobalStyle({ style: SubtitleStyle })`, `setTitleStyle({ key: string; patch: Partial<SubtitleStyle> })`, `useForAll({ key: string })`, `resetTitle({ key: string })` — each broadcasts `subtitles.style` for the playing title.
  - `getSettings({}) → { language: string; preferSdh: boolean }`, `setSettings({ language?: string; preferSdh?: boolean })`
  - Main validates every incoming style with `sanitizeStyle` / known keys (renderer input is untrusted).
- UI: Subtitles menu's last item "Style…" opens `StylePanel` (`data-testid="style-panel"`, right side of the overlay; rows: Style preset, Font, Size, Text colour, Text opacity, Edge, Background, Background opacity, Window, Window opacity, Position slider; buttons "Use for all movies and shows" and "Reset to my global style" — the latter only when overrides exist). Sample line "The quick brown fox jumps over the lazy dog." while the panel is open and no cue is showing. ↑/↓ rows, ←/→ values, Esc closes the panel only; player keys don't act while it's open. Settings page gets a "Subtitles" section: Subtitle language (from `LANGUAGES`), Prefer SDH, the same controls, and a 16:9 preview (`data-testid="subtitle-preview"`) of a library backdrop with the sample line.

- [x] **Step 1: Write the failing e2e tests**
  - In the player, Style… → size to 150 → `subtitle` font size grows; close and play another movie → normal size; replay the first → still 150.
  - Same change then "Use for all movies and shows" → another movie shows size 150.
  - Settings → font Georgia; play the movie with the size override → font Georgia and size 150.
  - Position slider to 100 in the panel → `data-position` near the top; with controls showing at position 0 the line sits above the control bar.
  - Reset to my global style → size back to global, button disappears.
- [x] **Step 2:** `npm run test:e2e -- subtitleStyle.spec.ts` → FAIL.
- [x] **Step 3:** Implement (API contract + `apiMethods`, `registerDomain(ipcMain, 'subtitles', …)` in `src/main/subtitles/setup.ts`, UI per `apple-design`).
- [x] **Step 4:** Same command → PASS; `npm test`, `npm run typecheck` → PASS.
- [x] **Step 5:** Commit `feat: subtitle style panel in the player and Subtitles settings`.

### Task 8: OpenSubtitles search and download

**Files:**
- Create: `src/main/subtitles/osHash.ts`, `src/main/subtitles/openSubtitles.ts`, `src/main/subtitles/download.ts`, `src/renderer/overlay/SearchPanel.tsx`, `scripts/record-opensubtitles-fixtures.mjs`, `tests/fixtures/opensubtitles/*.json` + `tests/fixtures/opensubtitles/download.srt`
- Modify: `src/main/metadata/credential.ts` (generalise to `createSecretStore(db, safe, key)`; TMDB keeps `'tmdb.credential'`), `src/shared/appError.ts` (codes `opensubtitles_not_set_up`, `opensubtitles_login`, `opensubtitles_unavailable`, `opensubtitles_quota`), `src/shared/api.ts`, `src/main/subtitles/setup.ts`, `src/renderer/overlay/ControlBar.tsx` ("Search online…" item), `src/renderer/src/pages/SubtitleSettings.tsx` (account section)
- Test: `tests/unit/osHash.test.ts`, `tests/unit/openSubtitles.test.ts`, `tests/unit/subtitleDownload.test.ts`, `tests/unit/credential.test.ts`, `tests/e2e/subtitleSearch.spec.ts`

**Interfaces:**
- Consumes: `toOpenSubtitles`, `LANGUAGES` (Task 2); `PlayerService.current()` / `addSubtitle()` (Task 5); `findSubtitles` `extraDirs` (Task 3).
- Produces:
  - `osHash(path: string): Promise<string>` — 16 hex digits: file size + sum of the first and last 64 KB as little-endian uint64 words, mod 2^64.
  - `createOpenSubtitles(opts: { secrets: { apiKey(): string|null; username(): string|null; password(): string|null }; mode: 'live'|'fixtures'; fixturesDir: string; fetch?: typeof fetch; userAgent: string })` with `search(q: { hash?: string; tmdbId?: number; parentTmdbId?: number; season?: number; episode?: number; query?: string; year?: number; language: string }): Promise<SubtitleResult[]>`, `download(fileId: number): Promise<{ content: string; fileName: string; remaining: number; resetAt: string | null }>`, `account(): Promise<{ username: string; remaining: number }>`. Login (`POST /login`) once, token in memory; 401 → one re-login then `opensubtitles_login`; 406/429 quota → `opensubtitles_quota` with `resetAt`; network error or 15 s timeout (`AbortSignal.timeout`) → `opensubtitles_unavailable`.
  - `type SubtitleResult = { fileId: number; language: string; release: string; hashMatch: boolean; sdh: boolean; forced: boolean; downloads: number; format: string }` — sorted hash matches first, then downloads desc.
  - `saveDownload(p: { videoPath: string; lang: string; kind: TrackKind; format: string; content: string; fallbackDir: string }): Promise<string>` → saved path: `<base>.<code1>[.sdh|.forced].<ext>`, `.2`, `.3`… when taken (open with `wx`), falls back to `fallbackDir` when the folder is not writable.
  - `API.subtitles` adds `search({ language?: string }) → { results: SubtitleResult[]; remaining: number | null }`, `download({ fileId: number }) → void`, `accountStatus({}) → { configured: boolean; username: string | null }`, `setAccount({ apiKey: string; username: string; password: string }) → void`, `testAccount({}) → { username: string; remaining: number }`. None return secrets. Search/download act on `player.current()` only; query built from `videos` (`tmdb_id`, or `show_tmdb_id` + season/episode, else `parsed_title`/`parsed_year`/`parsed_show`).
  - Fixture mode: `VP_OPENSUBS_MODE=fixtures` in dev; responses keyed by endpoint + sorted query (like TMDB's `fixtureName`); downloads return `download.srt`.
  - UI: `SearchPanel` (`data-testid="search-panel"`) with language picker, rows (language, release, "Matches your file" badge, SDH/forced, downloads), remaining downloads, states: not set up ("Add your OpenSubtitles account in Settings"), searching, no results, error, limit reached (with reset time), wrong login. Picking a row downloads and selects it, closes the panel.

- [x] **Step 1: Write the failing unit tests**
  - `osHash` on a generated 200 KB file equals the value computed by an independent reference written in the test with `BigInt` over the whole definition; a file under 64 KB hashes without throwing.
  - client (fake fetch): login sends `Api-Key` + `User-Agent` and is done once for two searches; movie search sends `moviehash`, `tmdb_id`, `languages=en`; episode sends `parent_tmdb_id`, `season_number`, `episode_number`; results sorted hash-match first; 401 twice → `opensubtitles_login`; 406 → `opensubtitles_quota` with `resetAt`; a fetch that never resolves → `opensubtitles_unavailable` after the timeout (fake timers) (Review Focus 5); no secrets → `opensubtitles_not_set_up` and no fetch.
  - `saveDownload`: `Movie.mkv` → `Movie.en.srt`; existing `Movie.en.srt` untouched and new file is `Movie.en.2.srt`; sdh → `Movie.en.sdh.srt`; read-only folder (simulate with a path under a file, so `open` fails `ENOTDIR`) → saved in `fallbackDir`.
  - `createSecretStore(db, safe, 'opensubtitles.apiKey')` round-trips and refuses when encryption is unavailable.
- [x] **Step 2: Write the failing e2e tests** (fixture mode): with no account, Search online… shows the set-up message; after `setAccount` via `window.api`, search lists fixture results with one "Matches your file"; picking it shows the downloaded line and a new `.en.srt` (or `.en.2.srt`) exists next to the fixture video; the Matrix's existing `.en.srt` is byte-identical afterwards.
- [x] **Step 3:** Run `npx vitest run tests/unit/osHash.test.ts tests/unit/openSubtitles.test.ts tests/unit/subtitleDownload.test.ts tests/unit/credential.test.ts` and `npm run test:e2e -- subtitleSearch.spec.ts` → FAIL.
- [x] **Step 4:** Implement. Recording script: `OS_API_KEY=… OS_USERNAME=… OS_PASSWORD=… node scripts/record-opensubtitles-fixtures.mjs` records search responses for the fixture titles (no downloads, to spare the quota) and strips tokens/user data before writing.
- [x] **Step 5:** Same commands → PASS; `npm test`, `npm run typecheck`, `npm run test:e2e` → PASS.
- [x] **Step 6:** Commit `feat: search and download subtitles from OpenSubtitles`.

### Task 9: Docs

**Files:**
- Modify: `.claude/skills/subtitle-formats/SKILL.md` (as built: mpv times lines, matcher rules, style model, presets, position maths), `.claude/skills/mpv-ipc/SKILL.md` (sub-add, visibility switching, cue observer), `.claude/skills/test-media-fixtures/SKILL.md` (subtitle fixtures, OpenSubtitles fixtures + recording), `docs/PROJECT_PLAN.md`, `CLAUDE.md` (codebase map: `src/main/subtitles/`, overlay files; gotcha: `VP_OPENSUBS_MODE`; OpenSubtitles secrets rule next to the TMDB one)

- [x] **Step 1:** Update the docs; `npm test` and `npm run typecheck` → PASS.
- [x] **Step 2:** Commit `docs: subtitles milestone in plan, skills and CLAUDE.md`.
