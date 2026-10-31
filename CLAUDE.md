# Video Player

A Windows desktop player for local movie and TV folders. It has:
- an endless poster wall that pans in all directions, with tiles repeating when there are few titles
- a show page per TV show (season/episode picker; Play episode / Continue watching + Restart episode)
- Apple TV-style subtitles
- Netflix-style search
- auto subtitle sync to the speech in the audio (ffsubsync + WebRTC VAD; no speech recognition) plus manual offsets
- VLC-style volume boost to 200%

**Stack:** Electron 45 + React 19/TypeScript (electron-vite) · mpv (child process, `--wid` embed, JSON IPC) · FFmpeg/ffprobe · SQLite (built-in `node:sqlite`) · TMDB · Python 3.12 sidecar (ffsubsync, WebRTC VAD) packaged with PyInstaller.

The full plan, with architecture, milestones and verification, is in [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md). Keep it up to date when decisions change. Skill details are in `required_skills.md`, which is local only and gitignored.

## Resuming work

- **Where we are:** the milestone table in `docs/PROJECT_PLAN.md` has a Status column. ✅ = merged into `main` and pushed. Start the next milestone without a ✅.
- **Each milestone** has a design doc (`docs/superpowers/specs/<date>-milestone-N-*-design.md`) and a plan (`docs/superpowers/plans/…`). Read the previous milestone's design doc before starting the next one; it records decisions and deferred items.
- **Flow per milestone:** `brainstorming` → design doc approved by the user → `writing-plans` → `executing-plans` on a `milestone-N-<name>` branch, test-first → a fresh reviewer on the whole branch → fix Critical/Important findings with a failing test first → full verification → update `CLAUDE.md` (commands, codebase map, gotchas) and the plan's Status column → fast-forward merge into `main` → push. Keep `CLAUDE.md` short: anything only one area needs goes in that area's skill or design doc.
- **Pushing:** the user has given standing permission to push `main` when a milestone is finished, fully tested, review-fixed and working as intended. Never push mid-milestone; never tag or publish releases without asking.

## Setup and commands (Windows, Node 24)

```
npm install
npm run fetch-vendor          # mpv + LGPL ffmpeg into vendor/ (pinned in vendor/manifest.json)
node scripts/make-fixtures.mjs  # test clips + fake movie/TV library (gitignored)
npm run dev                   # app with hot reload
npm run typecheck             # tsc for main/preload and renderer
npm test                      # Vitest unit + integration (uses vendor ffmpeg)
npm run test:e2e              # builds, then Playwright-Electron
npm run setup-sidecar         # sidecar/.venv (py -3.12) + pinned requirements
npm run test:sidecar          # pytest (speech fixtures need make-fixtures)
npm run build-sidecar         # PyInstaller → sidecar/dist/vp-sync/ (~58 MB)
```
- The library DB is `%APPDATA%\video-player\library.db` (one per Windows user). `--user-data-dir=<dir>` points the app elsewhere; E2E tests always do.
- `VP_TMDB_MODE=fixtures` (dev builds only) reads `tests/fixtures/tmdb/*.json` instead of the network. Those fixtures are real TMDB responses; re-record with `TMDB_TOKEN=… node scripts/record-tmdb-fixtures.mjs`.
- `VP_OPENSUBS_MODE=fixtures` (dev builds only) reads `tests/fixtures/opensubtitles/*.json`; `launchApp` in E2E sets it. Re-record searches with `OS_API_KEY=… OS_USERNAME=… OS_PASSWORD=… node scripts/record-opensubtitles-fixtures.mjs`.
- The user's TMDB key and OpenSubtitles login are entered in the app (stored encrypted with DPAPI). **Never write a TMDB key or token, or an OpenSubtitles key or password, to any file, commit or memory**; pass them through environment variables for one command only.

## Codebase map

- `src/shared/` — `api.ts` (the one IPC contract: `API`, `apiMethods`, `ApiEvents`), `appError.ts`, `library.ts` types (incl. `WallItem`), `normalize.ts`, `hash.ts` (FNV-1a).
- `src/main/` — `index.ts` wiring; `db/` (open + migrations via `PRAGMA user_version`; append new migrations, never edit old ones); `ipc.ts` (`registerDomain`); `library/` (parse, scan, watch, queue, queries, show progress, service, `setup.ts` Electron wiring); `metadata/` (TMDB client, credential, scoring, matching); `images/` (WebP cache, `poster://` URLs); `media/` (ffprobe, quick hash, ffmpeg); `player/` (`mpvIpc` client, `launch` spawn + Win32 raise via koffi, `service` = `PlayerService`, `overlay` window, `titlePrefs`, `resume`, `tracks` incl. the subtitle pick and `preferSynced`, `subtitleDelay` = stored offset → mpv `sub-delay`); `subtitles/` (`match` finds files next to a video, `decode` UTF-8 copies for mpv, `cue` mpv line → `Cue`, `parse` the app's own SRT/VTT/ASS reader, `extract` embedded text tracks via ffmpeg, `srt` writer, `export` synced files, `transforms` stored offsets, `styleStore` global + per-title style, `openSubtitles` client, `osHash`, `download`, `setup.ts` = the `subtitles` IPC domain); `sync/` (`sidecar` = the JSON-lines client, `autoSync` = the job: temp SRT → measure → `subtitles/showSynced.ts`, which manual export shares); `broadcast.ts` sends events to every window.
- `sidecar/` — Python auto sync helper: `vp_sync/` (`protocol`, `sync`, `signals`), `tests/`, `build.spec`. In dev main runs `sidecar/.venv/Scripts/python.exe -m vp_sync`; packaged, `resources/sidecar/vp-sync/vp-sync.exe` (`paths.ts` → `sidecarCommand`).
- `src/preload/index.ts` builds `window.api` from `apiMethods`. To add an endpoint: add it to `API` and `apiMethods`, then register a handler with `registerDomain`. Channel names are derived, never hand-written.
- `src/renderer/src/` — `App` (page state: home / search / settings, plus a title page over Home and a black cover while playing), `nav/Menu` (top-left drawer), `pages/` (`Title`, `Settings`, `SearchSoon` until milestone 8), `wall/` (pure `mapping`/`geometry`/`physics`/`camera`, unit-tested in Node; `engine.ts` = imperative tile pool + rAF loop; `Wall.tsx` React shell, `InfoCard`, `Backdrop`).
- `src/renderer/overlay/` — second renderer entry (`overlay.html`) for the player controls: `Overlay`, `ControlBar`, `TrackMenu`, `NextCard`, `SubtitleView` (+ pure `subtitleLayout`), `StylePanel`, `SearchPanel`, `SyncCard` (S: sync to a line), `OffsetPanel` (offset slider), `TimingNote`, `ConfirmCard`, `AutoSyncCard` (A: auto sync). Subtitle timing maths shared by both sides is `src/shared/subtitleTiming.ts`. `src/renderer/src/components/SubtitleStyleControls` is shared by the style panel and Settings → Subtitles. Use `components/Select` for dropdowns, never a native `<select>`: Windows draws its list unstyled.

## Gotchas learned so far

- Electron launched with a file path (as Playwright does) reports `app.getAppPath()` = `out/main` and Electron's own version. Use `join(__dirname, '..', '..')` for the dev root and `package.json` for the version.
- Saving TMDB rows uses upsert, never `INSERT OR REPLACE`: REPLACE deletes first and `ON DELETE SET NULL` unlinks matched videos.
- Git converts files to CRLF on checkout here (`core.autocrlf=true`). Edit with the Edit tool. Shell `sed`/heredoc edits keep mangling backslashes and CRLF text.
- E2E: reach pages with `goTo(win, 'Settings')` from `tests/e2e/pages.ts`. Fixture TMDB mode serves one placeholder image for every TMDB poster, so blue tiles in screenshots are expected.
- Wall keys are handled on `window` and ignored inside `nav`/inputs. Anything that leaves focus in the closing drawer swallows the next key, so menu picks move focus out at once.
- mpv draws into the main window with `--wid`, but Chromium's child windows sit above it: `launch.ts` raises mpv's window with `SetWindowPos` (koffi). Don't remove that call; see `mpv-ipc`.
- The player overlay window exists (hidden) from startup. In E2E, pick the main window by URL (`!url.endsWith('overlay.html')`), never `getAllWindows()[0]`, and close the app with `closeApp(app)` from `pages.ts`: Playwright's `app.close()` stalls while mpv is quitting. Right after launch the overlay's URL is still empty, so it can't be told apart by URL yet. Every spec calls `toSecondDisplay(app)` after `firstWindow()` so test windows stay off the user's primary monitor.
- mpv's `sub-codepage=auto` garbles cp1252/cp1256 subtitles, so files go to mpv as UTF-8 copies (`subtitles/decode.ts`). Text subtitles are drawn by the overlay (`sub-visibility=no`), never by mpv.
- E2E player tests: faded controls take no clicks (move the mouse first), and a seek sent before mpv has opened the file is dropped (wait for the position to move first).
- Auto sync E2E needs `sidecar/.venv` and the speech fixtures (it skips without them). `speech.mkv` syncs in ~0.25 s, too fast to act during the card: tests that cancel or press keys mid-sync use `speech-long.mkv`. English audio means subtitles start off: pick one before pressing A.
- The vendor ffmpeg is an LGPL build: no x264/x265 encoders (fixtures use mpeg4/VP9), but it has libwebp and librsvg. TMDB SVG logos rasterize badly, so PNG logos are preferred.

## Skill routing

Project skills live in `.claude/skills/`. Before starting the matching kind of work, invoke the listed skill by name. Don't wait for it to trigger on its own.

| Task | Skills to use |
|---|---|
| Starting a new feature or milestone | `brainstorming` → `writing-plans` |
| Implementing a plan | `executing-plans` (inline) or `subagent-driven-development` (parallel tasks) |
| Any feature or bugfix code | `test-driven-development` |
| Any bug, failing test or unexpected behavior | `systematic-debugging` |
| Before saying work is done | `verification-before-completion` |
| End of a milestone | `requesting-code-review`, then `/code-review` and `/security-review` |
| Code structure getting messy | `improve-codebase-architecture`, `/simplify` |
| Electron main/preload/windows | `electron` |
| mpv process, player/overlay windows, playback controls, tracks, volume boost | `mpv-ipc` |
| Subtitle parsing, encodings, auto-matching, offsets, manual sync, export, Apple TV renderer | `subtitle-formats` |
| Python sidecar, auto sync (ffsubsync, speech detection only), sync accuracy | `subtitle-sync-ml` |
| Home-screen poster wall | `infinite-wall` |
| Search overlay and ranking | `netflix-search` |
| Test media, fixtures, running test suites | `test-media-fixtures` |
| Vendor binaries, packaging, installer, signing, licenses, releases | `release-windows` |
| Any IPC endpoint (renderer ↔ main) | `electron-skills` |
| Build config (`vite.config.ts`, electron-vite) | `vite` |
| React components and state | `vercel-react-best-practices`, `vercel-composition-patterns` |
| Visual design of any screen | `frontend-design` + `apple-design`; then audit with `impeccable` and `web-design-guidelines` |
| Overall art direction, palette, type | `design-taste-frontend` (use its app-screen rules, not the landing-page ones) |
| Player overlay and subtitles look (Apple TV feel) | `apple-design`, `emil-design-eng` |
| Wall panning, momentum, drift, focus zoom | `animation-performance`, `apple-design` |
| Transitions and motion polish | `improve-animations`, then `review-animations` |
| Framer Motion code (only if adopted) | `framer-motion` |
| ffmpeg/ffprobe commands: probe, thumbnails, subtitle or audio extraction | `ffmpeg` (ignore its Remotion-specific parts) |
| Unit tests | `vitest` |
| End-to-end tests of the Electron app | `playwright-best-practices` (Electron section) |
| Keyboard navigation, contrast, subtitle readability | `accessibility` |
| Renderer speed, frame budget, memory | `performance`, `animation-performance` |
| Launching the app or taking screenshots to check UI | `/run` |

Project-specific skills are the source of truth for their area: `mpv-ipc`, `subtitle-formats`, `subtitle-sync-ml`, `infinite-wall`, `netflix-search`, `test-media-fixtures` and `release-windows`. When an implementation decision changes, update the matching skill and `docs/PROJECT_PLAN.md` in the same commit.

## Conventions
- Never overwrite a user's original subtitle file. Save synced output as `<movie>.<lang>[.sdh|.forced].synced.srt` (`subtitles/export.ts`); replace an existing synced file only after asking.
- Third-party binaries (mpv, ffmpeg) go in `vendor/`, which is fetched by a script and gitignored.
- Commit `.claude/skills/` and `skills-lock.json`. Restore skills with `npx skills experimental_install`. The seven project-specific skills aren't in the lock file; they live only in this repo.
- Commit at sensible checkpoints. Push only as described in "Resuming work" (end of a finished milestone); **never tag or publish without the user's explicit permission**.
