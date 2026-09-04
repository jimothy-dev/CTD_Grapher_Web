// Depth profiles: one figure per variable, every active station overlaid,
// depth inverted on the Y axis.
import type { PlotData, Layout } from 'plotly.js'
import { profile, type Cast } from './cnv'

export interface ProfileStation { id: string; name: string; color: string; cast: Cast }

export interface ProfileFigure {
  variable: string
  units: string
  data: Partial<PlotData>[]
  layout: Partial<Layout>
  missing: string[]     // stations without this variable
}

export function buildProfile(stations: ProfileStation[], variable: string, shorts: string[], depthMin: number | null, depthMax: number | null, lineShape: 'spline' | 'linear' = 'spline'): ProfileFigure | null {
  const data: Partial<PlotData>[] = []
  const missing: string[] = []
  let units = '', depthLabel = 'Depth (m)'
  for (const s of stations) {
    const p = profile(s.cast, shorts)
    if (!p) { missing.push(s.name); continue }
    units = units || p.units
    depthLabel = p.depthLabel
    const z: number[] = [], v: number[] = []
    for (let i = 0; i < p.z.length; i++) {
      if (depthMin !== null && p.z[i] < depthMin) continue
      if (depthMax !== null && p.z[i] > depthMax) continue
      z.push(p.z[i]); v.push(p.v[i])
    }
    if (!z.length) { missing.push(s.name); continue }
    const unitShort = p.units.replace(/^ITS-90,\s*/, '').replace('deg C', '°C')
    data.push({
      type: 'scatter', mode: 'lines', x: v, y: z, name: s.name,
      line: { color: s.color, width: 2, shape: lineShape },
      hovertemplate: `<b>${s.name}</b><br>${variable}: %{x:.3f} ${unitShort}<br>%{y:.1f} m<extra></extra>`,
    })
  }
  if (!data.length) return null
  const unitShort = units.replace(/^ITS-90,\s*/, '').replace('deg C', '°C')
  const axis = { showgrid: true, gridcolor: 'rgba(128,128,128,0.18)', zeroline: false, showline: true, linecolor: '#888', ticks: 'outside' as const, ticklen: 4, tickcolor: '#888', tickfont: { size: 10 } }
  const yTop = depthMin ?? 0
  const layout: Partial<Layout> = {
    xaxis: { title: { text: unitShort ? `${variable} (${unitShort})` : variable, standoff: 8, font: { size: 14 } }, side: 'top', ...axis },
    yaxis: { title: { text: depthLabel, standoff: 6 }, autorange: 'reversed', ...axis, ...(depthMax !== null ? { range: [depthMax, yTop], autorange: false } : {}) },
    margin: { l: 56, r: 16, t: 64, b: 24 }, hovermode: 'closest',
    legend: { orientation: 'h', y: -0.06, x: 0, font: { size: 11 } },
  }
  return { variable, units, data, layout, missing }
}
