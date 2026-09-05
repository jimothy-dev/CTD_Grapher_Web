export default function About() {
  const ext = { target: '_blank', rel: 'noopener noreferrer' }
  return (
    <div className="about stack">
      <div>
        <h1>About</h1>
        <p className="muted">Depth profiles and transect sections from Sea-Bird <span className="mono">.cnv</span> CTD casts, drawn in the browser. Files never leave your computer.</p>
      </div>
      <div className="card">
        <h2>What it does, and does not</h2>
        <ul>
          <li>Reads any Sea-Bird <span className="mono">.cnv</span>: columns come from the header, so the instrument does not matter. Positions come from the header or from latitude and longitude columns when the file has them. Also reads <a href="https://github.com/OceanographyforEveryone/OpenCTD" {...ext}>OpenCTD</a> <span className="mono">.csv</span> logs, deriving depth (UNESCO 1983), salinity (PSS-78) and sigma-t (EOS-80) from the raw pressure, temperature and conductivity.</li>
          <li>Raw casts are cut to the downcast for display. No sensor corrections are applied; process casts in Sea-Bird software first.</li>
          <li>On a section, everything between stations is interpolated: a shape-preserving curve through the casts at every depth, never outside the two casts on either side. Ocean Data View does this in more depth; this is the no-install, shareable version.</li>
          <li>The black seafloor joins each cast's deepest reading and the depths you give waypoints, or is read along the routed line from <a href="https://www.ncei.noaa.gov/products/seafloor-mapping" {...ext}>NOAA NCEI's DEM mosaic</a> (worldwide; coastal DEMs to 1/9 arc-second, ETOPO 2022 elsewhere) or <a href="https://emodnet.ec.europa.eu/en/bathymetry" {...ext}>EMODnet Bathymetry</a> (European seas). GEBCO's own grid cannot be read by a page in the browser; ETOPO 2022 is built on it in deep water.</li>
          <li>Section colors are fixed per variable so the same color means the same value on every section.</li>
          <li>Your files and settings stay in this browser tab, including across a reload, and are gone when the tab closes.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Links</h2>
        <ul>
          <li><a href="https://github.com/jimothy-dev/CTD_Grapher_Web" {...ext}>This app on GitHub</a></li>
          <li><a href="https://colab.research.google.com/github/jimothy-dev/CTD_Grapher_v2/blob/main/CTD_Grapher_v2.ipynb" {...ext}>The Colab notebook</a>, the same graphs as a notebook, with its <a href="https://github.com/jimothy-dev/CTD_Grapher_v2" {...ext}>source</a></li>
          <li><a href="https://github.com/jimothy-dev" {...ext}>jimothy-dev on GitHub</a></li>
        </ul>
        <p className="muted small">GPL-3.0. Example casts collected by students of TGEOS 445, Estuarine Field Studies, University of Washington Tacoma, May 2026, in Colvos Passage and East Passage, Puget Sound.</p>
      </div>
    </div>
  )
}
