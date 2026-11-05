# Milestone 10: Packaging and publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the player an installable, self-explaining, self-updating Windows app named Cinewall, with a one-command draft release.

**Architecture:** electron-builder (NSIS) packages the existing app with `vendor/` and the built sidecar as extra resources. Two new renderer flows sit on the existing IPC contract: a first-run setup that replaces the whole app until finished, and an update card on Home driven by a state machine in main. electron-updater hides behind a small adapter, so dev and E2E use a fixture adapter and never touch the network.

**Tech Stack:** Electron 45, React 19, TypeScript, electron-vite, electron-builder 26.18.0, electron-updater 6.8.11 (both pinned exactly), Vitest, Playwright-Electron.

**Spec:** `docs/superpowers/specs/2026-11-05-milestone-10-packaging-design.md`

## Global Constraints

- Never tag, push a tag, upload or publish without the user's explicit permission. Never run `npm run release` in this plan. Never push mid-milestone.
- Never write a GitHub token, TMDB key or token, or OpenSubtitles key or password to any file, commit or memory. Environment variables for one command only.
- Data folder stays `%APPDATA%\video-player` in shipped builds. npm package name stays `video-player`.
- Product name `Cinewall`, appId `com.shrivarshaan.cinewall`, first version `1.0.0`, repo `ShriVarshaan/video-player`.
- Dev-only switches follow `VP_TMDB_MODE`: honoured only when `devRoot !== null`, so shipped builds ignore them.
- Add endpoints through `API` and `apiMethods` in `src/shared/api.ts` plus `registerDomain` (`electron-skills`). Use `components/Select`, never a native `<select>`.
- E2E: `tests/e2e/pages.ts` helpers, `toSecondDisplay`, `closeApp`. Windows stay on the second monitor (primary if it isn't connected, and say so in the report).
- Edit with the Edit tool (CRLF checkouts). Every commit ends with the two attribution lines from the current session's system reminder.

## Review Focus

1. Someone quits during setup after saving a key, then relaunches: setup returns at step 1, shows the key as already saved, and lets them continue. (Task 4)
2. Someone gets a key or password wrong, then corrects it: the retry uses the new value, and a rejected login isn't left saved if they then skip. (Task 4)
3. Windows user names and install folders with spaces or accents, such as `C:\Users\José Li\`: mpv, ffprobe, the sidecar and koffi all still work. (Task 2)
4. Enter on the update card's buttons presses the button and doesn't also open the focused wall title. (Task 6)
5. Release notes that are missing, HTML or very long show as short plain text, with no markup and no injected content. (Task 5)

---

### Task 1: Name, icon and licence

**Files:**
- Create: `build/icon.svg`, `build/icon.ico`, `scripts/make-icon.mjs`, `LICENSE`
- Modify: `package.json`, `src/renderer/index.html`, `src/main/index.ts:41`, `src/shared/appError.ts:27`, `tests/e2e/smoke.spec.ts`, `tests/unit/paths*.test.ts`

**Interfaces:** Produces `build/icon.ico` for Task 2.

- [ ] **Step 1: Write the failing tests.** In `smoke.spec.ts`: `expect(await win.title()).toBe('Cinewall')`. In the paths unit test: `expect(userDataDir([], 'C:\\AD')).toBe(join('C:\\AD', 'video-player'))` as a guard (passes already; it pins the rename). In a unit test: `expect(appErrorMessages.db_too_new).toContain('Cinewall')`.
- [ ] **Step 2: Run them.** `npm test -- paths appError` and `npm run test:e2e -- smoke`. Expected: the title and message tests FAIL.
- [ ] **Step 3: Rename.** Set `productName` to `Cinewall`, `version` to `1.0.0`, `license` to `MIT`. Change every user-visible "Video Player" in `src/` (`grep -rn "Video Player" src` must come back empty). Leave `name` and `paths.ts` alone. Write `LICENSE`: MIT, `Copyright (c) 2026 Shri Varshaan`.
- [ ] **Step 4: Make the icon.** `build/icon.svg` from the spec's geometry: 512 canvas, corner radius 112, gradient top left `#ffb347` to bottom right `#e8452f`, white triangle `(166,104) (166,408) (408,256)` clipped to bands `x 166–228`, `242–304`, `318–408`. `scripts/make-icon.mjs` rasterises it with `vendor/ffmpeg/ffmpeg.exe` (it has librsvg) at 16, 24, 32, 48, 64, 128, 256 and writes one `.ico` with PNG entries. Commit both outputs. Look at the 16 px and 256 px rasters before moving on.
- [ ] **Step 5: Run the tests.** Same commands. Expected: PASS.
- [ ] **Step 6: Commit.** `feat: the app is now Cinewall, with its icon and an MIT licence`

### Task 2: A working installer

**Files:**
- Create: `electron-builder.yml`, `build/installer.nsh`, `playwright.packaged.config.ts`, `tests/packaged/packaged.spec.ts`
- Modify: `package.json`, `src/main/index.ts:104`, `electron.vite.config.mts`, `src/main/paths.ts`

**Interfaces:**
- Consumes: `build/icon.ico`.
- Produces: `npm run package` → `release/Cinewall-Setup-<version>.exe` and `release/win-unpacked/`; `npm run test:packaged`.

- [ ] **Step 1: Write the failing test.** `tests/packaged/packaged.spec.ts`, using Playwright's `_electron.launch({ executablePath, args: ['--user-data-dir=<temp>'] })`. It copies `release/win-unpacked` to a temp folder named `Cinewall Tést Ñ` and runs from there (Review Focus 3). Asserts, with `VP_*` variables deliberately set to `fixtures` to prove they're ignored:

```ts
test('the installed app stands alone', async () => {
  // reaches a window titled Cinewall; add a folder (stub dialog) holding a copy of tests/fixtures/media/h264_like.mp4
  await expect(win.locator('[data-testid="wall-tile"]:not([hidden])').first()).toBeVisible() // ffprobe works
  // play it: position passes 0.5 s, so mpv and koffi's raise work
  expect(info.version).toBe('1.0.0')
})
test('the bundled sidecar answers', () => {
  // spawn resources/sidecar/vp-sync/vp-sync.exe, write {"id":1,"method":"ping"}, expect a reply with id 1
})
```
Pass `--user-data-dir` so the user's real library is never opened. Call the same second-display move as `toSecondDisplay`. First-run setup doesn't exist yet: add a `test.fixme` note for Task 4 to route through it.

- [ ] **Step 2: Run it.** `npx playwright test -c playwright.packaged.config.ts`. Expected: FAIL, no build exists.
- [ ] **Step 3: Configure.** Install `electron-builder@26.18.0` (dev). `electron-builder.yml`: appId, productName, `asar: true`, `asarUnpack: ['**/node_modules/koffi/**']`, output `release`, `files: ['out/**', 'package.json']` plus what `node_modules` production deps need, `extraResources` for `vendor` → `vendor` and `sidecar/dist/vp-sync` → `sidecar/vp-sync`; `win.icon: build/icon.ico`, `win.signAndEditExecutable: true` with no certificate; `nsis`: `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, `createDesktopShortcut: true`, `createStartMenuShortcut: true`, `include: build/installer.nsh`, `artifactName: Cinewall-Setup-${version}.${ext}`; `publish: { provider: github, owner: ShriVarshaan, repo: video-player, releaseType: draft }`. Scripts: `package` = `npm run build && electron-builder --win --publish never`; `test:packaged` = `playwright test -c playwright.packaged.config.ts`. Dependencies the renderer or main bundle already contains move to `devDependencies` if the package still runs; koffi stays.
- [ ] **Step 4: Report the true version.** In `index.ts`, pass `version: app.isPackaged ? app.getVersion() : version` to `createAppInfo` and `setupSubtitles`.
- [ ] **Step 5: Uninstall step.** `build/installer.nsh`, macro `customUnInstall`: unless `${isUpdated}`, `MessageBox MB_YESNO|MB_DEFBUTTON2 ... /SD IDNO` asking whether to delete the library, watch progress and saved logins; on Yes, `RMDir /r "$APPDATA\video-player"`.
- [ ] **Step 6: Allow a test data folder.** In `paths.ts`, replace the literal with `DATA_FOLDER`, a build-time constant defined in `electron.vite.config.mts` as `process.env.VP_DATA_FOLDER ?? 'video-player'` for the main build. Task 10 needs this: an update relaunches the app with no arguments, so `--user-data-dir` doesn't survive it. Unit test: the default stays `video-player`.
- [ ] **Step 7: Build and run.** `npm run build-sidecar` if `sidecar/dist/vp-sync` is missing, then `npm run package`, then `npm run test:packaged`. Expected: PASS. Note the installer's size for the report. List the asar contents and confirm no `tests/` or fixtures.
- [ ] **Step 8: Commit.** `feat: a Windows installer that runs on its own, from any folder`

### Task 3: First-run plumbing

**Files:**
- Create: `src/shared/links.ts`, `src/main/firstRun.ts`, `tests/unit/firstRun.test.ts`, `tests/unit/links.test.ts`
- Modify: `src/shared/api.ts`, `src/main/appInfo.ts`, `src/main/index.ts`, `src/main/library/service.ts`, `src/main/library/setup.ts`, `src/main/metadata/tmdbClient.ts`, `src/main/metadata/credential.ts`, `src/main/subtitles/setup.ts`, `src/main/subtitles/openSubtitles.ts`, `tests/e2e/pages.ts`

**Interfaces:**
- Produces:
  - `shouldShowSetup(s: { completed: boolean; folderCount: number; disabled: boolean }): boolean` in `firstRun.ts`
  - `API.app.setupState(): Promise<{ show: boolean }>`, `API.app.finishSetup(): Promise<void>` (stores setting `setup.completed = true`)
  - `API.app.openLink(p: { id: LinkId }): Promise<void>`; `LINKS: Record<LinkId, string>` in `links.ts`, ids `tmdbSignup`, `tmdbApiSettings`, `openSubtitlesSignup`, `openSubtitlesConsumers`, `repo`, `mpvSource`, `ffmpegSource`, `tmdb`
  - `API.metadata.setTmdbKey(p: { key: string; unchecked?: boolean })`
  - `API.subtitles.clearAccount(): Promise<void>`
  - `launchApp(folder, userData?, env?: Record<string, string>)`, which sets `VP_FIRST_RUN=off` by default

- [ ] **Step 1: Write the failing unit tests.**

```ts
expect(shouldShowSetup({ completed: false, folderCount: 0, disabled: false })).toBe(true)
expect(shouldShowSetup({ completed: true, folderCount: 0, disabled: false })).toBe(false)
expect(shouldShowSetup({ completed: false, folderCount: 1, disabled: false })).toBe(false)
expect(shouldShowSetup({ completed: false, folderCount: 0, disabled: true })).toBe(false)
// openLink: an unknown id throws invalid_argument and shell.openExternal is never called
// setTmdbKey: unchecked saves without calling checkKey; without it, a rejected key isn't saved
// tmdb fixture: credential 'offline' throws tmdb_unavailable
// OpenSubtitles fixture: username 'invalid' throws opensubtitles_login, 'offline' throws opensubtitles_unavailable
// secret store clear(): has() becomes false; after setAccount with new details, login uses them, not a cached token
```
- [ ] **Step 2: Run them.** `npm test -- firstRun links`, plus the existing `queries`/`openSubtitles`/`credential` files. Expected: FAIL.
- [ ] **Step 3: Implement.** Verify each URL loads before committing it. `disabled` is `devRoot !== null && VP_FIRST_RUN === 'off'`. `openLink` uses `shell.openExternal(LINKS[id])`, checking the id with `Object.hasOwn`. Add `tmdb_unavailable`-style fixture credentials next to the existing `'invalid'`.
- [ ] **Step 4: Run them, then the whole unit suite and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: what first-run setup needs from main`

### Task 4: First-run setup screens and the Home reminder

**Files:**
- Create: `src/renderer/src/setup/FirstRun.tsx`, `src/renderer/src/setup/setup.css`, `src/renderer/src/setup/useTmdbReminder.ts`, `tests/e2e/firstRun.spec.ts`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/pages/Settings.tsx`, `tests/packaged/packaged.spec.ts`

**Interfaces:** Consumes everything Task 3 produces. Test ids: `setup-step` (with `data-step="tmdb|opensubtitles|folder"`), `setup-check`, `setup-skip`, `setup-message`, `setup-unchecked`, `tmdb-reminder`.

- [ ] **Step 1: Write the failing E2E tests,** launching with `env: { VP_FIRST_RUN: 'on' }`:
  - `fresh launch shows step 1 and no menu or wall`: `setup-step` is `tmdb`, the Menu button has count 0.
  - `an existing library skips setup`: launch with the default env, add a folder, relaunch on the same `userData` with `VP_FIRST_RUN: 'on'`; `setup-step` count 0.
  - `a good key moves on`: fill `test-key`, click `setup-check`, step becomes `opensubtitles`.
  - `a rejected key stays, says so, and the retry works` (Review Focus 2): `invalid` shows the message and stays; `test-key` moves on.
  - `an unreachable service can save unchecked`: `offline` shows `setup-unchecked`; clicking it moves on and `metadata.status` has `hasKey: true`.
  - `a rejected login is not left saved on skip` (Review Focus 2): username `invalid` → message; `setup-skip` → `accountStatus.configured` is false. A second test: `invalid`, then a good login, moves on.
  - `the folder step has no skip, and cancelling stays`: `setup-skip` count 0; a stubbed cancelled dialog stays on `folder`.
  - `finishing goes to the wall and doesn't come back`: stub the dialog, pick the fixture library, tiles show and posters request; relaunch shows no setup; removing every folder still shows the empty wall message, not setup.
  - `links open in the browser only`: stub `shell.openExternal`, click the sign-up link, record the URL equals `LINKS.tmdbSignup`, and the page URL hasn't changed.
  - `quitting mid-setup returns to step 1 with the key saved` (Review Focus 1): save a key, close, relaunch; step `tmdb` says it's saved, and can continue without typing again.
  - `the reminder shows until a TMDB key is saved`: after skipping, `tmdb-reminder` is visible on Home; its button opens Settings; saving a key there and going Home removes it. It doesn't appear on title pages or in search.
- [ ] **Step 2: Run them.** `npm run test:e2e -- firstRun`. Expected: FAIL.
- [ ] **Step 3: Build `FirstRun`.** Follow mockup A. `App` asks `app.setupState` first, renders nothing until it knows (no flash of the wall), then either `<FirstRun onDone=…/>` or today's tree. A step's saved state comes from `metadata.status` and `subtitles.accountStatus`. Error codes pick the path: `tmdb_key_invalid` / `opensubtitles_login` are rejected; `tmdb_unavailable` / `opensubtitles_unavailable` offer "Save without checking". OpenSubtitles saves with `setAccount` then checks with `testAccount`; skip or a rejection calls `clearAccount` unless the login had been accepted earlier. Keys and passwords live only in component state and clear when the step changes. Visual work: `frontend-design` + `apple-design`, matching the app's dark tokens. Each "Skip for now" line says what they'll miss.
- [ ] **Step 4: Add the reminder** (`useTmdbReminder` reloads on page change and `library.changed`) on Home only, positioned clear of tiles the existing wall tests click (`clickAnyTile` needs `left > 64`, `top > 64`). Replace the Settings key label's plain text with the same link buttons.
- [ ] **Step 5: Route the packaged test through setup** (remove the Task 2 `fixme`).
- [ ] **Step 6: Run them, then all of E2E.** Expected: PASS, including the existing tests with setup off by default.
- [ ] **Step 7: Commit.** `feat: first-run setup walks people through their accounts and a folder`

### Task 5: The update service

**Files:**
- Create: `src/shared/updates.ts`, `src/main/updates/service.ts`, `src/main/updates/adapter.ts`, `src/main/updates/setup.ts`, `tests/unit/updates.test.ts`
- Modify: `src/shared/api.ts`, `src/main/index.ts`, `electron.vite.config.mts`, `package.json`

**Interfaces:**
- Produces, in `src/shared/updates.ts`:

```ts
export type UpdateOffer = { version: string; notes: string }
export type UpdateState =
  | { phase: 'idle' } | { phase: 'checking' } | { phase: 'upToDate' }
  | { phase: 'available'; offer: UpdateOffer; manual: boolean }
  | { phase: 'downloading'; offer: UpdateOffer; percent: number }
  | { phase: 'ready'; offer: UpdateOffer }
  | { phase: 'failed'; step: 'check' | 'download'; offer: UpdateOffer | null }
```
- `API.updates`: `state()`, `check(p: { manual: boolean })`, `install()`, `later()`, `skip()`, `restart()`, plus event `'updates.state': UpdateState`.
- `UpdateAdapter = { check(): Promise<{ version: string; notes: unknown } | null>; download(onPercent: (n: number) => void): Promise<void>; quitAndInstall(): void }`.
- `toPlainNotes(notes: unknown): string`.

- [ ] **Step 1: Write the failing unit tests** with a fake adapter and settings store:

```ts
// a found version is offered; check before install doesn't download
// later(): the next automatic check this session stays idle; a new service (next launch) offers it again
// skip(): stored in setting 'updates.skipped'; automatic checks stay quiet for that version; a newer version is offered
// manual check ignores both skip and later
// an automatic check failing stays idle; a manual one becomes { phase:'failed', step:'check' }
// a failed download becomes { phase:'failed', step:'download', offer } and install() retries
// an up-to-date manual check becomes upToDate
// no check runs while one is downloading or ready
expect(toPlainNotes('<h2>New</h2><p>Faster &amp; better</p><script>x</script>')).toBe('New\nFaster & better')
expect(toPlainNotes(null)).toBe('')
expect(toPlainNotes([{ version: '1', note: 'One' }])).toBe('One')
expect(toPlainNotes('l\n'.repeat(50)).split('\n').length).toBeLessThanOrEqual(6) // Review Focus 5
```
- [ ] **Step 2: Run them.** `npm test -- updates`. Expected: FAIL.
- [ ] **Step 3: Implement.** `service.ts` is pure, with injected adapter, settings and emit. `adapter.ts` has `liveAdapter()`, which imports `electron-updater@6.8.11` only when called and sets `autoDownload = false` and `autoInstallOnAppQuit = false` (so "later" can't install on quit), and `fixtureAdapter(mode)`. `setup.ts` picks: packaged → live; `devRoot !== null` and `VP_UPDATE_MODE=available` → fixture offering `9.9.9`; `=fail-check` and `=fail-download` → fixtures failing at that step; otherwise a no-op that reports up to date. Add `electron-updater` to the main build's `external`. First check 15 s after start, then every 4 hours, both automatic.
- [ ] **Step 4: Run them, the unit suite and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: updates are offered, and only downloaded when someone chooses`

### Task 6: The update card

**Files:**
- Create: `src/renderer/src/updates/UpdateCard.tsx`, `src/renderer/src/updates/useUpdates.ts`, `src/renderer/src/updates/updates.css`, `tests/e2e/updates.spec.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:** Consumes Task 5's API. `UpdateCard` props: `{ state: UpdateState }`. Test ids: `update-card`, `update-install`, `update-later`, `update-skip`, `update-progress`, `update-retry`.

- [ ] **Step 1: Write the failing E2E tests** using `env: { VP_UPDATE_MODE: 'available' }` and an `updates.check` call rather than waiting 15 s:
  - `the card shows the version and notes on Home`.
  - `not during a film, and it waits until the player closes`: start playing, then check; `update-card` count 0, and `overlay` unchanged; close with ✕; go Home; visible.
  - `not on a title page, search or Settings; back on Home it shows`.
  - `Remind me later hides it and it returns on the next launch`: same `userData`.
  - `Skip stays quiet across launches; a manual check still offers it`.
  - `Install shows progress, and the app quits when ready`: wait for the app's `close` event.
  - `A download finishing during a film waits`: click install, start playing; the app stays open past the fixture's ready point and position keeps moving; ✕ → the app closes, and the saved position exists in the DB beforehand.
  - `Enter on a card button only presses that button` (Review Focus 4): focus `update-later`, press Enter; card gone, `title-page` count 0.
  - `failed download offers retry` (`VP_UPDATE_MODE: 'fail-download'`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Build.** `useUpdates` in `App` holds state for the whole session. The card renders only when `page === 'home' && !onTitle && !searching && !playing` and phase is `available`, `downloading`, `ready` or a failed download. `useUpdates` calls `updates.restart` when phase is `ready` and `playing` is false, wherever the user is. Notes render as text, never `dangerouslySetInnerHTML`. Key handling: the wall ignores keys from the card's buttons; check how `nav` is exempted in `Wall.tsx`, since it may need the card added to the same rule.
- [ ] **Step 4: Run them and all of E2E.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: an update card on Home: install, remind me later or skip`

### Task 7: Settings → About and the notices

**Files:**
- Create: `scripts/make-notices.mjs`, `THIRD_PARTY_NOTICES.md` (generated, committed), `build/licenses/GPL-2.0.txt`, `build/licenses/LGPL-2.1.txt`, `src/renderer/src/pages/About.tsx`, `src/renderer/src/assets/tmdb.svg`, `tests/unit/notices.test.ts`
- Modify: `src/renderer/src/pages/Settings.tsx`, `src/shared/api.ts`, `src/main/appInfo.ts`, `electron-builder.yml`, `tests/e2e/smoke.spec.ts`, `tests/e2e/updates.spec.ts`

**Interfaces:** Produces `API.app.notices(): Promise<string>` (reads `THIRD_PARTY_NOTICES.md` from `resources` when packaged, the project root in dev). `AppInfo` gains `packaged: boolean`.

- [ ] **Step 1: Write the failing tests.** Unit: `make-notices` output contains `mpv`, the pinned version and `https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261021`; FFmpeg's pinned autobuild tag; the GPL and LGPL texts; `koffi`; every package in the production bundle (React, Fuse.js, electron-updater and their dependencies); every package in `docs/third-party-sidecar.md`; and Electron. E2E: About shows version and `Check for updates`, which shows `You're up to date` by default and the card's offer with `VP_UPDATE_MODE: 'available'`; `THIRD_PARTY_NOTICES` opens and contains `mpv`; the MIT licence and TMDB line and logo show; source links call `openLink` with the right ids; the db path and binaries rows show in dev (`packaged: false`), and the packaged test asserts they don't.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Build.** `make-notices.mjs` reads `vendor/manifest.json`, walks production dependencies plus `react` and `react-dom` from `node_modules` for licence text, reads sidecar licences from `sidecar/.venv` for the packages in `docs/third-party-sidecar.md`, and **fails hard** if any licence text is missing. GPL and LGPL texts come from gnu.org. Get the TMDB logo from TMDB's official logos page. Add the file to `extraResources`.
- [ ] **Step 4: Run them, rebuild with `npm run package` and run `npm run test:packaged`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: About shows updates, licences and notices`

### Task 8: Release script

**Files:**
- Create: `scripts/release.mjs`, `scripts/releaseChecks.mjs`, `CHANGELOG.md`, `tests/unit/releaseChecks.test.ts`
- Modify: `package.json`, `electron-builder.yml`

**Interfaces:** `checkRelease(s: { branch: string; dirty: boolean; head: string; originMain: string; version: string; published: string[]; hasToken: boolean; changelog: string }): string[]` returns the problems, empty when fine. `notesFor(changelog: string, version: string): string | null`.

- [ ] **Step 1: Write the failing unit tests.** Each of these gives its own problem: not on `main`; dirty; `head !== originMain`; version in `published`; no token; no changelog entry. A draft at the same version isn't in `published`, so it's fine. `notesFor` returns just that version's section.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `npm run release` per the spec's four steps: checks; `fetch-vendor` hash check, typecheck, unit, sidecar, E2E; `build-sidecar`, `make-notices` (and stop if it changes the committed file), build; `electron-builder --win --publish always`, with release notes from `notesFor`. `published` comes from the GitHub releases API, ignoring drafts. The token only comes from `GH_TOKEN` in the environment and is never printed. The script never publishes. `CHANGELOG.md` has a `1.0.0` entry in plain words.
- [ ] **Step 4: Run them, plus `node scripts/release.mjs` with no token.** Expected: unit PASS; the script stops at its checks and uploads nothing. **Do not run it with a token.** Its upload stays unproven until the first real draft, so say that in the report.
- [ ] **Step 5: Commit.** `feat: one command builds a draft release`

### Task 9: Documents

**Files:**
- Create: `README.md`, `docs/INSTALL.md`, `docs/friend-test-checklist.md`
- Modify: `.claude/skills/release-windows/SKILL.md`, `CLAUDE.md`, `docs/PROJECT_PLAN.md`

- [ ] **Step 1: Write them.** `README.md`: what it is, the logo, install note, how to build, licence, and that each user needs free accounts. No wall screenshots. `docs/INSTALL.md`: download, "Windows protected your PC" → More info → Run anyway; unsigned and why; the two accounts. `docs/friend-test-checklist.md`, for a non-developer, one page with tick boxes and "what to send back if it goes wrong": the spec's friend's-PC list. `release-windows`: the actual config, Windows Home has no Sandbox, the friend check, update test, the app name, and drop stale items (Deep sync, two-point sync, code signing as a plan). `CLAUDE.md`: commands, the codebase map, `VP_FIRST_RUN`, `VP_UPDATE_MODE`, name vs data folder. `PROJECT_PLAN.md`: reflect the decisions; **don't** mark ✅ yet.
- [ ] **Step 2: Check.** `npm run typecheck`, and confirm every command the documents give exists in `package.json`.
- [ ] **Step 3: Commit.** `docs: how to install Cinewall, test it and release it`

### Task 10: Update check on an installed build, then hand over

**Files:** Create `scripts/update-test.mjs` (local feed plus test builds; keep it, since release testing reuses it).

- [ ] **Step 1: Keep real data out.** The test builds set `VP_DATA_FOLDER=video-player-update-test`, so `%APPDATA%\video-player` is never opened. Record `library.db`'s modified time for Step 3. Stop if a Cinewall install already exists on this PC.
- [ ] **Step 2: Build the two versions and serve them.** The script builds `0.9.0` and `1.0.0` with `-c.publish.provider=generic -c.publish.url=http://127.0.0.1:8765 -c.extraMetadata.version=<v>` into separate folders and serves the newer one on localhost only. Shipped config is untouched.
- [ ] **Step 3: Run the real thing on this PC.** Install `0.9.0` silently, launch it from Playwright, add the fixture library and fake a TMDB key via the test folder, then go through Later, Skip and a manual check, then Install. Expected: the card appears; after install, the app relaunches as `1.0.0`; Settings shows `1.0.0`; the library and saved key are still in `video-player-update-test`; **the real `%APPDATA%\video-player\library.db` has an unchanged modified time**. Uninstall with `/S`; the test folder survives (proves the update and silent paths don't delete); then delete `video-player-update-test` and the installed files.
- [ ] **Step 4: Full verification.** `npm run typecheck`, `npm test`, `npm run test:sidecar`, `npm run test:e2e`, `npm run package`, `npm run test:packaged`.
- [ ] **Step 5: Run the whole-branch review** (executing-plans' Final Review), then `/code-review` and `/security-review`, fixing Critical and Important with a failing test first. Rebuild the installer after the fixes.
- [ ] **Step 6: Stop and hand to the user.** Give them the installer path and `docs/friend-test-checklist.md`. Don't merge. **The milestone waits on the friend.** Fix anything they report with a failing test first, rebuild and hand back. When it passes and the user says so: mark ✅ in `docs/PROJECT_PLAN.md`, commit `docs: mark milestone 10 done`, fast-forward merge to `main`, push `main`. No tag, no upload.
- [ ] **Step 7: Offer the first draft release.** Explain what it does and that it needs a GitHub token through the environment for one command. Run it only if the user says yes. Publishing stays with the user. Say that real GitHub update delivery is proven only when the second release reaches an installed 1.0.0.
