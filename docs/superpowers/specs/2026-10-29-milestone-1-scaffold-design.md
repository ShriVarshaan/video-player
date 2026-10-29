# Milestone 1 — Scaffold: design

Date: 2026-10-29 · Status: draft, awaiting approval

## Intent

Lay the foundation every later milestone builds on: a runnable Electron + React + TypeScript app, the pinned third-party binaries (mpv, ffmpeg/ffprobe), a local SQLite database with the **full** schema for the whole app, and a type-safe renderer ↔ main IPC layer. No user-facing features yet — the window shows a placeholder shell.

Why now: milestones 2–9 all need these four pieces, and getting the schema and IPC conventions right once avoids churn in every later milestone.

## Goals

1. `npm run dev` opens a window (electron-vite, HMR in the renderer).
2. `npm run fetch-vendor` downloads pinned mpv and LGPL ffmpeg builds into `vendor/`, verifying SHA-256; re-running is a no-op when already present.
3. On startup the app opens (or creates) `library.db` in the user's profile and migrates it to the latest schema.
4. A typed IPC layer: adding an endpoint touches one shared type plus one handler, and a channel-name mismatch is impossible by construction.
5. `npm test` (Vitest), `npm run typecheck` and `npm run test:e2e` (one Playwright-Electron smoke test) all pass.

## Non-goals

- No library scanning, TMDB calls, wall, playback, subtitles or search (milestones 2–8). Their tables exist; their code does not.
- No installer / electron-builder config (milestone 9).
- No Python sidecar (milestone 7).

## Anti-goals

- Any data leaving the machine, or being written next to the user's movies. The database is **local to the person**: one per Windows user profile.
- A native Node addon that must be rebuilt for Electron (the reason for `node:sqlite`, below).
- Channel names typed by hand in two places.

## Constraints

- Windows 11, system Node 24.12, npm 11. Electron 45 (bundles Node 24.22).
- `vendor/` stays gitignored; `vendor/manifest.json` is committed (`.gitignore` gets `vendor/*` + `!vendor/manifest.json`).
- Downloaded archives are untrusted: extract to a fresh empty temp directory, run nothing from inside it, then move the needed files into `vendor/`.
- Follow `release-windows` §1–2 for vendor and binary-path resolution, and `electron-skills` for IPC.

## Approaches (decided)

**SQLite library — user picked A.**

| | A. `node:sqlite` (built in) — **chosen** | B. `better-sqlite3` |
|---|---|---|
| Build | Nothing to compile | Native addon; rebuild for Electron ABI and a separate build for Vitest |
| Tests vs app | Same engine (Node 24 both) | Two binaries, classic ABI-mismatch failures |
| Packaging | Nothing extra | `asarUnpack` + rebuild in CI |
| API | Newer, minimal (no `transaction()` helper) | Mature, richer |

Why A: the app's DB load is small, and A removes the most common Windows build failure. We add a ~20-line wrapper for transactions. `PROJECT_PLAN.md` and `release-windows` are updated to say `node:sqlite`.

## Decisions

### Project setup
- electron-vite 6 + Vite 8, React 19, TypeScript (strict), `@vitejs/plugin-react`.
- Layout as in `PROJECT_PLAN.md`: `src/main`, `src/preload`, `src/renderer`, `src/shared`, `scripts/`, `tests/{unit,e2e}`.
- Renderer security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict CSP meta tag.
- Scripts: `dev`, `build`, `typecheck`, `test`, `test:e2e`, `fetch-vendor`.

### Vendor binaries
- `vendor/manifest.json`: for each of `mpv` and `ffmpeg`, a `url`, `version`, `sha256`, and `files` (archive-relative paths to keep, e.g. `mpv.exe` + DLLs; `bin/ffmpeg.exe`, `bin/ffprobe.exe` + DLLs).
- Sources per `release-windows`: shinchiro `mpv-winbuild-cmake` plain `x86_64` `.7z`; BtbN `FFmpeg-Builds` win64 **LGPL shared** `.zip`, pinned to a dated autobuild.
- Extraction via the `7zip-bin` package (handles both `.7z` and `.zip`; Windows has no built-in 7z).
- Output: `vendor/mpv/mpv.exe`, `vendor/ffmpeg/{ffmpeg,ffprobe}.exe` (+ DLLs), plus a `vendor/.installed.json` recording which manifest hashes are installed, so re-runs skip.
- Hash mismatch or a 404 is a hard failure with a message saying to bump the manifest.
- `src/main/paths.ts` exports `binaryPath(name, base)` — the only place that knows binary locations; `src/main/index.ts` picks the base (see `release-windows` §2). *(Changed during implementation: `app.getAppPath()` is `out/main` when Electron is launched with a file path.)*

### Database
- File: `path.join(app.getPath('userData'), 'library.db')` → `%APPDATA%\video-player\library.db`. Per-user, never in movie folders. E2E tests pass `--user-data-dir=<temp>` so they never touch the real DB.
- Pragmas on open: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Migrations: ordered list of SQL strings in `src/main/db/migrations.ts`; current version tracked with `PRAGMA user_version`; each migration runs in a transaction. Migration 1 creates the full schema below.
- `src/main/db/index.ts` exposes `openDb(file)` and a `tx(fn)` helper. Tests use `openDb(':memory:')`.
- All access is in the main process; the renderer only sees IPC results.

### Full schema (migration 1)

```sql
-- Folders the user has added to the library
CREATE TABLE library_folders (
  id            INTEGER PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,
  added_at      INTEGER NOT NULL,            -- unix ms
  last_scan_at  INTEGER
);

-- Cached TMDB movie records (shared by any local files that match)
CREATE TABLE tmdb_movies (
  tmdb_id         INTEGER PRIMARY KEY,
  title           TEXT NOT NULL,
  original_title  TEXT,
  year            INTEGER,
  overview        TEXT,
  runtime_min     INTEGER,
  rating          REAL,
  poster_path     TEXT,                      -- TMDB relative path
  backdrop_path   TEXT,
  logo_path       TEXT,
  fetched_at      INTEGER NOT NULL
);

-- One row per video file on disk
CREATE TABLE movies (
  id             INTEGER PRIMARY KEY,
  folder_id      INTEGER NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
  path           TEXT NOT NULL UNIQUE,
  size_bytes     INTEGER NOT NULL,
  mtime_ms       INTEGER NOT NULL,
  quick_hash     TEXT,                       -- hash of size + first/last 64 KB; survives renames
  wall_key       INTEGER NOT NULL,           -- stable hash for wall ordering (infinite-wall)
  parsed_title   TEXT NOT NULL,              -- from parse-torrent-title
  parsed_year    INTEGER,
  duration_s     REAL,
  container      TEXT,
  video_codec    TEXT,
  width          INTEGER,
  height         INTEGER,
  hdr            INTEGER NOT NULL DEFAULT 0,
  probe_json     TEXT,                       -- full ffprobe output, for track lists
  tmdb_id        INTEGER REFERENCES tmdb_movies(tmdb_id) ON DELETE SET NULL,
  match_status   TEXT NOT NULL DEFAULT 'pending'
                 CHECK (match_status IN ('pending','matched','unmatched','manual')),
  added_at       INTEGER NOT NULL,
  missing_since  INTEGER                     -- set when file disappears; keeps resume/offsets
);
CREATE INDEX movies_folder ON movies(folder_id);
CREATE INDEX movies_tmdb   ON movies(tmdb_id);
CREATE INDEX movies_hash   ON movies(quick_hash);

CREATE TABLE genres (
  id    INTEGER PRIMARY KEY,                 -- TMDB genre id
  name  TEXT NOT NULL
);
CREATE TABLE tmdb_movie_genres (
  tmdb_id   INTEGER NOT NULL REFERENCES tmdb_movies(tmdb_id) ON DELETE CASCADE,
  genre_id  INTEGER NOT NULL REFERENCES genres(id),
  PRIMARY KEY (tmdb_id, genre_id)
);

CREATE TABLE people (
  id    INTEGER PRIMARY KEY,                 -- TMDB person id
  name  TEXT NOT NULL
);
CREATE TABLE credits (
  tmdb_id    INTEGER NOT NULL REFERENCES tmdb_movies(tmdb_id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES people(id),
  role       TEXT NOT NULL CHECK (role IN ('cast','director')),
  character  TEXT,
  ord        INTEGER NOT NULL DEFAULT 0,     -- billing order
  PRIMARY KEY (tmdb_id, person_id, role)
);
CREATE INDEX credits_person ON credits(person_id);

-- Locally cached images (posters, backdrops, logos, ffmpeg frame fallback)
CREATE TABLE images (
  movie_id    INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('poster','backdrop','logo','frame')),
  file        TEXT NOT NULL,                 -- path relative to userData/cache
  width       INTEGER,
  height      INTEGER,
  source      TEXT NOT NULL CHECK (source IN ('tmdb','ffmpeg','user')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (movie_id, kind)
);

-- Resume and per-movie playback choices (mpv-ipc: saved every 10 s and on close)
CREATE TABLE playback_state (
  movie_id        INTEGER PRIMARY KEY REFERENCES movies(id) ON DELETE CASCADE,
  position_s      REAL NOT NULL DEFAULT 0,
  duration_s      REAL,
  completed       INTEGER NOT NULL DEFAULT 0,
  audio_track     INTEGER,                   -- mpv aid
  subtitle_key    TEXT,                      -- see subtitle_transforms.subtitle_key
  volume          INTEGER,                   -- 0–200
  last_played_at  INTEGER NOT NULL
);
CREATE INDEX playback_recent ON playback_state(last_played_at DESC);

-- Subtitle timing per (movie, subtitle) — subtitle-formats §85
-- subtitle_key: 'file:<sha1 of absolute path>' or 'embedded:<stream index>'
CREATE TABLE subtitle_transforms (
  movie_id       INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  subtitle_key   TEXT NOT NULL,
  scale          REAL NOT NULL DEFAULT 1,
  offset_s       REAL NOT NULL DEFAULT 0,
  segments_json  TEXT,                       -- piecewise fit from deep sync, else NULL
  source         TEXT NOT NULL CHECK (source IN ('manual','auto-fast','auto-deep')),
  confidence     REAL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (movie_id, subtitle_key)
);

-- App settings as JSON values (TMDB key, subtitle style, volume defaults, …)
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL                       -- JSON
);
```

Design notes:
- TMDB data is keyed by `tmdb_id`, not by file, so two copies of the same film share metadata, genres and credits.
- Files that vanish get `missing_since` instead of being deleted, so resume points and subtitle offsets survive a drive being unplugged.
- Secrets (the TMDB API key) go in `settings` encrypted with Electron `safeStorage` (Windows DPAPI, tied to the user account), stored as base64 — implemented in milestone 2. *(Claude's call.)*
- Search documents (netflix-search) are built by joining `movies` → `tmdb_movies` → genres/credits; no FTS table is needed because Fuse.js runs in the renderer.

### Type-safe IPC
Adapted from `electron-skills`, with one change: **channel names are derived, never written by hand** — `channel = 'vp:' + domain + '.' + method` — so bridge/handler drift is impossible.

- `src/shared/api.ts`: the `API` type (one sub-type per domain; every method takes one object param and returns a `Promise`), plus `channelFor(domain, method)`.
- `src/shared/appError.ts`: `AppErrorCode`, `throwAppError`, `parseAppError`, `catchAppError` per `ipc-app-error-system`.
- `src/main/ipc.ts`: `registerDomain(domain, handlers)` — takes an object typed `API[domain]`, so a missing method is a compile error — and wraps errors as AppErrors.
- `src/preload/index.ts`: builds `window.api` from a list of method names per domain using `createInvoker`; `src/preload/index.d.ts` declares `window.api: API`. (Helpers live in main/preload respectively so shared code never imports `ipcMain`/`ipcRenderer`.)
- Milestone 1 endpoints, enough to prove the path end to end:
  - `app.getInfo()` → `{ version, userDataPath, dbPath, binaries: { mpv, ffmpeg, ffprobe: { path, exists } } }`
  - `settings.get({ key })`, `settings.set({ key, value })` — backed by the `settings` table.

### Renderer shell
A single dark placeholder screen: app name, and the `app.getInfo()` result (DB path, which vendor binaries were found, with a hint to run `npm run fetch-vendor` if missing). Visual design is deliberately minimal; it is replaced in milestone 3.

### Tests
- Vitest (Node 24): migrations run on `:memory:` to the latest `user_version`; foreign keys cascade; `CHECK` constraints reject bad values; `settings` round-trip; `channelFor` and AppError serialize/parse; `resolveBinary` paths; `fetch-vendor` hash verification and skip-if-installed logic (network mocked).
- Playwright-Electron smoke test: launch the built app with a temp `--user-data-dir`, the window appears, the shell shows the DB path, and `library.db` exists in the temp dir.

## Left to the builder

- Exact pinned URLs, versions and SHA-256 values for mpv and ffmpeg (look up current releases; note BtbN prunes old autobuilds, so a pinned URL may eventually 404 — the script's error should say to bump the manifest).
- Confirm electron-vite externalizes `node:sqlite` in the main bundle; add it to `external` if not.
- Node 24 prints an ExperimentalWarning for `node:sqlite`; suppress it in Vitest output if noisy.
- File-level structure inside `src/main/db/` and test file names.
