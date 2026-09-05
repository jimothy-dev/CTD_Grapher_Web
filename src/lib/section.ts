// Vertical section: distance along the transect against depth, coloured by
// one variable. Two passes: each cast onto a common depth grid, then across
// stations at every depth, either straight between neighbours or with a
// shape-preserving cubic through every station. Interpolating between
// stations invents structure that was never measured; the station markers on
// top show where the real data is.
import type { PlotData, Layout } from 'plotly.js'
import { profile, unitMismatch, type Cast } from './cnv'
import { alongTrack } from './geo'
import { defaultScale, percentileRange, niceStep, type ColorStops } from './colors'
import { labelWithUnits, prettyUnits, unitFactor } from './units'

export interface RoutePoint { lat: number; lon: number; depth: number | null }

export interface SectionStation {
  id: string
  label: string        // text above the marker
  color: string
  lat: number
  lon: number
  cast: Cast
  // waypoints from this station on: towards the next station, or, for the
  // last station, out beyond the end of the line. A depth makes one a
  // seafloor point at its place on the route.
  route?: RoutePoint[]
  // waypoints ahead of the first station, farthest first
  lead?: RoutePoint[]
}

export interface Route {
  dist: number[]                                   // each station's distance, the first at 0
  xMin: number                                     // start of the line (0, or less with waypoints before)
  xMax: number                                     // end of the line
  path: { x: number; lat: number; lon: number }[]  // every vertex in order with its distance
  waypointPts: [number, number][]                  // [distance, depth] of waypoints given a depth
}

// Cumulative distance along the routed line: waypoints before the first
// station, then each station and the waypoints after it.
export function routeDistances(stations: SectionStation[]): Route {
  const vertices: RoutePoint[] = [...(stations[0]?.lead ?? [])]
  const stationAt: number[] = []
  for (const s of stations) {
    stationAt.push(vertices.length)
    vertices.push({ lat: s.lat, lon: s.lon, depth: null })
    vertices.push(...(s.route ?? []))
  }
  const along = alongTrack(vertices)
  const offset = along[stationAt[0] ?? 0] ?? 0
  const path = vertices.map((v, i) => ({ x: along[i] - offset, lat: v.lat, lon: v.lon }))
  const isStation = new Set(stationAt)
  const waypointPts: [number, number][] = []
  vertices.forEach((v, i) => { if (!isStation.has(i) && v.depth !== null && v.depth > 0) waypointPts.push([path[i].x, v.depth]) })
  return { dist: stationAt.map(i => path[i].x), xMin: path[0]?.x ?? 0, xMax: path[path.length - 1]?.x ?? 0, path, waypointPts }
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
  interpolation?: 'smooth' | 'oa' | 'linear'
  oaScale?: number | null      // objective analysis covariance scale in km; null or 0 means twice the mean station spacing
  // surveyed seafloor along the route: distance and elevation (m above sea
  // level, negative under water, null where the source has nothing)
  seafloor?: { x: number; elevation: number | null }[] | null
  seafloorName?: string
}

export interface SectionResult {
  data: Partial<PlotData>[]
  layout: Partial<Layout>
  distances: number[]
  units: string
  notes: string[]     // what was used, skipped and why, and any extension past the ends
  warnings: string[]  // things to fix: land on the line, units that differ between stations
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

// Shape-preserving cubic (PCHIP, Fritsch and Carlson 1980) through the
// stations at one depth: smooth through each station, never overshooting the
// values on either side, straight when there are only two stations. This is
// the curved look of Surfer's and ODV's gridders without a smoothing radius
// to choose, and it still passes exactly through every cast.
function pchipSlopes(x: number[], y: number[]): number[] {
  const n = x.length
  const d = new Array<number>(n).fill(0)
  if (n < 2) return d
  const h: number[] = [], delta: number[] = []
  for (let k = 0; k < n - 1; k++) { const hk = Math.max(x[k + 1] - x[k], 1e-9); h.push(hk); delta.push((y[k + 1] - y[k]) / hk) }
  if (n === 2) { d[0] = d[1] = delta[0]; return d }
  for (let k = 1; k < n - 1; k++) {
    if (delta[k - 1] * delta[k] <= 0) { d[k] = 0; continue }
    const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1]
    d[k] = (w1 + w2) / (w1 / delta[k - 1] + w2 / delta[k])
  }
  const end = (h0: number, h1: number, del0: number, del1: number) => {
    let s = ((2 * h0 + h1) * del0 - h0 * del1) / (h0 + h1)
    if (Math.sign(s) !== Math.sign(del0)) s = 0
    else if (Math.sign(del0) !== Math.sign(del1) && Math.abs(s) > Math.abs(3 * del0)) s = 3 * del0
    return s
  }
  d[0] = end(h[0], h[1], delta[0], delta[1])
  d[n - 1] = end(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3])
  return d
}

// Objective analysis (Gauss-Markov optimal interpolation, Bretherton, Davis
// and Fandry 1976), the gridder of the oceanographic literature, applied
// along the line at every depth. Each station's departure from the mean at
// that depth is weighted through a Markov (exponential) covariance with scale
// L. The exponential form was chosen over the Gaussian one after measuring
// both: with a Gaussian the field rang by up to a salinity unit between two
// casts that agreed, and two close stations were averaged; the Markov form
// never overshoots between neighbours. The tiny noise term only keeps the
// solve well posed, so the field passes through every cast; between stations
// far apart compared with L it eases towards that depth's mean, which a
// longer L flattens. The station covariance is factorised once, so a depth
// level costs a few multiplies.
function gaussMarkov(xp: number[], xs: number[], L: number, eps: number): (vals: number[]) => number[] {
  const n = xp.length
  const cov = (a: number, b: number) => Math.exp(-Math.abs(a - b) / L)
  const lu = luFactor(xp.map((a, i) => xp.map((b, j) => cov(a, b) + (i === j ? eps : 0))))
  const G = xs.map(x => { const xc = Math.min(Math.max(x, xp[0]), xp[n - 1]); return xp.map(b => cov(xc, b)) })   // held constant past the ends
  return vals => {
    const mean = vals.reduce((s, v) => s + v, 0) / n
    const alpha = luSolve(lu, vals.map(v => v - mean))
    return G.map(g => { let s = mean; for (let j = 0; j < n; j++) s += g[j] * alpha[j]; return s })
  }
}
function luFactor(a: number[][]): { lu: number[][]; piv: number[] } {
  const n = a.length, lu = a.map(r => [...r]), piv = Array.from({ length: n }, (_, i) => i)
  for (let k = 0; k < n; k++) {
    let p = k
    for (let i = k + 1; i < n; i++) if (Math.abs(lu[i][k]) > Math.abs(lu[p][k])) p = i
    if (p !== k) { [lu[k], lu[p]] = [lu[p], lu[k]]; [piv[k], piv[p]] = [piv[p], piv[k]] }
    const d = lu[k][k] || 1e-12
    for (let i = k + 1; i < n; i++) {
      const f = lu[i][k] / d
      lu[i][k] = f
      for (let j = k + 1; j < n; j++) lu[i][j] -= f * lu[k][j]
    }
  }
  return { lu, piv }
}
function luSolve({ lu, piv }: { lu: number[][]; piv: number[] }, b: number[]): number[] {
  const n = lu.length, y = piv.map(i => b[i])
  for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) y[i] -= lu[i][j] * y[j]
  for (let i = n - 1; i >= 0; i--) { for (let j = i + 1; j < n; j++) y[i] -= lu[i][j] * y[j]; y[i] /= lu[i][i] || 1e-12 }
  return y
}

// Segment index and position of each grid x along the stations, computed once.
function segments(xp: number[], xs: number[]): { k: number; t: number; h: number }[] {
  return xs.map(x => {
    if (x <= xp[0]) return { k: 0, t: 0, h: 1 }
    if (x >= xp[xp.length - 1]) return { k: xp.length - 2, t: 1, h: 1 }
    let k = 0
    while (k < xp.length - 2 && xp[k + 1] < x) k++
    const h = Math.max(xp[k + 1] - xp[k], 1e-9)
    return { k, t: (x - xp[k]) / h, h }
  })
}

export function buildSection(stations: SectionStation[], opts: SectionOptions): SectionResult | null {
  if (stations.length < 2) return null
  const profs = stations.map(s => profile(s.cast, opts.shorts))
  if (profs.some(p => !p || !p.z.length)) return null
  const route = routeDistances(stations)
  const { dist, waypointPts } = route
  const last = stations.length - 1
  const dmin = opts.depthMin ?? null, dmax = opts.depthMax ?? null
  const notes: string[] = [], warnings: string[] = []

  // the first station's units rule; a station in the other oxygen unit is converted, anything else is reported
  const units = profs[0]!.units
  const converted: string[] = []
  profs.forEach((p, i) => {
    const f = unitFactor(p!.units, units)
    if (f === null || f === 1) return
    p!.v = p!.v.map(v => v * f); converted.push(`${stations[i].label} (${prettyUnits(p!.units, false)})`); p!.units = units
  })
  if (converted.length) notes.push(`converted to ${prettyUnits(units, false)}: ${converted.join(', ')}`)
  const um = unitMismatch(profs.map((p, i) => ({ name: stations[i].label, units: p!.units })), opts.variable)
  if (um) warnings.push(um)
  const pressure = profs.filter(p => p!.depthLabel.startsWith('Pressure')).length
  if (pressure && pressure < profs.length) warnings.push(`pressure (db) stands in for depth at ${stations.filter((_, i) => profs[i]!.depthLabel.startsWith('Pressure')).map(s => s.label).join(', ')}`)

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

  // Seafloor from what the survey knows: the casts' deepest readings and the
  // depths given to waypoints.
  const own: [number, number][] = dist.map((x, i) => [x, bottoms[i]])
  let used = 0
  for (const p of waypointPts) { own.push(p); used++ }

  // Surveyed bathymetry along the route replaces the straight joins. A cast
  // or point that is deeper than the grid says stays: the grid cell may be
  // wide and the instrument was there. Land samples come up to the surface
  // and are reported so a waypoint can steer the line back into the water.
  let floorPts: [number, number][]
  const all = opts.seafloor ?? null
  const valid = (all ?? []).filter(s => s.elevation !== null) as { x: number; elevation: number }[]
  if (all && valid.length >= 2) {
    const name = opts.seafloorName ?? 'bathymetry'
    const bathy: [number, number][] = valid.map(s => [s.x, Math.max(0, -s.elevation)])
    const bx = bathy.map(p => p[0]), bz = bathy.map(p => p[1])
    // a place counts as surveyed when a sample with data lies within a couple of sample spacings
    const steps = all.slice(1).map((s, i) => s.x - all[i].x).filter(v => v > 0).sort((a, b) => a - b)
    const near = steps.length ? 2.5 * steps[Math.floor(steps.length / 2)] : Infinity
    const covered = (x: number) => {
      let lo = 0, hi = bx.length - 1
      while (lo < hi) { const mid = (lo + hi) >> 1; if (bx[mid] < x) lo = mid + 1; else hi = mid }
      return Math.abs(bx[lo] - x) <= near || (lo > 0 && Math.abs(bx[lo - 1] - x) <= near)
    }
    // where the survey has no data the casts and waypoint depths stand in; where it has, only a deeper one is kept
    const inGaps = own.filter(([x]) => !covered(x))
    const deeper = own.filter(([x, z]) => covered(x) && z > interp1(bx, bz, x) + 0.5)
    floorPts = [...bathy, ...inGaps, ...deeper]
    const span = ([a, b]: [number, number]) => (b - a < 0.05 ? `${a.toFixed(2)}` : `${a.toFixed(2)} to ${b.toFixed(2)}`)
    const runs = (pick: (s: { x: number; elevation: number | null }) => boolean) => {
      const out: [number, number][] = []
      for (const s of all) {
        if (!pick(s)) continue
        const run = out[out.length - 1]
        if (run && s.x - run[1] <= near) run[1] = s.x; else out.push([s.x, s.x])
      }
      return out
    }
    notes.push(`seafloor from ${name} (${valid.length} samples)${deeper.length ? `; ${deeper.length} cast bottom${deeper.length === 1 ? '' : 's'} or point${deeper.length === 1 ? '' : 's'} deeper than the grid kept` : ''}`)
    const gaps = runs(s => s.elevation === null)
    if (gaps.length) notes.push(`${name} has no data at ${gaps.map(span).join(', ')} km, so the seafloor there comes from the casts and waypoint depths`)
    const land = runs(s => s.elevation !== null && s.elevation >= 0)
    if (land.length) warnings.push(`${name} shows land at ${land.map(span).join(', ')} km along the line, drawn up to the surface; drag a waypoint to keep the line in the water`)
    used = 0
  } else {
    if (all) notes.push(`${opts.seafloorName ?? 'bathymetry'}: no data along this line, so the seafloor comes from the casts and waypoint depths`)
    floorPts = own
  }
  floorPts.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  floorPts = floorPts.filter((p, i) => i === 0 || p[0] - floorPts[i - 1][0] > 1e-9)   // one depth per distance, the deeper
  const deepestFloor = Math.max(...floorPts.map(p => p[1]))
  const { xMin, xMax } = route
  if (xMin < dist[0]) notes.push(`extended ${(dist[0] - xMin).toFixed(2)} km before ${stations[0].label}, colors there repeat that station`)
  if (xMax > dist[last]) notes.push(`extended ${(xMax - dist[last]).toFixed(2)} km beyond ${stations[last].label}, colors there repeat that station`)

  const top = dmin ?? 0            // the axis starts at the surface; each cast's top value is held up to it
  const bot = dmax ?? Math.max(Math.max(...bottoms), deepestFloor)
  const [nx, ny] = opts.grid ?? [240, 200]
  const xs = Array.from({ length: nx }, (_, i) => xMin + (xMax - xMin) * i / (nx - 1))
  const surface = Math.max(0, top)
  const ys = Array.from({ length: ny }, (_, j) => surface + (bot - surface) * j / (ny - 1))

  const columns = windowed.map(w => resample(w.z, w.v, ys))
  // horizontal pass at every depth, held constant past the end stations
  // when the section is extended
  const method = opts.interpolation ?? 'smooth'
  const smooth = method === 'smooth' && stations.length > 2
  const spacing = Math.max((dist[last] - dist[0]) / last, 0.01)          // mean spacing between neighbouring stations
  const scale = opts.oaScale && opts.oaScale > 0 ? opts.oaScale : 2 * spacing
  const oa = method === 'oa' ? gaussMarkov(dist, xs, scale, 1e-4) : null
  if (oa) notes.push(`objective analysis, Markov covariance, scale ${scale >= 1 ? `${scale.toFixed(1)} km` : `${Math.round(scale * 1000)} m`}${opts.oaScale && opts.oaScale > 0 ? '' : ' (twice the mean station spacing)'}`)
  const segs = segments(dist, xs)
  const z: number[][] = []
  for (let j = 0; j < ny; j++) {
    const vals = columns.map(c => c[j])
    let row = new Array<number>(nx)
    if (oa) row = oa(vals)
    else if (smooth) {
      const d = pchipSlopes(dist, vals)
      for (let i = 0; i < nx; i++) {
        const { k, t, h } = segs[i]
        const t2 = t * t, t3 = t2 * t
        row[i] = (2 * t3 - 3 * t2 + 1) * vals[k] + (t3 - 2 * t2 + t) * h * d[k] + (-2 * t3 + 3 * t2) * vals[k + 1] + (t3 - t2) * h * d[k + 1]
      }
    } else {
      for (let i = 0; i < nx; i++) row[i] = interp1(dist, vals, xs[i])
    }
    z.push(row)
  }
  // the polygon passes through every seafloor point exactly and stays inside the window
  const fx = floorPts.map(p => p[0]), fz = floorPts.map(p => p[1])
  const floorAt = (x: number) => Math.min(Math.max(interp1(fx, fz, x), surface), bot)
  const px = [...new Set([...xs, ...fx])].sort((a, b) => a - b)
  const floor = px.map(floorAt)

  // Below the seafloor the field is blanked and hover on the blank is off, so
  // hovering over the black polygon shows nothing. Each column takes the
  // deepest polygon vertex within a cell of it, so a vertex that falls
  // between columns never leaves a sliver of background above the black;
  // the blank starts a cell and a half under that.
  const dy = (bot - surface) / (ny - 1), dx = nx > 1 ? (xMax - xMin) / (nx - 1) : 0
  const floorAtX = xs.map(x => {
    let m = floorAt(x)
    for (const [vx, vz] of floorPts) { if (vx < x - dx) continue; if (vx > x + dx) break; m = Math.max(m, Math.min(Math.max(vz, surface), bot)) }
    return m
  })
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (ys[j] > floorAtX[i] + 1.5 * dy) z[j][i] = NaN

  // an automatic colour range reads only what is drawn: between the stations, above the seafloor
  const def = defaultScale(opts.variable, units)
  const colorscale = opts.colorscale ?? def.colorscale
  let range: [number, number] | null = null
  if (opts.range === 'auto' || (!opts.range && !def.range)) {
    const shown: number[] = []
    for (let i = 0; i < nx; i++) if (xs[i] >= dist[0] - 1e-9 && xs[i] <= dist[last] + 1e-9) for (let j = 0; j < ny; j++) shown.push(z[j][i])
    range = percentileRange(shown.length ? shown : z.flat())
  }
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
  const axisBottom = bot + span * 0.02
  const unitText = prettyUnits(units)
  const cbTitle = opts.colorbarName ? labelWithUnits(opts.variable, units) : (unitText || opts.variable)

  const data: Partial<PlotData>[] = [{
    type: 'contour', x: xs, y: ys, z, colorscale, zmin: range[0], zmax: range[1], zauto: false,
    contours, line: { width: 0.5, color: 'rgba(0,0,0,0.35)' }, connectgaps: false, hoverongaps: false,
    colorbar: { title: { text: cbTitle, side: 'right' }, thickness: 14, len: 0.9, outlinewidth: 0, tick0: range[0], dtick: tick, tickformat: '.2f' },
    hovertemplate: `%{x:.2f} km<br>%{y:.1f} m<br>${opts.variable}: %{z:.3f} ${unitText}<extra></extra>`,
  } as Partial<PlotData>, {
    type: 'scatter', mode: 'lines', name: 'seafloor', fill: 'toself', fillcolor: '#000000',
    x: [...px, px[px.length - 1], px[0]], y: [...floor, axisBottom, axisBottom],
    line: { width: 0, color: '#000000' }, hoverinfo: 'skip', showlegend: false,
  }]
  // Station markers and labels sit in the margin above the plot as
  // annotations (a scatter trace outside its axis range is culled, even with
  // clipping off), so the depth axis itself stops at the surface.
  const annotations = stations.flatMap((s, i) => [
    { x: dist[i], xref: 'x', y: 1, yref: 'paper', yanchor: 'bottom', yshift: 0, text: '▼', font: { size: 15, color: s.color }, showarrow: false },
    { x: dist[i], xref: 'x', y: 1, yref: 'paper', yanchor: 'bottom', yshift: 18, text: s.label, font: { size: 11 }, showarrow: false },
  ]) as unknown as Layout['annotations']

  const axis = { showgrid: false, zeroline: false, showline: true, linecolor: '#888', ticks: 'outside' as const, ticklen: 4, tickcolor: '#888', tickfont: { size: 10 }, fixedrange: true }
  const layout: Partial<Layout> = {
    xaxis: { title: { text: 'Distance along transect (km)', standoff: 8 }, range: [xMin, xMax], ...axis },
    yaxis: { title: { text: profs[0]!.depthLabel, standoff: 8 }, range: [axisBottom, surface], tickvals: niceTicks(surface, bot), ...axis },
    annotations,
    // the plot area is seafloor wherever it is not field, so it is black: any
    // hairline between the two reads as seafloor instead of a white sliver
    plot_bgcolor: '#000000',
    margin: { l: 64, r: 24, t: 64, b: 56 }, showlegend: false,
    dragmode: false, hovermode: 'closest',
    modebar: { remove: ['zoom2d', 'pan2d', 'select2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'] },
  }
  if (used) notes.unshift(`${used} waypoint depth${used === 1 ? '' : 's'} on the seafloor`)
  return { data, layout, distances: dist, units, notes, warnings, used, autoTitle: `${opts.variable} section` }
}
