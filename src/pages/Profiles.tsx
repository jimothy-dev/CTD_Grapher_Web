import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useStore, type LegendPos } from '../store'
import { availableVariables } from '../lib/cnv'
import { buildProfile } from '../lib/profiles'
import { prettyUnits } from '../lib/units'
import { labelFor } from '../lib/labels'
import PlotCard from '../components/PlotCard'
import LabelEditor from '../components/LabelEditor'

const num = (s: string): number | null => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }
const DEPTH = { name: 'Depth', shorts: [] as string[] }
// bookkeeping columns and the depth channels (Depth is its own choice)
const SKIP = new Set(['flag', 'nbin', 'scan', 'depsm', 'depfm'])

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

  // every other channel the files carry (a second oxygen unit, potential
  // temperature, conductivity, raw voltages), for the extra graphs
  const channels = useMemo(() => {
    const seen = new Map<string, { short: string; desc: string; units: string }>()
    for (const s of active) for (const c of s.cast.columns) {
      const k = c.short.toLowerCase()
      if (SKIP.has(k) || seen.has(k)) continue
      seen.set(k, { short: c.short, desc: c.desc, units: c.units })
    }
    return [...seen.values()]
  }, [active])
  // internal name -> what to plot and what to call it (custom labels apply to variables and channels alike)
  const named = (name: string) => labelFor(name, settings.variableLabels)
  const choice = (name: string): { name: string; shorts: string[]; label?: string } => {
    if (name.startsWith('col:')) {
      const c = channels.find(ch => ch.short.toLowerCase() === name.slice(4).toLowerCase())
      if (!c) return DEPTH
      const dflt = c.desc ? `${c.desc} (${c.short})` : c.short
      return { name: dflt, shorts: [c.short.toLowerCase()], label: labelFor(name, settings.variableLabels, dflt) }
    }
    const v = variables.find(v => v.name === name)
    return v ? { name: v.name, shorts: v.shorts, label: named(v.name) } : DEPTH
  }
  const yChoice = useMemo(() => choice(settings.yVariable),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [variables, settings.yVariable])

  const profileStations = useMemo(() => active.map(s => ({ id: s.id, name: s.name, color: s.color, cast: s.cast })), [active])
  const common = { depthMin: dmin, depthMax: dmax, lineShape: settings.lineShape, legendPos: settings.legendPos, yLabelMode: settings.yLabelMode, showGrid: settings.profileGrid }

  const figures = useMemo(() => variables
    .filter(v => isOn(v.name, v.on) && v.name !== yChoice.name)
    .map(v => buildProfile(profileStations, { variable: v.name, label: named(v.name), shorts: v.shorts, y: yChoice, yInvert: settings.yInvert, ...common }))
    .filter((f): f is NonNullable<typeof f> => f !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [profileStations, variables, settings.variables, settings.variableLabels, dmin, dmax, settings.lineShape, settings.legendPos, settings.yInvert, settings.yLabelMode, settings.profileGrid, yChoice])

  // Custom pairs: any variable against any other, or against depth. Depth
  // reads downward as usual; a variable on Y reads upward.
  const pairs = useMemo(() => settings.customPairs.map(p => {
    const x = choice(p.x)
    if (x === DEPTH) return null
    const y = choice(p.y)
    if (y.name === x.name) return null
    const fig = buildProfile(profileStations, { variable: x.name, label: x.label, shorts: x.shorts, y, yInvert: y.name === 'Depth' ? settings.yInvert : false, ...common })
    return fig ? { key: `${p.x}|${p.y}`, pair: p, fig } : null
  }).filter((p): p is NonNullable<typeof p> => p !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [profileStations, variables, channels, settings.customPairs, settings.variableLabels, dmin, dmax, settings.lineShape, settings.legendPos, settings.yInvert, settings.yLabelMode, settings.profileGrid])

  // labels can be typed for every variable present and for any channel an extra graph uses
  const labelItems = [
    ...variables.map(v => ({ key: v.name, caption: v.name })),
    ...[...new Set(settings.customPairs.flatMap(p => [p.x, p.y]).filter(k => k.startsWith('col:')))].map(k => ({ key: k, caption: k.slice(4) })),
  ]

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
  const noteFor = (f: NonNullable<ReturnType<typeof buildProfile>>) =>
    [f.missing.length ? `not in: ${f.missing.join(', ')}` : '', ...f.warnings].filter(Boolean).join(' · ') || undefined
  const card = (key: string, f: NonNullable<ReturnType<typeof buildProfile>>, onRemove?: () => void) => (
    <PlotCard key={key} data={f.data} layout={f.layout} filename={f.autoTitle.replace(/\W+/g, '_')} height={520}
      theme={settings.profileGraphTheme} autoTitle={f.autoTitle} title={settings.profileTitleText[key]} showTitle={settings.profileTitles}
      onTitle={t => setSettings({ profileTitleText: { ...settings.profileTitleText, [key]: t } })}
      onRemove={onRemove} note={noteFor(f)} />
  )
  const perRow = Math.min(Math.max(settings.graphsPerRow || 3, 1), 4)

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
        <div>
          <h1>Profiles</h1>
          <p className="muted small">Vertical profiles: each cast as a line against depth. Click a name in a legend to hide that station.</p>
        </div>
      </div>
      <div className="row">
        {variables.map(v => (
          <label key={v.name} className={'chip' + (isOn(v.name, v.on) ? ' on' : '')} title={prettyUnits(v.units, false)}>
            <input type="checkbox" checked={isOn(v.name, v.on)} onChange={e => setSettings({ variables: { ...settings.variables, [v.name]: e.target.checked } })} />
            {named(v.name)}
          </label>
        ))}
      </div>
      <LabelEditor items={labelItems} />
      <div className="card controls">
        <label className="field">y variable
          <select value={settings.yVariable} onChange={e => setSettings({ yVariable: e.target.value, yInvert: e.target.value === 'depth' ? true : settings.yInvert })}>
            <option value="depth">Depth</option>
            {variables.map(v => <option key={v.name} value={v.name}>{named(v.name)}</option>)}
          </select>
        </label>
        <div className="field" title="Inverted: the y axis grows down the page, the usual way to draw depth. Not inverted: the largest value at the top.">y axis{seg(settings.yInvert ? 'down' : 'up', [['down', 'inverted'], ['up', 'not inverted']], v => setSettings({ yInvert: v === 'down' }))}</div>
        <div className="field">y label{seg(settings.yLabelMode, [['side', 'along the axis'], ['top', 'top']], v => setSettings({ yLabelMode: v }))}</div>
        <div className="field">legend{seg<LegendPos>(settings.legendPos, [['left', 'left'], ['right', 'right'], ['bottom', 'bottom']], v => setSettings({ legendPos: v }))}</div>
        <div className="field">line{seg(settings.lineShape, [['spline', 'smooth'], ['linear', 'raw']], v => setSettings({ lineShape: v }))}</div>
        <label className="field">depth from (m)<input type="number" value={settings.depthMin} placeholder="surface" style={{ width: 92 }} onChange={e => setSettings({ depthMin: e.target.value })} /></label>
        <label className="field">depth to (m)<input type="number" value={settings.depthMax} placeholder="bottom" style={{ width: 92 }} onChange={e => setSettings({ depthMax: e.target.value })} /></label>
        <label className="field">grid lines<input type="checkbox" className="switch" checked={settings.profileGrid} onChange={e => setSettings({ profileGrid: e.target.checked })} /></label>
        <label className="field">titles<input type="checkbox" className="switch" checked={settings.profileTitles} onChange={e => setSettings({ profileTitles: e.target.checked })} /></label>
        <label className="field">graphs per row<input type="number" min={1} max={4} step={1} value={perRow} style={{ width: 64 }} aria-label="Graphs per row, 1 to 4" onChange={e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 4) setSettings({ graphsPerRow: v }) }} /></label>
        <div className="field">graphs{seg(settings.profileGraphTheme, [['light', 'light'], ['dark', 'dark']], v => setSettings({ profileGraphTheme: v }))}</div>
      </div>
      <div className="card controls" title="Any variable or channel in the files against any other, or against depth, added as an extra graph">
        <span className="small muted" style={{ alignSelf: 'center' }}>extra graph:</span>
        <label className="field">x
          <select value={xDefault} onChange={e => setPairX(e.target.value)}>
            {variables.map(v => <option key={v.name} value={v.name}>{named(v.name)}</option>)}
            {channels.length > 0 && <optgroup label="other channels in the files">{channels.map(c => <option key={c.short} value={`col:${c.short}`}>{c.desc || c.short}{c.units ? ` [${c.units}]` : ''} · {c.short}</option>)}</optgroup>}
          </select>
        </label>
        <label className="field">y
          <select value={pairY} onChange={e => setPairY(e.target.value)}>
            <option value="depth">Depth</option>
            {variables.map(v => <option key={v.name} value={v.name}>{named(v.name)}</option>)}
            {channels.length > 0 && <optgroup label="other channels in the files">{channels.map(c => <option key={c.short} value={`col:${c.short}`}>{c.desc || c.short}{c.units ? ` [${c.units}]` : ''} · {c.short}</option>)}</optgroup>}
          </select>
        </label>
        <button className="btn" onClick={addPair} disabled={!xDefault || choice(pairY).name === choice(xDefault).name}>add graph</button>
        {pairs.length > 0 && <span className="small muted">{pairs.length} extra</span>}
      </div>
      {figures.length === 0 && pairs.length === 0 && <div className="empty">Nothing to draw. Tick a variable, or widen the depth window.</div>}
      <div className="plots" style={{ '--per-row': perRow } as CSSProperties}>
        {figures.map(f => card(f.variable, f))}
        {pairs.map(p => card(p.key, p.fig, () => setSettings({ customPairs: settings.customPairs.filter(q => !(q.x === p.pair.x && q.y === p.pair.y)) })))}
      </div>
    </div>
  )
}
