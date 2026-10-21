# Burj Quake — engineering notes

Model code: `src/lib/quake.js`, `src/lib/tower.js`. Sources are the tags in `docs/SCIENCE.md` ([A1] Abdelrazaq 2011, [BKN] Baker/Korista/Novak, SOM, RWDI). Everything past M8 is a **hypothetical near-field scenario beyond the design basis**: engineering reasoning, not documented behaviour (research §6).

## 1. Failure sequence and the reasons for it

| t (s) | Event | Where (model) | Why |
|---|---|---|---|
| 12.0–17.4 (M7) | Elastic sway. Base D/C 0.55, nothing yields | whole tower | The RC tower was governed by wind, not seismic [BKN]. Near-field M7 at an 11.3 s period gives a long-period demand below the wind design. |
| 17.9–19.0 (M8) | **Link (coupling) beams yield, as designed.** Core and walls stay < 0.6 | link beams at every level | Link beams 800–1100 mm deep are the ductile "fuse" elements [A1]. Capacity design: once they yield, the force that reaches the walls is capped. |
| 23–26.4 (M9) | Spire whip builds up. Joint D/C 0.85 at 25.6 → **1.00 at 26.4** | concrete→steel joint, **y = 600** | The stiffness jump plus higher-mode whip of a slender steel appendage. Seismic governed the spire's design [BKN]. A distant M5.8 in 2010 set the pinnacle in resonance [A1]. |
| 26.4 → ~27.1 | Spire hinges about the joint's −x edge, then lets go | 600–828 m (228 m) | At 26.4 the shaft is near its −x sway extreme, so the shaft top is accelerating toward +x and the spire's inertial load points −x. The spire therefore falls toward −x, away from the later shaft fall. |
| 27.1 → **30.07** | Spire in free fall, tumbling. Lands at about (−82, 0, 17) | — | Ballistic motion from its release velocity (shown at 4× speed, see §3). |
| 29.0 → **30.8** | Base D/C 0.80 → **1.00 exactly at 30.8** | core, wing and hammerhead walls, nose columns, raft and piles at the base | Largest overturning moment and base shear sit at the base (research §6b). Once the link beams have yielded (M8/M9), the wall piers act as less-coupled cantilevers, so the base demand climbs. |
| 30.8 → 31.8 | **Lean-in.** Compression-side walls crush (crush zone 0–30 m loses 60 % height); the tower leans to 0.06 rad toward +x and drops 8 m | toe at +x, x = 18 | Overturning demand crushes the compression flange (+x noses/hammerheads). The toe cannot act as a hinge for 500 kt: it crushes and slides, so the body drops instead of swinging. |
| 31.8 → 35.4 | **Crush-down (telescoping).** The body descends 430 m into its own base, s = 8 + 16u′ + ½·a·u′², a ≈ 0.36 g (resisted fall); lean grows to 0.22 rad (13°). A rubble mound grows to ≈ 35 m high, ≈ 180 m radius | base crush front | Supertall collapses are vertical/progressive (WTC 1/2 after a 7–8° tilt; Lu et al. supertall simulations: "vertical pancake"). Rigid overturns are short, stocky buildings (Alto Río, 15 storeys). A rigidly falling 570 m body would need bending ≈ W·L·sinθ/27 (falling-chimney result), far beyond its capacity. |
| 34.0 → 35.4 | **Crown separates** at 450 m (setback/outrigger zone at the top of the leaning body) and topples about the body top's +x edge, riding on the pile; it comes to rest sloping from the pile top to the ground at x ≈ 110–230 at **35.4** | crown 450–600 m | Like the WTC 2 top block: the slender top breaks off and tips once the body below crushes. Pivoted-block dynamics ω² = 3g/(2·150 m). |
| **35.4** | Top hits the city. Lower body lies flat at θ = 90°, then the pieces settle and skew | top at x ≈ 590, y ≈ 10 | — |

**Choice of joint height.** Real structure: reinforced concrete to L155/156, structural-steel spire from L156 to 828 m [A1]. L156 is about 585–600 m, and the unoccupied spire is about 244 m (CTBUH). In our geometry the concrete wings and core end at 600 m, the only boundary where the material changes. So `Y_SPIRE = 600` (spire 600–828 = 228 m). Label it "L156", never "690 m".

## 2. Stress model (demand ÷ capacity, D/C)

- Scale: `uS[i]` and `stressAt()` return **D/C directly**. In the shader, **red appears only at ≥ 1.0**: blue 0, cyan 0.3, green 0.55, yellow 0.78, amber 0.97, then RED at 1.0 → white-hot at 1.25. The palette is converted to linear, so the hues survive tone-mapping.
- Height profile, walls and core (0–600 m): `B(t)·(0.3 + 0.7·(1−y/600)^1.6)`. The base governs: overturning moment grows toward the ground faster than capacity does (walls 1300 → 500 mm [A1]). Small bumps at **outrigger levels (approx. 125/245/365/470/560 m: illustrative, never label floors)** and at setback tiers mark the stiffness discontinuities.
- Joint: a Gaussian at 600 m; the steel spire body shows 0.6·J tapering to the tip. After 26.4 the spire bins = 0 (a free body) and the fractured concrete lip reads 1.15.
- **Flanges.** Compression flange (faces facing the bend direction) = full D/C, tension flange 0.85, webs 0.7. `uBend` follows the instantaneous sway direction, so the hot side **alternates with the sway**. After 30.8 it is locked to +x (crushing side).
- **Link beams (band approach).** A separate array `uL[48]` is drawn on the floor-spandrel stripes of the wing faces (one stripe per 3.75 m storey). The stripes show the link-beam D/C, and the wall panels between them show the wall D/C. M8: stripes 0.92 → 1.0 (amber then red: "yield by design"), walls 0.4–0.58 (cyan/green). For the S8 section plane at 310 m, colour the beams with `linkAt(310, t)` and the walls with `stressAt(310, t)`.
- After 30.8: base (crush front) 1.0 → 1.25 and stays > 1. The crown joint at 450 m heats 0.75 → 1.25 between 32.0 and 34.0 (crown separation).

Key values (`maxRatio(t, region)`):

| t | all | base | joint | link |
|---|---|---|---|---|
| 10 (M5) | 0.07 | 0.05 | 0.07 | 0.13 |
| 15–17 (M7) | **0.55** | 0.55 | 0.45 | 0.65–0.69 |
| 17.9 (M8) | 0.56 | 0.56 | 0.50 | **0.92** |
| 19–23 (M8) | 0.58 | 0.58 | 0.55 | 1.00–1.03 |
| 25.6 | 0.85 | 0.70 | **0.85** | 1.04 |
| 26.4 | — | 0.72 | **1.00 → fail** | 1.04 |
| 29.0 | — | **0.80** | (1.15 lip) | 1.05 |
| 30.8 | — | **1.00 → fail** | | |
| 31.5 | 1.17 | 1.17 | | |

Meter source per story: S7 `maxRatio(t,'all')`, S8 `maxRatio(t,'link')` (show link vs core), S11 `maxRatio(t,'joint')`, S12/S13 `maxRatio(t,'base')`. `maxRatio` reaches exactly 1.00 at the instant of failure. Show `> 1` after it.

## 3. Time, sway and readouts

- **Sway runs in REAL time.** Mode 1 is drawn at T = **11.3 s** (x), mode 2 at 10.2 s (z), torsion at 4.3 s [BKN]. A small 2nd flexural mode is about 3.2 s (estimate, ≈T1/3.5), and spire whip is about 2.0 s (estimate: the spire period is not sourced; the 2010 resonance only shows it sat in the 1–3 s band typical of distant-quake energy). The label "T = 11.3 s" is literally true. The shaft makes about 3 slow cycles across the film, while the spire whips about 5× faster and city buildings 10–100× faster.
- **Drawn sway = true × 3** (`DEF_SCALE`, the usual FEA deformation scale). True values at 1× are invisible at this scale (0.8 m on 828 m).
- **Falls are shown at 4× speed** (`FALL_SPEED`: gravity × 16 in film time). A 430 m crush-down at ≈ 0.36 g plus lean-in takes ≈ 18 s real and a 600 m spire free fall ≈ 11 s; the timeline gives them 4.6 s and 3 s. Debris spawned after the spire fails uses g × 16 (terminal velocity 160 film-m/s ≈ 40 m/s real).
- Peak true top displacement (concrete top), hypothetical near-field, if numbers are ever needed (the story drops the TOP SWAY readout; `swayText(t)` exists):
  M3 < 1 cm · M5 ≈ 4 cm · M7 ≈ 0.8 m · M8 ≈ 2.5 m · M9 ≈ 5 m · M10 ≈ 10 m before failure. For scale, wind sway is about 2 m (uncertain). Basis: long-period spectral displacement ≈ peak ground displacement (M7 0.4 m, M8 1.2 m, M9 3 m, M10 7 m hypothetical) × ~1.4 participation.
- City: `bldPeriod(h) = 0.1 s × h/3.5`. Spectrum: Sa = 2.5·PGA up to Tc, ∝ Tc/T after it, Sd capped near PGD. Near-field PGA: M5 0.1 g, M7 0.4 g, M8 0.55 g, M9 0.7 g, M10 1.0 g (hypothetical). Tc: 0.4 / 0.6 / 1.0 / 1.6 / 2.5 s; bigger quakes carry more long-period energy (lower corner frequency).
  Failure when Sa/Sa_cap > 1 or drift/drift_cap > 1. Weak low/mid-rise concrete: Sa_cap 0.55–1.75 g, drift 1.0–1.6 %. Modern glass: 1.1–2.7 g, 2.0–3.2 %.
  Result: weak concrete low-rises go in M7, most concrete and mid-rises in M8, tall towers (T 3–9 s) in M9/M10, and some modern low-rises survive the shaking itself (1e9).

## 4. On-screen captions (≤ 6 words, defensible)

| Beat | Caption |
|---|---|
| M3 | `Felt by few` |
| M5 | `Short buildings sway fast` / `Burj · T = 11.3 s` |
| M7 | `Low-rises in tune, failing` (or `Built for this`; wind governed the tower, so it is fine) |
| M8 | `Link beams yield · by design` → `Fuses protect the core` |
| M9 | `The spire whips hardest` → `Concrete → steel joint` → `Spire fails first` |
| M10 | `Hypothetical · beyond design` → `Bending peaks at the base` → `Base fails · tower collapses` |
| Tags | `SIM · sway ×3` (stress mode) and `COLLAPSE · 4× SPEED` (from 26.4) |

Avoid: "designed for M7", floor numbers for outriggers, "weakest section 240 m", "spire breaks at 690 m".

## 5. API (new and changed exports)

`quake.js`: `TIME_SCALE (=1)`, `FALL_SPEED (=4)`, `DEF_SCALE (=3)`, `G_FILM`, `BURJ_T`, `T_BASE_YIELD (=T_BREAK)`, `swayEnv`, `swayText`, `spireWhipLevel`, `spireOmega`, `SPIRE_L`, `SPIRE_PIVOT`, `S_END`, `U_SEP`, `CROWN_Y`, `LEAN_MAX`, `CRUSH_KAPPA`, `MOUND_*`, `moundAt(s)`, `Y_JOINT=600`, `Y_KINK=210`, `Y_KINK2=450`, `OUTRIGGERS_APPROX`, `dcBase/dcJoint/dcLink`, `stressAt(y,t)`, `linkAt(y,t)`, `maxRatio(t, 'all'|'base'|'joint'|'link')`, `stressProfile(t, out, outL?)`, `bldPeriod`, `bldSway`, `bldFailTime`, `bldDC`, `fallCrushTime(x,z,h)`.
`breakState(t)` returns `{th (lean), drop (descent m), crush, u, imp, sep, crown, rubbleH, rubbleR}` plus compatibility fields `th1 = th2 = th, kink = 0, raft = 0` (see §9).
`sway(t)` returns TRUE metres plus `{tor, whip, wl}`.

`tower.js`: `Y_SPIRE=600, Y_BREAK=30, Y_KINK=210, Y_KINK2=450, PIVOT_X=18, FALL_DIR=[1,0,0]`. BOUNDS are unchanged. `U.uL` is new (link-beam band). `state` has `hinge` (base pivot, world: base crush dust/debris), `kink`/`kink2` (in-flight fracture hinges: debris emitters 33–35.4), `spireHinge` (joint at 600 m), `spireCM`, `spireLand {t≈30.07, p≈(−82,0,17)}`, and `top` (spire tip before 26.4, concrete top after it).

## 7. Known liberties (tell the client if asked)
- Ground surface waves (λ 90–560 m at 240–360 m/s, metres of heave) are dramatised. Real surface waves are longer, and their drawn height is at the same ×3 visual scale.
- The spire period (2 s) and the in-flight fracture heights are reasoned estimates, not documented.
- "D/C" is a stylised map consistent with the mechanics, not an FE result.

## 8. Scenario API (interactive app)

`makeScenario(M)` works for any continuous M from 3 to 10. All its functions take `t` = seconds since shaking started.

**Inputs.** Values are interpolated per M from the table in `quake.js`: log-linear for PGA, PGD, sway and ground amplitude; linear for D/C and Tc. Anchor points are M3/5/7/8/9/9.5/10.
- Strong shaking lasts `dur = 12 + 3·(M−3)/7` s (12–15 s), then calms over 4 s.
- Build-up:
  - Burj mode 1 (11.3 s): `sm(0.5→9 s)`
  - Spire (~2 s): `sm(0.5→6 s)`
  - Link beams: `sm(0.5→7 s)`
  - City buildings: about 2.5 cycles of their own period (min 3.5 s).

**Event rule.** `tSpire` / `tBreak` are the exact instants where joint / base D/C (peak(M) × build-up(t)) reaches 1.0, found by bisection; otherwise they are Infinity. `tImpact = tBreak + 4.6 s` (crush-down at the same 4× fall speed as the film; real ≈ 18 s).

| Threshold (near-field, hypothetical) | M | Basis |
|---|---|---|
| Weakest low-rise concrete fails | **≈ 6.7** | Spectral plateau 2.5·PGA reaches the weakest collapse capacity of 0.8 g (PGA ≈ 0.32 g). Low-rises (T 0.1–0.6 s) sit on the near-field plateau (research §7). |
| Most low-rises, then mid-rises (35–70 m) | **≈ 8** | Mid-rises: drift demand reaches 1–1.6 % (non-ductile RC) as the corner period Tc grows with M. |
| Link beams yield, by design (no collapse) | **≈ 7.9** | Ductile fuses [A1]. |
| Spire joint (L156) fails | **≈ 8.8** | Peak joint D/C crosses 1 between M8 (0.55) and M9 (1.10). Seismic governed the spire [BKN]; higher-mode whip. |
| Tall towers (150–300 m, T 4–9 s) | **≈ 9–9.5** | Long-period energy grows with M (lower corner frequency); drift reaches 2–3 %. |
| Burj base failure → collapse | **≈ 9.6–9.7** | Peak base D/C 0.80 (M9) → 0.92 (M9.5) → 1.30 (M10). Beyond the largest ever recorded quake (M9.5, Chile 1960), so purely hypothetical. |

At M10: `tSpire` ≈ 4.1 s, `tBreak` ≈ 6.4 s, `tImpact` ≈ 11.0 s. At M9: spire only (`tSpire` ≈ 5.0 s), the tower stands. At M ≤ 8.8: no Burj failure.

**Scenario object.**
- `M, params, dur, end, tSpire, tBreak, tImpact`
- `amp(t)`, `ground(x,z,t,out)`, `swayEnv(t)`, `sway(t)`, `swaySlope(y,s)`
- `dcBase / dcJoint / dcLink(t)`, `stressAt(y,t)`, `linkAt(y,t)`, `stressProfile(t,out,outL?)`, `stressMax(t, 'all'|'base'|'joint'|'link')`
- `damage(t)`, `spireAngle(t)`, `spireOmega()`, `breakState(t)`
- `bldFailTime(h,style,seed)` (Infinity if it survives), `bldSway(h,t,seed)` (TRUE m), `rubbleCrushTime(x,z,h)` (alias `fallCrushTime`)

`FILM` exports the same interface for the 38 s timeline (film time), which keeps every old export working.

**Tower.**
- `makeTower(sc = FILM)`. Use `tower.setScenario(sc)`, or call `tower.pose(t, sc)`; switching resets the cached spire-release state. `tower.scenario` returns the current one.
- Cost: `pose` ≈ 0.03 ms and `stressProfile` ≈ 0.008 ms per call in Node, with no allocation-heavy loops. The first `pose` after a scenario with a spire failure does one release solve (~1 ms).
- Behaviour with the default scenario is unchanged (film verified).

**For the app.** Show the tag `Falls shown 4× faster` whenever `t > tSpire`. In stress mode, show `Sway drawn ×3`. City wiring is the same as §6, using `sc.bldFailTime / sc.bldSway / sc.rubbleCrushTime`.


## 9. Collapse model v2 (2026-10: replaces the rigid overturn)

Why: a 570 m rigid topple about a base hinge is not physically plausible (analysis + sources in the collapse review: falling-chimney bending, toe crushing/sliding, WTC 1/2 tilt-then-vertical, Lu et al. supertall simulations = vertical pancake, rigid overturns only for short buildings like Alto Río 2010). Realism of the old animation: 3/10; this model ≈ 7/10 (stylised: 4× speed, cone-like pile, no fragment physics).

Sequence (film time; scenario time = same offsets from `tBreak`):

| u = t − tBreak | Phase | Code |
|---|---|---|
| 0 – 1.0 | lean-in: crush zone collapses, lean 0 → 0.06 rad about the +x toe, descent 0 → 8 m | `breakState().crush, th, drop` |
| 0.8 – 4.6 | crush-down: descent to 430 m (`S_END`), κ = a/g ≈ 0.36 (`CRUSH_KAPPA`), lean → 0.22 rad (`LEAN_MAX`); storey blocks below the rubble top are hidden (consumed) | `drop`, `rubbleH`, `rubbleR` |
| 3.2 (`U_SEP`) | crown (450–600 m, `CROWN_Y`) fractures; fracture caps show on the body top and crown underside | `sep`, tower `bodyCap/crownCap` |
| 3.2 – 4.6 | crown pivots about the body top's +x edge (rides on the pile), tilt solved to land at `tImpact` | `crown` |
| ≥ 4.6 | impact: crown pieces settle/skew; pile at 35 m × 180 m (`MOUND_H`, `MOUND_R0+R1`) | `imp` |

Spire: hinges at the 600 m joint toward −x for 0.7 s, then free-falls (g × 16) tumbling, and **folds at 690 m** (≈1/3 of its length, the slender upper part lags) from +0.25 s after release; hidden on landing (debris + dust burst there).

City: `rubbleCrushTime(x,z,h)` — buildings are buried when the debris front (`rubbleR`, centred near x = 20) reaches them; a strip x 90–300, |z| < 40 is hit by the crown at `tImpact − 0.05`. `fallCrushTime` remains as an alias.

FX (`dubai.js rebuildFx/buildFx`): base burst at `tBreak`; ejecta + dust jets at the crush front sampled along the descent (`state.crushFront`, `state.rubble`); a dust skirt rolling off the mound edge; crown fracture debris at `state.kink` (= crown fracture point) at `tBreak + U_SEP`; impact debris/dust at the crown segments + crush front; a radial surge from the mound edge. `W_.impactCenter` = mean of those points (near the base, x ≈ 100). QA: `&nodust=1` hides the dust so the structure can be inspected.

Tower state: `hinge` (= `crushFront`), `kink`/`kink2` (crown fracture point), `crownCM`, `rubble {h, r, x, z}`, `spireHinge`, `spireCM`, `spireLand`, `top`.

UI wording: the Burj status "OVERTURNING" → **"COLLAPSING"**; callout "Base overturning" → **"Base crushing · tower collapses"**; caption "Tall towers fall down, not over" is defensible.
