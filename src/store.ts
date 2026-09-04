// One store for everything the pages share. Kept in memory and mirrored to
// sessionStorage, so uploads and typed positions survive moving between pages,
// following a link and coming back, and a reload; they go when the tab closes.
import { create } from 'zustand'
import { parseCnv, decodeCnv, stationName, naturalCompare, downcastOnly, deepest, positionFromColumns, type Cast } from './lib/cnv'
import { parseCoordinate } from './lib/geo'
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

// A seafloor point: km from its station towards `to`, and depth in m. `to` is
// the neighbour's station id, or BEFORE / AFTER for a point out past the first
// or last station, which extends the section. Anchoring to the neighbour means
// dragging the rows about cannot silently move a point.
export const BEFORE = '<before>'
export const AFTER = '<after>'
export interface Mid { d: number | null; z: number | null; to: string | null }

// A waypoint routes the line between a station and the next one on the
// transect, so the distance runs through it instead of straight across
// land. With a depth it is also a seafloor point at its place on the route.
export interface Waypoint { id: string; after: string; lat: number; lon: number; depth: number | null }

export interface TransectState {
  order: string[]                       // station ids
  on: Record<string, boolean>
  labels: Record<string, string>
  mids: Record<string, Mid[]>
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
  profileWidths: Record<string, number>      // per variable, percent of the row
  // extra graphs of one variable against another (or depth), e.g. Temperature vs Salinity
  customPairs: { x: string; y: string }[]
  // transect
  sectionVariables: Record<string, boolean>
  contourSteps: number
  rangeMode: 'fixed' | 'auto'
  // uploaded palettes by the variable they colour; '*' colours every section
  palettes: Record<string, { clr: Clr; name: string }>
  showMap: boolean
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
  setSettings: (patch: Partial<Settings>) => void
  dismissNotices: () => void
}

const DEFAULT_SETTINGS: Settings = {
  variables: {}, depthMin: '', depthMax: '', lineShape: 'spline', legendPos: 'right',
  yVariable: 'depth', yInvert: true, yLabelMode: 'side', profileTitles: true, profileTitleText: {},
  profileGraphTheme: effectiveTheme('system'), profileWidths: {}, customPairs: [],
  sectionVariables: { Temperature: true }, contourSteps: 0, rangeMode: 'fixed',
  palettes: {}, showMap: true, sectionTitles: true, sectionTitleText: {}, sectionGraphTheme: effectiveTheme('system'),
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

// Keep the transect order in step with the stations that are active: drop
// ids that left, append newcomers, keep what the user arranged.
function reconcile(t: TransectState, stations: Station[]): TransectState {
  const active = stations.filter(s => s.active)
  const ids = new Set(active.map(s => s.id))
  const order = t.order.filter(id => ids.has(id))
  const newcomers = active.filter(s => !order.includes(s.id))
    .sort((a, b) => (b.lat ?? -999) - (a.lat ?? -999))          // north to south, unpositioned last
  for (const s of newcomers) order.push(s.id)
  const on: Record<string, boolean> = {}, labels: Record<string, string> = {}, mids: Record<string, Mid[]> = {}
  for (const id of order) {
    on[id] = t.on[id] ?? true
    labels[id] = t.labels[id] ?? ''
    mids[id] = t.mids[id] ?? []
  }
  const waypoints = (t.waypoints ?? []).filter(w => ids.has(w.after))
  return { order, on, labels, mids, waypoints }
}

// ---- sessionStorage mirror -------------------------------------------------
const KEY = 'ctd-grapher-v1'
interface Saved { stations: (Omit<Station, 'cast'> & { cast: Omit<Cast, 'data'> & { data: number[][] } })[]; transect: TransectState; settings: Settings; nextId: number }

function load(): { stations: Station[]; transect: TransectState; settings: Settings } | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved
    const stations: Station[] = s.stations.map(st => ({ ...st, cast: { ...st.cast, data: st.cast.data.map(col => Float64Array.from(col.map(v => (v === null ? NaN : v)))) } }))
    nextId = s.nextId ?? stations.length + 1
    return { stations, transect: reconcile(s.transect, stations), settings: { ...DEFAULT_SETTINGS, ...s.settings } }
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
  transect: restored?.transect ?? { order: [], on: {}, labels: {}, mids: {}, waypoints: [] },
  settings: restored?.settings ?? DEFAULT_SETTINGS,
  notices: [],

  addFiles: files => {
    const notices: string[] = []
    let stations = [...get().stations]
    for (const f of files) {
      if (!/\.cnv$/i.test(f.name)) { notices.push(`${f.name}: not a .cnv file, skipped`); continue }
      let cast: Cast
      try { cast = parseCnv(decodeCnv(f.buffer), f.name) } catch (e) { notices.push((e as Error).message); continue }
      if (!cast.nrows) { notices.push(`${f.name}: no data rows after *END*`); continue }
      let dropped = 0
      if (!cast.meta.processing.includes('loopedit')) {
        const cut = downcastOnly(cast)
        cast = cut.cast; dropped = cut.dropped
        if (dropped) notices.push(`${f.name}: raw cast, kept the downcast (${dropped} rows dropped)`)
        if (cut.timeSeries) notices.push(`${f.name}: looks like a time series at one depth rather than a cast, so nothing was cut`)
      }
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

  setPosition: (id, latText, lonText) => set(s => ({
    stations: s.stations.map(x => (x.id === id ? {
      ...x, latText, lonText,
      lat: parseCoordinate(latText, 'lat'), lon: parseCoordinate(lonText, 'lon'),
    } : x)),
  })),

  // Rewrites every typed value so it carries the hemisphere as a letter.
  setAllHemisphere: (kind, hemi) => set(s => ({
    stations: s.stations.map(x => {
      const key = kind === 'lat' ? 'latText' : 'lonText'
      const raw = x[key].replace(/[NSEWnsew]/g, '').replace(/^\s*[-+]/, '').trim()
      if (!raw) return x
      const text = `${raw} ${hemi}`
      return { ...x, [key]: text, [kind]: parseCoordinate(text, kind) }
    }),
  })),

  setTransect: patch => set(s => ({ transect: reconcile({ ...s.transect, ...patch }, s.stations) })),

  moveInOrder: (from, to) => set(s => {
    const order = [...s.transect.order]
    const [m] = order.splice(from, 1)
    order.splice(to, 0, m)
    return { transect: { ...s.transect, order } }
  }),

  setSettings: patch => set(s => ({ settings: { ...s.settings, ...patch } })),
  dismissNotices: () => set({ notices: [] }),
}))

useStore.subscribe(() => scheduleSave(useStore.getState))

export const selectActive = (s: State) => s.stations.filter(x => x.active)
