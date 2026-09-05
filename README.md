# CTD Grapher

Depth profiles and transect sections from Sea-Bird `.cnv` CTD casts, in the browser. Nothing to install; files never leave your computer.

**Use it:** https://jimothy-dev.github.io/CTD_Grapher_Web/

![Transect page: stations in order with a waypoint routing the line through the passage, the station map, and a temperature section](docs/transect.png)

- **Stations** — drop in any number of `.cnv` files, or load the example casts. Names come from the filenames and can be edited. Switch stations in and out of the active set; both tools graph the active ones. Positions are read from the header or from latitude/longitude columns, or typed in any usual format.
- **Profiles** — one graph per variable, active stations overlaid, depth down the page; or any variable against any other. Legend position, titles, graphs per row, grid lines, light or dark graphs, PNG download.
- **Transect** — stations are ordered along the line automatically (from the most north-western one, nearest next) or by dragging; label them, and drag waypoints on the map so the line follows the water rather than crossing land, or carries on before the first station and beyond the last. The seafloor comes from the casts and the depths you give waypoints, or is read along the routed line from NOAA NCEI's DEM mosaic (worldwide) or EMODnet Bathymetry (Europe). Between stations the field is gridded by a shape-preserving curve, objective analysis (Gauss-Markov), or straight lines. Station map, one section per variable with fixed color ranges so a color always means the same value, or your own palette file (Surfer `.clr`/`.lvl`, GMT `.cpt`, ODV `.pal`, and more).

![Profiles page](docs/profiles.png)

Uploads and settings stay in the browser tab, including across a reload, and are gone when the tab closes.

The same graphs as a Colab notebook: [CTD_Grapher_v2](https://github.com/jimothy-dev/CTD_Grapher_v2).

## Known limits

- Sea-Bird `.cnv` only. Process casts in Sea-Bird software first: no sensor corrections are applied here, and a raw cast is only trimmed to its downcast for display.
- On a section everything between stations is interpolated: a shape-preserving curve through the casts, objective analysis with a Markov covariance (which eases towards the mean between stations far apart compared with its scale), or straight lines. None of them is a measurement.
- Casts are checked against usual ranges (salinity 0 to 60, temperature -3 to 45 °C, and so on) and flagged when they fall outside; nothing is corrected.
- Surveyed bathymetry is sampled along the routed line from NOAA NCEI's DEM mosaic (coastal DEMs to 1/9 arc-second, ETOPO 2022 elsewhere) or EMODnet (European seas); a cast that went deeper than the grid keeps its own depth. GEBCO's own services cannot be read by a page in the browser, though ETOPO 2022 is built on GEBCO in deep water. Datums differ: EMODnet is relative to lowest astronomical tide, the casts to the sea surface on the day.
- Fixed color ranges are chosen for Puget Sound and temperate estuaries; switch to "this survey" or load a palette elsewhere.
- Two instruments may log the same variable in different units (oxygen in mg/L and mL/L, say). The shared channel is preferred, and a remaining mismatch is flagged under the graph rather than converted.
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
