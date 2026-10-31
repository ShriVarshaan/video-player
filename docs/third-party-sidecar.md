# Third-party code in the auto sync sidecar

What `npm run build-sidecar` bundles into `sidecar/dist/vp-sync/` (PyInstaller onedir, about 58 MB). Milestone 9's notices and installer must carry these licences. Versions are pinned in `sidecar/requirements.txt` (direct dependencies); the rest come in through ffsubsync.

| Package | Version | Licence | Why it's there |
|---|---|---|---|
| CPython runtime | 3.12 | PSF-2.0 | the interpreter PyInstaller embeds |
| ffsubsync | 0.5.1 | MIT | offset and framerate search |
| webrtcvad-wheels | 2.0.14.post1 | MIT (wraps Google's WebRTC VAD, BSD-3-Clause) | voice activity detection |
| numpy | 2.5.4 | BSD-3-Clause (bundled parts: 0BSD, MIT, Zlib, CC0-1.0) | signals and FFT |
| srt | 3.5.3 | MIT | reading the temp SRT |
| pysubs2 | 1.9.1 | MIT | ffsubsync's subtitle reader |
| ffmpeg-python | 0.2.0 | Apache-2.0 | ffsubsync's ffmpeg calls |
| future | 1.0.0 | MIT | ffsubsync dependency |
| chardet | 7.7.0 | 0BSD | encoding detection (ffsubsync) |
| charset-normalizer | 3.5.2 | MIT | encoding detection (ffsubsync) |
| faust-cchardet | 3.2.0 | MPL-1.1 OR GPL-2.0-or-later OR LGPL-2.1-or-later (we take MPL-1.1) | encoding detection (ffsubsync) |
| rich | 15.0.0 | MIT | ffsubsync logging |
| markdown-it-py | 4.2.0 | MIT | rich dependency |
| mdurl | 0.1.2 | MIT | rich dependency |
| Pygments | 2.21.0 | BSD-2-Clause | rich dependency |
| tqdm | 4.70.1 | MPL-2.0 AND MIT | ffsubsync progress |
| typing_extensions | 4.16.0 | PSF-2.0 | ffsubsync dependency |
| colorama | 0.4.6 | BSD-3-Clause | rich/tqdm on Windows |

**Left out on purpose** (`sidecar/build.spec` excludes): `auditok` (GPLv3; only used by ffsubsync's `--vad auditok`, and we always pass `--vad webrtc`), torch, faster-whisper and ffsubsync's GUI (gooey/wx). ffsubsync's whisper and silero modes are never called.

ffmpeg itself isn't in the sidecar: it uses the app's vendor ffmpeg (LGPL build) through `VP_FFMPEG`.
