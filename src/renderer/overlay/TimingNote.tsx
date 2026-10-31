import { useEffect, useState } from 'react'

const SHOW_MS = 1500

// A short note at the top ("Subtitles +0.35 s"). Each new message restarts it;
// it fades out a moment after the last one. n tells repeated texts apart.
export function TimingNote({ message }: { message: { text: string; n: number } | null }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!message) return
    setShown(true)
    const t = setTimeout(() => setShown(false), SHOW_MS)
    return () => clearTimeout(t)
  }, [message])
  if (!message) return null
  return (
    <p className="timing-note" data-testid={shown ? 'timing-note' : undefined} data-shown={shown} role="status">
      {message.text}
    </p>
  )
}
