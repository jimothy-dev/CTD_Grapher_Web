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

// Colour scales for section plots: approximations of cmocean's thermal,
// haline, dense and algae, a diverging one for oxygen, a neutral fallback.
export type ColorStops = [number, string][]
export const SCALES: Record<string, ColorStops> = {
  thermal: [[0, '#042333'], [0.13, '#2c3395'], [0.25, '#744992'], [0.38, '#b04a86'], [0.5, '#dc4e7a'], [0.63, '#f56b5c'], [0.75, '#fb9b48'], [0.88, '#f8cf44'], [1, '#e8fa5b']],
  haline: [[0, '#2a186c'], [0.13, '#1c3f9e'], [0.25, '#10618f'], [0.38, '#1a7a7a'], [0.5, '#2c9670'], [0.63, '#4db05a'], [0.75, '#8dc94a'], [0.88, '#cfdf4e'], [1, '#fdee99']],
  dense: [[0, '#e6f1f1'], [0.2, '#a6cddc'], [0.4, '#6fa5d0'], [0.6, '#6a7fc1'], [0.8, '#6a4d9c'], [1, '#360e24']],
  algae: [[0, '#d7f9d0'], [0.25, '#95d391'], [0.5, '#4aa869'], [0.75, '#1b7a4b'], [1, '#0a3f2c']],
  oxygen: [[0, '#67001f'], [0.2, '#d6604d'], [0.4, '#fddbc7'], [0.5, '#f7f7f7'], [0.6, '#d1e5f0'], [0.8, '#4393c3'], [1, '#053061']],
  deep: [[0, '#fdfecc'], [0.25, '#a5dfa7'], [0.5, '#4fa3a5'], [0.75, '#3b5a8f'], [1, '#281a2c']],
  turbid: [[0, '#e9f5db'], [0.5, '#b08b4a'], [1, '#3b2a1a']],
}

// Fixed colour ranges so a colour always means the same value from one survey
// to the next. Chosen for Puget Sound; readings outside a range take the end
// colour. Oxygen depends on the unit the cast carries.
interface Default { scale: string; range: [number, number] | Record<string, [number, number]> | null }
export const DEFAULTS: Record<string, Default> = {
  'Temperature': { scale: 'thermal', range: [7, 14] },
  'Salinity': { scale: 'haline', range: [26, 31] },
  'Density (sigma-t)': { scale: 'dense', range: [19.5, 24] },
  'Dissolved Oxygen': { scale: 'oxygen', range: { 'mg/l': [4, 12], 'ml/l': [2.5, 8.5], '% sat': [40, 120], 'mol/kg': [100, 380] } },
  'Fluorescence': { scale: 'algae', range: [0, 5] },
  'Beam Transmission': { scale: 'deep', range: [60, 100] },
  'Turbidity': { scale: 'turbid', range: [0, 10] },
}

export function defaultScale(variable: string, units: string): { colorscale: ColorStops; range: [number, number] | null } {
  const d = DEFAULTS[variable] ?? { scale: 'deep', range: null }
  let range: [number, number] | null = null
  if (Array.isArray(d.range)) range = d.range
  else if (d.range) {
    const u = units.toLowerCase()
    const hit = Object.entries(d.range).find(([k]) => u.includes(k))
    range = hit ? hit[1] : null
  }
  return { colorscale: SCALES[d.scale], range }
}

export function percentileRange(values: Iterable<number | null>, lo = 0.02, hi = 0.98): [number, number] | null {
  const v = [...values].filter((a): a is number => a !== null && Number.isFinite(a)).sort((a, b) => a - b)
  if (!v.length) return null
  return [v[Math.floor(lo * (v.length - 1))], v[Math.floor(hi * (v.length - 1))]]
}

// Golden Software Surfer .clr colour map:
//   ColorMap [Version] [InterpMethod] [ColorNodes] [OpacityNodes]
//   Position(0-100) R G B [Alpha]   ... v3 adds "Position Opacity" lines after.
export interface Clr { version: number; interp: number; stops: ColorStops; warnings: string[] }
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
