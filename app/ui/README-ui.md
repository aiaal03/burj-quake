# Burj Quake: app UI overlay (`app/ui/`)

This is a plain HTML/CSS overlay that sits on top of the WebGL canvas. It has no dependencies.
Phone portrait is the primary layout. At 900 px and wider it switches to a desktop side panel.

- `ui.js`: ES module, `createUI(root, handlers, opts?)`
- `ui.css`: all styles, scoped under `.bq`
- `demo.html`: standalone mock host at `/app/ui/demo.html`. Query params: `?M=9.4&shake=6&view=stress`.
- `tools/shots.py`: takes screenshots at 390×844 and 1440×900. Run it with `WA_PORT=8951 ~/.whatif-venv/bin/python app/ui/tools/shots.py OUT 'M=3' 'M=10&shake=9'`.

## Usage
```js
import { createUI } from './app/ui/ui.js';          // plus <link rel="stylesheet" href="app/ui/ui.css">
const ui = createUI(document.getElementById('stage'), {
  onMagnitude(M) {},   // slider or ladder: number 3.0–10.0, step 0.1
  onShake(M) {},       // Shake button
  onReset() {},
  onView(v) {},        // 'normal' | 'stress' | 'xray'
  onSpeed(v) {},       // '1x' | 'real'
}, { jointY: 600 });   // optional: L156 joint height in model metres (default 600)
// every frame (or whenever the sim ticks):
ui.update(state);
```
`root` should be the element that holds the canvas and must be positioned. The overlay fills it with `position:absolute; inset:0`.
The overlay passes pointer events through, except on its panels.

### `state` (every field is optional; fields you leave out keep their last value)
| field | type | meaning |
|---|---|---|
| `M` | number | current magnitude (moves the slider, top readout and ladder) |
| `t` | number | sim time in seconds; drives the period glyphs while `running` |
| `running` | bool | Shake button shows "Shaking…" |
| `amp` | 0..1 | normalised shaking level; scales glyph amplitude |
| `seis` | number[] | recent seismograph samples, oldest first; auto-scaled, about 200–300 samples |
| `loadMax` | number | load ÷ capacity of the focused element. ≥ 1 shows `1.00` then `> 1` in red and flashes the LIMIT line once |
| `stressBins` | number[] | load ÷ capacity per height bin from 0 to 828 m (48 bins in the engine); fills the mini elevation strip, with a red pulse at bins ≥ 1 |
| `lowRiseDown`, `midRiseDown` | 0..100 | percent of each class collapsed |
| `burjStatus` | `'STANDING' \| 'SPIRE LOST' \| 'OVERTURNING'` | status row; also chooses the info card and dashes the lost spire in the strip |
| `callouts` | `{id, x, y, visible, text, hot}[]` | 3D-anchored labels. `x`/`y` are CSS px relative to `root`, from your `project(x,y,z)`. `hot` gives a red dot, a pulsing ring and a red bar. Labels are kept clear of the panels, auto-sided and de-overlapped; ids that disappear are removed |

The returned object also has `setView(v)`, `setSpeed(v)`, `destroy()` and `el`.

## Copy rules
All card text comes from `docs/SCIENCE.md`. Cards marked **HYPOTHETICAL · ENGINEERING REASONING** (spire joint, base)
come from research item 6, which is reasoning, not documentation; the others are labelled **DOCUMENTED**.
The card is chosen automatically from `burjStatus`, the view and `M` (`pickCard`), and can be overridden with the Info/Period tabs.
Edit the copy in `CARDS` inside `ui.js`, and keep it sourced.
The period glyphs use T = 0.5 s (5 storeys × 0.1 s) and T = 11.3 s at their true relative rate. The ground's dominant period is 0.5 s, so the small building really is "in tune".

## Fonts
The UI uses Inter (SIL OFL) from `assets/fonts/InterVariable.woff2`, `Inter-Variable.woff2`, `Inter.woff2`, `Inter-Medium.woff2` or `Inter-SemiBold.woff2`, whichever exists.
If none is present it falls back to the `system-ui` stack. It never loads Avenir Next, which is proprietary and must not ship.

## Accessibility
- The slider is a native range input with an aria-label, and the ladder numbers are buttons.
- The segmented controls use `aria-pressed`, the meter uses `role=meter`, and the status row is an `aria-live` region.
- Focus rings are amber, and `prefers-reduced-motion` stops the ring pulses.
