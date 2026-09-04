// Vertical section: distance along the transect against depth, coloured by
// one variable. Interpolation in two passes: each cast onto a common depth
// grid, then across stations at every depth. Interpolating between stations
// invents structure that was never measured; the station markers on top show
// where the real data is.
import type { PlotData, Layout } from 'plotly.js'
import { profile, type Cast } from './cnv'
import { alongTrack } from './geo'
import { defaultScale, percentileRange, niceStep, type ColorStops } from './colors'
import { labelWithUnits, prettyUnits } from './units'

export const BEFORE = '<before>'
export const AFTER = '<after>'

export interface SectionStation {
  id: string
  label: string        // text above the marker
  color: string
  lat: number
  lon: number
  cast: Cast
  // seafloor points: km from here towards the station `to` (an id, or BEFORE /
  // AFTER for a point out past the first or last station), depth m
  mids: { d: number; z: number; to: string | null }[]
}

export interface SectionOptions {
  variable: string
  shorts: string[]
  depthMin?: number | null
  depthMax?: number | null
  nContours?: number
  colorscale?: ColorStops | null
  range?: [number, number] | 'auto' | null
  grid?: [number, number]
  colorbarName?: boolean     // "Temperature (°C)" on the colour bar rather than "°C"
}

export interface SectionResult {
  data: Partial<PlotData>[]
  layout: Partial<Layout>
  distances: number[]
  units: string
  notes: string[]     // what was used, skipped and why, and any extension past the ends
  used: number
  autoTitle: string
}

// Linear resample of a sorted profile onto grid depths: the top value is held
// up to the surface and the deepest value is carried down, so the field can
// reach the seafloor line instead of stopping in a white wedge.
function resample(z: number[], v: number[], zGrid: number[]): number[] {
  const out = new Array<number>(zGrid.length).fill(NaN)
  if (!z.length) return out
  let j = 0
  for (let i = 0; i < zGrid.length; i++) {
    const zg = zGrid[i]
    if (zg <= z[0]) { out[i] = v[0]; continue }
    if (zg >= z[z.length - 1]) { out[i] = v[v.length - 1]; continue }
    while (j < z.length - 2 && z[j + 1] < zg) j++
    const z0 = z[j], z1 = z[j + 1]
    out[i] = z1 === z0 ? v[j] : v[j] + (v[j + 1] - v[j]) * (zg - z0) / (z1 - z0)
  }
  return out
}

function niceTicks(lo: number, hi: number, n = 8): number[] {
  const step = niceStep(hi - lo, n)
  lo = Math.max(lo, 0)
  const first = lo <= step * 0.05 ? 0 : Math.ceil(lo / step) * step
  const out: number[] = []
  for (let t = first; t <= hi + step * 0.01; t += step) out.push(+t.toFixed(6))
  return out
}

function interp1(xp: number[], fp: number[], x: number): number {
  if (x <= xp[0]) return fp[0]
  if (x >= xp[xp.length - 1]) return fp[fp.length - 1]
  let k = 0
  while (k < xp.length - 2 && xp[k + 1] < x) k++
  const x0 = xp[k], x1 = xp[k + 1]
  return x1 === x0 ? fp[k] : fp[k] + (fp[k + 1] - fp[k]) * (x - x0) / (x1 - x0)
}

export function buildSection(stations: SectionStation[], opts: SectionOptions): SectionResult | null {
  if (stations.length < 2) return null
  const profs = stations.map(s => profile(s.cast, opts.shorts))
  if (profs.some(p => !p || !p.z.length)) return null
  const dist = alongTrack(stations)
  const last = stations.length - 1
  const dmin = opts.depthMin ?? null, dmax = opts.depthMax ?? null
  const notes: string[] = []

  // each cast windowed, then its bottom
  const windowed = profs.map(p => {
    const z: number[] = [], v: number[] = []
    for (let i = 0; i < p!.z.length; i++) {
      if (dmin !== null && p!.z[i] < dmin) continue
      if (dmax !== null && p!.z[i] > dmax) continue
      z.push(p!.z[i]); v.push(p!.v[i])
    }
    return { z, v }
  })
  if (windowed.some(w => !w.z.length)) return null
  const bottoms = windowed.map(w => w.z[w.z.length - 1])

  // Seafloor line: cast bottoms plus typed points. A point belongs to the
  // segment between its station and the neighbour it was measured towards; a
  // point before the first or after the last station extends the section.
  const floorPts: [number, number][] = dist.map((x, i) => [x, bottoms[i]])
  let used = 0
  const labelOf = (id: string | null) => (id === null ? null : stations.find(t => t.id === id)?.label ?? null)
  let xMin = dist[0], xMax = dist[last]
  stations.forEach((s, i) => {
    for (const m of s.mids) {
      const { d, z } = m
      if (!(d > 0)) { notes.push(`${s.label}: point at ${d} km skipped, it must be more than 0 km from the station`); continue }
      if (!(z > 0)) { notes.push(`${s.label}: point at ${d} km skipped, depth must be above 0 m`); continue }
      if (m.to === BEFORE || m.to === AFTER) {
        const ok = m.to === BEFORE ? i === 0 : i === last
        if (!ok) { notes.push(`${s.label}: point ${m.to === BEFORE ? 'before' : 'beyond'} the line skipped, the station is no longer at that end`); continue }
        const x = m.to === BEFORE ? dist[0] - d : dist[last] + d
        floorPts.push([x, z]); used++
        xMin = Math.min(xMin, x); xMax = Math.max(xMax, x)
        continue
      }
      if (m.to === null && i === last) { notes.push(`${s.label}: points after the last station are not used`); continue }
      const j = m.to === null ? i + 1 : stations.findIndex(t => t.id === m.to)
      if (j !== i + 1 && j !== i - 1) {
        notes.push(`${s.label}: point towards ${labelOf(m.to) ?? 'a station not on the line'} skipped, they are no longer next to each other`)
        continue
      }
      const seg = Math.abs(dist[j] - dist[i])
      if (d >= seg) { notes.push(`${s.label}: point at ${d} km skipped, ${stations[j].label} is only ${seg.toFixed(2)} km away`); continue }
      floorPts.push([j > i ? dist[i] + d : dist[i] - d, z])
      used++
    }
  })
  floorPts.sort((a, b) => a[0] - b[0])
  const deepestFloor = Math.max(...floorPts.map(p => p[1]))
  if (xMin < dist[0]) notes.push(`extended ${(dist[0] - xMin).toFixed(2)} km before ${stations[0].label}, colours there repeat that station`)
  if (xMax > dist[last]) notes.push(`extended ${(xMax - dist[last]).toFixed(2)} km beyond ${stations[last].label}, colours there repeat that station`)

  const top = dmin ?? Math.min(...windowed.map(w => w.z[0]))
  const bot = dmax ?? Math.max(Math.max(...bottoms), deepestFloor)
  const [nx, ny] = opts.grid ?? [240, 200]
  const xs = Array.from({ length: nx }, (_, i) => xMin + (xMax - xMin) * i / (nx - 1))
  const surface = Math.max(0, top)
  const ys = Array.from({ length: ny }, (_, j) => surface + (bot - surface) * j / (ny - 1))

  const columns = windowed.map(w => resample(w.z, w.v, ys))
  // horizontal pass: linear between stations at every depth, held constant
  // past the end stations when the section is extended
  const z: number[][] = []
  for (let j = 0; j < ny; j++) {
    const row = new Array<number>(nx)
    for (let i = 0; i < nx; i++) row[i] = interp1(dist, columns.map(c => c[j]), xs[i])
    z.push(row)
  }
  // the polygon passes through every typed point exactly and stays inside the window
  const px = [...new Set([...xs, ...floorPts.map(p => p[0])])].sort((a, b) => a - b)
  const floor = px.map(x => Math.min(Math.max(interp1(floorPts.map(p => p[0]), floorPts.map(p => p[1]), x), surface), bot))

  const units = profs[0]!.units
  const def = defaultScale(opts.variable, units)
  const colorscale = opts.colorscale ?? def.colorscale
  let range: [number, number] | null = null
  if (opts.range === 'auto' || (!opts.range && !def.range)) range = percentileRange(z.flat())
  else if (Array.isArray(opts.range)) range = opts.range
  else range = def.range
  if (!range || range[0] === range[1]) range = range ? [range[0] - 0.5, range[1] + 0.5] : [0, 1]
  const tick = opts.range === 'auto' || !def.range ? niceStep(range[1] - range[0], 7) : def.tick

  const n = opts.nContours ?? 0
  const labelStyle = { showlabels: true, labelfont: { size: 9, color: '#111' } }
  const contours = n > 0
    ? { coloring: 'fill' as const, showlines: true, start: range[0], end: range[1], size: Math.max((range[1] - range[0]) / n, 1e-9), ...labelStyle }
    : { coloring: 'heatmap' as const, ...labelStyle }

  const span = Math.max(bot - surface, 1e-9)
  const headRoom = span * 0.13
  const yMarker = surface - headRoom * 0.3
  const axisBottom = bot + span * 0.02
  const unitText = prettyUnits(units)
  const cbTitle = opts.colorbarName ? labelWithUnits(opts.variable, units) : (unitText || opts.variable)

  const data: Partial<PlotData>[] = [{
    type: 'contour', x: xs, y: ys, z, colorscale, zmin: range[0], zmax: range[1], zauto: false,
    contours, line: { width: 0.5, color: 'rgba(0,0,0,0.35)' }, connectgaps: false,
    colorbar: { title: { text: cbTitle, side: 'right' }, thickness: 14, len: 0.9, outlinewidth: 0, tick0: range[0], dtick: tick, tickformat: '.2f' },
    hovertemplate: `%{x:.2f} km<br>%{y:.1f} m<br>${opts.variable}: %{z:.3f} ${unitText}<extra></extra>`,
  } as Partial<PlotData>, {
    type: 'scatter', mode: 'lines', name: 'seafloor', fill: 'toself', fillcolor: '#000000',
    x: [...px, px[px.length - 1], px[0]], y: [...floor, axisBottom, axisBottom],
    line: { width: 0, color: '#000000' }, hoverinfo: 'skip', showlegend: false,
  }]
  stations.forEach((s, i) => data.push({
    type: 'scatter', mode: 'text+markers', x: [dist[i]], y: [yMarker], name: s.label,
    marker: { symbol: 'triangle-down', size: 13, color: s.color, line: { color: 'white', width: 1 } },
    text: [s.label], textposition: 'top center', textfont: { size: 11 },
    cliponaxis: false, hoverinfo: 'skip', showlegend: false,
  } as Partial<PlotData>))

  const axis = { showgrid: false, zeroline: false, showline: true, linecolor: '#888', ticks: 'outside' as const, ticklen: 4, tickcolor: '#888', tickfont: { size: 10 }, fixedrange: true }
  const layout: Partial<Layout> = {
    xaxis: { title: { text: 'Distance along transect (km)', standoff: 8 }, range: [xMin, xMax], ...axis },
    yaxis: { title: { text: profs[0]!.depthLabel, standoff: 8 }, range: [axisBottom, surface - headRoom], tickvals: niceTicks(surface, bot), ...axis },
    margin: { l: 64, r: 24, t: 40, b: 56 }, showlegend: false,
    dragmode: false, hovermode: 'closest',
    modebar: { remove: ['zoom2d', 'pan2d', 'select2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'] },
  }
  if (used) notes.unshift(`${used} seafloor point${used === 1 ? '' : 's'} used`)
  return { data, layout, distances: dist, units, notes, used, autoTitle: `${opts.variable} section` }
}
