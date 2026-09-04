# CTD Grapher

Depth profiles and transect sections from Sea-Bird `.cnv` CTD casts, in the browser. Nothing to install, files never leave your computer.

**Use it:** https://jimothy-dev.github.io/CTD_Grapher_Web/

- **Stations** — drop in any number of `.cnv` files. Names come from the filenames and can be edited. Switch stations in and out of the active set; both tools graph the active ones. Positions are read from the header when present, or typed in any usual format.
- **Profiles** — one graph per variable, active stations overlaid, depth down the page. Depth window, smooth or raw lines, PNG download that leaves hidden stations out.
- **Transect** — drag stations into order along the line, label them, add seafloor points between them (distance from the previous station and depth, read off a chart). Station map, one section per variable, fixed colour ranges per variable, optional Surfer `.clr` colour map.

Uploads and settings persist while moving between pages and are gone on reload.

The same graphs as a Colab notebook: [CTD_Grapher_v2](https://github.com/jimothy-dev/CTD_Grapher_v2).

## Develop

```
npm install
npm run dev
npm run build
```

React, TypeScript, Vite, Plotly.js. Deployed to GitHub Pages by the workflow in `.github/workflows/`.

## Limitations

- No sensor corrections: process casts in Sea-Bird software first. Raw casts are cut to the downcast for display only.
- On a section everything between stations is interpolated, and the seafloor is the casts' deepest readings plus the points you add, not surveyed bathymetry. Online bathymetry is planned.

Licence: GPL-3.0. Example casts collected by students of TGEOS 445, Estuarine Field Studies, University of Washington Tacoma, May 2026.
