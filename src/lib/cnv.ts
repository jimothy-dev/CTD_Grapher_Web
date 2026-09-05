// Sea-Bird .cnv parser.
// Columns come from "# name N = short: Description [units]"; data starts after
// *END*. bad_flag (-9.990e-29) marks missing data and the comparison is purely
// relative (no absolute tolerance), or every near-zero reading would be wiped.
// Headers are cp1252, not UTF-8 (the theta in sigma-theta): decode as
// windows-1252 before calling parseCnv.
import { canonicalUnit } from './units'

export interface Column {
  index: number
  short: string
  desc: string
  units: string
}

export interface CastMeta {
  filename: string
  badFlag: number
  startTime: string | null
  lat: number | null
  lon: number | null
  nvalues: number | null
  interval: string | null
  instrument: string | null
  processing: string[]
}

export interface Cast {
  columns: Column[]
  data: Float64Array[]
  nrows: number
  meta: CastMeta
}

export function decodeCnv(buffer: ArrayBuffer): string {
  return new TextDecoder('windows-1252').decode(buffer)
}

export function parseCnv(text: string, filename = 'cast.cnv'): Cast {
  const lines = text.split(/\r?\n/)
  const columns: Column[] = []
  const meta: CastMeta = {
    filename, badFlag: -9.99e-29, startTime: null, lat: null, lon: null,
    nvalues: null, interval: null, instrument: null, processing: [],
  }
  let dataStart = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('*END*')) { dataStart = i + 1; break }
    let m: RegExpMatchArray | null
    if ((m = line.match(/^#\s*name\s+(\d+)\s*=\s*([^:]+):\s*(.*)$/))) {
      const idx = +m[1]
      const rest = m[3].trim()
      const um = rest.match(/\[([^\]]*)\]/)
      columns[idx] = {
        index: idx, short: m[2].trim(),
        desc: rest.replace(/\s*\[[^\]]*\].*$/, '').trim(),
        units: um ? um[1].trim() : '',
      }
    } else if ((m = line.match(/^#\s*bad_flag\s*=\s*(\S+)/))) {
      meta.badFlag = parseFloat(m[1])
    } else if ((m = line.match(/^#\s*start_time\s*=\s*([^[]+)/))) {
      meta.startTime = m[1].trim()
    } else if ((m = line.match(/^#\s*nvalues\s*=\s*(\d+)/))) {
      meta.nvalues = +m[1]
    } else if ((m = line.match(/^#\s*interval\s*=\s*(.*)$/))) {
      meta.interval = m[1].trim()
    } else if ((m = line.match(/^#\s*(datcnv|filter|alignctd|celltm|loopedit|derive|binavg|wildedit|window)_date/i))) {
      meta.processing.push(m[1].toLowerCase())
    } else if ((m = line.match(/^\*\s*NMEA Latitude\s*=\s*(\d+)\s+([\d.]+)\s*([NS])/i))) {
      meta.lat = (+m[1] + (+m[2]) / 60) * (m[3].toUpperCase() === 'S' ? -1 : 1)
    } else if ((m = line.match(/^\*\s*NMEA Longitude\s*=\s*(\d+)\s+([\d.]+)\s*([EW])/i))) {
      meta.lon = (+m[1] + (+m[2]) / 60) * (m[3].toUpperCase() === 'W' ? -1 : 1)
    } else if (!meta.instrument && (m = line.match(/^\*\s*(Sea-?Bird\s+SBE[^\r\n]*?)\s*Data File/i))) {
      meta.instrument = m[1].trim()
    }
  }
  if (dataStart < 0) throw new Error(`${filename}: no *END* marker, not a .cnv file`)
  if (!columns.length) throw new Error(`${filename}: no "# name" lines in the header`)

  const ncol = columns.length
  const rows: number[][] = columns.map(() => [])
  const bad = meta.badFlag
  const tol = Math.abs(bad) * 1e-6
  for (let i = dataStart; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t) continue
    let parts = t.split(/\s+/)
    // Sea-Bird writes 11-character fields; a wide negative number can run into
    // its neighbour with no space between, so fall back to fixed-width slicing.
    if (parts.length !== ncol) {
      const raw = lines[i].replace(/\r$/, '')
      if (raw.length >= ncol * 11 - 1) {
        const fixed: string[] = []
        for (let c = 0; c < ncol; c++) fixed.push(raw.slice(c * 11, c * 11 + 11).trim())
        if (fixed.every(f => f !== '' && !Number.isNaN(parseFloat(f)))) parts = fixed
      }
    }
    if (parts.length !== ncol) continue
    for (let c = 0; c < ncol; c++) {
      let v = parseFloat(parts[c])
      if (Number.isNaN(v) || Math.abs(v - bad) <= tol) v = NaN
      rows[c].push(v)
    }
  }
  const data = rows.map(r => Float64Array.from(r))
  return { columns, data, nrows: data[0].length, meta }
}

// "Station_1.cnv" -> "Station 1"; a " (1)" left by a re-upload is dropped.
export function stationName(filename: string): string {
  return filename.replace(/\.cnv$/i, '').replace(/ \(\d+\)$/, '').replace(/[_-]+/g, ' ').trim()
}

// Natural sort key so Station 2 comes before Station 10.
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

// Canonical variables and the Sea-Bird short names that can carry them, in
// priority order (lower-cased for matching). Units come from the channel.
export const VARIABLES: { name: string; shorts: string[]; on: boolean }[] = [
  { name: 'Temperature', shorts: ['tv290c', 't090c', 't190c', 'tv190c', 't068c', 't168c', 't090', 't190'], on: true },
  { name: 'Salinity', shorts: ['sal00', 'sal11'], on: true },
  { name: 'Density (sigma-t)', shorts: ['sigma-t00', 'sigma-t11', 'sigma-e00', 'sigma-é00', 'sigma-θ00'], on: true },
  { name: 'Dissolved Oxygen', shorts: ['sbeox0mg/l', 'sbeox1mg/l', 'sbeox0ml/l', 'sbeox1ml/l', 'oxml/l', 'sbeox0mm/kg', 'sbeox1mm/kg', 'sbeox0ps', 'sbeox1ps'], on: true },
  { name: 'Fluorescence', shorts: ['fleco-afl', 'flecoafl', 'flcuva', 'flsp', 'flc', 'wetstar'], on: true },
  { name: 'Beam Transmission', shorts: ['cstartr0', 'cstartr1', 'xmiss'], on: true },
  { name: 'Turbidity', shorts: ['turbwetntu0', 'turbwetntu1', 'obs', 'seaturbmtr'], on: true },
  { name: 'pH', shorts: ['ph'], on: true },
  { name: 'PAR', shorts: ['par'], on: false },
  { name: 'CDOM', shorts: ['wetcdom'], on: false },
]
export const DEPTH_CANDIDATES: { short: string; label: string }[] = [
  { short: 'depsm', label: 'Depth (m)' }, { short: 'depfm', label: 'Depth (m)' },
  { short: 'prdm', label: 'Pressure (db)' }, { short: 'prsm', label: 'Pressure (db)' }, { short: 'pr', label: 'Pressure (db)' },
]

export function findColumn(cast: Cast, shorts: string[]): Column | null {
  for (const s of shorts) {
    const col = cast.columns.find(c => c.short.toLowerCase() === s)
    if (col) return col
  }
  return null
}

export function depthColumn(cast: Cast): { col: Column; label: string } | null {
  for (const d of DEPTH_CANDIDATES) {
    const col = findColumn(cast, [d.short])
    if (col) return { col, label: d.label }
  }
  return null
}

export interface VariableInfo { name: string; units: string; shorts: string[]; on: boolean }

// Variables present in at least one of the casts. The short names are
// reordered so a channel that every cast carries comes first: two instruments
// may both log oxygen in mL/L while one also logs mg/L, and picking the shared
// channel keeps a graph in one unit. Units come from the first cast with the
// winning channel; a mismatch that remains is reported per station by the
// profile and section builders.
export function availableVariables(casts: Cast[]): VariableInfo[] {
  const out: VariableInfo[] = []
  for (const v of VARIABLES) {
    const count = (s: string) => casts.filter(c => c.columns.some(col => col.short.toLowerCase() === s)).length
    const present = v.shorts.map((s, i) => ({ s, i, n: count(s) })).filter(e => e.n > 0).sort((a, b) => b.n - a.n || a.i - b.i).map(e => e.s)
    if (!present.length) continue
    const shorts = [...present, ...v.shorts.filter(s => !present.includes(s))]
    const col = casts.map(c => findColumn(c, shorts)).find(c => c)!
    out.push({ name: v.name, units: col.units, shorts, on: v.on })
  }
  return out
}

// Units of the channel each cast would use for a variable, for spotting a
// graph that mixes mg/L with mL/L or depth with pressure.
export function unitsByStation(casts: { name: string; cast: Cast }[], shorts: string[]): { name: string; units: string }[] {
  return casts.map(s => ({ name: s.name, units: findColumn(s.cast, shorts)?.units ?? '' }))
}

// One line naming the odd ones out, or null when every station agrees.
export function unitMismatch(list: { name: string; units: string }[], what: string): string | null {
  const norm = canonicalUnit
  const used = list.filter(s => s.units)
  const distinct = [...new Set(used.map(s => norm(s.units)))]
  if (distinct.length < 2) return null
  const groups = distinct.map(u => `${used.filter(s => norm(s.units) === u).map(s => s.name).join(', ')} in ${used.find(s => norm(s.units) === u)!.units}`)
  return `${what} units differ and are not converted: ${groups.join('; ')}`
}

export interface Profile { z: number[]; v: number[]; units: string; channel: string; depthLabel: string }

// Depth and value pairs for one variable in one cast, sorted by depth, NaNs
// dropped. Returns null when the cast lacks the variable or a depth channel.
export function profile(cast: Cast, shorts: string[]): Profile | null {
  const d = depthColumn(cast)
  const col = findColumn(cast, shorts)
  if (!d || !col) return null
  const z = cast.data[d.col.index], v = cast.data[col.index]
  const pts: [number, number][] = []
  for (let i = 0; i < z.length; i++) if (Number.isFinite(z[i]) && Number.isFinite(v[i])) pts.push([z[i], v[i]])
  pts.sort((a, b) => a[0] - b[0])
  return { z: pts.map(p => p[0]), v: pts.map(p => p[1]), units: col.units, channel: col.short, depthLabel: d.label }
}

// Keep the downcast only: cut at the deepest reading, then keep samples that
// go monotonically deeper. A display fix for raw casts, not Sea-Bird
// processing, and only applied when the header shows no loopedit step. A
// record that is not a cast at all (a moored instrument logging at one depth)
// would be gutted by this, so it is left alone when the cut would keep under
// a fifth of the rows; `timeSeries` says so.
export function downcastOnly(cast: Cast): { cast: Cast; dropped: number; timeSeries?: boolean } {
  const d = depthColumn(cast)
  if (!d) return { cast, dropped: 0 }
  const z = cast.data[d.col.index]
  let deepest = 0
  for (let i = 1; i < z.length; i++) if (z[i] > z[deepest]) deepest = i
  const keep: number[] = []
  let running = -Infinity
  for (let i = 0; i <= deepest; i++) {
    if (Number.isFinite(z[i]) && z[i] >= running) { keep.push(i); running = z[i] }
  }
  if (keep.length === cast.nrows) return { cast, dropped: 0 }
  if (cast.nrows >= 50 && keep.length < cast.nrows * 0.2) return { cast, dropped: 0, timeSeries: true }
  const data = cast.data.map(col => Float64Array.from(keep.map(i => col[i])))
  return { cast: { ...cast, data, nrows: keep.length }, dropped: cast.nrows - keep.length }
}

// Some deck units append position to every scan: latitude/longitude columns.
// Their median is a fair cast position when the header has none.
export function positionFromColumns(cast: Cast): [number, number] | null {
  const find = (re: RegExp) => cast.columns.find(c => re.test(c.short) || re.test(c.desc))
  const la = find(/^lat/i), lo = find(/^lon/i)
  if (!la || !lo) return null
  const median = (arr: Float64Array) => {
    const v = Array.from(arr).filter(Number.isFinite).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : NaN
  }
  const lat = median(cast.data[la.index]), lon = median(cast.data[lo.index])
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || (lat === 0 && lon === 0)) return null
  return [lat, lon]
}

export function deepest(cast: Cast): number | null {
  const d = depthColumn(cast)
  if (!d) return null
  let m = -Infinity
  for (const v of cast.data[d.col.index]) if (Number.isFinite(v) && v > m) m = v
  return Number.isFinite(m) ? m : null
}
