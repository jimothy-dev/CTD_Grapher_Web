import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { PlotData, Layout, LayoutAxis, ModeBarButton, PlotlyHTMLElement, DownloadImgopts } from 'plotly.js'
import type { GraphTheme } from '../store'

interface Props {
  data: Partial<PlotData>[]
  layout: Partial<Layout>
  filename?: string
  height?: number
  theme: GraphTheme      // the graph's own look, independent of the site
  className?: string
  onReady?: (gd: PlotlyHTMLElement) => void   // after each draw, for pages that hook the figure
}

// Fixed palettes, so a graph can be dark on a light site and the other way
// round, and exports look the same everywhere.
const PALETTES: Record<GraphTheme, { ink: string; muted: string; surface: string; grid: string }> = {
  light: { ink: '#1c2733', muted: '#5f6d78', surface: '#ffffff', grid: '#e6eae8' },
  dark: { ink: '#e6ecef', muted: '#98a5ae', surface: '#172028', grid: '#26313b' },
}
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

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

export default function Plot({ data, layout, filename = 'chart', height = 520, theme, className, onReady }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const themeRef = useRef(theme)
  themeRef.current = theme
  const readyRef = useRef(onReady)
  readyRef.current = onReady

  // Full draw only when the figure itself changes.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const p = PALETTES[themeRef.current]
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
    }).then(gd => readyRef.current?.(gd as PlotlyHTMLElement), () => { /* purged mid-draw */ })
  }, [data, layout, filename])

  // A theme change only restyles colours: relayout is cheap where a full
  // redraw of several spline profiles takes seconds and froze the page.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const gd = el as unknown as { _fullLayout?: { xaxis?: unknown; map?: unknown } }
    // A map draws its own tiles and has no themed parts; touching it while
    // its style is still loading throws inside the map library.
    if (!gd._fullLayout || gd._fullLayout.map) return
    const p = PALETTES[theme]
    const update: Record<string, string> = { paper_bgcolor: p.surface, plot_bgcolor: p.surface, 'font.color': p.ink }
    if (gd._fullLayout.xaxis) Object.assign(update, { 'xaxis.gridcolor': p.grid, 'yaxis.gridcolor': p.grid, 'xaxis.tickfont.color': p.muted, 'yaxis.tickfont.color': p.muted })
    Plotly.relayout(el, update as unknown as Partial<Layout>).catch(() => { /* figure gone or mid-draw */ })
  }, [theme])

  // Plotly only listens for window resizes; a card that changes width when
  // the graphs-per-row setting changes needs telling.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = { w: el.clientWidth, h: el.clientHeight }, raf = 0
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || (w === last.w && h === last.h)) return
      last = { w, h }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { if ((el as unknown as { _fullLayout?: unknown })._fullLayout) void Plotly.Plots.resize(el) })
    })
    ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  useEffect(() => {
    const el = ref.current
    return () => { if (el) Plotly.purge(el) }
  }, [])
  return <div ref={ref} className={className} style={{ width: '100%', height }} />
}
