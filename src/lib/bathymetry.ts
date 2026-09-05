// Seafloor depth along the routed line, read from public bathymetry services
// straight from the browser (both send CORS headers, so no server of our own
// is needed). GEBCO's own services cannot be read this way: its WMS answers no
// point queries, its WCS lists no coverages, and the ERDDAP mirrors of the
// GEBCO grid send no CORS header. NOAA's DEM mosaic carries ETOPO 2022, which
// is built on GEBCO in deep water, under much finer coastal DEMs.
import { haversineKm } from './geo'
import type { SeafloorSource } from '../store'

export interface PathPoint { x: number; lat: number; lon: number }
export interface SeafloorSample { x: number; lat: number; lon: number; elevation: number | null }   // m above sea level, negative under water; null = no data
export interface SeafloorResult { source: SeafloorSource; samples: SeafloorSample[]; detail: string; credit: string }

export const SOURCES: Record<Exclude<SeafloorSource, 'casts'>, { name: string; short: string; credit: string; url: string }> = {
  ncei: {
    name: 'NOAA NCEI DEMs', short: 'NOAA DEM',
    credit: 'NOAA National Centers for Environmental Information DEM mosaic (coastal DEMs to 1/9 arc-second; ETOPO 2022 at 15 arc-second elsewhere)',
    url: 'https://www.ncei.noaa.gov/products/seafloor-mapping',
  },
  emodnet: {
    name: 'EMODnet (Europe)', short: 'EMODnet',
    credit: 'EMODnet Bathymetry Consortium, DTM 2024 (1/16 arc-minute, European seas)',
    url: 'https://emodnet.ec.europa.eu/en/bathymetry',
  },
}

// Sample points every ~step km along the path, every vertex included.
export function samplePoints(path: PathPoint[], max = 400): PathPoint[] {
  if (path.length < 2) return path
  const x0 = path[0].x, x1 = path[path.length - 1].x
  const step = Math.max((x1 - x0) / (max - 1), 0.02)
  const targets = new Set<number>(path.map(p => +p.x.toFixed(6)))
  for (let x = x0 + step; x < x1; x += step) targets.add(+x.toFixed(6))
  const xs = [...targets].sort((a, b) => a - b)
  let k = 0
  return xs.map(x => {
    while (k < path.length - 2 && path[k + 1].x < x) k++
    const a = path[k], b = path[k + 1]
    const t = b.x > a.x ? Math.min(Math.max((x - a.x) / (b.x - a.x), 0), 1) : 0
    return { x, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }
  })
}

export function routeKey(path: PathPoint[], source: SeafloorSource): string {
  return source + '|' + path.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';')
}

const cache = new Map<string, Promise<SeafloorResult>>()

// Drop a remembered answer so the next fetch asks the service again.
export function forgetSeafloor(path: PathPoint[], source: SeafloorSource): void {
  cache.delete(routeKey(path, source))
}

export function fetchSeafloor(path: PathPoint[], source: SeafloorSource, signal?: AbortSignal): Promise<SeafloorResult> {
  if (source === 'casts') return Promise.reject(new Error('no source chosen'))
  const key = routeKey(path, source)
  let p = cache.get(key)
  if (!p) {
    const pts = samplePoints(path)
    p = (source === 'ncei' ? fromNcei(pts, signal) : fromEmodnet(pts, signal))
      .then(samples => ({ source, samples, detail: describe(source, samples), credit: SOURCES[source].credit }))
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

// fetch and parse with one deadline over headers and body; a service that
// hangs should not hang the page
async function getJson<T>(url: string, init: RequestInit, signal: AbortSignal | undefined, ms = 40000): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    if (!res.ok) throw new Error(`the service answered ${res.status}`)
    return await res.json() as T
  } catch (e) {
    if ((e as Error).name === 'AbortError' && !signal?.aborted) throw new Error('the service did not answer in time')
    throw e
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
}

// ---- NOAA NCEI: the DEM mosaic ImageServer samples a list of points in one call
const NCEI = 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/getSamples'
interface ArcSample { locationId: number; value: string; resolution?: number }
const resolution = new WeakMap<SeafloorSample, number>()

async function fromNcei(pts: PathPoint[], signal?: AbortSignal): Promise<SeafloorSample[]> {
  const out: SeafloorSample[] = pts.map(p => ({ x: p.x, lat: p.lat, lon: p.lon, elevation: null }))
  const chunk = 500        // the service takes up to 1000 points a call; one call covers a whole line
  for (let start = 0; start < pts.length; start += chunk) {
    const part = pts.slice(start, start + chunk)
    const body = new URLSearchParams({
      geometry: JSON.stringify({ points: part.map(p => [+p.lon.toFixed(6), +p.lat.toFixed(6)]), spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', f: 'json',
    })
    const json = await getJson<{ samples?: ArcSample[]; error?: { message?: string } }>(NCEI, { method: 'POST', body }, signal)
    if (json.error) throw new Error(json.error.message || 'the service reported an error')
    for (const s of json.samples ?? []) {
      const v = parseFloat(s.value)
      const target = out[start + s.locationId]
      if (!target || !Number.isFinite(v)) continue
      target.elevation = v
      if (s.resolution) resolution.set(target, s.resolution)
    }
  }
  return out
}

// ---- EMODnet: an ERDDAP grid subset over the line's bounding box, sampled bilinearly
const EMODNET = 'https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024.json'
const EMODNET_CELL = 1 / 960          // 1/16 arc-minute in degrees
const EMODNET_BOX = { lat: [15.0006, 89.9994], lon: [-35.9994, 42.9994] }

async function fromEmodnet(pts: PathPoint[], signal?: AbortSignal): Promise<SeafloorSample[]> {
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon)
  // the stride keeps the subset to about 200 cells a side; the box is then
  // padded by more than a strided cell so every sample has grid on both sides
  // even where ERDDAP stops the strided sequence short of the end
  const cells = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons)) / EMODNET_CELL
  const stride = Math.max(1, Math.ceil(cells / 200))
  const pad = (stride + 2) * EMODNET_CELL
  const lat0 = Math.min(...lats) - pad, lat1 = Math.max(...lats) + pad, lon0 = Math.min(...lons) - pad, lon1 = Math.max(...lons) + pad
  if (lat0 < EMODNET_BOX.lat[0] || lat1 > EMODNET_BOX.lat[1] || lon0 < EMODNET_BOX.lon[0] || lon1 > EMODNET_BOX.lon[1])
    throw new Error('the line is outside EMODnet (European seas, 15 N to 90 N, 36 W to 43 E)')
  const q = `elevation[(${lat0.toFixed(5)}):${stride}:(${lat1.toFixed(5)})][(${lon0.toFixed(5)}):${stride}:(${lon1.toFixed(5)})]`
  const json = await getJson<{ table: { rows: [number, number, number | null][] } }>(`${EMODNET}?${encodeURIComponent(q)}`, {}, signal)
  const rows = json.table.rows
  if (!rows.length) throw new Error('EMODnet returned no cells here')
  const latVals = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b)
  const lonVals = [...new Set(rows.map(r => r[1]))].sort((a, b) => a - b)
  const li = new Map(latVals.map((v, i) => [v, i])), lo = new Map(lonVals.map((v, i) => [v, i]))
  const grid: (number | null)[][] = latVals.map(() => lonVals.map(() => null))
  for (const [la, ln, v] of rows) grid[li.get(la)!][lo.get(ln)!] = v === null || !Number.isFinite(v) ? null : v
  const n = latVals.length, m = lonVals.length
  const dlat = n > 1 ? (latVals[n - 1] - latVals[0]) / (n - 1) : EMODNET_CELL * stride
  const dlon = m > 1 ? (lonVals[m - 1] - lonVals[0]) / (m - 1) : EMODNET_CELL * stride
  const at = (i: number, j: number) => (i >= 0 && i < n && j >= 0 && j < m ? grid[i][j] : null)
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi)
  const samples = pts.map(p => {
    const fi = (p.lat - latVals[0]) / dlat, fj = (p.lon - lonVals[0]) / dlon
    const i0 = clamp(Math.floor(fi), Math.max(n - 2, 0)), j0 = clamp(Math.floor(fj), Math.max(m - 2, 0))
    const ti = clamp(fi - i0, 1), tj = clamp(fj - j0, 1)
    const c = [at(i0, j0), at(i0, j0 + 1), at(i0 + 1, j0), at(i0 + 1, j0 + 1)]
    let elevation: number | null
    if (c.every(v => v !== null)) {
      const [a, b, cc, d] = c as number[]
      elevation = a * (1 - ti) * (1 - tj) + b * (1 - ti) * tj + cc * ti * (1 - tj) + d * ti * tj
    } else elevation = at(clamp(Math.round(fi), n - 1), clamp(Math.round(fj), m - 1))     // a land or edge cell nearby: nearest cell, or nothing
    const s: SeafloorSample = { x: p.x, lat: p.lat, lon: p.lon, elevation }
    resolution.set(s, EMODNET_CELL * stride)
    return s
  })
  return samples
}

function describe(source: SeafloorSource, samples: SeafloorSample[]): string {
  const got = samples.filter(s => s.elevation !== null)
  const res = got.map(s => resolution.get(s)).filter((r): r is number => r !== undefined)
  const finest = res.length ? Math.min(...res) * 3600 : null
  const cell = finest === null ? '' : finest < 0.2 ? `${Math.round(finest * 30)} m` : finest < 2 ? `${finest.toFixed(1)} arc-second (about ${Math.round(finest * 30)} m)` : `${Math.round(finest)} arc-second (about ${Math.round(finest * 30)} m)`
  const kind = source === 'ncei' ? (finest !== null && finest >= 10 ? ', ETOPO 2022 here' : '') : ''
  return `${got.length} of ${samples.length} samples${cell ? `, cells down to ${cell}` : ''}${kind}`
}

// Distance of a point from a path vertex, for callers that report where samples lie.
export function nearestVertexKm(p: { lat: number; lon: number }, path: PathPoint[]): number {
  return Math.min(...path.map(v => haversineKm(v.lat, v.lon, p.lat, p.lon)))
}
