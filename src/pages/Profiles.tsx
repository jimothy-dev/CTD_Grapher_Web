import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStore, type LegendPos } from '../store'
import { availableVariables } from '../lib/cnv'
import { buildProfile } from '../lib/profiles'
import { prettyUnits } from '../lib/units'
import PlotCard from '../components/PlotCard'

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

  const yChoice = useMemo(() => {
    const v = variables.find(v => v.name === settings.yVariable)
    return v ? { name: v.name, shorts: v.shorts } : { name: 'Depth', shorts: [] }
  }, [variables, settings.yVariable])

  const figures = useMemo(() => variables
    .filter(v => isOn(v.name, v.on) && v.name !== yChoice.name)
    .map(v => buildProfile(active.map(s => ({ id: s.id, name: s.name, color: s.color, cast: s.cast })), {
      variable: v.name, shorts: v.shorts, y: yChoice, depthMin: dmin, depthMax: dmax,
      lineShape: settings.lineShape, legendPos: settings.legendPos, yInvert: settings.yInvert, yLabelMode: settings.yLabelMode,
    }))
    .filter((f): f is NonNullable<typeof f> => f !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [active, variables, settings.variables, dmin, dmax, settings.lineShape, settings.legendPos, settings.yInvert, settings.yLabelMode, yChoice])

  if (!active.length) return <div className="empty">No active stations. <Link to="/">Add or switch some on.</Link></div>

  const seg = <T extends string>(value: T, options: [T, string][], set: (v: T) => void) => (
    <span className="seg">{options.map(([v, label]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{label}</button>)}</span>
  )

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
        <div>
          <h1>Profiles</h1>
          <p className="muted small">Each active station as a line. Click a name in a legend to hide it.</p>
        </div>
      </div>
      <div className="row">
        {variables.map(v => (
          <label key={v.name} className={'chip' + (isOn(v.name, v.on) ? ' on' : '')} title={prettyUnits(v.units, false)}>
            <input type="checkbox" checked={isOn(v.name, v.on)} onChange={e => setSettings({ variables: { ...settings.variables, [v.name]: e.target.checked } })} />
            {v.name}
          </label>
        ))}
      </div>
      <div className="card controls">
        <label className="field">y axis
          <select value={settings.yVariable} onChange={e => setSettings({ yVariable: e.target.value, yInvert: e.target.value === 'depth' ? true : settings.yInvert })}>
            <option value="depth">Depth</option>
            {variables.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </label>
        <label className="field">y direction{seg(settings.yInvert ? 'down' : 'up', [['down', 'largest at bottom'], ['up', 'largest at top']], v => setSettings({ yInvert: v === 'down' }))}</label>
        <label className="field">y label{seg(settings.yLabelMode, [['side', 'along the axis'], ['top', 'upright at top']], v => setSettings({ yLabelMode: v }))}</label>
        <label className="field">legend{seg<LegendPos>(settings.legendPos, [['left', 'left'], ['right', 'right'], ['bottom', 'bottom']], v => setSettings({ legendPos: v }))}</label>
        <label className="field">line{seg(settings.lineShape, [['spline', 'smooth'], ['linear', 'raw']], v => setSettings({ lineShape: v }))}</label>
        <label className="field">depth from, m<input type="number" value={settings.depthMin} placeholder="surface" style={{ width: 92 }} onChange={e => setSettings({ depthMin: e.target.value })} /></label>
        <label className="field">to, m<input type="number" value={settings.depthMax} placeholder="bottom" style={{ width: 92 }} onChange={e => setSettings({ depthMax: e.target.value })} /></label>
        <label className="field">titles<input type="checkbox" className="switch" checked={settings.profileTitles} onChange={e => setSettings({ profileTitles: e.target.checked })} /></label>
        <label className="field">graphs{seg(settings.profileGraphTheme, [['light', 'light'], ['dark', 'dark']], v => setSettings({ profileGraphTheme: v }))}</label>
      </div>
      {figures.length === 0 && <div className="empty">Nothing to draw. Tick a variable, or widen the depth window.</div>}
      <div className="plots">
        {figures.map(f => (
          <PlotCard key={f.variable} data={f.data} layout={f.layout} filename={f.variable.replace(/\W+/g, '_')} height={520}
            theme={settings.profileGraphTheme} autoTitle={f.autoTitle} title={settings.profileTitleText[f.variable]} showTitle={settings.profileTitles}
            onTitle={t => setSettings({ profileTitleText: { ...settings.profileTitleText, [f.variable]: t } })}
            width={settings.profileWidths[f.variable] ?? 33} onWidth={w => setSettings({ profileWidths: { ...settings.profileWidths, [f.variable]: w } })}
            note={f.missing.length ? `not in: ${f.missing.join(', ')}` : undefined} />
        ))}
      </div>
    </div>
  )
}
