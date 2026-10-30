import { ipcMain } from 'electron'
import type { API } from '@shared/api'
import { throwAppError } from '@shared/appError'
import { sanitizePatch, sanitizeStyle } from '@shared/subtitleStyle'
import { registerDomain } from '../ipc'
import type { PlayerService } from '../player/service'
import type { StyleStore } from './styleStore'

const keyOf = (key: unknown): string => {
  if (typeof key !== 'string' || !key) throwAppError({ code: 'invalid_argument', message: 'A title key is needed.' })
  return key
}

// Subtitle style and settings. Every change re-sends the playing title's style.
export function createSubtitlesApi(deps: { styles: StyleStore; player: PlayerService }): API['subtitles'] {
  const { styles, player } = deps
  const changed = () => player.notifyStyle()
  return {
    getStyle: async ({ key }) => ({ global: styles.global(), overrides: typeof key === 'string' ? styles.overrides(key) : {} }),
    setGlobalStyle: async ({ style }) => {
      styles.setGlobal(sanitizeStyle(style))
      changed()
    },
    setTitleStyle: async ({ key, patch }) => {
      styles.setOverrides(keyOf(key), sanitizePatch(patch))
      changed()
    },
    useForAll: async ({ key }) => {
      styles.useForAll(keyOf(key))
      changed()
    },
    resetTitle: async ({ key }) => {
      styles.reset(keyOf(key))
      changed()
    },
    getSettings: async () => styles.subtitleSettings(),
    setSettings: async (s) => styles.setSubtitleSettings(s)
  }
}

export function setupSubtitles(deps: { styles: StyleStore; player: PlayerService }): void {
  registerDomain(ipcMain, 'subtitles', createSubtitlesApi(deps))
}
