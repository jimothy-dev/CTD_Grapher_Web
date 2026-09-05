// Profile figures: one variable against depth (or another variable), all
// active stations overlaid.
import type { PlotData, Layout } from 'plotly.js'
import { findColumn, depthColumn, unitMismatch, type Cast } from './cnv'
import { labelWithUnits, prettyUnits, unitFactor } from './units'
import type { LegendPos, YLabelMode } from '../store'

export interface ProfileStation { id: string; name: string; color: string; cast: Cast }
export interface YChoice { name: string; shorts: string[]; label?: string }          // name 'Depth' means the depth channel
export interface ProfileOptions {
  variable: string
  label?: string        // what to call it on the graph; defaults to the variable name
  shorts: string[]
  y: YChoice
  depthMin: number | null
  depthMax: number | null
  lineShape: 'spline' | 'linear'
  legendPos: LegendPos
  yInvert: boolean
  yLabelMode: YLabelMode
  showGrid: boolean
}
export interface ProfileResult {
  variable: string
  data: Partial<PlotData>[]
  layout: Partial<Layout>
  missing: string[]
  warnings: string[]    // units that differ between stations, pressure standing in for depth
  autoTitle: string
}

export function buildProfile(stations: ProfileStation[], o: ProfileOptions): ProfileResult | null {
  const data: Partial<PlotData>[] = []
  const missing: string[] = []
  const xUnitsBy: { name: string; units: string }[] = [], yUnitsBy: { name: string; units: string }[] = []
  const pressureFor: string[] = [], convertedX: string[] = [], convertedY: string[] = []
  const xName = o.label ?? o.variable
  let xUnits = '', yUnits = '', yLabelBase = o.y.label ?? o.y.name, deepestSeen = 0
  const yIsDepth = o.y.name === 'Depth'
  for (const s of stations) {
    const xcol = findColumn(s.cast, o.shorts)
    const dep = depthColumn(s.cast)
    const ycol = yIsDepth ? dep?.col ?? null : findColumn(s.cast, o.y.shorts)
    if (!xcol || !ycol || !dep) { missing.push(s.name); continue }
    if (yIsDepth && !yUnits) yLabelBase = dep.label.replace(/\s*\(.*\)$/, '')     // the first station names the axis: Depth, or Pressure standing in
    if (yIsDepth && dep.label.startsWith('Pressure')) pressureFor.push(s.name)
    xUnits = xUnits || xcol.units
    yUnits = yUnits || (yIsDepth ? dep.label.match(/\((.*)\)/)?.[1] ?? 'm' : ycol.units)
    // the first station's units rule; a station in the other oxygen unit is converted, anything else is reported
    const fx = unitFactor(xcol.units, xUnits) ?? 1, fy = yIsDepth ? 1 : unitFactor(ycol.units, yUnits) ?? 1
    if (fx !== 1) convertedX.push(`${s.name} (${prettyUnits(xcol.units, false)})`)
    if (fy !== 1) convertedY.push(`${s.name} (${prettyUnits(ycol.units, false)})`)
    xUnitsBy.push({ name: s.name, units: unitFactor(xcol.units, xUnits) === null ? xcol.units : xUnits })
    if (!yIsDepth) yUnitsBy.push({ name: s.name, units: unitFactor(ycol.units, yUnits) === null ? ycol.units : yUnits })
    const xs = s.cast.data[xcol.index], ys = s.cast.data[ycol.index], zs = s.cast.data[dep.col.index]
    const pts: [number, number, number][] = []
    for (let i = 0; i < xs.length; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i]) || !Number.isFinite(zs[i])) continue
      if (o.depthMin !== null && zs[i] < o.depthMin) continue
      if (o.depthMax !== null && zs[i] > o.depthMax) continue
      pts.push([xs[i] * fx, ys[i] * fy, zs[i]])
    }
    if (!pts.length) { missing.push(s.name); continue }
    if (yIsDepth) pts.sort((a, b) => a[1] - b[1])
    deepestSeen = Math.max(deepestSeen, ...pts.map(p => p[2]))
    data.push({
      type: 'scatter', mode: 'lines', name: s.name, x: pts.map(p => p[0]), y: pts.map(p => p[1]),
      line: { color: s.color, width: 2, shape: o.lineShape, smoothing: 0.6 },
      hovertemplate: `<b>${s.name}</b><br>${xName}: %{x:.3f}<br>${yLabelBase}: %{y:.2f}<extra></extra>`,
    } as Partial<PlotData>)
  }
  if (!data.length) return null

  const warnings: string[] = []
  if (convertedX.length) warnings.push(`converted to ${prettyUnits(xUnits, false)}: ${convertedX.join(', ')}`)
  if (convertedY.length) warnings.push(`converted to ${prettyUnits(yUnits, false)}: ${convertedY.join(', ')}`)
  const xm = unitMismatch(xUnitsBy, xName); if (xm) warnings.push(xm)
  const ym = unitMismatch(yUnitsBy, yLabelBase); if (ym) warnings.push(ym)
  if (pressureFor.length && pressureFor.length < data.length) warnings.push(`pressure (db) stands in for depth at ${pressureFor.join(', ')}`)

  const xLabel = labelWithUnits(xName, xUnits)
  const yLabel = labelWithUnits(yLabelBase, yUnits)
  const invert = o.yInvert
  const xTop = invert    // read from the top when depth increases downward
  const margin = { l: o.legendPos === 'left' ? 170 : 64, r: o.legendPos === 'right' ? 20 : 20, t: xTop ? 80 : 40, b: xTop ? (o.legendPos === 'bottom' ? 80 : 40) : (o.legendPos === 'bottom' ? 110 : 70) }
  if (o.yLabelMode === 'top') margin.t += 18

  const yaxis: Partial<Layout['yaxis']> = {
    title: o.yLabelMode === 'side' ? { text: yLabel, standoff: 8 } : { text: '' },
    autorange: invert ? 'reversed' : true, zeroline: false, ticks: 'outside', ticklen: 4, showline: true, linecolor: '#888', tickcolor: '#888',
    showgrid: o.showGrid,
  }
  // Depth stays anchored to the window so 0 m is visible and comparable.
  if (yIsDepth) {
    const top = o.depthMin ?? 0, bot = o.depthMax ?? deepestSeen * 1.02
    yaxis.range = invert ? [bot, top] : [top, bot]
    yaxis.autorange = false
  }
  const legend: Partial<Layout['legend']> = o.legendPos === 'bottom'
    ? { orientation: 'h', y: xTop ? -0.08 : -0.22, x: 0, xanchor: 'left', yanchor: 'top' }
    : o.legendPos === 'left'
      ? { orientation: 'v', x: -0.2, xanchor: 'right', y: 1, yanchor: 'top' }
      : { orientation: 'v', x: 1.02, xanchor: 'left', y: 1, yanchor: 'top' }
  const layout: Partial<Layout> = {
    xaxis: { title: { text: xLabel, standoff: 8 }, side: xTop ? 'top' : 'bottom', zeroline: false, ticks: 'outside', ticklen: 4, showline: true, linecolor: '#888', tickcolor: '#888', showgrid: o.showGrid },
    yaxis, legend, margin, hovermode: 'closest', showlegend: true,
    annotations: o.yLabelMode === 'top'
      ? [{ text: yLabel, xref: 'paper', yref: 'paper', x: 0, y: 1, xanchor: 'right', yanchor: 'bottom', xshift: -6, yshift: xTop ? 30 : 6, showarrow: false, font: { size: 12 } }]
      : [],
  }
  return { variable: o.variable, data, layout, missing, warnings, autoTitle: `${yLabelBase} vs ${xName}` }
}
