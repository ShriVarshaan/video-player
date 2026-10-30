import { BrowserWindow } from 'electron'

const FOLLOW = ['move', 'resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore'] as const

// The see-through window over the main window's content area that holds the
// player controls. mpv draws inside the main window, so HTML can't sit over it there.
export function createOverlay(
  main: BrowserWindow,
  load: (w: BrowserWindow) => void,
  webPreferences: Electron.WebPreferences
): { window: BrowserWindow; show(): void; hide(): void } {
  const w = new BrowserWindow({
    parent: main,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences
  })
  load(w)

  let shown = false
  const follow = () => {
    if (shown && !main.isMinimized()) w.setBounds(main.getContentBounds())
  }
  for (const event of FOLLOW) main.on(event as 'move', follow)
  // Alt+Tab or the taskbar focuses the main window; keys belong to the overlay while playing.
  main.on('focus', () => {
    if (shown) w.focus()
  })
  main.on('closed', () => {
    if (!w.isDestroyed()) w.destroy()
  })

  return {
    window: w,
    show() {
      shown = true
      w.setBounds(main.getContentBounds())
      w.show()
      w.focus()
    },
    hide() {
      shown = false
      if (w.isDestroyed()) return
      w.hide()
      main.focus()
    }
  }
}
