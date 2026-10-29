---
name: mpv-ipc
description: How this app embeds and controls mpv on Windows — launch flags, --wid embedding into an Electron window, the JSON IPC protocol over a named pipe, observed properties, the transparent overlay window, volume boost and audio filters, and crash/restart handling. Use whenever touching PlayerService, src/main/player/*, the player or overlay windows, playback controls, audio/subtitle track selection, volume boost, or debugging anything mpv-related.
---

# mpv control in this project

mpv runs as a **child process** (`vendor/mpv/mpv.exe`) that draws into the player `BrowserWindow`'s native handle. All control goes through **JSON IPC on a Windows named pipe**. We do not use libmpv bindings, mpv.js or the render API. Keep it that way unless the user decides otherwise.

## Launch

```ts
const hwnd = playerWin.getNativeWindowHandle().readBigUInt64LE(0).toString();
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
  '--sub-visibility=no',         // we draw text subs ourselves (see subtitle-formats)
  '--msg-level=all=warn',
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
```

- `resolveBinary` returns `process.resourcesPath/vendor/...` when packaged and `<repo>/vendor/...` in dev. Never hardcode paths.
- Pass file paths only as IPC arguments (`loadfile`), never pasted into a shell string.
- The player window background must be `#000` so letterboxing matches before the first frame arrives.

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
| 7 | `eof-reached`, `idle-active`, `paused-for-cache` | End screen and spinner |

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

## Overlay window (controls and subtitles)

HTML can't be layered over mpv's surface inside the same window, so the controls and subtitles live in a second window:

```ts
new BrowserWindow({ parent: playerWin, transparent: true, frame: false, hasShadow: false,
  skipTaskbar: true, resizable: false, backgroundColor: '#00000000', webPreferences: {...} })
```

- Copy `playerWin.getContentBounds()` to the overlay on `move`, `resize`, `maximize`, `unmaximize`, `enter-full-screen` and `leave-full-screen`. Use `setBounds`, not animations.
- The overlay receives all keyboard and mouse input. The player window never takes focus.
- Hide the cursor after 2.5 s without movement during playback using CSS `cursor: none` on the overlay.

## Lifecycle and errors

- One mpv process per player window. When the window closes, send `quit`, then kill the process if it hasn't exited within 1 s.
- **Unexpected exit:** log the stderr tail and respawn once. Then `loadfile`, `seek` to the last `time-pos`, and restore `aid`, `sid` and volume. If it dies again, show an error screen.
- `end-file` with `reason: "error"`: show "Can't play this file". Include the codec from ffprobe if one is known.
- Save the resume position every 10 s and on close (SQLite `playback_state`, one row per `video_id` — movies and episodes alike). Also write `duration_s` and `last_played_at`. Set `completed = 1` at end of file or once position ≥ 95 % of duration; the show page's Play/Continue logic (`src/main/library/showProgress.ts`) reads these.

## Debugging

Talk to a running mpv by hand from Node:

```js
const s = require('net').connect('\\\\.\\pipe\\vp-mpv-<pid>-<id>');
s.on('data', d => process.stdout.write(d));
s.write(JSON.stringify({ command: ['get_property', 'track-list'] }) + '\n');
```

Run mpv without `--wid` and with `--msg-level=all=v` to see whether a problem comes from embedding or from decoding.
