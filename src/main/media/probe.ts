import { execFile } from 'node:child_process'

export type ProbeResult = {
  durationS: number | null
  container: string | null
  videoCodec: string | null
  width: number | null
  height: number | null
  hdr: boolean
  json: string
}

type Stream = { codec_type?: string; codec_name?: string; width?: number; height?: number; color_transfer?: string }
type ProbeJson = { format?: { format_name?: string; duration?: string }; streams?: Stream[] }

const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])

export function parseProbeJson(json: string): ProbeResult {
  const data = JSON.parse(json) as ProbeJson
  const video = data.streams?.find((s) => s.codec_type === 'video')
  const duration = Number(data.format?.duration)
  return {
    durationS: Number.isFinite(duration) && duration > 0 ? duration : null,
    container: data.format?.format_name ?? null,
    videoCodec: video?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hdr: HDR_TRANSFERS.has(video?.color_transfer ?? ''),
    json
  }
}

export function probe(ffprobePath: string, file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 30_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error)
        try {
          resolve(parseProbeJson(stdout))
        } catch (e) {
          reject(e)
        }
      }
    )
  })
}
