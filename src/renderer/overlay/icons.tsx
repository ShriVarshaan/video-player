// The player's 24×24 icons, drawn in the text colour.
export const Icon = ({ d, label }: { d: string; label?: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined}>
    <path d={d} fill="currentColor" />
  </svg>
)

export const ICONS = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  back: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z',
  forward: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8Z',
  volume: 'M4 9v6h4l5 4V5L8 9H4Zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4ZM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z',
  mute: 'M4 9v6h4l5 4V5L8 9H4Zm12.6 3 2.7-2.7-1.3-1.3-2.7 2.7-2.7-2.7-1.3 1.3 2.7 2.7-2.7 2.7 1.3 1.3 2.7-2.7 2.7 2.7 1.3-1.3L16.6 12Z',
  full: 'M5 5h5v2H7v3H5V5Zm9 0h5v5h-2V7h-3V5ZM5 14h2v3h3v2H5v-5Zm12 3v-3h2v5h-5v-2h3Z',
  exitFull: 'M8 5h2v5H5V8h3V5Zm6 0h2v3h3v2h-5V5ZM5 14h5v5H8v-3H5v-2Zm9 0h5v2h-3v3h-2v-5Z',
  // Picture in picture: a small picture in the corner of a big one.
  pip: 'M3 5h18v14H3V5Zm2 2v10h14V7H5Zm6 4h7v5h-7v-5Z',
  // Back to full size: out of the box, up and to the right.
  pipExit: 'M5 5h6v2H7v10h10v-4h2v6H5V5Zm9 0h5v5h-2V8.4l-5.3 5.3-1.4-1.4L15.6 7H14V5Z'
}
