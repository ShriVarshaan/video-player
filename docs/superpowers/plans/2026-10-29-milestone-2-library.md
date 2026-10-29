# Milestone 2 — Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan, watch, parse and TMDB-match the user's movie and TV folders into the local DB, cache artwork as WebP behind `poster://`, and show it on the placeholder screen.

**Architecture:** Pure modules (parsing, scoring, show progress, URL parsing) are unit-tested alone. Side-effect modules (scanner, TMDB client, image cache) take their I/O as injected deps. A `Library` service in the main process ties them together with concurrency limiters, and the existing typed IPC plus a new typed event channel connect it to the screen.

**Tech Stack:** Electron 45, `node:sqlite`, `parse-torrent-title@3`, vendor ffmpeg/ffprobe (LGPL, has `libwebp`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-milestone-2-library-design.md`

## Global Constraints

- Never write into library folders; they are read-only to the app.
- TMDB receives only title/year searches and TMDB ids — never paths or hashes. Tests never call the real API (`VP_TMDB_MODE=fixtures`).
- TMDB credential: encrypted with `safeStorage` (base64) in `settings` key `tmdb.credential`; never returned over IPC; `eyJ…` → `Authorization: Bearer`, else `api_key` query param. Not encryptable → AppError `tmdb_storage_unavailable`.
- Language `en-US`, image language `en,null`.
- Concurrency: ffprobe 4, TMDB 4, image conversion 2. DB writes batched ≤ 50 rows per transaction. Progress events ≤ 5/s.
- Finished episode = `completed = 1` or position ≥ 95 % of duration.
- Images: WebP q80 — posters/stills 400 px wide, backdrops 1280, logos 500; files `userData/cache/images/<sha1(key)>.webp`; keys `tmdb:<size><path>` / `frame:<videoId>`.
- `poster://<poster|backdrop|logo|still>/<video|show>/<id>`; unknown → 404.
- Video extensions: mkv mp4 m4v avi mov webm wmv mpg mpeg ts m2ts flv ogv 3gp.
- TMDB credit line, verbatim: `This product uses the TMDB API but is not endorsed or certified by TMDB.`
- Commit after each task on branch `milestone-2-library`; push `main` only after the whole milestone passes (standing permission).

## Review Focus

1. **A corrupt or truncated video** (`truncated.mp4`) → the scan records it (probe fields null) and carries on; no crash, the rest of the folder is scanned. Test in Task 4.
2. **A library folder on an unplugged drive** → its rows get `missing_since`, the folder shows `online: false`, nothing is deleted; when it returns the rows come back with progress intact. Test in Task 4.
3. **TMDB unreachable or rate-limited (429)** → items stay `pending` with `match_tried_at`, no crash, retried on the next rescan; 429 waits `Retry-After`. Test in Task 5.
4. **The renderer asking for the TMDB key** via `settings.get('tmdb.credential')` → refused with `invalid_argument`; no IPC returns the key. Test in Task 5.
5. **A rescan requested while one is running** (watcher firing during the startup scan) → runs once more after the current one, never two at once. Test in Task 8.

---

### Task 1: Migration 2 — videos, TV tables, image cache

**Files:**
- Modify: `src/main/db/migrations.ts` (append migration 2 — SQL from the spec, verbatim)
- Test: `tests/unit/db.test.ts` (update table list), `tests/unit/migration2.test.ts`

**Interfaces:**
- Produces: tables `videos` (with `kind, parsed_show, season, episode, episode_end, show_tmdb_id, match_tried_at`), `tmdb_shows, tmdb_seasons, tmdb_episodes, tmdb_show_genres, show_credits`, new `images(key PK, file, width, height, source, created_at)`; `playback_state.video_id`, `subtitle_transforms.video_id`. `migrations.length === 2`.

- [ ] **Step 1: Failing tests.** `db.test.ts`: TABLES list becomes `credits, genres, images, library_folders, people, playback_state, settings, show_credits, subtitle_transforms, tmdb_episodes, tmdb_movie_genres, tmdb_movies, tmdb_seasons, tmdb_show_genres, tmdb_shows, videos`; seed helpers use `videos`/`video_id`; `images` CHECK test now inserts `source = 'web'` and expects the CHECK error. `migration2.test.ts`: open a file DB with `openDb(file, [migrations[0]!])`, insert a folder, movie, playback_state (position 120) and subtitle_transform; reopen with all migrations → `schemaVersion === 2`, `SELECT kind, parsed_title FROM videos` → `{kind:'movie', parsed_title:'The Matrix'}`, `SELECT video_id, position_s FROM playback_state` → `{video_id:10, position_s:120}`; `PRAGMA foreign_key_check` returns no rows; deleting the folder still cascades to playback_state; inserting `videos.kind = 'clip'` fails CHECK.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Append migration 2.
- [ ] **Step 4:** `npm test` → PASS (all files).
- [ ] **Step 5:** Commit `feat: migration 2 adds TV shows and renames movies to videos`.

### Task 2: Filename parsing

**Files:**
- Create: `src/main/library/parseName.ts`, `src/shared/normalize.ts`
- Test: `tests/unit/parseName.test.ts`, `tests/unit/normalize.test.ts`
- `npm i parse-torrent-title@3` (runtime dependency)

**Interfaces:**
- Produces:
  ```ts
  // src/shared/normalize.ts — also used by search later
  export function normalizeTitle(s: string): string // NFKD, strip marks, lowercase, & → and, non-alphanumerics → single space, trimmed
  // src/main/library/parseName.ts
  export type ParsedVideo =
    | { kind: 'movie'; title: string; year: number | null }
    | { kind: 'episode'; show: string; year: number | null; season: number; episode: number; episodeEnd: number | null }
  export const VIDEO_EXTENSIONS: ReadonlySet<string> // '.mkv', … (lowercase, with dot)
  export function isVideoFile(name: string): boolean
  export function parseVideoPath(relativePath: string): ParsedVideo | null // null = skipped; accepts / or \ separators
  ```

- [ ] **Step 1: Failing tests.** `normalizeTitle('Amélie & Co.: The—Movie!')` → `'amelie and co the movie'`. `parseName.test.ts` as an `it.each` table:

  | path | expected |
  |---|---|
  | `The.Matrix.1999.1080p.BluRay.x264.mkv` | movie `The Matrix` 1999 |
  | `Amélie (2001).mp4` | movie `Amélie` 2001 |
  | `inception_2010_720p.webm` | movie `inception` 2010 |
  | `Some Unknown Home Video.avi` | movie `Some Unknown Home Video` null |
  | `Amélie (2001)/movie.mkv` | movie `Amélie` 2001 (folder fallback) |
  | `Breaking.Bad.S02E05.720p.mkv` | episode `Breaking Bad` s2 e5 end null |
  | `the.office.us.s03e01-e02.mkv` | episode `the office us` s3 e1 end 2 |
  | `The.Office.S03E01E02.mkv` | episode s3 e1 end 2 |
  | `Show Name - 1x02 - Title.avi` | episode `Show Name` s1 e2 |
  | `Doctor.Who.2005.S01E01.mkv` | episode `Doctor Who` year 2005 s1 e1 |
  | `Breaking Bad/Season 1/02 - Cat's in the Bag.mkv` | episode `Breaking Bad` s1 e2 |
  | `Breaking Bad/S01/S01E03.mkv` | episode `Breaking Bad` s1 e3 (show from folder) |
  | `Breaking Bad/Specials/01 - Pilot Extended.mkv` | episode `Breaking Bad` s0 e1 |
  | `The.Matrix.1999.sample.mkv`, `Movie/Sample/x.mkv`, `Movie (2001)/Extras/Making Of.mkv`, `Featurettes/a.mkv`, `Behind The Scenes/b.mkv` | null |

  `isVideoFile('A.MKV')` true, `isVideoFile('a.srt')` false, `isVideoFile('a.ts')` true.
- [ ] **Step 2:** `npm test -- parseName normalize` → FAIL.
- [ ] **Step 3:** Implement; wrap `parse-torrent-title` in this file only. Multi-episode: regex `/s(\d{1,2})e(\d{1,3})(?:-?e(\d{1,3}))/i`. Folder-numbered: inside a `Season N`/`S01`/`Specials` folder, a leading `^(\d{1,3})\b` is the episode. Generic titles: `movie`, `video`, `film`, a bare number.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: parse movie and episode names from paths`.

### Task 3: Media tools and fixtures

**Files:**
- Create: `scripts/make-fixtures.mjs`, `src/main/media/probe.ts`, `src/main/media/quickHash.ts`, `src/main/media/ffmpeg.ts`
- Test: `tests/unit/media.test.ts` (integration: real vendor binaries; skipped with a clear message if `vendor/ffmpeg/ffmpeg.exe` is missing)

**Interfaces:**
- Produces:
  ```ts
  // probe.ts
  export type ProbeResult = { durationS: number | null; container: string | null; videoCodec: string | null;
    width: number | null; height: number | null; hdr: boolean; json: string }
  export function parseProbeJson(json: string): ProbeResult           // pure
  export function probe(ffprobePath: string, file: string): Promise<ProbeResult> // 30 s timeout; rejects on failure
  // quickHash.ts
  export function quickHash(file: string, size: number): Promise<string> // sha1 hex of size + first 64 KB + last 64 KB
  // ffmpeg.ts
  export function grabFrame(ffmpegPath: string, input: string, atS: number, output: string, width: number): Promise<void>
  export function toWebp(ffmpegPath: string, input: string, output: string, width: number): Promise<void> // q80, keeps alpha
  ```
- `make-fixtures.mjs` writes (only missing files) into `tests/fixtures/media/`: `h264_like.mp4` (mpeg4 video + aac, 20 s, 640×360 — LGPL has no x264), `webm_vp9_opus.webm`, `xvid_mp3.avi` (falls back to aac if no mp3 encoder), `truncated.mp4` (30 % of the mp4); and `tests/fixtures/library/` with hard links/copies: `The.Matrix.1999.1080p.BluRay.x264.mkv` (remux of the mp4), `Amélie (2001).mp4`, `inception_2010_720p.webm`, `Some Unknown Home Video.avi`, `Breaking Bad/Season 1/Breaking.Bad.S01E01.mkv`, `…S01E02.mkv`, `Breaking Bad/Season 2/Breaking.Bad.S02E01.mkv`, `The.Matrix.1999.sample.mkv`. Also `tests/fixtures/tmdb/image.png` is committed (a 500×750 PNG generated once by this script if absent).

- [ ] **Step 1: Failing tests.** `parseProbeJson` on an inline sample (format_name `matroska,webm`, stream codec `hevc`, 3840×2160, `color_transfer: 'smpte2084'`, duration `"5400.5"`) → `{durationS: 5400.5, container: 'matroska,webm', videoCodec: 'hevc', width: 3840, height: 2160, hdr: true}`; no video stream → nulls and `hdr: false`. Integration (`beforeAll` runs `make-fixtures`): `probe(…, 'h264_like.mp4')` → durationS ≈ 20 (±0.5), width 640; `probe(…, 'truncated.mp4')` rejects or returns null duration — never hangs (test timeout 35 s); `quickHash` of the same file twice is equal, of the webm differs, and a copy with one changed byte in the middle hashes the same (documented trade-off); `grabFrame` at 2 s then `toWebp` produce files starting with `RIFF` and containing `WEBP`, width 400 (probe them).
- [ ] **Step 2:** `npm test -- media` → FAIL.
- [ ] **Step 3:** Implement (use `execFile` with `windowsHide: true`, `timeout`).
- [ ] **Step 4:** `node scripts/make-fixtures.mjs` then `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: ffprobe, quick hash, frame and WebP helpers with fixture generator`.

### Task 4: Folder scanner

**Files:**
- Create: `src/main/library/scanner.ts`
- Test: `tests/unit/scanner.test.ts`

**Interfaces:**
- Consumes: `parseVideoPath`, `isVideoFile`, `normalizeTitle` (Task 2); `ProbeResult` (Task 3); `Db`, `tx` (M1).
- Produces:
  ```ts
  export type ScanDeps = { probe: (file: string) => Promise<ProbeResult>; quickHash: (file: string, size: number) => Promise<string>;
    now: () => number; limit: <T>(fn: () => Promise<T>) => Promise<T>; onProgress?: (done: number, total: number) => void }
  export type ScanResult = { added: number; updated: number; renamed: number; missing: number; unchanged: number;
    offline: boolean; failed: { path: string; error: string }[] }
  export function scanFolder(db: Db, folder: { id: number; path: string }, deps: ScanDeps): Promise<ScanResult>
  export function wallKey(quickHash: string): number // FNV-1a 32-bit, unsigned
  ```
- Row rules: insert with `kind`, `parsed_title` (movie title or show name as written), `parsed_year`, `parsed_show` (normalized show, episodes only), `season`, `episode`, `episode_end`, `match_status 'pending'`. A changed file (size or mtime) is re-probed and set back to `pending` only if its parse changed. A file that reappears clears `missing_since`.

- [ ] **Step 1: Failing tests** (temp dir with small dummy files written by the test; fake `probe` returns fixed `ProbeResult`, fake `quickHash` = sha1 of contents; `limit` = run directly):
  - first scan of `A.2001.mkv`, `Show/Season 1/Show.S01E01.mkv`, `notes.txt`, `A.2001.sample.mkv` → `added 2`; rows have `kind` movie/episode, `parsed_show 'show'`, season 1, episode 1, `wall_key === wallKey(hash)`.
  - second scan unchanged → `unchanged 2`, probe not called again.
  - rewrite `A.2001.mkv` with different content → `updated 1`, probe called once.
  - rename `A.2001.mkv` → `A (2001).mkv` with a `playback_state` row on it → `renamed 1`, same `id`, playback row intact, path updated.
  - delete the episode file → `missing 1`, row has `missing_since = now()`; restore it → `missing_since` null, same id.
  - **Review Focus 1:** `probe` rejects for `bad.mkv` → `failed` lists it, row exists with `duration_s` null, other files still added.
  - **Review Focus 2:** folder path doesn't exist → `offline: true`, every row of that folder gets `missing_since`, no rows deleted; scanning again after recreating the folder clears `missing_since` and keeps `playback_state`.
  - `wallKey('abc')` is stable and in `[0, 2^32)`.
- [ ] **Step 2:** `npm test -- scanner` → FAIL.
- [ ] **Step 3:** Implement. Skip directories `$RECYCLE.BIN`, `System Volume Information`, dot-dirs (parseVideoPath handles extras/samples). Write in `tx` batches of 50.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: incremental folder scanner with rename and offline handling`.

### Task 5: TMDB client, credential, matching scores

**Files:**
- Create: `src/main/metadata/tmdbClient.ts`, `src/main/metadata/credential.ts`, `src/main/metadata/score.ts`
- Modify: `src/shared/appError.ts` (codes `tmdb_key_invalid`, `tmdb_unavailable`, `tmdb_not_found`, `tmdb_storage_unavailable`), `src/main/settings.ts` (reject keys starting `tmdb.`)
- Create: `tests/fixtures/tmdb/*.json` (see Task 6 list)
- Test: `tests/unit/tmdbClient.test.ts`, `tests/unit/credential.test.ts`, `tests/unit/score.test.ts`, `tests/unit/settings.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // tmdbClient.ts
  export type TmdbClient = {
    get<T>(path: string, params?: Record<string, string | number>): Promise<T>
    image(size: string, tmdbPath: string, dest: string): Promise<void>
  }
  export function createTmdbClient(opts: { credential: () => string | null; mode: 'live' | 'fixtures';
    fixturesDir: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): TmdbClient
  export function fixtureName(path: string, params: Record<string, string | number>): string
  //   'search/movie', {query:'The Matrix', year:1999} → 'search_movie__query=the-matrix_year=1999.json'
  //   (path '/' → '_'; params sorted, api_key/language/include_image_language/append_to_response dropped; values normalizeTitle'd, spaces → '-')
  // credential.ts
  export type SafeStorageLike = { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }
  export function createCredentialStore(db: Db, safe: SafeStorageLike): { get(): string | null; set(key: string): void; has(): boolean }
  // score.ts
  export type Candidate = { id: number; title: string; year: number | null; popularity: number }
  export function pickBest(query: { title: string; year: number | null }, candidates: Candidate[]): Candidate | null
  ```
- Live mode: base `https://api.themoviedb.org/3/`, images `https://image.tmdb.org/t/p/<size><path>`; 401 → `tmdb_key_invalid`; 404 → `tmdb_not_found`; 429 → `sleep(Retry-After s, default 2)` then retry up to 3 times; network error/5xx → `tmdb_unavailable`. Fixtures mode: missing fixture → `tmdb_not_found`; credential `'invalid'` → `tmdb_key_invalid`; `image()` copies `tests/fixtures/tmdb/image.png`.

- [ ] **Step 1: Failing tests.**
  - client (fake `fetch` recording URLs): v3 key → URL has `api_key=abc&language=en-US`, no Authorization; `eyJx` → header `Authorization: Bearer eyJx`, no `api_key`; 401 → code `tmdb_key_invalid`; **Review Focus 3:** 429 with `Retry-After: 1` then 200 → resolves, `sleep` called with 1000; fetch throwing → `tmdb_unavailable`; fixtures mode reads `search_movie__query=the-matrix_year=1999.json`; `fixtureName` example above.
  - credential (fake safeStorage reversing strings): `set('k1')` then `get()` → `'k1'`; the `settings` row value is not `'k1'` and not containing it; `isEncryptionAvailable() false` → `set` throws `tmdb_storage_unavailable`.
  - **Review Focus 4:** `settings.get({key:'tmdb.credential'})` and `set` → `invalid_argument`.
  - score: query `The Matrix`/1999 with candidates `The Matrix Reloaded` 2003 (pop 50), `The Matrix` 1999 (pop 80), `The Matrix Resurrections` 2021 → id of 1999; `inception`/2010 vs `Inception` 2010 → match; `Amélie`/2001 vs `Amélie` 2001 → match (accent-folded); `Some Unknown Home Video`/null vs `Home` 2010 → null; `The Matrix`/1999 vs only `The Matrix` 2010 → null (year off > 1); `Breaking Bad`/null vs `Breaking Bad` 2008 → match (no year in query: no penalty).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. Score = title similarity (1 − Levenshtein/longer length on `normalizeTitle`) + 0.1 for year exact; year off by more than 1 → reject; threshold 0.8; tie → higher popularity. Record the formula as a comment.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: TMDB client, encrypted credential and match scoring`.

### Task 6: Matching and image cache

**Files:**
- Create: `src/main/metadata/match.ts`, `src/main/images/cache.ts`, `src/main/images/posterUrl.ts`
- Create fixtures `tests/fixtures/tmdb/`: `search_movie__query=the-matrix_year=1999.json`, `movie_603.json`, `search_movie__query=amelie_year=2001.json`, `movie_194.json`, `search_movie__query=inception_year=2010.json`, `movie_27205.json`, `search_movie__query=some-unknown-home-video.json` (`{"results":[]}`), `search_tv__query=breaking-bad.json`, `tv_1396.json`, `tv_1396_season_1.json`, `tv_1396_season_2.json` — real TMDB field names, trimmed (ids, titles, dates, popularity, poster/backdrop paths, `credits.cast` top 3, a Director, `created_by`, `images.logos` one `en` entry, episodes with `still_path`).
- Test: `tests/unit/match.test.ts`, `tests/unit/imageCache.test.ts`, `tests/unit/posterUrl.test.ts`

**Interfaces:**
- Consumes: `TmdbClient`, `pickBest` (Task 5); scanner rows (Task 4); `grabFrame`, `toWebp` (Task 3).
- Produces:
  ```ts
  // match.ts
  export function matchPending(db: Db, client: TmdbClient, opts: { now: () => number;
    limit: <T>(fn: () => Promise<T>) => Promise<T>; onProgress?: (done: number, total: number) => void }): Promise<{ matched: number; unmatched: number; failed: number }>
  // posterUrl.ts
  export type PosterRef = { type: 'poster' | 'backdrop' | 'logo' | 'still'; owner: 'video' | 'show'; id: number }
  export function parsePosterUrl(url: string): PosterRef | null
  export function posterUrl(ref: PosterRef): string
  // cache.ts
  export type ImageCache = {
    resolve(ref: PosterRef): Promise<string | null>   // absolute .webp path, creating it if needed; null = none
    prefetch(refs: PosterRef[]): Promise<void>
  }
  export function createImageCache(opts: { db: Db; dir: string; client: TmdbClient;
    toWebp: (input: string, output: string, width: number) => Promise<void>;
    grabFrame: (input: string, atS: number, output: string, width: number) => Promise<void>;
    limit: <T>(fn: () => Promise<T>) => Promise<T>; now: () => number }): ImageCache
  ```
- Resolution: video poster → its movie's `poster_path` (`w500`, 400 px) else `frame:<id>`; video still → its episode's `still_path` (`w300`, 400) else frame; show poster → `tmdb_shows.poster_path` (local shows use their first episode's video poster URL instead); backdrop `w1280` → 1280; logo `w500` → 500. Concurrent `resolve` of the same key shares one conversion. Frame at 10 % of `duration_s` (0 if null).

- [ ] **Step 1: Failing tests** (`openDb(':memory:')`, rows inserted like the scanner would, fixtures client):
  - match: Matrix, Amélie, Inception rows → `matched 3`, `videos.tmdb_id` 603/194/27205, `match_status 'matched'`, `tmdb_movies` rows, genres, top cast, Director credit, `logo_path` set; Home Video → `unmatched`; three Breaking Bad episode rows (s1e1, s1e2, s2e1) → all `show_tmdb_id 1396`, one search_tv request only, `tmdb_seasons` 1 and 2, `tmdb_episodes` rows with `still_path`, `show_credits` creator; client throwing `tmdb_unavailable` → rows stay `pending`, `match_tried_at` set, `failed` counted; an already-cached `tmdb_movies` 603 isn't fetched again (client spy).
  - posterUrl: round-trip `{type:'poster', owner:'video', id:12}` ↔ `'poster://poster/video/12'`; `parsePosterUrl('poster://poster/video/abc')`, `'poster://x/video/1'`, `'poster://poster/file/1'` → null.
  - cache (fake `toWebp`/`grabFrame` writing a marker file and recording width): matched movie poster → `toWebp` width 400, key `tmdb:w500/<path>` row in `images`, second `resolve` doesn't convert again; unmatched movie → `grabFrame` at `0.1 * duration`, key `frame:<id>`; show poster for 1396 → TMDB poster; backdrop → width 1280; two concurrent resolves of one ref → one conversion; client image failing → `null`, no `images` row.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. TV seasons fetched: those with local files plus nothing else.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: TMDB matching for movies and shows, WebP image cache`.

### Task 7: Show progress and library queries

**Files:**
- Create: `src/shared/library.ts` (types), `src/main/library/showProgress.ts`, `src/main/library/queries.ts`
- Test: `tests/unit/showProgress.test.ts`, `tests/unit/queries.test.ts`

**Interfaces:**
- Produces (`src/shared/library.ts`):
  ```ts
  export type LibraryFolder = { id: number; path: string; online: boolean; videoCount: number; lastScanAt: number | null }
  export type MovieItem = { videoId: number; title: string; year: number | null; posterUrl: string; matched: boolean }
  export type ShowItem = { key: string; name: string; year: number | null; posterUrl: string; episodeCount: number; matched: boolean }
  export type EpisodeItem = { season: number; episode: number; title: string | null; videoId: number;
    stillUrl: string; positionS: number; durationS: number | null; finished: boolean }
  export type NextUp = { action: 'play' | 'continue'; videoId: number; season: number; episode: number; positionS: number }
  export type ShowDetail = { key: string; name: string; overview: string | null;
    seasons: { season: number; name: string; episodes: EpisodeItem[] }[]; nextUp: NextUp | null }
  export type ScanProgress = { phase: 'scanning' | 'probing' | 'matching' | 'images' | 'idle'; done: number; total: number }
  export type MetadataStatus = { hasKey: boolean; pending: number; unmatched: number }
  ```
- Produces (main):
  ```ts
  // showProgress.ts
  export type ProgressEpisode = { videoId: number; season: number; episode: number; positionS: number;
    durationS: number | null; completed: boolean; lastPlayedAt: number | null }
  export function isFinished(e: Pick<ProgressEpisode, 'positionS' | 'durationS' | 'completed'>): boolean
  export function nextUp(episodes: ProgressEpisode[]): NextUp | null
  // queries.ts
  export function listLibrary(db: Db): { movies: MovieItem[]; shows: ShowItem[] }
  export function getShow(db: Db, key: string): ShowDetail | null   // key 'tmdb:<id>' | 'local:<parsed_show>'
  export function listFolders(db: Db, exists: (p: string) => boolean): LibraryFolder[]
  ```
- Queries exclude rows with `missing_since`. Duplicates (same movie tmdb id, or same show/season/episode) → keep the largest `size_bytes`. Sort: movies by title, shows by name. URLs from `posterUrl()`; unmatched show → `poster://poster/video/<firstEpisodeId>` (resolves to that episode's frame). Season name: TMDB name, else `Season N`, season 0 `Specials`.

- [ ] **Step 1: Failing tests.**
  - showProgress: nothing played → `{action:'play'}` on S01E01 even when S00E01 exists; last played S01E02 at 50 % → `continue` with its position; last played S01E02 at 96 % → `play` S01E03; `completed` true at 10 % → finished; last played is the last episode of S1 and S2 exists → `play` S02E01; last played is the final episode, finished → `play` S01E01; last played a special (S00E01) finished → `play` first unwatched-after rule: S01E01; gaps (local S01E01, S01E03) finished E01 → `play` S01E03; empty list → null; `durationS` null and not completed → not finished.
  - queries (seeded DB): movies list has Matrix title from TMDB `title`, year 1999, `posterUrl 'poster://poster/video/<id>'`, unmatched Home Video `matched false` with its parsed title; missing rows excluded; two files of 603 → one item, the larger; shows: Breaking Bad `key 'tmdb:1396'`, `episodeCount 3`; unmatched episodes of `my show` → `key 'local:my show'`; `getShow('tmdb:1396')` → seasons [1, 2] with names, episodes carry TMDB titles and `stillUrl 'poster://still/video/<id>'`, `nextUp` from playback rows; `getShow('nope')` → null; `listFolders` online flag from `exists`, `videoCount` excludes missing.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: show progress rules and library queries`.

### Task 8: Library service, IPC, events, protocol, watcher

**Files:**
- Create: `src/main/library/queue.ts`, `src/main/library/watcher.ts`, `src/main/library/service.ts`, `src/main/events.ts`
- Modify: `src/shared/api.ts` (domains `library`, `metadata`; `ApiEvents`; `eventChannel`), `src/preload/index.ts` (`on`), `src/preload/index.d.ts`, `src/main/index.ts` (wire service, `protocol.handle('poster')` with `registerSchemesAsPrivileged`, startup rescan, watchers, dialog)
- Test: `tests/unit/queue.test.ts`, `tests/unit/watcher.test.ts`, `tests/unit/service.test.ts`, `tests/unit/api.test.ts`

**Interfaces:**
- Produces (`src/shared/api.ts` additions):
  ```ts
  library: {
    addFolder: (params: Record<string, never>) => Promise<LibraryFolder | null>
    removeFolder: (params: { id: number }) => Promise<void>
    listFolders: (params: Record<string, never>) => Promise<LibraryFolder[]>
    rescan: (params: Record<string, never>) => Promise<void>
    list: (params: Record<string, never>) => Promise<{ movies: MovieItem[]; shows: ShowItem[] }>
    getShow: (params: { key: string }) => Promise<ShowDetail | null>
  }
  metadata: {
    setTmdbKey: (params: { key: string }) => Promise<void>
    status: (params: Record<string, never>) => Promise<MetadataStatus>
  }
  export type ApiEvents = { 'library.progress': ScanProgress; 'library.changed': Record<string, never> }
  export const eventChannel: (name: keyof ApiEvents) => string // 'vp:event.' + name
  // window.api gains: on<K extends keyof ApiEvents>(event: K, cb: (payload: ApiEvents[K]) => void): () => void
  ```
- `queue.ts`: `createLimiter(n: number): <T>(fn: () => Promise<T>) => Promise<T>`; `throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void` (trailing call kept).
- `watcher.ts`: `watchFolder(path: string, onChange: () => void, debounceMs = 2000): () => void` (fs.watch recursive; errors → stop silently).
- `service.ts`: `createLibraryService(deps: { db; scanDeps: Omit<ScanDeps,'onProgress'>; client: TmdbClient; images: ImageCache; credential: ReturnType<typeof createCredentialStore>; emit: <K extends keyof ApiEvents>(e: K, p: ApiEvents[K]) => void; exists: (p: string) => boolean; now: () => number; watch?: typeof watchFolder })` → `{ addFolderPath(path: string): Promise<LibraryFolder>; removeFolder(id: number): void; rescan(): Promise<void>; startWatching(): void; stopWatching(): void; metadataStatus(): MetadataStatus; setTmdbKey(key: string): Promise<void> }`. `rescan` = scan every folder → `matchPending` (skipped when no key) → `images.prefetch` (posters of all listed items) → `emit('library.changed')`. Single-flight: a call during a run sets "again" and returns the running promise's follow-up; never overlapping. `addFolderPath` of an existing path → `invalid_argument`; inserts, starts watching, triggers rescan without awaiting. `setTmdbKey` validates with `client.get('authentication')` (fixtures: file `authentication.json` `{success:true}`), stores, then rescan.

- [ ] **Step 1: Failing tests.**
  - queue: limiter(2) with 5 deferred tasks → at most 2 running at once, all resolve in order of completion; rejection propagates and frees a slot. throttle(…, 200) with fake timers: 10 calls → first immediately, last delivered once after 200 ms.
  - watcher (real temp dir, debounce 100): writing a file triggers `onChange` once within 3 s; after the returned stop, writes don't trigger.
  - service (memory DB, fake scanDeps, fixtures client, fake images, `emit` spy): `addFolderPath(tmp)` → folder listed, then `library.changed` emitted after the rescan finishes; same path again → `invalid_argument`; `removeFolder` deletes its videos; **Review Focus 5:** calling `rescan()` three times while the first is running → `scanFolder` runs exactly twice in total, never concurrently (deferred probe); progress events emitted with phases `scanning` → `matching` → `images` → `idle`; no credential → matching skipped, `metadataStatus().pending` counts episodes and movies; `setTmdbKey('invalid')` → `tmdb_key_invalid` and nothing stored.
  - api: `Object.keys(apiMethods.library)` = `['addFolder','removeFolder','listFolders','rescan','list','getShow']`; `eventChannel('library.changed') === 'vp:event.library.changed'`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement and wire `index.ts`: `protocol.registerSchemesAsPrivileged([{ scheme: 'poster', privileges: { standard: true, secure: true, supportFetchAPI: true } }])` before ready; `protocol.handle('poster', req => parsePosterUrl → images.resolve → net.fetch(pathToFileURL(file)) or 404)`; `addFolder` handler opens `dialog.showOpenDialog({ properties: ['openDirectory'] })`; credential uses `safeStorage`; client mode from `VP_TMDB_MODE` (`fixtures` → `fixturesDir = <project root>/tests/fixtures/tmdb`); after window creation: `startWatching()` and `rescan()` (not awaited).
- [ ] **Step 4:** `npm test` → PASS; `npm run typecheck`, `npm run build` clean.
- [ ] **Step 5:** Commit `feat: library service, IPC, events, poster protocol and folder watching`.

### Task 9: Placeholder screen and E2E

**Files:**
- Create: `src/renderer/src/Library.tsx`, `src/renderer/src/ShowView.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/app.css`
- Test: `tests/e2e/library.spec.ts`

**Interfaces:**
- Consumes: `window.api.library.*`, `window.api.metadata.*`, `window.api.on`.
- Copy: buttons `Add folder`, `Rescan`, `Remove`; confirmation `Remove this folder? Watch progress for its videos will be deleted.` with `Remove` / `Cancel`; TMDB field label `TMDB API key or read access token`, button `Save key`, the credit line verbatim; offline badge `Offline`; progress `Scanning 3 of 9` / `Matching …` / `Fetching images …` / hidden when idle; show detail main button `Play episode` / `Continue watching` + `Restart episode`, with `S1 · E2` beside it.
- test ids: `folder-row`, `movie-item`, `show-item`, `episode-item`, `next-up`.

- [ ] **Step 1: Failing E2E** (`VP_TMDB_MODE=fixtures` in launch `env`; `beforeAll` runs `node scripts/make-fixtures.mjs`; stub with `app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, libraryDir)`):
  - save key `test-key` → no error shown; click `Add folder` → one `folder-row` with the library path; within 20 s: 4 `movie-item`s with titles `Amélie`, `Inception`, `Some Unknown Home Video`, `The Matrix` (sample skipped); 1 `show-item` `Breaking Bad` with `3 episodes`.
  - every `movie-item img` has `naturalWidth === 400` (poster:// served — Matrix from TMDB fixture, Home Video from a frame).
  - click `Breaking Bad` → 2 seasons, 3 `episode-item`s, `next-up` text contains `Play episode` and `S1 · E1`.
  - `Remove` → confirm → no `movie-item`s.
- [ ] **Step 2:** `npm run test:e2e` → FAIL.
- [ ] **Step 3:** Implement the screen (subscribe to `library.changed` → reload lists; `library.progress` → progress line).
- [ ] **Step 4:** `npm run test:e2e` → PASS; screenshot the screen and look at it.
- [ ] **Step 5:** Commit `feat: library placeholder screen with folders, TMDB key and show view`.

### Task 10: Docs, skills, milestone verification

**Files:**
- Modify: `docs/PROJECT_PLAN.md` (TV shows in Context/Architecture/Library; show page in milestone 4; milestone 2 row mentions shows; status ✅), `.claude/skills/infinite-wall/SKILL.md` (tiles for movies and shows; `poster://poster/<video|show>/<id>`), `.claude/skills/netflix-search/SKILL.md` (shows in documents: name, creators, cast, genres, first-air year), `.claude/skills/mpv-ipc/SKILL.md` (resume/`completed` per video incl. episodes; finished = ≥ 95 %), `.claude/skills/test-media-fixtures/SKILL.md` (LGPL fallback clip names, TV fixture files, fixture naming rule)

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2:** `npm run typecheck && npm test && npm run test:e2e` → all pass.
- [ ] **Step 3:** Commit `docs: library milestone in plan and skills`.
