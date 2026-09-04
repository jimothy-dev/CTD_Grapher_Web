import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { PlotData, Layout, LayoutAxis, ModeBarButton, PlotlyHTMLElement, DownloadImgopts } from 'plotly.js'

interface Props {
  data: Partial<PlotData>[]
  layout: Partial<Layout>
  filename?: string
  height?: number
  light?: boolean      // draw on a light surface whatever the site theme
  className?: string
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const LIGHT = { ink: '#1c2733', muted: '#5f6d78', surface: '#ffffff', grid: '#e6eae8' }

function palette(light: boolean) {
  return light
    ? { ...LIGHT }
    : { ink: css('--ink'), muted: css('--muted'), surface: css('--surface'), grid: css('--plot-grid') }
}

// A PNG button that leaves stations switched off in the legend out of the
// picture, the way the notebook's export does.
function pngButton(filename: string): ModeBarButton {
  return {
    name: 'downloadVisible',
    title: 'Download PNG (hidden stations left out)',
    icon: Plotly.Icons.camera,
    click: (gd: PlotlyHTMLElement) => {
      const hidden: number[] = []
      gd.data.forEach((t, i) => { if ((t as Partial<PlotData>).visible === 'legendonly') hidden.push(i) })
      const opts = { format: 'png', filename, width: gd.clientWidth || 900, height: gd.clientHeight || 560, scale: 3 } as unknown as DownloadImgopts
      const download = () => Plotly.downloadImage(gd, opts)
      if (!hidden.length) { void download(); return }
      const restore = () => { void Plotly.restyle(gd, { showlegend: true }, hidden) }
      void Plotly.restyle(gd, { showlegend: false }, hidden).then(download).then(restore, restore)
    },
  }
}

export default function Plot({ data, layout, filename = 'chart', height = 520, light = false, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lightRef = useRef(light)
  lightRef.current = light

  // Full draw only when the figure itself changes.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const p = palette(lightRef.current)
    const xa = (layout.xaxis ?? {}) as Partial<LayoutAxis>, ya = (layout.yaxis ?? {}) as Partial<LayoutAxis>
    const themed: Partial<Layout> = {
      ...layout,
      paper_bgcolor: p.surface, plot_bgcolor: p.surface, autosize: true,
      font: { family: css('--sans'), color: p.ink, size: 12, ...(layout.font ?? {}) },
      xaxis: { gridcolor: p.grid, ...xa, tickfont: { color: p.muted, ...(xa.tickfont ?? {}) } },
      yaxis: { gridcolor: p.grid, ...ya, tickfont: { color: p.muted, ...(ya.tickfont ?? {}) } },
    }
    void Plotly.react(el, data, themed, {
      responsive: true, displaylogo: false,
      modeBarButtonsToRemove: ['toImage'],
      modeBarButtonsToAdd: [pngButton(filename)],
    })
  }, [data, layout, filename])

  // A theme change (site switch, system preference, the light-graphs switch)
  // only restyles colours: relayout is cheap where a full redraw of several
  // spline profiles takes seconds and froze the page.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const recolour = () => {
      const gd = el as unknown as { _fullLayout?: { xaxis?: unknown; map?: unknown } }
      // A map draws its own tiles and has no themed parts; touching it while
      // its style is still loading throws inside the map library.
      if (!gd._fullLayout || gd._fullLayout.map) return
      const p = palette(lightRef.current)
      const update: Record<string, string> = { paper_bgcolor: p.surface, plot_bgcolor: p.surface, 'font.color': p.ink }
      if (gd._fullLayout.xaxis) Object.assign(update, { 'xaxis.gridcolor': p.grid, 'yaxis.gridcolor': p.grid, 'xaxis.tickfont.color': p.muted, 'yaxis.tickfont.color': p.muted })
      Plotly.relayout(el, update as unknown as Partial<Layout>).catch(() => { /* figure gone or mid-draw: nothing to recolour */ })
    }
    recolour()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', recolour)
    const obs = new MutationObserver(recolour)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { mq.removeEventListener('change', recolour); obs.disconnect() }
  }, [light])

  useEffect(() => {
    const el = ref.current
    return () => { if (el) Plotly.purge(el) }
  }, [])
  return <div ref={ref} className={(className ?? '') + (light ? ' light-plot' : '')} style={{ width: '100%', height }} />
}
