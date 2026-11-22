import { loadUser32, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER } from './user32'

const GWL_STYLE = -16
// Title bar (WS_CAPTION = border + dialog frame), sizing border, and the min/max boxes.
const FRAME = 0x00c00000n | 0x00040000n | 0x00020000n | 0x00010000n

// Electron can't change a window's frame after creation, so picture in picture
// takes the frame off through Win32 and puts the exact old style back afterwards.
export function createFrameToggle(hwnd: bigint): { remove(): void; restore(): void } {
  let saved: bigint | null = null
  const apply = (style: bigint) => {
    const u = loadUser32()
    u.SetWindowLongPtrW(hwnd, GWL_STYLE, style)
    u.SetWindowPos(hwnd, 0n, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED)
  }
  return {
    remove() {
      if (saved !== null) return
      saved = BigInt(loadUser32().GetWindowLongPtrW(hwnd, GWL_STYLE))
      apply(saved & ~FRAME)
    },
    restore() {
      if (saved === null) return
      const style = saved
      saved = null
      apply(style)
    }
  }
}
