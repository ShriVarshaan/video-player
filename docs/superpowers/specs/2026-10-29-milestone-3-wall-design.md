# Milestone 3 — Infinite wall: design

Date: 2026-10-29 · Status: approved

## Intent

Replace the milestone 2 placeholder screen with the real home screen: an endless poster wall of every movie and show in the library. It pans in every direction, repeats titles when there are few, and shows a title's details when it has focus. The library tools on the placeholder (folders, TMDB key, scan progress) move to a Settings page. A menu at the top left switches between Search, Home and Settings.

Why now: the library has had data since milestone 2, and this is the first screen the user lives in. Playback (milestone 4) and search (milestone 8) will hang off it.

## Goals

1. **Navigation.** A menu button sits at the top left of every page. It opens a drawer from the left with three text-only entries (no icons): **Search**, **Home**, **Settings**. The current page is highlighted. The drawer slides in over the page, which dims behind it. Picking an entry, Esc, or clicking outside closes it. The app opens on Home.
2. **Settings page** with everything the placeholder had for managing the library:
   - library folders (path, video count, offline badge, Remove with in-page confirmation)
   - Add folder, Rescan, the scan progress line
   - the TMDB key field with TMDB's credit line
3. **Search page** as a stand-in that says search is coming. Milestone 8 replaces it.
4. **The wall** on Home, built as the `infinite-wall` skill describes: tile mapping with a stride, a recycled DOM pool, a camera in a rAF loop, arrow keys, drag with momentum, wheel and trackpad, hover focus, idle drift, focus zoom, the blurred backdrop, a resume progress line, generated tiles for titles without a poster, accessibility and the performance budget.
5. **Info card fixed at the bottom left** (Apple TV style) over a dark gradient, shown 400 ms after focus settles:
   - **Movie:** title, year, runtime, genres, rating, a one-line synopsis.
   - **Show:** name, first-air year, "N seasons · M episodes", genres, rating, synopsis.
   - A **Play** button that is visibly disabled with the hint "Playback arrives in a later update". A show's button reads **Play episode** or **Continue watching**, from the existing `nextUp` rules.
6. **Empty library:** the wall area shows "Choose a folder to fill your wall" with a button that goes to Settings.

## Non-goals

- Playback and the show page (milestone 4). Enter, click and Space open/hold the info card; Play stays disabled.
- Real search (milestone 8).
- The full settings screen of milestone 9 (subtitle style, about, etc.). Settings holds only library and TMDB for now.
- Manual TMDB re-matching, sorting or filtering the wall.

## Anti-goals

- Frame drops while panning. The wall must hold 60 fps on integrated graphics.
- React re-rendering per animation frame.
- Broken-image icons or blank flashes when tiles recycle.
- The wall reshuffling when a title is added or a scan finishes.
- Losing any library-management ability the placeholder had.

## Constraints

- Builds on milestone 2:
  - `poster://` URLs (posters 400 px, backdrops 1280 px, resolved lazily by `src/main/images/cache.ts`)
  - `tmdb_movies` / `tmdb_shows` / genres tables (no migration needed)
  - `playback_state`
  - the `nextUp` rules in `showProgress.ts`
  - `library.changed` / `library.progress` events
- IPC goes through `src/shared/api.ts` (`electron-skills` process).
- The `infinite-wall` skill is the source of truth for wall behaviour. Any decision here that changes it is written back to the skill in the same commit.
- The TMDB credit line must stay wherever the key is entered.

## Approaches (decided)

**How the wall is rendered — the user picked A.**

| | A. Recycled DOM pool + imperative rAF loop — **chosen** | B. Canvas / WebGL | C. React virtualized grid |
|---|---|---|---|
| Speed | 60 fps: one transform per frame, content swaps only at tile boundaries | Fastest | Reconciliation during glides drops frames |
| Accessibility, text, tests | Real elements: outline, live region, Playwright locators | All hand-drawn; nothing to focus or locate | Real elements |
| Code | Camera/spring/momentum written by hand outside React | Most | Least |

Why A: it meets the performance target while keeping accessibility and tests simple, and it is what the skill and plan already commit to. B is overkill for hundreds of titles; C risks the anti-goal.

**Navigation style — the user picked the labelled drawer** (over a slim icon rail), with **no icons** next to the labels. **Info card — the user picked fixed bottom-left** (over a card floating beside the poster).

## Decisions

### Pages and navigation (`src/renderer/src/`)

- `App` holds `page: 'home' | 'search' | 'settings'` in state. No router library.
- `nav/Menu.tsx`: the button and the drawer.
  - The button is a 40 px rounded, translucent square at top 16 px / left 16 px, always above the page. `aria-label="Menu"`, `aria-expanded`, `aria-controls`.
  - The drawer is about 240 px wide, a frosted dark panel. It slides in with a 220 ms ease-out transform; the scrim fades. It uses `transform` and `opacity` only, with no slide under `prefers-reduced-motion`.
  - The entries are buttons; the current one has `aria-current="page"`. Opening it focuses the current entry. Up/Down move between entries, Enter picks one, and Esc closes it and returns focus to the menu button.
- While the drawer is open or another page is shown, the wall pauses its rAF loop and ignores input.
- Leaving Home and coming back keeps the wall's camera and focus.
- **Keys from the wall:** `/`, Ctrl+F or typing a letter go to the Search page. Esc on the wall does nothing.
- `pages/Settings.tsx`: built from today's `Library.tsx`, minus the movie and show lists. `ShowView.tsx` and the lists are deleted; milestone 4 builds the real show page.
- `pages/SearchSoon.tsx`: a heading "Search" and one line saying it is coming.

### Wall data — new endpoint `library.wall({})`

Returns `WallItem[]`, already in wall order (sorted by `order` ascending):

```ts
type WallItem = {
  key: string               // 'movie:<videoId>' | show key ('tmdb:<id>' | 'local:<parsed_show>')
  kind: 'movie' | 'show'
  order: number             // movies: videos.wall_key; shows: FNV-1a 32 of the show key
  title: string
  year: number | null
  posterUrl: string
  backdropUrl: string | null   // null when no TMDB backdrop: the wall uses the poster, blurred
  matched: boolean
  runtimeMin: number | null    // movies (TMDB, else probe duration rounded)
  seasonCount: number | null   // shows
  episodeCount: number | null  // shows
  genres: string[]
  rating: number | null        // TMDB vote average, one decimal
  overview: string | null
  progress: number | null      // movies: position/duration if started and not finished; shows: null
  playLabel: 'Play' | 'Play episode' | 'Continue watching'
}
```

- Built in `queries.ts` alongside `listLibrary`, with the same rules: missing files excluded, and the largest file per title.
- `library.list` stays for now; the Settings page doesn't need it.
- The renderer refetches `library.wall` on `library.changed` and keeps the camera position. Focus stays on the same `key` if it still exists.

### Wall modules (`src/renderer/src/wall/`)

Pure logic is kept apart from the DOM so it can be unit-tested in Node:

- `mapping.ts`: `mod`, `chooseStride(n)`, `itemAt(col, row, n, S)`.
- `geometry.ts`: tile size from the viewport, pitch, visible range, slot assignment diff.
- `physics.ts`:
  - critically damped spring (stiffness 170, damping 26)
  - momentum decay `v *= 0.94^(dt/16.67)`, stopping below 5 px/s
  - velocity tracker over 100 ms
  - drift at 10 px/s diagonally after 8 s idle
- `camera.ts`: owns `{x, y}`, its target and mode (`idle | spring | glide | drag | drift`); `step(dt)` is pure.
- `Wall.tsx`: the React shell. It owns the container, the pool, the rAF loop, input listeners, the live region and the info card. It re-renders only on items change, resize or focus change.
- `InfoCard.tsx`, `Backdrop.tsx` (two stacked layers crossfaded over 600 ms; a single static blurred image, never per-tile blur).
- **Generated tile** (poster 404 or `matched=false` with no frame): a CSS-only tile, either a gradient picked from the title hash or the blurred frame if one exists, with the title in the app typeface. Detected with `img.onerror`, never shown as a broken image.
- **Hold-to-repeat arrows:** start at about 6 tiles/s, ramp to a cap of 12 tiles/s over about 1 s.

### Look

- Dark, cinematic. The background is near-black (`#0b0b0d`) with the blurred backdrop at reduced opacity on top.
- Posters have a 6 px radius. The focused tile scales to 1.12 with a soft large shadow and a 2 px white outline (keyboard focus visible). Neighbours go to opacity 0.85. Transitions use a 200 ms spring-like ease.
- The info card has no panel: text over a bottom gradient (`transparent → rgba(0,0,0,.85)`), with the title at about 32 px semibold.
- The final type and palette follow `design-taste-frontend` (app-screen rules) plus `apple-design`, audited with `impeccable` before the milestone ends.

### Doc and skill updates (same commits as the code)

- `infinite-wall`:
  - Enter/click/Space open the card until milestone 4
  - typing goes to the Search page
  - `library.wall` and `WallItem`
  - the bottom-left card
  - the wall pauses under the drawer
- `docs/PROJECT_PLAN.md`: the navigation drawer and Settings page in Architecture; milestone 3 row.
- `CLAUDE.md`: codebase map for `src/renderer/src/` (pages, nav, wall).
- `.gitignore`: add `.superpowers/` (brainstorm mockups).

### Tests

- **Vitest (node):**
  - stride: for n = 1..60, no vertical or diagonal duplicates where theory allows
  - `mod` with negatives
  - visible range and slot reassignment
  - spring settles without overshoot
  - frame-rate-independent momentum (same distance at 30, 60 and 144 Hz within 1 %)
  - drift start and stop
  - `library.wall` query: order, movie and show fields, progress, `playLabel`, missing files excluded, largest file kept
- **E2E (Playwright-Electron)**, fixture library with `VP_TMDB_MODE=fixtures`:
  - Add the folder and key through Settings (the drawer flow); go Home; the wall fills the screen (more tiles than titles).
  - ArrowRight ×5 changes the title in the live region, and the info card shows the focused title.
  - Drag pans the wall.
  - The drawer opens with the button, Esc closes it, and Settings/Search/Home switch pages.
  - An empty library shows the "Choose a folder" call to action, which leads to Settings.
  - The existing `library.spec.ts` is rewritten for the Settings page and the wall.
- **Manual:** the DevTools Performance panel while dragging and gliding, with no long tasks over 8 ms and no layout per frame; screenshots checked with `/run`.

## Calls I made (check these)

- Enter, click and Space open (or keep) the info card. Play is shown but disabled until milestone 4.
- `/`, Ctrl+F or typing a letter go to the "coming soon" Search page now, so the habit is already in place.
- A show's card shows "N seasons · M episodes" in place of runtime, and its button label already follows the `nextUp` rules.
- Page switching uses plain React state, no router. The wall keeps its position when you leave and come back.
- `library.wall` is a new endpoint rather than a widened `library.list`.
- The placeholder's movie and show lists and `ShowView` are removed; the show page arrives in milestone 4.
- No backdrop → the poster blurred is used as the background.
- The app version and binary status lines from the placeholder go to the bottom of Settings ("About" moves to milestone 9).

## Left to the builder

- Exact tile size clamps, gap, colours and type, within the skill's ranges and the design skills.
- The pool size cap if very wide screens need more than about 80 slots.
- Whether the 400 ms card delay and 80 ms hover delay feel right on the real library; adjust and record the values in the skill.
