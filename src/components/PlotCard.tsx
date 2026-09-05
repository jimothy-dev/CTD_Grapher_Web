import { useMemo } from 'react'
import type { PlotData, Layout } from 'plotly.js'
import Plot from './Plot'
import type { GraphTheme } from '../store'

interface Props {
  data: Partial<PlotData>[]
  layout: Partial<Layout>
  filename: string
  height?: number
  theme: GraphTheme
  // title handling: the auto title is shown in an editable box; blank means
  // "use the auto title", and titles can be switched off for the page
  autoTitle: string
  title: string | undefined
  showTitle: boolean
  onTitle: (t: string) => void
  note?: string
  onRemove?: () => void
}

export default function PlotCard({ data, layout, filename, height, theme, autoTitle, title, showTitle, onTitle, note, onRemove }: Props) {
  const text = (title ?? '').trim() || autoTitle
  // The title takes its own band above whatever the figure already keeps at
  // the top (a top-side x axis, say), so the two never overlap. Memoised so
  // an unrelated re-render does not hand the plot a new layout to redraw.
  const withTitle = useMemo<Partial<Layout>>(() => showTitle
    ? { ...layout, title: { text, x: 0.5, xanchor: 'center', y: 1, yanchor: 'top', pad: { t: 10 }, font: { size: 15 } }, margin: { ...(layout.margin ?? {}), t: (layout.margin?.t ?? 40) + 36 } }
    : { ...layout, title: { text: '' } }, [layout, text, showTitle])
  return (
    <div className={`plot-card ${theme}`}>
      {(showTitle || onRemove) && (
        <div className="card-head">
          {showTitle
            ? <input className="inline title" value={title ?? ''} placeholder={autoTitle} aria-label="Graph title" title="Graph title. Clear it to go back to the automatic one." onChange={e => onTitle(e.target.value)} />
            : <span style={{ flex: 1 }} />}
          {onRemove && <button className="remove" onClick={onRemove} aria-label={`Remove ${autoTitle}`}>remove</button>}
        </div>
      )}
      <Plot data={data} layout={withTitle} filename={filename} height={height} theme={theme} />
      {note && <div className="note">{note}</div>}
    </div>
  )
}
