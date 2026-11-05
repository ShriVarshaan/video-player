# Testing Cinewall: a checklist

Thanks for helping. You're checking that Cinewall works on a PC that has never seen it. It takes about 30 minutes, and no technical knowledge is needed. You need a film of your own on the PC, ideally with spoken dialogue.

Tick each box as you go. **If anything goes wrong, write down the box it was and carry on if you can.**

## Install

- [ ] Open `Cinewall-Setup-1.0.0.exe`. If Windows says "Windows protected your PC", that's expected: choose **More info**, then **Run anyway**.
- [ ] The installer lets you choose a folder, never asks who to install it for, and finishes without asking for an admin password.
- [ ] Cinewall opens. It has a small logo, not the default Electron one, in the taskbar.

## First-time setup

Use your own free accounts for these. Signing up takes a few minutes each.

- [ ] Step 1: the button to create a TMDB account opens the sign-up page in your browser.
- [ ] You can get a TMDB key, paste it in, and Cinewall accepts it. (On TMDB, it's under Settings → API.)
- [ ] Step 2: the OpenSubtitles button opens its sign-up page.
- [ ] You can create an API consumer there, enter its API key with your username and password, and Cinewall accepts them.
- [ ] Step 3: you can pick the folder with your film in it, and you reach the wall of posters.

## Using it

- [ ] Your film appears on the wall with its real poster within a minute or so.
- [ ] You can pan around the wall with the mouse and the arrow keys.
- [ ] Clicking the film and pressing Play starts it, with sound and picture.
- [ ] The controls appear when you move the mouse. Pause, seeking and volume all work.
- [ ] Subtitles: press the subtitles button and search for one. It downloads and shows on the film.
- [ ] Auto sync: with a subtitle showing, press **A**. It finishes and the subtitle lines up with the speech.
- [ ] Close the film with ✕. Open it again: it offers to continue from where you stopped.
- [ ] Search: press **/** on the wall and type part of the film's name. It appears.
- [ ] No black console windows flash up at any point.
- [ ] Settings → About shows version 1.0.0, and **Show third-party notices** opens a long list.

## Close and reopen

- [ ] Close Cinewall and open it from the Start menu. It goes straight to your wall, without setup, and your film is still there.

## Uninstall, twice

- [ ] Uninstall it from Windows Settings → Apps → Installed apps. When it asks about deleting your library and logins, choose **No**.
- [ ] Install it again with the same file. Your film and logins are still there, with no setup.
- [ ] Uninstall it again. This time choose **Yes** to delete them.
- [ ] Install it one last time. It starts at first-time setup again, so the data really was deleted. You can then uninstall it and delete your accounts if you like.
- [ ] Your film and any subtitle files next to it are still in their folder.

## What to send back

- Whether everything passed, or which boxes didn't.
- For each problem: what you did, what you expected and what happened instead. A phone photo or screenshot helps a lot.
- Your Windows version (Settings → System → About).

**Don't send your TMDB key, your OpenSubtitles API key or your password.** Nobody needs them to fix a bug.
