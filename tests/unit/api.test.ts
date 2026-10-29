import { describe, expect, it } from 'vitest'
import { apiMethods, channelFor, eventChannel } from '@shared/api'

describe('channelFor', () => {
  it('derives the channel from domain and method', () => {
    expect(channelFor('settings', 'get')).toBe('vp:settings.get')
  })
})

describe('apiMethods', () => {
  it('lists every method of each domain', () => {
    expect(Object.keys(apiMethods.settings)).toEqual(['get', 'set'])
    expect(Object.keys(apiMethods.app)).toEqual(['getInfo'])
    expect(Object.keys(apiMethods.library)).toEqual(['addFolder', 'removeFolder', 'listFolders', 'rescan', 'list', 'getShow', 'wall'])
    expect(Object.keys(apiMethods.metadata)).toEqual(['setTmdbKey', 'status'])
  })
})

describe('eventChannel', () => {
  it('derives event channels', () => {
    expect(eventChannel('library.changed')).toBe('vp:event.library.changed')
  })
})
