import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import Plotly from 'plotly.js-dist-min'
import type { PlotData, Layout, PlotlyHTMLElement } from 'plotly.js'
import { useStore, BEFORE, type Waypoint, type SeafloorSource } from '../store'
import { availableVariables } from '../lib/cnv'
import { buildSection, routeDistances, type SectionStation, type RoutePoint } from '../lib/section'
import { fetchSeafloor, forgetSeafloor, routeKey, SOURCES, type SeafloorResult } from '../lib/bathymetry'
import { parsePalette, PALETTE_EXTENSIONS } from '../lib/palettes'
import { fractionAlong, haversineKm } from '../lib/geo'
import Plot from '../components/Plot'
import PlotCard from '../components/PlotCard'

const num = (s: string): number | null => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }
type LatLon = { lat: number; lon: number }
interface LiveStation extends LatLon { id: string }
type Ordered = { route: Waypoint[]; lead: Waypoint[] }[]

// Waypoints in the order they lie along their stretch of the line: between
// two stations by their place along the straight join, ahead of the first
// station farthest first, beyond the last nearest first.
function orderWaypoints(kind: 'before' | 'between' | 'beyond', a: LatLon, b: LatLon | null, list: Waypoint[]): Waypoint[] {
  if (kind === 'between' && b) return [...list].sort((p, q) => fractionAlong(a, b, p) - fractionAlong(a, b, q))
  const d = (w: Waypoint) => haversineKm(a.lat, a.lon, w.lat, w.lon)
  return [...list].sort((p, q) => (kind === 'before' ? d(q) - d(p) : d(p) - d(q)))
}
const asPoint = (w: Waypoint): RoutePoint => ({ lat: w.lat, lon: w.lon, depth: w.depth })

// Each station's waypoints in travel order: towards the next station, or out
// beyond the end for the last one; the first station also gets those ahead of it.
function orderedWaypoints(live: LiveStation[], waypoints: Waypoint[]): Ordered {
  return live.map((s, i) => {
    const nxt = live[i + 1] ?? null
    const route = orderWaypoints(nxt ? 'between' : 'beyond', s, nxt, waypoints.filter(w => w.after === s.id))
    const lead = i === 0 ? orderWaypoints('before', s, null, waypoints.filter(w => w.after === BEFORE)) : []
    return { route, lead }
  })
}
// The line the map draws: waypoints ahead of the first station, then each station and the waypoints after it.
function routeLine(live: LiveStation[], ordered: Ordered): LatLon[] {
  const out: LatLon[] = [...(ordered[0]?.lead ?? [])]
  live.forEach((s, i) => { out.push({ lat: s.lat, lon: s.lon }); out.push(...ordered[i].route) })
  return out
}
// A quarter of the way on past `from`, continuing the direction from `towards` to `from`.
function carryOn(from: LatLon, towards: LatLon | null): LatLon {
  if (!towards || (towards.lat === from.lat && towards.lon === from.lon)) return { lat: +(from.lat + 0.01).toFixed(5), lon: from.lon }
  return { lat: +(from.lat + 0.25 * (from.lat - towards.lat)).toFixed(5), lon: +(from.lon + 0.25 * (from.lon - towards.lon)).toFixed(5) }
}

// Base maps and overlays as raster tile layers under the traces. Esri's Ocean
// Basemap shades depth (GEBCO-derived) and is free to use with attribution;
// GEBCO's own WMS serves shaded-relief tiles in web mercator.
const ESRI_OCEAN = 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'
const ESRI_OCEAN_REF = 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}'
const GEBCO_WMS = 'https://wms.gebco.net/mapserv?request=getmap&service=wms&version=1.3.0&crs=EPSG:3857&layers=GEBCO_LATEST&styles=&format=image/png&transparent=true&width=256&height=256&bbox={bbox-epsg-3857}'
export const MAP_CREDITS = {
  ocean: { text: 'Ocean base map: Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org and other contributors', url: 'https://www.arcgis.com/home/item.html?id=1e126e7520f9466c9ca28b8f28b5e500' },
  relief: { text: 'Relief: imagery reproduced from the GEBCO_2026 Grid, GEBCO Compilation Group (2026) GEBCO 2026 Grid (doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa)', url: 'https://www.gebco.net/data-products/gridded-bathymetry-data' },
}
type MapStyle = 'streets' | 'ocean'
type RasterLayer = { sourcetype: 'raster'; source: string[]; below: 'traces'; opacity?: number }
function mapLayers(style: MapStyle, relief: boolean): RasterLayer[] {
  const layers: RasterLayer[] = []
  if (style === 'ocean') layers.push({ sourcetype: 'raster', source: [ESRI_OCEAN], below: 'traces' })
  if (relief) layers.push({ sourcetype: 'raster', source: [GEBCO_WMS], below: 'traces', opacity: 0.55 })
  if (style === 'ocean') layers.push({ sourcetype: 'raster', source: [ESRI_OCEAN_REF], below: 'traces' })
  return layers
}

// Map traces: 0 the routed line, 1 the waypoints, then one per station. The
// first two keep their slots even when empty, so a drag can restyle them.
type MapView = { center: { lat: number; lon: number }; zoom: number }
function mapFigure(stations: { name: string; color: string; lat: number; lon: number }[], line: LatLon[], waypoints: Waypoint[], view: MapView | null, style: MapStyle, relief: boolean): { data: Partial<PlotData>[]; layout: Partial<Layout> } {
  const lats = stations.map(s => s.lat), lons = stations.map(s => s.lon)
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length
  const midLon = lons.reduce((a, b) => a + b, 0) / lons.length
  const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lons) - Math.min(...lons)) * Math.cos(midLat * Math.PI / 180))
  const autoZoom = [[0.02, 12], [0.05, 11], [0.2, 10], [0.5, 9], [1, 8], [5, 6], [20, 4], [60, 3], [1e9, 1]].find(([lim]) => span < lim)![1]
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
  // the user's own pan and zoom, when there is one for this set of stations,
  // so a redraw for a moved waypoint or a typed label does not jump the view
  const layout = {
    margin: { l: 0, r: 0, t: 0, b: 0 }, legend: { title: { text: 'Station' } }, uirevision: 'map',
    map: { style: style === 'ocean' ? 'white-bg' : 'open-street-map', center: view?.center ?? { lat: midLat, lon: midLon }, zoom: view?.zoom ?? autoZoom, layers: mapLayers(style, relief) },
  } as unknown as Partial<Layout>
  return { data, layout }
}

interface MapEvent { point: { x: number; y: number }; lngLat: { lng: number; lat: number }; originalEvent?: unknown; preventDefault: () => void }
interface MapLike {
  project: (lnglat: [number, number]) => { x: number; y: number }
  dragPan: { enable: () => void; disable: () => void }
  getCanvas: () => HTMLCanvasElement
  getCenter: () => { lng: number; lat: number }
  getZoom: () => number
  on: (ev: string, fn: (e: MapEvent) => void) => void
  __ctdHooked?: boolean
}

export default function Transect() {
  const stations = useStore(s => s.stations)
  const transect = useStore(s => s.transect)
  const settings = useStore(s => s.settings)
  const { setTransect, moveInOrder, autoOrder, setSettings } = useStore()
  const byId = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s])), [stations])
  const active = useMemo(() => stations.filter(s => s.active), [stations])
  const variables = useMemo(() => availableVariables(active.map(s => s.cast)), [active])
  const dragFrom = useRef<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  const orderIds = transect.order.filter(id => byId[id])
  const live = (id: string) => (transect.on[id] ?? true) && byId[id].lat !== null && byId[id].lon !== null
  const liveIds = orderIds.filter(live)
  const liveStations: LiveStation[] = liveIds.map(id => ({ id, lat: byId[id].lat!, lon: byId[id].lon! }))
  // waypoints of an unticked or unpositioned station wait in its row, off the map, until it is back
  const onLine = (w: Waypoint, lv: LiveStation[]) => (w.after === BEFORE ? lv.length > 0 : lv.some(s => s.id === w.after))
  const shownWps = transect.waypoints.filter(w => onLine(w, liveStations))
  const ordered = orderedWaypoints(liveStations, transect.waypoints)
  const nextLiveOf = (id: string) => { const i = liveIds.indexOf(id); return i >= 0 ? liveIds[i + 1] ?? null : null }
  const chosen: SectionStation[] = liveIds.map((id, i) => {
    const s = byId[id]
    return {
      id, label: transect.labels[id]?.trim() || s.name, color: s.color, lat: s.lat!, lon: s.lon!, cast: s.cast,
      route: ordered[i].route.map(asPoint), lead: ordered[i].lead.map(asPoint),
    }
  })
  const nameOf = (id: string | null) => (id && byId[id] ? (transect.labels[id]?.trim() || byId[id].name) : 'the next station')
  const unplaced = orderIds.filter(id => (transect.on[id] ?? true) && !live(id)).map(id => byId[id].name)
  const route = chosen.length > 1 ? routeDistances(chosen) : null

  let dmin = num(settings.depthMin), dmax = num(settings.depthMax)
  if (dmin !== null && dmax !== null && dmin > dmax) [dmin, dmax] = [dmax, dmin]
  const isOn = (name: string) => settings.sectionVariables[name] ?? false

  // ---- surveyed seafloor along the routed line, fetched when the route or the source changes
  const source = settings.seafloorSource
  const path = route?.path ?? null
  const key = source !== 'casts' && path && path.length > 1 ? routeKey(path, source) : null
  const [floor, setFloor] = useState<{ key: string; result?: SeafloorResult; error?: string }>({ key: '' })
  const [retry, setRetry] = useState(0)
  const pathRef = useRef(path)
  pathRef.current = path
  // The request is shared through the module's cache, so leaving the page
  // does not cancel it: the answer is kept for when the route comes back.
  useEffect(() => {
    const p = pathRef.current
    if (!key || source === 'casts' || !p) return
    let gone = false
    setFloor(f => (f.key === key && f.error ? { key: '' } : f))      // a retry shows "reading" again, not the old error
    fetchSeafloor(p, source).then(
      result => { if (!gone) setFloor({ key, result }) },
      err => { if (!gone) setFloor({ key, error: (err as Error).message || 'could not be read' }) })
    return () => { gone = true }
  }, [key, source, retry])
  const floorReady = key !== null && floor.key === key ? floor : null
  const samples = floorReady?.result?.samples ?? null
  const retryNow = () => { if (path && source !== 'casts') forgetSeafloor(path, source); setRetry(n => n + 1) }

  const sections = useMemo(() => variables.filter(v => isOn(v.name)).map(v => {
    const pal = settings.palettes[v.name] ?? settings.palettes['*']
    const levels = pal?.clr.levels
    return {
      variable: v.name,
      result: buildSection(chosen, {
        variable: v.name, shorts: v.shorts, depthMin: dmin, depthMax: dmax, nContours: settings.contourSteps,
        colorscale: pal && pal.clr.stops.length ? pal.clr.stops : null,
        range: levels ? [levels[0], levels[levels.length - 1]] : settings.rangeMode === 'auto' ? 'auto' : null,
        colorbarName: settings.colorbarName, interpolation: settings.interpolation, oaScale: num(settings.oaScale),
        seafloor: samples, seafloorName: source !== 'casts' ? SOURCES[source].name : undefined,
      }),
    }
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [transect, stations, variables, settings, dmin, dmax, samples])

  const placed = active.filter(s => s.lat !== null && s.lon !== null)
  // the view the user last panned or zoomed to, kept while the same stations are on the map
  const viewRef = useRef<(MapView & { key: string }) | null>(null)
  const placedKey = placed.map(s => `${s.id}:${s.lat}:${s.lon}`).join('|')
  const placedKeyRef = useRef(placedKey)
  placedKeyRef.current = placedKey
  const map = useMemo(() => {
    if (!placed.length) return null
    const kept = viewRef.current && viewRef.current.key === placedKey ? viewRef.current : null
    return mapFigure(placed.map(s => ({ name: s.name, color: s.color, lat: s.lat!, lon: s.lon! })), routeLine(liveStations, ordered), shownWps, kept, settings.mapStyle, settings.mapRelief)
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [stations, transect, settings.mapStyle, settings.mapRelief])

  // ---- dragging waypoints on the map ----
  // Plotly's map cannot drag points, but it hands out the map underneath,
  // whose mouse events carry the position. Only waypoints move; a station's
  // position comes from its file or the Stations page.
  const liveRef = useRef({ waypoints: transect.waypoints, live: liveStations })
  liveRef.current = { waypoints: transect.waypoints, live: liveStations }
  const commitRef = useRef((w: Waypoint[]) => setTransect({ waypoints: w }))
  commitRef.current = (w: Waypoint[]) => setTransect({ waypoints: w })
  const onMapReady = useCallback((gd: PlotlyHTMLElement) => {
    const m = (gd as unknown as { _fullLayout?: { map?: { _subplot?: { map?: MapLike } } } })._fullLayout?.map?._subplot?.map
    if (!m || typeof m.project !== 'function' || m.__ctdHooked) return
    m.__ctdHooked = true
    // remember where the user leaves the map (mouse, touch or wheel), not moves we make ourselves
    let wheeled = false
    m.on('wheel', () => { wheeled = true })
    m.on('moveend', e => {
      if (e.originalEvent || wheeled) { const c = m.getCenter(); viewRef.current = { key: placedKeyRef.current, center: { lat: c.lat, lon: c.lng }, zoom: m.getZoom() } }
      wheeled = false
    })
    let held: { index: number; wps: Waypoint[] } | null = null
    let raf = 0
    const nearest = (pt: { x: number; y: number }) => {
      const { waypoints: wps, live: lv } = liveRef.current
      let best = -1, bd = 14
      wps.forEach((w, i) => { if (!onLine(w, lv)) return; const p = m.project([w.lon, w.lat]); const d = Math.hypot(p.x - pt.x, p.y - pt.y); if (d < bd) { bd = d; best = i } })
      return best
    }
    const redraw = (wps: Waypoint[]) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const lv = liveRef.current.live
        const line = routeLine(lv, orderedWaypoints(lv, wps))
        const shown = wps.filter(w => onLine(w, lv))
        void Plotly.restyle(gd, { lat: [line.map(p => p.lat), shown.map(w => w.lat)], lon: [line.map(p => p.lon), shown.map(w => w.lon)] } as never, [0, 1]).catch(() => {})
      })
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
  const newWaypoint = (after: string, at: LatLon): Waypoint => ({ id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, after, lat: at.lat, lon: at.lon, depth: null })
  const pushWaypoint = (w: Waypoint) => setTransect({ waypoints: [...transect.waypoints, w] })
  // a new waypoint between stations starts halfway to the next one, so it is visible at once
  const addWaypoint = (id: string) => {
    const nxt = nextLiveOf(id); if (!nxt) return
    const a = byId[id], b = byId[nxt]
    pushWaypoint(newWaypoint(id, { lat: +((a.lat! + b.lat!) / 2).toFixed(5), lon: +((a.lon! + b.lon!) / 2).toFixed(5) }))
  }
  // ahead of the first station, or beyond the last: carry the line on a quarter of the way, past any waypoint already out there
  const addBefore = () => {
    if (liveStations.length < 2) return
    const first = liveStations[0], lead = ordered[0].lead
    const at = lead.length ? carryOn(lead[0], first) : carryOn(first, ordered[0].route[0] ?? liveStations[1])
    pushWaypoint(newWaypoint(BEFORE, at))
  }
  const addAfter = () => {
    const n = liveStations.length; if (n < 2) return
    const lastS = liveStations[n - 1], beyond = ordered[n - 1].route
    const before = ordered[n - 2].route
    const at = beyond.length ? carryOn(beyond[beyond.length - 1], lastS) : carryOn(lastS, before[before.length - 1] ?? liveStations[n - 2])
    pushWaypoint(newWaypoint(lastS.id, at))
  }
  const setWaypoint = (wid: string, patch: Partial<Waypoint>) => setTransect({ waypoints: transect.waypoints.map(w => (w.id === wid ? { ...w, ...patch } : w)) })
  const dropWaypoint = (wid: string) => setTransect({ waypoints: transect.waypoints.filter(w => w.id !== wid) })

  if (active.length < 2) return <div className="empty">A transect needs at least two active stations. <Link to="/">Add or switch some on.</Link></div>

  const seg = <T extends string>(value: T, options: [T, string][], set: (v: T) => void) => (
    <span className="seg">{options.map(([v, label]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{label}</button>)}</span>
  )
  const wpRow = (w: Waypoint, text: string) => (
    <div key={w.id} className="mid wp">
      <span className="to">◇ {text}, drag it on the map</span>
      <span className="vals">
        <input type="number" step="0.0001" value={w.lat} onChange={e => { const v = num(e.target.value); if (v !== null) setWaypoint(w.id, { lat: v }) }} aria-label="waypoint latitude" title="latitude" style={{ width: 80 }} />
        <input type="number" step="0.0001" value={w.lon} onChange={e => { const v = num(e.target.value); if (v !== null) setWaypoint(w.id, { lon: v }) }} aria-label="waypoint longitude" title="longitude" style={{ width: 86 }} />
        <input type="number" step="0.1" min="0" placeholder="seafloor m" value={w.depth ?? ''} onChange={e => setWaypoint(w.id, { depth: num(e.target.value) })} aria-label="seafloor depth at the waypoint, metres" title="Seafloor depth here in metres, if known: a seafloor point at this place on the line" style={{ width: 82 }} />
        <button className="x" title="remove" onClick={() => dropWaypoint(w.id)}>×</button>
      </span>
    </div>
  )
  const floorStatus = source === 'casts' ? null
    : !key ? <span className="hint">needs two positioned stations on the line</span>
    : !floorReady ? <span className="hint">{SOURCES[source].name}: reading the seafloor along the line…</span>
    : floorReady.error ? <span className="hint" style={{ color: 'var(--danger)', fontFamily: 'var(--sans)' }}>{SOURCES[source].name}: {floorReady.error} <button className="btn quiet tiny" onClick={retryNow}>retry</button></span>
    : <span className="hint">{SOURCES[source].name}: {floorReady.result!.detail}</span>
  const lastDist = route ? route.dist[route.dist.length - 1] : 0
  const extended = route ? route.xMin < -1e-6 || route.xMax > lastDist + 1e-6 : false

  return (
    <div className="grid-2">
      <div className="stack">
        <div>
          <h1>Transect</h1>
          <p className="muted small">Stations are ordered along the line from the most north-western one, nearest next; drag to change. Untick any not on it.</p>
        </div>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Stations on the line</h2>
            {transect.arranged && <button className="btn quiet tiny" title="Back to the automatic order: start at the most north-western station and go to the nearest station not yet visited each time" onClick={autoOrder}>auto order</button>}
          </div>
          <div className="order">
            {orderIds.map((id, i) => {
              const s = byId[id]
              const placedHere = s.lat !== null && s.lon !== null
              const isLive = live(id)
              const li = liveIds.indexOf(id)
              const nxt = isLive ? nextLiveOf(id) : null
              const isFirst = isLive && li === 0, isLast = isLive && li === liveIds.length - 1
              const lead = isFirst ? ordered[0].lead : [], after = isLive ? ordered[li].route : []
              const parked = isLive ? [] : transect.waypoints.filter(w => w.after === id)
              const label = transect.labels[id]?.trim() || s.name
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
                      {isFirst && liveIds.length > 1 && <button className="add" title="A point ahead of this station that carries the line on before it, dragged on the map; the section starts there. Give it a depth and it is a seafloor point as well." onClick={addBefore}>+ waypoint before</button>}
                      {nxt && <button className="add" title="Routes the line through a place you drag to on the map, so the distance runs through the water instead of straight across land. Give it a depth read off a chart and it is a seafloor point as well." onClick={() => addWaypoint(id)}>+ waypoint</button>}
                      {isLast && liveIds.length > 1 && <button className="add" title="A point beyond this station that carries the line on past it, dragged on the map; the section ends there. Give it a depth and it is a seafloor point as well." onClick={addAfter}>+ waypoint after</button>}
                    </span>
                  </div>
                  {(lead.length > 0 || after.length > 0 || parked.length > 0) && (
                    <div className="mids">
                      {parked.map((w, j) => wpRow(w, `waypoint ${j + 1} after ${label}, off the map while the station is off the line`))}
                      {lead.map((w, j) => wpRow(w, `waypoint ${j + 1} before ${label}`))}
                      {after.map((w, j) => wpRow(w, nxt ? `waypoint ${j + 1} on the way to ${nameOf(nxt)}` : `waypoint ${j + 1} beyond ${label}`))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {unplaced.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Left off until positioned: {unplaced.join(', ')}.</p>}
          {route && <p className="small muted mono" style={{ marginTop: 8 }}>{(route.xMax - route.xMin).toFixed(2)} km end to end{extended ? ` (${lastDist.toFixed(2)} km between the stations)` : ''}{route.path.length > chosen.length ? ', along the waypoints' : ''}</p>}
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
            <label className="field">depth from (m)<input type="number" value={settings.depthMin} placeholder="surface" style={{ width: 88 }} onChange={e => setSettings({ depthMin: e.target.value })} /></label>
            <label className="field">depth to (m)<input type="number" value={settings.depthMax} placeholder="bottom" style={{ width: 88 }} onChange={e => setSettings({ depthMax: e.target.value })} /></label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>contour steps: {settings.contourSteps || 'smooth'}
              <input type="range" min={0} max={50} value={settings.contourSteps} onChange={e => setSettings({ contourSteps: +e.target.value })} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field">color range{seg(settings.rangeMode, [['fixed', 'fixed'], ['auto', 'this survey']], v => setSettings({ rangeMode: v }))}</div>
            <div className="field">color bar label{seg(settings.colorbarName ? 'name' : 'units', [['units', 'units'], ['name', 'name and units']], v => setSettings({ colorbarName: v === 'name' }))}</div>
            <div className="field" title="How the field is filled in between casts at each depth. Smooth curve: a shape-preserving cubic through the stations, never outside the two casts on either side. Objective analysis: the Gauss-Markov gridder of oceanography (Bretherton et al. 1976) with a Markov (exponential) covariance, which passes through every cast and, between stations far apart compared with the scale, eases towards the mean of the casts at that depth; a longer scale flattens that. Straight: straight lines, with kinks at the stations.">between stations{seg(settings.interpolation, [['smooth', 'smooth curve'], ['oa', 'objective analysis'], ['linear', 'straight']], v => setSettings({ interpolation: v }))}</div>
            {settings.interpolation === 'oa' && <label className="field" title="Covariance scale of the objective analysis in km. Blank: twice the mean spacing between neighbouring stations.">scale (km)<input type="number" min="0.01" step="0.1" value={settings.oaScale} placeholder="auto" style={{ width: 80 }} onChange={e => setSettings({ oaScale: e.target.value })} /></label>}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" title="Where the black seafloor comes from: the casts' deepest readings and the depths you give waypoints, or surveyed bathymetry sampled along the routed line. NOAA NCEI's DEM mosaic is worldwide (coastal DEMs down to 1/9 arc-second, ETOPO 2022 at 15 arc-second elsewhere); EMODnet covers European seas at 1/16 arc-minute. A cast that went deeper than the grid keeps its own depth, and land on the line is reported.">seafloor{seg<SeafloorSource>(source, [['casts', 'casts and waypoints'], ['ncei', 'NOAA NCEI DEMs'], ['emodnet', 'EMODnet (Europe)']], v => setSettings({ seafloorSource: v }))}</div>
            {floorStatus}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="field">your own color palette, for
              <span className="row">
                <select value={paletteTarget} onChange={e => setPaletteFor(e.target.value)} aria-label="Which section the palette colors">
                  {variables.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                  <option value="*">all sections (position palettes only)</option>
                </select>
                <label className="btn tiny" title={`Accepted: ${PALETTE_EXTENSIONS.join('  ')}\nSurfer .clr and .lvl, GMT .cpt, ODV .pal, Ferret .spk, NCL .rgb, SNAP .cpd, GIMP .ggr, ParaView .json/.xml, QGIS ramps, GRASS and GDAL rules.\nA file with real values also sets the color range.`}>choose palette file<input type="file" accept={PALETTE_EXTENSIONS.join(',')} onChange={onPalette} style={{ display: 'none' }} /></label>
              </span>
              <span className="hint">{PALETTE_EXTENSIONS.join(' ')}</span>
            </label>
            <label className="field">map<input type="checkbox" className="switch" checked={settings.showMap} onChange={e => setSettings({ showMap: e.target.checked })} /></label>
            {settings.showMap && <div className="field" title="Streets: OpenStreetMap. Ocean: Esri's Ocean Basemap, with depth shading and soundings drawn from GEBCO and NOAA charts.">map base{seg(settings.mapStyle, [['streets', 'streets'], ['ocean', 'ocean']], v => setSettings({ mapStyle: v }))}</div>}
            {settings.showMap && <label className="field" title="Lay GEBCO's shaded bathymetric relief over the base map, at half strength">GEBCO relief<input type="checkbox" className="switch" checked={settings.mapRelief} onChange={e => setSettings({ mapRelief: e.target.checked })} /></label>}
            <label className="field">titles<input type="checkbox" className="switch" checked={settings.sectionTitles} onChange={e => setSettings({ sectionTitles: e.target.checked })} /></label>
            <div className="field">graphs{seg(settings.sectionGraphTheme, [['light', 'light'], ['dark', 'dark']], v => setSettings({ sectionGraphTheme: v }))}</div>
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
          <div className={`plot-card ${settings.sectionGraphTheme}`}>
            <Plot data={map.data} layout={map.layout} filename="station_map" height={420} theme={settings.sectionGraphTheme} onReady={onMapReady} />
            {(settings.mapStyle === 'ocean' || settings.mapRelief) && (
              <div className="note">
                {settings.mapStyle === 'ocean' && <a href={MAP_CREDITS.ocean.url} target="_blank" rel="noopener noreferrer">{MAP_CREDITS.ocean.text}</a>}
                {settings.mapStyle === 'ocean' && settings.mapRelief && ' · '}
                {settings.mapRelief && <a href={MAP_CREDITS.relief.url} target="_blank" rel="noopener noreferrer">{MAP_CREDITS.relief.text}</a>}
              </div>
            )}
          </div>
        )}
        {chosen.length < 2 && <div className="empty">Tick at least two positioned stations to draw a section.</div>}
        {chosen.length >= 2 && sections.length === 0 && <div className="empty">Tick a variable to draw its section.</div>}
        {sections.map(({ variable, result }) => result ? (
          <PlotCard key={variable} data={result.data} layout={result.layout} filename={`${variable.replace(/\W+/g, '_')}_section`} height={520}
            theme={settings.sectionGraphTheme} autoTitle={result.autoTitle} title={settings.sectionTitleText[variable]} showTitle={settings.sectionTitles}
            onTitle={t => setSettings({ sectionTitleText: { ...settings.sectionTitleText, [variable]: t } })}
            note={[...result.warnings, ...result.notes].length ? [...result.warnings, ...result.notes].join(' · ') : undefined} />
        ) : <div key={variable} className="note muted small">{variable}: not in every chosen station.</div>)}
        <p className="muted small">A vertical section (transect plot): distance along a line of stations against depth, colored by one variable and interpolated between the casts.</p>
        {source !== 'casts' && floorReady?.result && <p className="muted small">Seafloor: <a href={SOURCES[source].url} target="_blank" rel="noopener noreferrer">{SOURCES[source].credit}</a>.</p>}
      </div>
    </div>
  )
}
