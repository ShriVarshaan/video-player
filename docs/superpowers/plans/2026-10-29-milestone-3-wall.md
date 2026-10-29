# Milestone 3 — Infinite wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder screen with the endless poster wall as Home, a Settings page holding the library tools, a Search stand-in, and a top-left menu drawer to switch between them.

**Architecture:**
- Main gets one new query and endpoint, `library.wall`, which returns ready-to-draw `WallItem`s in wall order.
- The renderer's wall is pure TypeScript modules (mapping, geometry, physics, camera) unit-tested in Node, driven by a thin React shell. The shell owns a recycled DOM pool and moves it with one `translate3d` per frame in a single rAF loop.
- Pages switch with plain state in `App`.

**Tech Stack:** Electron 45, React 19, TypeScript, electron-vite, `node:sqlite`, Vitest (node env), Playwright-Electron.

**Spec:** `docs/superpowers/specs/2026-10-29-milestone-3-wall-design.md`. Wall behaviour details are in `.claude/skills/infinite-wall/SKILL.md`; read both.

## Global Constraints

- Menu entries are text only, no icons: **Search**, **Home**, **Settings**. The app opens on Home.
- Info card fixed bottom-left over a gradient `transparent → rgba(0,0,0,.85)`; shown 400 ms after focus settles. Play is disabled with the hint "Playback arrives in a later update".
- Focused tile: scale 1.12, 2 px white outline, soft large shadow; neighbours opacity 0.85; 200 ms transitions.
- Spring stiffness 170, damping 26. Momentum `v *= 0.94^(dt/16.67)`, stop below 5 px/s, velocity tracked over the last 100 ms, drag threshold 6 px. Idle drift after 8 s at 10 px/s diagonally, off under `prefers-reduced-motion`. Hover focus after 80 ms rest, never during a glide. Arrow repeat about 6 → 12 tiles/s over about 1 s.
- Tile width `clamp(150px, 11vw, 260px)`, 2:3, gap 0.9 × width.
- No React re-render per frame; no layout reads in the rAF loop; `will-change: transform` on the container only; `contain: strict` on tiles; no `filter: blur()` on tiles.
- Backdrop crossfade 600 ms. No backdrop → the poster, blurred.
- The TMDB credit line "This product uses the TMDB API but is not endorsed or certified by TMDB." stays next to the key field.
- Endpoints follow `electron-skills`: add to `API` + `apiMethods`, register with `registerDomain`.
- Edit files with the Edit tool (CRLF checkout).

## Review Focus

1. **The library changes while you're on the wall** (a scan finishes, a title is added or removed). The wall refetches, keeps the camera, and keeps focus on the same `key` if it still exists, otherwise the nearest tile. Task 5 tests this through the `library.changed` path.
2. **n = 1 and n = 2.** The wall still fills the screen, and arrow keys don't throw or loop forever. Task 2 covers the mapping; Task 5's e2e runs a 1-title library.
3. **A poster that 404s or decodes late while tiles recycle fast.** No broken image, no blank flash, and no stale image landing in a recycled slot. Task 5: a slot load token is checked after `decode()`.
4. **Window resize mid-glide, and very wide screens.** The pool is rebuilt and the camera kept. Task 2 tests that pool size stays ≥ the visible cells at 3840×2160 and 1280×720.
5. **Keyboard focus leaving the wall** (drawer open, Settings page). The rAF loop stops, keys stop panning, and coming back restores the camera. Task 4/5 e2e: open the drawer, press ArrowRight, and the live region is unchanged.

---

### Task 1: `library.wall` query and endpoint

**Files:**
- Create: `src/shared/hash.ts`
- Modify: `src/main/library/scanner.ts` (`wallKey` uses `fnv1a32`), `src/shared/library.ts` (add `WallItem`), `src/main/library/queries.ts` (add `listWall`), `src/shared/api.ts`, `src/main/library/setup.ts`
- Test: `tests/unit/queries.test.ts`, `tests/unit/api.test.ts` (if it enumerates methods)

**Interfaces:**
- Produces: `fnv1a32(s: string): number` in `src/shared/hash.ts`. `WallItem` (exactly as in the spec's "Wall data" block) in `src/shared/library.ts`. `listWall(db: Db): WallItem[]` in `queries.ts`. `window.api.library.wall({}) → Promise<WallItem[]>`.

- [ ] **Step 1: Write failing tests** in `queries.test.ts`, reusing its fixture. Add to `beforeEach`:
  - genres (878 Science Fiction, 18 Drama) linked to 603 and to show 1396
  - `tmdb_movies` 603 gets `runtime_min 136, rating 8.2, overview 'Neo.', backdrop_path '/b.jpg'`
  - `playback_state` for video 2: position 600, duration 8160, last_played_at 10
  - `playback_state` for episode video 6: position 100, duration 3000, last_played_at 20

  `describe('listWall')` with these tests:
  - `it('returns movies and shows sorted by order')`: the keys equal the items sorted by `order` ascending. A movie's `order` is its `wall_key`; a show's is `fnv1a32(key)`. Give the videos distinct `wall_key`s.
  - `it('fills movie fields')`: item `movie:2` has
    - `title` 'The Matrix', `year` 1999, `runtimeMin` 136, `rating` 8.2
    - `genres` ['Drama','Science Fiction'] (sorted by name), `overview` 'Neo.'
    - `posterUrl` 'poster://poster/video/2?v=t603', `backdropUrl` 'poster://backdrop/video/2?v=t603'
    - `progress` ≈ 600/8160, `playLabel` 'Continue watching'
    - `seasonCount` null, `episodeCount` null
  - `it('falls back for unmatched movies')`: `movie:3` has
    - `backdropUrl` null, `rating` null, `genres` []
    - `runtimeMin` = round(duration_s/60) when `duration_s` is set, else null
    - `progress` null, `playLabel` 'Play'
  - `it('treats a finished movie as not in progress')`: position ≥ 95 % of duration → `progress` null, `playLabel` 'Play'.
  - `it('fills show fields')`: `tmdb:1396` has
    - `kind` 'show', `seasonCount` 2, `episodeCount` 3
    - `backdropUrl` 'poster://backdrop/show/1396?v=t1396'
    - `playLabel` 'Continue watching' (episode 6 is partway), `progress` null
  - `it('labels a show with nothing started Play episode')`: `local:my show` has `playLabel` 'Play episode' and `backdropUrl` null.
  - `it('excludes missing files and keeps one item per film')`: no `movie:4`, and `movie:1` is absent because `movie:2` is the larger file.

  Also: `it('fnv1a32 matches wallKey')` in the same file, via `wallKey('abc') === fnv1a32('abc')`.

- [ ] **Step 2: Run** `npx vitest run tests/unit/queries.test.ts`. Expected: FAIL (`listWall` is not exported).
- [ ] **Step 3: Implement.**
  - Move the FNV body from `wallKey` into `fnv1a32`; `wallKey` calls it.
  - `listWall` reuses `largestPer`, `episodeRows`, `showKey`, `artVersion`, `isFinished` and `nextUp`.
  - Genres come from one query per kind, grouped in JS.
  - Rating is rounded to one decimal.
  - Add `wall` to `API.library` and `apiMethods`, and register `wall: async () => listWall(db)`.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** with `feat: library.wall endpoint with ordered wall items`.

### Task 2: Wall mapping and geometry (pure)

**Files:**
- Create: `src/renderer/src/wall/mapping.ts`, `src/renderer/src/wall/geometry.ts`
- Test: `tests/unit/wallMapping.test.ts`, `tests/unit/wallGeometry.test.ts`

**Interfaces:**
- Produces:
  - `mod(a: number, n: number): number`
  - `chooseStride(n: number): number`
  - `itemIndex(col: number, row: number, n: number, stride: number): number`
  - `tileSize(viewportW: number): { w: number; h: number; pitchX: number; pitchY: number }` (w = clamp(150, 0.11·vw, 260), h = 1.5w, gap = 0.9w)
  - `visibleRange(cam: {x:number;y:number}, vw: number, vh: number, t: TileSize): { c0: number; c1: number; r0: number; r1: number }`, with a one-tile buffer
  - `poolDims(vw: number, vh: number, t: TileSize): { cols: number; rows: number }` = visible counts + 2
  - `assignSlots(prev: Map<number,string>, range, cols: number, rows: number): { assign: Map<number, {col:number;row:number}>; changed: number[] }`, where slot ids are stable, and a cell that stays visible keeps its slot (only slots whose cell changed are listed in `changed`)

- [ ] **Step 1: Write failing tests.**
  - `mod(-1, 5) === 4`, `mod(-10, 5) === 0`, `mod(7, 5) === 2`.
  - `chooseStride`: for n in 1..60, compute S and check over a 12×12 window that `itemIndex` differs for horizontal neighbours when n > 1. For n ≥ 4, also check vertical (r, r+1) and both diagonals, but only when some S in [1, n) satisfies `S mod n ∉ {0,1,n−1}`.
  - `chooseStride(1..3) === 1`.
  - For n ≥ 5, `gcd(S, n) === 1` whenever a valid coprime S exists.
  - `tileSize(1000).w === 150`, `tileSize(2000).w === 220`, `tileSize(4000).w === 260`.
  - `visibleRange` with negative camera coords gives `c0 = floor((x − pitchX)/pitchX)`.
  - `poolDims` at 3840×2160 and 1280×720 covers `visibleRange` cell counts.
  - `assignSlots`: moving the camera one pitch right lists exactly `rows` slots in `changed`, and every visible cell has exactly one slot.
- [ ] **Step 2: Run** `npx vitest run tests/unit/wall*`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** Stride rule from the skill: among S in [2, n−2], prefer gcd 1, closest to 0.382·n; if none, relax the gcd rule; n ≤ 3 → 1.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: wall tile mapping and geometry`.

### Task 3: Wall physics and camera (pure)

**Files:**
- Create: `src/renderer/src/wall/physics.ts`, `src/renderer/src/wall/camera.ts`
- Test: `tests/unit/wallCamera.test.ts`

**Interfaces:**
- Produces:
  - `springStep(pos: number, vel: number, target: number, dt: number): { pos: number; vel: number }` (k=170, c=26, dt in ms, semi-implicit Euler substepped at ≤ 8 ms)
  - `decay(v: number, dt: number): number`
  - `class VelocityTracker { add(x: number, y: number, t: number): void; velocity(now: number): {x:number;y:number} }` (px/s over the last 100 ms)
  - `class Camera`, with:
    - `x`, `y`
    - `mode: 'idle'|'spring'|'glide'|'drag'|'drift'`
    - `springTo(x, y)`
    - `dragBy(dx, dy)`
    - `release(vx, vy)`
    - `panBy(dx, dy)` (wheel)
    - `input(now: number)` (resets idle)
    - `step(dt: number, now: number, reducedMotion: boolean): boolean` (true while moving)
  - Drift starts when `now − lastInput ≥ 8000` and `!reducedMotion`, at (10, 10)/√2 px/s.

- [ ] **Step 1: Write failing tests.**
  - The spring from 0 to 100 settles within 1 px by 1 s and never exceeds 100.5.
  - `glide`: release at 1000 px/s, then step at dt 1000/30, 1000/60 and 1000/144 until stopped. Total distance agrees within 1 %, and mode ends `idle` once speed < 5.
  - `VelocityTracker` ignores samples older than 100 ms.
  - Drift: no move before 8000 ms idle; moving after; `input()` stops it immediately; never with `reducedMotion`.
  - `dragBy` sets mode `drag` and moves exactly by the delta.
- [ ] **Step 2: Run** `npx vitest run tests/unit/wallCamera.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: wall camera, spring, momentum and drift`.

### Task 4: App shell — menu drawer, Settings and Search pages

**Files:**
- Create: `src/renderer/src/nav/Menu.tsx`, `src/renderer/src/pages/Settings.tsx`, `src/renderer/src/pages/SearchSoon.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/app.css`
- Delete: `src/renderer/src/Library.tsx`, `src/renderer/src/ShowView.tsx`
- Test: `tests/e2e/library.spec.ts` (rewrite), `tests/e2e/smoke.spec.ts` (update selectors if needed), new `tests/e2e/nav.spec.ts`

**Interfaces:**
- Produces:
  - `type Page = 'home' | 'search' | 'settings'`, exported from `App.tsx`
  - `<Menu page={Page} onNavigate={(p: Page) => void} />`
  - `<Settings />`: today's folder, key and progress UI plus the version/binary lines from today's `App`, keeping its `data-testid`s, labels and button names
  - Home renders a placeholder `<div data-testid="wall-home" />` until Task 5

- [ ] **Step 1: Write failing e2e** `nav.spec.ts` (same launch helper as `library.spec.ts`):
  - On launch, `getByTestId('wall-home')` is visible.
  - `getByRole('button', { name: 'Menu' })` has `aria-expanded="false"`. Click it, and the navigation drawer shows the buttons Search, Home and Settings, with Home carrying `aria-current="page"`.
  - Press Escape: the drawer is hidden and focus is back on the Menu button.
  - Open the drawer and click Settings: the heading 'Settings' is visible, and so is the TMDB credit text.
  - Open the drawer and click Search: the heading 'Search' is visible.
  - Open the drawer, press ArrowDown then Enter: navigates to the entry after the current one.

  Rewrite `library.spec.ts` `addLibrary()` to open the menu, then Settings, then the existing key and folder steps. Its movie/show-list assertions move to Task 5 (mark them `test.fixme` here, with a comment pointing to Task 5).
- [ ] **Step 2: Run** `npm run test:e2e -- nav.spec.ts`. Expected: FAIL (no Menu button).
- [ ] **Step 3: Implement** per the spec's "Pages and navigation":
  - the drawer is about 240 px with a frosted panel; a 220 ms transform/opacity slide; the scrim click closes it
  - `role="navigation"` with `aria-label="Main"`
  - with reduced motion there is no slide
  - delete `Library.tsx` and `ShowView.tsx`, and their CSS

  Use `frontend-design` + `apple-design` for the drawer look.
- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run test:e2e`. Expected: all pass (fixme tests skipped).
- [ ] **Step 5: Commit** with `feat: menu drawer, Settings and Search pages`.

### Task 5: The wall on Home

**Files:**
- Create: `src/renderer/src/wall/Wall.tsx`, `src/renderer/src/wall/InfoCard.tsx`, `src/renderer/src/wall/Backdrop.tsx`, `src/renderer/src/wall/wall.css`
- Modify: `src/renderer/src/App.tsx` (Home renders `<Wall active={page==='home' && !menuOpen} onSearch={() => go('search')} onSettings={() => go('settings')} />`; `Wall` stays mounted while hidden so it keeps its camera)
- Test: new `tests/e2e/wall.spec.ts`; finish the `fixme` tests in `library.spec.ts`

**Interfaces:**
- Consumes: `window.api.library.wall` and `WallItem` (Task 1), the mapping/geometry functions (Task 2), `Camera`, `VelocityTracker` (Task 3), `Page` (Task 4).
- Produces: DOM contract for tests:
  - the container is `role="application"` with `aria-label="Poster wall"`, `data-testid="wall"`
  - tiles are `data-testid="wall-tile"` with `data-key`
  - the focused tile has `data-focused="true"`
  - the live region is `data-testid="wall-live"`, `aria-live="polite"`, text `"<title>, <year>"`
  - the card is `data-testid="info-card"`
  - the empty state has the button "Choose a folder"

- [ ] **Step 1: Write failing e2e** `wall.spec.ts` (fixture library, `VP_TMDB_MODE=fixtures`, added via Settings as in `library.spec.ts`, then Home):
  - `it fills the screen`: `wall-tile` count > 5 (5 titles: 4 movies, 1 show), and each fixture title's `data-key` appears.
  - `arrow keys move focus`: focus the wall, record the `wall-live` text, press ArrowRight ×5, and the text changed at least once. `info-card` contains the focused title within 1 s.
  - `drag pans`: a `mouse.down/move(300px)/up` on the wall changes the first tile's bounding box x.
  - `menu pauses the wall`: open the menu, press ArrowRight, and `wall-live` is unchanged.
  - `Enter opens the card and Play is disabled`: `getByRole('button', { name: /^Play/ })` is disabled, and the card shows "Playback arrives in a later update".
  - `typing goes to search`: press `k`, and the 'Search' heading is visible.
  - `empty library`: fresh userData; the "Choose a folder" button leads to the Settings heading.
  - `one title fills the wall`: library = a temp dir containing one copy of a fixture clip; tile count > 1.
  - `library change keeps focus`: focus a tile, trigger Rescan from Settings, return Home, and the same `data-key` is focused.

  Finish `library.spec.ts`:
  - movies and the show appear as wall tiles with `poster://` images
  - removing the folder empties the wall into the "Choose a folder" state
- [ ] **Step 2: Run** `npm run test:e2e -- wall.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `Wall.tsx`** per the skill and the spec's "Wall modules":
  - **Pool and loop:** the pool is built from `poolDims` on mount and on `ResizeObserver`. The rAF loop runs only while `active` and the camera is moving or input is pending; otherwise it sleeps until the next input.
  - **Slots:** each frame sets the container transform; `assignSlots` runs on pitch crossings.
  - **Image swaps:** a slot swap loads the new image off-screen, then `await img.decode()`. Each slot carries a load token, so a late decode never lands in a recycled slot. `onerror` switches to the generated tile (gradient from `fnv1a32(key)` + title).
  - **Focus:**
    - focus state `(col,row)` is in a ref; React state holds only the focused `key`, for the card and live region
    - arrow repeat with acceleration
    - the camera springs when focus leaves the inner 60 %
    - hover focus after 80 ms rest, not while gliding
  - **Pointer:** pointer capture, the 6 px threshold, then `VelocityTracker` → `release`.
  - **Wheel:** passive; Shift swaps the axes.
  - **Keys:**
    - Enter/Space/click focus the tile and show the card immediately
    - `/`, Ctrl+F and single printable letters call `onSearch`
  - **Card and backdrop:** the card is shown 400 ms after focus settles; `Backdrop` crossfades 600 ms to `backdropUrl ?? posterUrl`.
  - **Data refresh:**
    - refetch on `library.changed`, keeping the camera
    - re-find focus by `key`, else keep the cell
    - recompute the stride when n changes
  - **Progress line** when `progress !== null`.
  - **Empty state** when n = 0.
- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run test:e2e`. Expected: all pass.
- [ ] **Step 5: Manual performance check:**
  - `/run` the app with the fixture library and take screenshots.
  - In the DevTools Performance panel, while dragging and gliding: no task over 8 ms and no Layout events per frame.
  - Fix anything that fails before committing.
- [ ] **Step 6: Commit** with `feat: infinite poster wall on Home`.

### Task 6: Design pass and docs

**Files:**
- Modify: `src/renderer/src/app.css`, `src/renderer/src/wall/wall.css`, `.claude/skills/infinite-wall/SKILL.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md`

- [ ] **Step 1: Audit the look.** Run `design-taste-frontend` (app-screen rules), `impeccable` and `web-design-guidelines` against screenshots of Home (focused, card shown), the drawer open, Settings and Search. Apply the fixes and re-run `npm run test:e2e`. Expected: pass.
- [ ] **Step 2: Update `infinite-wall`:**
  - Enter/click/Space open the card until milestone 4
  - typing goes to the Search page
  - the `library.wall`/`WallItem` contract
  - the bottom-left card
  - the wall pauses under the drawer
  - any tuned delays

  Update `PROJECT_PLAN.md` Architecture with the navigation drawer and Settings page. Update the `CLAUDE.md` codebase map for `src/renderer/src/` (pages, nav, wall).
- [ ] **Step 3: Commit** with `docs: wall milestone in plan, skill and CLAUDE.md`.

After Task 6, follow CLAUDE.md's end-of-milestone flow:
1. a fresh reviewer on the whole branch
2. fix Critical and Important findings, test first
3. full verification
4. Status ✅ in the plan
5. fast-forward merge into `main` and push
