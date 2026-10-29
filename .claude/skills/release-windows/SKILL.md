---
name: release-windows
description: Building and releasing the Windows app — fetching pinned mpv/ffmpeg binaries into vendor/, building the Python sync sidecar with PyInstaller, electron-builder NSIS config and extraResources, runtime binary path resolution, code signing, versioning, third-party license/attribution obligations (mpv GPL, ffmpeg LGPL, TMDB), and the pre-release smoke test. Use when packaging, preparing a release, changing build config, or touching vendor/ or scripts/fetch-vendor.*.
---

# Windows release

**Never publish a release, upload artifacts, or push tags without the user's explicit permission.** Building locally is fine.

## 1. Vendor binaries (`scripts/fetch-vendor.mjs` → `vendor/`, gitignored)
- `vendor/manifest.json` (committed) pins each binary's **URL, version and SHA-256**. The script downloads to a temp directory, checks the hash, then extracts. A mismatch is a hard failure.
- **mpv:** a Windows x86_64 build from the shinchiro `mpv-winbuild-cmake` GitHub releases. Use plain `x86_64` (not `-v3`) for compatibility with older CPUs. We only need `mpv.exe` and its DLLs.
- **ffmpeg/ffprobe:** a BtbN `FFmpeg-Builds` **LGPL shared** win64 build. The app only decodes and extracts, so it needs no GPL encoders.
- Treat downloaded archives as untrusted: extract into a fresh empty directory and run nothing from inside it.
- Update binaries by bumping the manifest, re-running the script, and running the full smoke test.
- The app has no native Node modules. SQLite is the built-in `node:sqlite`, so nothing needs `electron-rebuild` or `asarUnpack`.

## 2. Resolving binary paths at runtime
```ts
export const resolveBinary = (name: 'mpv' | 'ffmpeg' | 'ffprobe' | 'sidecar') => {
  const base = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), '..');
  return { mpv: 'vendor/mpv/mpv.exe', ffmpeg: 'vendor/ffmpeg/ffmpeg.exe',
           ffprobe: 'vendor/ffmpeg/ffprobe.exe', sidecar: 'sidecar/vp-sync/vp-sync.exe' }[name]
           .split('/').reduce((p, s) => path.join(p, s), base);
};
```
This is the only place that knows binary locations. Pass the ffmpeg path to the sidecar in the `VP_FFMPEG` environment variable.

## 3. Sidecar
`sidecar\.venv\Scripts\pyinstaller sidecar/build.spec --noconfirm` produces `sidecar/dist/vp-sync/`. Details are in `subtitle-sync-ml`. Smoke-test it on its own: `echo {"id":1,"method":"ping"} | sidecar\dist\vp-sync\vp-sync.exe`.

## 4. electron-builder (`electron-builder.yml`)
```yaml
appId: com.shrivarshaan.videoplayer
productName: <final app name>
asar: true
directories: { output: release }
extraResources:
  - { from: vendor, to: vendor }
  - { from: sidecar/dist/vp-sync, to: sidecar/vp-sync }
  - { from: THIRD_PARTY_NOTICES.md, to: THIRD_PARTY_NOTICES.md }
win:
  target: [{ target: nsis, arch: [x64] }]
  icon: build/icon.ico            # 256x256 multi-size .ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false
  deleteAppDataOnUninstall: false  # keep library DB, synced offsets, models unless user opts in
fileAssociations:                  # optional, ask user first
  - { ext: [mkv, mp4, avi, mov, webm, m4v], name: Video, role: Viewer }
```
Build steps: `npm run build`, then `npx electron-builder --win`. The installer lands in `release/`, which is gitignored.

## 5. Code signing
- Without signing, SmartScreen shows "Windows protected your PC". That's acceptable for personal use.
- For distribution, use **Azure Trusted Signing** (`win.azureSignOptions`) or an OV/EV certificate (`win.signtoolOptions`). Keep credentials in environment variables, never in the repo.
- Sign `mpv.exe`, `ffmpeg.exe` and `vp-sync.exe` too (`signExts` / `signAndEditExecutable`).

## 6. Versioning
- Use SemVer in `package.json`. Update `CHANGELOG.md` (Keep a Changelog format).
- Tag `vX.Y.Z` locally. Pushing the tag and creating a GitHub release happen **only with the user's permission**.
- Auto-update (`electron-updater` with GitHub releases) is optional. Ask the user before adding it.

## 7. Licenses and attribution (`THIRD_PARTY_NOTICES.md`, also shown in Settings → About)
| Component | License | Obligation |
|---|---|---|
| mpv (shinchiro build) | GPL-2.0+ (build includes GPL parts) | Ship the license text and give a link to the exact source and build scripts. It runs as a separate executable over IPC. |
| FFmpeg (LGPL shared) | LGPL-2.1+ | Ship the license, link to the source, keep the DLLs replaceable (shared build). |
| Electron, React, Fuse.js etc. | MIT and others | Include the license texts (`license-checker --production --summary`). |
| ffsubsync, faster-whisper, CTranslate2, Whisper weights | MIT | Include the license texts. |
| TMDB | API terms | Show *"This product uses the TMDB API but is not endorsed or certified by TMDB."* with the TMDB logo in About. |

This is engineering guidance, not legal advice. Flag to the user before any public or commercial distribution.

## 8. Pre-release smoke test (clean machine or Windows Sandbox)
- [ ] The installer runs and the app launches. No console windows flash, because child processes use `windowsHide`.
- [ ] Choose a folder → the wall fills, posters load, and offline mode falls back to frame thumbnails.
- [ ] Play each clip from `test-media-fixtures`: mp4, mkv HEVC, webm, avi, mov, ts, AV1.
- [ ] Embedded and external subtitles render in the Apple TV style. PGS falls back to mpv.
- [ ] Volume at 200 % stays clean (limiter on). Dialogue boost toggles.
- [ ] G/H offset, sync-to-line and two-point sync work. Export writes `.synced.srt`.
- [ ] Fast sync on `speech.shift+3.2.srt` works. Deep sync downloads its model with a consent prompt and handles `speech.cut45.srt`.
- [ ] Search (`/`, chips, keyboard) works.
- [ ] Uninstall removes the app and keeps user data unless the user chose otherwise.
