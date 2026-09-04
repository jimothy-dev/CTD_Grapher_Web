// Units as Sea-Bird writes them, made readable: superscripts, the degree
// sign, micro. html=true gives Plotly markup (<sup>), false gives Unicode
// for ordinary UI text.
export function prettyUnits(u: string, html = true): string {
  let s = (u || '').trim()
  s = s.replace(/^ITS-90,\s*/i, '').replace(/^IPTS-68,\s*/i, '').replace(/^PSS-78,?\s*/i, '')
  s = s.replace(/^sigma-(t|theta|θ|é),\s*/i, '')
  s = s.replace(/deg C/gi, '°C').replace(/\bumol\b/gi, 'µmol').replace(/\bug\b/g, 'µg')
  s = s.replace(/\s+\]$/, '').trim()
  s = s.replace(/\^(-?\d+)/g, (_m, d: string) => html ? `<sup>${d}</sup>` : d.split('').map(c => SUP[c] ?? c).join(''))
  return s
}
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' }

// "Temperature (°C)" style label, or just the name when there are no units.
export function labelWithUnits(name: string, units: string, html = true): string {
  const u = prettyUnits(units, html)
  return u ? `${name} (${u})` : name
}
