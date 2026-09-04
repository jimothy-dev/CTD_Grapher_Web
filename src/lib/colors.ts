// Station colours are locked to position: the nth station always gets the nth
// colour, so every figure made from the same stations agrees. Ten fixed
// colours, then generated ones chosen to sit far from those already in use.
export const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#7f7f7f']

export function stationColor(index: number): string {
  if (index < PALETTE.length) return PALETTE[index]
  // golden-angle hue steps at alternating lightness keep later colours apart
  const k = index - PALETTE.length
  const hue = (k * 137.508) % 360
  const light = [42, 58, 34][k % 3]
  return `hsl(${hue.toFixed(0)} 65% ${light}%)`
}

// Colour scales for section plots: the cmocean maps (Thyng et al. 2016),
// sampled at 11 evenly spaced rows of the 256-row tables, MIT licence.
// oxy keeps its two hard edges at 0.2 and 0.8 of the range: below the first
// is red (hypoxic), above the second yellow (supersaturated).
export type ColorStops = [number, string][]
const even = (hex: string[]): ColorStops => hex.map((h, i) => [i / (hex.length - 1), h])
export const SCALES: Record<string, ColorStops> = {
  thermal: even(['#042333', '#10326c', '#40349f', '#694496', '#8b538d', '#b15f82', '#d66c6c', '#f3824d', '#fca63c', '#f7d045', '#e8fa5b']),
  haline: even(['#2a186c', '#2829a3', '#0d4e96', '#19678c', '#2d7c89', '#3c9387', '#4aaa81', '#65c172', '#94d35d', '#d0e06d', '#fdef9a']),
  dense: even(['#e6f1f1', '#badbe5', '#96c5e2', '#7bace4', '#7390e3', '#7871d5', '#7954bb', '#743a98', '#682471', '#531546', '#360e24']),
  algae: even(['#d7f9d0', '#b6e2ab', '#96cd8a', '#71ba6b', '#44a855', '#129450', '#097d4b', '#156641', '#1a5034', '#183a25', '#122414']),
  oxy: [[0, '#400505'], [0.098, '#6a060f'], [0.2, '#8f1808'], [0.2, '#504f4f'], [0.298, '#676666'], [0.4, '#81807f'], [0.498, '#9a9a99'], [0.6, '#b7b7b6'], [0.698, '#d4d4d3'], [0.8, '#f4f4f3'], [0.8, '#f8fe69'], [0.898, '#e7d82d'], [1, '#ddaf19']],
  turbid: even(['#e9f6ab', '#dbd886', '#cfbc66', '#c3a04d', '#b58740', '#a1703b', '#8a5e3a', '#704d37', '#563e30', '#3b2f27', '#221f1b']),
  turbid_r: even(['#221f1b', '#3b2f27', '#563e30', '#704d37', '#8a5e3a', '#a1703b', '#b58740', '#c3a04d', '#cfbc66', '#dbd886', '#e9f6ab']),
  matter: even(['#feedb0', '#fac98e', '#f5a773', '#ee835d', '#e26253', '#ce4356', '#b32e5f', '#932063', '#721a60', '#4f1652', '#2f0f3e']),
  deep: even(['#fdfecc', '#c8eab1', '#92d8a4', '#65c2a4', '#52a8a3', '#488e9e', '#407598', '#3e5a92', '#41407b', '#382d51', '#281a2c']),
}

// Fixed colour ranges so a colour always means the same value from one survey
// to the next. Ends are round numbers and `tick` lands the colour bar labels
// on whole numbers. Ranges come from long-term monitoring percentiles for
// Puget Sound and temperate estuaries (King County offshore CTD, Ecology,
// PSEMP, Alin et al. 2024); values outside a range take the end colour.
// Oxygen depends on the unit the cast carries, and its ranges are chosen so
// the oxy map's red edge sits at the 2 mg/L hypoxia threshold and its yellow
// edge at 100 % saturation.
type Fixed = { range: [number, number]; tick: number }
interface Default { scale: string; fixed: Fixed | Record<string, Fixed> | null }
export const DEFAULTS: Record<string, Default> = {
  'Temperature': { scale: 'thermal', fixed: { range: [6, 20], tick: 2 } },
  'Salinity': { scale: 'haline', fixed: { range: [20, 32], tick: 2 } },
  'Density (sigma-t)': { scale: 'dense', fixed: { range: [18, 26], tick: 1 } },
  'Dissolved Oxygen': { scale: 'oxy', fixed: { 'mg/l': { range: [0, 10], tick: 2 }, 'ml/l': { range: [0, 7], tick: 1 }, '% sat': { range: [0, 125], tick: 25 }, 'mol/kg': { range: [0, 350], tick: 50 } } },
  'Fluorescence': { scale: 'algae', fixed: { range: [0, 20], tick: 2 } },
  'Beam Transmission': { scale: 'turbid_r', fixed: { range: [50, 100], tick: 10 } },
  'Turbidity': { scale: 'turbid', fixed: { range: [0, 5], tick: 1 } },
  'CDOM': { scale: 'matter', fixed: null },
}

// A round step for about n intervals across a span.
export function niceStep(span: number, n = 8): number {
  const raw = Math.max(Math.abs(span), 1e-9) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw
}

export function defaultScale(variable: string, units: string): { colorscale: ColorStops; range: [number, number] | null; tick: number } {
  const d = DEFAULTS[variable] ?? { scale: 'deep', fixed: null }
  let fixed: Fixed | null = null
  if (d.fixed && 'range' in d.fixed) fixed = d.fixed as Fixed
  else if (d.fixed) {
    const u = units.toLowerCase()
    const hit = Object.entries(d.fixed as Record<string, Fixed>).find(([k]) => u.includes(k))
    fixed = hit ? hit[1] : null
  }
  return { colorscale: SCALES[d.scale], range: fixed?.range ?? null, tick: fixed?.tick ?? 1 }
}

export function percentileRange(values: Iterable<number | null>, lo = 0.02, hi = 0.98): [number, number] | null {
  const v = [...values].filter((a): a is number => a !== null && Number.isFinite(a)).sort((a, b) => a - b)
  if (!v.length) return null
  return [v[Math.floor(lo * (v.length - 1))], v[Math.floor(hi * (v.length - 1))]]
}

// Golden Software Surfer .clr colour map:
//   ColorMap [Version] [InterpMethod] [ColorNodes] [OpacityNodes]
//   Position(0-100) R G B [Alpha]   ... v3 adds "Position Opacity" lines after.
// levels: when a palette carries real values (Surfer .lvl, GMT .cpt, value
// r g b lists) its first and last level set the colour range too.
export interface Clr { version: number; interp: number; stops: ColorStops; warnings: string[]; levels?: number[] }
export function parseClr(text: string): Clr {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("'"))
  const head = lines.shift() ?? ''
  const hm = head.match(/^ColorMap(?:\s+(\d+))?(?:\s+(\d+))?(?:\s+(\d+))?(?:\s+(\d+))?/i)
  if (!hm) throw new Error("Not a Surfer .clr file (missing 'ColorMap' header)")
  const version = hm[1] ? +hm[1] : 1, interp = hm[2] ? +hm[2] : 0
  const nColor = hm[3] ? +hm[3] : null
  const colours: { pos: number; r: number; g: number; b: number; a: number }[] = []
  const opacities: [number, number][] = []
  for (const l of lines) {
    const p = l.split(/\s+/).map(Number)
    if (p.some(Number.isNaN)) continue
    if (nColor !== null && colours.length >= nColor && p.length === 2) opacities.push([p[0], p[1]])
    else if (p.length >= 4) colours.push({ pos: p[0], r: p[1], g: p[2], b: p[3], a: p.length > 4 ? p[4] : 255 })
    else if (p.length === 2) opacities.push([p[0], p[1]])
  }
  if (colours.length < 2) throw new Error('.clr has fewer than two colour nodes')
  colours.sort((a, b) => a.pos - b.pos)
  const warnings: string[] = []
  if (colours[0].pos !== 0 || colours[colours.length - 1].pos !== 100) warnings.push('positions do not span 0 to 100; clamped')
  if (interp !== 0) warnings.push(`InterpMethod ${interp} treated as linear`)
  colours[0].pos = 0; colours[colours.length - 1].pos = 100
  opacities.sort((a, b) => a[0] - b[0])
  const opAt = (pos: number): number | null => {
    if (!opacities.length) return null
    if (pos <= opacities[0][0]) return opacities[0][1]
    for (let i = 0; i < opacities.length - 1; i++) {
      const [p0, o0] = opacities[i], [p1, o1] = opacities[i + 1]
      if (pos <= p1) return o0 + (o1 - o0) * (pos - p0) / (p1 - p0)
    }
    return opacities[opacities.length - 1][1]
  }
  const stops: ColorStops = colours.map(c => {
    const o = opAt(c.pos)
    const alpha = o === null ? c.a / 255 : o / 100
    return [c.pos / 100, `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`]
  })
  return { version, interp, stops, warnings }
}
