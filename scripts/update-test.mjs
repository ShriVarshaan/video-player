// A real update on this PC: installs a 0.9.0 test build, updates it to 1.0.0 from a feed on localhost,
// and checks that the choices, the restart and people's data all work. Then it removes everything.
// Its builds keep their data in %APPDATA%\video-player-update-test, so the real library is never opened.
// Shipped config is untouched: the feed address is only given to these builds.
//
//   node scripts/update-test.mjs        (needs vendor/ and the sidecar build; about 10 minutes)
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'

const OLD = '0.9.0'
const NEW = process.env.VP_UPDATE_TEST_NEW ?? '1.0.0'
const DATA_FOLDER = 'video-player-update-test'
const appData = process.env.APPDATA
const localAppData = process.env.LOCALAPPDATA
const realDb = join(appData, 'video-player', 'library.db')
const testData = join(appData, DATA_FOLDER)
const installDir = join(localAppData, 'Programs', 'Cinewall')
const exe = join(installDir, 'Cinewall.exe')
const uninstaller = join(installDir, 'Uninstall Cinewall.exe')
const builds = resolve('release', 'update-test')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ok = (message) => console.log(`  ok: ${message}`)
function assert(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`)
  ok(message)
}

async function until(what, check, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error(`FAILED: timed out waiting for ${what}`)
    await sleep(500)
  }
}

function run(command, env = {}) {
  const r = spawnSync(command, { shell: true, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env } })
  if (r.status !== 0) throw new Error(`FAILED: ${command}`)
}

const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : null)
const running = () => execFileSync('tasklist', ['/FI', 'IMAGENAME eq Cinewall.exe', '/NH'], { encoding: 'utf8' }).includes('Cinewall.exe')
const fileVersion = () =>
  existsSync(exe)
    ? execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim()
    : null

const readdirSafe = (path) => (existsSync(path) ? readdirSync(path).join(',') : 'absent')

function buildVersion(version, port) {
  const output = join(builds, version)
  // A copy of the shipped config with only the feed, version and output folder changed.
  const shipped = readFileSync('electron-builder.yml', 'utf8').replace(/\r\n/g, '\n')
  const noFeed = shipped.replace(/^publish:\n(?: .*\n)+/m, '').replace(/^directories:\n(?: .*\n)+/m, '')
  if (noFeed.includes('provider:') || noFeed.includes('directories:')) throw new Error('FAILED: electron-builder.yml has changed shape; update this script.')
  const config = join(builds, `builder-${version}.yml`)
  writeFileSync(
    config,
    `${noFeed}directories:\n  output: ${JSON.stringify(output)}\npublish:\n  provider: generic\n  url: http://127.0.0.1:${port}\nextraMetadata:\n  version: ${version}\n`
  )
  run(`npx electron-builder --win --publish never --config "${config}"`)
}

function serve(folder) {
  const server = createServer((req, res) => {
    const file = join(folder, basename(decodeURIComponent(new URL(req.url, 'http://x').pathname)))
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Length': statSync(file).size })
    createReadStream(file).pipe(res)
  })
  // Any free port: Windows reserves some ranges, and the builds are told this one.
  return new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => done(server))
  })
}

async function launch() {
  const app = await electron.launch({ executablePath: exe, args: [] })
  app.process().stderr.on('data', (d) => process.stderr.write(`  [app] ${d}`))
  app.process().stdout.on('data', (d) => process.stdout.write(`  [app] ${d}`))
  const win = await until('the main window', () => app.windows().find((w) => w.url().endsWith('index.html')))
  // Off the primary monitor when there's another one.
  await app.evaluate(({ BrowserWindow, screen }) => {
    const other = screen.getAllDisplays().find((d) => d.id !== screen.getPrimaryDisplay().id)
    if (!other) return
    for (const w of BrowserWindow.getAllWindows()) w.setPosition(other.workArea.x + 40, other.workArea.y + 40)
  })
  return { app, win }
}

async function close({ app }) {
  const closed = new Promise((done) => app.once('close', done))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))?.close())
  await closed
}

const state = (win) => win.evaluate(() => window.api.updates.state({}))
const check = (win, manual) => win.evaluate((m) => window.api.updates.check({ manual: m }), manual)
const card = (win) => win.getByTestId('update-card')

async function firstRunSetup(app, win, library) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, library)
  // Saved unchecked, as setup does when TMDB can't be reached: it's a fake key.
  await win.evaluate(() => window.api.metadata.setTmdbKey({ key: 'update-test-fake-key', unchecked: true }))
  await win.getByTestId('setup-skip').click()
  await win.getByTestId('setup-skip').click()
  await win.getByTestId('setup-check').click()
  await win.locator('[data-testid="wall-tile"]:not([hidden])').first().waitFor()
}

async function theTest(library, realBefore) {
  console.log(`Installing ${OLD} silently`)
  const installer = join(builds, OLD, `Cinewall-Setup-${OLD}.exe`)
  run(`"${installer}" /S`)
  await until('the installed app', () => existsSync(exe))
  assert(!running(), 'a silent install leaves the app closed')
  console.log(`  the installed file reports version ${fileVersion()}`)

  console.log('Later')
  let session = await launch()
  assert((await session.win.evaluate(() => window.api.app.getInfo({}))).version === OLD, `the installed app is ${OLD}`)
  assert((await session.win.evaluate(() => window.api.app.getInfo({}))).userDataPath === testData, 'its data is in the test folder')
  await firstRunSetup(session.app, session.win, library)
  await check(session.win, false)
  await card(session.win).waitFor()
  assert((await card(session.win).textContent()).includes(NEW), `the card offers ${NEW}`)
  await session.win.getByTestId('update-later').click()
  await card(session.win).waitFor({ state: 'detached' })
  await check(session.win, false)
  await sleep(1500)
  assert((await card(session.win).count()) === 0, 'Remind me later keeps it quiet for this session')
  await close(session)

  console.log('Skip')
  session = await launch()
  await check(session.win, false)
  await card(session.win).waitFor()
  ok('the next launch offers it again')
  await session.win.getByTestId('update-skip').click()
  await card(session.win).waitFor({ state: 'detached' })
  await close(session)

  console.log('Manual check and install')
  session = await launch()
  await check(session.win, false)
  await until('the automatic check', async () => (await state(session.win)).phase === 'idle')
  await sleep(1500)
  assert((await card(session.win).count()) === 0, 'Skip stays quiet on the next launch')
  await check(session.win, true)
  await card(session.win).waitFor()
  ok('a manual check still offers the skipped version')
  const quit = new Promise((done) => session.app.once('close', done))
  await session.win.getByTestId('update-install').click()
  await until('the download to start', async () => (await session.win.getByTestId('update-card').textContent().catch(() => '')) !== '', 30_000)
  await quit
  ok('the app quit to install')

  const watching = setInterval(() => {
    const processes = execFileSync('tasklist', ['/NH'], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => /cinewall|installer|uninstall|au_\.exe|nsis/i.test(l))
      .map((l) => l.trim().split(/\s+/).slice(0, 2).join(':'))
    console.log(`  waiting: files ${fileVersion() ?? 'absent'}, updater cache ${readdirSafe(join(localAppData, 'video-player-updater'))}, running [${processes.join(' ')}]`)
  }, 15_000)
  await until(`the installed files to reach ${NEW}`, () => fileVersion() === `${NEW}.0`, 180_000).finally(() => clearInterval(watching))
  ok(`the installed app is now ${NEW}`)
  await until('the app to reopen by itself', running, 60_000)
  ok('the app reopened by itself')
  await sleep(4000)
  execFileSync('taskkill', ['/IM', 'Cinewall.exe'], { stdio: 'ignore' })
  await until('the reopened app to close', () => !running(), 15_000).catch(() => {
    execFileSync('taskkill', ['/F', '/IM', 'Cinewall.exe'], { stdio: 'ignore' })
  })
  await until('the app to be gone', () => !running(), 15_000)

  console.log('After the update')
  session = await launch()
  const info = await session.win.evaluate(() => window.api.app.getInfo({}))
  assert(info.version === NEW, `Settings would show ${NEW}`)
  assert(!(await session.win.evaluate(() => window.api.app.setupState({}))).show, 'setup does not come back')
  assert((await session.win.evaluate(() => window.api.library.wall({}))).length >= 1, 'the library survived')
  assert((await session.win.evaluate(() => window.api.metadata.status({}))).hasKey, 'the saved key survived and still decrypts')
  await check(session.win, true)
  await until('the manual check', async () => (await state(session.win)).phase === 'upToDate')
  ok('nothing newer is offered')
  await close(session)

  console.log('Uninstall')
  run(`"${uninstaller}" /S`)
  await until('the app files to go', () => !existsSync(exe), 60_000)
  ok('a silent uninstall removes the app')
  assert(existsSync(join(testData, 'library.db')), 'a silent uninstall keeps the data')
  assert(mtime(realDb) === realBefore, 'the real library was not touched')
}

function cleanUp() {
  if (running()) {
    try {
      execFileSync('taskkill', ['/F', '/IM', 'Cinewall.exe'], { stdio: 'ignore' })
    } catch {}
  }
  if (existsSync(uninstaller)) spawnSync(`"${uninstaller}" /S`, { shell: true })
  rmSync(testData, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 })
  // electron-updater's download cache (updaterCacheDirName comes from the package name).
  rmSync(join(localAppData, 'video-player-updater'), { recursive: true, force: true })
  rmSync(builds, { recursive: true, force: true })
}

async function main() {
  if (existsSync(exe) || running()) throw new Error('Cinewall is installed or running on this PC. Uninstall it first: this test installs and removes it.')
  if (existsSync(testData)) throw new Error(`${testData} already exists. Delete it first.`)
  const realBefore = mtime(realDb)
  const library = mkdtempSync(join(tmpdir(), 'cinewall-update-test-'))
  copyFileSync(resolve('tests', 'fixtures', 'media', 'h264_like.mp4'), join(library, 'Update Test (2001).mp4'))
  mkdirSync(builds, { recursive: true })

  let server
  try {
    server = await serve(join(builds, NEW))
    const { port } = server.address()
    console.log(`Building ${OLD} and ${NEW}`)
    run('npm run build', { VP_DATA_FOLDER: DATA_FOLDER })
    buildVersion(OLD, port)
    buildVersion(NEW, port)
    assert(readFileSync(join(builds, NEW, 'latest.yml'), 'utf8').includes(`version: ${NEW}`), `the feed offers ${NEW}`)
    await theTest(library, realBefore)
    console.log('\nPASSED')
  } finally {
    server?.close()
    cleanUp()
    rmSync(library, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
    // The test builds' main process names the test folder, so don't leave it in out/.
    run('npm run build')
    console.log(`Removed the test install and data. Real library unchanged: ${mtime(realDb) === realBefore}`)
  }
}

try {
  await main()
} catch (e) {
  console.error(e.message ?? e)
  process.exitCode = 1
}
