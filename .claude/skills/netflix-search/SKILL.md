---
name: netflix-search
description: The Netflix-style search overlay — open/close behaviour, layout (query bar, "Explore titles related to" chips, 16:9 result cards grid, empty and no-result states), Fuse.js index fields and weights, field-scoped queries, debouncing, keyboard grid navigation, accessibility and tests. Use for any work in src/renderer/search/* or search ranking/UX issues.
---

# Netflix-style search

## Opening and closing
- Open with `/`, Ctrl+F, or by typing any printable character on the wall (that first character goes into the query).
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
- **Card focus/hover:** after 300 ms, scale to 1.06 with a shadow, and show year · runtime · genres plus Play and More Info. Use a 200 ms spring, transforms only.
- **Empty query:** show "Recently added" and "Continue watching" rows instead of the grid.
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
- Search documents are built from SQLite, with accents folded (`normalize('NFKD')` + strip marks) on both the documents and the query.
- **4-digit year in the query** (`1999`): filter to that year, and fuzzy-match the rest of the query.
- **Field-scoped queries** come from chip clicks: `genre:Comedy`, `cast:"Tom Hanks"`, `director:Nolan`. These use an exact filter, not fuzzy matching.
- Within a score band of ±0.02, rank titles that start with the query first.
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
| Enter | Play. Shift+Enter opens More Info. |
| Typing any character while a card is focused | Focus returns to the input and the character is appended |

## Accessibility
- The input has `role="searchbox"` and `aria-controls` pointing at the grid.
- A polite live region announces "12 results" after the debounce.
- Cards are buttons with `aria-label="Title (Year)"`. The focus ring is visible on top of the scale effect.

## Tests
- **Unit:** ranking cases such as "inception" → Inception first, "nolan" → his films, "1999" filtering, accent folding ("amelie" → Amélie), and scoped chips.
- **E2E:** press `/`, type, check that the expected card appears; ↓ then Enter starts playback; Esc twice returns to the wall with the same tile focused.
