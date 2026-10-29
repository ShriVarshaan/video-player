# Milestone 2 — Library: design

Date: 2026-10-29 · Status: draft, awaiting approval

## Intent

Turn the user's folders of **movies and TV shows** into a local, browsable library: find every video file, read its technical details, work out what it is from its filename, fetch artwork and details from TMDB, and keep all of it cached on this machine. Milestone 3 (the wall), 4 (playback and the show page) and 8 (search) all read from what this milestone stores.

Why now: nothing visible can be built until the library has data. TV shows were added to the project's scope in this milestone's design conversation.

## Goals

1. The user adds and removes library folders (folder picker). Folders are scanned on add, on startup and on demand, and watched for changes while the app runs.
2. Each video file gets: a row in the database, ffprobe details (duration, codec, resolution, HDR), a parsed title/year (movies) or show/season/episode (TV).
3. Movies match to TMDB movies; episode files group into shows, matched to TMDB TV shows with season and episode details.
4. Posters, backdrops, title logos and episode stills are cached locally as downscaled WebP and served to the renderer through `poster://` URLs.
5. Anything unmatched or scanned offline gets a frame grabbed from the video as its image, and is retried for TMDB later.
6. The data a show page needs exists and is tested: seasons → episodes → which local file → watch progress → the main button state (rules below).
7. The placeholder screen gains: Add folder, a folder list, a TMDB key field with TMDB's credit line, scan progress, and plain lists of movies and shows (a show expands to its seasons and episodes) — enough to see the library working.

## Non-goals

- The wall, the real show page, playback (milestones 3–4). Watch progress is *read* here; mpv writes it in milestone 4.
- Fixing a wrong TMDB match by hand, or refreshing cached TMDB data (later; `match_status = 'manual'` is reserved for it).
- Anime absolute episode numbering, daily shows (`Show.2024.05.01`), joining multi-part films (`CD1`/`CD2` are separate items).
- Metadata in languages other than English.

## Anti-goals

- **Writing anything into the user's movie folders.** The app only reads them.
- Sending anything to TMDB other than a title and year to search, and TMDB ids to fetch. No file paths, no hashes.
- Calling the real TMDB API in tests.
- Losing watch progress or subtitle offsets when a drive is unplugged or a file is renamed.
- A frozen window during a big first scan.

## Constraints

- Builds on milestone 1: `node:sqlite` in the main process, typed IPC (`src/shared/api.ts`), AppError, `binaryPath()` for ffmpeg/ffprobe, userData at `%APPDATA%\video-player`.
- TMDB terms: show "This product uses the TMDB API but is not endorsed or certified by TMDB." wherever the key is entered (the TMDB logo joins it in the milestone 9 About screen).
- The user supplies their own TMDB key: a v3 API key or a v4 read access token.
- Tests follow `test-media-fixtures`: generated clips, the fake library names, `VP_TMDB_MODE=fixtures`.

## Approaches (decided)

**Where the library work runs — user picked A.**

| | A. Queue in the main process — **chosen** | B. Electron utility process |
|---|---|---|
| Isolation | Shares the main process | Fully separate |
| Complexity | One DB connection, plain function calls | Second DB connection, message passing, crash/restart |
| Risk | Brief stutter on a huge first scan | None for the window |

Why A: the heavy work already runs outside Node (ffprobe/ffmpeg child processes, network). What stays in main is small batched DB writes. Moving to B later doesn't change the DB or the IPC API.

## Show page rules (decided with the user)

These are implemented here as a tested function; the page itself is milestone 4.

- The page lets you pick a season, then an episode.
- The main button follows "where you are" = **the most recently played episode**:
  - partway through it → **Continue watching** (resume) plus **Restart episode**;
  - finished it → **Play episode** on the next episode in order (next in the season, then the first of the next season);
  - nothing watched yet → **Play episode** on the first episode (lowest season ≥ 1, lowest episode).
- **Finished** = `completed = 1`, or position ≥ 95 % of duration.
- **Specials** (season 0) appear in the season list but are skipped when finding the next episode.
- After the final episode is finished → **Play episode** on the first episode again.
- Only episodes that exist as local files are candidates for "next". Each episode keeps its own resume point.

## Decisions

### Schema — migration 2

Migration 1 was movie-only. Migration 2 makes the file table hold both kinds and adds TV metadata:

```sql
ALTER TABLE movies RENAME TO videos;
ALTER TABLE playback_state      RENAME COLUMN movie_id TO video_id;
ALTER TABLE subtitle_transforms RENAME COLUMN movie_id TO video_id;
DROP INDEX movies_folder; DROP INDEX movies_tmdb; DROP INDEX movies_hash;
CREATE INDEX videos_folder ON videos(folder_id);
CREATE INDEX videos_tmdb   ON videos(tmdb_id);
CREATE INDEX videos_hash   ON videos(quick_hash);

CREATE TABLE tmdb_shows (
  tmdb_id         INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  original_name   TEXT,
  first_air_year  INTEGER,
  overview        TEXT,
  rating          REAL,
  poster_path     TEXT,
  backdrop_path   TEXT,
  logo_path       TEXT,
  fetched_at      INTEGER NOT NULL
);
CREATE TABLE tmdb_seasons (
  show_tmdb_id  INTEGER NOT NULL REFERENCES tmdb_shows(tmdb_id) ON DELETE CASCADE,
  season        INTEGER NOT NULL,
  name          TEXT,
  poster_path   TEXT,
  PRIMARY KEY (show_tmdb_id, season)
);
CREATE TABLE tmdb_episodes (
  show_tmdb_id  INTEGER NOT NULL REFERENCES tmdb_shows(tmdb_id) ON DELETE CASCADE,
  season        INTEGER NOT NULL,
  episode       INTEGER NOT NULL,
  name          TEXT,
  overview      TEXT,
  air_date      TEXT,
  runtime_min   INTEGER,
  still_path    TEXT,
  PRIMARY KEY (show_tmdb_id, season, episode)
);
CREATE TABLE tmdb_show_genres (
  show_tmdb_id  INTEGER NOT NULL REFERENCES tmdb_shows(tmdb_id) ON DELETE CASCADE,
  genre_id      INTEGER NOT NULL REFERENCES genres(id),
  PRIMARY KEY (show_tmdb_id, genre_id)
);
CREATE TABLE show_credits (
  show_tmdb_id  INTEGER NOT NULL REFERENCES tmdb_shows(tmdb_id) ON DELETE CASCADE,
  person_id     INTEGER NOT NULL REFERENCES people(id),
  role          TEXT NOT NULL CHECK (role IN ('cast','creator')),
  character     TEXT,
  ord           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (show_tmdb_id, person_id, role)
);

-- What a file is. Movies use videos.tmdb_id; episodes use show_tmdb_id + season/episode.
ALTER TABLE videos ADD COLUMN kind TEXT NOT NULL DEFAULT 'movie' CHECK (kind IN ('movie','episode'));
ALTER TABLE videos ADD COLUMN parsed_show TEXT;          -- normalized show name, groups unmatched episodes
ALTER TABLE videos ADD COLUMN season INTEGER;
ALTER TABLE videos ADD COLUMN episode INTEGER;
ALTER TABLE videos ADD COLUMN episode_end INTEGER;       -- S01E01-E02 files
ALTER TABLE videos ADD COLUMN show_tmdb_id INTEGER REFERENCES tmdb_shows(tmdb_id) ON DELETE SET NULL;
ALTER TABLE videos ADD COLUMN match_tried_at INTEGER;    -- last TMDB attempt, for retry
CREATE INDEX videos_show ON videos(show_tmdb_id, season, episode);

-- Image cache, keyed by what the image is rather than by file (shows aren't files).
DROP TABLE images;
CREATE TABLE images (
  key         TEXT PRIMARY KEY,    -- 'tmdb:<size><path>' or 'frame:<videoId>'
  file        TEXT NOT NULL,       -- relative to userData/cache/images
  width       INTEGER,
  height      INTEGER,
  source      TEXT NOT NULL CHECK (source IN ('tmdb','ffmpeg')),
  created_at  INTEGER NOT NULL
);
```

`match_status` keeps its meaning for both kinds. Genres share one table (TMDB's TV genre ids don't clash with movie ids).

### Finding and reading files (`src/main/library/`)

- **Video extensions:** mkv, mp4, m4v, avi, mov, webm, wmv, mpg, mpeg, ts, m2ts, flv, ogv, 3gp.
- **Skipped:** hidden and system folders (`$RECYCLE.BIN`, `System Volume Information`, dot-folders); folders named Extras, Featurettes, Behind The Scenes, Deleted Scenes, Trailers, Samples, Sample (any case); files with a `sample` word in the name.
- **Walk:** `fs.promises.readdir(dir, { recursive: true, withFileTypes: true })`.
- **Change detection:** a file whose (path, size, mtime) matches its row is skipped. New or changed files get `quick_hash` (SHA-1 of size + first 64 KB + last 64 KB), then ffprobe.
- **Renames:** a new path whose `quick_hash` matches a row that has gone missing takes over that row (keeps progress and offsets).
- **Gone files:** `missing_since = now`. A folder that is offline (drive unplugged) marks all its rows missing and is shown as offline; rows come back when it returns.
- **ffprobe:** `ffprobe -v error -print_format json -show_format -show_streams <file>`, 30 s timeout. Stores duration, container, video codec, width, height, `hdr` (transfer `smpte2084` or `arib-std-b67`) and the full JSON.
- **wall_key:** FNV-1a 32-bit of `quick_hash`, so order survives renames (infinite-wall).

### Filename parsing

`parse-torrent-title` (npm) does the heavy lifting; our rules on top:

- **Episode** if the name has `S01E02`, `S01E02-E03`/`S01E02E03` (→ `episode_end`), `1x02`, or the folder layout `<Show>/Season 1/02 - Title.mkv` (episode number at the start of the name inside a `Season N` / `S01` folder).
- **Show name:** from the filename; if empty, from the nearest parent folder that isn't `Season N`, `S01` or `Specials` (`Specials` → season 0).
- **Movie** otherwise: title + year from the filename; if the title is empty or generic (`movie`, `video`, a bare number), use the parent folder name (`Amélie (2001)/movie.mkv`).
- Names are normalized for grouping and matching: accents folded (`NFKD` + strip marks), lowercase, `&` → `and`, punctuation removed.

### TMDB (`src/main/metadata/`)

- **Credential:** `metadata.setTmdbKey` checks it with one TMDB request, then stores it encrypted with Electron `safeStorage` (DPAPI) as base64 in `settings` under `tmdb.credential`. It is never sent back to the renderer. A token starting `eyJ` is a v4 bearer token; anything else is a v3 `api_key` query parameter.
- **Language:** `en-US`. Image language `en,null`.
- **Movies:** `search/movie?query=&year=` (retry without year if nothing); pick the best result by score — normalized title similarity, +bonus for exact year (±1 allowed), popularity as tie-break. Below the threshold → `unmatched`. Then `movie/{id}?append_to_response=credits,images`. Keep top 10 cast and every Director.
- **Shows:** episode files are grouped by `parsed_show` (+ year if present); one `search/tv` per group, same scoring on `name`/`first_air_date`. Then `tv/{id}?append_to_response=credits,images` and `tv/{id}/season/{n}` for every season that has local files. Keep top 10 cast and `created_by` as creators.
- **Concurrency and limits:** 4 requests at a time; on 429 wait for `Retry-After`. Network errors leave `match_status = 'pending'` with `match_tried_at` set; pending items are retried on the next startup or rescan.
- **Cached records are not refetched** in this milestone.
- **Fixtures:** with `VP_TMDB_MODE=fixtures`, the client reads `tests/fixtures/tmdb/<path with / → _>.json` instead of the network (test-media-fixtures).

### Images (`src/main/images/`)

- Download sizes: posters `w500`, backdrops `w1280`, logos `w500`, stills `w300`.
- Convert with ffmpeg to WebP (`libwebp`, quality 80; alpha kept for logos): posters and stills 400 px wide, backdrops 1280, logos 500. Saved as `userData/cache/images/<sha1(key)>.webp`.
- **Frame fallback:** `ffmpeg -ss <10 % of duration> -i <file> -frames:v 1 -vf scale=400:-2` → WebP, key `frame:<videoId>`. Used for unmatched or not-yet-matched movies, and for episodes with no TMDB still.
- **`poster://` protocol** (registered privileged, handled with `protocol.handle`): `poster://<type>/<owner>/<id>` where type ∈ `poster | backdrop | logo | still` and owner ∈ `video | show`. Examples: `poster://poster/video/12`, `poster://poster/show/1396`, `poster://still/video/57`. Missing → 404, and the renderer draws its own tile (infinite-wall). `infinite-wall`'s `poster://<movieId>` line is updated to this form.

### Work queue (`src/main/library/queue.ts`)

Separate concurrency limits: ffprobe 4, TMDB 4, image conversion 2. DB writes are batched in transactions of up to 50 rows. Progress is pushed to the renderer at most 5 times a second.

### IPC additions

New domains in `API`:

- `library.addFolder({})` → opens the folder picker in main → `LibraryFolder | null`
- `library.removeFolder({ id })`, `library.listFolders({})` → `LibraryFolder[]` (`id, path, online, videoCount, lastScanAt`)
- `library.rescan({})`
- `library.list({})` → `{ movies: MovieItem[], shows: ShowItem[] }`
- `library.getShow({ key })` → seasons → episodes (with local `videoId` or null, title, still URL, progress) plus `nextUp: { action: 'play' | 'continue', videoId, positionS }`. `key` is `tmdb:<id>`, or `local:<parsed_show>` for a show TMDB couldn't match.
- `metadata.setTmdbKey({ key })` (AppError `tmdb_key_invalid`), `metadata.status({})` → `{ hasKey, pending, unmatched }`

Main → renderer **events** (new): `library.progress` `{ phase: 'scanning' | 'probing' | 'matching' | 'images' | 'idle', done, total }` and `library.changed` `{}`. Typed in `src/shared/api.ts` as `ApiEvents`; the preload exposes `window.api.on(event, callback)` returning an unsubscribe function.

### Placeholder screen

Add folder · folder list (path, offline badge, remove) · TMDB key field + credit line · progress line ("Matching 12 of 340") · Movies list (poster thumbnail, title, year) · Shows list (poster, name, episode count); clicking a show lists seasons and episodes and shows the main button label from `nextUp`. Plain styling — it is replaced in milestones 3–4.

### Doc and skill updates (same commits as the code)

- `docs/PROJECT_PLAN.md`: TV shows in Context and Architecture; milestone 2 row mentions shows; show page added to milestone 4.
- `infinite-wall`: one tile per movie and per show; new `poster://` form.
- `netflix-search`: documents include shows (name, creators, cast, genres, first-air year).
- `mpv-ipc`: resume and `completed` are per video, including episodes.

### Tests

- **Vitest:** filename parsing table (fixture names plus TV patterns, folder-derived names, skipped names); migration 2 on a v1 database with data (rows and progress survive the rename); scanner on a temp folder with fake probe (new, unchanged, changed, renamed, deleted, offline folder); quick hash; TMDB scoring and the fixtures client; image keys and `poster://` URL parsing; show-page rules (every bullet above); queue concurrency limits; key storage never returned by any API.
- **Integration (real binaries):** ffprobe and frame grab on a generated clip (`scripts/make-fixtures.mjs`, per test-media-fixtures).
- **E2E:** stub the folder dialog, add the fixture library with `VP_TMDB_MODE=fixtures`; movies and shows appear with images; a show lists its episodes; removing the folder clears the lists.

## Calls I made (check these)

- Removing a folder deletes its rows, **including watch progress** for those files. An unplugged drive does not (rows go `missing`).
- Metadata is English only for now.
- Show grouping uses the parsed show name; two different shows with the same name and no year would merge until manual matching exists.
- No file-size rule for samples (test clips are tiny); only names and folder names.
- Two files for the same episode or film (say 720p and 1080p): both are kept as rows; lists and the show page use the larger file.
- List items carry ready-made image URLs from main. A show TMDB couldn't match uses its first episode's frame as its poster.
- Removing a folder asks for confirmation on the screen first (in-page, not a browser dialog), because it deletes progress.
- If Windows can't encrypt (`safeStorage.isEncryptionAvailable()` false), saving the TMDB key fails with AppError `tmdb_storage_unavailable` instead of storing it in plain text.

## Left to the builder

- The exact match-score formula and threshold (tune on the fixture names; record the values).
- How `parse-torrent-title` 3.x behaves on the fixture names — wrap it so it can be replaced.
- Whether `fs.watch` recursive reports enough on network drives; if not, document that rescans cover them.
