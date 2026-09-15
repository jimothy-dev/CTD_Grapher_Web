import { useMemo, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { availableVariables } from '../lib/cnv'
import { buildCastPlot, VARIABLE_COLORS } from '../lib/castplot'
import { labelFor } from '../lib/labels'
import { prettyUnits } from '../lib/units'
import PlotCard from '../components/PlotCard'
import LabelEditor from '../components/LabelEditor'

const num = (s: string): number | null => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }
// the variables a cast plot starts with, when the file has them
const DEFAULT_ON = new Set(['Temperature', 'Salinity', 'Density (sigma-t)', 'Dissolved Oxygen'])

export default function Cast() {
  const stations = useStore(s => s.stations)
  const settings = useStore(s => s.settings)
  const setSettings = useStore(s => s.setSettings)
  const active = useMemo(() => stations.filter(s => s.active), [stations])
  const chosenId = active.some(s => s.id === settings.castStation) ? settings.castStation : active[0]?.id ?? ''
  const shown = settings.castAll ? active : active.filter(s => s.id === chosenId)
  const variables = useMemo(() => availableVariables(shown.map(s => s.cast)), [shown])
  const isOn = (name: string) => settings.castVariables[name] ?? DEFAULT_ON.has(name)
  const named = (name: string) => labelFor(name, settings.variableLabels)

  let dmin = num(settings.depthMin), dmax = num(settings.depthMax)
  if (dmin !== null && dmax !== null && dmin > dmax) [dmin, dmax] = [dmax, dmin]

  const figures = useMemo(() => shown.map(s => ({
    station: s,
    result: buildCastPlot(s.cast, {
      variables: variables.filter(v => isOn(v.name)).map(v => ({ name: v.name, shorts: v.shorts, label: named(v.name) })),
      depthMin: dmin, depthMax: dmax, lineShape: settings.lineShape, showGrid: settings.profileGrid,
    }),
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [shown, variables, settings.castVariables, settings.variableLabels, dmin, dmax, settings.lineShape, settings.profileGrid])

  if (!active.length) return <div className="empty">No active stations. <Link to="/">Add or switch some on.</Link></div>

  const seg = <T extends string>(value: T, options: [T, string][], set: (v: T) => void) => (
    <span className="seg">{options.map(([v, label]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{label}</button>)}</span>
  )
  const perRow = Math.min(Math.max(settings.graphsPerRow || 3, 1), 4)

  return (
    <div className="stack">
      <div>
        <h1>Cast</h1>
        <p className="muted small">One station's cast: each variable against depth, every one on its own scale, in its own colour.</p>
      </div>
      <div className="row">
        {variables.map(v => (
          <label key={v.name} className={'chip' + (isOn(v.name) ? ' on' : '')} title={prettyUnits(v.units, false)} style={isOn(v.name) ? { borderColor: VARIABLE_COLORS[v.name] ?? undefined, color: VARIABLE_COLORS[v.name] ?? undefined } : undefined}>
            <input type="checkbox" checked={isOn(v.name)} onChange={e => setSettings({ castVariables: { ...settings.castVariables, [v.name]: e.target.checked } })} />
            {named(v.name)}
          </label>
        ))}
      </div>
      <LabelEditor items={variables.map(v => ({ key: v.name, caption: v.name }))} />
      <div className="card controls">
        <label className="field">station
          <select value={settings.castAll ? '*' : chosenId} onChange={e => (e.target.value === '*' ? setSettings({ castAll: true }) : setSettings({ castAll: false, castStation: e.target.value }))}>
            {active.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="*">each active station</option>
          </select>
        </label>
        <div className="field">line{seg(settings.lineShape, [['spline', 'smooth'], ['linear', 'raw']], v => setSettings({ lineShape: v }))}</div>
        <label className="field">depth from (m)<input type="number" value={settings.depthMin} placeholder="surface" style={{ width: 92 }} onChange={e => setSettings({ depthMin: e.target.value })} /></label>
        <label className="field">depth to (m)<input type="number" value={settings.depthMax} placeholder="bottom" style={{ width: 92 }} onChange={e => setSettings({ depthMax: e.target.value })} /></label>
        <label className="field">grid lines<input type="checkbox" className="switch" checked={settings.profileGrid} onChange={e => setSettings({ profileGrid: e.target.checked })} /></label>
        <label className="field">titles<input type="checkbox" className="switch" checked={settings.profileTitles} onChange={e => setSettings({ profileTitles: e.target.checked })} /></label>
        {settings.castAll && <label className="field">graphs per row<input type="number" min={1} max={4} step={1} value={perRow} style={{ width: 64 }} aria-label="Graphs per row, 1 to 4" onChange={e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 4) setSettings({ graphsPerRow: v }) }} /></label>}
        <div className="field">graphs{seg(settings.profileGraphTheme, [['light', 'light'], ['dark', 'dark']], v => setSettings({ profileGraphTheme: v }))}</div>
      </div>
      {figures.every(f => !f.result) && <div className="empty">Nothing to draw. Tick a variable, or widen the depth window.</div>}
      <div className="plots" style={{ '--per-row': settings.castAll ? perRow : 1 } as CSSProperties}>
        {figures.map(({ station, result }) => result && (
          <PlotCard key={station.id} data={result.data} layout={result.layout} filename={`${station.name.replace(/\W+/g, '_')}_cast`} height={result.height}
            theme={settings.profileGraphTheme} autoTitle={`${station.name} cast`} title={settings.castTitleText[station.id]} showTitle={settings.profileTitles}
            onTitle={t => setSettings({ castTitleText: { ...settings.castTitleText, [station.id]: t } })}
            note={result.missing.length ? `not in this cast: ${result.missing.join(', ')}` : undefined} />
        ))}
      </div>
    </div>
  )
}
