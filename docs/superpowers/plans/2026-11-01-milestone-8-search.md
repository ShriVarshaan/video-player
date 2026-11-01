# Milestone 8 — Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Netflix-style search overlay over the wall: type a title and it's the first card, already selected, so Enter opens its page. Actors, directors/creators, genres and year match too, with chips and wide 16:9 cards.

**Architecture:** Main builds one search document per wall title (`library.searchDocs`) from SQLite. The renderer builds a Fuse.js index from them and ranks titles first in tiers. Pure functions (query parsing, ranking, chips, empty-state rows, grid navigation) live in `src/renderer/src/search/` and are unit-tested in Node. `SearchOverlay` is an overlay state in `App`, beside `page` and `titleKey`.

**Tech Stack:** React 19/TS, Fuse.js 7, `node:sqlite`, Vitest, Playwright-Electron.

**Spec:** `docs/superpowers/specs/2026-11-01-milestone-8-search-design.md`

## Global Constraints

- **Enter opens the title page; search never starts playback.**
- Episode titles aren't searched; one document per movie and per show (the wall's keys).
- Fuse options: keys title 0.5, originalTitle 0.15, cast 0.15, directors 0.1, genres 0.05, year 0.05; `threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2, includeScore: true`. Fold accents with `normalizeTitle` (`src/shared/normalize.ts`) on documents and query.
- **Ranking tiers** (then Fuse score within a tier):
  1. exact title (folded title or originalTitle equals the query);
  2. title starts with the query, whole or after a leading article (`the`, `a`, `an`, `le`, `la`, `les`, `l'`);
  3. a word in the title starts with the query;
  4. everything else.
- A 4-digit token from 1900 to 2099 counts as title text **and** as a year: text matches rank by tier, then year-filtered matches of the rest of the query.
- Scoped queries: `cast:"…"`, `director:"…"` (matches creators for shows), `genre:…`; exact on folded values.
- Matching starts at 2 characters; shorter queries (after trimming) show the empty-state rows.
- Debounce 120 ms with `useDeferredValue`; **Enter always acts on the results for the current text** (computed at once, not the debounced ones).
- Chips: up to 5, from the top 12 results (genres, directors/creators, top-3 cast, decade like `2010s`), skipping any equal to the query.
- Empty state: "Continue watching" (most recently played first; movies in progress; shows partway through, meaning a half-watched episode or a finished episode with the next not started) and "Recently added" (newest `added_at` first). At most 12 each; empty rows hidden.
- Copy:
  - placeholder `Search titles, people, genres`;
  - `Explore titles related to:`;
  - `Continue watching`, `Recently added`;
  - empty library: `Add a folder in Settings to search your library.`;
  - no match: `Your search for “x” did not have any matches.`, then `Try a different title, an actor, a director or a genre.`;
  - live region: `12 results` / `1 result`.
- Opening: typing a printable character, `/` or Ctrl+F **on the wall**, and the menu's Search from anywhere (Home goes underneath). The wall's `i` key no longer shows the info card (Space still does).
- Esc: clear the query, then close (focus back on the wall tile). Back from a title page opened from search returns to search with the same query and selection.
- Cards: 16:9, `repeat(auto-fill, minmax(260px, 1fr))`. A card shows the backdrop with the logo, or the title text; with no backdrop, a blurred poster behind the poster. Red resume bar when partly watched. Selected card: scale 1.05 with a shadow and `year · runtime/“N seasons” · genres` under it. Transforms only, 200 ms; reduced motion: no scale or fade. Cards are buttons, `aria-label="Title (Year)"`; the input is `role="searchbox"` with `aria-controls`.
- Use the Edit tool (CRLF files). E2E picks the main window by URL, calls `toSecondDisplay`, and closes with `closeApp`.

## Review Focus

1. **Enter pressed before the debounce settles** ("matrix" typed fast, then Enter at once) must open The Matrix, not a stale result. → E2E in Task 5 (`Enter right after typing opens the typed title`).
2. **Blank or punctuation-only queries** (`"   "`, `"?"`, `"\""`) show the empty-state rows and never throw. → unit in Task 2 (`blank and punctuation-only queries are empty`).
3. **Unmatched files** (no TMDB: no cast, genres or backdrop) are found by their parsed title, and their cards show the title text over the frame poster. → unit in Task 2 (`finds an unmatched file by its parsed title`), E2E in Task 5 (`a card without art shows its title`).
4. **The library changes while search is open** (a scan finishes): results refresh for the same query without closing. → unit in Task 5 (`useSearchDocs refetches on library.changed`).
5. **A scoped chip for a name with quotes or accents** (`cast:"Audrey Tautou"`, `genre:science fiction`, `director:"Vince Gilligan"` for a show) matches exactly. → unit in Task 2 (`scoped queries`).

---

### Task 1: Search documents from main

**Files:**
- Modify: `src/shared/library.ts` (add `SearchDoc`), `src/shared/api.ts` (`library.searchDocs` in `API` and `apiMethods`), `src/main/library/queries.ts` (`listSearchDocs`; share the show grouping with `listWall` rather than copying it), `src/main/library/setup.ts` (register)
- Test: `tests/unit/searchDocs.test.ts`, `tests/unit/api.test.ts` (the method list)

**Interfaces:**
- Produces:
  ```ts
  // src/shared/library.ts
  export type SearchDoc = WallItem & {
    originalTitle: string | null
    cast: string[]          // top 5 billed (credits / show_credits role 'cast', by ord)
    directors: string[]     // movies: role 'director'; shows: role 'creator'
    logoUrl: string | null  // poster://logo/... when logo_path is set
    addedAt: number         // max added_at of the title's files (unix ms)
    lastPlayedAt: number | null  // max last_played_at over the title's files
    inProgress: boolean     // Continue watching (see Global Constraints)
  }
  // src/main/library/queries.ts
  export function listSearchDocs(db: Db): SearchDoc[]   // same order and keys as listWall
  // api.ts, library domain
  searchDocs: (params: Record<string, never>) => Promise<SearchDoc[]>
  ```
  For shows, `progress` is the half-watched episode's fraction when `nextUp` says `continue`, else null.

- [ ] **Step 1: Write failing tests** in `searchDocs.test.ts`, reusing `queries.test.ts`'s fixture style (`video()` helper, The Matrix 603, Breaking Bad 1396, an unmatched movie, an unmatched show). Add `people`, `credits` (Keanu Reeves cast ord 0, the Wachowskis director), `show_credits` (Bryan Cranston cast, Vince Gilligan creator), `original_title`, `logo_path` and `playback_state` rows.
  - `has the wall's keys in the wall's order`: `listSearchDocs(db).map(d => d.key)` equals `listWall(db).map(w => w.key)`.
  - `movie carries cast, directors, original title and logo`: The Matrix doc has `cast[0] === 'Keanu Reeves'`, `directors` containing the director, `logoUrl` starting `poster://logo/video/`.
  - `show carries creators as directors`: Breaking Bad has `directors === ['Vince Gilligan']` and `cast` containing `'Bryan Cranston'`.
  - `cast is the top 5 by billing`: with 7 cast rows, it returns the 5 lowest `ord`.
  - `unmatched titles have empty people and genres`.
  - `addedAt and lastPlayedAt are the max over the title's files`
  - `inProgress`: a movie at 40 % → true; a movie at 97 % → false; a show with episode 1 finished and episode 2 not started → true; a show with nothing played → false; a show with episode 2 half-watched → true with `progress ≈ 0.5`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/searchDocs.test.ts`. Expect FAIL (no export).
- [ ] **Step 3:** Implement. `inProgress` for shows: `nextUp` is `continue`, or `play` while some episode has `lastPlayedAt`. Update `api.test.ts`'s library method list.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit `feat: search documents for every title`.

### Task 2: Query parsing and ranking

**Files:**
- Modify: `package.json` (`npm install fuse.js@^7.1.0`)
- Create: `src/renderer/src/search/query.ts`, `src/renderer/src/search/rank.ts`
- Test: `tests/unit/searchRank.test.ts`

**Interfaces:**
- Consumes: `SearchDoc` (Task 1), `normalizeTitle`.
- Produces:
  ```ts
  // query.ts
  export type Scope = { field: 'cast' | 'director' | 'genre'; value: string }  // value folded
  export type ParsedQuery = { text: string; year: number | null; scope: Scope | null; empty: boolean }
  export function parseQuery(raw: string): ParsedQuery
  export function scopedQuery(field: Scope['field'], value: string): string  // → 'cast:"Tom Hanks"' (quotes when it contains spaces)
  // rank.ts
  export type SearchIndex = { docs: SearchDoc[]; fuse: Fuse<IndexedDoc> }
  export function buildIndex(docs: SearchDoc[]): SearchIndex
  export function search(index: SearchIndex, raw: string): SearchDoc[]   // [] when parseQuery(raw).empty
  ```
  `IndexedDoc` holds folded copies of the fields; it's internal to `rank.ts`.

- [ ] **Step 1: Write failing tests** against a fixture doc list built in the test. It includes Inception (2010, Nolan, DiCaprio, Sci-Fi), The Incredibles, Prince of Persia, Interstellar (Nolan), The Matrix (1999, Keanu Reeves), The Matrix Reloaded (2003), 1917 (2019), Blade Runner 2049, Amélie (Audrey Tautou, Comedy), The Dark Knight (Nolan), Tomb Raider, Cast Away (Tom Hanks, Drama), Breaking Bad (show, creator Vince Gilligan, Drama), and an unmatched "Some Unknown Home Video".
  - `exact title first`: `"inception"` → `[0].title === 'Inception'`.
  - `prefix beats contains`: `"inc"` → Inception and The Incredibles both before Prince of Persia.
  - `leading article ignored`: `"matrix"` → The Matrix, then The Matrix Reloaded, first two.
  - `word start`: `"knight"` → The Dark Knight first.
  - `typo`: `"incepton"` → Inception first.
  - `accents`: `"amelie"` → Amélie first.
  - `people`: `"nolan"` → Inception, Interstellar and The Dark Knight all in the top 3; `"hanks"` → Cast Away first.
  - `titles beat people`: `"tom"` → Tomb Raider before Cast Away.
  - `numbers are titles and years`: `"1917"` → 1917 first; `"2049"` → Blade Runner 2049 first; `"matrix 1999"` → The Matrix first; `"1999"` → The Matrix in the results.
  - `scoped queries`: `cast:"Audrey Tautou"` → exactly [Amélie]; `genre:drama` → Cast Away and Breaking Bad only; `director:"Vince Gilligan"` → [Breaking Bad]; `director:nolan` → the 3 Nolan films; `cast:"Nobody Here"` → [].
  - `blank and punctuation-only queries are empty`: `search(idx, '   ')`, `'?'`, `'"'` and `'a'` → `[]` with no throw; `parseQuery('  ').empty === true`.
  - `finds an unmatched file by its parsed title`: `"home video"` → Some Unknown Home Video.
  - `scopedQuery quotes names with spaces`: `scopedQuery('cast', 'Tom Hanks') === 'cast:"Tom Hanks"'`; `scopedQuery('genre', 'Drama') === 'genre:Drama'`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/searchRank.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. For a year token, run Fuse on the full text (tiered), then Fuse on the text without the year, filtered to `year === Y`. Concatenate and de-duplicate by key. A year alone: titles containing it by tier, then every doc of that year sorted by title. Scoped queries skip Fuse and filter by exact folded equality on any value of the field.
- [ ] **Step 4:** Run `npx vitest run tests/unit/searchRank.test.ts` and `npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit `feat: search ranking with titles first`.

### Task 3: Chips, empty-state rows, grid navigation

**Files:**
- Create: `src/renderer/src/search/chips.ts`, `src/renderer/src/search/rows.ts`, `src/renderer/src/search/gridNav.ts`
- Test: `tests/unit/searchChips.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Chip = { label: string; query: string }   // query = scopedQuery(...) or the decade text
  export function relatedChips(results: SearchDoc[], raw: string): Chip[]    // ≤ 5
  export function libraryGenreChips(docs: SearchDoc[]): Chip[]               // ≤ 6, most common genres
  export type Row = { title: 'Continue watching' | 'Recently added'; docs: SearchDoc[] }
  export function emptyRows(docs: SearchDoc[]): Row[]                        // empty rows left out
  export function moveInGrid(index: number, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', columns: number, count: number): number | 'up-out'
  ```
  A decade chip's query is the decade's first year plus `s`, e.g. `2010s`. `parseQuery` in Task 2 treats `NNN0s` as a decade filter, so add that case and its test there in this task: `"2010s"` → only 2010–2019 titles.

- [ ] **Step 1: Write failing tests.**
  - `relatedChips counts genres, people and decade from the top 12`: Nolan results → the chips include `{ label: 'Christopher Nolan', query: 'director:"Christopher Nolan"' }` and `'2010s'`; length ≤ 5.
  - `relatedChips skips the query itself`: raw `'christopher nolan'` → no chip labelled `Christopher Nolan`; raw `'nolan'` → the Christopher Nolan chip is still there (only an equal label is skipped).
  - `only the top 3 cast count`
  - `libraryGenreChips`: the 6 most common genres, ties alphabetical.
  - `emptyRows`: Continue watching holds only `inProgress`, by `lastPlayedAt` desc; Recently added by `addedAt` desc; each capped at 12; a row with no docs left out; no docs → `[]`.
  - `moveInGrid`: 4 columns, 10 items. Right from 3 → 4; Down from 1 → 5; Down from 9 → 9 (no row below); Down from 6 → 9 (last item when the row below is short); Up from 2 → `'up-out'`; Left from 0 → 0.
  - In `searchRank.test.ts`: `decade filter` as above.
- [ ] **Step 2:** Run `npx vitest run tests/unit/searchChips.test.ts tests/unit/searchRank.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit `feat: search chips, empty rows and grid moves`.

### Task 4: Wall hands typing to search; `i` freed

**Files:**
- Modify: `src/renderer/src/wall/engine.ts` (callback `onSearch: (initial: string) => void`; the typed character is passed, `''` for `/` and Ctrl+F; drop `e.key === 'i'` from the info-card keys), `src/renderer/src/wall/Wall.tsx` (prop `onSearch: (initial: string) => void`), `.claude/skills/infinite-wall/SKILL.md` (the `i` key)
- Test: `tests/e2e/wall.spec.ts` (update `typing a letter opens Search`)

- [ ] **Step 1: Update the E2E** `typing a letter opens Search`: press `i` on the wall → the search input (`getByRole('searchbox')`) is visible with value `i`, and the info card did not open. It fails until Task 5 mounts the overlay, so run it at the end of Task 5. Record this in the ledger.
- [ ] **Step 2:** Implement the engine and prop change. `App` passes a handler that, for now, still navigates to the placeholder, so the app keeps working.
- [ ] **Step 3:** Run `npm run typecheck` and `npx vitest run`. Expect PASS.
- [ ] **Step 4:** Commit `feat: the wall passes the typed letter to search`.

### Task 5: Search overlay in the app

**Files:**
- Create: `src/renderer/src/search/SearchOverlay.tsx`, `src/renderer/src/search/SearchCard.tsx`, `src/renderer/src/search/useSearchDocs.ts`, `src/renderer/src/search/search.css`, `tests/e2e/search.spec.ts`
- Modify: `src/renderer/src/App.tsx` (search overlay state; menu Search opens it; back from a title page opened from search returns to it; remove the `'search'` page), `src/renderer/src/nav/Menu.tsx` (only if `Page` changes), `tests/e2e/nav.spec.ts` (`switches between Settings, Search and Home` now expects the searchbox)
- Delete: `src/renderer/src/pages/SearchSoon.tsx`
- Test: `tests/unit/useSearchDocs.test.ts` (if the hook's logic is extracted to a pure loader; otherwise test `createDocsStore(fetch, subscribe)`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `SearchOverlay({ initial, restore, onOpen, onClose })`:
    - `initial: string`, the first query;
    - `restore: { query: string; selectedKey: string | null } | null`, used when coming back from a title page;
    - `onOpen(key, state)` opens the title page and hands back `{ query, selectedKey }` to restore later;
    - `onClose()` returns to the wall.
  - `createDocsStore(fetchDocs: () => Promise<SearchDoc[]>, onChanged: (cb: () => void) => () => void)` in `useSearchDocs.ts`, returning `{ get(): SearchDoc[] | null; subscribe(cb): () => void; dispose(): void }`. `useSearchDocs()` wraps it with `useSyncExternalStore`, using `window.api.library.searchDocs` and `window.api.on('library.changed')`.

- [ ] **Step 1: Write the failing unit test** `useSearchDocs refetches on library.changed`. A fake fetch returns docs A, then docs B. Triggering the change callback makes `get()` return B, and subscribers are called. `dispose()` unsubscribes from changes.
- [ ] **Step 2: Write the failing E2E** `search.spec.ts` with the fixture library (`launchApp` on `tests/fixtures/library`):
  - `typing on the wall opens search with the letter and the title first`: focus the wall, type `matr` → the searchbox value is `matr`; the first card (`[data-testid="search-card"]`) has aria-label `The Matrix (1999)` and `aria-selected="true"`.
  - `Enter right after typing opens the typed title`: press `/`, type `inception` with no delay, press Enter immediately → the title page heading reads Inception.
  - `back from the title page returns to the search`: from the above, press Esc on the title page → the searchbox value is `inception`, and the Inception card is selected.
  - `Esc clears, then closes to the same tile`: `focusTile(win, 'The Matrix')`, type `x`, Esc → value `''`, still open; Esc → overlay gone, and the focused tile is still The Matrix.
  - `the menu opens search`: `goTo(win, 'Search')` → the searchbox is visible and focused.
  - `↓ goes to the chips, then the cards`: type `inception`, ↓ → a chip button has focus; ↓ → the first card has focus.
  - `a chip narrows the results`: click the first chip → the searchbox value starts with `cast:`, `director:` or `genre:`, or matches `/^\d{4}s$/`, and at least one card shows.
  - `no matches`: type `zzzzqq` → the text `Your search for “zzzzqq” did not have any matches.` is visible, with at least one genre chip.
  - `empty query shows rows`: open with `/` → `Recently added` is visible.
  - `a card without art shows its title`: type `home video` → the first card contains the text `Some Unknown Home Video`.
  - `a show opens its page`: type `breaking` and press Enter → the show page with a season picker.
- [ ] **Step 3:** Run `npx vitest run tests/unit/useSearchDocs.test.ts` and `npm run test:e2e -- search wall nav`. Expect FAIL.
- [ ] **Step 4:** Implement:
  - Input keys: printable keys typed anywhere in the overlay go to the input. ↓/↑/←/→ with `moveInGrid` (columns read from `getComputedStyle(grid).gridTemplateColumns` on resize). Enter: `search(index, input.value)[selected]` computed at once.
  - Empty-state rows: ← → within a row, ↑ ↓ between rows.
  - The live region text; `aria-selected` on the selected card.
  - The overlay fades in over 180 ms over a dimmed, blurred wall. The wall stays mounted and inactive while search is open.
  - Visual polish within the Global Constraints, using `apple-design` / `emil-design-eng` as the house style; keep to the existing `app.css` tokens.
- [ ] **Step 5:** Run `npx vitest run`, `npm run typecheck` and `npm run test:e2e -- search wall nav title`. Expect PASS, including Task 4's updated wall test.
- [ ] **Step 6:** Commit `feat: Netflix-style search overlay`.

### Task 6: Docs

**Files:**
- Modify:
  - `docs/PROJECT_PLAN.md`: the search section (titles first, Enter opens the page, no episode titles, wide cards); the layout line `search/`.
  - `CLAUDE.md`: codebase map, `search/` replacing `SearchSoon`; the `i` key note in the wall gotcha if relevant.
  - `.claude/skills/netflix-search/SKILL.md`: Enter opens the page, not Play; back returns to search; no episode titles; the tiers and the number rule; `library.searchDocs`.
  - the design doc: an "As built" section.

- [ ] **Step 1:** Make the edits. Don't mark the milestone ✅ yet.
- [ ] **Step 2:** Run `npm run typecheck`, `npx vitest run` and the full `npm run test:e2e` (in halves if memory is tight). Expect all green.
- [ ] **Step 3:** Commit `docs: milestone 8 search as built`.
