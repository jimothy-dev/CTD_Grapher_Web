// Distances and coordinate parsing.

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088, r = Math.PI / 180
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Cumulative distance along a list of positions, in km.
export function alongTrack(points: { lat: number; lon: number }[]): number[] {
  const x = [0]
  for (let i = 1; i < points.length; i++)
    x.push(x[i - 1] + haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon))
  return x
}

// Where a point falls along the straight line from a to b, as a fraction
// (0 at a, 1 at b), measured in a flat local frame. Used to keep waypoints
// in the order they lie along their segment.
export function fractionAlong(a: { lat: number; lon: number }, b: { lat: number; lon: number }, p: { lat: number; lon: number }): number {
  const k = Math.cos((a.lat * Math.PI) / 180)
  const bx = (b.lon - a.lon) * k, by = b.lat - a.lat
  const px = (p.lon - a.lon) * k, py = p.lat - a.lat
  const d2 = bx * bx + by * by
  return d2 ? (px * bx + py * by) / d2 : 0
}

// Any usual coordinate format:
//   47.4012 · -122.53 · 47 24.072 · 47°24'04.3" · 4724.072 (ddmm.mmm, GPS style)
//   with an optional N/S/E/W letter anywhere. Returns decimal degrees or null.
export function parseCoordinate(text: string, kind: 'lat' | 'lon'): number | null {
  let s = text.trim().toUpperCase()
  if (!s) return null
  let sign = 1
  const hemi = s.match(/[NSEW]/)
  if (hemi) {
    if (hemi[0] === 'S' || hemi[0] === 'W') sign = -1
    s = s.replace(/[NSEW]/g, ' ')
  }
  if (/^\s*-/.test(s)) { sign *= -1 }
  s = s.replace(/[-+]/g, ' ').replace(/[°º'′"″]/g, ' ').replace(/,/g, ' ').trim()
  const parts = s.split(/\s+/).map(Number)
  if (parts.some(Number.isNaN) || !parts.length) return null
  let deg: number
  const max = kind === 'lat' ? 90 : 180
  if (parts.length === 1) {
    const v = parts[0]
    // ddmm.mmm: more than the degree limit, or the GPS habit of 4 or 5 digits before the point
    const intPart = Math.floor(Math.abs(v))
    if (Math.abs(v) > max || (kind === 'lat' && intPart >= 1000) || (kind === 'lon' && intPart >= 10000)) {
      const d = Math.floor(intPart / 100)
      const m = Math.abs(v) - d * 100
      if (m >= 60) return null
      deg = d + m / 60
    } else deg = Math.abs(v)
  } else if (parts.length === 2) {
    if (parts[1] >= 60) return null
    deg = Math.abs(parts[0]) + parts[1] / 60
  } else {
    if (parts[1] >= 60 || parts[2] >= 60) return null
    deg = Math.abs(parts[0]) + parts[1] / 60 + parts[2] / 3600
  }
  if (deg > max) return null
  return sign * deg
}

export function formatCoordinate(v: number | null, kind: 'lat' | 'lon'): string {
  if (v === null || !Number.isFinite(v)) return ''
  const hemi = kind === 'lat' ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E')
  const a = Math.abs(v)
  const d = Math.floor(a), m = (a - d) * 60
  return `${d}° ${m.toFixed(3)}' ${hemi}`
}
