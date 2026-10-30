# Project Plan: Local Movie Player

An endless poster wall, Apple TV-style subtitles, Netflix-style search, ML subtitle sync and volume boost.

## Context
A desktop player (Windows 11) for movies and TV shows stored on this laptop:
- You pick a folder, and its movies and shows appear on an endless 2D poster wall that pans up, down, left and right. When there are fewer titles than the screen can hold, the tiles repeat.
- A show opens a page to pick a season and episode. Its main button reads **Play episode**, or **Continue watching** plus **Restart episode** when you're partway through (rules in `src/main/library/showProgress.ts`).
- It must play every popular format (mp4, mkv, avi, mov, webm, HEVC, AV1 and more).
- Subtitles are styled like Apple TV.
- Search works like Netflix.
- Subtitles can be synced automatically with ML, or by hand with offsets.
- Volume can be boosted past 100 %, like VLC.

**Decisions made:** Electron + mpv · TMDB metadata with a local fallback · ML sync uses speech detection (ffsubsync) first, with Whisper as a fallback.

Detailed specs for each area are in the project skills in `.claude/skills/`. The skill named in each section below is the source of truth for that area.

## Architecture
```
Electron main process (Node/TS)
 ├─ LibraryService   – folder scan, fs.watch, ffprobe, movie/episode name parse, SQLite (built-in node:sqlite)
 ├─ MetadataService  – TMDB movie + TV lookup, WebP image cache behind poster://, ffmpeg frame fallback
 ├─ PlayerService    – spawns mpv.exe with --wid=<main window HWND>, JSON IPC over a named pipe     [mpv-ipc]
 ├─ Subtitles        – find files next to videos, UTF-8 copies for mpv, style store, OpenSubtitles  [subtitle-formats]
 │                     (milestone 6 adds the app's own reader: offsets, sync-to-line, export)
 └─ SyncService      – Python sidecar over stdio JSON-lines                                          [subtitle-sync-ml]
Renderer (React + TS + Vite)
 ├─ Menu + pages     – top-left drawer: Search · Home (the wall, title pages) · Settings (folders, TMDB key, about)
 ├─ InfiniteWall     – virtualized, wrapping 2D grid                                                  [infinite-wall]
 ├─ SearchOverlay    – Netflix-style search                                                           [netflix-search]
 └─ Overlay window   – transparent window over the app window: controls, track menus, next episode, subtitles, style and search panels; later sync panel
Python sidecar (PyInstaller onedir)
 └─ ffsubsync (VAD) + faster-whisper (deep sync)
```

### Key technical choices
- **Playback** (design: `docs/superpowers/specs/2026-10-30-milestone-4-playback-design.md`): mpv runs as a child process embedded with `--wid` **in the app window itself** and is controlled over a named pipe.
  - mpv uses FFmpeg internally, so it plays essentially every container and codec.
  - Chromium's own child windows sit above mpv's, so mpv's window is raised with one Win32 call (`SetWindowPos`, via koffi).
  - Controls live in a **transparent owned BrowserWindow** that tracks the app window's content bounds, because HTML can't be layered over mpv's surface in the same window. Layout: one control bar along the bottom (seek, play/skip, volume 0–200 %, time, Audio, Subtitles, full screen).
  - Esc/✕ saves the position and goes to the title's page. Episodes autoplay after a 10 s "Next episode" card.
  - Volume, audio and subtitle choices are remembered **per movie or show** (`title_prefs`), never app-wide.
- **Title pages:** Enter/click on a wall tile opens a page for the movie or show: full-bleed backdrop, details on the left (TMDB synopsis and rating), Play / Continue watching + Restart; shows add a season row and an episode strip. The wall's info card button plays directly.
- **Subtitles** (design: `docs/superpowers/specs/2026-10-30-milestone-5-subtitles-design.md`):
  - mpv loads and times every subtitle (embedded, files next to the video, downloads); the overlay draws the current line in HTML/CSS. Image subtitles (PGS/VobSub) stay mpv's.
  - A subtitle file next to the video in the user's language comes on every time; otherwise the per-title choice, then Apple TV's "Auto" rule.
  - Apple TV's style options plus a 0–100 height slider. Changes in the player stay with that title unless "Use for all"; Settings changes are global. A title keeps only the fields changed for it.
  - Online search (OpenSubtitles) only from the player's "Search online…"; downloads are saved next to the video, never over an existing file.
- **Volume boost:** `--volume-max=200` with a UI slider from 0 to 200 %, like VLC.
  - An `alimiter` filter is added automatically above 100 %.
  - "Dialogue boost" is an optional `dynaudnorm` filter.
- **Infinite wall:**
  - Tile `(col,row)` maps to `movies[mod(row*S + col, n)]`, with the stride `S` chosen so neighbouring tiles differ.
  - A recycled DOM pool is moved by `translate3d` in a requestAnimationFrame loop, with no React re-render per frame.
  - Arrow keys, drag with momentum, wheel input, a focus zoom with an info card, and an idle drift.
  - Design: `docs/superpowers/specs/2026-10-29-milestone-3-wall-design.md`. Main sends ready-to-draw `WallItem`s (`library.wall`) in a stable order.
  - The info card is fixed at the bottom left (Apple TV style). Play stays disabled until milestone 4.
- **Navigation:** a menu button at the top left opens a text-only drawer (Search, Home, Settings). The wall stays mounted and paused on other pages, so it keeps its place.
- **Netflix-style search:**
  - A full-screen overlay with the query bar, an "Explore titles related to" row of chips, and a grid of 16:9 cards.
  - Fuse.js over title, cast, director, genres and year, with keyboard navigation through the grid.
- **Library and metadata** (design: `docs/superpowers/specs/2026-10-29-milestone-2-library-design.md`):
  - Folder scan plus ffprobe, and `parse-torrent-title` plus our own rules to tell movies from episodes (`S01E02`, `1x02`, `Show/Season 1/02 - Title`).
  - Episodes group into shows → seasons → episodes. One TMDB search per show.
  - TMDB results are cached in SQLite; artwork as WebP in `userData/cache/images`, served as `poster://<poster|backdrop|logo|still>/<video|show>/<id>`.
  - The user's TMDB key is encrypted with Windows DPAPI (`safeStorage`) and never reaches the renderer.
  - Unmatched or offline files get an ffmpeg frame thumbnail. Renamed files keep their progress (quick hash); unplugged drives keep everything.
- **Database:**
  - Built-in `node:sqlite` (Electron 45 ships Node 24), so there is no native module to rebuild.
  - One database per Windows user at `%APPDATA%\video-player\library.db`. Nothing is stored in movie folders.
  - Schema version lives in `PRAGMA user_version`; migrations are in `src/main/db/migrations.ts`.
- **ML sync:**
  - Fast: ffsubsync (VAD), recovering offset and framerate scale.
  - Deep: faster-whisper with word timestamps, matched to subtitle lines with rapidfuzz, then a RANSAC global fit, with piecewise segments for cuts.
  - Output is `<movie>.synced.srt`. The original subtitle file is never overwritten.
- **Manual sync:**
  - G/H shift ±50 ms; Shift+G/H shift ±500 ms.
  - Offset slider.
  - "Sync to this line".
  - Two-point sync for drift.
  - Saved per movie and subtitle; exportable.

## Project layout
```
video-player/
  package.json, electron-builder.yml, vite.config.ts, tsconfig.json
  src/main/        index.ts, library/, metadata/, player/mpvIpc.ts, subtitles/, sync/sidecar.ts, db.ts, paths.ts
  src/preload/     index.ts (contextBridge API)
  src/renderer/    App.tsx, wall/, search/, player/ (PlayerOverlay, SubtitleView, SyncPanel), settings/
  src/shared/      types.ts, ipc channels
  sidecar/         vp_sync/, tests/, bench.py, requirements.txt, build.spec
  scripts/         fetch-vendor.mjs, make-fixtures.mjs
  vendor/          mpv, ffmpeg (fetched, gitignored; pinned in vendor/manifest.json)
  tests/           unit (vitest), e2e (Playwright-Electron), fixtures/
  docs/            PROJECT_PLAN.md
```

## Milestones
| # | Milestone | Main skills | Status |
|---|---|---|---|
| 1 | **Scaffold:** electron-vite + React + TS, `fetch-vendor` script, SQLite schema, type-safe IPC | `electron`, `electron-skills`, `vite`, `release-windows` (vendor) | ✅ done |
| 2 | **Library:** folder picker, scan and watch, ffprobe, movie and TV filename parse, TMDB movies + shows + cache, thumbnail fallback | `ffmpeg`, `test-media-fixtures` | ✅ done |
| 3 | **Infinite wall:** poster wall on Home, menu drawer (Search · Home · Settings), Settings page, bottom-left info card | `infinite-wall`, `animation-performance`, `apple-design`, `vercel-react-best-practices` | ✅ done |
| 4 | **Playback:** mpv embed + IPC, overlay window, controls, track pickers, volume boost, resume, show page (season/episode picker, Play / Continue / Restart) | `mpv-ipc`, `apple-design`, `emil-design-eng` | ✅ done |
| 5 | **Subtitles:** auto-match files, Apple TV renderer, style settings, OpenSubtitles search | `subtitle-formats`, `apple-design` | ✅ |
| 6 | **Manual sync:** the app's own subtitle reader (parse, extract embedded), hotkeys, panel, sync-to-line, two-point, export | `subtitle-formats` | |
| 7 | **ML sync:** sidecar fast path → deep path → progress UI → packaging | `subtitle-sync-ml`, `test-media-fixtures` | |
| 8 | **Search** | `netflix-search` | |
| 9 | **Polish and packaging:** design audit, accessibility, settings, NSIS installer, notices | `impeccable`, `review-animations`, `accessibility`, `release-windows` | |

Every milestone follows the same flow: `brainstorming` → `writing-plans` → `executing-plans` with `test-driven-development` → `verification-before-completion` → `requesting-code-review` / `/code-review`.

## Verification
- **Unit (Vitest):**
  - tile→movie mapping, with no adjacent duplicates for n = 1–60
  - subtitle parsing and encodings
  - offset and two-point maths
  - filename parsing
  - search ranking
- **Sidecar (pytest):** on the TTS speech fixture, shifted (+3.2 s), drifted (×1.001, 23.976/25) and cut (+45 s) subtitles must recover with median cue error < 100 ms. Wrong-language subtitles must return `NO_MATCH`.
- **E2E (Playwright-Electron):**
  - the fixture library fills the wall
  - arrow keys move focus
  - search returns the expected card
  - playback starts
  - the subtitle overlay shows the correct cue at a known time
- **Manual checks:**
  - HEVC/AV1/DTS files play
  - 200 % volume is clean
  - G/H offsets work
  - the wall holds 60 fps in the DevTools Performance panel
  - the pre-release smoke test in `release-windows` passes
