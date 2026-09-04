import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import type { PlotData, Layout } from 'plotly.js'
import { useStore, type Mid } from '../store'
import { availableVariables } from '../lib/cnv'
import { buildSection, type SectionStation } from '../lib/section'
import { parseClr } from '../lib/colors'
import { alongTrack } from '../lib/geo'
import Plot from '../components/Plot'

const num = (s: string): number | null => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }

function mapFigure(stations: { name: string; color: string; lat: number; lon: number }[], lineOrder: { lat: number; lon: number }[]): { data: Partial<PlotData>[]; layout: Partial<Layout> } {
  const lats = stations.map(s => s.lat), lons = stations.map(s => s.lon)
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length
  const midLon = lons.reduce((a, b) => a + b, 0) / lons.length
  const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lons) - Math.min(...lons)) * Math.cos(midLat * Math.PI / 180))
  const zoom = [[0.02, 12], [0.05, 11], [0.2, 10], [0.5, 9], [1, 8], [5, 6], [20, 4], [60, 3], [1e9, 1]].find(([lim]) => span < lim)![1]
  const data: Partial<PlotData>[] = []
  if (lineOrder.length > 1) data.push({ type: 'scattermap', mode: 'lines', lat: lineOrder.map(p => p.lat), lon: lineOrder.map(p => p.lon), line: { width: 2, color: '#555' }, hoverinfo: 'skip', showlegend: false, name: 'transect' } as unknown as Partial<PlotData>)
  for (const s of stations) data.push({
    type: 'scattermap', mode: 'markers+text', lat: [s.lat], lon: [s.lon], name: s.name,
    marker: { size: 13, color: s.color }, text: [s.name], textposition: 'top right', textfont: { size: 12 },
    hovertemplate: `<b>${s.name}</b><br>%{lat:.4f}, %{lon:.4f}<extra></extra>`,
  } as unknown as Partial<PlotData>)
  const layout = {
    margin: { l: 0, r: 0, t: 0, b: 0 }, legend: { title: { text: 'Station' } },
    map: { style: 'open-street-map', center: { lat: midLat, lon: midLon }, zoom },
  } as unknown as Partial<Layout>
  return { data, layout }
}

export default function Transect() {
  const stations = useStore(s => s.stations)
  const transect = useStore(s => s.transect)
  const settings = useStore(s => s.settings)
  const { setTransect, moveInOrder, setSettings } = useStore()
  const byId = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s])), [stations])
  const active = useMemo(() => stations.filter(s => s.active), [stations])
  const variables = useMemo(() => availableVariables(active.map(s => s.cast)), [active])
  const dragFrom = useRef<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  const orderIds = transect.order.filter(id => byId[id])
  const chosen: SectionStation[] = orderIds
    .filter(id => transect.on[id] && byId[id].lat !== null && byId[id].lon !== null)
    .map(id => {
      const s = byId[id]
      return {
        id, label: transect.labels[id]?.trim() || s.name, color: s.color, lat: s.lat!, lon: s.lon!, cast: s.cast,
        mids: (transect.mids[id] ?? []).filter(m => m.d !== null && m.z !== null).map(m => ({ d: m.d!, z: m.z!, to: m.to })),
      }
    })
  const live = (id: string) => (transect.on[id] ?? true) && byId[id].lat !== null && byId[id].lon !== null
  const nextLive = (i: number) => orderIds.slice(i + 1).find(live) ?? null
  const nameOf = (id: string | null) => (id && byId[id] ? (transect.labels[id]?.trim() || byId[id].name) : 'the next station')
  const unplaced = orderIds.filter(id => transect.on[id] && (byId[id].lat === null || byId[id].lon === null)).map(id => byId[id].name)

  let dmin = num(settings.depthMin), dmax = num(settings.depthMax)
  if (dmin !== null && dmax !== null && dmin > dmax) [dmin, dmax] = [dmax, dmin]
  const isOn = (name: string) => settings.sectionVariables[name] ?? false

  const sections = useMemo(() => variables.filter(v => isOn(v.name)).map(v => ({
    variable: v.name,
    result: buildSection(chosen, {
      variable: v.name, shorts: v.shorts, depthMin: dmin, depthMax: dmax, nContours: settings.contourSteps,
      colorscale: settings.useClr && settings.clr ? settings.clr.stops : null,
      range: settings.rangeMode === 'auto' ? 'auto' : null,
    }),
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [transect, stations, variables, settings, dmin, dmax])

  const placed = active.filter(s => s.lat !== null && s.lon !== null)
  const map = useMemo(() => placed.length ? mapFigure(placed.map(s => ({ name: s.name, color: s.color, lat: s.lat!, lon: s.lon! })), chosen.map(s => ({ lat: s.lat, lon: s.lon }))) : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [stations, transect])
  const distances = chosen.length > 1 ? alongTrack(chosen) : []

  const onClr = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    try { setSettings({ clr: parseClr(await f.text()), clrName: f.name, useClr: true }) }
    catch (err) { alert((err as Error).message) }
    e.target.value = ''
  }
  const setMid = (id: string, j: number, key: 'd' | 'z', value: string) => {
    const mids: Mid[] = (transect.mids[id] ?? []).map(m => ({ ...m }))
    mids[j][key] = num(value)
    setTransect({ mids: { ...transect.mids, [id]: mids } })
  }

  if (active.length < 2) return <div className="empty">A transect needs at least two active stations. <Link to="/">Add or switch some on.</Link></div>

  return (
    <div className="grid-2">
      <div className="stack">
        <div>
          <h1>Transect</h1>
          <p className="muted small">Drag stations into the order they lie along the line. Untick any not on it.</p>
        </div>
        <div className="card">
          <h2>Stations on the line</h2>
          <div className="order">
            {orderIds.map((id, i) => {
              const s = byId[id]
              const placedHere = s.lat !== null && s.lon !== null
              const mids = transect.mids[id] ?? []
              const canAdd = live(id) && nextLive(i) !== null
              return (
                <div key={id} draggable className={'item' + (transect.on[id] ? '' : ' off') + (dragging === i ? ' dragging' : '') + (overIdx === i ? ' over' : '')}
                  onDragStart={e => { dragFrom.current = i; setDragging(i); e.dataTransfer.effectAllowed = 'move' }}
                  onDragEnd={() => { dragFrom.current = null; setDragging(null); setOverIdx(null) }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverIdx(i) }}
                  onDragLeave={() => setOverIdx(null)}
                  onDrop={e => { e.preventDefault(); const from = dragFrom.current; setOverIdx(null); if (from !== null && from !== i) moveInOrder(from, i) }}>
                  <div className="line">
                    <span className="grip" aria-hidden="true">⋮</span>
                    <span className="n">{i + 1}</span>
                    <input type="checkbox" checked={transect.on[id] ?? true} onChange={e => setTransect({ on: { ...transect.on, [id]: e.target.checked } })} aria-label={`${s.name} on the transect`} />
                    <span className="dot" style={{ background: s.color }} />
                    <input className="inline name" value={transect.labels[id] ?? ''} placeholder={s.name} title="Label shown above this station on the section"
                      onChange={e => setTransect({ labels: { ...transect.labels, [id]: e.target.value } })} />
                  </div>
                  <div className="sub">
                    {placedHere
                      ? <span className="pos">{s.lat!.toFixed(4)}, {s.lon!.toFixed(4)}</span>
                      : <span className="pos missing"><Link to="/">no position, add it on Stations</Link></span>}
                    {canAdd && <button className="add" title="A depth in metres known between this station and the next, read off a chart. Shapes the seafloor; the colour between stations stretches down to meet it."
                      onClick={() => setTransect({ mids: { ...transect.mids, [id]: [...mids, { d: null, z: null, to: nextLive(i) }] } })}>+ seafloor point</button>}
                  </div>
                  {mids.length > 0 && (
                    <div className="mids">
                      {mids.map((m, j) => (
                        <div key={j} className="mid">
                          <span className="to">↳ towards {nameOf(m.to)}</span>
                          <span className="vals">
                            <input type="number" step="0.01" min="0" placeholder="km" value={m.d ?? ''} onChange={e => setMid(id, j, 'd', e.target.value)} aria-label="km from this station" /> km,
                            <input type="number" step="0.1" min="0" placeholder="m" value={m.z ?? ''} onChange={e => setMid(id, j, 'z', e.target.value)} aria-label="depth in metres" /> m deep
                            <button className="x" title="remove" onClick={() => setTransect({ mids: { ...transect.mids, [id]: mids.filter((_, k) => k !== j) } })}>×</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {unplaced.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Left off until positioned: {unplaced.join(', ')}.</p>}
          {distances.length > 1 && <p className="small muted mono" style={{ marginTop: 8 }}>{distances[distances.length - 1].toFixed(2)} km end to end</p>}
        </div>

        <div className="card">
          <h2>Sections</h2>
          <div className="row" style={{ marginBottom: 10 }}>
            {variables.map(v => (
              <label key={v.name} className={'chip' + (isOn(v.name) ? ' on' : '')}>
                <input type="checkbox" checked={isOn(v.name)} onChange={e => setSettings({ sectionVariables: { ...settings.sectionVariables, [v.name]: e.target.checked } })} />
                {v.name}
              </label>
            ))}
          </div>
          <div className="row">
            <label className="field">from, m<input type="number" value={settings.depthMin} placeholder="surface" style={{ width: 88 }} onChange={e => setSettings({ depthMin: e.target.value })} /></label>
            <label className="field">to, m<input type="number" value={settings.depthMax} placeholder="bottom" style={{ width: 88 }} onChange={e => setSettings({ depthMax: e.target.value })} /></label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>contour steps: {settings.contourSteps || 'smooth'}
              <input type="range" min={0} max={24} value={settings.contourSteps} onChange={e => setSettings({ contourSteps: +e.target.value })} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="field">colour range
              <span className="seg">
                <button className={settings.rangeMode === 'fixed' ? 'on' : ''} onClick={() => setSettings({ rangeMode: 'fixed' })} title="Same colour for the same value on every section">fixed</button>
                <button className={settings.rangeMode === 'auto' ? 'on' : ''} onClick={() => setSettings({ rangeMode: 'auto' })} title="Stretched to this survey">this survey</button>
              </span>
            </label>
            <label className="field">colours
              <span className="row">
                <label className="btn tiny">Surfer .clr<input type="file" accept=".clr,.txt" onChange={onClr} style={{ display: 'none' }} /></label>
                {settings.clr && <label className={'chip' + (settings.useClr ? ' on' : '')}><input type="checkbox" checked={settings.useClr} onChange={e => setSettings({ useClr: e.target.checked })} />{settings.clrName}</label>}
              </span>
            </label>
            <label className="field">map<input type="checkbox" className="switch" checked={settings.showMap} onChange={e => setSettings({ showMap: e.target.checked })} /></label>
          </div>
          {settings.clr && settings.clr.warnings.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>{settings.clr.warnings.join('; ')}</p>}
        </div>
      </div>

      <div className="stack">
        {settings.showMap && map && (
          <div className="plot-card"><Plot data={map.data} layout={map.layout} filename="station_map" height={420} /></div>
        )}
        {chosen.length < 2 && <div className="empty">Tick at least two positioned stations to draw a section.</div>}
        {chosen.length >= 2 && sections.length === 0 && <div className="empty">Tick a variable to draw its section.</div>}
        {sections.map(({ variable, result }) => result ? (
          <div key={variable} className="plot-card">
            <Plot data={result.data} layout={result.layout} filename={`${variable.replace(/\W+/g, '_')}_section`} height={520} />
            {(result.used > 0 || result.skipped.length > 0) && <div className="note">{[result.used ? `${result.used} seafloor point${result.used === 1 ? '' : 's'} used` : '', ...result.skipped].filter(Boolean).join(' · ')}</div>}
          </div>
        ) : <div key={variable} className="note muted small">{variable}: not in every chosen station.</div>)}
        <p className="muted small">Everything between the station markers is interpolated. The black seafloor joins each cast's deepest reading and any seafloor points you add; it is not surveyed bathymetry.</p>
      </div>
    </div>
  )
}
