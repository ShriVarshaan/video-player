# Milestone 4 — Playback and title pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every wall title opens a title page (movies and shows), and Play turns the app window into an mpv player with a bottom control bar, per-title memory of volume and tracks, resume, and next-episode autoplay.

**Architecture:**
- Main: a typed JSON-IPC client for mpv (`mpvIpc.ts`) and a `PlayerService` that spawns mpv with `--wid` = the main window, so the video draws inside the app window. A transparent, owned overlay window sits over the main window's content area and loads a second renderer entry (`overlay.html`) with the controls.
- Pure, unit-tested modules carry the rules: resume saving, per-title prefs, track description and matching, next episode, and title-page data (`getTitle`).
- Main renderer: a `title` page (layout A), and the wall's Enter/click opens it. Overlay renderer: control bar (layout B), Audio and Subtitles menus, next-episode card, keys.

**Tech Stack:** Electron 45, React 19, TypeScript, electron-vite (multi-page renderer), `node:sqlite`, vendor mpv (JSON IPC over a named pipe), Vitest (node env), Playwright-Electron.

**Spec:** `docs/superpowers/specs/2026-10-30-milestone-4-playback-design.md`. mpv details are in `.claude/skills/mpv-ipc/SKILL.md`; read both.

## Global Constraints

- One app window for the user. mpv draws with `--wid=<main window HWND>`; the overlay is `transparent: true, frame: false, parent: mainWindow, skipTaskbar: true, hasShadow: false, resizable: false, focusable: true, backgroundColor: '#00000000'`, bounds = `mainWindow.getContentBounds()` on `move`, `resize`, `maximize`, `unmaximize`, `enter-full-screen`, `leave-full-screen`.
- mpv flags: the `mpv-ipc` skill's launch list, except **`--sub-visibility=yes`** (mpv draws text subtitles until milestone 5). File paths go only as `loadfile` arguments.
- Enter/click on a wall tile → title page. The info card's button plays directly. Esc/✕ in the player → save, leave full screen, close to **that title's page**. Esc / "‹ Home" on the title page → wall, same focus.
- Title page copy: movie buttons **▶ Play** / **▶ Continue watching** + **↺ Restart**; show buttons **▶ Play S1 E1** / **▶ Continue S2 E4** + **↺ Restart episode**; time left as "1 h 12 min left" / "21 min left"; rating badge "TMDB 7.6" (hidden when rating is null or 0); finished movie adds "Watched" to the meta line. Unmatched: parsed name, no synopsis, no rating, no placeholders.
- Player top: ✕ and "Arrival" or "Severance · S2 E4 · Woe's Hollow" (episode title omitted when unknown). Bottom bar order: seek bar; play/pause, back 10 s, forward 10 s, volume (icon = mute toggle, slider 0–200 with a tick at 100 and amber above 100, "140%"), "19:42 / 51:52"; right: **Audio**, **Subtitles**, full screen.
- Controls fade after 2.5 s without input while playing; they stay while paused or a menu or the next-episode card is open; the cursor hides with them.
- Keys: Space pause · ←/→ ∓10 s · ↑/↓ volume ±5 (0–200) · M mute · F and double-click full screen · Esc close.
- Next-episode card: bottom right, still + "Next episode · S2 E5 · Trojan's Horse", 10 s countdown, **Play now**, **Cancel**. No autoplay after a Special; after the last episode or a movie's end the player closes to the title page.
- Resume: save every 10 s while playing, and on pause, seek, stop, end of file, episode change, crash and app quit. `completed = 1` at end of file or position ≥ 95 % of duration.
- Prefs per title key (`WallItem.key`), never app-wide: volume (default 100), audio `{lang, kind, title}`, subtitle `{lang, kind, title}` or `"off"`. Track kinds: `plain | forced | sdh | commentary`.
- Volume > 100 → `af add @limiter:lavfi=[alimiter=limit=0.97]`; ≤ 100 → `af remove @limiter`.
- Endpoints follow `electron-skills`: add to `API` + `apiMethods`, register with `registerDomain`; events in `ApiEvents`, sent to **every** window.
- Migrations are appended (this is migration 3), never edited. Edit files with the Edit tool (CRLF checkout).

## Review Focus

1. **The window is moved, resized, maximized, minimized or put in full screen during playback.** The overlay stays exactly over the content area and keeps keyboard focus; restoring from the taskbar or Alt+Tab focuses the overlay, not the main window. Task 7 e2e: resize and maximize while playing, then compare bounds and press Space.
2. **mpv dies mid-film, or a file fails to open.** One respawn at the last position with tracks and volume restored; a second death or `end-file` error shows "Can't play this file" and Esc still reaches the title page with the position saved. Task 6 unit tests with a fake process; Task 7 e2e plays `truncated.mp4`.
3. **The app is closed (window ✕ or Alt+F4) while a video plays.** The position is saved before mpv is killed, and mpv never outlives the app. Task 7 e2e: close during playback, relaunch, the title page offers Continue watching.
4. **Files whose tracks don't line up with the remembered choice:** no language tags, two English subtitle tracks (plain and SDH), a forced track only, or a remembered language the next episode lacks. Picks follow the spec's order and never throw. Task 4 unit tests cover each.
5. **Keys while menus or the countdown are open, and fast repeated input** (holding → or ↑, double Esc). Menus take arrows/Enter/Esc first; Esc closes a menu before it closes the player; volume clamps to 0–200; a second Esc while closing is ignored. Task 9 e2e.

---

### Task 1: Spike — mpv inside the app window

Prove the chosen approach on this laptop before anything is built on it. Throwaway code; the findings go in the ledger.

**Files:**
- Create: `scripts/spike-embed.mjs` (deleted at the end of the task)

- [ ] **Step 1:** Write an Electron script that opens a 960×540 `BrowserWindow` with a solid red page, spawns `vendor/mpv/mpv.exe` with the skill's flags plus `--wid=<HWND>` (`getNativeWindowHandle().readBigUInt64LE(0)`), loads `tests/fixtures/media/h264_like.mp4`, opens a transparent owned overlay window with a white 40 px bar at the bottom, then after 2 s captures the main window with `desktopCapturer.getSources({ types: ['window'], thumbnailSize })` and prints the RGB of the centre pixel and the bottom-bar pixel. Then sends `quit` and captures again.
- [ ] **Step 2:** Run `npx electron scripts/spike-embed.mjs`.
  Expected: centre pixel is not red while playing (video drew above the page); bar pixel white (overlay above the video, if the capture includes owned windows — otherwise check by eye); centre pixel red again after `quit` (the page shows once mpv exits).
- [ ] **Step 3:** Ledger the outcome as a `Ruling:`. Pass → approach A, mpv spawned per play and quit on close (stopping playback without quitting leaves mpv's black child window over the page). Fail → approach B (a frameless player window under the overlay, same IPC); per the spec, continue and tell the user why. Delete the script; nothing to commit.

### Task 2: mpv JSON-IPC client

**Files:**
- Create: `src/main/player/mpvIpc.ts`
- Test: `tests/unit/mpvIpc.test.ts`

**Interfaces:**
- Produces: `connectMpv(pipe: string, opts?: { retryMs?: number; timeoutMs?: number; commandTimeoutMs?: number }): Promise<MpvClient>` with
  `type MpvClient = { command(...args: unknown[]): Promise<unknown>; observe(name: string, cb: (value: unknown) => void): Promise<void>; on(event: string, cb: (msg: Record<string, unknown>) => void): () => void; onClose(cb: () => void): void; close(): void }`.
  Defaults: retry 50 ms, connect timeout 5000 ms, command timeout 5000 ms. `command` rejects with `AppError` code `'mpv'` when `error !== 'success'`.

- [ ] **Step 1: Write failing tests** against a `net.createServer` on `\\.\pipe\vp-test-<random>`:
  - `it('retries until the pipe exists')`: start the server 200 ms after `connectMpv`; resolves.
  - `it('fails after the connect timeout')`: no server, `timeoutMs: 300` → rejects with code `'mpv'`, message contains "mpv did not start".
  - `it('matches responses to requests by request_id')`: two concurrent commands answered out of order resolve with their own `data`.
  - `it('handles messages split across chunks and several in one chunk')`.
  - `it('rejects a command after commandTimeoutMs')` and `it('rejects when mpv answers with an error')`.
  - `it('observe sends observe_property with a fresh id and delivers property-change data')`.
  - `it('delivers events and stops after unsubscribe')`; `it('calls onClose and rejects pending commands when the pipe closes')`.
- [ ] **Step 2:** `npx vitest run tests/unit/mpvIpc.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `connectMpv` (newline framing, incrementing `request_id`, observe ids from 1).
- [ ] **Step 4:** Same command — Expected: PASS.
- [ ] **Step 5:** Commit `feat: typed mpv JSON-IPC client`.

### Task 3: Migration 3, per-title prefs and resume saving

**Files:**
- Modify: `src/main/db/migrations.ts` (append migration 3), `src/main/metadata/match.ts` (rekey prefs when a show is first matched)
- Create: `src/main/player/titlePrefs.ts`, `src/main/player/resume.ts`
- Test: `tests/unit/titlePrefs.test.ts`, `tests/unit/resume.test.ts`, `tests/unit/match.test.ts`, `tests/unit/db.test.ts` (version 3)

**Interfaces:**
- Produces in `src/shared/player.ts` (new): `type TrackKind = 'plain' | 'forced' | 'sdh' | 'commentary'`; `type TrackRef = { lang: string | null; kind: TrackKind; title: string | null }`; `type TitlePrefs = { volume: number; audio: TrackRef | null; subtitle: TrackRef | 'off' | null }`.
- Produces: `getPrefs(db, key): TitlePrefs` (defaults `{ volume: 100, audio: null, subtitle: null }`), `savePrefs(db, key, patch: Partial<TitlePrefs>, now: number): void`, `rekeyPrefs(db, from: string, to: string): void` (no-op when `to` exists). `savePosition(db, { videoId, positionS, durationS, ended?: boolean }, now: number): void`.

- [ ] **Step 1: Write failing tests:**
  - migration: `PRAGMA user_version` is 3; `title_prefs(title_key TEXT PRIMARY KEY, volume INTEGER, audio_json TEXT, subtitle_json TEXT, updated_at INTEGER NOT NULL)` exists.
  - `titlePrefs`: defaults for an unknown key; `savePrefs` patches only the given fields; `subtitle: 'off'` round-trips; `rekeyPrefs('local:breaking bad', 'tmdb:1396')` moves the row; rekey keeps the existing target row when both exist.
  - `resume`: upsert writes `position_s`, `duration_s`, `last_played_at`; `completed` becomes 1 at 95 % (`positionS 95, durationS 100`) and with `ended: true`; stays 0 at 94.9 %; a later save below 95 % after a completed one keeps `completed = 1` only if `ended`/95 % again (rewatching resets it — assert 0).
  - `match.test.ts`: `it('moves remembered prefs when a local show is matched')` — prefs saved under `local:<parsed_show>` are under `tmdb:<id>` after `matchPending`.
- [ ] **Step 2:** `npx vitest run tests/unit/titlePrefs.test.ts tests/unit/resume.test.ts tests/unit/match.test.ts tests/unit/db.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement; in `match.ts` call `rekeyPrefs` where an episode's `show_tmdb_id` is first set, using its `parsed_show`.
- [ ] **Step 4:** Same command — Expected: PASS. Then `npm test` — all green.
- [ ] **Step 5:** Commit `feat: per-title prefs and resume saving`.

### Task 4: Tracks — describe and match

**Files:**
- Create: `src/main/player/tracks.ts`
- Test: `tests/unit/tracks.test.ts`

**Interfaces:**
- Produces in `src/shared/player.ts`: `type Track = { id: number; type: 'audio' | 'sub'; label: string; lang: string | null; kind: TrackKind; title: string | null; image: boolean; default: boolean }`.
- Produces: `toTracks(trackList: unknown): Track[]` (from mpv `track-list`; `image` for `hdmv_pgs_subtitle`, `dvd_subtitle`, `dvb_subtitle`), `languageName(code: string): string`, `pickTrack(tracks: Track[], ref: TrackRef | null): Track | null`, `pickSubtitle(subs: Track[], pref: TrackRef | 'off' | null, audioLang: string | null): Track | null`, `subtitlePrefFor(choice: Track | null, forcedShowing: boolean): TrackRef | 'off' | null`, `refOf(t: Track): TrackRef`.

- [ ] **Step 1: Write failing tests:**
  - `toTracks`: kind is `forced` when mpv's `forced` is true; `sdh` when `hearing-impaired` is true or the title matches `/SDH|hearing/i`; `commentary` when the title matches `/commentary/i`; else `plain`. Labels: audio `"English 5.1"` (`lang 'eng'`, `demux-channel-count 6`), `"Japanese"` (stereo or unknown channels: no suffix), no language → the title, else `"Track 3"`; subtitle labels add " (SDH)", " (Forced)", " (Commentary)". Video tracks are dropped.
  - `languageName('eng') === 'English'`, `languageName('jpn') === 'Japanese'`, `languageName('xx1') === 'XX1'`.
  - `pickTrack` order: same lang + kind → same lang + plain → same title → `null` (caller keeps mpv's default). `ref null` → `null`. Two English tracks (plain, sdh) with ref `{eng, sdh}` → the SDH one.
  - `pickSubtitle`: `'off'` → `null`; ref → `pickTrack` result; `null` pref → the forced track whose lang equals `audioLang`, else `null`.
  - `subtitlePrefFor(null, true) === 'off'`; `subtitlePrefFor(null, false) === null`; `subtitlePrefFor(track, *)` → `refOf(track)`.
- [ ] **Step 2:** `npx vitest run tests/unit/tracks.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement (`Intl.DisplayNames(['en'], { type: 'language' })`, falling back to the upper-cased code when it throws or echoes the code).
- [ ] **Step 4:** Same command — Expected: PASS.
- [ ] **Step 5:** Commit `feat: describe and match audio and subtitle tracks`.

### Task 5: Title data — `getTitle`, `nextEpisode`, `library.getTitle`

**Files:**
- Modify: `src/shared/library.ts`, `src/main/library/queries.ts`, `src/main/library/showProgress.ts`, `src/shared/api.ts`, `src/main/library/setup.ts`
- Test: `tests/unit/queries.test.ts`, `tests/unit/showProgress.test.ts`, `tests/unit/api.test.ts`

**Interfaces:**
- Produces in `src/shared/library.ts`:
  ```ts
  type TitleButton = { label: string; videoId: number; from: 'resume' | 'start' }
  type TitleDetail = {
    key: string; kind: 'movie' | 'show'; title: string; year: number | null
    runtimeMin: number | null; seasonCount: number | null; episodeCount: number | null
    genres: string[]; rating: number | null; overview: string | null
    posterUrl: string; backdropUrl: string | null; matched: boolean; watched: boolean
    main: TitleButton; restart: TitleButton | null
    remainingS: number | null; progress: number | null // for the main button when continuing
    seasons: ShowDetail['seasons']; openSeason: number | null // shows only; [] / null for movies
  }
  ```
- Produces: `getTitle(db, key: string): TitleDetail | null` (`movie:<id>` or a show key; follows a `local:` key to its match like `getShow`), `nextEpisode(episodes: ProgressEpisode[], currentVideoId: number): ProgressEpisode | null` in `showProgress.ts`, `window.api.library.getTitle({ key })`.

- [ ] **Step 1: Write failing tests** reusing `queries.test.ts`'s fixture:
  - movie not started: `main = { label: 'Play', from: 'start' }`, `restart null`, `watched false`, full `overview` (not cut), `rating`, `genres` sorted, `backdropUrl` as in `listWall`.
  - movie at 600 / 8160 s: `main.label 'Continue watching'`, `from 'resume'`, `restart.label 'Restart'`, `remainingS 7560`, `progress ≈ 0.0735`.
  - movie finished (completed): `main.label 'Play'`, `from 'start'`, `watched true`, `restart null`.
  - show, nothing watched: `main.label 'Play S1 E1'`; partway S1E2: `'Continue S1 E2'` + `restart.label 'Restart episode'`; `openSeason` = the next-up episode's season.
  - unmatched movie: `title` = parsed title, `overview null`, `rating null`, `matched false`.
  - unknown key → `null`.
  - `nextEpisode`: S1E1 → S1E2; last of S1 → first of S2; last episode → `null`; a Special → `null`; skips missing numbers (S1E1 → S1E3 when E2 has no file).
- [ ] **Step 2:** `npx vitest run tests/unit/queries.test.ts tests/unit/showProgress.test.ts tests/unit/api.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement by reusing `listWall`'s movie row (largest file per title) and `getShow` for shows; register `getTitle` in `setup.ts`.
- [ ] **Step 4:** Same command — Expected: PASS.
- [ ] **Step 5:** Commit `feat: title page data and next episode`.

### Task 6: PlayerService

**Files:**
- Create: `src/main/player/service.ts`
- Modify: `src/shared/player.ts`, `src/shared/api.ts`
- Test: `tests/unit/playerService.test.ts`

**Interfaces:**
- Consumes: Task 2 `MpvClient`; Task 3 `getPrefs`/`savePrefs`/`savePosition`; Task 4 `toTracks`/`pickTrack`/`pickSubtitle`/`subtitlePrefFor`/`refOf`; Task 5 `getTitle`/`nextEpisode`.
- Produces in `src/shared/player.ts`:
  ```ts
  type PlayerState = { titleKey: string; videoId: number; heading: string; paused: boolean; positionS: number
    durationS: number | null; volume: number; muted: boolean; audio: Track[]; subtitles: Track[]
    audioId: number | null; subtitleId: number | null; fullScreen: boolean }
  type NextEpisode = { videoId: number; season: number; episode: number; title: string | null; stillUrl: string }
  type PlayerCommand = { type: 'pause'; paused: boolean } | { type: 'seek'; toS: number } | { type: 'seekBy'; s: number }
    | { type: 'volume'; value: number } | { type: 'mute'; muted: boolean } | { type: 'audio'; id: number }
    | { type: 'subtitle'; id: number | null } | { type: 'fullScreen'; on: boolean }
  ```
  API domain `player: { play(p: { key: string; videoId?: number; from?: 'resume' | 'start' }): Promise<void>; stop(p: Record<string, never>): Promise<void>; command(p: PlayerCommand): Promise<void> }`; events `'player.state': PlayerState`, `'player.ended': { next: NextEpisode | null }`, `'player.closed': { titleKey: string }`, `'player.error': { message: string }`.
- Produces: `createPlayerService(deps: { db: Db; launch: () => Promise<MpvProcess>; emit: Emit; window: { setFullScreen(on: boolean): void; isFullScreen(): boolean }; overlay: { show(): void; hide(): void }; now: () => number }): PlayerService` where `type MpvProcess = { client: MpvClient; onExit(cb: (expected: boolean) => void): void; quit(): Promise<void> }` and `PlayerService = { play, stop, command, shutdown(): Promise<void> }`.

- [ ] **Step 1: Write failing tests** with a fake `MpvProcess` that records commands and lets the test push property changes and events (vitest fake timers):
  - `play({ key: 'movie:2' })` with no `videoId` plays the title's `main` button: `loadfile <path> replace` then, on `file-loaded`, `seek 600 absolute` (resume) and `set_property volume 100`; `overlay.show()` called; `player.state` emitted.
  - `from: 'resume'` on a finished video starts at 0; `from: 'start'` never seeks.
  - remembered prefs: volume 150 → `set_property volume 150` and `af add @limiter:...`; audio ref `{jpn, plain}` → `set_property aid <jpn id>` once `track-list` arrives; subtitle `null` with a forced English track and English audio → `set_property sid <forced id>`.
  - `command({ type: 'volume', value: 90 })` after 150 → `af remove @limiter`, prefs volume 90 under the title key; values clamp to 0–200.
  - `command({ type: 'subtitle', id: null })` while the forced track shows → prefs subtitle `'off'`.
  - resume: position saved after 10 s of `time-pos` updates, on `pause`, after a seek, and on `stop()`; `player.state` throttled to ≤ 30 per second.
  - `end-file` `eof` on S1E1 → position saved with `ended`, `player.ended` with next S1E2; on a movie → `stop()` path: `quit`, `overlay.hide()`, `player.closed { titleKey }`; a Special → closed.
  - `play({ key, videoId: next })` while playing reuses the process (`loadfile replace`, no second `launch`).
  - unexpected exit → `launch` once more, `loadfile`, seek to the last position, restore aid/sid/volume; a second unexpected exit → `player.error { message: "Can't play this file" }`; `end-file` with `reason: 'error'` → same error event.
  - `stop()` leaves full screen (`setFullScreen(false)`), is idempotent (second call no-op), and `shutdown()` saves then quits.
- [ ] **Step 2:** `npx vitest run tests/unit/playerService.test.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement. Heading: movie title, or `"<show> · S<s> E<e> · <episode title>"`.
- [ ] **Step 4:** Same command — Expected: PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat: player service`.

### Task 7: Electron wiring — launch, overlay window, overlay entry

**Files:**
- Create: `src/main/player/launch.ts` (spawn + `connectMpv`, pipe `\\.\pipe\vp-mpv-<pid>-<n>`), `src/main/player/overlay.ts`, `src/main/player/setup.ts`, `src/renderer/overlay.html`, `src/renderer/overlay/main.tsx`, `src/renderer/overlay/Overlay.tsx` (minimal: heading, time, ✕; Task 9 completes it), `tests/e2e/player.spec.ts`
- Modify: `electron.vite.config.mts` (renderer inputs `index` and `overlay`), `src/main/index.ts` (broadcast events to all windows; `player.shutdown()` on main window `close` and `before-quit` before mpv is killed), `tests/e2e/pages.ts`

**Interfaces:**
- Consumes: Task 6 `createPlayerService`.
- Produces: `createOverlay(main: BrowserWindow, load: (w: BrowserWindow) => void): { window: BrowserWindow; show(): void; hide(): void }` — tracks content bounds, focuses itself on show and whenever the main window gains focus while shown. `tests/e2e/pages.ts`: `overlayPage(app): Promise<Page>` (the window whose URL ends in `overlay.html`), `playTitle(win, title)` (opens the title page via the wall and clicks its main button).
- Overlay test ids used later: `player-heading`, `player-time`, `player-close`.

- [ ] **Step 1: Write failing e2e tests** in `player.spec.ts` (fixture library, `VP_TMDB_MODE=fixtures`; until Task 8 drive playback with `win.evaluate(() => window.api.player.play({ key }))`, key from `window.api.library.wall({})`):
  - `it('plays inside the app window')`: overlay page appears; `player-time` advances past `0:02` within 5 s; `app.windows()` has 2 entries.
  - `it('keeps the overlay over the content area')`: after `setSize(1100, 700)` and `maximize()` on the main window, overlay bounds equal `getContentBounds()`.
  - `it('closes to the title and saves the position')`: wait 3 s, click `player-close`; overlay hidden; `library.getTitle` returns `main.label 'Continue watching'`.
  - `it('saves the position when the app is closed during playback')`: relaunch with the same user data; `getTitle` says Continue watching; no `mpv.exe` child left (`tasklist` has no mpv with the old pid's pipe).
  - `it("shows Can't play this file for a broken file")`: a temp folder with `truncated.mp4` → overlay shows the message.
- [ ] **Step 2:** `npm run test:e2e -- tests/e2e/player.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement. In dev load `ELECTRON_RENDERER_URL + '/overlay.html'`, packaged `out/renderer/overlay.html`; the overlay gets the same preload and `will-navigate`/window-open guards as the main window. Drag the window by hand while playing: if the controls visibly trail, hide the overlay on `will-move` and show it 150 ms after the last `move` (spec, "window drag"); ledger which way it went.
- [ ] **Step 4:** Same command — Expected: PASS. Then the full `npm run test:e2e` — all green.
- [ ] **Step 5:** Commit `feat: mpv plays inside the app window with an overlay`.

### Task 8: Title page and wall → page → player

**Files:**
- Create: `src/renderer/src/pages/Title.tsx`, `src/renderer/src/pages/title.css`, `src/shared/time.ts`, `tests/unit/time.test.ts`, `tests/e2e/title.spec.ts`
- Modify: `src/renderer/src/App.tsx` (pages `home | search | settings | title`, `titleKey` state, black `.playing` cover while `player.state` is live, `player.closed` → title page for its key), `src/renderer/src/wall/Wall.tsx` (`onOpen(key)`; Enter/click → `onOpen`), `src/renderer/src/wall/InfoCard.tsx` (button enabled, calls `player.play({ key })`, hint removed; clicks no longer reach the poster), `tests/e2e/pages.ts` (`openTile` now expects the title page), `tests/e2e/wall.spec.ts` (card tests use hover-focus, not Enter)

**Interfaces:**
- Consumes: `library.getTitle`, `player.play`, events `player.state` / `player.closed` / `library.changed`.
- Produces: `formatTime(s: number): string` ("0:00", "0:07", "19:42", "1:02:05") and `timeLeft(s: number): string` ("1 h 12 min left", "21 min left", "1 min left") in `src/shared/time.ts`, used by the title page and the overlay.
- Test ids: `title-page`, `title-heading`, `title-meta`, `title-rating`, `title-synopsis`, `title-main`, `title-restart`, `title-left`, `season-tab`, `episode-card`.

- [ ] **Step 1: Write failing tests:**
  - unit `time.test.ts`: the `formatTime` and `timeLeft` values above.
  - Enter on a focused movie tile opens `title-page` with its title, the full synopsis and `title-rating` "TMDB 8.2"-style text; Esc returns to the wall and `wall-live` still names that title.
  - an unmatched title (Some Unknown Home Video) has no `title-synopsis` and no `title-rating`.
  - movie: `title-main` "Play" → plays; Esc → back on the same title page, `title-main` "Continue watching", `title-restart` "Restart", `title-left` ends in "left"; Restart plays from 0 (`player-time` starts below `0:02`).
  - show (Breaking Bad): `season-tab` "Season 1", "Season 2"; clicking an `episode-card` plays that episode (heading contains "S1 E2"); `title-main` "Play S1 E1" before any play.
  - clicking the info card's button on the wall plays directly (overlay appears, title page not shown first).
  - `library.changed` while on the title page refreshes it (the Continue label appears after playback without reopening).
- [ ] **Step 2:** `npx vitest run tests/unit/time.test.ts` and `npm run test:e2e -- tests/e2e/title.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement layout A per the spec and Global Constraints (`frontend-design` + `apple-design`); keyboard: Tab order main → restart → seasons → episodes, ←/→ move within the season row and the episode strip (roving tabindex), the strip scrolls the focused card into view; Esc → home.
- [ ] **Step 4:** Same command — Expected: PASS; then full `npm run test:e2e` green.
- [ ] **Step 5:** Commit `feat: title pages; wall opens them and the card plays`.

### Task 9: Player controls, menus, keys and autoplay

**Files:**
- Modify: `src/renderer/overlay/Overlay.tsx`; Create: `src/renderer/overlay/ControlBar.tsx`, `src/renderer/overlay/TrackMenu.tsx`, `src/renderer/overlay/NextCard.tsx`, `src/renderer/overlay/overlay.css`
- Modify: `scripts/make-fixtures.mjs` (add `tests/fixtures/media/tracks.mkv`: 20 s, audio `eng` 6-ch and `jpn` stereo, subtitles `eng` "English", `eng` "English SDH" with hearing-impaired flag, `eng` forced), `tests/e2e/player.spec.ts`

**Interfaces:**
- Consumes: `player.command`, `player.stop`, `player.play`, events `player.state` / `player.ended` / `player.error`.
- Consumes: Task 8 `src/shared/time.ts`.
- Test ids: `seek`, `play-pause`, `volume`, `volume-value`, `audio-button`, `subtitles-button`, `track-menu`, `fullscreen`, `next-card`, `next-play`, `next-cancel`, `next-count`.

- [ ] **Step 1: Write failing tests:**
  - e2e: Space pauses (`player-time` stops advancing) and resumes; → moves forward 10 s (clamped near the end); ↑ ×10 from 100 shows "150%" and the slider's amber state; volume persists for that title only (replay it → 150 %, another title → 100 %).
  - e2e with `tracks.mkv` in a temp folder: `audio-button` menu lists "English 5.1" and "Japanese"; `subtitles-button` menu lists "Off", "English", "English (SDH)", "English (Forced)"; choosing Japanese then closing and replaying keeps Japanese; Esc with a menu open closes only the menu.
  - e2e controls fade: after 3 s idle while playing the bar has `data-hidden="true"`; moving the mouse shows it.
  - e2e autoplay (Breaking Bad S1E1): seek to 2 s before the end → `next-card` shows "S1 E2", `next-count` counts down; `next-play` starts S1E2 immediately; a second run lets the countdown reach 0 and S1E2 plays; `next-cancel` hides the card and leaves the overlay open; S2E1 (last) ending closes to the show page.
- [ ] **Step 2:** `npm run test:e2e -- tests/e2e/player.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Implement layout B (`apple-design`, `emil-design-eng`): the overlay root is transparent; bar over a bottom gradient; seek bar drag sends `seek` on release and previews time while dragging; position interpolated between `player.state` updates with `performance.now()` while playing; double-click on the empty area toggles full screen; cursor `none` with the hidden controls.
- [ ] **Step 4:** Same commands — Expected: PASS; full `npm test` and `npm run test:e2e` green.
- [ ] **Step 5:** Commit `feat: player controls, track menus, keys and next-episode autoplay`.

### Task 10: Docs

**Files:**
- Modify: `CLAUDE.md` (commands unchanged; codebase map gains `src/main/player/` and `src/renderer/overlay/`; gotchas from this milestone), `docs/PROJECT_PLAN.md` (playback/navigation decisions; milestone 4 ✅ only at merge), `.claude/skills/mpv-ipc/SKILL.md` (per-play spawn, `--sub-visibility=yes` until milestone 5, `title_prefs`, track matching, overlay focus rules, events), `.claude/skills/infinite-wall/SKILL.md` (Enter opens the title page; card button plays)

- [ ] **Step 1:** Update the files above; keep `CLAUDE.md` short.
- [ ] **Step 2:** `npm run typecheck && npm test` — Expected: clean, all pass.
- [ ] **Step 3:** Commit `docs: playback milestone in plan, skills and CLAUDE.md`.
