// Times shown in the player and on the title page.

const two = (n: number) => String(n).padStart(2, '0')

// "0:07", "19:42", "1:02:05"
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

// "1 h 12 min left", "21 min left", "2 h left"; anything under a minute is "1 min left".
export function timeLeft(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min left`
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`
}
