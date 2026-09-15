// One station's cast: every chosen variable against depth on the same
// picture, each on its own x scale, the way SeaPlot and Ocean Data View draw
// a station. The x axes stack above and below the plot area, in the colour
// of their curve, so temperature can run 8 to 14 while salinity runs 26 to 30
// and both fill the width.
import type { PlotData, Layout, LayoutAxis } from 'plotly.js'
import { findColumn, depthColumn, type Cast } from './cnv'
import { labelWithUnits, prettyUnits } from './units'
import { niceStep } from './colors'

export interface CastVariable { name: string; shorts: string[]; label: string }
export interface CastPlotOptions {
  variables: CastVariable[]
  depthMin: number | null
  depthMax: number | null
  lineShape: 'spline' | 'linear'
  showGrid: boolean
}
export interface CastPlotResult { data: Partial<PlotData>[]; layout: Partial<Layout>; missing: string[]; height: number }

// a colour per variable, fixed so the same variable looks the same on every cast
export const VARIABLE_COLORS: Record<string, string> = {
  'Temperature': '#d62728', 'Salinity': '#1f77b4', 'Density (sigma-t)': '#2ca02c', 'Dissolved Oxygen': '#9467bd',
  'Fluorescence': '#17a06a', 'Beam Transmission': '#7f7f7f', 'Turbidity': '#8c564b', 'pH': '#ff7f0e', 'PAR': '#bcbd22', 'CDOM': '#e377c2',
}
const SPARE = ['#e377c2', '#bcbd22', '#17becf', '#ff9896', '#c5b0d5']

export function buildCastPlot(cast: Cast, o: CastPlotOptions): CastPlotResult | null {
  const dep = depthColumn(cast)
  if (!dep) return null
  const z = cast.data[dep.col.index]
  const data: Partial<PlotData>[] = []
  const axes: { label: string; color: string; range: [number, number]; tickvals: number[]; ticktext: string[] }[] = []
  const missing: string[] = []
  let deepest = 0
  o.variables.forEach((v, k) => {
    const col = findColumn(cast, v.shorts)
    if (!col) { missing.push(v.label); return }
    const x = cast.data[col.index]
    const pts: [number, number][] = []
    for (let i = 0; i < x.length; i++) {
      if (!Number.isFinite(x[i]) || !Number.isFinite(z[i])) continue
      if (o.depthMin !== null && z[i] < o.depthMin) continue
      if (o.depthMax !== null && z[i] > o.depthMax) continue
      pts.push([x[i], z[i]])
    }
    if (!pts.length) { missing.push(v.label); return }
    pts.sort((a, b) => a[1] - b[1])
    deepest = Math.max(deepest, pts[pts.length - 1][1])
    const color = VARIABLE_COLORS[v.name] ?? SPARE[k % SPARE.length]
    const n = axes.length
    // round tick steps and a range that ends on them, so every scale reads
    // like a ruler (an overlaid axis left to itself ticks at odd values)
    let lo = Infinity, hi = -Infinity
    for (const p of pts) { if (p[0] < lo) lo = p[0]; if (p[0] > hi) hi = p[0] }
    if (!(hi > lo)) hi = lo + 1
    const step = niceStep(hi - lo, 6)
    const r0 = Math.floor(lo / step) * step, r1 = Math.ceil(hi / step) * step
    const decimals = (step.toFixed(6).replace(/0+$/, '').split('.')[1] ?? '').length     // as many as the step needs: 0.25 shows 6.25, not 6.3
    const tickvals: number[] = []
    for (let t = r0; t <= r1 + step * 1e-6; t += step) tickvals.push(+t.toFixed(decimals + 2))
    axes.push({ label: labelWithUnits(v.label, col.units), color, range: [r0, r1], tickvals, ticktext: tickvals.map(t => t.toFixed(decimals)) })
    data.push({
      type: 'scatter', mode: 'lines', name: v.label, x: pts.map(p => p[0]), y: pts.map(p => p[1]),
      xaxis: n === 0 ? 'x' : `x${n + 1}`, line: { color, width: 2, shape: o.lineShape, smoothing: 0.6 },
      hovertemplate: `%{x:.3f} ${prettyUnits(col.units)}<extra>${v.label}</extra>`,
    } as Partial<PlotData>)
  })
  if (!data.length) return null

  // axes alternate: first above the plot, second below, third above, and so
  // on, each in its own band so no two overlap
  const nTop = Math.ceil(axes.length / 2), nBottom = Math.floor(axes.length / 2)
  const height = 560 + 34 * Math.max(0, axes.length - 2)
  const band = 52 / (height - 60 - 60)         // one axis band as a fraction of the plot height
  const top = 1 - band * Math.max(0, nTop - 1), bottom = band * Math.max(0, nBottom - 1)
  const layout: Partial<Layout> & Record<string, unknown> = {
    yaxis: {
      title: { text: dep.label, standoff: 6 }, domain: [bottom, top],
      range: [o.depthMax ?? deepest * 1.02, o.depthMin ?? 0], zeroline: false, showgrid: o.showGrid,
      ticks: 'outside', ticklen: 4, showline: true, linecolor: '#888', tickcolor: '#888',
    },
    margin: { l: 64, r: 24, t: 60, b: 60 }, showlegend: false, hovermode: 'y unified',
  }
  axes.forEach((a, i) => {
    const onTop = i % 2 === 0
    const slot = Math.floor(i / 2)
    const position = onTop ? top + band * slot : bottom - band * slot
    const ax: Partial<LayoutAxis> & Record<string, unknown> = {
      title: { text: a.label, font: { color: a.color, size: 12 }, standoff: 4 },
      side: onTop ? 'top' : 'bottom', anchor: 'free', position: Math.min(Math.max(position, 0), 1),
      range: a.range, tickvals: a.tickvals, ticktext: a.ticktext, fixedrange: true,
      showgrid: false, zeroline: false, showline: true, linecolor: a.color, tickcolor: a.color, tickfont: { color: a.color, size: 10 },
      ticks: 'outside', ticklen: 4, automargin: true,
    }
    if (i > 0) ax.overlaying = 'x'
    layout[i === 0 ? 'xaxis' : `xaxis${i + 1}`] = ax
  })
  return { data, layout, missing, height }
}
