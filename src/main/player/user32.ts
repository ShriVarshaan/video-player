import { createRequire } from 'node:module'

// The few Win32 calls the player needs, through koffi. Loaded once, on first use.
export type User32 = {
  FindWindowExW(parent: bigint, after: bigint, cls: string, name: string | null): bigint | number
  SetWindowPos(h: bigint | number, after: bigint, x: number, y: number, cx: number, cy: number, flags: number): boolean
  GetWindowLongPtrW(h: bigint, index: number): bigint | number
  SetWindowLongPtrW(h: bigint, index: number, value: bigint): bigint | number
}

export const SWP_NOSIZE = 0x0001
export const SWP_NOMOVE = 0x0002
export const SWP_NOZORDER = 0x0004
export const SWP_NOACTIVATE = 0x0010
export const SWP_FRAMECHANGED = 0x0020

let user32: User32 | null = null
export function loadUser32(): User32 {
  if (user32) return user32
  const koffi = createRequire(__filename)('koffi') as {
    load(name: string): { func(signature: string): (...args: unknown[]) => unknown }
  }
  const lib = koffi.load('user32.dll')
  user32 = {
    FindWindowExW: lib.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)') as User32['FindWindowExW'],
    SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr h, intptr after, int x, int y, int cx, int cy, uint flags)') as User32['SetWindowPos'],
    GetWindowLongPtrW: lib.func('intptr __stdcall GetWindowLongPtrW(intptr h, int index)') as User32['GetWindowLongPtrW'],
    SetWindowLongPtrW: lib.func('intptr __stdcall SetWindowLongPtrW(intptr h, int index, intptr value)') as User32['SetWindowLongPtrW']
  }
  return user32
}
