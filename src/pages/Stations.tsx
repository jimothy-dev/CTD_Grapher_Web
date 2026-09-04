import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { useStore } from '../store'
import { formatCoordinate } from '../lib/geo'

const EXAMPLE_BASE = 'https://raw.githubusercontent.com/jimothy-dev/CTD_Grapher_v2/main/example_data/'
const EXAMPLES = ['Station_11.cnv', 'Station_12.cnv', 'Station_15.cnv', 'Station_16.cnv', 'Station_17.cnv']
// casts from other instruments and places, shipped with the app (see public/samples/SOURCES.md)
const SAMPLE_BASE = `${import.meta.env.BASE_URL}samples/`
const SAMPLES = ['NCEI_GulfOfMexico_2010_SBE9.cnv', 'OOI_Pioneer_2015_SBE9.cnv', 'NorthSea_2017_SBE25plus.cnv', 'Nansen_2008_SBE9.cnv', 'Hakai_Quadra_2024_SBE19plus.cnv']

export default function Stations() {
  const stations = useStore(s => s.stations)
  const notices = useStore(s => s.notices)
  const { addFiles, removeStation, rename, setActive, setAllActive, setPosition, setAllHemisphere, dismissNotices } = useStore()
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const take = async (list: FileList | File[]) => {
    const files = await Promise.all([...list].map(async f => ({ name: f.name, buffer: await f.arrayBuffer() })))
    addFiles(files)
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files) }
  const onPick = (e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) void take(e.target.files); e.target.value = '' }
  const fetchAll = async (base: string, names: string[], what: string) => {
    setBusy(true)
    try {
      const files = await Promise.all(names.map(async n => {
        const r = await fetch(base + n)
        if (!r.ok) throw new Error(`${n}: ${r.status}`)
        return { name: n, buffer: await r.arrayBuffer() }
      }))
      addFiles(files)
    } catch { alert(`Could not fetch the ${what}. Check the connection and try again.`) }
    setBusy(false)
  }
  const loadExamples = () => fetchAll(EXAMPLE_BASE, EXAMPLES, 'example casts')
  const loadSamples = () => fetchAll(SAMPLE_BASE, SAMPLES, 'sample casts')

  const activeCount = stations.filter(s => s.active).length
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Stations</h1>
          <p className="muted small">Add Sea-Bird <span className="mono">.cnv</span> casts. Switch stations in and out of the active set; both tools graph the active ones.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={loadExamples} disabled={busy} title="Five casts from Colvos and East Passage, Puget Sound, May 2026">{busy ? 'Loading…' : 'Load example casts'}</button>
          <button className="btn quiet" onClick={loadSamples} disabled={busy} title="Casts from other instruments, places and decades, for trying things out (public data, see samples/SOURCES.md in the repository)">other public casts</button>
        </div>
      </div>

      <div className={'drop' + (over ? ' over' : '')}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        onClick={() => input.current?.click()} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') input.current?.click() }}>
        <strong>Drop .cnv files here</strong>
        <span className="muted small">or click to choose. Any number, any Sea-Bird instrument. Nothing is uploaded anywhere: files stay in this tab.</span>
        <input ref={input} type="file" accept=".cnv" multiple onChange={onPick} />
      </div>

      {notices.length > 0 && (
        <div className="notice">
          <ul>{notices.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <button className="btn quiet tiny" onClick={dismissNotices}>dismiss</button>
        </div>
      )}

      {stations.length > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="row">
              <span className="small muted">{activeCount} of {stations.length} active</span>
              <button className="btn tiny" onClick={() => setAllActive(true)}>all on</button>
              <button className="btn tiny" onClick={() => setAllActive(false)}>all off</button>
            </div>
            <div className="row small muted">
              <span>hemisphere, all rows:</span>
              <span className="seg">
                <button onClick={() => setAllHemisphere('lat', 'N')}>N</button>
                <button onClick={() => setAllHemisphere('lat', 'S')}>S</button>
              </span>
              <span className="seg">
                <button onClick={() => setAllHemisphere('lon', 'W')}>W</button>
                <button onClick={() => setAllHemisphere('lon', 'E')}>E</button>
              </span>
            </div>
          </div>
          <div className="stations">
            {stations.map(s => {
              const badLat = s.latText.trim() !== '' && s.lat === null
              const badLon = s.lonText.trim() !== '' && s.lon === null
              return (
                <div key={s.id} className={'station' + (s.active ? '' : ' off')}>
                  <span className="dot" style={{ background: s.color }} />
                  <div className="who">
                    <input className="inline" value={s.name} onChange={e => rename(s.id, e.target.value)} aria-label="Station name" />
                    <div className="meta">{s.file} · {s.cast.nrows} rows{s.deepest !== null ? ` · to ${s.deepest.toFixed(0)} m` : ''}{s.dropped ? ' · downcast only' : ''}</div>
                  </div>
                  <div className="coords">
                    <label className="field">latitude
                      <input className={'coord' + (badLat ? ' bad' : '')} value={s.latText} placeholder="e.g. 47 24.072 N" aria-label="Latitude"
                        onChange={e => setPosition(s.id, e.target.value, s.lonText)} />
                    </label>
                    <label className="field">longitude
                      <input className={'coord' + (badLon ? ' bad' : '')} value={s.lonText} placeholder="e.g. 122 31.5 W" aria-label="Longitude"
                        onChange={e => setPosition(s.id, s.latText, e.target.value)} />
                    </label>
                    <div className="conv">{s.lat !== null && s.lon !== null ? `${formatCoordinate(s.lat, 'lat')}  ${formatCoordinate(s.lon, 'lon')}` : (badLat || badLon ? 'not a coordinate' : 'only needed for the map and transect')}</div>
                  </div>
                  <div className="ctl">
                    <label className="field" style={{ alignItems: 'center' }}>active<input type="checkbox" className="switch" checked={s.active} onChange={e => setActive(s.id, e.target.checked)} aria-label={`${s.name} active`} /></label>
                    <button className="remove" onClick={() => removeStation(s.id)} aria-label={`Remove ${s.name}`}>remove</button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>Coordinates in any usual form: 47.4012 · 47 24.072 · 47°24'04" · 4724.072, with N/S/E/W or a minus sign.</p>
        </div>
      )}

      {stations.length === 0 && <div className="empty">No stations yet.</div>}
    </div>
  )
}
