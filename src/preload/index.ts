import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { apiMethods, channelFor, eventChannel, type API, type ApiEvents, type RendererApi } from '@shared/api'

// Build window.api from the shared method table so every call goes to its
// derived channel; no channel name is written by hand.
const api = Object.fromEntries(
  Object.entries(apiMethods).map(([domain, methods]) => [
    domain,
    Object.fromEntries(
      Object.keys(methods).map((method) => [
        method,
        (params: unknown) => ipcRenderer.invoke(channelFor(domain, method), params)
      ])
    )
  ])
) as API

// Subscribe to a main → renderer event; returns the unsubscribe function.
const on: RendererApi['on'] = <K extends keyof ApiEvents>(event: K, callback: (payload: ApiEvents[K]) => void) => {
  const channel = eventChannel(event)
  const listener = (_event: IpcRendererEvent, payload: ApiEvents[K]) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', { ...api, on } satisfies RendererApi)
