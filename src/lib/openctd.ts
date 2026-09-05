// OpenCTD (Oceanography for Everyone) log files. The instrument writes
// CASTnnn.CSV with a header such as
//   Date, Time, Pressure, Temp, Conductivity            (Rev 8)
//   Date, Time,Pressure,Temp A,Temp B,Temp C,Conductivity   (Rev 7, three thermistors)
//   Date,Time,Conductivity,Temperature,Pressure          (earlier boards)
// with absolute pressure in mbar from the MS5803, temperature in deg C and
// conductivity in uS/cm from the Atlas EZO circuit. Nothing is derived on the
// instrument, so the reading is turned into a cast the way OpenCTD's own
// conversion template does (gauge pressure from a sea-level constant,
// PSS-78 salinity with a 42914 uS/cm reference), with the standard depth and
// density formulas on top.
import type { Cast, Column } from './cnv'
import { depthFromPressure, pss78Salinity, sigmaT } from './seawater'

export function isOpenCtd(text: string): boolean {
  const first = text.slice(0, 600).split(/\r?\n/).find(l => l.trim()) ?? ''
  const h = first.toLowerCase()
  return h.includes(',') && h.includes('date') && h.includes('time') && h.includes('pressure') && h.includes('conductivity')
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

export function parseOpenCtd(text: string, filename: string, latitudeDeg = 45): { cast: Cast; notes: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const header = lines[0].split(',').map(s => s.trim().toLowerCase())
  const iDate = header.indexOf('date'), iTime = header.indexOf('time')
  const iP = header.findIndex(h => h.startsWith('pressure')), iC = header.findIndex(h => h.startsWith('conduct'))
  const iT = header.map((h, i) => (h.startsWith('temp') ? i : -1)).filter(i => i >= 0)
  if (iP < 0 || iC < 0 || !iT.length) throw new Error(`${filename}: OpenCTD header lacks a pressure, temperature or conductivity column`)

  const pMbar: number[] = [], tC: number[] = [], ecRaw: number[] = [], when: string[] = []
  for (const line of lines.slice(1)) {
    const p = line.split(',').map(s => s.trim())
    if (p.length < header.length) continue
    const pressure = parseFloat(p[iP]), ec = parseFloat(p[iC])
    // DS18B20 thermistors report -127 or 85 when they fail; leave those out of the mean
    const temps = iT.map(i => parseFloat(p[i])).filter(v => Number.isFinite(v) && v > -5 && v < 60 && v !== 85)
    if (!Number.isFinite(pressure) || !Number.isFinite(ec) || !temps.length) continue
    pMbar.push(pressure); ecRaw.push(ec); tC.push(temps.reduce((a, b) => a + b, 0) / temps.length)
    when.push(iDate >= 0 && iTime >= 0 ? `${p[iDate]} ${p[iTime]}` : '')
  }
  if (pMbar.length < 3) throw new Error(`${filename}: no OpenCTD data rows found`)

  const notes: string[] = []
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
