import { useStore, BLANK_CAL, calSummary, type Station, type CalText } from '../store'

// What an OpenCTD owner knows and the log file does not carry: the surface
// pressure, the thermistor correction, and where the cast was taken. Every
// box may be left blank, and then the one set for every cast applies, and
// failing that what the file itself suggests. `target` is a station id, or
// '*' for the block that covers every OpenCTD cast.
export default function Instrument({ target, station }: { target: string; station?: Station }) {
  const settings = useStore(s => s.settings)
  const setCalibration = useStore(s => s.setCalibration)
  const forAll = target === '*'
  const own = (forAll ? settings.openCtdAll : settings.openCtdBy[target]) ?? BLANK_CAL
  // what applies when a box here is left blank
  const under = forAll ? BLANK_CAL : settings.openCtdAll ?? BLANK_CAL
  const set = (patch: Partial<CalText>) => setCalibration(target, patch)
  const info = station?.info
  const touched = Object.values(own).some(v => v !== '')

  // what a blank box falls back to, kept short enough to read inside the field
  const from = (shown: string, dflt: string) => (!forAll && shown !== '' ? `as for all casts: ${shown}` : `default: ${dflt}`)
  const num = (shown: string, dflt: string) => (!forAll && shown !== '' ? `${shown} (all casts)` : dflt)
  const pressureHint = forAll ? 'lowest reading'
    : num(under.surfacePressure, info ? info.surfacePressure.toFixed(1) : 'lowest reading')
  const latHint = forAll ? '45'
    : num(under.latitude, station?.lat !== null && station?.lat !== undefined ? station.lat.toFixed(2) : '45')

  return (
    <div className="card controls instrument">
      <label className="field" title="Pressure at the surface, in millibars. The log holds absolute pressure, so this is what is taken off it before depth is worked out. Blank reads it from the lowest reading, which is right when the logger saw air.">
        surface pressure (mbar)
        <input type="number" step="0.1" value={own.surfacePressure} placeholder={pressureHint} style={{ width: 160 }}
          aria-label="Surface pressure in millibars" onChange={e => set({ surfacePressure: e.target.value })} />
      </label>
      <label className="field" title="Added to the thermistor reading, from checking this unit against a reference thermometer.">
        temperature offset (°C)
        <input type="number" step="0.01" value={own.tempOffset} placeholder={num(under.tempOffset, '0')} style={{ width: 120 }}
          aria-label="Temperature offset in degrees C" onChange={e => set({ tempOffset: e.target.value })} />
      </label>
      {(forAll || (info?.thermistors ?? 0) > 1) && (
        <label className="field" title="How several thermistors are combined. The median ignores one that has failed; the mean lets it drag the answer.">
          thermistors
          <select value={own.thermistors} onChange={e => set({ thermistors: e.target.value as CalText['thermistors'] })}>
            <option value="">{from(under.thermistors, 'median')}</option>
            <option value="median">median</option>
            <option value="mean">mean</option>
          </select>
        </label>
      )}
      <label className="field" title="Gravity varies with latitude and the depth formula follows it. Blank uses the position typed for this station.">
        latitude (°)
        <input type="number" step="0.01" value={own.latitude} placeholder={latHint} style={{ width: 150 }}
          aria-label="Latitude in degrees for the depth formula" onChange={e => set({ latitude: e.target.value })} />
      </label>
      <label className="field" title="Seawater uses the UNESCO 1983 depth formula. Fresh water is lighter, so the same pressure is a greater depth.">
        water
        <select value={own.water} onChange={e => set({ water: e.target.value as CalText['water'] })}>
          <option value="">{from(under.water === 'fresh' ? 'fresh water' : under.water === 'sea' ? 'seawater' : '', 'seawater')}</option>
          <option value="sea">seawater</option>
          <option value="fresh">fresh water</option>
        </select>
      </label>
      <label className="field" title="Work the cast out the way OpenCTD's own spreadsheet does: salinity against 42900 µS/cm with no pressure term, and depth over fresh water. For checking against a cast someone processed in that template; ours is the standard otherwise.">
        match OpenCTD spreadsheet
        <select value={own.sheet} onChange={e => set({ sheet: e.target.value as CalText['sheet'] })}>
          <option value="">{from(under.sheet === 'on' ? 'yes' : under.sheet === 'off' ? 'no' : '', 'no')}</option>
          <option value="off">no</option>
          <option value="on">yes</option>
        </select>
      </label>
      {touched && <button className="btn quiet tiny" style={{ alignSelf: 'end' }} onClick={() => set({ ...BLANK_CAL })}>clear</button>}
      {station && info && (
        <div className="hint" style={{ flex: '1 1 100%' }}>
          {calSummary(station, settings)}
          {info.spread !== null && info.thermistors > 1 && ` · thermistors usually ${info.spread.toFixed(2)} °C apart`}
        </div>
      )}
    </div>
  )
}
