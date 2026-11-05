---
name: release-windows
description: Building and releasing the Windows app (Cinewall) — fetching pinned mpv/ffmpeg binaries into vendor/, building the Python sync sidecar with PyInstaller, electron-builder NSIS config and extraResources, runtime binary path resolution, auto-update, versioning, third-party license/attribution obligations (mpv GPL, ffmpeg LGPL, TMDB), the friend's-PC check and the update test. Use when packaging, preparing a release, changing build config, or touching vendor/ or scripts/fetch-vendor.*.
---

# Windows release

**Never publish a release, upload artifacts, or push tags without the user's explicit permission.** Building locally is fine. A GitHub token gets the same treatment as other secrets: in the environment for one command, never in a file, commit or memory.

The app is **Cinewall**; the repo and npm package stay `video-player`, and so does the data folder `%APPDATA%\video-player` (`src/main/paths.ts`). Renaming that folder would lose people's libraries and DPAPI-encrypted logins.

## 1. Vendor binaries (`scripts/fetch-vendor.mjs` → `vendor/`, gitignored)
- `vendor/manifest.json` (committed) pins each binary's **URL, version and SHA-256**. The script downloads to a temp directory, checks the hash, then extracts. A mismatch is a hard failure.
- **mpv:** a Windows x86_64 build from the shinchiro `mpv-winbuild-cmake` GitHub releases. Use plain `x86_64` (not `-v3`) for compatibility with older CPUs. We only need `mpv.exe` and its DLLs.
- **ffmpeg/ffprobe:** a BtbN `FFmpeg-Builds` **LGPL shared** win64 build. The app only decodes and extracts, so it needs no GPL encoders.
- Treat downloaded archives as untrusted: extract into a fresh empty directory and run nothing from inside it.
- Update binaries by bumping the manifest, re-running the script, updating `LINKS.mpvSource`/`ffmpegSource` in `src/shared/links.ts` and `make-notices`, and running the full suites. `tests/unit/notices.test.ts` catches a mismatch.

## 2. Resolving binary paths at runtime
`src/main/paths.ts` → `binaryPath(name, base)` maps `mpv` → `vendor/mpv/mpv.exe`, `ffmpeg`/`ffprobe` → `vendor/ffmpeg/*.exe`. `sidecarCommand` finds `sidecar/vp-sync/vp-sync.exe`. `src/main/index.ts` picks the base:
```ts
const binaryBase = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..')
```
Don't use `app.getAppPath()` in development: it's `out/main` when Electron is launched with a file path (Playwright does this). `paths.ts` is the only place that knows binary locations. The ffmpeg path reaches the sidecar in the `VP_FFMPEG` environment variable.

## 3. Sidecar
`npm run setup-sidecar` (once), then `npm run build-sidecar` produces `sidecar/dist/vp-sync/` (about 58 MB). Details are in `subtitle-sync-ml`. `npm run test:sidecar` also runs `test_built_exe_syncs` when the build exists. `sidecar/hooks/hook-webrtcvad.py` overrides the contrib hook, which looks for the wrong distribution name. The bundled packages and their licences are listed in `docs/third-party-sidecar.md` (auditok, GPLv3, is excluded); `make-notices` reads that table.

## 4. electron-builder (`electron-builder.yml`)
- NSIS wizard, per user, folder can be changed; `appId com.shrivarshaan.cinewall`; artifact `Cinewall-Setup-<version>.exe`.
- `koffi` is unpacked from the asar (`asarUnpack`), since a native `.node` can't load from inside it. The app has no other native modules; SQLite is the built-in `node:sqlite`.
- `extraResources`: `vendor/` (minus the manifest), `sidecar/dist/vp-sync` → `sidecar/vp-sync`, `THIRD_PARTY_NOTICES.md`.
- `build/installer.nsh`: the uninstaller asks whether to delete `%APPDATA%\video-player`, default No. It **must not** ask or delete on an update: `isUpdated` and `/SD IDNO` cover that. electron-builder's own delete option wouldn't find the folder.
- **No file associations**: double-click opening was left out of milestone 10 by the user.
- `npm run package` builds the installer into `release/`; `npm run test:packaged` then tests `release/win-unpacked` from a folder with accents and spaces, and proves dev switches are ignored.

## 5. Signing
Unsigned, on purpose: SmartScreen shows "Windows protected your PC", and `docs/INSTALL.md` explains More info → Run anyway. `signAndEditExecutable: true` only writes the icon and version into the exe. electron-updater's SHA-512 check catches corruption, not a takeover of the GitHub account, so the account should use two-factor authentication.

## 6. Updates (`src/main/updates/`)
- `service.ts` is pure: the rules for Install, Remind me later (session only), Skip (setting `updates.skipped`) and manual checks. `adapter.ts` has the real electron-updater (`autoDownload` and `autoInstallOnAppQuit` off) and the fixtures. `setup.ts` checks after 15 s, then every 4 hours.
- Nothing downloads until Install, and the app never restarts during a film: the renderer waits, and main refuses while `player.current()` is set.
- `VP_UPDATE_MODE=available|fail-check|fail-download` feeds fake updates in development builds only. Packaged builds always use the GitHub feed, except the update test's builds below.

## 7. Versioning and releasing
- SemVer in `package.json`; `CHANGELOG.md` has a section per version, which becomes the release notes.
- `GH_TOKEN=… npm run release`, only with the user's permission and only from a clean `main` matching `origin/main`: checks (`scripts/releaseChecks.mjs`), then fetch-vendor, typecheck, unit, sidecar and E2E tests, sidecar and app builds, then a **draft** GitHub release. Only the upload step sees the token.
- The user tests the draft installer and publishes it by hand. Publishing is what reaches people. A bug in a draft: fix on `main` and run it again at the same version. Once published, a fix takes a new version.
- Real GitHub delivery is only proven by the second release, when an installed 1.0.0 updates itself. Say so when the first release goes out.

## 8. Licenses and attribution (`THIRD_PARTY_NOTICES.md`, also in Settings → About)
`npm run make-notices` generates the committed file, and stops if any licence text is missing. `build/licenses/` holds texts that packages don't ship.

| Component | License | Obligation |
|---|---|---|
| mpv (shinchiro build) | GPL-2.0+ | Ship the license text and link to the exact source and build scripts. It runs as a separate executable over IPC. |
| FFmpeg (LGPL shared) | LGPL-2.1+ | Ship the license, link to the source, keep the DLLs replaceable (shared build). |
| Electron, React, Fuse.js etc. | MIT and others | Include the license texts. |
| Auto sync sidecar | MIT, BSD, Apache-2.0, MPL, PSF | Include each license text. No GPL code: auditok is excluded. |
| TMDB | API terms | Show *"This product uses the TMDB API but is not endorsed or certified by TMDB."* with the TMDB logo in About. |

This is engineering guidance, not legal advice. Flag to the user before any commercial distribution.

## 9. Before a release

**Clean machine:** this PC runs Windows 11 Home, which has no Windows Sandbox. A friend's PC is the clean machine. Send them the local installer (`npm run package`, nothing uploaded) and `docs/friend-test-checklist.md`. They use their own accounts, so the user's keys are never shared. Any bug gets fixed and a new build goes back to them.

**Update test on this PC:** `node scripts/update-test.mjs` installs a 0.9.0 test build and updates it to 1.0.0 from a feed on localhost. It keeps its data in `%APPDATA%\video-player-update-test` (build-time `VP_DATA_FOLDER`), never the real library, and refuses to run if Cinewall is already installed here.
