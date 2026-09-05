export default function About() {
  const ext = { target: '_blank', rel: 'noopener noreferrer' }
  return (
    <div className="about stack">
      <div>
        <h1>About</h1>
        <p className="muted">Depth profiles and transect sections from CTD casts, drawn in the browser. Nothing to install; files never leave your computer.</p>
      </div>
      <div className="card">
        <ul>
          <li>Reads Sea-Bird <span className="mono">.cnv</span> casts from any instrument, and OpenCTD <span className="mono">.csv</span> logs, for which depth, salinity and density are worked out from the raw readings.</li>
          <li>Profiles put any variable against depth, or against another variable.</li>
          <li>Transects put the stations in order along a line, let you route it with waypoints, and draw the seafloor from the casts or from NOAA or EMODnet depth maps.</li>
          <li>A colour means the same value on every section, unless you load your own palette.</li>
          <li>Everything between casts is interpolated. The station markers and the black seafloor show what was measured.</li>
          <li>Your files and settings stay in this tab and are gone when it closes.</li>
        </ul>
      </div>
      <div className="card">
        <ul>
          <li><a href="https://github.com/jimothy-dev/CTD_Grapher_Web" {...ext}>Source on GitHub</a></li>
          <li><a href="https://colab.research.google.com/github/jimothy-dev/CTD_Grapher_v2/blob/main/CTD_Grapher_v2.ipynb" {...ext}>The Colab notebook</a> it grew out of</li>
          <li><a href="https://github.com/jimothy-dev" {...ext}>jimothy-dev</a></li>
        </ul>
        <p className="muted small">GPL-3.0. Example casts collected by students of TGEOS 445, Estuarine Field Studies, University of Washington Tacoma, May 2026.</p>
      </div>
    </div>
  )
}
