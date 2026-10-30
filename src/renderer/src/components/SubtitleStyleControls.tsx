import { useRef } from 'react'
import {
  COLORS,
  EDGE_NAMES,
  EDGES,
  FONT_NAMES,
  FONTS,
  PRESET_NAMES,
  PRESETS,
  presetOf,
  type PresetId,
  type SubtitleStyle
} from '@shared/subtitleStyle'
import './subtitleControls.css'

type Choice<T> = { value: T; label: string; swatch?: string }
type RowProps =
  | { name: string; kind: 'choice'; options: Choice<string>[]; value: string; valueLabel?: string; onSet: (v: string) => void }
  | { name: string; kind: 'range'; min: number; max: number; step: number; unit: string; value: number; onSet: (v: number) => void }

const colorChoices: Choice<string>[] = COLORS.map((c) => ({ value: c.value, label: c.name, swatch: c.value }))

// One setting, Apple TV style: ←/→ change it, ↑/↓ move between settings,
// Home/End jump to the ends. Exposed as a slider so screen readers announce it.
function Row(p: RowProps) {
  const track = useRef<HTMLDivElement>(null)
  const isRange = p.kind === 'range'
  const index = isRange ? 0 : Math.max(0, p.options.findIndex((o) => o.value === p.value))
  const text = isRange ? `${p.value}${p.unit}` : (p.valueLabel ?? p.options[index]!.label)

  function move(by: number | 'min' | 'max') {
    if (p.kind === 'range') {
      const next = by === 'min' ? p.min : by === 'max' ? p.max : Math.min(p.max, Math.max(p.min, p.value + by * p.step))
      if (next !== p.value) p.onSet(next)
    } else {
      const last = p.options.length - 1
      const i = by === 'min' ? 0 : by === 'max' ? last : Math.min(last, Math.max(0, index + by))
      const known = p.options.some((o) => o.value === p.value)
      if (i !== index || !known) p.onSet(p.options[i]!.value)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const rows = [...(e.currentTarget.closest('.style-controls')?.querySelectorAll<HTMLElement>('.style-row') ?? [])]
    const at = rows.indexOf(e.currentTarget)
    switch (e.key) {
      case 'ArrowLeft':
        move(-1)
        break
      case 'ArrowRight':
        move(1)
        break
      case 'Home':
        move('min')
        break
      case 'End':
        move('max')
        break
      case 'ArrowUp':
        rows[Math.max(0, at - 1)]?.focus()
        break
      case 'ArrowDown':
        rows[Math.min(rows.length - 1, at + 1)]?.focus()
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  // Dragging along a range row's track sets it directly.
  function drag(e: React.PointerEvent<HTMLDivElement>) {
    if (p.kind !== 'range' || (e.type === 'pointermove' && !e.currentTarget.hasPointerCapture(e.pointerId))) return
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId)
    const r = track.current!.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const v = Math.round(p.min + f * (p.max - p.min))
    if (v !== p.value) p.onSet(v)
  }

  return (
    <div
      className="style-row"
      role="slider"
      tabIndex={0}
      aria-label={p.name}
      aria-valuetext={text}
      aria-valuenow={isRange ? p.value : index}
      aria-valuemin={isRange ? p.min : 0}
      aria-valuemax={isRange ? p.max : p.options.length - 1}
      onKeyDown={onKeyDown}
    >
      <span className="style-name">{p.name}</span>
      <button type="button" tabIndex={-1} aria-label={`Previous ${p.name}`} onClick={() => move(-1)}>
        ‹
      </button>
      {p.kind === 'range' ? (
        <div ref={track} className="style-track" onPointerDown={drag} onPointerMove={drag}>
          <i style={{ transform: `scaleX(${(p.value - p.min) / (p.max - p.min)})` }} />
        </div>
      ) : (
        <span className="style-value">
          {p.options[index]?.swatch && <i className="swatch" style={{ background: p.options[index]!.swatch }} />}
          {text}
        </span>
      )}
      {p.kind === 'range' && <span className="style-number">{text}</span>}
      <button type="button" tabIndex={-1} aria-label={`Next ${p.name}`} onClick={() => move(1)}>
        ›
      </button>
    </div>
  )
}

// Every subtitle style setting, used by the player's style panel and by Settings.
export function SubtitleStyleControls({ style, onChange }: { style: SubtitleStyle; onChange: (patch: Partial<SubtitleStyle>) => void }) {
  const preset = presetOf(style)
  const presets = (Object.keys(PRESETS) as PresetId[]).map((id) => ({ value: id, label: PRESET_NAMES[id] }))
  return (
    <div className="style-controls">
      <Row
        name="Style"
        kind="choice"
        options={presets}
        value={preset}
        valueLabel={PRESET_NAMES[preset]}
        onSet={(id) => onChange({ ...PRESETS[id as PresetId] })}
      />
      <Row name="Font" kind="choice" options={FONTS.map((f) => ({ value: f, label: FONT_NAMES[f] }))} value={style.font} onSet={(v) => onChange({ font: v as SubtitleStyle['font'] })} />
      <Row name="Size" kind="range" min={50} max={200} step={10} unit="%" value={style.size} onSet={(v) => onChange({ size: v })} />
      <Row name="Text colour" kind="choice" options={colorChoices} value={style.textColor} onSet={(v) => onChange({ textColor: v })} />
      <Row name="Text opacity" kind="range" min={0} max={100} step={5} unit="%" value={style.textOpacity} onSet={(v) => onChange({ textOpacity: v })} />
      <Row name="Edge" kind="choice" options={EDGES.map((e) => ({ value: e, label: EDGE_NAMES[e] }))} value={style.edge} onSet={(v) => onChange({ edge: v as SubtitleStyle['edge'] })} />
      <Row name="Background" kind="choice" options={colorChoices} value={style.backgroundColor} onSet={(v) => onChange({ backgroundColor: v })} />
      <Row name="Background opacity" kind="range" min={0} max={100} step={5} unit="%" value={style.backgroundOpacity} onSet={(v) => onChange({ backgroundOpacity: v })} />
      <Row name="Window" kind="choice" options={colorChoices} value={style.windowColor} onSet={(v) => onChange({ windowColor: v })} />
      <Row name="Window opacity" kind="range" min={0} max={100} step={5} unit="%" value={style.windowOpacity} onSet={(v) => onChange({ windowOpacity: v })} />
      <Row name="Position" kind="range" min={0} max={100} step={5} unit="" value={style.position} onSet={(v) => onChange({ position: v })} />
    </div>
  )
}
