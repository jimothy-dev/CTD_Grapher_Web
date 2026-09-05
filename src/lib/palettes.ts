// Colour palette files a user can upload for the sections.
//   .clr  Golden Software Surfer colour map (positions 0-100, R G B [A]);
//         an ESRI .clr is "index r g b" lines and is read as a value list
//   .lvl  Surfer level file: contour levels with fill colours (LVL2/LVL3) or
//         levels only (LVL1); the levels are real values and set the range
//   .cpt  GMT colour palette table (z0 colour z1 colour ..., B/F/N lines)
//   .pal  Ocean Data View palette (indexed colour components) or an ncWMS
//         palette (one hex colour per line)
//   .spk  Ferret spectrum: "setpoint r g b" with colours 0-100, and a
//         RGB_Mapping header saying whether set points are percentages,
//         real values or level indices
//   .rgb  NCL colour table: "r g b" per line, evenly spaced
//   .cpd  SNAP / SeaDAS colour palette definition (colorN=, sampleN=)
//   .ggr  GIMP gradient
//   .json ParaView / VTK colour map presets (RGBPoints)
//   .xml  QGIS style colour ramp
//   .txt/.csv/.rules  "value r g b [a]" lines as QGIS, GRASS and GDAL write
//         them; values are real like .lvl, or percentages
// A palette whose values are real (levels) also sets the colour range, so it
// belongs to one variable; a position-only palette can colour every section.
import { parseClr, type Clr, type ColorStops } from './colors'
import { SURFER_NAMED } from './surferColors'

export const PALETTE_EXTENSIONS = ['.clr', '.lvl', '.cpt', '.pal', '.spk', '.rgb', '.cpd', '.ggr', '.json', '.xml', '.txt', '.csv', '.rules']

type Reader = (text: string) => Clr
const BY_EXT: Record<string, Reader[]> = {
  '.clr': [parseClr, parseValueRgb], '.lvl': [parseLvl], '.cpt': [parseCpt], '.pal': [parseOdvPal, parseRgbList, parseValueRgb],
  '.spk': [parseSpk], '.rgb': [parseRgbList, parseValueRgb], '.cpd': [parseCpd], '.ggr': [parseGgr], '.json': [parseParaview], '.xml': [parseQgisXml, parseParaviewXml],
  '.txt': [parseValueRgb, parseCpt, parseRgbList], '.csv': [parseValueRgb], '.rules': [parseValueRgb],
}

export function parsePalette(text: string, filename: string): Clr {
  const ext = (filename.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
  const head = text.slice(0, 300)
  const readers: Reader[] = []
  if (/^\s*ColorMap/i.test(head)) readers.push(parseClr)
  if (/^\s*LVL[123]\b/im.test(head)) readers.push(parseLvl)
  if (/COLOR_MODEL/i.test(head)) readers.push(parseCpt)
  if (/^\s*GIMP Gradient/.test(head)) readers.push(parseGgr)
  if (/numPoints\s*=/.test(head)) readers.push(parseCpd)
  if (/^\s*RGB_Mapping/i.test(head)) readers.push(parseSpk)
  if (/^\s*[[{]/.test(head)) readers.push(parseParaview)
  if (/<colorramp/i.test(text)) readers.push(parseQgisXml)
  if (/<ColorMap\b/.test(text)) readers.push(parseParaviewXml)
  readers.push(...(BY_EXT[ext] ?? []), parseValueRgb, parseCpt, parseRgbList)
  const errors: string[] = []
  for (const r of [...new Set(readers)]) {
    try { return r(text) } catch (e) { errors.push((e as Error).message) }
  }
  throw new Error(`${filename}: not a palette this app reads (${PALETTE_EXTENSIONS.join(', ')}). ${errors[0]}`)
}

// Colour names: Surfer's table first, then the usual web and GRASS names.
const NAMED: Record<string, string> = {
  ...SURFER_NAMED,
  grey: '#808080', gray: '#808080', lightgray: '#c0c0c0', lightgrey: '#c0c0c0', darkgray: '#404040', darkgrey: '#404040',
  navy: '#000080', olive: '#808000', teal: '#008080', maroon: '#800000', aqua: '#00ffff', lime: '#00ff00', violet: '#ee82ee',
  indigo: '#4b0082', gold: '#ffd700', silver: '#c0c0c0', brown: '#a52a2a',
}
function namedColor(t: string): string | null {
  const k = t.toLowerCase().replace(/\s+/g, '')
  const gray = k.match(/^gr[ae]y(\d{1,3})$/)          // GMT's gray0..gray100
  if (gray) { const v = Math.round(Math.min(+gray[1], 100) * 2.55); return `rgb(${v},${v},${v})` }
  return NAMED[k] ?? null
}

// Surfer writes colours as a quoted name or "Rxxx Gyyy Bzzz [Aaaa]".
function surferColor(token: string): string | null {
  const t = token.trim().replace(/^"|"$/g, '').trim()
  const m = t.match(/R\s*(\d+)\s+G\s*(\d+)\s+B\s*(\d+)(?:\s+A\s*(\d+))?/i)
  if (m) return m[4] !== undefined ? `rgba(${m[1]},${m[2]},${m[3]},${(+m[4] / 255).toFixed(3)})` : `rgb(${m[1]},${m[2]},${m[3]})`
  return namedColor(t)
}

function fromLevels(levels: number[], colours: string[], warnings: string[], note: string): Clr {
  if (levels.length < 2) throw new Error(`${note}: fewer than two levels`)
  const lo = levels[0], hi = levels[levels.length - 1]
  if (!(hi > lo)) throw new Error(`${note}: levels must increase`)
  const stops: ColorStops = colours.length ? levels.map((v, i) => [(v - lo) / (hi - lo), colours[i]]) : []
  // GMT's master tables, ParaView presets and some QGIS exports are written
  // normalised, 0 to 1 (or -1 to 1 with a hinge); those numbers are positions,
  // not data values, so they colour the section without setting its range
  if ((lo === 0 || lo === -1) && hi === 1) {
    if (!stops.length) throw new Error(`${note}: normalised levels without colours carry nothing`)
    return { version: 1, interp: 0, stops: dedupe(stops), warnings: [`${note}: normalised ${lo} to 1, so the colours spread over the section's own range`] }
  }
  return { version: 1, interp: 0, stops, warnings, levels }
}
function fromPositions(stops: ColorStops, note: string): Clr {
  if (stops.length < 2) throw new Error(`${note}: fewer than two colours`)
  stops.sort((a, b) => a[0] - b[0])
  return { version: 1, interp: 0, stops: dedupe(stops), warnings: [note] }
}
const rangeNote = (kind: string, n: number, lo: number, hi: number) => `${kind}, ${n} levels; colour range set to ${lo} to ${hi}`

// Surfer .lvl: bare numbers are levels only; LVL2 gives Level, Flags, LColor,
// LStyle, LWidth, FFGColor, FBGColor, FPattern, FMode; LVL3 adds pattern
// placement. Fields are separated by commas or whitespace, and a single
// quote starts a comment unless it is inside quotes.
export function parseLvl(text: string): Clr {
  let fmt = 'LVL1'
  const levels: number[] = [], colours: (string | null)[] = []
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim()
    if (!s) continue
    if (/^LVL[23]$/i.test(s)) { fmt = s.toUpperCase(); continue }
    const quoted = [...s.matchAll(/"([^"]*)"/g)].map(m => m[1])
    let stripped = s.replace(/"[^"]*"/g, '""')
    if (stripped.startsWith("'")) continue
    stripped = stripped.split("'")[0]
    const nums = stripped.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)
    if (!nums) continue
    levels.push(parseFloat(nums[0]))
    colours.push(fmt !== 'LVL1' && quoted.length >= 3 ? surferColor(quoted[2]) : quoted.length ? surferColor(quoted[0]) : null)
  }
  if (levels.length < 2) throw new Error('.lvl: fewer than two levels found')
  const withColours = colours.every(c => c)
  const lo = levels[0], hi = levels[levels.length - 1]
  const note = withColours ? rangeNote(`${fmt} with fill colours`, levels.length, lo, hi) : `${fmt}, ${levels.length} levels without colours; colour range set to ${lo} to ${hi}, colours stay the default`
  return fromLevels(levels, withColours ? (colours as string[]) : [], [note], '.lvl')
}

// GMT .cpt: "z0 colour z1 colour [A|U|L]" lines, colour as r/g/b, r g b,
// #rrggbb, a gray value, h-s-v (with COLOR_MODEL = HSV) or a name; B, F, N
// lines give background, foreground and NaN colours and are ignored here.
export function parseCpt(text: string): Clr {
  const hsv = /COLOR_MODEL\s*=\s*\+?HSV/i.test(text)
  const segs: { z0: number; c0: string; z1: number; c1: string }[] = []
  const color = (tok: string[], i: number): [string, number] => {
    const t = tok[i]
    if (t === undefined) throw new Error('.cpt: line too short')
    if (/^#[0-9a-f]{6}$/i.test(t)) return [t, 1]
    if (/^[\d.]+\/[\d.]+\/[\d.]+$/.test(t)) { const [a, b, c] = t.split('/').map(Number); return [hsv ? hsvToRgb(a, b, c) : `rgb(${a},${b},${c})`, 1] }
    if (/^[\d.]+-[\d.]+-[\d.]+$/.test(t)) { const [h, s, v] = t.split('-').map(Number); return [hsvToRgb(h, s, v), 1] }
    if (/^\d+$/.test(t) && /^\d+$/.test(tok[i + 1] ?? '') && /^\d+$/.test(tok[i + 2] ?? '')) return [`rgb(${t},${tok[i + 1]},${tok[i + 2]})`, 3]
    if (/^\d+(\.\d+)?$/.test(t)) return [`rgb(${t},${t},${t})`, 1]           // gray
    const n = namedColor(t)
    if (n) return [n, 1]
    throw new Error(`.cpt: cannot read colour "${t}"`)
  }
  for (const raw of text.split(/\r?\n/)) {
    const s = stripComment(raw)
    if (!s || /^[BFN]\b/i.test(s)) continue
    const tok = s.split(/\s+/)
    if (tok.length < 4 || Number.isNaN(parseFloat(tok[0]))) continue
    const z0 = parseFloat(tok[0])
    const [c0, n0] = color(tok, 1)
    const z1 = parseFloat(tok[1 + n0])
    if (Number.isNaN(z1)) continue
    const [c1] = color(tok, 2 + n0)
    segs.push({ z0, c0, z1, c1 })
  }
  if (segs.length < 1) throw new Error('.cpt: no colour segments found')
  segs.sort((a, b) => a.z0 - b.z0)
  const lo = segs[0].z0, hi = segs[segs.length - 1].z1
  if (!(hi > lo)) throw new Error('.cpt: z values must increase')
  const stops: ColorStops = []
  for (const g of segs) {
    const p0 = (g.z0 - lo) / (hi - lo), p1 = (g.z1 - lo) / (hi - lo)
    stops.push([p0, g.c0])
    // an HSV table blends through the hue circle, which a straight RGB blend
    // between the two end colours would miss; sample the segment instead
    if (hsv && g.c0 !== g.c1) for (let k = 1; k < 12; k++) stops.push([p0 + (p1 - p0) * k / 12, blendHsv(g.c0, g.c1, k / 12)])
    stops.push([p1, g.c1])
  }
  // GMT's master tables are normalised 0 to 1 (or -1 to 1 around a hinge): positions, not data values
  if ((lo === 0 || lo === -1) && hi === 1) return { version: 1, interp: 0, stops: dedupe(stops), warnings: [`.cpt normalised ${lo} to 1, so the colours spread over the section's own range`] }
  return { version: 1, interp: 0, stops: dedupe(stops), warnings: [rangeNote('.cpt', segs.length + 1, lo, hi)], levels: [lo, hi] }
}

function toRgb(c: string): [number, number, number] {
  const hex = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)]
  const m = c.match(/rgba?\(([^)]+)\)/)
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2]] }
  return [0, 0, 0]
}
function blendHsv(a: string, b: string, t: number): string {
  const toHsv = ([r, g, bl]: [number, number, number]) => {
    r /= 255; g /= 255; bl /= 255
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl), d = max - min
    let h = 0
    if (d) h = max === r ? ((g - bl) / d) % 6 : max === g ? (bl - r) / d + 2 : (r - g) / d + 4
    h = (h * 60 + 360) % 360
    return [h, max ? d / max : 0, max]
  }
  const [h0, s0, v0] = toHsv(toRgb(a)), [h1, s1, v1] = toHsv(toRgb(b))
  return hsvToRgb(h0 + (h1 - h0) * t, s0 + (s1 - s0) * t, v0 + (v1 - v0) * t)
}

// "value r g b [a]" or "value,r,g,b[,a][,label]" per line; headers, nv,
// default and end lines skipped; r:g:b, hex and colour names accepted;
// "10%" values make a position palette instead of a range.
export function parseValueRgb(text: string): Clr {
  const vals: number[] = [], colours: string[] = []
  let percent = 0, plain = 0
  for (const raw of text.split(/\r?\n/)) {
    const s = stripComment(raw)
    if (!s || /^(nv|default|end|INTERPOLATION)\b/i.test(s)) continue
    const p = s.split(/[\s,;:]+/)
    if (p.length < 2) continue
    const isPct = /%$/.test(p[0])
    const v = parseFloat(p[0])
    if (Number.isNaN(v)) continue
    let col: string | null = null
    if (p.length >= 4 && ![+p[1], +p[2], +p[3]].some(Number.isNaN)) {
      const a = p.length > 4 && p[4] !== '' && !Number.isNaN(+p[4]) ? +p[4] : 255
      col = `rgba(${p[1]},${p[2]},${p[3]},${(a > 1 ? a / 255 : a).toFixed(3)})`
    } else if (/^#[0-9a-f]{6}$/i.test(p[1])) col = p[1]
    else col = namedColor(p[1])
    if (!col) continue
    vals.push(v); colours.push(col); if (isPct) percent++; else plain++
  }
  if (vals.length < 2) throw new Error('Not a palette this app reads: expected lines of "value r g b"')
  const order = vals.map((_, i) => i).sort((i, j) => vals[i] - vals[j])
  const v = order.map(i => vals[i]), c = order.map(i => colours[i])
  if (percent && !plain) return fromPositions(v.map((x, i) => [Math.min(Math.max(x / 100, 0), 1), c[i]]), `${v.length} colours at percentages`)
  return fromLevels(v, c, [rangeNote('value list', v.length, v[0], v[v.length - 1])], 'palette')
}

// Ferret .spk: "setpoint r g b" with colours 0-100. RGB_Mapping Percent
// (default) makes set points positions; By_value makes them real values;
// By_level makes them level indices, taken as evenly spaced.
export function parseSpk(text: string): Clr {
  const mode = (text.match(/RGB_Mapping\s+(Percent|By_value|By_level)/i)?.[1] ?? 'Percent').toLowerCase()
  const pts: [number, string][] = []
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.split('!')[0].trim()
    if (!s || /RGB_Mapping/i.test(s)) continue
    const p = s.split(/\s+/).map(Number)
    if (p.length < 4 || p.some(Number.isNaN)) continue
    pts.push([p[0], `rgb(${Math.round(p[1] * 2.55)},${Math.round(p[2] * 2.55)},${Math.round(p[3] * 2.55)})`])
  }
  if (pts.length < 2) throw new Error('.spk: no colour lines found')
  pts.sort((a, b) => a[0] - b[0])
  if (mode === 'by_value') return fromLevels(pts.map(p => p[0]), pts.map(p => p[1]), [rangeNote('.spk By_value', pts.length, pts[0][0], pts[pts.length - 1][0])], '.spk')
  if (mode === 'by_level') return fromPositions(pts.map((p, i) => [i / (pts.length - 1), p[1]]), `.spk By_level, ${pts.length} colours evenly spaced`)
  return fromPositions(pts.map(p => [Math.min(Math.max(p[0] / 100, 0), 1), p[1]]), `.spk, ${pts.length} colours`)
}

// Ocean Data View .pal: 177 lines of "index r g b" as fractions; indices
// 0-31 are the program's own interface colours and 32-144 are the ramp.
export function parseOdvPal(text: string): Clr {
  const rows: number[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const p = raw.trim().split(/[\s,]+/).map(Number)
    if ((p.length === 3 || p.length === 4) && !p.some(Number.isNaN)) rows.push(p)
  }
  if (rows.length < 8) throw new Error('.pal: too few colour rows')
  const indexed = rows.every(r => r.length === 4 && Number.isInteger(r[0]))
  const ramp = indexed && rows.length >= 145 ? rows.filter(r => r[0] >= 32 && r[0] <= 144).map(r => r.slice(1)) : rows.map(r => (r.length === 4 ? r.slice(1) : r))
  return rgbRows(ramp, `ODV .pal, ${ramp.length} colours`)
}

// NCL-style .rgb: "r g b" per line, optional "ncolors=" header, 0-255 or 0-1;
// also plain lists of one hex colour per line (ncWMS and the like).
export function parseRgbList(text: string): Clr {
  const rows: number[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const s = stripComment(raw.replace(/;.*$/, ''))
    if (!s || /=/.test(s)) continue
    const hex = s.match(/^#?([0-9a-f]{6})$/i)
    if (hex) { const h = hex[1]; rows.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]); continue }
    const p = s.split(/[\s,]+/).map(Number)
    if ((p.length === 3 || p.length === 4) && !p.some(Number.isNaN)) rows.push(p.slice(0, 3))
  }
  if (rows.length < 2) throw new Error('.rgb: expected "r g b" or hex lines')
  return rgbRows(rows, `${rows.length} colours, evenly spaced`)
}

// SNAP / SeaDAS .cpd: numPoints=N, colorI=r,g,b[,a], sampleI=value; with
// autoDistribute=true the samples are relative, otherwise real values.
export function parseCpd(text: string): Clr {
  const get = (k: string) => text.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+)$`, 'm'))?.[1].trim()
  const n = parseInt(get('numPoints') ?? '', 10)
  if (!(n > 1)) throw new Error('.cpd: numPoints missing')
  const colours: string[] = [], samples: number[] = []
  for (let i = 0; i < n; i++) {
    const c = (get(`color${i}`) ?? '').split(',').map(Number)
    const s = parseFloat(get(`sample${i}`) ?? '')
    if (c.length < 3 || c.some(Number.isNaN) || Number.isNaN(s)) throw new Error(`.cpd: point ${i} incomplete`)
    colours.push(`rgb(${c[0]},${c[1]},${c[2]})`); samples.push(s)
  }
  const relative = /autoDistribute\s*=\s*true/i.test(text)
  if (relative) {
    const lo = samples[0], hi = samples[n - 1]
    return fromPositions(samples.map((s, i) => [(s - lo) / (hi - lo || 1), colours[i]]), `.cpd, ${n} colours (auto-distributed)`)
  }
  return fromLevels(samples, colours, [rangeNote('.cpd', n, samples[0], samples[n - 1])], '.cpd')
}

// GIMP .ggr: "GIMP Gradient", "Name:", a count, then one segment per line:
// left mid right, left RGBA, right RGBA, blend, colouring, [endpoint types].
export function parseGgr(text: string): Clr {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!/^GIMP Gradient/.test(lines[0] ?? '')) throw new Error('.ggr: missing GIMP Gradient header')
  const stops: ColorStops = []
  for (const l of lines.slice(2)) {
    const p = l.split(/\s+/).map(Number)
    if (p.length < 11 || p.some(Number.isNaN)) continue
    const c = (r: number, g: number, b: number, a: number) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a.toFixed(3)})`
    stops.push([p[0], c(p[3], p[4], p[5], p[6])], [p[2], c(p[7], p[8], p[9], p[10])])
  }
  return fromPositions(stops, `.ggr, ${stops.length / 2} segments`)
}

// ParaView / VTK colour map JSON: [{ "Name", "RGBPoints": [x, r, g, b, ...] }]
// with r g b as 0-1; the x values are the preset's own units, taken as real.
export function parseParaview(text: string): Clr {
  let doc: unknown
  // ParaView's own ColorMaps.json carries trailing commas
  try { doc = JSON.parse(text.replace(/,(\s*[\]}])/g, '$1')) } catch { throw new Error('not JSON') }
  const maps = Array.isArray(doc) ? doc : [doc]
  const m = maps.find(x => x && typeof x === 'object' && Array.isArray((x as { RGBPoints?: unknown }).RGBPoints)) as { Name?: string; RGBPoints: number[] } | undefined
  if (!m) throw new Error('.json: no RGBPoints colour map found')
  const pts = m.RGBPoints
  const levels: number[] = [], colours: string[] = []
  for (let i = 0; i + 3 < pts.length; i += 4) { levels.push(pts[i]); colours.push(`rgb(${Math.round(pts[i + 1] * 255)},${Math.round(pts[i + 2] * 255)},${Math.round(pts[i + 3] * 255)})`) }
  return fromLevels(levels, colours, [rangeNote(`ParaView "${m.Name ?? 'colour map'}"`, levels.length, levels[0], levels[levels.length - 1])], '.json')
}

// Legacy ParaView ColorMaps.xml: <ColorMap name=...><Point x= r= g= b=/>.
export function parseParaviewXml(text: string): Clr {
  const map = text.match(/<ColorMap\b[^>]*>[\s\S]*?<\/ColorMap>/i)?.[0]
  if (!map) throw new Error('.xml: no ColorMap found')
  const name = map.match(/name="([^"]*)"/)?.[1] ?? 'colour map'
  const levels: number[] = [], colours: string[] = []
  for (const p of map.matchAll(/<Point\b([^>]*)\/>/g)) {
    const a = (k: string) => parseFloat(p[1].match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? '')
    const x = a('x'), r = a('r'), g = a('g'), b = a('b')
    if ([x, r, g, b].some(Number.isNaN)) continue
    levels.push(x); colours.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`)
  }
  return fromLevels(levels, colours, [rangeNote(`ParaView "${name}"`, levels.length, levels[0], levels[levels.length - 1])], '.xml')
}

// QGIS style XML: <colorramp type="gradient"> with color1, color2 and
// "stops" as offset;r,g,b,a entries joined by ':'.
export function parseQgisXml(text: string): Clr {
  const ramp = text.match(/<colorramp[^>]*type="gradient"[^>]*>[\s\S]*?<\/colorramp>/i)?.[0]
  if (!ramp) throw new Error('.xml: no gradient colorramp found')
  const prop = (k: string) => ramp.match(new RegExp(`(?:k="${k}"\\s+v="([^"]*)"|name="${k}"\\s+(?:type="[^"]*"\\s+)?value="([^"]*)")`))
  const val = (k: string) => { const m = prop(k); return m ? (m[1] ?? m[2]) : undefined }
  const rgba = (s: string) => { const p = s.split(',').map(Number); return `rgba(${p[0]},${p[1]},${p[2]},${((p[3] ?? 255) / 255).toFixed(3)})` }
  const stops: ColorStops = []
  const c1 = val('color1'), c2 = val('color2')
  if (!c1 || !c2) throw new Error('.xml: colorramp lacks color1/color2')
  stops.push([0, rgba(c1)])
  for (const e of (val('stops') ?? '').split(':').filter(Boolean)) { const [off, col] = e.split(';'); if (col) stops.push([parseFloat(off), rgba(col)]) }
  stops.push([1, rgba(c2)])
  return fromPositions(stops, `QGIS ramp, ${stops.length} colours`)
}

function rgbRows(rows: number[][], note: string): Clr {
  const max = Math.max(...rows.flat())
  const scale = max <= 1 ? 255 : 1
  const stops: ColorStops = rows.map((r, i) => [i / (rows.length - 1), `rgb(${Math.round(Math.min(r[0] * scale, 255))},${Math.round(Math.min(r[1] * scale, 255))},${Math.round(Math.min(r[2] * scale, 255))})`])
  return { version: 1, interp: 0, stops, warnings: [note] }
}

// A comment runs from a '#' or "'" that starts the line or follows a space;
// a '#' glued to hex digits is a colour.
function stripComment(line: string): string {
  return line.replace(/(^|\s)[#'](?![0-9a-fA-F]{6}\b).*$/, '').trim()
}

function dedupe(stops: ColorStops): ColorStops {
  const out: ColorStops = []
  for (const s of stops) { const last = out[out.length - 1]; if (!last || last[0] !== s[0] || last[1] !== s[1]) out.push(s) }
  if (out[0][0] !== 0) out.unshift([0, out[0][1]])
  if (out[out.length - 1][0] !== 1) out.push([1, out[out.length - 1][1]])
  return out
}

function hsvToRgb(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return `rgb(${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)})`
}
