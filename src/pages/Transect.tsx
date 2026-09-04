import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import Plotly from 'plotly.js-dist-min'
import type { PlotData, Layout, PlotlyHTMLElement } from 'plotly.js'
import { useStore, BEFORE, AFTER, type Mid, type Waypoint } from '../store'
import { availableVariables } from '../lib/cnv'
import { buildSection, routeDistances, type SectionStation } from '../lib/section'
import { parsePalette, PALETTE_EXTENSIONS } from '../lib/palettes'
import { fractionAlong } from '../lib/geo'
import Plot from '../components/Plot'
import PlotCard from '../components/PlotCard'

const num = (s: string): number | null => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }
type LatLon = { lat: number; lon: number }

// Map traces: 0 the routed line, 1 the waypoints, then one per station. The
// first two keep their slots even when empty, so a drag can restyle them.
function mapFigure(stations: { name: string; color: string; lat: number; lon: number }[], line: LatLon[], waypoints: Waypoint[]): { data: Partial<PlotData>[]; layout: Partial<Layout> } {
  const lats = stations.map(s => s.lat), lons = stations.map(s => s.lon)
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length
  const midLon = lons.reduce((a, b) => a + b, 0) / lons.length
  const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lons) - Math.min(...lons)) * Math.cos(midLat * Math.PI / 180))
  const zoom = [[0.02, 12], [0.05, 11], [0.2, 10], [0.5, 9], [1, 8], [5, 6], [20, 4], [60, 3], [1e9, 1]].find(([lim]) => span < lim)![1]
  const data: Partial<PlotData>[] = [
    { type: 'scattermap', mode: 'lines', lat: line.map(p => p.lat), lon: line.map(p => p.lon), line: { width: 2, color: '#555' }, hoverinfo: 'skip', showlegend: false, name: 'transect' } as unknown as Partial<PlotData>,
    { type: 'scattermap', mode: 'markers', lat: waypoints.map(w => w.lat), lon: waypoints.map(w => w.lon), name: 'waypoints', showlegend: waypoints.length > 0,
      marker: { size: 9, color: '#fff', opacity: 0.95 }, hovertemplate: 'waypoint, drag to move<br>%{lat:.4f}, %{lon:.4f}<extra></extra>' } as unknown as Partial<PlotData>,
  ]
  for (const s of stations) data.push({
    type: 'scattermap', mode: 'markers', lat: [s.lat], lon: [s.lon], name: s.name,
    marker: { size: 13, color: s.color },
    hovertemplate: `<b>${s.name}</b><br>%{lat:.4f}, %{lon:.4f}<extra></extra>`,
  } as unknown as Partial<PlotData>)
  const layout = {
    margin: { l: 0, r: 0, t: 0, b: 0 }, legend: { title: { text: 'Station' } },
    map: { style: 'open-street-map', center: { lat: midLat, lon: midLon }, zoom },
  } as unknown as Partial<Layout>
  return { data, layout }
}

interface MapLike {
  project: (lnglat: [number, number]) => { x: number; y: number }
  dragPan: { enable: () => void; disable: () => void }
  getCanvas: () => HTMLCanvasElement
  on: (ev: string, fn: (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number }; preventDefault: () => void }) => void) => void
  __ctdHooked?: boolean
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
  const live = (id: string) => (transect.on[id] ?? true) && byId[id].lat !== null && byId[id].lon !== null
  const liveIds = orderIds.filter(live)
  const nextLive = (i: number) => orderIds.slice(i + 1).find(live) ?? null
  const nextLiveOf = (id: string) => nextLive(orderIds.indexOf(id))
  // waypoints after a station, in the order they lie along the way to the next one
  const routeFor = (id: string): Waypoint[] => {
    const nxt = nextLiveOf(id)
    const list = transect.waypoints.filter(w => w.after === id)
    if (!nxt) return list
    const a = { lat: byId[id].lat!, lon: byId[id].lon! }, b = { lat: byId[nxt].lat!, lon: byId[nxt].lon! }
    return [...list].sort((p, q) => fractionAlong(a, b, p) - fractionAlong(a, b, q))
  }
  const chosen: SectionStation[] = liveIds.map(id => {
    const s = byId[id]
    return {
      id, label: transect.labels[id]?.trim() || s.name, color: s.color, lat: s.lat!, lon: s.lon!, cast: s.cast,
      mids: (transect.mids[id] ?? []).filter(m => m.d !== null && m.z !== null).map(m => ({ d: m.d!, z: m.z!, to: m.to })),
      route: nextLiveOf(id) ? routeFor(id).map(w => ({ lat: w.lat, lon: w.lon, depth: w.depth })) : [],
    }
  })
  const nameOf = (id: string | null) => (id && byId[id] ? (transect.labels[id]?.trim() || byId[id].name) : 'the next station')
  const unplaced = orderIds.filter(id => (transect.on[id] ?? true) && !live(id)).map(id => byId[id].name)

  let dmin = num(settings.depthMin), dmax = num(settings.depthMax)
  if (dmin !== null && dmax !== null && dmin > dmax) [dmin, dmax] = [dmax, dmin]
  const isOn = (name: string) => settings.sectionVariables[name] ?? false

  const sections = useMemo(() => variables.filter(v => isOn(v.name)).map(v => {
    const pal = settings.palettes[v.name] ?? settings.palettes['*']
    const levels = pal?.clr.levels
    return {
      variable: v.name,
      result: buildSection(chosen, {
        variable: v.name, shorts: v.shorts, depthMin: dmin, depthMax: dmax, nContours: settings.contourSteps,
        colorscale: pal && pal.clr.stops.length ? pal.clr.stops : null,
        range: levels ? [levels[0], levels[levels.length - 1]] : settings.rangeMode === 'auto' ? 'auto' : null,
        colorbarName: settings.colorbarName,
      }),
    }
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [transect, stations, variables, settings, dmin, dmax])

  const placed = active.filter(s => s.lat !== null && s.lon !== null)
  const routeLine = (chosenLike: SectionStation[]): LatLon[] => chosenLike.flatMap((s, i) => (i < chosenLike.length - 1 ? [{ lat: s.lat, lon: s.lon }, ...(s.route ?? [])] : [{ lat: s.lat, lon: s.lon }]))
  const map = useMemo(() => placed.length ? mapFigure(placed.map(s => ({ name: s.name, color: s.color, lat: s.lat!, lon: s.lon! })), routeLine(chosen), transect.waypoints) : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [stations, transect])
  const distances = chosen.length > 1 ? routeDistances(chosen).dist : []

  // ---- dragging waypoints on the map ----
  // Plotly's map cannot drag points, but it hands out the map underneath,
  // whose mouse events carry the position. Only waypoints move; a station's
  // position comes from its file or the Stations page.
  const liveRef = useRef({ waypoints: transect.waypoints, chosen })
  liveRef.current = { waypoints: transect.waypoints, chosen }
  const commitRef = useRef((w: Waypoint[]) => setTransect({ waypoints: w }))
  commitRef.current = (w: Waypoint[]) => setTransect({ waypoints: w })
  const onMapReady = useCallback((gd: PlotlyHTMLElement) => {
    const m = (gd as unknown as { _fullLayout?: { map?: { _subplot?: { map?: MapLike } } } })._fullLayout?.map?._subplot?.map
    if (!m || typeof m.project !== 'function' || m.__ctdHooked) return
    m.__ctdHooked = true
    let held: { index: number; wps: Waypoint[] } | null = null
    let raf = 0
    const nearest = (pt: { x: number; y: number }) => {
      const wps = liveRef.current.waypoints
      let best = -1, bd = 14
      wps.forEach((w, i) => { const p = m.project([w.lon, w.lat]); const d = Math.hypot(p.x - pt.x, p.y - pt.y); if (d < bd) { bd = d; best = i } })
      return best
    }
    const redraw = (wps: Waypoint[]) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const ch = liveRef.current.chosen.map(s => ({ ...s, route: s.route ? routeOf(s.id, wps) : [] }))
        const line = routeLine(ch)
        void Plotly.restyle(gd, { lat: [line.map(p => p.lat), wps.map(w => w.lat)], lon: [line.map(p => p.lon), wps.map(w => w.lon)] } as never, [0, 1]).catch(() => {})
      })
    }
    const routeOf = (id: string, wps: Waypoint[]) => {
      const ch = liveRef.current.chosen
      const i = ch.findIndex(s => s.id === id)
      const nxt = ch[i + 1]
      const list = wps.filter(w => w.after === id)
      if (!nxt) return []
      return [...list].sort((p, q) => fractionAlong(ch[i], nxt, p) - fractionAlong(ch[i], nxt, q)).map(w => ({ lat: w.lat, lon: w.lon, depth: w.depth }))
    }
    const start = (e: { point: { x: number; y: number }; preventDefault: () => void }) => {
      const i = nearest(e.point)
      if (i < 0) return
      held = { index: i, wps: liveRef.current.waypoints.map(w => ({ ...w })) }
      m.dragPan.disable(); e.preventDefault()
    }
    const move = (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => {
      if (!held) { m.getCanvas().style.cursor = nearest(e.point) >= 0 ? 'grab' : ''; return }
      held.wps[held.index] = { ...held.wps[held.index], lat: +e.lngLat.lat.toFixed(5), lon: +e.lngLat.lng.toFixed(5) }
      m.getCanvas().style.cursor = 'grabbing'
      redraw(held.wps)
    }
    const end = () => {
      if (!held) return
      const done = held.wps; held = null
      m.dragPan.enable(); m.getCanvas().style.cursor = ''
      commitRef.current(done)
    }
    m.on('mousedown', start); m.on('mousemove', move); m.on('mouseup', end)
    m.on('touchstart', start); m.on('touchmove', move); m.on('touchend', end)
  }, [])

  const [paletteFor, setPaletteFor] = useState<string>('')
  const paletteTarget = paletteFor || variables.find(v => isOn(v.name))?.name || variables[0]?.name || '*'
  const onPalette = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    try {
      const clr = parsePalette(await f.text(), f.name)
      const key = paletteTarget === '*' && clr.levels ? (variables.find(v => isOn(v.name))?.name ?? variables[0]?.name ?? '*') : paletteTarget
      setSettings({ palettes: { ...settings.palettes, [key]: { clr, name: f.name } } })
    } catch (err) { alert((err as Error).message) }
    e.target.value = ''
  }
  const dropPalette = (key: string) => { const p = { ...settings.palettes }; delete p[key]; setSettings({ palettes: p }) }
  const setMid = (id: string, j: number, key: 'd' | 'z', value: string) => {
    const mids: Mid[] = (transect.mids[id] ?? []).map(m => ({ ...m }))
    mids[j][key] = num(value)
    setTransect({ mids: { ...transect.mids, [id]: mids } })
  }
  const addMid = (id: string, to: string | null) => setTransect({ mids: { ...transect.mids, [id]: [...(transect.mids[id] ?? []), { d: null, z: null, to }] } })
  const whither = (m: Mid) => m.to === BEFORE ? 'before the line' : m.to === AFTER ? 'beyond the line' : `towards ${nameOf(m.to)}`
  // a new waypoint starts halfway to the next station, so it is visible at once
  const addWaypoint = (id: string) => {
    const nxt = nextLiveOf(id); if (!nxt) return
    const a = byId[id], b = byId[nxt]
    const w: Waypoint = { id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, after: id, lat: +((a.lat! + b.lat!) / 2).toFixed(5), lon: +((a.lon! + b.lon!) / 2).toFixed(5), depth: null }
    setTransect({ waypoints: [...transect.waypoints, w] })
  }
  const setWaypoint = (wid: string, patch: Partial<Waypoint>) => setTransect({ waypoints: transect.waypoints.map(w => (w.id === wid ? { ...w, ...patch } : w)) })
  const dropWaypoint = (wid: string) => setTransect({ waypoints: transect.waypoints.filter(w => w.id !== wid) })

  if (active.length < 2) return <div className="empty">A transect needs at least two active stations. <Link to="/">Add or switch some on.</Link></div>

  const seg = <T extends string>(value: T, options: [T, string][], set: (v: T) => void) => (
    <span className="seg">{options.map(([v, label]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{label}</button>)}</span>
  )

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
              const isLive = live(id)
              const first = liveIds[0] === id, lastLive = liveIds[liveIds.length - 1] === id
              const wps = isLive && nextLive(i) !== null ? routeFor(id) : []
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
                    <span className="sname">{s.name}</span>
                    {placedHere
                      ? <span className="pos">{s.lat!.toFixed(4)}, {s.lon!.toFixed(4)}</span>
                      : <span className="pos missing"><Link to="/">no position</Link></span>}
                  </div>
                  <div className="sub">
                    <label className="lab">label on graph
                      <input className="inline name" value={transect.labels[id] ?? ''} placeholder={s.name}
                        onChange={e => setTransect({ labels: { ...transect.labels, [id]: e.target.value } })} aria-label={`Label for ${s.name} on the section`} />
                    </label>
                    <span className="adds">
                      {isLive && first && liveIds.length > 1 && <button className="add" title="A seafloor depth in metres out past this station, extending the section that way" onClick={() => addMid(id, BEFORE)}>+ point before</button>}
                      {isLive && nextLive(i) !== null && <button className="add" title="A seafloor depth in metres known between this station and the next, read off a chart. Shapes the seafloor; the colour between stations stretches down to meet it." onClick={() => addMid(id, nextLive(i))}>+ point after</button>}
                      {isLive && nextLive(i) !== null && <button className="add" title="Routes the line through a place you drag to on the map, so the distance runs through the water instead of straight across land. Give it a depth and it is a seafloor point as well." onClick={() => addWaypoint(id)}>+ waypoint</button>}
                      {isLive && lastLive && liveIds.length > 1 && <button className="add" title="A seafloor depth in metres out past this station, extending the section that way" onClick={() => addMid(id, AFTER)}>+ point after</button>}
                    </span>
                  </div>
                  {(mids.length > 0 || wps.length > 0) && (
                    <div className="mids">
                      {mids.map((m, j) => (
                        <div key={j} className="mid">
                          <span className="to">↳ {whither(m)}</span>
                          <span className="vals">
                            <input type="number" step="0.01" min="0" placeholder="km" value={m.d ?? ''} onChange={e => setMid(id, j, 'd', e.target.value)} aria-label="km from this station" /> km,
                            <input type="number" step="0.1" min="0" placeholder="m" value={m.z ?? ''} onChange={e => setMid(id, j, 'z', e.target.value)} aria-label="depth in metres" /> m deep
                            <button className="x" title="remove" onClick={() => setTransect({ mids: { ...transect.mids, [id]: mids.filter((_, k) => k !== j) } })}>×</button>
                          </span>
                        </div>
                      ))}
                      {wps.map((w, j) => (
                        <div key={w.id} className="mid wp">
                          <span className="to">◇ waypoint {j + 1} on the way to {nameOf(nextLive(i))}, drag it on the map</span>
                          <span className="vals">
                            <input type="number" step="0.0001" value={w.lat} onChange={e => { const v = num(e.target.value); if (v !== null) setWaypoint(w.id, { lat: v }) }} aria-label="waypoint latitude" style={{ width: 84 }} />
                            <input type="number" step="0.0001" value={w.lon} onChange={e => { const v = num(e.target.value); if (v !== null) setWaypoint(w.id, { lon: v }) }} aria-label="waypoint longitude" style={{ width: 90 }} />
                            seafloor <input type="number" step="0.1" min="0" placeholder="m" value={w.depth ?? ''} onChange={e => setWaypoint(w.id, { depth: num(e.target.value) })} aria-label="seafloor depth at the waypoint, metres" /> m
                            <button className="x" title="remove" onClick={() => dropWaypoint(w.id)}>×</button>
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
          {distances.length > 1 && <p className="small muted mono" style={{ marginTop: 8 }}>{distances[distances.length - 1].toFixed(2)} km end to end{transect.waypoints.length ? ', along the waypoints' : ''}</p>}
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
              <input type="range" min={0} max={50} value={settings.contourSteps} onChange={e => setSettings({ contourSteps: +e.target.value })} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="field">colour range{seg(settings.rangeMode, [['fixed', 'fixed'], ['auto', 'this survey']], v => setSettings({ rangeMode: v }))}</label>
            <label className="field">colour bar label{seg(settings.colorbarName ? 'name' : 'units', [['units', 'units'], ['name', 'name and units']], v => setSettings({ colorbarName: v === 'name' }))}</label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="field">your own colour palette, for
              <span className="row">
                <select value={paletteTarget} onChange={e => setPaletteFor(e.target.value)} aria-label="Which section the palette colours">
                  {variables.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                  <option value="*">all sections (position palettes only)</option>
                </select>
                <label className="btn tiny" title={`Accepted: ${PALETTE_EXTENSIONS.join('  ')}\nSurfer .clr and .lvl, GMT .cpt, ODV .pal, Ferret .spk, NCL .rgb, SNAP .cpd, GIMP .ggr, ParaView .json/.xml, QGIS ramps, GRASS and GDAL rules.\nA file with real values also sets the colour range.`}>choose palette file<input type="file" accept={PALETTE_EXTENSIONS.join(',')} onChange={onPalette} style={{ display: 'none' }} /></label>
              </span>
              <span className="hint">{PALETTE_EXTENSIONS.join(' ')}</span>
            </label>
            <label className="field">map<input type="checkbox" className="switch" checked={settings.showMap} onChange={e => setSettings({ showMap: e.target.checked })} /></label>
            <label className="field">titles<input type="checkbox" className="switch" checked={settings.sectionTitles} onChange={e => setSettings({ sectionTitles: e.target.checked })} /></label>
            <label className="field">graphs{seg(settings.sectionGraphTheme, [['light', 'light'], ['dark', 'dark']], v => setSettings({ sectionGraphTheme: v }))}</label>
          </div>
          {Object.keys(settings.palettes).length > 0 && (
            <div className="stack" style={{ gap: 4, marginTop: 8 }}>
              {Object.entries(settings.palettes).map(([key, p]) => (
                <div key={key} className="row small">
                  <span className="chip on">{p.name}</span>
                  <span className="muted">{key === '*' ? 'all sections' : key}{p.clr.warnings.length ? ` · ${p.clr.warnings.join('; ')}` : ''}</span>
                  <button className="btn quiet tiny" onClick={() => dropPalette(key)}>remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="stack">
        {settings.showMap && map && (
          <div className={`plot-card ${settings.sectionGraphTheme}`}><Plot data={map.data} layout={map.layout} filename="station_map" height={420} theme={settings.sectionGraphTheme} onReady={onMapReady} /></div>
        )}
        {chosen.length < 2 && <div className="empty">Tick at least two positioned stations to draw a section.</div>}
        {chosen.length >= 2 && sections.length === 0 && <div className="empty">Tick a variable to draw its section.</div>}
        {sections.map(({ variable, result }) => result ? (
          <PlotCard key={variable} data={result.data} layout={result.layout} filename={`${variable.replace(/\W+/g, '_')}_section`} height={520}
            theme={settings.sectionGraphTheme} autoTitle={result.autoTitle} title={settings.sectionTitleText[variable]} showTitle={settings.sectionTitles}
            onTitle={t => setSettings({ sectionTitleText: { ...settings.sectionTitleText, [variable]: t } })}
            note={result.notes.length ? result.notes.join(' · ') : undefined} />
        ) : <div key={variable} className="note muted small">{variable}: not in every chosen station.</div>)}
        <p className="muted small">A vertical section (transect plot): distance along a line of stations against depth, coloured by one variable and interpolated between the casts.</p>
      </div>
    </div>
  )
}
