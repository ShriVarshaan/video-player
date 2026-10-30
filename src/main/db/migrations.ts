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
`,
  `
-- 2: TV shows. The file table now holds movies and episodes.
ALTER TABLE movies RENAME TO videos;
ALTER TABLE playback_state      RENAME COLUMN movie_id TO video_id;
ALTER TABLE subtitle_transforms RENAME COLUMN movie_id TO video_id;
DROP INDEX movies_folder;
DROP INDEX movies_tmdb;
DROP INDEX movies_hash;
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
`,
  `
-- 3: what the player remembers per title (WallItem.key: 'movie:<id>', 'tmdb:<id>', 'local:<show>').
CREATE TABLE title_prefs (
  title_key      TEXT PRIMARY KEY,
  volume         INTEGER,                  -- 0–200
  audio_json     TEXT,                     -- {lang, kind, title}
  subtitle_json  TEXT,                     -- {lang, kind, title} or "off"
  updated_at     INTEGER NOT NULL
);
`
]
