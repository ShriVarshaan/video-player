import { useEffect, useState } from 'react'

type Layers = { a: string | null; b: string | null; front: 'a' | 'b'; shown: boolean }

// Two stacked, statically blurred layers. A new image is decoded first and then
// crossfaded in by opacity alone, so nothing is re-blurred while it moves.
export function Backdrop({ url }: { url: string | null }) {
  const [layers, setLayers] = useState<Layers>({ a: null, b: null, front: 'a', shown: false })

  useEffect(() => {
    if (!url) {
      setLayers((l) => ({ ...l, shown: false }))
      return
    }
    let cancelled = false
    const img = new Image()
    img.src = url
    img.decode().then(
      () => {
        if (cancelled) return
        setLayers((l) => {
          if (l.shown && l[l.front] === url) return l
          const back = l.front === 'a' ? 'b' : 'a'
          return { ...l, [back]: url, front: back, shown: true }
        })
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <div className="backdrop" aria-hidden="true">
      {(['a', 'b'] as const).map((k) => {
        const src = layers[k]
        return (
          <div
            key={k}
            className={`backdrop-layer${layers.shown && layers.front === k ? ' shown' : ''}`}
            style={src ? { backgroundImage: `url("${src}")` } : undefined}
          />
        )
      })}
    </div>
  )
}
