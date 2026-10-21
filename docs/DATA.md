# City data: Downtown Dubai from OpenStreetMap

`data/city.json` is the real Downtown Dubai: buildings, roads, the Metro viaduct, Burj Lake, parks and trees, in a 3.2 × 3.2 km box centred on the Burj Khalifa.

## Source and licence

- **Source:** [OpenStreetMap](https://www.openstreetmap.org), fetched through the Overpass API (`overpass-api.de`, with `overpass.kumi.systems` as a mirror). The OSM base timestamp is stored in `meta.osmTimestamp` (the current build uses 2026-06-01T08:52:28Z).
- **Licence:** OSM data is © OpenStreetMap contributors and available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- `data/city.json`, `data/city.json.gz`, `data/burj_khalifa_osm.json` and `data/raw/osm_downtown.json` are a **Derived Database under ODbL 1.0**. If you redistribute them, keep them under ODbL and keep the attribution. The app's code stays MIT. Rendered images and video of the scene count as a *Produced Work*, which requires attribution only.
- **Required attribution** (show it in the app UI or credits, and in any video):

  > Map data © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright

- The Burj Khalifa itself is **not** taken from OSM. The app has its own procedural model. Only its OSM outline is used, to orient that model.

## Rebuild

```sh
~/.whatif-venv/bin/python tools/data/fetch_osm.py          # one Overpass query, cached in data/raw/ (--force to refresh)
~/.whatif-venv/bin/python tools/data/build_city.py         # -> data/city.json, city.json.gz, burj_khalifa_osm.json, preview.png
```

- Requirements: Python 3.9+ standard library. PIL is used only for `preview.png`. Shapely and numpy are not used.
- `fetch_osm.py` falls back to `curl` if Python's TLS handshake fails. macOS system Python with LibreSSL fails it against overpass-api.de.
- The fetch box is ±1700 m. The output is clipped to ±1600 m:
  - Buildings are kept or dropped by their centroid.
  - Area features are clipped with Sutherland-Hodgman.
  - Lines are clipped with Liang-Barsky.
- The build takes under 1 s.

## Coordinates

| | |
|---|---|
| Origin | Burj Khalifa base, lat0 25.197139, lon0 55.274111 |
| x | east, `(lon − lon0)·cos(lat0)·111320` m |
| z | **south**, `−(lat − lat0)·110574` m |
| y | up |
| Box | x, z ∈ [−1600, 1600] |
| Precision | 0.1 m; whole numbers are written as integers |

**Winding:** outer rings are counter-clockwise **seen from above** (north up, east right). That means CCW in the (x, −z) plane, which is a *negative* shoelace sum in raw (x, z). Holes are clockwise. Rings are open: the first point is not repeated.

## Schema (`data/city.json`)

```jsonc
{
  "meta": {
    "bbox": [-1600,-1600,1600,1600], "lat0": 25.197139, "lon0": 55.274111,
    "proj": "...", "winding": "...",
    "counts": {"buildings": 2952, ...},
    "sources": [...], "osmTimestamp": "2026-06-01T08:52:28Z",
    "license": "ODbL 1.0, © OpenStreetMap contributors", "attribution": "© OpenStreetMap contributors",
    "stats": {"hTagged": 732, "hFromLevels": 95, "hEst": 2125, ...},
    "burjKhalifa": {"osmId", "centroid", "area_m2", "outline", "wingTips", "excludedParts", "note"}
  },
  "buildings": [{
    "id": "w532836516",        // OSM type letter (w/r) + id
    "name": "Address Boulevard", // optional (name:en preferred)
    "type": "yes",             // building / building:part value (yes, apartments, retail, house, ...)
    "h": 370,                  // top of the solid, metres above ground (includes roof)
    "minH": 0,                 // base of the solid (min_height or min_level·3.6) — >0 for podium-top parts, skybridges
    "poly": [[x,z],...],       // outer ring, CCW from above, open
    "holes": [[[x,z],...]],    // optional, CW
    "levels": 73,              // optional building:levels
    "part": true,              // optional: this is a building:part (stack it, don't merge it)
    "roof": "dome", "roofH": 6,// optional, only non-flat roof:shape
    "colour": "#..", "roofColour": "..", "material": "glass", // optional, as tagged
    "hEst": true,              // optional: height is a typology guess, not from tags
    "landmark": true           // optional: h >= 150 m
  }],                          // sorted tallest first
  "roads": [{
    "cls": "primary",          // highway=* (construction → its construction=* class); footway/steps/cycleway/pedestrian/service included
    "width": 15, "lanes": 4,   // width = tagged width or lanes × per-class lane width (+1 m for motorway/trunk/primary); paths have no lanes
    "oneway": 1,               // optional: 1 = along pts, -1 = against
    "bridge": 1, "tunnel": 1, "layer": 1, "level": 1, // optional
    "name": "Sheikh Zayed Road",// optional (not on paths)
    "pts": [[x,z],...]
  }],
  "rail": [{"kind": "metro"|"tram"|"rail", "bridge": 0|1, "layer"?, "tunnel"?, "name"?, "pts": [[x,z],...]}],
  "water": [{"kind": "lake"|"canal"|"reflecting_pool"|"pool"|"fountain"|"water"|..., "name"?, "poly", "holes"?}],
  "green": [{"kind": "park"|"garden"|"grass"|"pitch"|"playground"|"sand"|..., "name"?, "poly", "holes"?}],
  "trees": [[x,z],...],        // natural=tree nodes + points every 8 m along natural=tree_row
  "plazas": [{"kind": "pedestrian"|"footway"|"square"|..., "poly"}],   // highway=pedestrian area=yes, area:highway, place=square
  "parking": [{"kind": "surface"|"multi-storey"|..., "name"?, "poly"}],  // amenity=parking areas (buildings are in buildings[])
  "landmarks": [{"name", "x", "z", "osm"?, "h"?, "approx"?}]
}
```

`water`, `green`, `plazas` and `parking` are sorted largest first.

## Processing rules

### Buildings and building parts

1. **Parts vs outlines.** A `building:part` belongs to the smallest `building` outline that contains its centroid.
   - If the host's parts cover at least 40 % of its area, the outline is dropped and the parts represent the building. This is the Simple 3D Buildings rule, which avoids double counting.
   - Below 40 % coverage, the outline is kept as well (82 cases). Those parts usually sit inside or on top of a podium, so expect some coplanar overlap.
2. **Height:**
   - Use the `height` tag first.
   - Otherwise use (`building:levels` + `roof:levels`) × 3.6 + `roof:height`.
   - Otherwise use a typology default and set `hEst: true`. Defaults: villa/house 8 · residential/apartments 20 · retail 14 · commercial/office 30 · hotel 40 · tower 60 · `yes` 12.
   - Base: `min_height`, otherwise `building:min_level` × 3.6.
3. Polygons are simplified with Douglas-Peucker at 0.5 m. Footprints smaller than 12 m² are dropped (147 dropped).
4. **Burj Khalifa** (OSM way 446646206) and the 35 features whose centroid lies inside its outline are excluded. Their ids are in `meta.burjKhalifa.excludedParts`.

## Burj Khalifa footprint (for orienting the procedural model)

`data/burj_khalifa_osm.json` and `meta.burjKhalifa` hold this information:

- **Outline:** a Y-shaped polygon of 7,577 m².
- **Centroid:** (x 4.6, z −7.6), that is 4.6 m east and 7.6 m north of lat0/lon0.

**Wing tips**, measured from the centroid. Bearings are in degrees clockwise from true north.

| Wing | Bearing | Tip distance | Tip (x, z) |
|---|---|---|---|
| NE wing | **67.2°** | 92.0 m | (89.4, −43.3) |
| S wing | **185.5°** | 93.3 m | (−4.3, 85.2) |
| NW wing | **306.6°** | 91.6 m | (−68.9, −62.3) |

- The wings are about 120° apart: 118.3°, 121.1° and 120.6°.
- In app coordinates, a bearing *b* points along (x, z) = (sin b, −cos b).
- In three.js, if the model's wing 0 points to +x (bearing 90°), rotate it by `rotation.y = (90 − 67.2)·π/180 ≈ +0.398 rad`. Positive y rotation turns +x towards −z, which is north. Verify this against the model's own wing axis.

## Consuming `city.json` in three.js

### Building extrusion

```js
const s = new THREE.Shape(b.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
(b.holes || []).forEach(h => s.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z)))));
const g = new THREE.ExtrudeGeometry(s, { depth: b.h - b.minH, bevelEnabled: false });
g.rotateX(-Math.PI / 2);      // shape (x, -z) -> world (x, 0, z), extrusion goes +y
g.translate(0, b.minH, 0);
```

- Building shapes in the (x, −z) plane are already CCW (outer) and CW (holes). ExtrudeGeometry also fixes winding by itself.
- If you triangulate yourself with `ShapeUtils`/earcut in raw (x, z), the outer ring comes out *clockwise*, so flip it or flip the face normals.

### Building parts

- Parts are independent solids from `minH` to `h`. Do not union them. Several parts with `minH = 0` overlap the podium on purpose: the tallest one defines the silhouette.
- When parts have `minH > 0`, the parts underneath fill the gap.
- 214 parts and 36 solids with `minH > 0` (skybridges, crowns) exist.

### Merging and instancing

- 2,952 buildings: merge them per material (`BufferGeometryUtils.mergeGeometries`) or instance them. Do not create 3,000 meshes.
- `hEst` buildings (mostly the low-rise villa areas NE and NW of Downtown) can get a neutral material.

### Roads

- Draw ribbons of `width` along `pts`.
- Elevate them by `layer` (about 6–7 m per layer) when `bridge` is set. Hide them, or draw them dimmed, when `tunnel` is set. 106 bridge segments and 33 tunnel segments.
- Joints between consecutive ways are not welded, so overlap the ends slightly.
- Footways and service roads make up most of the 3,373 segments. Filter by `cls` for the LOD you want.

### Metro and trolley

- The Red Line (`rail` with `kind: "metro"`, `bridge: 1`) runs on a viaduct along the SE side of Sheikh Zayed Road. Put the deck at about 12–14 m.
- The OSM `layer` values (1 and 3) are relative stacking hints, not heights.
- The `tram` entries are the Dubai Trolley loop on Sheikh Mohammed bin Rashid Blvd, at grade.

### Water

- `water[kind=lake]` is Burj Khalifa Lake. Reflecting pools, pools and fountain basins are separate, smaller polygons that sit on top of it, so render the water at y ≈ 0 and the small pools slightly above it.
- The Dubai Fountain itself is not mapped in OSM. `landmarks[name="The Dubai Fountain"]` is a hand-placed approximate point (`approx: true`).

## Known gaps

- **Heights:** 2,125 of 2,952 buildings (72 %) have estimated heights. Most of them are small low-rise blocks: villas in Al Wasl and Al Satwa (NE and NW corners) and service buildings. Among the 348 footprints larger than 1,500 m², 115 are estimated.
  - 732 heights come from `height` tags and 95 from `building:levels`.
  - The Downtown and Sheikh Zayed Road towers are mostly tagged. 142 solids are 150 m or taller, with plausible values: Address Boulevard 370, Il Primo 356, The A-Tower 333, Address Fountain Views 329, Address Downtown 306, Opera Grand 288.
  - A tall unnamed parts cluster at (≈370, −1138) is a crown of thin parts that are 300–326 m high.
- **Emirates Towers** is about 2.3 km north of the Burj, outside the box, and is not included.
- **Roof shapes** are rarely tagged (17 non-flat roofs). Façade colour and material are almost never tagged.
- **Trees:** 470 points (392 nodes and 78 generated along tree rows). The Downtown boulevard planting is only partly mapped, so a renderer may want to scatter more trees in `green` polygons.
- **Interiors:** the Dubai Mall is a single 20 m multipolygon, and its interior corridors are skipped (`highway=corridor`, `indoor`).
- **Projection:** a single equirectangular tangent plane. The error is under 0.1 % across the box.
