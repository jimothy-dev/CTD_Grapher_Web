// One store for everything the pages share. It lives in memory only: uploads
// and typed positions survive moving between pages, and are gone on reload.
import { create } from 'zustand'
import { parseCnv, decodeCnv, stationName, naturalCompare, downcastOnly, deepest, type Cast } from './lib/cnv'
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

// A seafloor point: km from its station towards the neighbour `to` (a station
// id, the next station when the point was added), and depth in m. Anchoring
// to the neighbour means dragging the rows about cannot silently move it.
export interface Mid { d: number | null; z: number | null; to: string | null }

export interface TransectState {
  order: string[]                       // station ids
  on: Record<string, boolean>
  labels: Record<string, string>
  mids: Record<string, Mid[]>
}

interface Settings {
  variables: Record<string, boolean>    // profiles page
  depthMin: string
  depthMax: string
  lineShape: 'spline' | 'linear'
  sectionVariables: Record<string, boolean>
  contourSteps: number
  rangeMode: 'fixed' | 'auto'
  clr: Clr | null
  clrName: string
  useClr: boolean
  showMap: boolean
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
  // newcomers north to south by known latitude, unpositioned last
  const newcomers = active.filter(s => !order.includes(s.id))
    .sort((a, b) => (b.lat ?? -999) - (a.lat ?? -999))
  for (const s of newcomers) order.push(s.id)
  const on: Record<string, boolean> = {}, labels: Record<string, string> = {}, mids: Record<string, Mid[]> = {}
  for (const id of order) {
    on[id] = t.on[id] ?? true
    labels[id] = t.labels[id] ?? ''
    mids[id] = t.mids[id] ?? []
  }
  return { order, on, labels, mids }
}

export const useStore = create<State>((set, get) => ({
  stations: [],
  transect: { order: [], on: {}, labels: {}, mids: {} },
  settings: {
    variables: {}, depthMin: '', depthMax: '', lineShape: 'spline',
    sectionVariables: { Temperature: true }, contourSteps: 0, rangeMode: 'fixed',
    clr: null, clrName: '', useClr: false, showMap: true,
  },
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
      }
      const name = stationName(f.name)
      const known = cast.meta.startTime ? EXAMPLE_POSITIONS[cast.meta.startTime] : undefined
      const lat = cast.meta.lat ?? known?.[0] ?? null
      const lon = cast.meta.lon ?? known?.[1] ?? null
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
      const v = parseCoordinate(text, kind)
      return { ...x, [key]: text, [kind]: v }
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

export const selectActive = (s: State) => s.stations.filter(x => x.active)
