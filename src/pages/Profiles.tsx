import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { availableVariables } from '../lib/cnv'
import { buildProfile } from '../lib/profiles'
import Plot from '../components/Plot'

const num = (s: string): number | null => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }

export default function Profiles() {
  const stations = useStore(s => s.stations)
  const settings = useStore(s => s.settings)
  const setSettings = useStore(s => s.setSettings)
  const active = useMemo(() => stations.filter(s => s.active), [stations])
  const variables = useMemo(() => availableVariables(active.map(s => s.cast)), [active])
  const isOn = (name: string, dflt: boolean) => settings.variables[name] ?? dflt

  let dmin = num(settings.depthMin), dmax = num(settings.depthMax)
  if (dmin !== null && dmax !== null && dmin > dmax) [dmin, dmax] = [dmax, dmin]

  const figures = useMemo(() => variables.filter(v => isOn(v.name, v.on)).map(v =>
    buildProfile(active.map(s => ({ id: s.id, name: s.name, color: s.color, cast: s.cast })), v.name, v.shorts, dmin, dmax, settings.lineShape),
  ).filter((f): f is NonNullable<typeof f> => f !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [active, variables, settings.variables, dmin, dmax, settings.lineShape])

  if (!active.length) return <div className="empty">No active stations. <Link to="/">Add or switch some on.</Link></div>

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
        <div>
          <h1>Profiles</h1>
          <p className="muted small">Each active station as a line, depth down the page. Click a name in a legend to hide it.</p>
        </div>
        <div className="row">
          <label className="field">from, m<input type="number" value={settings.depthMin} placeholder="surface" style={{ width: 92 }} onChange={e => setSettings({ depthMin: e.target.value })} /></label>
          <label className="field">to, m<input type="number" value={settings.depthMax} placeholder="bottom" style={{ width: 92 }} onChange={e => setSettings({ depthMax: e.target.value })} /></label>
          <label className="field">line
            <span className="seg">
              <button className={settings.lineShape === 'spline' ? 'on' : ''} onClick={() => setSettings({ lineShape: 'spline' })}>smooth</button>
              <button className={settings.lineShape === 'linear' ? 'on' : ''} onClick={() => setSettings({ lineShape: 'linear' })}>raw</button>
            </span>
          </label>
        </div>
      </div>
      <div className="row">
        {variables.map(v => (
          <label key={v.name} className={'chip' + (isOn(v.name, v.on) ? ' on' : '')}>
            <input type="checkbox" checked={isOn(v.name, v.on)} onChange={e => setSettings({ variables: { ...settings.variables, [v.name]: e.target.checked } })} />
            {v.name}
          </label>
        ))}
      </div>
      {figures.length === 0 && <div className="empty">Nothing to draw. Tick a variable, or widen the depth window.</div>}
      <div className="plots">
        {figures.map(f => (
          <div key={f.variable} className="plot-card">
            <Plot data={f.data} layout={f.layout} filename={f.variable.replace(/\W+/g, '_')} height={520} />
            {f.missing.length > 0 && <div className="note">not in: {f.missing.join(', ')}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
