# Milestone 8 — Search (design)

## Intent

The user usually searches for **a specific title they already have in mind**: a few letters, and the title they meant should be on top, ready for Enter. Searching by **actor and genre** must work too, but comes second. This replaces the "Search is coming" placeholder page with the Netflix-style search the project has planned since the start (`netflix-search` skill).

## Goals

- Typing a title finds it fast: the best match is the first card, already selected, and **Enter opens its page** (Play / Continue / Restart live there). Search never starts playback by itself.
- The search also matches actors, directors (creators for shows), genres and year. Chips narrow to an exact person or genre.
- Netflix look: a full-screen overlay with a big query bar, an "Explore titles related to" chip row, and a grid of **wide 16:9 cards** (the user picked these over posters in a mockup).
- It feels instant (under 2 ms per search on a personal library) and fully keyboard-driven.

## Non-goals

- **Episode titles aren't searched.** Shows and movies are found by their names (and people, genres, year) only. User's decision.
- No online search (TMDB) for titles that aren't in the library, no search history, no suggestions as you type beyond the chips.
- No changes to the player's subtitle "Search online…" (a different feature).

## Anti-goals

- The right title buried under fuzzy noise: prefix and exact title matches must beat loose matches.
- Results flickering or jumping between keystrokes.
- Search stealing keys from the player, or the wall losing its place.

## Constraints

- Renderer: React 19 / TypeScript, no native `<select>` (`components/Select`), keys handled on `window` (wall rules: ignored inside `nav` and inputs).
- Data already in SQLite: TMDB cast (top-billed), directors, genres for movies (`credits`, `tmdb_movie_genres`); creators, cast, genres for shows (`show_credits`, `tmdb_show_genres`). Unmatched files only have their parsed name and year.
- Accent folding with `normalizeTitle` (`src/shared/normalize.ts`) on both documents and query.
- IPC goes through `src/shared/api.ts` (`electron-skills`).

## Approaches considered

1. **Index in the search screen, with Fuse.js (chosen).** Main sends one list of search documents. The renderer builds a Fuse index (weighted fields, typo tolerance) and searches locally on every keystroke. Our own rules sit on top: prefix first, year filter, exact chip filters. It costs one small dependency, and it's what the `netflix-search` skill describes.
2. **SQLite FTS5 in main**, a query over IPC per keystroke. No new dependency, and it scales, but it has no typo tolerance ("incepton" finds nothing), needs a migration, and the index has to be kept in step with TMDB writes. Rejected.
3. **Our own matcher, no library.** Full control, but we'd be re-implementing weighted multi-field scoring and typo tolerance. Rejected.

The user picked approach 1.

## How it works (as decided)

### Opening and closing

- **From the wall, typing a printable character opens search with that character already in the box.** The wall already calls `onSearch` on typing, but drops the character; it must pass the character through.
  - **The `i` key conflict (my call):** the wall uses `i` to show the info card, so typing "inception" would open the card instead. `i` stops being an info-card key (Space still does it) and starts a search like any other letter.
- `/` and Ctrl+F open it empty. Typing, `/` and Ctrl+F open it **only from the wall** (my call: the title page and Settings keep their own keys).
- The menu's **Search** opens it too, replacing the `SearchSoon` placeholder page. It's an overlay state in `App`, not a `page`. Opened from the menu while on Settings or a title page, the app switches to Home underneath, and Esc closes to the wall (my call).
- It's an overlay over the dimmed, blurred wall (the wall stays mounted and paused). It fades in over about 180 ms (reduced motion: no fade).
- **Esc:** clears the query if there is one; otherwise closes the overlay, and focus returns to the wall tile that was focused before.
- **Opening a result (Enter or click)** opens the title page (movie or show) over Home, as the wall does. **Back from that title page returns to the search with the same query and selection** (my call, Netflix-like). Esc on the search then closes back to the wall as usual. Playing from the title page and closing the player returns to the title page as today; back from there returns to the search.

### Results

- Results update as you type, with no flash: the previous results stay until the new ones are ready (debounce 120 ms, `useDeferredValue`).
- **The first card is selected** (focus ring on it) whenever the results change, so Enter acts on it with no arrow keys.
- **Ranking: titles first, in tiers (my call, from "usually a specific title").** Fuse finds the candidates, using the skill's weights (title 0.5, originalTitle 0.15, cast 0.15, directors 0.1, genres 0.05, year 0.05; `threshold 0.35`, `ignoreLocation`, `minMatchCharLength 2`). Results are then ordered by tier, and by Fuse score within a tier:
  1. **exact title**: the folded title or original title equals the query;
  2. **title starts with the query**: the whole folded title, or the title with a leading article ("the", "a", "an", "le", "la", "les", "l'") removed, so "matrix" starts "The Matrix";
  3. **a word in the title starts with the query**: "knight" matches "The Dark Knight";
  4. **everything else**: fuzzy title matches, people, genres.

  So "inc" puts Inception before Prince of Persia. "tom" puts Tomb Raider above Tom Hanks films, which is fine because titles come first; the "Tom Hanks" chip is one key away. Original titles count in tiers 1–3 too.
- **Numbers (my call):** a 4-digit token from 1900 to 2099 is matched **both** as title text and as a year. Titles that match the whole query as text rank by the tiers above ("1917" finds *1917*, "2049" finds *Blade Runner 2049*). Titles from that year that fuzzy-match the rest of the query come next ("matrix 1999" → The Matrix (1999), then other matrix matches). A year on its own lists any title named after it first, then that year's titles.
- **Field-scoped queries from chips:** `cast:"Tom Hanks"`, `director:"Christopher Nolan"`, `genre:Comedy` (exact match on the folded value, not fuzzy). For shows, `director:` matches creators. Typing the scoped form by hand works too.
- One-character queries show the empty-query rows; matching starts at 2 characters.

### Layout

- Query bar at the top (28–32 px type) with a search icon.
- **"Explore titles related to:"** up to 5 chips, counted from the top 12 results: genres, directors/creators, top-3 cast, and the decade ("2010s"). Chips equal to the query are skipped. Clicking a chip replaces the query with its scoped form and keeps focus in the input.
- **Grid of 16:9 cards** (`repeat(auto-fill, minmax(260px, 1fr))`):
  - each card shows the TMDB backdrop with the title logo, or the title text, in the lower left;
  - with no backdrop, a blurred poster sits behind the poster;
  - a red resume bar shows when partly watched.
- The **selected card** scales to about 1.04–1.06 with a shadow. Under it: year · runtime (or "3 seasons") · genres. Transforms only, a 200 ms spring; reduced motion: no scale.
- **Empty query:** a "Continue watching" row, most recently played first. It has movies with progress, and shows the user is in the middle of (my call, as Netflix does): a half-watched episode, or a finished episode with the next one not yet started (the show page's `nextUp` says `continue` or `play` after earlier progress). Shows with a half-watched episode get that episode's resume bar. and a "Recently added" row (newest files first). Each row has at most 12 cards, same cards. A row with nothing in it is hidden. With an empty library, a short line points to Settings → add a folder.
- **No results:** "Your search for "x" did not have any matches.", then suggestions ("Try a different title, an actor, a director or a genre") and up to 6 genre chips from the library.
- A polite live region announces "12 results" after the debounce.

### Keyboard

| Key | Action |
|---|---|
| typing | goes into the query box (from anywhere in search) |
| ↓ in the box | chips (if any), then the first card |
| arrows in the grid | move by cell; the column count is read from the computed grid on resize |
| ↑ from the first row | chips, then the box |
| Enter | opens the selected card's title page (Enter in the box acts on the selected first card) |
| Esc | clear query → close |

Cards are buttons with `aria-label="Title (Year)"`; the input is `role="searchbox"` with `aria-controls` on the grid. Rows in the empty state navigate the same way (← → within a row, ↑ ↓ between rows).

### Data

- **New endpoint `library.searchDocs`** returns one document per wall title (same keys as `WallItem`):
  - card fields: title, year, kind, poster/backdrop/logo URLs, runtime or season count, genres, progress;
  - search fields: originalTitle, top-5 cast, directors (movies) or creators (shows);
  - for the empty state: addedAt and lastPlayedAt.
  Built from the same queries as the wall. Unmatched files carry their parsed title and year only.
- The renderer fetches it when search opens and on `library.changed` (rebuilding the Fuse index); it's cached while the app runs. If a library ever exceeds 5,000 movies, searching moves to a Web Worker (not needed now; noted only).
- The pure parts (query parsing, ranking, chips, the empty-state rows) live in `src/renderer/src/search/` as plain functions, unit-tested in Node.

## Testing

- **Unit (Vitest):**
  - "inception" → Inception first; "inc" → Inception before Prince of Persia;
  - "nolan" → his films; "hanks" → Tom Hanks films;
  - "1999" filters, "matrix 1999";
  - "amelie" → Amélie; a typo "incepton" → Inception;
  - scoped chips (`cast:"…"`, `genre:…`, `director:` matching show creators);
  - chip counting (top 5, skips the query);
  - empty-state rows (ordering, hiding empty rows);
  - the `searchDocs` query on a fixture DB (cast, directors, creators, genres, unmatched files).
- **E2E (Playwright-Electron, fixture library):**
  - type on the wall → search opens with that letter, the expected card is first and selected;
  - Enter → title page; back → search with the same query;
  - Esc twice → wall with the same tile focused;
  - `/` and the menu open it;
  - ↓ moves to the chips and then the cards;
  - a chip click narrows the results;
  - the no-match message;
  - the empty query shows the rows.

## Docs to update in the same branch

`docs/PROJECT_PLAN.md` (search section, milestone 8 row), `CLAUDE.md` (codebase map: `search/`, remove `SearchSoon`; the `i` key change), `netflix-search` skill (Enter opens the page, not Play; no episode titles; back returns to search; the `i` change), `infinite-wall` skill (the `i` key).

## Left to the builder

- Exact card visuals, spacing and motion within the skill's numbers (`apple-design`, `emil-design-eng`, `design-taste-frontend` app-screen rules).
- How the overlay is mounted in `App` (a state beside `page`/`titleKey`).
- The `searchDocs` SQL.
- Where the logo URL comes from. The image cache already serves `poster://logo/...`, but no screen draws logos yet, so the cards are the first. A card with no logo shows the title in text.

## As built

- Data: `library.searchDocs`, built by `listSearchDocs` in `src/main/library/queries.ts`, which shares `showGroups()` with the wall query.
- Search code: `src/renderer/src/search/`. The pure parts are `query`, `rank`, `chips`, `rows` and `gridNav`; the UI is `SearchOverlay`, `SearchCard` and `useSearchDocs`.
- **Scoped chips** match the whole folded name or whole words of it, so `director:nolan` works and `genre:dram` doesn't.
- **A query with a year** is ordered as: strong title matches (tiers 0–2), then that year's titles matching the rest, then loose matches.
- **A decade chip** (`2010s`) filters to that decade.
- **Cards** are `role="option"` in a listbox (so `aria-selected` is valid), not buttons.
- **`App`** keeps search as its own overlay state, plus `fromSearch` so back from a title page returns to the search. The menu still lists "Search".
- **In fixture mode** every TMDB image is the same placeholder, so cards look identical in screenshots. Logos are fetched on demand by the image cache.

Fixed after the final review:
- Back from a title page keeps the card you'd moved to. The search documents are cached while the app runs, so reopening search starts with results at once.
- A library refresh keeps your selection while that card is still there.
- The active chip isn't offered again.
- A show watched to its last episode leaves Continue watching.
- Enter on the menu button opens the menu, not a result.
- Space on a chip picks it.
- Keys typed during IME composition are ignored.

Deferred (minor, from the final review):
- Backspace on a focused card doesn't edit the query.
- `listSearchDocs` uses an O(n²) movie join and builds the show groups twice. Fine at hundreds of titles; revisit at thousands.
- A bare year also lists neighbouring years through the fuzzy year key (that year's titles come first).
- Overlapping document fetches aren't ordered.
- The key handler re-subscribes on every render, and cards aren't memoized.
- Empty-state row cards don't show the selected scale or meta line.
- Choosing Search from the menu while search is open sometimes keeps the query.
