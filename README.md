<p align="center"><img src="build/icon.svg" width="96" height="96" alt="Cinewall logo"></p>

# Cinewall

A Windows player for the movies and TV shows in your own folders.

- An endless wall of posters you can pan in every direction
- A page for each show, with seasons, episodes and Continue watching
- Clean, Apple TV-style subtitles, and downloads from OpenSubtitles
- Auto sync, which lines a subtitle up with the speech in the film
- Search as you type
- Volume up to 200%

## Install

Download the installer from [Releases](https://github.com/ShriVarshaan/video-player/releases). Windows will warn you the first time, because the installer isn't code-signed: see [docs/INSTALL.md](docs/INSTALL.md) for what to do and why.

Cinewall asks for two free accounts when you first open it: [TMDB](https://www.themoviedb.org/signup) for posters and film details, and [OpenSubtitles](https://www.opensubtitles.com/en/users/sign_up) for downloading subtitles. Each person uses their own, and you can skip both and add them later in Settings. Your films stay on your PC. Cinewall only talks to the internet to reach those two services and to check GitHub for updates.

## Build it yourself

You need Windows, Node 24 and Python 3.12.

```
npm install
npm run fetch-vendor     # mpv and FFmpeg, at pinned versions
npm run setup-sidecar    # the auto sync helper's Python environment
npm run build-sidecar
npm run dev              # run it with hot reload
npm run package          # build the installer into release/
```

Tests: `npm test`, `npm run test:e2e`, `npm run test:sidecar` and, after `npm run package`, `npm run test:packaged`. `node scripts/make-fixtures.mjs` makes the test media they use.

## Licence

Cinewall is under the [MIT licence](LICENSE). It ships with mpv (GPL) and FFmpeg (LGPL) as separate programs, along with other open-source software, all listed with their licences in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and in Settings → About.

This product uses the TMDB API but is not endorsed or certified by TMDB.
