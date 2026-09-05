// One store for everything the pages share. Kept in memory and mirrored to
// sessionStorage, so uploads and typed positions survive moving between pages,
// following a link and coming back, and a reload; they go when the tab closes.
import { create } from 'zustand'
import { parseCnv, decodeCnv, stationName, naturalCompare, downcastOnly, deepest, positionFromColumns, suspiciousChannels, type Cast } from './lib/cnv'
import { parseCoordinate, haversineKm } from './lib/geo'
import { isOpenCtd, parseOpenCtd } from './lib/openctd'
import { stationColor, type Clr } from './lib/colors'

export interface Station {
  id: string
  file: string
  name: string
  cast: Cast
  lat: number | null
  lon: number | null
  latText: string
  lonText: string
  active: boolean
  color: string
  deepest: number | null
  dropped: number        // rows removed by the downcast cut, 0 if untouched
}

// A waypoint routes the line from a station towards the next one on the
// transect, so the distance runs through it instead of straight across land.
// Waypoints after the last station carry the line on beyond it, and `after`
// set to BEFORE puts one ahead of the first station. With a depth a waypoint
// is also a seafloor point at its place on the route.
export const BEFORE = '<before>'
export interface Waypoint { id: string; after: string; lat: number; lon: number; depth: number | null }
export type SeafloorSource = 'casts' | 'ncei' | 'emodnet'

export interface TransectState {
  order: string[]                       // station ids
  arranged: boolean                     // true once the user has dragged the order; until then it follows the positions
  on: Record<string, boolean>
  labels: Record<string, string>
  waypoints: Waypoint[]
}

export type LegendPos = 'right' | 'left' | 'bottom'
export type YLabelMode = 'side' | 'top'
export type Theme = 'system' | 'light' | 'dark'
export type GraphTheme = 'light' | 'dark'

// What the site looks like right now, given the setting and the system.
export function effectiveTheme(theme: Theme): GraphTheme {
  if (theme !== 'system') return theme
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface Settings {
  // profiles
  variables: Record<string, boolean>
  depthMin: string
  depthMax: string
  lineShape: 'spline' | 'linear'
  legendPos: LegendPos
  yVariable: string               // 'depth' or a variable name
  yInvert: boolean
  yLabelMode: YLabelMode
  profileTitles: boolean
  profileTitleText: Record<string, string>   // per variable, overrides the auto title
  profileGraphTheme: GraphTheme
  graphsPerRow: number            // 1 to 4
  profileGrid: boolean            // grid lines inside the profile graphs
  // extra graphs of one variable against another (or depth), e.g. Temperature vs Salinity
  customPairs: { x: string; y: string }[]
  // transect
  sectionVariables: Record<string, boolean>
  contourSteps: number
  rangeMode: 'fixed' | 'auto'
  interpolation: 'smooth' | 'oa' | 'linear'   // between stations: a shape-preserving curve, objective analysis, or straight lines
  oaScale: string                      // objective analysis scale in km; blank means twice the mean station spacing
  seafloorSource: SeafloorSource       // the casts and waypoint depths, or surveyed bathymetry along the route
  // uploaded palettes by the variable they colour; '*' colours every section
  palettes: Record<string, { clr: Clr; name: string }>
  showMap: boolean
  mapStyle: 'streets' | 'ocean'   // OpenStreetMap, or Esri's Ocean Basemap with depth shading
  mapRelief: boolean              // GEBCO shaded relief laid over the base map
  sectionTitles: boolean
  sectionTitleText: Record<string, string>
  sectionGraphTheme: GraphTheme
  colorbarName: boolean           // "Temperature (°C)" on the colour bar instead of "°C"
  // site
  theme: Theme
}

interface State {
  stations: Station[]
  transect: TransectState
  settings: Settings
  notices: string[]
  addFiles: (files: { name: string; buffer: ArrayBuffer }[]) => void
  removeStation: (id: string) => void
  rename: (id: string, name: string) => void
  setActive: (id: string, active: boolean) => void
  setAllActive: (active: boolean) => void
  setPosition: (id: string, latText: string, lonText: string) => void
  setAllHemisphere: (kind: 'lat' | 'lon', hemi: 'N' | 'S' | 'E' | 'W') => void
  setTransect: (patch: Partial<TransectState>) => void
  moveInOrder: (from: number, to: number) => void
  autoOrder: () => void
  setSettings: (patch: Partial<Settings>) => void
  dismissNotices: () => void
}

const DEFAULT_SETTINGS: Settings = {
  variables: {}, depthMin: '', depthMax: '', lineShape: 'spline', legendPos: 'right',
  yVariable: 'depth', yInvert: true, yLabelMode: 'side', profileTitles: true, profileTitleText: {},
  profileGraphTheme: effectiveTheme('system'), graphsPerRow: 3, profileGrid: true, customPairs: [],
  sectionVariables: { Temperature: true }, contourSteps: 0, rangeMode: 'fixed', interpolation: 'smooth', oaScale: '', seafloorSource: 'casts',
  palettes: {}, showMap: true, mapStyle: 'streets', mapRelief: false, sectionTitles: true, sectionTitleText: {}, sectionGraphTheme: effectiveTheme('system'),
  colorbarName: false, theme: 'system',
}

let nextId = 1

// Positions for the casts shipped as examples, keyed by start time so they
// only ever apply to those files (field sheet, 15 May 2026).
const EXAMPLE_POSITIONS: Record<string, [number, number]> = {
  'May 15 2026 09:25:45': [47.316683, -122.473050],
  'May 15 2026 10:45:48': [47.356100, -122.404350],
  'May 15 2026 12:46:01': [47.338617, -122.543950],
  'May 15 2026 13:13:28': [47.393233, -122.537217],
  'May 15 2026 13:40:34': [47.431667, -122.525000],
}

function recolor(stations: Station[]): Station[] {
  return stations.map((s, i) => ({ ...s, color: stationColor(i) }))
}

// The order a line of stations most likely runs in: start at the most
// north-western positioned station and go to the nearest station not yet
// visited each time. A plain north-to-south sort zigzags across a line that
// bends or runs east-west; the chain follows it. Unpositioned stations come
// last, in name order.
export function chainOrder(stations: Station[]): string[] {
  const placed = stations.filter(s => s.lat !== null && s.lon !== null)
  const rest = stations.filter(s => s.lat === null || s.lon === null)
  if (!placed.length) return rest.map(s => s.id)
  const k = Math.cos((placed.reduce((a, s) => a + s.lat!, 0) / placed.length) * Math.PI / 180)
  const ref = placed[0].lon!
  const lon = (s: Station) => ref + ((((s.lon! - ref) % 360) + 540) % 360) - 180   // unwrapped near the first station, so a line across 180° still starts at its western end
  const nw = (s: Station) => s.lat! - lon(s) * k          // north and west both raise it
  const order = [placed.reduce((a, b) => (nw(b) > nw(a) ? b : a))]
  const left = new Set(placed.filter(s => s !== order[0]))
  while (left.size) {
    const cur = order[order.length - 1]
    let best: Station | null = null, bd = Infinity
    for (const s of left) { const d = haversineKm(cur.lat!, cur.lon!, s.lat!, s.lon!); if (d < bd) { bd = d; best = s } }
    order.push(best!); left.delete(best!)
  }
  return [...order.map(s => s.id), ...rest.map(s => s.id)]
}

// Keep the transect order in step with the stations that are active. Until
// the user drags the rows the order follows the positions, so it updates as
// positions are typed; after a drag it is kept, newcomers appended.
function reconcile(t: TransectState, stations: Station[]): TransectState {
  const active = stations.filter(s => s.active)
  const ids = new Set(active.map(s => s.id))
  // a session saved before the flag existed keeps the order it had
  const arranged = t.arranged ?? t.order.length > 0
  // stations unticked from the line come after the ticked ones, so they cannot steer the chain
  const chain = (list: Station[]) => [...chainOrder(list.filter(s => t.on[s.id] ?? true)), ...chainOrder(list.filter(s => !(t.on[s.id] ?? true)))]
  let order: string[]
  if (!arranged) order = chain(active)
  else {
    order = t.order.filter(id => ids.has(id))
    order.push(...chain(active.filter(s => !order.includes(s.id))))
  }
  const on: Record<string, boolean> = {}, labels: Record<string, string> = {}
  for (const id of order) {
    on[id] = t.on[id] ?? true
    labels[id] = t.labels[id] ?? ''
  }
  const waypoints = (t.waypoints ?? []).filter(w => ids.has(w.after) || (w.after === BEFORE && order.length > 0))
  return { order, arranged, on, labels, waypoints }
}

// ---- sessionStorage mirror -------------------------------------------------
const KEY = 'ctd-grapher-v1'
interface Saved { stations: (Omit<Station, 'cast'> & { cast: Omit<Cast, 'data'> & { data: number[][] } })[]; transect: TransectState; settings: Settings; nextId: number }

function load(): { stations: Station[]; transect: TransectState; settings: Settings; notices: string[] } | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved
    const stations: Station[] = s.stations.map(st => ({ ...st, cast: { ...st.cast, data: st.cast.data.map(col => Float64Array.from(col.map(v => (v === null ? NaN : v)))) } }))
    nextId = s.nextId ?? stations.length + 1
    const notices: string[] = []
    // typed seafloor points from an earlier version: waypoint depths do that job now
    const old = (s.transect as unknown as { mids?: Record<string, { d: number | null; z: number | null }[]> }).mids
    const typed = old ? Object.values(old).flat().filter(m => m.z !== null).length : 0
    if (typed) notices.push(`${typed} typed seafloor point${typed === 1 ? '' : 's'} from an earlier version were dropped; give a waypoint a depth instead`)
    return { stations, transect: reconcile(s.transect, stations), settings: { ...DEFAULT_SETTINGS, ...s.settings }, notices }
  } catch { return null }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(get: () => State) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const { stations, transect, settings } = get()
      const saved: Saved = {
        stations: stations.map(st => ({ ...st, cast: { ...st.cast, data: st.cast.data.map(col => Array.from(col, v => (Number.isNaN(v) ? null : v)) as unknown as number[]) } })),
        transect, settings, nextId,
      }
      const text = JSON.stringify(saved)
      if (text.length > 4_500_000) { sessionStorage.removeItem(KEY); return }   // too big for the quota: live in memory only
      sessionStorage.setItem(KEY, text)
    } catch { /* private mode or quota: memory only */ }
  }, 400)
}

const restored = load()

export const useStore = create<State>((set, get) => ({
  stations: restored?.stations ?? [],
  transect: restored?.transect ?? { order: [], arranged: false, on: {}, labels: {}, waypoints: [] },
  settings: restored?.settings ?? DEFAULT_SETTINGS,
  notices: restored?.notices ?? [],

  addFiles: files => {
    const notices: string[] = []
    let stations = [...get().stations]
    for (const f of files) {
      let cast: Cast
      const text = decodeCnv(f.buffer)
      if (/\.cnv$/i.test(f.name)) {
        try { cast = parseCnv(text, f.name) } catch (e) { notices.push((e as Error).message); continue }
        if (!cast.nrows) { notices.push(`${f.name}: no data rows after *END*`); continue }
      } else if (/\.(csv|txt)$/i.test(f.name) && isOpenCtd(text)) {
        try { const r = parseOpenCtd(text, f.name); cast = r.cast; notices.push(`${f.name}: OpenCTD log, ${r.notes.join('; ')}`) } catch (e) { notices.push((e as Error).message); continue }
      } else { notices.push(`${f.name}: not a Sea-Bird .cnv or an OpenCTD .csv, skipped`); continue }
      let dropped = 0
      try {
        if (!cast.meta.processing.includes('loopedit')) {
          const cut = downcastOnly(cast)
          cast = cut.cast; dropped = cut.dropped
          if (dropped) notices.push(`${f.name}: raw cast, kept the downcast (${dropped} rows dropped)`)
          if (cut.timeSeries) notices.push(`${f.name}: looks like a time series at one depth rather than a cast, so nothing was cut`)
        }
        const odd = suspiciousChannels(cast)
        if (odd.length) notices.push(`${f.name}: values outside the usual range, so the cast may be unprocessed or a sensor may have failed: ${odd.join('; ')}`)
      } catch (e) { notices.push(`${f.name}: could not be checked (${(e as Error).message}), loaded as is`) }
      const name = stationName(f.name)
      const known = cast.meta.startTime ? EXAMPLE_POSITIONS[cast.meta.startTime] : undefined
      const fromCols = positionFromColumns(cast)
      const lat = cast.meta.lat ?? fromCols?.[0] ?? known?.[0] ?? null
      const lon = cast.meta.lon ?? fromCols?.[1] ?? known?.[1] ?? null
      const existing = stations.find(s => s.name === name)
      const st: Station = {
        id: existing?.id ?? `s${nextId++}`, file: f.name, name, cast,
        lat: existing?.lat ?? lat, lon: existing?.lon ?? lon,
        latText: existing?.latText ?? (lat === null ? '' : lat.toFixed(5)),
        lonText: existing?.lonText ?? (lon === null ? '' : lon.toFixed(5)),
        active: existing?.active ?? true, color: '', deepest: deepest(cast), dropped,
      }
      if (existing) { stations = stations.map(s => (s.id === existing.id ? st : s)); notices.push(`${name}: replaced by the newer upload`) }
      else stations.push(st)
    }
    stations.sort((a, b) => naturalCompare(a.name, b.name))
    stations = recolor(stations)
    set(s => ({ stations, transect: reconcile(s.transect, stations), notices: [...s.notices, ...notices] }))
  },

  removeStation: id => set(s => {
    const stations = recolor(s.stations.filter(x => x.id !== id))
    return { stations, transect: reconcile(s.transect, stations) }
  }),

  rename: (id, name) => set(s => ({ stations: s.stations.map(x => (x.id === id ? { ...x, name } : x)) })),

  setActive: (id, active) => set(s => {
    const stations = s.stations.map(x => (x.id === id ? { ...x, active } : x))
    return { stations, transect: reconcile(s.transect, stations) }
  }),

  setAllActive: active => set(s => {
    const stations = s.stations.map(x => ({ ...x, active }))
    return { stations, transect: reconcile(s.transect, stations) }
  }),

  setPosition: (id, latText, lonText) => set(s => {
    const stations = s.stations.map(x => (x.id === id ? {
      ...x, latText, lonText,
      lat: parseCoordinate(latText, 'lat'), lon: parseCoordinate(lonText, 'lon'),
    } : x))
    return { stations, transect: reconcile(s.transect, stations) }
  }),

  // Rewrites every typed value so it carries the hemisphere as a letter.
  setAllHemisphere: (kind, hemi) => set(s => {
    const stations = s.stations.map(x => {
      const key = kind === 'lat' ? 'latText' : 'lonText'
      const raw = x[key].replace(/[NSEWnsew]/g, '').replace(/^\s*[-+]/, '').trim()
      if (!raw) return x
      const text = `${raw} ${hemi}`
      return { ...x, [key]: text, [kind]: parseCoordinate(text, kind) }
    })
    return { stations, transect: reconcile(s.transect, stations) }
  }),

  setTransect: patch => set(s => ({ transect: reconcile({ ...s.transect, ...patch }, s.stations) })),

  moveInOrder: (from, to) => set(s => {
    const order = [...s.transect.order]
    const [m] = order.splice(from, 1)
    order.splice(to, 0, m)
    return { transect: { ...s.transect, order, arranged: true } }
  }),

  autoOrder: () => set(s => ({ transect: reconcile({ ...s.transect, arranged: false }, s.stations) })),

  setSettings: patch => set(s => ({ settings: { ...s.settings, ...patch } })),
  dismissNotices: () => set({ notices: [] }),
}))

useStore.subscribe(() => scheduleSave(useStore.getState))

export const selectActive = (s: State) => s.stations.filter(x => x.active)
