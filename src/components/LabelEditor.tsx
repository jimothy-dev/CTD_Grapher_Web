import { useStore } from '../store'
import { DEFAULT_LABELS } from '../lib/labels'
import { prettyUnits } from '../lib/units'

// Two small boxes per variable: what it is called on the graphs, and the unit
// shown beside it. Blank means the default, and for the unit that means
// whatever the files say. The same entries serve profiles, extra graphs, cast
// plots and sections, so anything typed here shows up everywhere.
export default function LabelEditor({ items }: { items: { key: string; caption: string; units?: string }[] }) {
  const labels = useStore(s => s.settings.variableLabels)
  const units = useStore(s => s.settings.variableUnits)
  const setSettings = useStore(s => s.setSettings)
  if (!items.length) return null
  const put = (map: Record<string, string>, key: string, value: string, field: 'variableLabels' | 'variableUnits') => {
    const next = { ...map }
    if (value.trim()) next[key] = value; else delete next[key]
    setSettings({ [field]: next })
  }
  return (
    <div className="card controls" title="What each variable is called on the graphs and the unit shown beside it: axis titles, graph titles, colour bars and hover text. Clear a box to go back to the default. A unit typed here is only a name: no values are converted, and casts that really are in different units are still reported under the graph.">
      <span className="small muted" style={{ alignSelf: 'center' }}>labels and units:</span>
      {items.map(it => (
        <div key={it.key} className="field">{it.caption}
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input className="label-box" value={labels[it.key] ?? ''} placeholder={DEFAULT_LABELS[it.key] ?? it.caption} aria-label={`Label for ${it.caption}`}
              onChange={e => put(labels, it.key, e.target.value, 'variableLabels')} />
            <input className="unit-box" value={units[it.key] ?? ''} placeholder={it.units ? prettyUnits(it.units, false) : 'units'} aria-label={`Units for ${it.caption}`}
              onChange={e => put(units, it.key, e.target.value, 'variableUnits')} />
          </span>
        </div>
      ))}
    </div>
  )
}
