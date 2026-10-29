# Milestone 1 — Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Electron + React + TS app with pinned vendor binaries, a per-user SQLite database holding the full schema, and a type-safe IPC layer.

**Architecture:** electron-vite builds three bundles (main, preload, renderer). Main owns the database (`node:sqlite`) and all IPC handlers; the preload exposes `window.api`, generated from one shared `API` type and method table, so channel names are derived, never hand-typed. A standalone Node script fetches mpv/ffmpeg into `vendor/`.

**Tech Stack:** Electron 45.1, electron-vite 6, Vite 8, React 19, TypeScript 5 (strict), `node:sqlite`, Vitest 5, Playwright (`_electron`), `7zip-bin`.

**Spec:** `docs/superpowers/specs/2026-10-29-milestone-1-scaffold-design.md`

## Global Constraints

- Windows 11, Node 24, npm. Electron `45.1.0` exactly (bundles Node 24.22).
- SQLite via built-in `node:sqlite` only — no native addons.
- DB file: `path.join(app.getPath('userData'), 'library.db')`; pragmas `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`; schema version in `PRAGMA user_version`.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP meta tag. Sandboxed preload must be emitted as CommonJS.
- IPC channel = `'vp:' + domain + '.' + method`; every API method takes one object param and returns a `Promise`.
- Main-process errors use `throwAppError`; renderer uses `catchAppError` (skill `electron-skills/rules/ipc-app-error-system.md`).
- `vendor/` gitignored except `vendor/manifest.json`. Archives extracted into a fresh temp dir; nothing executed from it.
- `--user-data-dir=<dir>` on the command line overrides `userData` (E2E isolation).
- Commit after each task; never push.

## Review Focus

1. **DB written by a newer app version** (`user_version` > latest known) → `openDb` throws `AppError` `db_too_new` and leaves the file untouched. Test in Task 3.
2. **A migration fails halfway** → whole migration rolled back, `user_version` unchanged, error raised. Test in Task 3.
3. **userData path with spaces and non-ASCII** (Windows usernames like `Zoë Smith`) → DB opens and migrates. Test in Task 3.
4. **fetch-vendor interrupted or a bad download** → no partial `vendor/<name>` dir, `.installed.json` not updated, next run retries. Test in Task 6.
5. **Second app instance launched** → it exits and focuses the first (`requestSingleInstanceLock`), so two processes never open the DB at once. Test in Task 5.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`
- Modify: `.gitignore` (`vendor/` → `vendor/*` + `!vendor/manifest.json`)
- Test: `tests/unit/sanity.test.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build` (`electron-vite build` → `out/`), `typecheck` (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`), `test` (`vitest run`), `test:e2e` (`npm run build && playwright test`), `fetch-vendor` (`node scripts/fetch-vendor.mjs`). Path alias `@shared` → `src/shared` in all three bundles and in Vitest.

- [ ] **Step 1:** `npm init -y`; install dev deps: `electron@45.1.0 electron-vite@6 vite@8 @vitejs/plugin-react typescript @types/node@24 vitest@5 @playwright/test react@19 react-dom@19 @types/react @types/react-dom 7zip-bin`. Set `"main": "out/main/index.js"`.
- [ ] **Step 2:** Write `electron.vite.config.ts`: main + preload with `externalizeDepsPlugin()`; preload `build.rollupOptions.output.format = 'cjs'` (sandbox); renderer with `@vitejs/plugin-react`; `@shared` alias everywhere. Ensure `node:sqlite` is external in main (add to `rollupOptions.external` if the build tries to resolve it).
- [ ] **Step 3:** Minimal `src/main/index.ts` creating one `BrowserWindow` (1280×800, `backgroundColor: '#0b0b0c'`, the webPreferences from Global Constraints, preload `../preload/index.js`), loading the dev URL or `out/renderer/index.html`. `App.tsx` renders `<h1>Video Player</h1>`. `index.html` CSP: `default-src 'self'; img-src 'self' data: poster:; style-src 'self' 'unsafe-inline'`.
- [ ] **Step 4:** Write `tests/unit/sanity.test.ts` asserting `new (await import('node:sqlite')).DatabaseSync(':memory:').prepare('select 1 as x').get()` equals `{ x: 1 }`. Run `npm test` → PASS.
- [ ] **Step 5:** Run `npm run typecheck` → no errors; `npm run build` → `out/main/index.js`, `out/preload/index.js` (CJS), `out/renderer/index.html` exist; `grep -c "node:sqlite" out/main/index.js` is 0 here (not yet imported). `npm run dev` opens the window (manual check).
- [ ] **Step 6:** Commit `chore: scaffold electron-vite + React + TS app`.

### Task 2: Shared API types and AppError

**Files:**
- Create: `src/shared/api.ts`, `src/shared/appError.ts`
- Test: `tests/unit/api.test.ts`, `tests/unit/appError.test.ts`

**Interfaces:**
- Produces (`src/shared/api.ts`):
  ```ts
  export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
  export type BinaryName = 'mpv' | 'ffmpeg' | 'ffprobe';
  export type AppInfo = { version: string; userDataPath: string; dbPath: string;
    binaries: Record<BinaryName, { path: string; exists: boolean }> };
  export type API = {
    app: { getInfo: (params: Record<string, never>) => Promise<AppInfo> };
    settings: {
      get: (params: { key: string }) => Promise<Json | null>;
      set: (params: { key: string; value: Json }) => Promise<void>;
    };
  };
  export type Domain = keyof API;
  // Runtime method table; the mapped type makes omitting a method a compile error.
  export const apiMethods: { [D in Domain]: { [M in keyof API[D]]: true } };
  export const channelFor: (domain: string, method: string) => string; // 'vp:' + d + '.' + m
  ```
- Produces (`src/shared/appError.ts`): `AppErrorCode = 'db_too_new' | 'db_migration_failed' | 'invalid_argument' | 'unknown'`, `appErrorMessages`, `AppErrorClass`, `throwAppError`, `parseAppError`, `catchAppError` — exactly as in `electron-skills/rules/ipc-app-error-system.md`.

- [ ] **Step 1: Failing tests.** `api.test.ts`: `channelFor('settings','get') === 'vp:settings.get'`; `Object.keys(apiMethods.settings)` equals `['get','set']`. `appError.test.ts`: `throwAppError('db_too_new')` throws an `AppErrorClass` whose `parseAppError` gives `{ code: 'db_too_new', message: appErrorMessages.db_too_new }`; `parseAppError(new Error("Error invoking remote method 'x': Error: " + JSON.stringify({code:'invalid_argument',message:'m',payload:{k:1}})))` returns that object (IPC prefix stripped); `parseAppError(new Error('plain'))` is `null`; `catchAppError` calls the matching handler, else `DEFAULT` with code `unknown`.
- [ ] **Step 2:** `npm test` → FAIL (modules missing).
- [ ] **Step 3:** Implement both files. Shared code must not import `electron`.
- [ ] **Step 4:** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5:** Commit `feat: shared typed API and AppError`.

### Task 3: Database — open, migrate, full schema

**Files:**
- Create: `src/main/db/index.ts`, `src/main/db/migrations.ts`
- Modify: `docs/PROJECT_PLAN.md` (better-sqlite3 → `node:sqlite`, migrations via `user_version`), `.claude/skills/release-windows/SKILL.md` (note: no native modules, nothing to rebuild/asarUnpack for SQLite)
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: `throwAppError` (Task 2).
- Produces:
  ```ts
  // src/main/db/migrations.ts
  export const migrations: readonly string[]; // index i → user_version i+1; [0] = full schema from spec verbatim
  // src/main/db/index.ts
  export type Db = import('node:sqlite').DatabaseSync;
  export function openDb(file: string, list?: readonly string[]): Db; // list defaults to migrations
  export function tx<T>(db: Db, fn: () => T): T;                       // BEGIN IMMEDIATE / COMMIT / ROLLBACK on throw, rethrows
  export function schemaVersion(db: Db): number;
  ```

- [ ] **Step 1: Failing tests** in `db.test.ts`:
  - `openDb(':memory:')` → `schemaVersion` = `migrations.length`; `sqlite_master` lists tables `library_folders, tmdb_movies, movies, genres, tmdb_movie_genres, people, credits, images, playback_state, subtitle_transforms, settings`.
  - `PRAGMA foreign_keys` = 1. Deleting a `library_folders` row cascades to its `movies`, and through them to `playback_state`, `subtitle_transforms`, `images`. Deleting a `tmdb_movies` row sets `movies.tmdb_id` to NULL.
  - Inserting `movies.match_status = 'bogus'` throws; `images.kind = 'thumb'` throws; `credits.role = 'writer'` throws.
  - Reopening a file DB is a no-op (version unchanged, data kept).
  - **Review Focus 1:** file DB with `PRAGMA user_version = 99` → `openDb` throws, `parseAppError(e).code === 'db_too_new'`, and `user_version` is still 99.
  - **Review Focus 2:** `openDb(file, [migrations[0], 'CREATE TABLE x(a); THIS IS NOT SQL;'])` throws code `db_migration_failed`; reopening with `migrations` shows version 1 and no table `x`.
  - **Review Focus 3:** file DB under `os.tmpdir()/vp test Zoë ünï/library.db` opens, version = latest, `PRAGMA journal_mode` = `wal`.
  - `tx` commits on return, rolls back on throw.
- [ ] **Step 2:** `npm test -- db` → FAIL.
- [ ] **Step 3:** Implement. `openDb` creates the parent dir, sets pragmas, and applies each pending migration with `db.exec` inside `tx`, setting `PRAGMA user_version = n` in the same transaction. Copy the schema SQL from the spec unchanged.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Update `PROJECT_PLAN.md` (Architecture line `SQLite (better-sqlite3)` → `SQLite (node:sqlite, built in)`) and `release-windows`.
- [ ] **Step 6:** Commit `feat: SQLite database with full schema and migrations`.

### Task 4: Main services and IPC wiring

**Files:**
- Create: `src/main/paths.ts`, `src/main/settings.ts`, `src/main/appInfo.ts`, `src/main/ipc.ts`, `src/preload/index.d.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/unit/settings.test.ts`, `tests/unit/paths.test.ts`, `tests/unit/ipc.test.ts`

**Interfaces:**
- Consumes: `openDb`, `Db` (Task 3); `API`, `apiMethods`, `channelFor`, `throwAppError` (Task 2).
- Produces:
  ```ts
  // src/main/paths.ts
  export function binaryPath(name: BinaryName | 'sidecar', base: string): string; // pure; base-relative paths from release-windows §2
  export function resolveBinary(name: BinaryName | 'sidecar'): string;          // base = app.isPackaged ? resourcesPath : join(getAppPath(), '..')… see note
  export function userDataOverride(argv: string[]): string | null;              // value of --user-data-dir=, else null
  // src/main/settings.ts
  export function createSettings(db: Db): API['settings'];  // get → parsed JSON or null; set → upsert JSON.stringify(value)
  // src/main/appInfo.ts
  export function createAppInfo(deps: { version: string; userDataPath: string; dbPath: string;
    resolve: (n: BinaryName) => string; exists: (p: string) => boolean }): API['app'];
  // src/main/ipc.ts
  export function registerDomain<D extends Domain>(ipc: Pick<Electron.IpcMain,'handle'>, domain: D, handlers: API[D]): void;
  ```
- Note on `resolveBinary` base: in dev `app.getAppPath()` is the project root, so dev base is the project root itself; verify and use whichever yields `<repo>/vendor/mpv/mpv.exe`.

- [ ] **Step 1: Failing tests.**
  - `settings.test.ts` (with `openDb(':memory:')`): `get({key:'missing'})` → `null`; `set({key:'ui', value:{scale:1.5,tags:['a']}})` then `get` deep-equals it; second `set` overwrites; `set({key:'', value:1})` rejects with code `invalid_argument`.
  - `paths.test.ts`: `binaryPath('mpv','C:\\base')` = `C:\\base\\vendor\\mpv\\mpv.exe`; `ffprobe` → `…\\vendor\\ffmpeg\\ffprobe.exe`; `userDataOverride(['electron','.','--user-data-dir=C:\\t\\x y'])` = `C:\\t\\x y`; absent → `null`.
  - `ipc.test.ts`: fake `ipc` recording `handle` calls; `registerDomain(ipc,'settings',handlers)` registers exactly `vp:settings.get` and `vp:settings.set`; invoking the recorded handler with `(event, {key:'k'})` calls `handlers.get({key:'k'})`; a handler throwing `new Error('boom')` is rethrown as an `AppErrorClass` with code `unknown`, and one throwing `throwAppError('invalid_argument')` keeps its code.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. `registerDomain` iterates `apiMethods[domain]`. Preload builds `window.api` by iterating `apiMethods` and mapping each method to `(params) => ipcRenderer.invoke(channelFor(d, m), params)`, then `contextBridge.exposeInMainWorld('api', api)`; `index.d.ts` declares `window.api: API`.
- [ ] **Step 4:** Wire `src/main/index.ts`: before `ready`, apply `userDataOverride(process.argv)` via `app.setPath('userData', …)`; on ready, `openDb(join(userData,'library.db'))`, `registerDomain` for `app` and `settings`, then create the window. On `openDb` failure show `dialog.showErrorBox('Video Player', message)` and quit. Close the DB on `will-quit`.
- [ ] **Step 5:** `npm test` → PASS; `npm run typecheck` → clean; `npm run build` → OK.
- [ ] **Step 6:** Commit `feat: settings and app-info IPC over typed channels`.

### Task 5: Renderer shell and E2E smoke test

**Files:**
- Modify: `src/renderer/src/App.tsx`, `src/main/index.ts`
- Create: `src/renderer/src/app.css`, `playwright.config.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `window.api.app.getInfo`, `catchAppError`.

- [ ] **Step 1: Failing E2E test** `smoke.spec.ts` (`_electron.launch({ args: ['out/main/index.js', '--user-data-dir=' + tmp] })`, `tmp` = fresh `mkdtemp`):
  - first window shows text `Video Player`, and an element `[data-testid="db-path"]` whose text equals `join(tmp,'library.db')`;
  - `existsSync(join(tmp,'library.db'))` is true;
  - each of `mpv`, `ffmpeg`, `ffprobe` has a `[data-testid="bin-<name>"]` row with `data-exists` `true`/`false`;
  - **Review Focus 5:** launching a second instance with the same args → that process exits within 5 s with code 0 while the first stays open.
- [ ] **Step 2:** `npm run test:e2e` → FAIL.
- [ ] **Step 3:** `App.tsx`: on mount call `getInfo({})`; render app name, version, DB path, a row per binary (found / missing), and when any is missing the hint `Run npm run fetch-vendor to download mpv and ffmpeg.`; on error render the message via `catchAppError`. Dark background `#0b0b0c`, system font stack; nothing more.
- [ ] **Step 4:** In `src/main/index.ts`, `if (!app.requestSingleInstanceLock()) app.quit()` before opening the DB; on `second-instance`, restore and focus the window.
- [ ] **Step 5:** `npm run test:e2e` → PASS; `npm test` still PASS.
- [ ] **Step 6:** Commit `feat: renderer shell and Electron smoke test`.

### Task 6: fetch-vendor script

**Files:**
- Create: `scripts/vendor-lib.mjs`, `scripts/fetch-vendor.mjs`, `vendor/manifest.json`
- Test: `tests/unit/vendor.test.ts`

**Interfaces:**
- Produces:
  ```js
  // vendor/manifest.json
  { "packages": [ { "name": "mpv", "version": "…", "url": "…", "sha256": "…",
      "from": "", "keep": ["mpv.exe", "*.dll"] },
    { "name": "ffmpeg", "version": "…", "url": "…", "sha256": "…",
      "from": "<archive root>/bin", "keep": ["ffmpeg.exe", "ffprobe.exe", "*.dll"] } ] }
  // scripts/vendor-lib.mjs
  export async function sha256File(path) // → hex string
  export function needsInstall(pkg, installed) // installed = parsed vendor/.installed.json; true unless installed[pkg.name] === pkg.sha256 and target dir exists
  export async function installPackage(pkg, { vendorDir, download, extract, tmpRoot })
  // download(url, destFile), extract(archive, outDir) are injected; real ones in fetch-vendor.mjs (fetch + 7zip-bin `x -y -o<dir>`)
  ```
- `installPackage` flow: fresh `mkdtemp` under `tmpRoot` → download → verify hash (mismatch: throw `SHA-256 mismatch for <name>: expected <a>, got <b>. Bump vendor/manifest.json.`) → extract into a second fresh dir → copy `keep` matches from `from` into `vendor/<name>.tmp` → rename to `vendor/<name>` (removing an old one) → update `.installed.json` last → delete temp dirs in `finally`.

- [ ] **Step 1: Failing tests** with fake `download`/`extract` writing known bytes:
  - happy path: only `keep` matches land in `vendor/mpv` (an extra `readme.txt` does not), `.installed.json` has `mpv: <sha>`;
  - `needsInstall` false after install, true if sha in manifest changes or target dir deleted;
  - **Review Focus 4:** wrong hash → rejects with message matching `/SHA-256 mismatch for mpv.*Bump vendor\/manifest.json/`, no `vendor/mpv`, `.installed.json` unchanged; `download` throwing midway → same guarantees; an existing good `vendor/mpv` survives a failed update;
  - temp dirs are removed in every case.
- [ ] **Step 2:** `npm test -- vendor` → FAIL.
- [ ] **Step 3:** Implement `vendor-lib.mjs` and the CLI (loops packages, prints `mpv 2026-… up to date` / `installed`, exits 1 on any failure).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Pin real releases: latest shinchiro `mpv-x86_64-<date>-git-<hash>.7z` (plain x86_64) and a dated BtbN autobuild `ffmpeg-n*-win64-lgpl-shared-*.zip`. Download each once into a fresh empty scratch dir, compute SHA-256, list the archive root to fill `from`, write `manifest.json`.
- [ ] **Step 6:** Run `npm run fetch-vendor` → both `installed`; run again → both `up to date`; `vendor\ffmpeg\ffprobe.exe -version` prints a version; `npm run dev` shell shows all three binaries found.
- [ ] **Step 7:** Commit `feat: fetch-vendor script with pinned mpv and ffmpeg`.

### Task 7: Milestone verification

- [ ] **Step 1:** `npm run typecheck && npm test && npm run test:e2e` → all pass; `git status` shows no `vendor/` files other than `manifest.json` tracked.
- [ ] **Step 2:** Mark milestone 1 done in `docs/PROJECT_PLAN.md` (add a `Status` column: `✅ done` for 1). Commit `docs: mark milestone 1 complete`.
