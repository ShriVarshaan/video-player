# Project Plan: Local Movie Player

An endless poster wall, Apple TV-style subtitles, Netflix-style search, ML subtitle sync and volume boost.

## Context
A desktop player (Windows 11) for movies stored on this laptop:
- You pick a folder, and its movies appear on an endless 2D poster wall that pans up, down, left and right. When there are fewer movies than the screen can hold, the tiles repeat.
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
 ├─ LibraryService   – folder scan, chokidar watch, ffprobe, filename parse, SQLite (built-in node:sqlite)
 ├─ MetadataService  – TMDB lookup + poster/backdrop cache (userData/cache), ffmpeg frame fallback
 ├─ PlayerService    – spawns mpv.exe with --wid=<player window HWND>, JSON IPC over a named pipe   [mpv-ipc]
 ├─ SubtitleService  – load .srt/.vtt/.ass + extract embedded subs, offset store, export            [subtitle-formats]
 └─ SyncService      – Python sidecar over stdio JSON-lines                                          [subtitle-sync-ml]
Renderer (React + TS + Vite)
 ├─ InfiniteWall     – virtualized, wrapping 2D grid                                                  [infinite-wall]
 ├─ SearchOverlay    – Netflix-style search                                                           [netflix-search]
 └─ PlayerOverlay    – transparent overlay window: controls, Apple TV subtitles, sync panel
Python sidecar (PyInstaller onedir)
 └─ ffsubsync (VAD) + faster-whisper (deep sync)
```

### Key technical choices
- **Playback:** mpv runs as a child process embedded with `--wid` and is controlled over a named pipe.
  - mpv uses FFmpeg internally, so it plays essentially every container and codec.
  - Controls and subtitles live in a **transparent child BrowserWindow** that tracks the player window's bounds, because HTML can't be layered over mpv's surface in the same window.
- **Apple TV-style subtitles are drawn in HTML/CSS:**
  - SF Pro-like font, white semibold text, a rounded translucent blurred box per line, a short fade, and positioning relative to the video rectangle.
  - Image subtitles (PGS/VobSub) fall back to mpv's native rendering.
- **Volume boost:** `--volume-max=200` with a UI slider from 0 to 200 %, like VLC.
  - An `alimiter` filter is added automatically above 100 %.
  - "Dialogue boost" is an optional `dynaudnorm` filter.
- **Infinite wall:**
  - Tile `(col,row)` maps to `movies[mod(row*S + col, n)]`, with the stride `S` chosen so neighbouring tiles differ.
  - A recycled DOM pool is moved by `translate3d` in a requestAnimationFrame loop, with no React re-render per frame.
  - Arrow keys, drag with momentum, wheel input, a focus zoom with an info card, and an idle drift.
- **Netflix-style search:**
  - A full-screen overlay with the query bar, an "Explore titles related to" row of chips, and a grid of 16:9 cards.
  - Fuse.js over title, cast, director, genres and year, with keyboard navigation through the grid.
- **Library and metadata:**
  - Folder scan plus ffprobe, and `parse-torrent-title` to clean filenames.
  - TMDB results are cached in SQLite and on disk. A user-supplied API key is set in Settings.
  - Unmatched or offline files get an ffmpeg frame thumbnail.
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
| # | Milestone | Main skills |
|---|---|---|
| 1 | **Scaffold:** electron-vite + React + TS, `fetch-vendor` script, SQLite schema, type-safe IPC | `electron`, `electron-skills`, `vite`, `release-windows` (vendor) |
| 2 | **Library:** folder picker, scan and watch, ffprobe, filename parse, TMDB + cache, thumbnail fallback | `ffmpeg`, `test-media-fixtures` |
| 3 | **Infinite wall** | `infinite-wall`, `animation-performance`, `apple-design`, `vercel-react-best-practices` |
| 4 | **Playback:** mpv embed + IPC, overlay window, controls, track pickers, volume boost, resume | `mpv-ipc`, `apple-design`, `emil-design-eng` |
| 5 | **Subtitles:** parse and extract, auto-match, Apple TV renderer, style settings | `subtitle-formats`, `apple-design` |
| 6 | **Manual sync:** hotkeys, panel, sync-to-line, two-point, export | `subtitle-formats` |
| 7 | **ML sync:** sidecar fast path → deep path → progress UI → packaging | `subtitle-sync-ml`, `test-media-fixtures` |
| 8 | **Search** | `netflix-search` |
| 9 | **Polish and packaging:** design audit, accessibility, settings, NSIS installer, notices | `impeccable`, `review-animations`, `accessibility`, `release-windows` |

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
