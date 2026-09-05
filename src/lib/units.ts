// Units as Sea-Bird writes them, made readable: superscripts, the degree
// sign, micro. html=true gives Plotly markup (<sup>), false gives Unicode
// for ordinary UI text.
export function prettyUnits(u: string, html = true): string {
  let s = (u || '').trim()
  s = s.replace(/^(ITS-90|ITS-68|IPTS-68|ITS-90 ),?\s*/i, '').replace(/^PSS-78,?\s*/i, '')
  s = s.replace(/^sigma-(t|theta|θ|é),\s*/i, '')
  s = s.replace(/deg C/gi, '°C').replace(/\bumol\b/gi, 'µmol').replace(/\bug\b/g, 'µg')
  s = s.replace(/\s+\]$/, '').trim()
  s = s.replace(/\^(-?\d+)/g, (_m, d: string) => html ? `<sup>${d}</sup>` : d.split('').map(c => SUP[c] ?? c).join(''))
  return s
}
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' }

// One spelling for each physical unit, so "ITS-90, deg C" and "deg C" agree
// and mg/m^3 matches µg/L (the same amount). Anything unrecognised is kept
// lower-cased without spaces, so a real difference still shows.
export function canonicalUnit(u: string): string {
  let s = prettyUnits(u, false).toLowerCase().replace(/\s+/g, '')
  s = s.replace(/µ/g, 'u').replace(/³/g, '3').replace(/²/g, '2').replace(/⁻/g, '-')
  s = s.replace(/^(deg\.?c|degc|°c|c)$/, '°c').replace(/^dbar?$/, 'db').replace(/^(psu|pss-78|pss78)$/, 'psu')
  // per-volume forms of the same amount merge; per-mass (per kg) forms stay distinct, they differ by the density
  s = s.replace(/^(mg\/m3|mg\/m\^3|ug\/l)$/, 'ug/l').replace(/^(umol\/l|mmol\/m3|mmol\/m\^3)$/, 'umol/l')
  return s
}

// Factor that turns a value in `from` into `to`: 1 when they are the same
// unit, the exact oxygen factor between mL/L and mg/L (1 mL/L = 1.42903 mg/L,
// Sea-Bird's value), null for any other pair.
export function unitFactor(from: string, to: string): number | null {
  const a = canonicalUnit(from), b = canonicalUnit(to)
  if (a === b) return 1
  if (a === 'ml/l' && b === 'mg/l') return 1.42903
  if (a === 'mg/l' && b === 'ml/l') return 1 / 1.42903
  return null
}

// "Temperature (°C)" style label, or just the name when there are no units.
export function labelWithUnits(name: string, units: string, html = true): string {
  const u = prettyUnits(units, html)
  return u ? `${name} (${u})` : name
}
