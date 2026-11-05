# Milestone 9: Polish (design)

## Intent

The user lived with the app for a few days and listed what bothered them. Fix exactly that list, so the app feels finished before it goes to other people in milestone 10.

## Goals

1. **Esc in the player:** in fullscreen, Esc leaves fullscreen and playback continues. Outside fullscreen, Esc does nothing. Esc never closes the movie.
2. **Click to pause:** clicking the video pauses or resumes it.
3. **The line near the top:** the thin line that appears during playback when the mouse moves is gone.
4. **"Ends at":** a title's page shows when it would finish if started now, for example "Ends at 11:42 PM".
5. **☰ in search:** the menu opens above search, and picking a page goes there.

## Non-goals

- The design audit, accessibility pass and settings work once listed for this milestone. The user said the five items above are all the changes (dropping the rest was proposed and accepted).
- The deferred minor items from earlier milestones' design docs.
- Packaging. About and licence notices move to milestone 10, since they ship with the installer.

## Approaches: click to pause and double-click

Double-click already toggles fullscreen, so the two gestures clash.

1. **Pause instantly; a double-click undoes it (chosen by the user).** Every click responds at once, as in YouTube and Netflix in a browser. A double-click makes film and sound hiccup for about 0.2 s.
2. **Wait about 0.2 s for a second click.** Double-clicks are clean, but every ordinary pause lags, and pausing is far more common than switching to fullscreen.
3. **Remove double-click for fullscreen.** Simplest, but loses a gesture people expect from a video player.

The other four items have one sensible fix each.

## Behaviour

### Esc (`src/renderer/overlay/Overlay.tsx`)

In this order:
1. A panel or menu that is open takes the key and closes (track menu, style, search, sync, auto sync, offset, confirm). The same press must not also leave fullscreen.
2. Otherwise, if fullscreen, leave fullscreen. Playback doesn't change.
3. Otherwise nothing. This includes the next-episode card and an error message, which keep their own buttons.

✕ becomes the only way to close the player. It keeps working as it does now, including leaving fullscreen on close.

### Click (`Overlay.tsx`)

- A click on the video toggles pause. The dark strips behind the top and bottom controls count as video; the controls themselves keep their own job.
- Double-click toggles fullscreen over the same area. Two clicks pause and resume, then fullscreen toggles (approach 1).
- With a menu open, a click only closes the menu.
- *Builder's call, flagged for review:* ignore clicks when nothing is loaded or the next-episode card is showing, and don't pause when a seek-bar or volume drag is released over the video.

### The line

Don't guess at the fix: reproduce first (`systematic-debugging`).

Lead from the user's screenshot (`C:\Users\varsh\Pictures\Screenshots\Screenshot 2026-11-02 221929.png`): a hard edge about 26 px down, which is where the ✕'s position puts the top of the overlay window. The top gradient (`.player-top`) starts at 62% black, so if the overlay sits lower than the video, that start is a visible line, and it only shows while the controls show, which matches "when I move the mouse". Suspect `overlay.ts` `setBounds(main.getContentBounds())`, particularly in fullscreen or at a display scale above 100%. This is unconfirmed.

Done means no line in windowed or fullscreen mode, at the user's display scale.

**Cause (confirmed by measuring):** Electron's default menu bar is 26 px tall and sits inside the client area, which mpv fills completely. `getContentBounds()` starts below that bar, so the overlay started 26 px under the video's top. In fullscreen the bar goes away but `enter-full-screen` reads the old bounds, leaving the overlay 26 px low there too (the user's screenshot). Hiding the bar only during playback doesn't work: content bounds update late and no event says so. **Fix:** `Menu.setApplicationMenu(null)` at startup, so nothing ever separates the two rectangles. (First built as `win.removeMenu()`; the final review found the overlay kept the default menu, so its shortcuts still acted on the controls during playback.) *My call, visible beyond the player:* File/Edit/View is gone from every page, along with its shortcuts (F11, Ctrl+R, Ctrl+Shift+I, zoom).

### "Ends at" (`src/renderer/src/pages/Title.tsx`, data from `library/queries.ts`)

- Shown near the main button, for what that button would play: a movie, or a show's next-up episode. Other episodes in the list don't get a time.
- Time counted: what's left if the main button continues; the full length if it starts from the beginning, including a finished film being rewatched.
- Uses the video file's own duration, not TMDB's runtime. If the duration is unknown, show nothing.
- Updates by itself while the page stays open, without being more than a minute out.
- Follows the Windows 12- or 24-hour setting.
- *Builder's call:* the exact wording and placement beside the existing time-left text, in the existing `title-left` style.

### ☰ in search (`src/renderer/src/app.css`, `search/search.css`)

The drawer (`z-index: 20`) and `.search-overlay` (`z-index: 20`) tie, and search comes later in the page, so it covers the drawer. Order them: search, then scrim, then drawer, then the menu button, also checking the title page and the wall's info card. `navigate` already closes search, and Esc in search keeps working.

## Tests

Test first for each behaviour:
- **E2E player:** Esc in fullscreen (leaves it, still playing), Esc when windowed (still open, still playing), Esc with a panel open in fullscreen (panel closes, still fullscreen), click pauses and resumes, double-click ends in fullscreen and still playing, click with a menu open doesn't pause. The existing tests that use Esc to close the player switch to ✕.
- **Unit:** the "Ends at" calculation (continuing, from the start, finished, unknown duration).
- **E2E search:** from open search, ☰ then Home reaches Home and ☰ then Settings reaches Settings.
- **The line:** a regression test if the cause can be tested (for example overlay bounds against main bounds in fullscreen), otherwise a screenshot check the user confirms.

Windows open on the second monitor, as in every E2E spec.

## Deferred

Found in the final reviews and left for later. All are rare or cosmetic.

- A double-click with a menu open ends paused in fullscreen (one more click recovers).
- With the controls faded, a double-click where a hidden button sits pauses, then presses that button (over ✕, it closes the player).
- The bar's play button sends its own pause, not `togglePause`, so a press within moments of a video click can be lost.
- Closing the ☰ menu in search returns focus to the box, not the card you were on. After ☰ then Esc, Enter opens the top result.
- `getInfo` runs on every title page open just to read `hour12`; it could be fetched once.
- Cleanups: the `.subs` clause in `isVideoSurface` never fires (`pointer-events: none`), and `endsAt` has a literal U+202F in its regex that should be written ` `.
- Test gaps: no E2E for clicking the video with the Replace prompt open, the Replace prompt or sync cards with Esc and focus outside, and the Windows clock test only checks the type.
- Older than this milestone: the subtitle style panel can lose one step in a fast run of key presses, probably when a late style from main overwrites the draft (`StylePanel.tsx`). Seen once in full E2E runs as `subtitleStyle.spec.ts` ending at 140% rather than 150%; it passed 8 of 8 alone.
