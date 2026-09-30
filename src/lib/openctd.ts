// OpenCTD (Oceanography for Everyone) log files. The instrument writes
// CASTnnn.CSV with a header such as
//   Date, Time, Pressure, Temp, Conductivity            (Rev 8)
//   Date, Time,Pressure,Temp A,Temp B,Temp C,Conductivity   (Rev 7, three thermistors)
//   Date,Time,Conductivity,Temperature,Pressure          (earlier boards)
// or with no header line at all, which is what the loggers in the field
// write and what OpenCTD's own spreadsheet expects pasted into it. Absolute
// pressure comes in mbar from the MS5803, temperature in deg C and
// conductivity in uS/cm from the Atlas EZO circuit. Nothing is derived on the
// instrument, so each reading is turned into a cast: gauge pressure from the
// lowest reading when the logger saw air (950 to 1060 mbar), else standard
// atmosphere; depth by the UNESCO formula at the given latitude; PSS-78
// salinity with the pressure term (OpenCTD's own template drops it and
// subtracts a fixed 1010 mbar); sigma-t by EOS-80.
import type { Cast, Column } from './cnv'
import { depthFromPressure, pss78Salinity, sigmaT } from './seawater'

export function isOpenCtd(text: string): boolean {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return false
  const h = lines[0].toLowerCase()
  if (h.includes(',') && h.includes('date') && h.includes('time') && h.includes('pressure') && h.includes('conductivity')) return true
  return headerlessShape(lines) !== null
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

// Some loggers write those same columns with no header at all: the files
// OpenCTD's own spreadsheet expects pasted into its columns A to G. A row of
// "date, time, pressure, one to three temperatures, conductivity", repeated
// at the same width with plausible values, is specific enough to read on its
// own.
const DATE = /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/
const CLOCK = /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/
interface Shape { ncol: number; iDate: number; iTime: number; iP: number; iT: number[]; iC: number }
function headerlessShape(lines: string[]): Shape | null {
  const rows = lines.slice(0, 20).map(l => l.split(',').map(x => x.trim()))
  const ncol = rows[0].length
  if (rows.length < 3 || ncol < 5 || ncol > 8 || rows.some(r => r.length !== ncol)) return null
  if (!rows.every(r => DATE.test(r[0]) && CLOCK.test(r[1]))) return null
  const nums = rows.map(r => r.slice(2).map(Number))
  if (!nums.every(r => r.every(v => Number.isFinite(v)))) return null
  const col = (k: number) => median(nums.map(r => r[k]))
  if (!(col(0) > 500 && col(0) < 20000)) return null   // absolute pressure in mbar: about 1013 in air
  const iT: number[] = []
  for (let k = 1; k <= ncol - 4; k++) { const t = col(k); if (!(t > -5 && t < 60)) return null; iT.push(k + 2) }
  if (!iT.length) return null
  const ec = col(ncol - 3)                             // conductivity in uS/cm, or mS/cm on an older board
  if (!(ec >= 0 && ec < 200000)) return null
  return { ncol, iDate: 0, iTime: 1, iP: 2, iT, iC: ncol - 1 }
}

export function parseOpenCtd(text: string, filename: string, latitudeDeg = 45): { cast: Cast; notes: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const notes: string[] = []
  const header = lines[0].split(',').map(s => s.trim().toLowerCase())
  const headed = header.some(h => h.startsWith('pressure')) && header.some(h => h.startsWith('conduct'))
  let iDate: number, iTime: number, iP: number, iC: number, iT: number[], ncol: number, firstRow: number
  if (headed) {
    iDate = header.indexOf('date'); iTime = header.indexOf('time')
    iP = header.findIndex(h => h.startsWith('pressure')); iC = header.findIndex(h => h.startsWith('conduct'))
    iT = header.map((h, i) => (h.startsWith('temp') ? i : -1)).filter(i => i >= 0)
    if (iP < 0 || iC < 0 || !iT.length) throw new Error(`${filename}: OpenCTD header lacks a pressure, temperature or conductivity column`)
    ncol = header.length; firstRow = 1
  } else {
    const shape = headerlessShape(lines)
    if (!shape) throw new Error(`${filename}: OpenCTD header lacks a pressure, temperature or conductivity column`)
    ;({ ncol, iDate, iTime, iP, iC, iT } = shape); firstRow = 0
    notes.push(`no header row, so the columns were read in the order the logger writes them: date, time, pressure, ${iT.length} temperature${iT.length === 1 ? '' : 's'}, conductivity`)
  }

  const pMbar: number[] = [], tC: number[] = [], ecRaw: number[] = [], when: string[] = []
  for (const line of lines.slice(firstRow)) {
    const p = line.split(',').map(s => s.trim())
    if (p.length < ncol) continue
    const pressure = parseFloat(p[iP]), ec = parseFloat(p[iC])
    // DS18B20 thermistors report -127 or 85 when they fail; leave those out of the mean
    const temps = iT.map(i => parseFloat(p[i])).filter(v => Number.isFinite(v) && v > -5 && v < 60 && v !== 85)
    if (!Number.isFinite(pressure) || !Number.isFinite(ec) || !temps.length) continue
    pMbar.push(pressure); ecRaw.push(ec); tC.push(temps.reduce((a, b) => a + b, 0) / temps.length)
    when.push(iDate >= 0 && iTime >= 0 ? `${p[iDate]} ${p[iTime]}` : '')
  }
  if (pMbar.length < 3) throw new Error(`${filename}: no OpenCTD data rows found`)

  // conductivity: uS/cm from the EZO circuit unless the numbers are clearly mS/cm already
  const ecWet = ecRaw.filter(v => v > 100)
  const toMs = median(ecWet.length ? ecWet : ecRaw) > 200 ? 1e-3 : 1
  // surface pressure: the lowest reading when the logger saw air, else standard atmosphere
  const pMin = Math.min(...pMbar)
  const inAir = pMin > 950 && pMin < 1060
  const pAtm = inAir ? pMin : 1013.25
  notes.push(`depth from pressure with the surface at ${pAtm.toFixed(1)} mbar (${inAir ? 'the lowest reading, taken in air' : 'standard atmosphere, the logger never read air'}) and ${latitudeDeg} degrees latitude; salinity by PSS-78 from conductivity in ${toMs === 1 ? 'mS/cm' : 'uS/cm'}, density by EOS-80`)

  const n = pMbar.length
  const cols = { prdM: new Float64Array(n), depSM: new Float64Array(n), t090C: new Float64Array(n), c0mScm: new Float64Array(n), sal00: new Float64Array(n), sigma: new Float64Array(n) }
  for (let i = 0; i < n; i++) {
    const pDbar = (pMbar[i] - pAtm) / 100
    const cond = ecRaw[i] * toMs
    const sal = cond > 0.5 && pDbar > -0.5 ? pss78Salinity(cond, tC[i], Math.max(pDbar, 0)) : NaN
    cols.prdM[i] = pDbar
    cols.depSM[i] = depthFromPressure(Math.max(pDbar, 0), latitudeDeg) * (pDbar < 0 ? -1 : 1) || 0
    cols.t090C[i] = tC[i]
    cols.c0mScm[i] = cond
    cols.sal00[i] = sal
    cols.sigma[i] = Number.isFinite(sal) ? sigmaT(sal, tC[i]) : NaN
  }
  const columns: Column[] = [
    { index: 0, short: 'prdM', desc: 'Pressure, Strain Gauge', units: 'db' },
    { index: 1, short: 'depSM', desc: 'Depth', units: 'salt water, m' },
    { index: 2, short: 't090C', desc: 'Temperature', units: 'ITS-90, deg C' },
    { index: 3, short: 'c0mS/cm', desc: 'Conductivity', units: 'mS/cm' },
    { index: 4, short: 'sal00', desc: 'Salinity, Practical', units: 'PSU' },
    { index: 5, short: 'sigma-t00', desc: 'Density', units: 'sigma-t, kg/m^3' },
  ]
  const rev = iT.length > 1 ? `OpenCTD (Rev 7, ${iT.length} thermistors averaged)` : 'OpenCTD'
  return {
    cast: {
      columns, data: [cols.prdM, cols.depSM, cols.t090C, cols.c0mScm, cols.sal00, cols.sigma], nrows: n,
      meta: { filename, badFlag: -9.99e-29, startTime: when[0] || null, lat: null, lon: null, nvalues: n, interval: null, instrument: rev, processing: [] },
    },
    notes,
  }
}
