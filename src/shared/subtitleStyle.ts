// How subtitles look: Apple TV's options plus a height slider. The global style
// is a settings row; a title keeps only the fields the user changed for it.

export const FONTS = ['default', 'arial', 'georgia', 'courier', 'consolas', 'trebuchet', 'casual', 'cursive', 'smallCaps'] as const
export type FontId = (typeof FONTS)[number]

export const EDGES = ['none', 'dropShadow', 'raised', 'depressed', 'outline'] as const
export type Edge = (typeof EDGES)[number]

export type SubtitleStyle = {
  font: FontId
  size: number // % of the base size, 50–200
  textColor: string // #rrggbb
  textOpacity: number // 0–100
  edge: Edge
  backgroundColor: string // per-line box
  backgroundOpacity: number
  windowColor: string // box around the whole cue
  windowOpacity: number
  position: number // 0 = bottom of the screen, 100 = top
}

export const FONT_NAMES: Record<FontId, string> = {
  default: 'Default',
  arial: 'Arial',
  georgia: 'Georgia',
  courier: 'Courier',
  consolas: 'Consolas',
  trebuchet: 'Trebuchet',
  casual: 'Casual',
  cursive: 'Cursive',
  smallCaps: 'Small Capitals'
}

export const EDGE_NAMES: Record<Edge, string> = {
  none: 'None',
  dropShadow: 'Drop Shadow',
  raised: 'Raised',
  depressed: 'Depressed',
  outline: 'Outline'
}

export const COLORS: { name: string; value: string }[] = [
  { name: 'White', value: '#ffffff' },
  { name: 'Yellow', value: '#ffff00' },
  { name: 'Cyan', value: '#00ffff' },
  { name: 'Green', value: '#00ff00' },
  { name: 'Magenta', value: '#ff00ff' },
  { name: 'Red', value: '#ff0000' },
  { name: 'Blue', value: '#0000ff' },
  { name: 'Black', value: '#000000' }
]

export type PresetId = 'default' | 'largeText' | 'classic' | 'outline'
export type Look = Omit<SubtitleStyle, 'position'>

const base: Look = {
  font: 'default',
  size: 100,
  textColor: '#ffffff',
  textOpacity: 100,
  edge: 'dropShadow',
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  windowColor: '#000000',
  windowOpacity: 0
}

// A preset is a whole look; it never moves the subtitles.
export const PRESETS: Record<PresetId, Look> = {
  default: base,
  largeText: { ...base, size: 150 },
  classic: { ...base, font: 'consolas', edge: 'none', backgroundOpacity: 100 },
  outline: { ...base, edge: 'outline' }
}

export const PRESET_NAMES: Record<PresetId | 'custom', string> = {
  default: 'Default',
  largeText: 'Large Text',
  classic: 'Classic',
  outline: 'Outline Text',
  custom: 'Custom'
}

export const DEFAULT_STYLE: SubtitleStyle = { ...base, position: 0 }

const LOOK_KEYS = Object.keys(base) as (keyof Look)[]

export function presetOf(s: SubtitleStyle): PresetId | 'custom' {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    if (LOOK_KEYS.every((k) => PRESETS[id][k] === s[k])) return id
  }
  return 'custom'
}

export const effectiveStyle = (global: SubtitleStyle, overrides: Partial<SubtitleStyle>): SubtitleStyle => ({
  ...global,
  ...overrides
})

const HEX = /^#[0-9a-f]{6}$/
const RANGES: Partial<Record<keyof SubtitleStyle, [number, number]>> = {
  size: [50, 200],
  textOpacity: [0, 100],
  backgroundOpacity: [0, 100],
  windowOpacity: [0, 100],
  position: [0, 100]
}

// One field read from storage or the renderer: undefined when it isn't usable.
function cleanField<K extends keyof SubtitleStyle>(key: K, v: unknown): SubtitleStyle[K] | undefined {
  const range = RANGES[key]
  if (range) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
    return Math.min(range[1], Math.max(range[0], Math.round(v))) as SubtitleStyle[K]
  }
  if (key === 'font') return (FONTS as readonly unknown[]).includes(v) ? (v as SubtitleStyle[K]) : undefined
  if (key === 'edge') return (EDGES as readonly unknown[]).includes(v) ? (v as SubtitleStyle[K]) : undefined
  return typeof v === 'string' && HEX.test(v.toLowerCase()) ? (v.toLowerCase() as SubtitleStyle[K]) : undefined
}

const STYLE_KEYS = Object.keys(DEFAULT_STYLE) as (keyof SubtitleStyle)[]

// Only the known, valid fields of an untrusted partial style.
export function sanitizePatch(raw: unknown): Partial<SubtitleStyle> {
  const out: Partial<Record<keyof SubtitleStyle, unknown>> = {}
  if (!raw || typeof raw !== 'object') return {}
  for (const k of STYLE_KEYS) {
    const v = cleanField(k, (raw as Record<string, unknown>)[k])
    if (v !== undefined) out[k] = v
  }
  return out as Partial<SubtitleStyle>
}

// A complete style from untrusted input; missing or bad fields take the defaults.
export const sanitizeStyle = (raw: unknown): SubtitleStyle => ({ ...DEFAULT_STYLE, ...sanitizePatch(raw) })
