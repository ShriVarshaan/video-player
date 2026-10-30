# Milestone 4 — Playback and title pages: design

Status: approved by the user (2026-10-30).

## Intent

Make the wall lead somewhere. Every title gets a page (movies too, not only shows), and Play turns the app window into a player driven by the bundled mpv. Playback remembers where you were, which tracks you chose and how loud it was, per title, and a show plays on into its next episode.

Why now: the wall (milestone 3) is the first screen the user lives in, and its Play button is still disabled. Subtitles (5), sync (6–7) and search (8) all hang off a working player.

## Goals

- **Title page** for every movie and show, reached from the wall.
- **Playback in the same app window**, with a control bar, Audio and Subtitles menus, volume to 200 %, full screen, and keyboard control.
- **Resume**: position saved while playing; Continue watching / Restart on the title page; the wall's progress bars and labels update.
- **Per-title memory**: volume, audio language and subtitle choice are remembered per movie and per show.
- **Autoplay** the next episode after a 10 s countdown.

## Non-goals

- Apple TV-style subtitle rendering (milestone 5). Until then mpv draws text subtitles itself in its default style.
- Subtitle sync of any kind (6–7). The Subtitles menu leaves room for a "Sync subtitles…" entry; it is not shown in this milestone.
- Loading external subtitle files, subtitle style settings (5).
- Search (8), playback speed, chapters, picture-in-picture, a mini player, casting.
- Detecting where credits start.

## Anti-goals (would make this a failure even if it works)

- The player feels like a second app: a separate window appearing, focus jumping, the controls lagging behind the video when the window moves.
- Losing the user's place: a crash, a close or Esc that forgets the position.
- A format that mpv plays fine refusing to play here.
- The wall getting slower because of anything added here.

## Decided with the user

### Navigation

- **Enter or click on a wall tile opens the title page** (not playback).
- *My call:* the info card's button (already labelled Play / Play episode / Continue watching) is enabled and starts that playback directly when clicked; it is the only way to play from the wall. (Milestone 3 deferred a bug where clicks on the card's buttons fall through to the poster behind; it is fixed here.)
- **Esc during playback** saves the position and goes to **that title's page**, never straight to the wall. ✕ in the player's top bar does the same.
- **Esc or "‹ Home" on the title page** returns to the wall, with focus still on the same poster.
- One app window. Playback takes over that window.

### Title page — layout A (full-bleed backdrop, details on the left)

Matches the wall's info card, so arriving from the wall feels continuous.

- Full-bleed TMDB backdrop (fallback: the poster blurred, as the wall does), darkened from the left.
- Top left: the menu button (as everywhere) and "‹ Home".
- Left column, upper third:
  - title (large)
  - meta line: year · runtime (movie) or "N seasons · M episodes" (show) · genres · **TMDB rating** shown as a small outlined badge "TMDB 7.6"
  - **full synopsis** (TMDB overview, not cut to one sentence)
  - buttons:
    - not started: **▶ Play** (movie) / **▶ Play S1 E1** (show)
    - partway: **▶ Continue watching** + **↺ Restart** (movie) / **▶ Continue S2 E4** + **↺ Restart episode** (show), with "1 h 12 min left" beside them and a thin progress bar under
    - show labels follow the existing `nextUp` rules (`src/main/library/showProgress.ts`).
- **Shows only**, along the bottom: a row of season names ("Season 1", "Season 2", "Specials") and a horizontal strip of episode cards for the selected season — 16:9 still, "4 · Woe's Hollow", runtime or "21 min left" / "watched", a progress bar on the still when partway. The season shown first is the one holding the next-up episode. Choosing an episode card plays that episode (resuming it if partway).
- **Unmatched titles** (no TMDB): the parsed name as the title, no synopsis, no rating, no empty placeholders.

### Player — layout B (one control bar along the bottom), audio and subtitles split

Controls appear on mouse move or any key and fade after 2.5 s of no input while playing (they stay while paused or while a menu is open). The cursor hides with them.

- **Top:** ✕ (left) and the title — "Arrival" or "Severance · S2 E4 · Woe's Hollow".
- **Bottom bar:** a full-width seek bar, then one row:
  - play/pause · back 10 s · forward 10 s
  - volume icon (click = mute) + slider 0–200 %, with a tick at 100 % and the part above 100 % in amber, and the percentage
  - time "19:42 / 51:52"
  - right side: **Audio** button · **Subtitles** button · full screen
- **Audio menu:** one entry per audio track (language name + channel layout, e.g. "English 5.1"; track title if no language).
- **Subtitles menu:** "Off" then one entry per embedded subtitle track. Room is left at the bottom for a future "Sync subtitles…" entry (milestone 6). Picture-based subtitles (PGS/VobSub) are drawn by mpv; for this milestone, text subtitles are too.
- **Next-episode card** (shows): when an episode's file ends and a next episode exists, a card appears bottom right with the next episode's still, "Next episode · S2 E5 · Trojan's Horse" and a 10 s countdown; it plays automatically at 0. Buttons: **Play now** and **Cancel**. Cancel leaves the player on the last frame with controls shown; Esc then goes to the show page. "Next" uses the same order as `nextUp` (next in season, then the next season's first, Specials skipped). After the final episode, or at the end of a movie, the player closes to the title page.

### Remembered per title

- Remembered **per movie and per show** (the wall item's key), never app-wide: **volume**, **audio language**, **subtitle choice** (a language, or Off).
- A title never played starts at 100 % volume, mpv's default audio track and subtitles Off.
- Choosing tracks for one episode applies to the following episodes of the same show (matched by language, since track ids differ between files).
- *My call — matching a remembered track in another file:* remember the language **and** the track's kind (forced / SDH (hearing-impaired) / commentary / plain) and its title. Pick the track with the same language and kind; else same language, plain kind; else same title; else mpv's default. For a track with no language tag, only the title and kind are remembered.
- *My call — forced subtitles:* "Off" means no full subtitles, but a **forced** track in the playing audio's language (translations of foreign-language lines) is still shown, as mpv and Apple TV do by default. Choosing Off explicitly in the menu while a forced track shows turns that off too, and that is remembered.
- *My call — keys that change:* when TMDB first matches a show, its key goes from `local:<name>` to `tmdb:<id>`. The matching code moves the `title_prefs` row to the new key, so nothing is lost.

### End states (my calls)

- **Autoplayed next episode:** resumes if it is partway through, otherwise starts from 0 (a watched episode starts from 0).
- **After a Special** (season 0) ends there is no autoplay; the player closes to the show page.
- **A movie you've finished** (completed or past 95 %): the page shows **▶ Play** (from the start) and a small "Watched" note in the meta line; the wall label stays "Play".

## Approaches considered (for "playback in the same window")

- **A — mpv draws into the main window; a transparent overlay window holds the controls. (Chosen.)** mpv gets `--wid=<main window HWND>` and draws as a child of the app window, on top of the page. A frameless transparent window, owned by the main window, sits exactly over its content area and holds the controls, menus and next-episode card. Leaving the player hides mpv's picture and the title page is underneath. Cost: the overlay has to follow the main window on move, resize, maximize and full screen. Fewest moving parts that keep mpv's full format support.
- **B — a separate borderless player window placed exactly over the app window**, plus the overlay. Looks the same, but three windows must move together, with more chance of a frame where they don't line up or of focus going to the wrong one. Its gain (the app page never covered) is already had in A by hiding the video.
- Ruled out: the browser's `<video>` element (no MKV/HEVC/DTS and more — the reason mpv is here); a transparent main window with the video behind it (on Windows it breaks normal resizing and slows the wall).

**Risk to check first:** that mpv's child window draws above Chromium's surface inside the same window, and can be hidden/shown again cleanly. The plan's first task is a spike that proves it on this laptop.
- *My call:* if the spike fails, the build switches to B without a new design round (it looks and behaves the same to the user), and the user is told why.
- *My call — window drag:* the overlay follows the main window on every `move`/`resize` event. If it visibly trails during a drag, the controls hide while the window is being moved and come back when it stops; the video itself never trails, because mpv is inside the window.

## Technical shape

### Main process

- `src/main/player/mpvIpc.ts` — typed JSON-IPC client over the named pipe, as the `mpv-ipc` skill describes (connect retry 50 ms × 5 s, newline framing, `request_id`, 5 s timeout, `observe`, events).
- `src/main/player/service.ts` — `PlayerService`: one mpv process per app, spawned on first play with the skill's flags and `--wid` = main window. `play(videoId, { from })`, `stop()`, commands for pause/seek/volume/mute/aid/sid/full screen. Owns resume saving, per-title memory, the limiter filter above 100 %, crash respawn once (`mpv-ipc` lifecycle rules), and quit-then-kill on app exit.
- Overlay window: frameless, transparent, `parent: mainWindow`, no taskbar entry, bounds copied from the main window's content bounds on every move/resize/maximize/full-screen event; shown only while playing; takes all keyboard and mouse input while shown. It loads a second renderer entry (`overlay.html`) with the same preload and IPC contract.
- **Resume writes** go to `playback_state` (per video): every 10 s while playing, on pause, on seek, on stop/Esc, on episode change and on app quit. `completed = 1` at end of file or once position ≥ 95 % of duration. Then `library.changed` is emitted so the wall and title page refresh.
- **Per-title memory:** a new table (migration 3; the database is at version 2) `title_prefs(title_key TEXT PRIMARY KEY, volume INTEGER, audio_json TEXT, subtitle_json TEXT, updated_at INTEGER NOT NULL)`, where `title_key` is the `WallItem.key`. The JSON columns hold the remembered track as `{lang, kind, title}` (see "Remembered per title"); `subtitle_json` may also be `"off"`.
- **Next episode** comes from the same ordering as `nextUp`; a pure function `nextEpisode(episodes, currentVideoId)` beside it, unit-tested.

### IPC (one contract in `src/shared/api.ts`)

- `library.getTitle({ key })` → a `TitleDetail` for both kinds: what the page needs (title, year, runtime or season/episode counts, genres, rating, full overview, backdrop/poster URLs, `matched`, the main button's action, and for shows the seasons with episodes, stills and per-episode progress). Builds on the existing `getShow`.
- `player.play({ videoId, from: 'resume' | 'start' })`, `player.stop()`, `player.command(...)` for the controls.
- Events: `player.state` (playing/paused, position ~30 Hz, duration, volume, mute, tracks, current title/episode, full screen), `player.ended` (with the next episode, if any), `player.closed` (with the title key, so the main window shows that title's page).

### Renderer

- Main window: `App` gains a `title` page (`pages/Title.tsx`) and a `playing` state in which the page area is blanked to black under mpv. The wall's Enter/click calls `onOpen(key)`; the info card's Play button, now enabled, starts playback of the card's next-up directly.
- Overlay renderer (`src/renderer/overlay/`): the control bar, menus, next-episode card, auto-hide, and the keys below.

### Keys (in the player)

| Key | Action |
|---|---|
| Space | play/pause |
| ← / → | back / forward 10 s |
| ↑ / ↓ | volume ±5 % (0–200) |
| M | mute |
| F, double-click on video | full screen on/off |
| Esc | save, leave full screen, go to the title page |

## Testing

- Unit: the mpv JSON-IPC client against a fake named-pipe server (framing, split chunks, timeouts, events); `nextEpisode`; resume rules (save cadence, 95 % finished); per-title memory language matching; `getTitle` queries.
- E2E (Playwright-Electron, real vendor mpv): open a title page from the wall; Play starts playback (time advances, overlay window appears); Esc returns to the title page with Continue watching; Restart starts from 0; volume set to 150 % is remembered for that title only; Audio/Subtitles menus list a fixture's tracks; an episode ending shows the countdown and plays the next one.
- A new fixture with two audio tracks and an embedded text subtitle (generated by `make-fixtures.mjs`).
- Manual: HEVC/AV1/DTS files play; 200 % is clean; window move/resize/maximize/full screen keep the overlay aligned.

## Left to the builder

- Exact visual values (spacing, sizes, timings) within the agreed layouts, following `apple-design` / `emil-design-eng`.
- Whether mpv stays alive idle between plays or is respawned per play.
- How the title page's episode strip scrolls with the keyboard.
- Throttling and interpolation details of `player.state`.

## As built (2026-10-30)

Decisions made during the build:
- **mpv's window must be raised.** Inside the app window mpv's child window sits below Chromium's own surfaces, so the picture was hidden. One Win32 call (`SetWindowPos` via koffi) lifts it; it holds through resize, maximize, full screen and refocus. A separate player window or `BaseWindow` has the same problem, so approach B would not have helped.
- mpv is spawned per play session and quit on close; the next episode reuses it. End of file is read from `eof-reached` (with `--keep-open`, mpv sends no `end-file` at EOF).
- Resume points are saved only after the resume seek lands, so a first `time-pos` of 0 never overwrites them.
- The overlay window exists hidden from startup; closing it (Alt+F4) closes the app, which saves first.
- Enter/click open the title page; Space/`i` still open the info card; the card's button plays directly.
- A remembered subtitle track missing from a file turns subtitles off (no fallback to SDH or mpv's default).
- Faded controls take no clicks; the first pointer movement brings them back.

Deferred (small, for later milestones):
- Controls may trail the video by a frame while the window is dragged (needs a manual check; fix would hide them during a drag).
- A hung mpv delays app close ~6 s (the kill timer starts after the quit command returns).
- After Cancel on the countdown and seeking back, a second end of file is ignored.
- No numeric validation of player IPC params (NaN volume/seek).
- Untagged tracks match by title only, not title + kind.
- Two crashes hours apart show the error instead of respawning.
- The volume key value isn't reset between titles; a crash respawn doesn't restore mute.
- A failed mpv launch or failed autoplay is only logged, with no message.
- Accessibility: seek bar not focusable, countdown not announced, focus not moved to Play now or back to the Audio/Subtitles button, TrackMenu traps Tab.
- The countdown keeps running while a track menu is open.
- No e2e for double Esc or held keys in the player; the main window re-renders on every `player.state`.
- Packaging: koffi's `.node` must be unpacked from the asar (milestone 9, `release-windows`).
