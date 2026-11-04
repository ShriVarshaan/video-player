// Times shown in the player and on the title page.

const two = (n: number) => String(n).padStart(2, '0')

// "0:07", "19:42", "1:02:05"
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

// "Ends at 11:30 PM" / "Ends at 23:30", playS seconds from nowMs. hour12: Windows' clock
// setting, or null to go by the locale. hourCycle, because hour12: false can print 24:05.
export function endsAt(playS: number, nowMs: number, hour12: boolean | null, locale?: string): string {
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(hour12 === null ? {} : { hourCycle: hour12 ? 'h12' : 'h23' })
  }).format(nowMs + playS * 1000)
  return `Ends at ${time.replace(/ /g, ' ')}`
}

// "1 h 12 min left", "21 min left", "2 h left"; anything under a minute is "1 min left".
export function timeLeft(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min left`
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`
}
