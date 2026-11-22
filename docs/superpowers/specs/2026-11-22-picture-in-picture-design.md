# Picture in picture — design

## Intent

Keep watching a movie or episode in a small floating window while working in other apps. A button in the player's bottom bar, left of **Audio**, appears with the other controls when the mouse moves. Clicking it puts what is playing into picture in picture (PiP).

## Goals

- Enter PiP with the button or **P**. Playback carries on without a gap, keeping its position, audio track, subtitle, offset and volume.
- The floating window stays on top of other apps, can be dragged and resized, and keeps a 16:9 shape.
- Return to full size with no change to the window's earlier size, position or full-screen state.

## Non-goals

- Seeing the library while PiP plays. The floating window *is* the app window, so the library is hidden behind it.
- Audio/Subtitles menus, style, search and timing tools inside PiP. Use them at full size.

## Anti-goals

- Any blip, restart or second mpv when entering or leaving PiP.
- A line or gap between the picture and the window edge (see the menu-bar gotcha in `CLAUDE.md`).

## Constraints

- mpv draws into the main window through `--wid`. The controls live in the overlay window, which follows the main window's content bounds (`player/overlay.ts`). Chromium's `requestPictureInPicture` can't be used because there is no `<video>`.

## Approaches

- **A. The main window becomes the floating player (chosen).** Save the window's bounds and full-screen state, then make it small, frameless-looking and always on top. mpv and the overlay follow it. Seamless, and the smallest change.
- B. A separate PiP window, with mpv's child window moved into it with `SetParent` (koffi). This means more fragile native code, a black main window left behind, and no gain for use alongside other apps.
- C. A separate PiP window running a second mpv at the same position. It blips, tracks and subtitles have to be re-applied, and two players run.

The user picked A. Their use is working in other apps, so the library doesn't need to stay visible.

## Behaviour (agreed)

- **Enter:** the PiP button (rectangle-in-rectangle icon, left of Audio) or **P**. If full screen, leave it first. Open menus and panels close. The window goes to about 480×270 in the bottom-right corner of the work area of its current display, about 24 px from the edges. It is always on top and has no title bar.
- **While floating:** drag by the picture and resize from the edges, with the 16:9 aspect locked. Subtitles keep their style, scaled to the smaller window. Mouse movement shows compact controls: play/pause, back/forward 10 s, a thin seek bar, a "back to full size" button in a top corner, and a close ✕. Double-clicking the picture returns to full size.
- **Leave:** the button, **P**, or a double-click. The window gets back the bounds, maximized state and full-screen state it had before.
- **Remembered:** the floating window's position and size are stored and used the next time. Fall back to the default corner if that spot is no longer on any display.
- **Episodes:** the next episode keeps playing in PiP.
- **Close ✕:** the player's normal close (position saved). The window returns to full size and shows the title page.

## Left to the builder

- How the frameless look is achieved on an existing framed window. Options are `setAlwaysOnTop('floating')` plus hiding the title bar, or `titleBarOverlay`, or a `setBounds` on the content area. Pick whatever keeps `getContentBounds()` exact for the overlay.
- How dragging works when the transparent overlay sits over the picture (for example, a drag region in the overlay that moves the main window through IPC, or `-webkit-app-region: drag` on the overlay plus moving the main window to match).
- Where the remembered PiP bounds are stored (a settings row in the DB is fine).
- How subtitle scaling works in the small window (subtitle size already depends on the overlay's size; check that it reads well at 480×270).
- Unit tests for the pure parts (default corner, aspect-locked resize, clamping to displays). Add an E2E test: enter PiP, playback position keeps moving, leave PiP and the earlier bounds come back.
