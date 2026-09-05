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
        <h2>How it is done</h2>
        <ul>
          <li><b>Between casts.</b> Each cast is put on a common depth grid, then at every depth a shape-preserving cubic (PCHIP, Fritsch and Carlson 1980) runs through the stations; it never overshoots the two casts on either side, and is a straight line when there are only two.</li>
          <li><b>Station order.</b> From the most north-western station to the nearest one not yet visited, over and over; distances along the line by the haversine formula, through any waypoints.</li>
          <li><b>Seafloor from a depth map.</b> The map is sampled about 400 times along the routed line and the samples joined; where a cast reached deeper than the map, the cast's depth is kept.</li>
          <li><b>OpenCTD logs.</b> Depth from pressure by the UNESCO 1983 formula, salinity from conductivity by PSS-78, density (sigma-t) by EOS-80; surface pressure taken from the lowest reading when the logger saw air.</li>
          <li><b>Units and colours.</b> When two instruments log oxygen in mL/L and mg/L, 1 mL/L = 1.42903 mg/L; other mismatches are flagged, not converted. Section colours are the cmocean scales with fixed ranges per variable.</li>
        </ul>
      </div>
      <div className="card">
        <ul>
          <li><a href="https://github.com/jimothy-dev/CTD_Grapher_Web" {...ext}>Source on GitHub</a></li>
          <li><a href="https://colab.research.google.com/github/jimothy-dev/CTD_Grapher_v2/blob/main/CTD_Grapher_v2.ipynb" {...ext}>The Colab notebook</a> it grew out of</li>
          <li><a href="https://doi.org/10.5281/zenodo.22371639" {...ext}>Cite it</a>: Simpson, J. (2026). CTD Grapher. Zenodo, doi 10.5281/zenodo.22371639</li>
          <li><a href="https://github.com/jimothy-dev" {...ext}>jimothy-dev</a></li>
        </ul>
        <p className="muted small">GPL-3.0. Example casts collected by students of TGEOS 445, Estuarine Field Studies, University of Washington Tacoma, May 2026.</p>
      </div>
    </div>
  )
}
