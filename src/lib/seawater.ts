// Seawater formulas for instruments that log raw sensor readings: the same
// derivations Sea-Bird's software applies before writing a .cnv.

// Depth from pressure, UNESCO 1983 (Saunders and Fofonoff), for a standard
// ocean at the given latitude. Pressure in dbar, depth in m. Check value:
// 10000 dbar at 30 degrees gives 9712.65 m.
export function depthFromPressure(p: number, latitudeDeg = 45): number {
  const x = Math.sin((latitudeDeg * Math.PI) / 180) ** 2
  const g = 9.780318 * (1 + (5.2788e-3 + 2.36e-5 * x) * x) + 1.092e-6 * p
  return ((((-1.82e-15 * p + 2.279e-10) * p - 2.2512e-5) * p + 9.72659) * p) / g
}

// Practical salinity from conductivity (mS/cm), temperature (deg C, ITS-90)
// and pressure (dbar): PSS-78 (UNESCO 1983 Technical Paper 44). Valid for
// 2 to 42; 42.914 mS/cm at 15 degrees and 0 dbar is 35 by definition.
export function pss78Salinity(condMScm: number, tempC90: number, pDbar: number): number {
  if (!(condMScm > 0)) return NaN
  const t = tempC90 * 1.00024                      // the polynomials are written for IPTS-68
  const R = condMScm / 42.914
  const rt = 0.6766097 + 2.00564e-2 * t + 1.104259e-4 * t ** 2 - 6.9698e-7 * t ** 3 + 1.0031e-9 * t ** 4
  const Rp = 1 + (pDbar * (2.07e-5 + pDbar * (-6.37e-10 + pDbar * 3.989e-15))) / (1 + 3.426e-2 * t + 4.464e-4 * t ** 2 + (4.215e-1 - 3.107e-3 * t) * R)
  const Rt = R / (Rp * rt)
  const s = Math.sqrt(Math.max(Rt, 0))
  const dS = ((t - 15) / (1 + 0.0162 * (t - 15))) * (0.0005 - 0.0056 * s - 0.0066 * Rt - 0.0375 * Rt * s + 0.0636 * Rt ** 2 - 0.0144 * Rt ** 2 * s)
  return 0.008 - 0.1692 * s + 25.3851 * Rt + 14.0941 * Rt * s - 7.0261 * Rt ** 2 + 2.7081 * Rt ** 2 * s + dS
}

// sigma-t: density of seawater at atmospheric pressure minus 1000 kg/m3,
// EOS-80 (Millero and Poisson 1981). Check value: 35 and 5 degrees give 27.68.
export function sigmaT(salinity: number, tempC90: number): number {
  if (!Number.isFinite(salinity) || !Number.isFinite(tempC90)) return NaN
  const t = tempC90 * 1.00024, S = salinity
  const rhoW = 999.842594 + 6.793952e-2 * t - 9.09529e-3 * t ** 2 + 1.001685e-4 * t ** 3 - 1.120083e-6 * t ** 4 + 6.536332e-9 * t ** 5
  const A = 8.24493e-1 - 4.0899e-3 * t + 7.6438e-5 * t ** 2 - 8.2467e-7 * t ** 3 + 5.3875e-9 * t ** 4
  const B = -5.72466e-3 + 1.0227e-4 * t - 1.6546e-6 * t ** 2
  const C = 4.8314e-4
  return rhoW + A * S + B * S * Math.sqrt(S) + C * S * S - 1000
}
