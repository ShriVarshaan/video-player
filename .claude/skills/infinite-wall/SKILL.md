---
name: infinite-wall
description: The endless, repeating 2D poster wall that is the app's home screen — tile→movie mapping with a coprime stride, camera/virtualization with a recycled DOM pool, keyboard/drag/momentum/wheel input, focus and info card, idle drift, poster loading, accessibility and performance budgets. Use for any work in src/renderer/wall/*, home-screen navigation, or wall jank/visual bugs.
---

# Infinite wall

The wall is an endless grid that pans in all four directions. It has no edges, and movies repeat when there aren't enough of them.

Use with `animation-performance` and `apple-design` for motion, and with `vercel-react-best-practices` for React.

## Mapping a tile to a movie
```ts
const mod = (a: number, n: number) => ((a % n) + n) % n;
const movieAt = (col: number, row: number) => movies[mod(row * S + col, n)];
```
Horizontal neighbours always differ when `n > 1`. Choose the stride `S` so that vertical and diagonal neighbours differ too:
- `S mod n ∉ {0, 1, n-1}`
- prefer `gcd(S, n) = 1`, so each column cycles through every movie

Among the valid `S`, pick the one closest to `n * 0.382` (golden ratio), which avoids visible diagonal stripes. If none exists, relax the gcd rule. For `n ≤ 3`, use `S = 1`; some adjacent repeats can't be avoided.

Recompute `S` when `n` changes. Keep the movie order stable (sorted by an id hash, not by date added) so the wall doesn't reshuffle when one movie is added.

Edge cases:
- `n = 0`: empty state with a "Choose a folder" call to action.
- `n = 1`: a wall of one poster, which is intended.

## Geometry and camera
- Posters are 2:3. Tile width is about `clamp(150px, 11vw, 260px)`, with a gap of 0.9 × the tile width. `pitchX = w + gap`, `pitchY = h + gap`.
- The camera `{x, y}` is in world pixels, as floats, and can be negative. Visible columns run from `floor((cam.x - buf) / pitchX)` to `floor((cam.x + vw + buf) / pitchX)`, with `buf` = one tile. Rows work the same way.
- **DOM pool:** create `(cols + 2) × (rows + 2)` tile nodes once, up to about 80. Each frame:
  1. Move the container by `translate3d(-(cam.x mod pitchX), -(cam.y mod pitchY), 0)`.
  2. When the camera crosses a pitch boundary, shift slot→(col,row) assignments and swap the content of only the slots that changed.
- **No React re-render per frame.** Keep the camera in a ref, run a single `requestAnimationFrame` loop, and set `style.transform` directly. React re-renders only on resize, a library change, or a focus change.
- No layout reads inside the rAF loop. Measure the viewport with `ResizeObserver`.

## Posters
- The main process provides a downscaled cache, 400 px wide WebP, through a custom protocol. Use the `posterUrl` that `library.list` returns: `poster://poster/video/<videoId>` for a movie, `poster://poster/show/<tmdbId>` for a show (`poster://poster/video/<firstEpisodeId>` for a show TMDB couldn't match). Backdrops are `poster://backdrop/...` at 1280 px. Never load full-size TMDB images into the wall.
- **Tiles are movies and shows**: one tile per movie and one per show (not per episode). `n` counts both. Order by `wall_key` (movies) and the show's TMDB id hash, so nothing reshuffles when a title is added.
- When a slot's content changes, load the new image off-screen and `await img.decode()` before swapping, so there's no blank flash. Keep the old image until then.
- No poster: draw a generated tile (blurred ffmpeg frame + title in the app typeface). Never show a broken-image icon.

## Input
| Input | Behaviour |
|---|---|
| Arrow keys | Move focus one tile. The camera springs only when focus leaves the inner 60 % of the viewport (stiffness about 170, damping about 26, critically damped). Holding a key repeats with acceleration, capped at about 12 tiles/s. |
| Mouse drag / touch | Pointer capture. Ignore the first 6 px so clicks still work. Track velocity over the last 100 ms. On release, glide with frame-rate-independent decay `v *= Math.pow(0.94, dt / 16.67)` and stop below 5 px/s. |
| Wheel / trackpad | Pan directly by `deltaX/deltaY` (Shift swaps the axes). Mark the listener as `passive`. |
| Hover | Focus follows the mouse after 80 ms of rest, but never during a glide. |
| Enter / click | Play. Space or `i` opens the info card. |
| `/`, Ctrl+F, or typing a letter | Open search (`netflix-search`). |
| Idle drift | After 8 s without input, drift at about 10 px/s diagonally. Stop instantly on any input. Disabled under `prefers-reduced-motion`. |

## Focus and info card
- The focused tile scales to 1.12, gets a soft large shadow, and sits above its neighbours. Neighbours dim slightly (opacity 0.85). Use a 200 ms spring and never animate layout properties.
- After 400 ms on the same tile, show the info card (title, year, runtime, genres, rating, a one-line synopsis) and crossfade the screen background to that movie's blurred backdrop over 600 ms.
- If the movie has a resume position, show a thin progress line on the tile.

## Accessibility
- Give the container `role="application"` and an `aria-label`. A visually hidden `aria-live="polite"` region announces "Title, year" when focus changes.
- The focus outline must be visible for keyboard users, not just the scale change.

## Performance budget
- 60 fps while panning on an integrated GPU. Check with the DevTools Performance panel: no long tasks over 8 ms and no layout or style recalculation per frame.
- Use `contain: strict` on tiles. Put `will-change: transform` on the container only. Don't use `filter: blur()` on moving tiles; the blurred backdrop is one static layer.

## Tests
- **Unit (`vitest`):**
  - For `n = 1..60`, check that vertical and diagonal neighbours differ whenever theory says they can.
  - Check that `mod` handles negatives.
  - Test the visible-range maths and the slot reassignment as pure functions.
- **E2E (`playwright-best-practices`, Electron):** with 3 fixture movies the screen fills, and ArrowRight ×5 changes the focused title in the live region.
