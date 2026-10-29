// Ordered schema migrations. Entry i upgrades the database to user_version i + 1.
// Never edit a shipped migration; append a new one.

export const migrations: readonly string[] = [
  `
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

-- Subtitle timing per (movie, subtitle) — subtitle-formats
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
`
]
