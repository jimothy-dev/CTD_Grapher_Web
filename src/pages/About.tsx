export default function About() {
  return (
    <div className="about stack">
      <div>
        <h1>About</h1>
        <p className="muted">Depth profiles and transect sections from Sea-Bird <span className="mono">.cnv</span> CTD casts, drawn in the browser. Files never leave your computer.</p>
      </div>
      <div className="card">
        <h2>What it does, and does not</h2>
        <ul>
          <li>Reads any Sea-Bird <span className="mono">.cnv</span>: columns come from the header, so the instrument does not matter.</li>
          <li>Raw casts are cut to the downcast for display. No sensor corrections are applied; process casts in Sea-Bird software first.</li>
          <li>On a section, everything between stations is interpolated. The black seafloor joins each cast's deepest reading and the points you add. Ocean Data View does this in more depth; this is the no-install, shareable version.</li>
          <li>Section colours are fixed per variable so the same colour means the same value on every section.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Links</h2>
        <ul>
          <li><a href="https://github.com/jimothy-dev/CTD_Grapher_Web">This app on GitHub</a></li>
          <li><a href="https://colab.research.google.com/github/jimothy-dev/CTD_Grapher_v2/blob/main/CTD_Grapher_v2.ipynb">The Colab notebook</a>, the same graphs as a notebook, with its <a href="https://github.com/jimothy-dev/CTD_Grapher_v2">source</a></li>
          <li><a href="https://github.com/jimothy-dev">jimothy-dev on GitHub</a></li>
        </ul>
        <p className="muted small">GPL-3.0. Example casts collected by students of TGEOS 445, Estuarine Field Studies, University of Washington Tacoma, May 2026, in Colvos Passage and East Passage, Puget Sound.</p>
      </div>
    </div>
  )
}
