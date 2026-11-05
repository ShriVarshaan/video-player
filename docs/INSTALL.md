# Installing Cinewall

Cinewall runs on 64-bit Windows 10 and 11.

## 1. Download

Get `Cinewall-Setup-<version>.exe` from [Releases](https://github.com/ShriVarshaan/video-player/releases).

## 2. Get past the Windows warning

Windows may show **"Windows protected your PC"**. Choose **More info**, then **Run anyway**. Your browser may also ask you to confirm the download with **Keep**.

You see this because the installer isn't code-signed. A signing certificate is a paid yearly cost that this free project doesn't carry, and Windows warns about unsigned apps that few people have downloaded. It doesn't mean a virus was found. If you'd rather not take that on trust, the source is on GitHub and you can build it yourself.

## 3. Install

Follow the installer. It installs for your Windows account only, so it needs no admin password, and you can change the folder.

## 4. First-time setup

Cinewall walks you through three steps:

1. **TMDB key** (free): gives you posters and film details. You can skip this and add it later.
2. **OpenSubtitles account** (free): lets you search for and download subtitles. You can skip this too.
3. **Your films**: pick a folder that holds your movies or shows.

Your keys and password are stored encrypted on your PC, and are only sent to the service they belong to.

## Updates

Cinewall checks GitHub for new versions. When there is one, a card on Home offers **Install**, **Remind me later** or **Skip this version**. Nothing downloads until you choose Install. It never restarts during a film. Settings → About → **Check for updates** checks at any time, and still offers a version you skipped.

## Uninstalling

Use **Settings → Apps → Installed apps** in Windows. The uninstaller asks whether to also delete your library, watch progress and saved logins. The default is to keep them, so reinstalling picks up where you left off. Your films and subtitle files are never touched.
