import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import type { PlotData, Layout, LayoutAxis, ModeBarButton, PlotlyHTMLElement, DownloadImgopts } from 'plotly.js'

interface Props {
  data: Partial<PlotData>[]
  layout: Partial<Layout>
  filename?: string
  height?: number
  className?: string
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
      const opts = { format: 'png', scale: 3, filename, width: gd.clientWidth || 900, height: gd.clientHeight || 560 } as unknown as DownloadImgopts
      const download = () => Plotly.downloadImage(gd, opts)
      if (!hidden.length) { void download(); return }
      const restore = () => { void Plotly.restyle(gd, { showlegend: false }, hidden).then(() => Plotly.restyle(gd, { showlegend: true }, hidden)) }
      void Plotly.restyle(gd, { showlegend: false }, hidden).then(download).then(restore, restore)
    },
  }
}

export default function Plot({ data, layout, filename = 'chart', height = 520, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const draw = () => {
      const ink = css('--ink'), muted = css('--muted'), surface = css('--surface'), sans = css('--sans')
      const xa = (layout.xaxis ?? {}) as Partial<LayoutAxis>, ya = (layout.yaxis ?? {}) as Partial<LayoutAxis>
      const themed: Partial<Layout> = {
        ...layout,
        paper_bgcolor: surface, plot_bgcolor: surface, autosize: true,
        font: { family: sans, color: ink, size: 12, ...(layout.font ?? {}) },
        xaxis: { ...xa, tickfont: { color: muted, ...(xa.tickfont ?? {}) } },
        yaxis: { ...ya, tickfont: { color: muted, ...(ya.tickfont ?? {}) } },
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
  }, [data, layout, filename])
  useEffect(() => {
    const el = ref.current
    return () => { if (el) Plotly.purge(el) }
  }, [])
  return <div ref={ref} className={className} style={{ width: '100%', height }} />
}
