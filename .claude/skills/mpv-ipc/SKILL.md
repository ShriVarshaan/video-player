---
name: mpv-ipc
description: How this app embeds and controls mpv on Windows — launch flags, --wid embedding into an Electron window, the JSON IPC protocol over a named pipe, observed properties, the transparent overlay window, volume boost and audio filters, and crash/restart handling. Use whenever touching PlayerService, src/main/player/*, the player or overlay windows, playback controls, audio/subtitle track selection, volume boost, or debugging anything mpv-related.
---

# mpv control in this project

mpv runs as a **child process** (`vendor/mpv/mpv.exe`) that draws into the **main app window's** native handle (milestone 4 design: playback takes over the app window; there is no separate player window). All control goes through **JSON IPC on a Windows named pipe**. We do not use libmpv bindings, mpv.js or the render API. Keep it that way unless the user decides otherwise.

## Launch

```ts
const hwnd = mainWin.getNativeWindowHandle().readBigUInt64LE(0).toString();
const pipe = `\\\\.\\pipe\\vp-mpv-${process.pid}-${playerId}`;

spawn(resolveBinary('mpv'), [
  `--wid=${hwnd}`,
  `--input-ipc-server=${pipe}`,
  '--idle=yes', '--keep-open=yes', '--force-window=yes',
  '--no-osc', '--osd-level=0', '--no-osd-bar',
  '--no-input-default-bindings', '--input-vo-keyboard=no', '--input-cursor=no',
  '--hwdec=auto-safe', '--vo=gpu-next',
  '--volume-max=200',            // UI slider 0–200 %, like VLC
  '--sub-auto=no', '--audio-file-auto=no',
  '--sub-visibility=no',         // the overlay draws text subs; the service turns it on for picture-based tracks only
  '--msg-level=all=warn',
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
```

- **Raise mpv's window.** mpv's child window is created *below* Chromium's own child windows (`Intermediate D3D Window`), so the picture is hidden. `launch.ts` finds it with `FindWindowExW(main, 0, "mpv")` and calls `SetWindowPos(HWND_TOP, NOMOVE|NOSIZE|NOACTIVATE)` through **koffi** (polling until the window exists). `--ontop`, a separate `BrowserWindow` or a `BaseWindow` do not help: each has the same D3D surface on top. Verified to hold through resize, maximize, full screen and refocus.
- **One mpv per play session**, spawned on Play and quit on close (stopping without quitting would leave mpv's black child window over the page). The next episode reuses the running process (`loadfile replace`). `launch.ts` keeps every live child and `killAllMpv()` runs on process `exit`.
- `resolveBinary` returns `process.resourcesPath/vendor/...` when packaged and `<repo>/vendor/...` in dev. Never hardcode paths.
- Pass file paths only as IPC arguments (`loadfile`), never pasted into a shell string.
- The main window shows a black cover (`.player-cover`) while playing so letterboxing matches before the first frame arrives.

## Connecting to the pipe

mpv creates the pipe a few hundred ms after it starts. Retry `net.connect(pipe)` every 50 ms for up to 5 s, then fail with a clear error.

The protocol is **newline-delimited JSON**. Buffer incoming chunks and split on `\n`, because one chunk can hold several messages or half of one.

```jsonc
// request
{"command":["loadfile","C:\\Movies\\x.mkv","replace"],"request_id":7}
// response
{"request_id":7,"error":"success","data":null}
// property change (after observe_property)
{"event":"property-change","id":1,"name":"time-pos","data":812.43}
// other events
{"event":"file-loaded"} {"event":"end-file","reason":"eof"|"error"|"stop",...} {"event":"seek"} {"event":"playback-restart"}
```

Wrap these in a small typed client (`src/main/player/mpvIpc.ts`):
- `command(...args): Promise<data>` keyed by an incrementing `request_id`, with a 5 s timeout
- `observe(name, cb)`
- an `EventEmitter` for events

## Properties to observe

| id | property | used for |
|---|---|---|
| 1 | `time-pos` | Progress bar and subtitle clock. It fires very often, so throttle what goes to the renderer to about 30 Hz. The renderer interpolates with `performance.now()` while playing. |
| 2 | `pause` | Play/pause state, and freezing interpolation |
| 3 | `duration` | Progress bar |
| 4 | `volume`, `mute` | Volume UI |
| 5 | `track-list` | Audio and subtitle pickers, plus detecting image subs (`codec: hdmv_pgs_subtitle`, `dvd_subtitle`, `dvb_subtitle`) |
| 6 | `video-params` / `osd-dimensions` | Video rectangle inside the window. The subtitle overlay and letterbox maths need it. |
| 7 | `eof-reached`, `idle-active`, `paused-for-cache` | End of file (with `--keep-open=yes` mpv pauses on the last frame and sends **no** `end-file` at EOF; `eof-reached` is the signal), spinner |
| 8 | `aid`, `sid` | Which tracks the menus mark; restored after a crash |

Resend `time-pos` straight away on `seek` and `playback-restart` so subtitles jump instantly.

## Common commands

```
loadfile <path> replace        set_property pause true|false     cycle pause
seek <sec> absolute|relative   set_property speed 1.25
set_property volume 150        set_property mute true
set_property aid <id>          set_property sid <id|no>          set_property sub-visibility yes|no
get_property track-list        quit
af add @limiter:lavfi=[alimiter=limit=0.97]        af remove @limiter
af add @dialogue:lavfi=[dynaudnorm=f=150:g=15]     af remove @dialogue
```

- **Volume boost:** add `@limiter` whenever volume is above 100 and remove it at 100 or below, to prevent clipping. The UI slider turns a warning colour above 100.
- **Dialogue boost** is a separate user toggle (`@dialogue`).
- **Image subtitles** (PGS/VobSub): select the `sid` and set `sub-visibility yes`. mpv draws these itself; our overlay draws nothing for them.

### Subtitle text for the overlay (spike, mpv v0.41.0-1227, 2026-10-30)
- `sub-text` and `sub-text/ass` keep updating with `sub-visibility=no`, so text tracks are hidden that way and the overlay draws them. `sub-text-ass` is a deprecated alias (prints a warning); use `sub-text/ass`.
- Change notifications arrive within a few ms of the cue start. A seek while paused fires `undefined` then the line at the new position (~50 ms), so a paused seek into a cue shows it.
- Between files and with no track, the properties go `undefined`; with a track but no line, `""`. Treat both as "no line".
- `sub-add <path> <select|auto> <title> <lang>` works; the track shows `external: true` and `external-filename` (absolute path) in `track-list`.
- **As built (milestone 5):** on `file-loaded` the service finds subtitle files (`subtitles/match.ts`), `sub-add`s each UTF-8 copy with `auto` *before* reading `track-list`, then picks one. `selectSubtitle(id)` always sets `sid` and then `sub-visibility` (true only for picture-based tracks). `subtitles.cue` is emitted only while the current file is loaded, cleared to `null` on `loadfile`, on a track change and on stop. A downloaded file (`addSubtitle`) waits for the file's setup to finish, then is added with `select` and selected explicitly, so the automatic pick can't replace it.
- **Subtitle timing (milestone 6):** `sub-delay` is player-wide, not per track, so `selectSubtitle(id)` sets it to that track's stored offset (`player/subtitleDelay.ts`) *before* `sid`, on every selection: Off, a new file and the crash restore included (Off → 0). It also records `st.sid` at once rather than waiting for the `sid` observer. "Sync to a line" reads `get_property time-pos` in main at the key press. `addSubtitle` finds the added track by its file key (`Track.key`), not "the last external".
- **`sub-codepage=auto` does not decode legacy encodings** in this build: cp1252 "Café señor" came out as "CafÚ se˝or", cp1256 Arabic as wrong letters. So the app decodes external files itself and hands mpv a UTF-8 copy (`subtitles/decode.ts`, see subtitle-formats).

## Overlay window (controls and subtitles)

HTML can't be layered over mpv's surface inside the same window, so the controls and subtitles live in a second window:

```ts
new BrowserWindow({ parent: mainWin, transparent: true, frame: false, hasShadow: false,
  skipTaskbar: true, resizable: false, backgroundColor: '#00000000', webPreferences: {...} })
```

- The overlay is created **hidden at startup** (so no early `player.*` event is lost) with `parent: mainWindow`, and shown/hidden per play.
- Copy `mainWindow.getContentBounds()` to the overlay on `move`, `resize`, `maximize`, `unmaximize`, `enter-full-screen` and `leave-full-screen`. Use `setBounds`, not animations.
- The overlay receives all keyboard and mouse input while shown. Focusing the main window (Alt+Tab, taskbar) re-focuses the overlay. Closing the overlay (Alt+F4 lands there) closes the **app** instead, which saves first.
- Faded controls take no clicks; the first pointer movement brings them back.
- Hide the cursor after 2.5 s without movement during playback using CSS `cursor: none` on the overlay.

## Lifecycle and errors

- One mpv process per play session. When playback closes (or the app window closes), send `quit`, then kill the process if it hasn't exited within 1 s.
- **Unexpected exit:** log the stderr tail and respawn once. Then `loadfile`, `seek` to the last `time-pos`, and restore `aid`, `sid` and volume. If it dies again, show an error screen.
- `end-file` with `reason: "error"`: show "Can't play this file". Include the codec from ffprobe if one is known.
- Resume points are saved only after the resume seek has landed (`seek` event then `playback-restart`); mpv's first `time-pos` (0) must never overwrite a good position.
- Save the resume position every 10 s and on close (SQLite `playback_state`, one row per `video_id` — movies and episodes alike). Also write `duration_s` and `last_played_at`. Set `completed = 1` at end of file or once position ≥ 95 % of duration; the show page's Play/Continue logic (`src/main/library/showProgress.ts`) reads these.

## Debugging

Talk to a running mpv by hand from Node:

```js
const s = require('net').connect('\\\\.\\pipe\\vp-mpv-<pid>-<id>');
s.on('data', d => process.stdout.write(d));
s.write(JSON.stringify({ command: ['get_property', 'track-list'] }) + '\n');
```

Run mpv without `--wid` and with `--msg-level=all=v` to see whether a problem comes from embedding or from decoding.

## Per-title memory and tracks (milestone 4)

- `title_prefs` (migration 3), keyed by the wall key (`movie:<id>`, `tmdb:<id>`, `local:<show>`): volume (default 100), audio and subtitle as `{lang, kind, title}` (`subtitle` may be `"off"`). Never app-wide. A show's prefs move to `tmdb:<id>` when TMDB first matches it.
- Kinds: `forced` (mpv `forced`), `sdh` (`hearing-impaired` or a title with SDH/hearing), `commentary` (title), else `plain`. Matching: same language + kind → same language plain → same title → mpv's default.
- Nothing remembered: a forced subtitle in the audio's language still shows. Choosing Off while a forced track shows remembers `"off"`.
- Code: `src/main/player/` — `mpvIpc.ts` (client), `launch.ts` (spawn, raise, kill), `service.ts` (`PlayerService`: play/stop/command, resume, prefs, limiter, eof → `player.ended` / close, crash respawn), `overlay.ts`, `setup.ts`. Renderer: `src/renderer/overlay/`. Events go to every window (`src/main/broadcast.ts`).
