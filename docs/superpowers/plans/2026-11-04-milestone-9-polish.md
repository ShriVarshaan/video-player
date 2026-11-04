# Milestone 9: Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five things the user listed from real use: Esc and click in the player, the line over the video, an "Ends at" time, and the ☰ button in search.

**Architecture:** Mostly small changes in the overlay renderer (`Overlay.tsx`) and CSS. "Ends at" adds one field to `TitleDetail`, a pure formatter in `shared/time.ts`, and the Windows time format to `AppInfo`.

**Tech Stack:** Electron 45, React 19, TypeScript, Vitest, Playwright-Electron, koffi.

**Spec:** `docs/superpowers/specs/2026-11-04-milestone-9-polish-design.md`

## Global Constraints

- Work on branch `milestone-9-polish`. Test first for every behaviour. Never push mid-milestone.
- E2E windows stay on the second monitor (`launchApp` in `tests/e2e/pages.ts` already does this). Faded controls take no clicks: move the mouse first. Wait for the position to move before seeking.
- Edit with the Edit tool (files are CRLF on checkout). Commit messages end with the session's attribution lines.
- Commands: `npx vitest run <file>`, `npx playwright test <spec> -g "<name>"` (run `npm run build` first; `npm run test:e2e` builds for you), `npm run typecheck`.

## Review Focus

Each line has its test in the owning task.

- Esc held down in fullscreen with a panel open: the first press closes the panel, repeats do nothing, and it stays fullscreen (Task 1).
- Esc in fullscreen with a panel open but focus outside it (offset panel, Replace prompt): the panel closes, not fullscreen (Task 1). The window listener sees these presses because the panels only catch keys while focused.
- Double-click faster than mpv reports the pause: the film must end up playing, not paused (Task 2). A toggle read from `stateRef` alone would send pause twice.
- Volume slider dragged and released over the video: the browser fires `click` on the common ancestor, `.overlay`, and it must not pause (Task 2).
- Esc with the drawer open over search: only the drawer closes, and search and its query stay (Task 5).

---

### Task 1: Esc leaves fullscreen and never closes the player

**Files:**
- Modify: `src/renderer/overlay/Overlay.tsx:253-262,323` (key handler and its deps)
- Modify: `tests/e2e/pages.ts` (add helpers)
- Test: `tests/e2e/controls.spec.ts`; also `tests/e2e/title.spec.ts:97,111` and `closePlayer` at `controls.spec.ts:34-37`, which close the player with Esc

**Interfaces:**
- Produces, in `pages.ts`: `closeWithX(overlay: Page): Promise<void>` moves the mouse, then clicks `player-close`. `isFullScreen(app: ElectronApplication): Promise<boolean>` is true when any `BrowserWindow` reports `isFullScreen()`.

- [ ] **Step 1: Write the failing tests** in `controls.spec.ts`, each starting from `playTitle`:
  - `Esc in fullscreen leaves fullscreen and keeps playing`: press `f`, poll `isFullScreen` true, press Escape, poll false; `overlayVisible` true; `position` still increases.
  - `Esc when not fullscreen does nothing`: press Escape, wait 500 ms; `overlayVisible` true; `position` still increases; `isFullScreen` false.
  - `Esc with a menu open in fullscreen closes only the menu`: `f`, open the Subtitles menu, Escape; `track-menu` count 0; `isFullScreen` still true.
  - `Held Esc closes the panel and stays fullscreen`: `f`, open the menu, `keyboard.down('Escape')` three times, then `up`; `track-menu` count 0; `isFullScreen` true.
  - `Esc closes the offset panel when focus is outside it`: pick a subtitle, `f`, open "Set offset…", blur with `document.activeElement.blur()`, Escape; panel count 0; `isFullScreen` true.

  Existing Esc tests that close a menu or card keep their Esc. Change only `closePlayer` and the two `title.spec.ts` lines to `closeWithX`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build; npx playwright test controls -g "Esc"`
Expected: FAIL, because Esc closes the player.

- [ ] **Step 3: Implement.** The `Escape` branch of `onKey`, after `e.preventDefault()`, in this order: return if `e.repeat`; if `menu`, `setMenu(null)`; else if `offsetOpen`, `setOffsetOpen(false)`; else if `confirm`, `setConfirm(null)`; else if `stateRef.current?.fullScreen`, `send({ type: 'fullScreen', on: false })`. Add `offsetOpen` and `confirm` to the effect's deps and remove `close`. `close` stays for the ✕ button. `SyncCard` and `AutoSyncCard` already take Esc first in the capture phase.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm run build; npx playwright test controls title`
Expected: PASS.

- [ ] **Step 5: Commit** `fix: Esc leaves fullscreen and no longer closes the player`

### Task 2: Click to pause

**Files:**
- Modify: `src/renderer/overlay/Overlay.tsx` (`player.state` handler, Space key, root `div` handlers at lines 337-343)
- Test: `tests/e2e/controls.spec.ts`

**Interfaces:**
- Consumes: `isFullScreen` from Task 1.
- Produces: `togglePause()` inside `Overlay`, used by clicks and Space.

- [ ] **Step 1: Write the failing tests.** Click at the window's centre with `overlay.mouse.click(x, y)` (from `overlay.viewportSize()`). Read paused from the `play-pause` label (`Pause` while playing, `Play` while paused).
  - `Click pauses and click resumes`.
  - `Click on the dark strip above the controls pauses`: click 20 px above the `seek` bar's top.
  - `Double-click toggles fullscreen and keeps playing`: `overlay.mouse.dblclick(x, y)`; poll `isFullScreen` true; label polls to `Pause`; `position` increases. Repeat once more to confirm the race doesn't leave it paused.
  - `Click with a menu open only closes the menu`: `track-menu` count 0; label still `Pause`.
  - `Clicks on the controls don't also toggle`: click the `fullscreen` button; label still `Pause`.
  - `Releasing a volume drag over the video doesn't pause`: mouse down on the volume slider, move to the window's centre, up; label still `Pause`.
  - `Click does nothing while the next-episode card shows`: seek near the end of an episode (as in `title.spec.ts`), wait for `next-play`, click the centre; `next-play` still visible and the paused state is unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build; npx playwright test controls -g "lick|volume drag"`
Expected: FAIL on the pause assertions.

- [ ] **Step 3: Implement.**
  - Module-level `isVideoSurface(el: Element): boolean`: true when `el` matches `.overlay, .player-top, .player-bottom, .player-heading`, or `el.closest('.subs')` is non-null. Gaps between buttons in `.bar-row` don't count, so a near miss on a control doesn't pause.
  - `pausedIntent = useRef<{ value: boolean; sent: boolean | null }>`, reconciled in the `player.state` handler the way `volume` is at lines 79-80. `togglePause()` reads `value`, sets `{ value: next, sent: next }` and sends `{ type: 'pause', paused: next }`. Space uses it too.
  - `pressedVideo = useRef(false)`. In `onPointerDown`, read `menu` before closing it: `pressedVideo.current = !menu && isVideoSurface(e.target as Element)`.
  - `onClick`: `togglePause()` only when `state && !next && pressedVideo.current && isVideoSurface(e.target as Element)`.
  - `onDoubleClick`: use `isVideoSurface(e.target as Element)` in place of `e.target === e.currentTarget`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm run build; npx playwright test controls`
Expected: PASS.

- [ ] **Step 5: Commit** `feat: click the video to pause`

### Task 3: The line near the top

Use `systematic-debugging`. The cause is unconfirmed, so this task finds it first.

**Files:**
- Likely: `src/main/player/overlay.ts`
- Test: to be named once the cause is known (an E2E spec for bounds, or a unit test)

**Interfaces:** none.

- [ ] **Step 1: Reproduce and measure.** Add a throwaway E2E or `/run` session playing a fixture, windowed and then fullscreen, with the mouse moved so the controls show. Log `overlay.getBounds()`, `main.getContentBounds()`, `screen.getDisplayMatching(...).scaleFactor`, and the real mpv rectangle (`GetWindowRect` on the `mpv` child window from `launch.ts`). Capture the screen at each step, reading it back with the Read tool. Do this also on the user's primary display scale if the second monitor's differs, with the user's OK, as test windows otherwise stay off the primary. Compare with `C:\Users\varsh\Pictures\Screenshots\Screenshot 2026-11-02 221929.png`: a hard edge about 26 px down.

  Expected: a measured mismatch between the overlay and the video, or evidence that rules it out. If it doesn't reproduce here, stop and ask the user for the exact conditions (windowed or fullscreen, which monitor, its scale).

- [ ] **Step 2: Write the failing test that pins the cause.** For a bounds cause: `The overlay covers the video exactly, windowed and fullscreen`, polling overlay bounds against main content bounds after each transition. If it can't be automated, record the before and after screenshots instead and say so in the commit.

- [ ] **Step 3: Run it to verify it fails**, with the output showing the mismatch.

- [ ] **Step 4: Fix the cause**, not the gradient. Don't hide the line by removing or softening `.player-top`.

- [ ] **Step 5: Run it to verify it passes, then send the user the after screenshots, windowed and fullscreen.** The user confirms on their own display before the milestone is called done. Remove the throwaway code.

- [ ] **Step 6: Record the cause in the design doc, then commit** `fix: <the cause> left a line over the video`

### Task 4: "Ends at" on the title page

**Files:**
- Modify: `src/shared/time.ts`, `src/shared/library.ts:94`, `src/shared/api.ts:14-19`
- Modify: `src/main/library/queries.ts` (`getTitle`, `movieTitle`), `src/main/appInfo.ts`
- Create: `src/main/hour12.ts`
- Modify: `src/renderer/src/pages/Title.tsx`
- Test: `tests/unit/time.test.ts`, `tests/unit/queries.test.ts`, `tests/unit/appInfo.test.ts`, create `tests/unit/hour12.test.ts`, `tests/e2e/title.spec.ts`

**Interfaces:**
- Produces:
  - `TitleDetail.playS: number | null`: how long the main button would play.
  - `endsAt(playS: number, nowMs: number, hour12: boolean | null, locale?: string): string` in `shared/time.ts`.
  - `hour12FromPattern(pattern: string | null): boolean | null` and `systemHour12(): boolean | null` in `main/hour12.ts`.
  - `AppInfo.hour12: boolean | null`.

- [ ] **Step 1: Write the failing unit tests.**
  - `time.test.ts`, with `now = new Date(2026, 10, 4, 22, 0).getTime()`:
    - `endsAt(5400, now, true, 'en-US')` is `'Ends at 11:30 PM'`, with an ordinary space even where ICU uses U+202F.
    - `endsAt(5400, now, false, 'en-US')` is `'Ends at 23:30'`.
    - `endsAt(7500, now, false, 'en-US')` is `'Ends at 00:05'`, not `24:05`.
    - `endsAt(5400, now, null, 'en-GB')` is `'Ends at 23:30'`.
  - `hour12.test.ts`: `'h:mm tt'` → true; `'hh:mm tt'` → true; `'HH:mm'` → false; `'H:mm'` → false; `''` → null; `null` → null.
  - `queries.test.ts`, extending the existing title tests: unwatched movie, `playS` is the full duration; part-watched, `playS` equals `remainingS`; finished movie, full duration; unknown duration, null; show with next-up not started, the episode's full duration; next-up in progress, equals `remainingS`.
  - `appInfo.test.ts`: `hour12` is present and is boolean or null.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/time.test.ts tests/unit/hour12.test.ts tests/unit/queries.test.ts tests/unit/appInfo.test.ts`
Expected: FAIL (missing functions and field).

- [ ] **Step 3: Implement.**
  - `endsAt`: `Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', ...(hour12 === null ? {} : { hourCycle: hour12 ? 'h12' : 'h23' }) })`, with `\u202f` replaced by a space. Use `hourCycle`, not `hour12: false`, which can print `24:05`.
  - `queries.ts`: a `playLength(continuing, positionS, durationS)` helper, null when the duration is null or ≤ 0, else `continuing ? max(0, durationS - positionS) : durationS`. Use the same inputs as `remaining(...)` in both builders.
  - `systemHour12`: koffi `kernel32.dll` `GetLocaleInfoEx(null, 0x79 /* LOCALE_SSHORTTIME */, buf, n)` into a UTF-16 buffer, passed through `hour12FromPattern`; any failure returns null. A pattern containing `H` means 24-hour and one containing `h` means 12-hour, because Chromium's locale ignores a custom Windows time format.
  - `Title.tsx`: fetch `window.api.app.getInfo({})` for `hour12` when `titleKey` changes. Add a small `EndsAt({ playS, hour12 })` component with a 15 s `setInterval` of its own, so the page doesn't re-render. Render it inside `.title-actions` after the time-left span, as `<span className="title-left" data-testid="title-ends">`, only when `t.playS` is above 0. Fall back to `null` for `hour12` until the info arrives.

- [ ] **Step 4: Write the failing E2E tests** in `title.spec.ts`:
  - `A movie's page shows when it would end`: `title-ends` matches `/^Ends at \d/` on an unwatched movie. Install `page.clock` before opening the page and advance it 2 minutes: the text changes.
  - `A show's page shows the next-up episode's end`: `title-ends` is visible.
  - `getInfo reports the Windows time format`: `window.api.app.getInfo({})` returns a boolean `hour12` here, not null, so koffi really works.

- [ ] **Step 5: Run all of the above to verify they pass**

Run: `npx vitest run tests/unit/time.test.ts tests/unit/hour12.test.ts tests/unit/queries.test.ts tests/unit/appInfo.test.ts; npm run build; npx playwright test title`
Expected: PASS. The E2E tests fail first if run before Step 3's renderer part.

- [ ] **Step 6: Commit** `feat: the title page shows when it would end`

### Task 5: ☰ works from search

**Files:**
- Modify: `src/renderer/src/search/search.css:5`
- Test: `tests/e2e/search.spec.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing tests** in `search.spec.ts`, from open search with a typed query:
  - `The menu opens above search and Home goes home`: click the `Menu` button, then `getByRole('button', { name: 'Home' })` (Playwright fails the click if search covers it); the search overlay count is 0; `wall-home` is visible.
  - `The menu goes to Settings from search`: as above with Settings; `h1` reads Settings.
  - `Esc with the menu open closes only the menu`: open the menu, Escape; the drawer is closed; search is visible with its query.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build; npx playwright test search -g "menu"`
Expected: FAIL (the Home click is intercepted by search).

- [ ] **Step 3: Implement.** Set `.search-overlay` to `z-index: 5`, below the scrim (10), drawer (20) and menu button (30). Check in a screenshot that the wall's info card and the title page still sit correctly and the scrim dims search.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm run build; npx playwright test search nav`
Expected: PASS.

- [ ] **Step 5: Commit** `fix: the menu opens above search`

### Task 6: Finish the milestone

**Files:**
- Modify: `CLAUDE.md`, `docs/PROJECT_PLAN.md`, `docs/superpowers/specs/2026-11-04-milestone-9-polish-design.md`, `.claude/skills/mpv-ipc/SKILL.md`

**Interfaces:** none.

- [ ] **Step 1: Run everything**

Run: `npm run typecheck; npm test; npm run test:e2e`
Expected: all pass. Fix any other spec that relied on Esc closing the player.

- [ ] **Step 2: Fresh reviewer on the whole branch** (`requesting-code-review`), then `/code-review` and `/security-review`. Fix Critical and Important findings with a failing test first, and list minor ones as Deferred in the design doc.

- [ ] **Step 3: Update docs.** `CLAUDE.md`: add to the player E2E gotcha that Esc doesn't close the player, so tests use `closeWithX`. `mpv-ipc`: Esc, click and double-click behaviour. Design doc: "as built" notes. `PROJECT_PLAN.md`: ✅ for milestone 9. Keep `CLAUDE.md` short.

- [ ] **Step 4: Ask the user to confirm the line is gone on their display**, then commit `docs: mark milestone 9 done`, fast-forward merge into `main` and push (standing permission once finished, tested and working). Don't tag or publish.
