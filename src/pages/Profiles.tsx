import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, type LegendPos } from '../store'
import { availableVariables } from '../lib/cnv'
import { buildProfile } from '../lib/profiles'
import { prettyUnits } from '../lib/units'
import PlotCard from '../components/PlotCard'

const num = (s: string): number | null => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }
const DEPTH = { name: 'Depth', shorts: [] as string[] }

export default function Profiles() {
  const stations = useStore(s => s.stations)
  const settings = useStore(s => s.settings)
  const setSettings = useStore(s => s.setSettings)
  const active = useMemo(() => stations.filter(s => s.active), [stations])
  const variables = useMemo(() => availableVariables(active.map(s => s.cast)), [active])
  const isOn = (name: string, dflt: boolean) => settings.variables[name] ?? dflt
  const [pairX, setPairX] = useState('')
  const [pairY, setPairY] = useState('depth')

  let dmin = num(settings.depthMin), dmax = num(settings.depthMax)
  if (dmin !== null && dmax !== null && dmin > dmax) [dmin, dmax] = [dmax, dmin]

  const choice = (name: string) => { const v = variables.find(v => v.name === name); return v ? { name: v.name, shorts: v.shorts } : DEPTH }
  const yChoice = useMemo(() => choice(settings.yVariable),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [variables, settings.yVariable])

  const profileStations = useMemo(() => active.map(s => ({ id: s.id, name: s.name, color: s.color, cast: s.cast })), [active])
  const common = { depthMin: dmin, depthMax: dmax, lineShape: settings.lineShape, legendPos: settings.legendPos, yLabelMode: settings.yLabelMode }

  const figures = useMemo(() => variables
    .filter(v => isOn(v.name, v.on) && v.name !== yChoice.name)
    .map(v => buildProfile(profileStations, { variable: v.name, shorts: v.shorts, y: yChoice, yInvert: settings.yInvert, ...common }))
    .filter((f): f is NonNullable<typeof f> => f !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [profileStations, variables, settings.variables, dmin, dmax, settings.lineShape, settings.legendPos, settings.yInvert, settings.yLabelMode, yChoice])

  // Custom pairs: any variable against any other, or against depth. Depth
  // reads downward as usual; a variable on Y reads upward.
  const pairs = useMemo(() => settings.customPairs.map(p => {
    const x = variables.find(v => v.name === p.x)
    if (!x) return null
    const y = choice(p.y)
    if (y.name === x.name) return null
    const fig = buildProfile(profileStations, { variable: x.name, shorts: x.shorts, y, yInvert: y.name === 'Depth' ? settings.yInvert : false, ...common })
    return fig ? { key: `${p.x}|${p.y}`, pair: p, fig } : null
  }).filter((p): p is NonNullable<typeof p> => p !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [profileStations, variables, settings.customPairs, dmin, dmax, settings.lineShape, settings.legendPos, settings.yInvert, settings.yLabelMode])

  if (!active.length) return <div className="empty">No active stations. <Link to="/">Add or switch some on.</Link></div>

  const seg = <T extends string>(value: T, options: [T, string][], set: (v: T) => void) => (
    <span className="seg">{options.map(([v, label]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => set(v)}>{label}</button>)}</span>
  )
  const xDefault = pairX || variables.find(v => v.name !== 'Temperature')?.name || variables[0]?.name || ''
  const addPair = () => {
    if (!xDefault) return
    const p = { x: xDefault, y: pairY }
    if (settings.customPairs.some(q => q.x === p.x && q.y === p.y)) return
    setSettings({ customPairs: [...settings.customPairs, p] })
  }
  const card = (key: string, f: NonNullable<ReturnType<typeof buildProfile>>, onRemove?: () => void) => (
    <PlotCard key={key} data={f.data} layout={f.layout} filename={f.autoTitle.replace(/\W+/g, '_')} height={520}
      theme={settings.profileGraphTheme} autoTitle={f.autoTitle} title={settings.profileTitleText[key]} showTitle={settings.profileTitles}
      onTitle={t => setSettings({ profileTitleText: { ...settings.profileTitleText, [key]: t } })}
      width={settings.profileWidths[key] ?? 33} onWidth={w => setSettings({ profileWidths: { ...settings.profileWidths, [key]: w } })}
      onRemove={onRemove} note={f.missing.length ? `not in: ${f.missing.join(', ')}` : undefined} />
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
      <div className="card controls" title="Any variable against any other, or against depth, added as an extra graph">
        <span className="small muted" style={{ alignSelf: 'center' }}>extra graph:</span>
        <label className="field">x
          <select value={xDefault} onChange={e => setPairX(e.target.value)}>
            {variables.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </label>
        <label className="field">y
          <select value={pairY} onChange={e => setPairY(e.target.value)}>
            <option value="depth">Depth</option>
            {variables.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </label>
        <button className="btn" onClick={addPair} disabled={!xDefault || choice(pairY).name === xDefault}>add graph</button>
        {pairs.length > 0 && <span className="small muted">{pairs.length} extra</span>}
      </div>
      {figures.length === 0 && pairs.length === 0 && <div className="empty">Nothing to draw. Tick a variable, or widen the depth window.</div>}
      <div className="plots">
        {figures.map(f => card(f.variable, f))}
        {pairs.map(p => card(p.key, p.fig, () => setSettings({ customPairs: settings.customPairs.filter(q => !(q.x === p.pair.x && q.y === p.pair.y)) })))}
      </div>
    </div>
  )
}
