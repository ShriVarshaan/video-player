# Milestone 10: Packaging and publishing (design)

## Intent

Turn the player into something other people can install, set up and keep up to date without help, and without the project's developer tools. Until now it has only run from the repo.

The audience is people the user gives it to, who are willing to sign up for free accounts but may never have heard of TMDB. The installed app has to explain itself.

## Goals

1. The app is named **Cinewall**, with its own icon.
2. A normal Windows installer, unsigned, with a short note on getting past SmartScreen.
3. A first-run setup walks people through TMDB, OpenSubtitles and choosing a folder.
4. Updates arrive from GitHub Releases, and people choose whether to take them.
5. Settings → About carries the version, update check and licence notices.
6. The code is MIT licensed.
7. One command builds a release as a draft on GitHub, for the user to publish.

## Non-goals

- Code signing.
- Opening a video by double-clicking it in File Explorer (user's decision). Cinewall plays library titles only, and this would be new work.
- Forced updates. Someone can stay on a bad release if they skip it (accepted by the user).
- Building releases on GitHub's servers. It can come later without changing the app.
- Crash reports or analytics. Nothing leaves the PC except calls to TMDB and OpenSubtitles and the update check on GitHub.
- The minor items deferred in the milestone 9 design doc.

## Anti-goals

- A TMDB or OpenSubtitles credential in the installer, the repo or any file. Each user brings their own.
- An update prompt or restart during a film.
- A first-run setup that blocks someone from watching because a sign-up is pending or they are offline.
- Losing someone's library, progress or saved logins through an update, a rename or a reinstall.

## Constraints

- Windows x64 only. Electron 45, electron-vite, mpv, ffmpeg and the sidecar are as they are today.
- `%APPDATA%\video-player` stays the data folder despite the rename (`src/main/paths.ts` pins it). It holds the library and the keys encrypted with DPAPI, so moving it would lose them. Default Electron behaviour would otherwise follow the product name.
- `release-windows` is the source of truth for vendor binaries and licence duties; update it where this design changes it.
- **Publishing needs the user's explicit permission every time.** Never tag, push a tag or publish without it. A GitHub token goes through an environment variable for one command only, and is never written to any file, commit or memory.
- Windows test runs stay on the second monitor (the primary if it isn't connected).
- The user's PC runs Windows 11 Home, which has no Windows Sandbox. **A friend's PC is the clean-machine check (user's decision).** The installed-build check on it happens before the merge, so the milestone waits on the friend.

## Approaches

**Installer and updates.** electron-builder with NSIS, plus electron-updater, is the one sensible way here. It gives a setup wizard, a choice of folder and a prompt we control. Squirrel (Electron Forge) has no wizard or folder choice. A hand-written updater would redo download and integrity checks that already exist.

**Where releases are built:**
1. **On the user's PC with one command (chosen by the user).** Little to set up, and reuses the sidecar the tests already run. A release depends on that PC's setup and needs a token for that one command.
2. **On GitHub's servers when a version tag is pushed.** Every release comes from a clean machine, but it needs mpv, ffmpeg and the Python helper rebuilt there, and each failed attempt can mean a long wait.

Releases are occasional, so 1 is enough for now.

## Behaviour

### Name and icon

- `productName`, the window title, the installer, the Start menu and every user-visible "Video Player" become **Cinewall**. The npm package name and data folder stay `video-player`.
- `appId` is `com.shrivarshaan.cinewall`.
- The icon is logo C from the brainstorm: a white play button cut into three vertical bands, on a rounded square with an amber-to-red gradient (top left `#ffb347`, bottom right `#e8452f`). Master artwork is an SVG, committed along with a multi-size `.ico` (16 to 256 px) generated from it.
- The geometry on a 512 unit canvas: square corner radius 112; triangle `(166,104) (166,408) (408,256)`, kept only inside the bands `x 166–228`, `242–304` and `318–408`.

### First-run setup

**When it shows:** on launch, when setup hasn't been completed and the library has no folders. Someone who already has a folder (the user's own library, a reinstall) never sees it. Finishing sets a stored flag, so removing every folder later doesn't bring it back; the existing empty-wall message handles that.

Layout A from the brainstorm: full window, dark, one job per screen, with a "Step N of 3" indicator. Order:

1. **TMDB (skippable).** Says what it's for and that it's free. Numbered instructions with links to sign up and to the API settings page, then one field that takes an API key or a read access token.
2. **OpenSubtitles (skippable).** Same style. Three fields: API key, username, password. Says it's used when searching for subtitles online.
3. **Your movies and shows (required, no skip).** Opens the folder picker. The app has nothing to show without a folder. Cancelling the picker stays on this step. This is last so that the scan can fetch posters straight away.

**Checking:** the main button is "Check and continue". TMDB gains a check call; OpenSubtitles reuses the existing `testAccount`.
- Valid: saved, next step.
- Rejected: says so on the step, and they can correct it or skip.
- Couldn't reach the service: says so, and lets them save it unchecked and continue or skip. Being offline must not trap anyone.

**"Skip for now"** is small text, with one line saying what they'll miss. Everything stays editable in Settings.

**Links** open in the default browser, not inside the app. Windows are locked against navigation (`guard` in `index.ts`), so add an IPC call that opens only URLs from a fixed list in main. The renderer can't pass an arbitrary URL.

**Reminder on Home:** while no TMDB key is saved, Home shows a quiet reminder with a button to Settings, until a key is saved. There's no such reminder for OpenSubtitles: the player's "Search online" already explains what's missing.

### Updates

- **Checking:** shortly after startup and every few hours (builder's choice, 4 to 6). Failures stay silent and retry at the next check.
- **The card:** a small card on Home with the new version number and a few lines from the release notes. Notes are shown as plain text, never as HTML. It doesn't show during a film: if a check finds an update then, the card waits until the player closes. It stays out of the way of the wall, title pages and search; if one is open it shows when Home is next visible.
- **Install:** only now does the download start, since downloading an update someone may skip wastes their data. A progress bar shows on the card, and they can keep browsing. When it's ready the app quits and restarts into the new version. If a film has started by then, the restart waits until the player closes. A failed download says so on the card, with a retry.
- **Remind me later:** the card returns the next time the app opens, not again that session.
- **Skip this version:** the skipped version is stored and the card stays away until a newer one exists.
- **Settings → About → Check for updates:** always offers the latest version, including a skipped one. It also shows "You're up to date" or that the check failed.
- **Development builds** don't check. E2E needs a way to feed the card a fake update without a network call, in dev builds only, as `VP_TMDB_MODE` does.
- **Integrity:** electron-updater's SHA-512 check against the release's own metadata. Without signing that catches corruption, not a takeover of the GitHub account. The user was told, and should use two-factor authentication.

### Settings → About

Replaces today's developer details:
- Version, Check for updates.
- A link to the source on GitHub, and the MIT licence.
- Third-party notices, viewable in the app, from a shipped `THIRD_PARTY_NOTICES.md`: mpv (GPL, with a link to the exact source and build scripts for the pinned version), FFmpeg (LGPL, likewise), koffi, the bundled npm packages and the sidecar's packages (`docs/third-party-sidecar.md`).
- The TMDB attribution line and logo.

The "missing binary" rows and the `npm run fetch-vendor` hint show in development builds only. In an installed app a missing binary is a broken install, so it needs a plain message rather than developer advice.

### Installer and uninstall

- NSIS wizard (not one-click), per user with no admin password, folder can be changed. Start menu and desktop shortcuts.
- Contents: the app, `vendor/` (mpv, ffmpeg), the built sidecar and the notices. Unpack koffi's native binary from the asar. Include only what the app uses; tests and fixtures stay out.
- **Uninstall** removes the app and asks whether to also delete the library, watch progress and saved logins, with the default being to keep them. Because the data folder is `video-player`, electron-builder's own option won't find it, so this needs a custom NSIS step. It **must not** ask or delete during an update, which runs the uninstaller silently.
- **Install note:** on the GitHub release page and in the README: download, then "Windows protected your PC" → More info → Run anyway. Also say the app is unsigned, why, and that the free accounts are needed.

### Licence and repo

- `LICENSE` with the MIT text under the author's name, `package.json` licence set to MIT.
- A short `README.md` for people arriving at the repo: what it is, the logo, install note, how to build. There's none today. *My call:* no screenshots of the wall for now, since fixture mode shows placeholder posters and the user's real library shouldn't go public. The user can add some later.
- A `CHANGELOG.md`, whose entries feed the release notes.

### Releasing

`npm run release`, run only with the user's permission, with the token in the environment for that one command. In order:
1. Stops unless on a clean `main` matching `origin/main`, with the version in `package.json` not already released.
2. Checks vendor hashes, runs typecheck, unit, sidecar and E2E tests.
3. Builds the sidecar and app, then the installer.
4. Uploads a **draft** GitHub release with the installer and update metadata, using the changelog entry as notes.

The user tests the draft installer and publishes it by hand. Publishing is what reaches people. The first public version is **1.0.0** (my call).

*My call, on where the milestone ends:* the milestone is done when the local installer has passed the friend's check and the update check, and the branch is merged and pushed to `main`. `npm run release` needs a clean `main`, so the first draft comes after that, as a separate step with the user's permission. "Not already released" in step 1 means published. A bug found in a draft is fixed on `main` and the draft is replaced at the same version; once published, a fix takes a new version.

## Tests

Test first wherever the code can be tested without an installer:
- **Unit:** when setup shows (fresh; has a folder; already completed); the card's choice given current version, skipped version, session "later" and manual check; the URL allow-list; plain-text release notes.
- **E2E:** fresh launch reaches setup and an existing library doesn't; each step's valid, rejected, unreachable and skip paths using fixtures; the folder step can't be skipped; the Home reminder comes and goes; the update card's three buttons, and that it doesn't show during a film. `launchApp` must stop first-run setup getting in the way of the 120+ existing tests.
- **Installed build on the friend's PC (manual), checklist added to `release-windows`:** the user sends the friend an installer from a local build with no upload, plus a short plain-language checklist a non-developer can follow. The friend signs up for their own accounts, so the user's keys are never shared. It covers: SmartScreen and install, first-run with real sign-ups, posters, playing a film of their own, subtitles, auto sync using the bundled sidecar, no console windows flashing, and uninstalling both ways. The friend reports back to the user, and any bug gets fixed and a new build goes back to them.
- **Update from an installed older version to a newer one (on the user's PC, driven by Claude):** a local test feed on localhost and `--user-data-dir` pointing at a temporary folder, so the user's real library is not touched. It checks the card's three choices, the restart, and that the test library and logins survive. A test-only build setting points at the feed; shipped builds can only use GitHub.
- **Real GitHub delivery** can only be fully proven by the second release, when the friend's 1.0.0 updates itself. Say so when the first release goes out.

## Left to the builder

- Exact wording, the look of the setup screens within the mockup, and the update card's position on Home.
- The check interval (4 to 6 hours) and the exact sign-up URLs (verify they work).
- How electron-updater is wired behind the existing `registerDomain`, and how the settings flags are stored.
- Which sidecar and vendor files can be trimmed from the install, if they are provably unused.

## Mockups

The chosen first-run layout and logo are in `.superpowers/brainstorm/561-1793893626/content/` (`first-run-layout.html`, option A; `logo-options.html`, option C). That folder is git-ignored; the geometry above is the record.
