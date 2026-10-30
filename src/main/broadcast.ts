import { BrowserWindow } from 'electron'
import { eventChannel, type ApiEvents } from '@shared/api'

// Main → renderer events go to every window: the app window and the player overlay.
export function broadcast<K extends keyof ApiEvents>(event: K, payload: ApiEvents[K]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(eventChannel(event), payload)
  }
}
