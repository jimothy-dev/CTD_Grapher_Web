import { useMemo } from 'react'
import type { PlotData, Layout } from 'plotly.js'
import Plot from './Plot'
import type { GraphTheme } from '../store'

export const WIDTHS: [number, string][] = [[33, '⅓'], [50, '½'], [67, '⅔'], [100, 'full']]

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
  // optional width control, as percent of the row
  width?: number
  onWidth?: (w: number) => void
}

export default function PlotCard({ data, layout, filename, height, theme, autoTitle, title, showTitle, onTitle, note, width, onWidth }: Props) {
  const text = (title ?? '').trim() || autoTitle
  // The title takes its own band above whatever the figure already keeps at
  // the top (a top-side x axis, say), so the two never overlap. Memoised so
  // an unrelated re-render does not hand the plot a new layout to redraw.
  const withTitle = useMemo<Partial<Layout>>(() => showTitle
    ? { ...layout, title: { text, x: 0.5, xanchor: 'center', y: 1, yanchor: 'top', pad: { t: 10 }, font: { size: 15 } }, margin: { ...(layout.margin ?? {}), t: (layout.margin?.t ?? 40) + 36 } }
    : { ...layout, title: { text: '' } }, [layout, text, showTitle])
  return (
    <div className={`plot-card ${theme}`} style={width ? { flexBasis: `calc(${width}% - 18px)` } : undefined}>
      {(showTitle || onWidth) && (
        <div className="card-head">
          {showTitle
            ? <input className="inline title" value={title ?? ''} placeholder={autoTitle} aria-label="Graph title" title="Graph title. Clear it to go back to the automatic one." onChange={e => onTitle(e.target.value)} />
            : <span />}
          {onWidth && (
            <span className="seg tiny" title="Width of this graph">
              {WIDTHS.map(([w, label]) => <button key={w} className={(width ?? 33) === w ? 'on' : ''} onClick={() => onWidth(w)} aria-label={`width ${label}`}>{label}</button>)}
            </span>
          )}
        </div>
      )}
      <Plot data={data} layout={withTitle} filename={filename} height={height} theme={theme} />
      {note && <div className="note">{note}</div>}
    </div>
  )
}
