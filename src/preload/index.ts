import { contextBridge, ipcRenderer } from 'electron'
import { apiMethods, channelFor, type API } from '@shared/api'

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

contextBridge.exposeInMainWorld('api', api)
