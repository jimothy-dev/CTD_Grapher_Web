import { useStore } from '../store'
import { DEFAULT_LABELS } from '../lib/labels'

// One small box per variable: type what it should be called on the graphs.
// Blank means the default. The same labels serve profiles, extra graphs and
// sections, so a name typed here shows up everywhere.
export default function LabelEditor({ items }: { items: { key: string; caption: string }[] }) {
  const labels = useStore(s => s.settings.variableLabels)
  const setSettings = useStore(s => s.setSettings)
  if (!items.length) return null
  return (
    <div className="card controls" title="What each variable is called on the graphs: axis titles, graph titles, colour bars and hover text. Clear a box to go back to the default.">
      <span className="small muted" style={{ alignSelf: 'center' }}>labels:</span>
      {items.map(it => (
        <label key={it.key} className="field">{it.caption}
          <input className="label-box" value={labels[it.key] ?? ''} placeholder={DEFAULT_LABELS[it.key] ?? it.caption} aria-label={`Label for ${it.caption}`}
            onChange={e => { const next = { ...labels }; if (e.target.value.trim()) next[it.key] = e.target.value; else delete next[it.key]; setSettings({ variableLabels: next }) }} />
        </label>
      ))}
    </div>
  )
}
