---
name: netflix-search
description: The Netflix-style search overlay — open/close behaviour, layout (query bar, "Explore titles related to" chips, 16:9 result cards grid, empty and no-result states), Fuse.js index fields and weights, field-scoped queries, debouncing, keyboard grid navigation, accessibility and tests. Use for any work in src/renderer/search/* or search ranking/UX issues.
---

# Netflix-style search

## Opening and closing
- Code: `src/renderer/src/search/` (pure `query`, `rank`, `chips`, `rows`, `gridNav`; UI `SearchOverlay`, `SearchCard`, `useSearchDocs`). Data: `library.searchDocs` → `SearchDoc` (`WallItem` + originalTitle, top-5 cast, directors/creators, logoUrl, addedAt, lastPlayedAt, inProgress), built in `src/main/library/queries.ts`.
- Open with `/`, Ctrl+F, or by typing any printable character on the wall (that first character goes into the query); the wall's `i` key is a letter now, not the info card. The menu's Search opens it from anywhere (Home goes underneath). It's an overlay state in `App`, not a page.
- The overlay fades in over 180 ms over a dimmed, blurred wall, and the input takes focus.
- **Esc:** if the query isn't empty, clear it. If it's empty, close the overlay and return focus to the wall tile that was focused before.

## Layout (full screen, dark)
```
[🔍  query text…________________________]                      (top, 28–32px type)

Explore titles related to:  Christopher Nolan | Sci-Fi | Thriller | Michael Caine | 2010s

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ 16:9 │ │      │ │      │ │      │ │      │      grid: repeat(auto-fill, minmax(260px, 1fr)), gap 8px/24px
└──────┘ └──────┘ └──────┘ └──────┘ └──────┘
 title     title …
```
- **Cards:** TMDB backdrop at 16:9 with the title logo or the title in the lower-left. If there's no backdrop, use a blurred poster with the poster image on top. Show a resume progress bar if one applies.
- **The selected card** (the first result, until the user moves): scale 1.05 with a shadow and a ring, with year · runtime/"N seasons" · genres under it. Transforms only, 200 ms; reduced motion: no scale. No Play button on cards: search opens the title page.
- **Empty query** (under 2 letters/digits): "Continue watching" (movies in progress; shows partway through, meaning a half-watched episode or a finished episode with the next not started; most recently played first) and "Recently added" (newest files first), 12 each; empty rows hidden.
- **No results:** "Your search for “x” did not have any matches." Below it, give suggestions (try a different keyword, search by actor, director or genre) and a few genre chips from the library.
- Results update live. Don't flash between keystrokes: keep the previous results until new ones are ready (`useDeferredValue`).

## Index (Fuse.js)
```ts
new Fuse(docs, {
  keys: [
    { name: 'title', weight: 0.5 }, { name: 'originalTitle', weight: 0.15 },
    { name: 'cast', weight: 0.15 },   // top 5 billed
    { name: 'directors', weight: 0.1 }, { name: 'genres', weight: 0.05 }, { name: 'year', weight: 0.05 },
  ],
  threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2, includeScore: true,
});
```
- Search documents are built from SQLite, with accents folded on both the documents and the query. Use `normalizeTitle` from `src/shared/normalize.ts`.
- **Shows are documents too:** `title` = show name, `originalTitle` = original name, `cast` = top-billed `show_credits` cast, `directors` = the show's creators (`role = 'creator'`), `genres` from `tmdb_show_genres`, `year` = first-air year. Selecting a show result opens its show page.
- **Episode titles aren't searched** (user's decision).
- **Ranking tiers** (the user usually knows the title), then Fuse score: 0 exact title or original title; 1 starts with the query, also after a leading article (`the a an le la les l`); 2 a word starts with it; 3 everything else (fuzzy titles, people, genres). So "tom" puts *Tomb Raider* above Tom Hanks films.
- **4-digit numbers** (1900–2099) are title text **and** a year: tier 0–2 text matches, then that year's titles matching the rest ("matrix 1999"), then loose text matches. "1917" and "2049" find those films. A decade chip (`2010s`) filters 2010–2019.
- **Field-scoped queries** come from chip clicks: `genre:Comedy`, `cast:"Tom Hanks"`, `director:"Christopher Nolan"` (creators for shows). Not fuzzy: the folded value must be the whole name or whole words of it (`director:nolan` works, `genre:dram` doesn't).
- Rebuild the index when the library changes. If the library has more than 5,000 movies, move searching into a Web Worker.
- Debounce input by 120 ms. Searching a few hundred items takes under 2 ms, so the debounce is only there to keep rendering calm.

## Related chips
From the top 12 results, count genres, directors and top-3 cast members, plus the decade. Show the 5 most frequent, skipping any that equal the query itself. Clicking a chip replaces the query with the scoped form and keeps focus in the input.

## Keyboard
| Key | Action |
|---|---|
| ↓ in the input | First chip row, then the first card |
| Arrows in the grid | Move by cell. The column count comes from the computed grid (`getComputedStyle(grid).gridTemplateColumns`), read on resize only. |
| ↑ from the first grid row | Back to the chips, then the input |
| Enter | Opens the selected card's **title page** (never plays). In the box it acts on the results for the text typed now, not the debounced ones. Back from that page returns to search with the same query and selection. |
| Typing any character while a card is focused | Focus returns to the input and the character is appended |

## Accessibility
- The input has `role="searchbox"` and `aria-controls` pointing at the grid.
- A polite live region announces "12 results" after the debounce.
- Cards are `role="option"` in a `role="listbox"` grid, with `aria-selected` and `aria-label="Title (Year)"`. The focus ring is visible on top of the scale effect.

## Tests
- **Unit:** ranking cases such as "inception" → Inception first, "nolan" → his films, "1999" filtering, accent folding ("amelie" → Amélie), and scoped chips.
- **E2E:** press `/`, type, check that the expected card appears; Enter opens the title page and back returns to search; Esc twice returns to the wall with the same tile focused.
