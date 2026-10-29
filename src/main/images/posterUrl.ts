// poster://<poster|backdrop|logo|still>/<video|show>/<id> — the renderer's only
// way to load artwork. Unknown or malformed URLs resolve to nothing (404).

export type PosterRef = { type: 'poster' | 'backdrop' | 'logo' | 'still'; owner: 'video' | 'show'; id: number }

// An optional ?v=… only changes when the artwork does, so the renderer reloads it.
const PATTERN = /^poster:\/\/(poster|backdrop|logo|still)\/(video|show)\/(\d+)\/?(?:\?v=[\w-]*)?$/

export function parsePosterUrl(url: string): PosterRef | null {
  const m = PATTERN.exec(url)
  if (!m) return null
  return { type: m[1] as PosterRef['type'], owner: m[2] as PosterRef['owner'], id: Number(m[3]) }
}

export function posterUrl(ref: PosterRef, version?: string): string {
  return `poster://${ref.type}/${ref.owner}/${ref.id}${version ? `?v=${version}` : ''}`
}
