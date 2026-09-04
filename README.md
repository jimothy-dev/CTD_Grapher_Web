# CTD Grapher

Depth profiles and transect sections from Sea-Bird `.cnv` CTD casts, in the browser. Nothing to install; files never leave your computer.

**Use it:** https://jimothy-dev.github.io/CTD_Grapher_Web/

![Transect page: stations in order with a waypoint routing the line through the passage, the station map, and a temperature section](docs/transect.png)

- **Stations** — drop in any number of `.cnv` files, or load the example casts. Names come from the filenames and can be edited. Switch stations in and out of the active set; both tools graph the active ones. Positions are read from the header or from latitude/longitude columns, or typed in any usual format.
- **Profiles** — one graph per variable, active stations overlaid, depth down the page; or any variable against any other. Legend position, titles, widths, light or dark graphs, PNG download.
- **Transect** — drag stations into order along the line, label them, add seafloor points between, before or beyond them, and drag waypoints on the map so the line follows the water rather than crossing land. Station map, one section per variable with fixed colour ranges so a colour always means the same value, or your own palette file (Surfer `.clr`/`.lvl`, GMT `.cpt`, ODV `.pal`, and more).

![Profiles page](docs/profiles.png)

Uploads and settings stay in the browser tab, including across a reload, and are gone when the tab closes.

The same graphs as a Colab notebook: [CTD_Grapher_v2](https://github.com/jimothy-dev/CTD_Grapher_v2).

## Known limits

- Sea-Bird `.cnv` only. Process casts in Sea-Bird software first: no sensor corrections are applied here, and a raw cast is only trimmed to its downcast for display.
- On a section everything between stations is interpolated, and the seafloor is the casts' deepest readings plus the points and waypoint depths you add, not surveyed bathymetry. Bathymetry from GEBCO along the routed line is planned.
- Fixed colour ranges are chosen for Puget Sound and temperate estuaries; switch to "this survey" or load a palette elsewhere.
- Tested on the example casts and on 20 public files from SBE 9, 19, 19plus, 25, 25plus and 37 instruments. Send a `.cnv` that does not load.

## Develop

```
npm install
npm run dev
npm run build
```

React, TypeScript, Vite, Plotly.js. Deployed to GitHub Pages by the workflow in `.github/workflows/`. Public sample casts for testing are in `public/samples/` with their sources.

## Cite

Simpson, J. (2026). CTD Grapher (v1.0.0). https://github.com/jimothy-dev/CTD_Grapher_Web (see `CITATION.cff`).

Licence GPL-3.0. Example casts collected by students of TGEOS 445, Estuarine Field Studies, University of Washington Tacoma, May 2026.
