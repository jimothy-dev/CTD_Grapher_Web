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
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const draw = () => {
      const ink = light ? LIGHT.ink : css('--ink'), muted = light ? LIGHT.muted : css('--muted')
      const surface = light ? LIGHT.surface : css('--surface'), grid = light ? LIGHT.grid : css('--plot-grid')
      const sans = css('--sans')
      const xa = (layout.xaxis ?? {}) as Partial<LayoutAxis>, ya = (layout.yaxis ?? {}) as Partial<LayoutAxis>
      const themed: Partial<Layout> = {
        ...layout,
        paper_bgcolor: surface, plot_bgcolor: surface, autosize: true,
        font: { family: sans, color: ink, size: 12, ...(layout.font ?? {}) },
        xaxis: { gridcolor: grid, ...xa, tickfont: { color: muted, ...(xa.tickfont ?? {}) } },
        yaxis: { gridcolor: grid, ...ya, tickfont: { color: muted, ...(ya.tickfont ?? {}) } },
      }
      void Plotly.react(el, data, themed, {
        responsive: true, displaylogo: false,
        modeBarButtonsToRemove: ['toImage'],
        modeBarButtonsToAdd: [pngButton(filename)],
      })
    }
    draw()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', draw)
    const obs = new MutationObserver(draw)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { mq.removeEventListener('change', draw); obs.disconnect() }
  }, [data, layout, filename, light])
  useEffect(() => {
    const el = ref.current
    return () => { if (el) Plotly.purge(el) }
  }, [])
  return <div ref={ref} className={(className ?? '') + (light ? ' light-plot' : '')} style={{ width: '100%', height }} />
}
