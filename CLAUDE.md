# Video Player

A Windows desktop player for local movie folders. It has:
- an endless poster wall that pans in all directions, with tiles repeating when there are few movies
- Apple TV-style subtitles
- Netflix-style search
- ML subtitle sync (VAD first, Whisper as fallback) plus manual offsets
- VLC-style volume boost to 200%

**Stack:** Electron + React/TypeScript (Vite) · mpv (child process, `--wid` embed, JSON IPC) · FFmpeg/ffprobe · SQLite · TMDB · Python sidecar (ffsubsync, faster-whisper).

The full plan is in `C:\Users\varsh\.claude\plans\i-want-to-make-graceful-pudding.md`. Skill details are in `required_skills.md`.

## Skill routing

Project skills live in `.claude/skills/`. Before starting the matching kind of work, invoke the listed skill by name. Don't wait for it to trigger on its own.

| Task | Skills to use |
|---|---|
| Starting a new feature or milestone | `brainstorming` → `writing-plans` |
| Implementing a plan | `executing-plans` (inline) or `subagent-driven-development` (parallel tasks) |
| Any feature or bugfix code | `test-driven-development` |
| Any bug, failing test or unexpected behavior | `systematic-debugging` |
| Before saying work is done | `verification-before-completion` |
| End of a milestone | `requesting-code-review`, then `/code-review` and `/security-review` |
| Code structure getting messy | `improve-codebase-architecture`, `/simplify` |
| Electron main/preload/windows, packaging | `electron` |
| Any IPC endpoint (renderer ↔ main) | `electron-skills` |
| Build config (`vite.config.ts`, electron-vite) | `vite` |
| React components and state | `vercel-react-best-practices`, `vercel-composition-patterns` |
| Visual design of any screen | `frontend-design` + `apple-design`; then audit with `impeccable` and `web-design-guidelines` |
| Overall art direction, palette, type | `design-taste-frontend` (use its app-screen rules, not the landing-page ones) |
| Player overlay and subtitles look (Apple TV feel) | `apple-design`, `emil-design-eng` |
| Wall panning, momentum, drift, focus zoom | `animation-performance`, `apple-design` |
| Transitions and motion polish | `improve-animations`, then `review-animations` |
| Framer Motion code (only if adopted) | `framer-motion` |
| ffmpeg/ffprobe commands: probe, thumbnails, subtitle or audio extraction | `ffmpeg` (ignore its Remotion-specific parts) |
| Unit tests | `vitest` |
| End-to-end tests of the Electron app | `playwright-best-practices` (Electron section) |
| Keyboard navigation, contrast, subtitle readability | `accessibility` |
| Renderer speed, frame budget, memory | `performance`, `animation-performance` |
| Launching the app or taking screenshots to check UI | `/run` |

### Not yet written
These custom skills are still to be written with `skill-creator` when their milestone starts:
- `mpv-ipc`
- `subtitle-formats`
- `subtitle-sync-ml`
- `infinite-wall`
- `netflix-search`
- `test-media-fixtures`
- `release-windows`

Until then, follow the plan file for those areas.

## Conventions
- Never overwrite a user's original subtitle file. Save synced output as `<movie>.synced.srt`.
- Third-party binaries (mpv, ffmpeg) go in `vendor/`, which is fetched by a script and gitignored.
- Commit `.claude/skills/` and `skills-lock.json`. Restore skills with `npx skills experimental_install`.
