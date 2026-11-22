# Picture in Picture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PiP button (left of Audio) and **P** turn the playing window into a small, always-on-top, draggable, resizable 16:9 floating player, and back again, without interrupting playback.

**Architecture:** The main window itself becomes the floating player (approach A). A main-side `PipWindow` controller saves the window's normal state, removes the Win32 caption/border (koffi, like `launch.ts`), sets it always on top and sizes it from pure geometry in `pip.ts`. The overlay follows the window bounds as it does today. `PlayerService` gets `pip`/`pipGesture` commands and a `pip` flag in `PlayerState`. The overlay renders compact `PipControls` while `state.pip` is on and turns pointer drags into gestures that main applies.

**Tech Stack:** Electron 45 main (BrowserWindow, screen, koffi/user32), React 19 overlay, Vitest, Playwright-Electron.

**Spec:** `docs/superpowers/specs/2026-11-22-picture-in-picture-design.md`

**Branch:** `feature-pip` (off `main`).

## Global Constraints

- The default floating window is 480×270 in the bottom-right corner of the **work area of the display the window is on**, 24 px from the right and bottom edges.
- 16:9 is always locked while floating. Minimum width is 320 px (180 tall). Maximum width is the work area's width.
- No restart, no second mpv, no `loadfile` when entering or leaving PiP.
- Leaving PiP restores the exact earlier normal bounds, maximized state and full-screen state.
- The floating spot and size are stored under the settings key `player.pipBounds` (JSON `{x,y,width,height}`). They are used next time only if the rect lies wholly inside some display's work area. Otherwise the default corner is used.
- In PiP, the Audio and Subtitles menus, style, search, offset, sync (S) and auto sync (A) are not available.
- Use the `Icon` SVG style and `button.icon` class of the existing control bar. Never use a native `<select>`.
- Edit with the Edit tool (CRLF repo).

## Review Focus

1. **Entering from a maximized window.** Leaving PiP must give back a *maximized* window, not a 1280×800 one at the maximized bounds. Pinned in Task 2 (`restores maximized`).
2. **A remembered spot on a monitor that's been unplugged.** It must fall back to the default corner, not open off-screen. Pinned in Task 1 (`pipBounds falls back…`).
3. **A second display with a different DPI scale.** The overlay and mpv's picture must line up exactly in PiP. Pinned in Task 4's E2E (`overlayAndVideoRects` equal while floating).
4. **The next episode starting while floating.** `play()` must not reset PiP: the window stays floating. Pinned in Task 3 (`a new play keeps PiP`).
5. **Pressing P twice quickly, or P while leaving full screen.** The window must end up in a consistent state and never be half-frameless. Pinned in Task 2 (`overlapping enter/exit are serialised`).

---

### Task 1: PiP geometry (pure)

**Files:**
- Create: `src/main/player/pip.ts`
- Test: `tests/unit/pip.test.ts`

**Interfaces:**
- Produces:
  - `type Rect = { x: number; y: number; width: number; height: number }`
  - `type PipEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'` (defined in `src/shared/player.ts`, imported here; see Task 3. Add the type to `shared/player.ts` in this task.)
  - `PIP_SIZE = { width: 480, height: 270 }`, `PIP_MARGIN = 24`, `PIP_MIN_WIDTH = 320`
  - `defaultPipBounds(workArea: Rect): Rect`
  - `pipBounds(saved: Rect | null, workAreas: Rect[], current: Rect): Rect`, where `current` is the work area to use for the default
  - `movePip(start: Rect, dx: number, dy: number, workArea: Rect): Rect`, clamped wholly inside `workArea`
  - `resizePip(start: Rect, edge: PipEdge, dx: number, dy: number, workArea: Rect): Rect`

- [ ] **Step 1: Write the failing tests** (`describe('pip geometry')`)

```ts
const WA = { x: 0, y: 0, width: 1920, height: 1040 }
const START = { x: 1416, y: 746, width: 480, height: 270 }
it('defaultPipBounds sits bottom right, 24 px in', () => {
  expect(defaultPipBounds(WA)).toEqual(START)
  expect(defaultPipBounds({ x: 1920, y: 0, width: 2560, height: 1400 })).toEqual({ x: 3976, y: 1106, width: 480, height: 270 })
})
it('pipBounds keeps a saved spot that is wholly on a display', () => {
  const saved = { x: 100, y: 100, width: 640, height: 360 }
  expect(pipBounds(saved, [WA], WA)).toEqual(saved)
})
it('pipBounds falls back to the default corner when the saved spot is off every display or missing', () => {
  expect(pipBounds({ x: 2000, y: 100, width: 480, height: 270 }, [WA], WA)).toEqual(START)
  expect(pipBounds({ x: 1700, y: 100, width: 480, height: 270 }, [WA], WA)).toEqual(START) // half off
  expect(pipBounds(null, [WA], WA)).toEqual(START)
})
it('movePip moves and clamps inside the work area', () => {
  expect(movePip(START, -100, -50, WA)).toEqual({ ...START, x: 1316, y: 696 })
  expect(movePip(START, 200, 100, WA)).toEqual({ ...START, x: 1440, y: 770 })
  expect(movePip(START, -5000, -5000, WA)).toEqual({ ...START, x: 0, y: 0 })
})
it('resizePip keeps 16:9 and anchors the opposite side', () => {
  expect(resizePip(START, 'se', 160, 0, WA)).toEqual({ x: 1416, y: 746, width: 640, height: 360 })
  expect(resizePip(START, 'nw', -160, 0, WA)).toEqual({ x: 1256, y: 656, width: 640, height: 360 })
  expect(resizePip(START, 'w', -100, 0, WA)).toEqual({ x: 1316, y: 746, width: 580, height: 326 })
  expect(resizePip(START, 'n', 0, -90, WA)).toEqual({ x: 1416, y: 656, width: 640, height: 360 })
  expect(resizePip(START, 'se', 0, 90, WA)).toEqual({ x: 1416, y: 746, width: 640, height: 360 })
})
it('resizePip stays between 320 wide and the work area width', () => {
  expect(resizePip(START, 'se', -400, 0, WA)).toEqual({ x: 1416, y: 746, width: 320, height: 180 })
  expect(resizePip(START, 'e', 9000, 0, WA).width).toBe(1920)
})
```

- [ ] **Step 2: Run to verify it fails.** Run `npx vitest run tests/unit/pip.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/main/player/pip.ts`.**
  - "Wholly on a display" means the rect lies inside at least one work area.
  - Resize rule. Let `sx` = +1 for edges containing `e`, −1 for `w`, 0 otherwise. Let `sy` = +1 for `s`, −1 for `n`, 0 otherwise. The width candidates are `start.width + sx*dx` (when `sx≠0`) and `(start.height + sy*dy) * 16/9` (when `sy≠0`). Take the candidate present whose change from `start.width` is larger in magnitude (corners: the axis that moved more), clamp it to `[320, workArea.width]`, and set `height = Math.round(width * 9 / 16)`.
  - Anchors. `w` edges keep the right side, `n` edges keep the bottom. Pure `e`/`w` keep the top, and pure `n`/`s` keep the left.

- [ ] **Step 4: Run to verify it passes.** Run `npx vitest run tests/unit/pip.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(pip): floating window geometry"`

---

### Task 2: PipWindow controller + frameless toggle + overlay follow

**Files:**
- Create: `src/main/player/pipWindow.ts`, `src/main/player/win32Frame.ts`
- Modify: `src/main/player/overlay.ts` (add `setPip`)
- Test: `tests/unit/pipWindow.test.ts`

**Interfaces:**
- Consumes: Task 1's `Rect`, `pipBounds`, `movePip`, `resizePip`; `PipGesture` (add it to `src/shared/player.ts` here): `{ phase: 'start' | 'move' | 'end'; edge: PipEdge | 'move'; dx: number; dy: number }`. `dx`/`dy` are cumulative screen DIPs since the gesture's start.
- Produces:
  - `type PipWindow = { isOn(): boolean; enter(): Promise<void>; exit(): Promise<void>; gesture(g: PipGesture): void }`
  - `createPipWindow(deps: PipDeps): PipWindow` with
    ```ts
    type PipDeps = {
      win: {
        getBounds(): Rect; setBounds(r: Rect): void
        isMaximized(): boolean; maximize(): void; unmaximize(): void
        isFullScreen(): boolean; setFullScreen(on: boolean): void
        // resolves once full screen has been left (or after 1 s)
        leftFullScreen(): Promise<void>
        setAlwaysOnTop(on: boolean): void
      }
      frame: { remove(): void; restore(): void }
      overlay: { setPip(on: boolean): void }
      workAreas(): Rect[]
      workAreaFor(r: Rect): Rect
      load(): Promise<Rect | null>
      save(r: Rect): void
    }
    ```
  - `createFrameToggle(hwnd: bigint): { remove(): void; restore(): void }` in `win32Frame.ts`. It uses koffi `GetWindowLongPtrW`/`SetWindowLongPtrW` (`GWL_STYLE = -16`). `remove` saves the style and clears `WS_CAPTION 0x00C00000 | WS_THICKFRAME 0x00040000 | WS_MINIMIZEBOX 0x00020000 | WS_MAXIMIZEBOX 0x00010000`. `restore` puts the saved value back. Both follow up with `SetWindowPos(h, 0, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE|SWP_FRAMECHANGED 0x0020)`. Reuse the koffi loading pattern in `launch.ts`'s `loadUser32` by moving it to `win32Frame.ts`, or exporting it from `launch.ts`. Keep one `koffi.load('user32.dll')`.
  - `createOverlay(...)` returns an extra `setPip(on: boolean): void`. While on, `follow()` uses `main.getBounds()` (a frameless window's client area is its whole rect) instead of `getContentBounds()`, and the overlay is `setAlwaysOnTop(on, 'floating')`. Call `follow()` straight away.

- [ ] **Step 1: Write the failing tests** with a fake `win` that records calls in order (`calls: string[]`) and tracks bounds/maximized/fullScreen.
  - `enter from a normal window`: `frame.remove` runs before `setBounds(default)`, the window is set always on top, `overlay.setPip(true)` is called, and `isOn()` is true.
  - `restores maximized`: maximized → `enter` calls `unmaximize` before reading bounds. `exit` calls `frame.restore`, then `setBounds(saved normal)`, then `maximize`.
  - `leaves full screen first`: `setFullScreen(false)` is called and `setBounds` doesn't run until `leftFullScreen()` resolves. `exit` ends with `setFullScreen(true)`.
  - `uses the remembered spot`: `load()` → `{x:100,y:100,width:640,height:360}` inside the work area → `setBounds` with it.
  - `gestures`: `start` then `move` with `edge:'move', dx:-100, dy:-50` → `setBounds(movePip(start,…))`. `edge:'se', dx:160` → `resizePip`. `end` → `save(getBounds())`. A `move` without a `start` is ignored.
  - `exit` → `setAlwaysOnTop(false)`, `overlay.setPip(false)`, `save(pip bounds)`, `isOn()` false. `exit` when off does nothing.
  - `overlapping enter/exit are serialised`: `enter(); enter(); exit()` without awaiting in between, while `leftFullScreen` is pending → after all settle, the window is off, `frame.remove` and `frame.restore` were each called once, and normal bounds are restored. Run the calls through one promise chain. An `enter` while already on, or an `exit` while off, is a no-op.

- [ ] **Step 2: Run to verify it fails.** Run `npx vitest run tests/unit/pipWindow.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `createPipWindow`, `createFrameToggle` and `overlay.setPip`.** Enter order: leave full screen and await it → unmaximize → save `{bounds, maximized, fullScreen}` → `frame.remove` → always on top → `setBounds(pipBounds(await load(), workAreas(), workAreaFor(bounds)))` → `overlay.setPip(true)`. Exit runs the reverse.

- [ ] **Step 4: Run to verify it passes.** Run `npx vitest run tests/unit/pipWindow.test.ts`. Expected: PASS. Then `npm run typecheck`, expected clean.

- [ ] **Step 5: Commit.** `git commit -m "feat(pip): window controller and frameless toggle"`

---

### Task 3: Player service commands and state

**Files:**
- Modify: `src/shared/player.ts`, `src/main/player/service.ts`, `src/main/player/setup.ts`
- Test: `tests/unit/playerService.test.ts`

**Interfaces:**
- Consumes: Task 2's `PipWindow`, `createPipWindow`, `createFrameToggle`, `overlay.setPip`.
- Produces:
  - `PlayerState.pip: boolean`
  - `PlayerCommand` gains `{ type: 'pip'; on: boolean }` and `({ type: 'pipGesture' } & PipGesture)`
  - `createPlayerService` deps gain `pip: Pick<PipWindow, 'isOn' | 'enter' | 'exit' | 'gesture'>`

- [ ] **Step 1: Write the failing tests.** Add a fake `pip` to the existing service setup (`isOn` backed by a flag; `enter`/`exit` flip it; `gesture` is a `vi.fn`).
  - `pip on/off`: `command({type:'pip', on:true})` → `enter` is called and the next emitted `player.state` has `pip: true`. `on:false` → `exit` is called and `pip: false`.
  - `gestures pass through`: `command({type:'pipGesture', phase:'move', edge:'move', dx:5, dy:6})` → `gesture` is called with `{phase:'move', edge:'move', dx:5, dy:6}`.
  - `full screen while floating leaves PiP first`: pip on, `command({type:'fullScreen', on:true})` → `exit` is called before `window.setFullScreen(true)`.
  - `stop leaves PiP`: pip on, `stop()` → `exit` is called before `overlay.hide`, and `player.closed` is emitted.
  - `a new play keeps PiP`: pip on, `play` another episode → `exit` is not called and the state still has `pip: true`.

- [ ] **Step 2: Run to verify it fails.** Run `npx vitest run tests/unit/playerService.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** In `service.ts`, `state()` adds `pip: deps.pip.isOn()`. The `command` switch gets the `pip` and `pipGesture` cases. `fullScreen` with `c.on && pip.isOn()` awaits `exit()` first. `stop()` awaits `deps.pip.exit()` (if on) before the full-screen check. In `setup.ts`, build `createPipWindow` from `main`, `createFrameToggle(hwnd)`, `overlay`, `screen.getAllDisplays().map(d => d.workArea)`, `screen.getDisplayMatching(r).workArea`, `leftFullScreen` = `once('leave-full-screen')` raced against 1 s, and the `settings` table key `player.pipBounds` through `createSettings(db)`. Pass it to the service.

- [ ] **Step 4: Run to verify it passes.** Run `npx vitest run tests/unit/playerService.test.ts` and `npm run typecheck`. Expected: PASS and clean.

- [ ] **Step 5: Commit.** `git commit -m "feat(pip): player commands and state"`

---

### Task 4: Overlay UI: button, compact controls, keys, drag/resize, E2E

**Files:**
- Create: `src/renderer/overlay/icons.tsx` (move `Icon` and `ICONS` out of `ControlBar.tsx`, and add `pip` and `pipExit`), `src/renderer/overlay/SeekBar.tsx` (the seek slider pulled out of `ControlBar`, same testid `seek`, same behaviour), `src/renderer/overlay/PipControls.tsx`, `src/renderer/overlay/usePipGestures.ts`
- Modify: `src/renderer/overlay/ControlBar.tsx`, `src/renderer/overlay/Overlay.tsx`, `src/renderer/overlay/overlay.css`
- Test: `tests/e2e/pip.spec.ts`; add `pipBounds(app)` and `isAlwaysOnTop(app)` helpers to `tests/e2e/pages.ts` (main window picked by URL, never `getAllWindows()[0]`)

**Interfaces:**
- Consumes: Task 3's `state.pip` and the `pip`/`pipGesture` commands.
- Produces (testids): `pip-button` (bar, left of the Audio `menu-anchor`, `aria-label="Picture in picture"`, `title="Picture in picture (P)"`), `pip-exit` (`aria-label="Back to full size"`), and `pip-edge` elements with `data-edge="n|s|e|w|ne|nw|se|sw"`. PiP reuses `player-close`, `play-pause`, `seek` and `player-time`, so `closeWithX` and `position()` keep working.

Behaviour in the overlay. Each rule is decided here; the implementer only writes it:
- While `state.pip`, render `<PipControls>` in place of `.player-top` + `<ControlBar>`. The top row has ✕ on the left and `pip-exit` on the right. The middle has back 10 / play-pause / forward 10. The bottom has a compact `player-time` and the `SeekBar`. There are 8 px `pip-edge` zones with matching resize cursors. It fades on the same idle rule.
- When `state.pip` turns on: `setMenu(null)`, `setSyncing(false)`, `setOffsetOpen(false)`, `setConfirm(null)`.
- Keys:
  - `p`/`P` (not repeat, no Ctrl/Alt/Meta) toggles `{type:'pip', on: !s.pip}`.
  - Esc in PiP (after the menu/panel steps) sends `pip:false`.
  - `S` and `A` do nothing in PiP.
  - `F` sends `fullScreen` as usual (main leaves PiP first).
- Double-click on the video surface in PiP sends `pip:false`, not the full-screen toggle.
- Drag. A press on the video surface in PiP is captured. Once the pointer has moved more than 4 px from the press, it becomes a `move` gesture: `start` (dx 0), then `move` with cumulative `e.screenX/Y` deltas, then `end` on release. A press that became a drag is not a click, so it doesn't pause. Edge zones do the same with their edge and no threshold. Put the logic in `usePipGestures(enabled: boolean)`, which returns the pointer handlers.
- In PiP, `.next-card` drops its still and fits within 480×270 (CSS under `.overlay[data-pip='true']`).

- [ ] **Step 1: Write the failing E2E tests** in `tests/e2e/pip.spec.ts`. Use the `playMatrix()` pattern from `aspect.spec.ts`, and move the mouse before every click.
  - `the PiP button sits left of Audio`: `pip-button`'s box is left of `audio-button`'s box, and their vertical centres are within 4 px.
  - `PiP floats the playing window and P brings it back`: record the main bounds. Click `pip-button` → `pipBounds(app)` polls to width 480 / height 270, inside its display's work area, 24 px from the right and bottom. `isAlwaysOnTop` is true. `overlayAndVideoRects(app)` overlay === video. `position()` keeps rising (+1 s). Press `p` → bounds equal the recorded ones and `isAlwaysOnTop` is false.
  - `full screen → PiP → double-click returns to full screen`: `f` → `isFullScreen`. Click `pip-button` → not full screen and 480 wide. Double-click the picture centre → `isFullScreen` true.
  - `dragging moves it and the spot is remembered`: in PiP, mouse down at the centre, move by (−100, −50) in steps, then up → x/y decreased by 100/50, and the window is not paused. `p`, then `p` again → same spot.
  - `the corner resizes at 16:9`: drag `pip-edge[data-edge="nw"]` by (−160, −90) → 640×360.
  - `✕ in PiP stops and shows the title page at full size`: `closeWithX(overlay)` → `title-page` is visible in the main window, bounds are back to the recorded ones, and `overlayVisible` is false.

- [ ] **Step 2: Run to verify it fails.** Run `npm run test:e2e -- tests/e2e/pip.spec.ts`. Expected: FAIL (no `pip-button`).

- [ ] **Step 3: Implement the files listed above.** `ControlBar` imports `Icon`/`ICONS`/`SeekBar` from the new files, with no behaviour change. Icons:
  - `pip`: `M3 5h18v14H3V5Zm2 2v10h14V7H5Zm6 4h7v5h-7v-5Z`
  - `pipExit`: `M5 5h6v2H7v10h10v-4h2v6H5V5Zm9 0h5v5h-2V8.4l-5.3 5.3-1.4-1.4L15.6 7H14V5Z`

- [ ] **Step 4: Run to verify it passes.** Run `npm run test:e2e -- tests/e2e/pip.spec.ts`, then the existing `controls`, `player`, `aspect` and `subtitles` specs to catch regressions from the `ControlBar` split. Expected: all PASS.

- [ ] **Step 5: Look at it.** Use `/run`, play The Matrix, press P, and screenshot the floating window with subtitles on. The subtitles (18 px minimum from `subtitleLayout`) must read clearly and not overlap the controls. Check the drag and the corner resize by hand.

- [ ] **Step 6: Commit.** `git commit -m "feat(pip): floating player controls, P key, drag and resize"`

---

### Task 5: Docs and full verification

**Files:**
- Modify: `CLAUDE.md` (codebase map: `player/pip`, `pipWindow`, `win32Frame`; overlay `PipControls`, `SeekBar`, `icons`. Gotcha: in PiP the overlay follows `getBounds()`, not `getContentBounds()`), `.claude/skills/mpv-ipc/SKILL.md` (PiP section: frameless toggle via koffi, always on top for both windows), `docs/PROJECT_PLAN.md` (feature line), and the README keys list if it has one.

- [ ] **Step 1: Update the docs above.**
- [ ] **Step 2: Full verification.** Run `npm run typecheck`, `npm test` and `npm run test:e2e`. Expected: all green, and the output is quoted in the hand-off.
- [ ] **Step 3: Commit.** `git commit -m "docs: picture in picture"`
- [ ] **Step 4:** Run a fresh reviewer on the whole branch (`requesting-code-review`) and fix Critical/Important findings test-first. Then fast-forward `main`. Push only with the user's say-so; this isn't a milestone.
