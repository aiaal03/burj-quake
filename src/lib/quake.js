// Quake model: beats (magnitudes), ground surface-wave field, tower sway, failure timings, stress (demand/capacity),
// city-building response. Pure, deterministic functions of film time t. Rationale + sources: docs/ENGINEERING.md.
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sm = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;

// ---- presentation scales ----
// Shaking & sway run in REAL time: Burj mode 1 is drawn at the true 11.3 s (matches the on-screen "T = 11.3 s"),
//   city buildings at their own true periods (≈0.1 s/storey).
// FALL_SPEED: free fall + overturning after a failure are shown 4× faster (a 600 m topple takes ≈18 s, a 600 m
//   free fall ≈11 s; the film gives them 4.6 s / 3 s). Implemented as gravity × 16 in film time. Needs the tag
//   "COLLAPSE · 4× SPEED" from 26.4 s.
// DEF_SCALE: drawn lateral sway = true sway × 3 (FEA "deformation scale" convention). Numbers quoted are TRUE.
export const TIME_SCALE = 1;                          // shaking/sway: real time
export const FALL_SPEED = 4;
export const DEF_SCALE = 3;
export const G_FILM = 9.81 * FALL_SPEED * FALL_SPEED;    // gravity used for falling bodies (m / film-s²) = 157

// Burj measured/FE periods [BKN]: mode 1 sway 11.3 s, mode 2 sway 10.2 s, torsion 4.3 s. 2nd flexural ≈ T1/3.5 (estimate).
export const BURJ_T = { T1: 11.3, T2: 10.2, Ttor: 4.3, Tflex2: 3.2, Tspire: 2.0 };

// tip = envelope of TRUE top displacement (m) of the concrete tower top for the hypothetical near-field scenario.
// pga = near-field peak ground acceleration (g), Tc = spectral corner period (s), pgd = peak ground displacement (m).
export const BEATS = [
  { m: 0, t0: 0.0, t1: 3.0, A: 0, tip: 0.0, pga: 0, Tc: 0.3, pgd: 0 },
  { m: 3, t0: 3.0, t1: 7.4, A: 0.01, tip: 0.004, pga: 0.01, Tc: 0.25, pgd: 0.001, name: 'MINOR', note: 'Felt by few', energy: '0.5 tons of TNT' },
  { m: 5, t0: 7.4, t1: 12.0, A: 0.08, tip: 0.04, pga: 0.10, Tc: 0.4, pgd: 0.02, name: 'MODERATE', note: 'Windows rattle', energy: '480 tons of TNT' },
  { m: 7, t0: 12.0, t1: 17.4, A: 0.9, tip: 0.8, pga: 0.40, Tc: 0.6, pgd: 0.4, name: 'MAJOR', note: 'Built for this', energy: '480 kilotons of TNT' },
  { m: 8, t0: 17.4, t1: 23.0, A: 1.9, tip: 2.5, pga: 0.55, Tc: 1.0, pgd: 1.2, name: 'GREAT', note: 'The glass gives up', energy: '15 megatons of TNT' },
  { m: 9, t0: 23.0, t1: 29.0, A: 4.2, tip: 5.0, pga: 0.70, Tc: 1.6, pgd: 3.0, name: 'MEGAQUAKE', note: 'The spire snaps', energy: '480 megatons of TNT' },
  { m: 10, t0: 29.0, t1: 38.0, A: 7.0, tip: 10.0, pga: 1.00, Tc: 2.5, pgd: 7.0, name: 'NEVER RECORDED', note: 'Total collapse', energy: '15 gigatons of TNT' },
];
export const T_SPIRE = 26.4;      // steel spire fails at its joint with the concrete top (y = 600, ≈ L156 transition)
export const T_BREAK = 30.8;      // base fails in overturning (compression-side walls crush) → tower starts to topple
export const T_IMPACT = 35.4;     // falling top hits the city
export const T_RIFT = 29.3;       // ground rift opens
export const T_BASE_YIELD = T_BREAK; // base demand/capacity crosses 1.0 exactly here
// piecewise-linear key track [[t, v], ...] (exact values at keys — used for D/C crossings)
function pw(t, K) { if (t <= K[0][0]) return K[0][1]; for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const [a, va] = K[i - 1], [b, vb] = K[i]; return va + (vb - va) * (t - a) / (b - a); } return K[K.length - 1][1]; }
// spire whip: tip offset (m, TRUE) of the spire relative to the concrete top
const WHIP_K = [[3, 0], [4, 0.002], [7.4, 0.002], [8.4, 0.03], [12, 0.03], [13.2, 0.3], [17.4, 0.3], [18.6, 1.0], [23, 1.0], [24.2, 2.2], [26.4, 2.8], [38, 2.8]];

export function beatIndex(t) { let i = 0; for (let k = 0; k < BEATS.length; k++) if (t >= BEATS[k].t0) i = k; return i; }
export const beatAt = (t) => BEATS[beatIndex(t)];

// ground amplitude (drawn metres) — ramps in over the first second of each beat, calms after the impact
export function amp(t) {
  const i = beatIndex(t), b = BEATS[i]; if (!b.m) return 0;
  const prev = BEATS[i - 1].A;
  let a = lerp(prev * 0.5, b.A, sm(ramp(t, b.t0, b.t0 + 1.0)));
  a *= 1 - 0.85 * sm(ramp(t, T_IMPACT + 0.4, 38.0));
  return a;
}
// 0..1 ramp of the current beat's shaking (prev beat fades into this one)
function beatLevel(t, key) {
  const i = beatIndex(t), b = BEATS[i]; if (!b.m) return 0;
  const prev = BEATS[i - 1][key];
  let v = lerp(prev, b[key], sm(ramp(t, b.t0, b.t0 + 1.0)));
  return v * (1 - 0.85 * sm(ramp(t, T_IMPACT + 0.4, 38.0)));
}

// surface waves travelling from the WSW
const D = (() => { const x = 0.94, z = 0.34, l = Math.hypot(x, z); return [x / l, z / l]; })();
const D2 = (() => { const x = 0.55, z = -0.83, l = Math.hypot(x, z); return [x / l, z / l]; })();
const WAVES = [
  { lam: 320, c: 300, a: 1.0, ph: 0.3, d: D },
  { lam: 170, c: 270, a: 0.55, ph: 1.7, d: D },
  { lam: 90, c: 240, a: 0.28, ph: 4.1, d: D2 },
  { lam: 560, c: 360, a: 0.5, ph: 2.2, d: D2 },
].map((w) => ({ ...w, k: 2 * Math.PI / w.lam, w: 2 * Math.PI / w.lam * w.c }));

// out: {y, gx, gz (slope dy/dx, dy/dz), hx, hz (horizontal shake)}
export function ground(x, z, t, out = {}) { return groundA(x, z, t, amp(t), out); }
export function groundA(x, z, t, A, out = {}) {
  if (A === 0) { out.y = 0; out.gx = 0; out.gz = 0; out.hx = 0; out.hz = 0; return out; }
  const m = 0.75 + 0.25 * Math.sin(x * 0.0041 + z * 0.0063 + 1.3);
  let y = 0, gx = 0, gz = 0, h = 0;
  for (const w of WAVES) {
    const s = x * w.d[0] + z * w.d[1];
    const p = w.k * s - w.w * t + w.ph;
    const sn = Math.sin(p), cs = Math.cos(p);
    y += w.a * sn; const g = w.a * w.k * cs; gx += g * w.d[0]; gz += g * w.d[1]; h += w.a * cs;
  }
  const am = A * m;
  out.y = am * y; out.gx = am * gx; out.gz = am * gz;
  const j = Math.sin(t * 23.0 + x * 0.05) * 0.15 + Math.sin(t * 31.0 + z * 0.04) * 0.1;
  out.hx = am * (h * 0.5 * D[0] + j); out.hz = am * (h * 0.5 * D[1] - j * 0.6);
  return out;
}

// ---------- Burj sway (TRUE metres; tower.js draws it × DEF_SCALE) ----------
// mode 1 (x, T 11.3 s) + mode 2 (z, T 10.2 s) + 2nd flexural (≈3.2 s) + torsion (4.3 s), all ÷ TIME_SCALE on screen.
const W1 = 2 * Math.PI * TIME_SCALE / BURJ_T.T1, W2 = 2 * Math.PI * TIME_SCALE / BURJ_T.T2;
const WF = 2 * Math.PI * TIME_SCALE / BURJ_T.Tflex2, WT = 2 * Math.PI * TIME_SCALE / BURJ_T.Ttor, WS = 2 * Math.PI * TIME_SCALE / BURJ_T.Tspire;
export function swayEnv(t) {
  const i = beatIndex(t), b = BEATS[i];
  const prev = i > 0 ? BEATS[i - 1].tip : 0;
  let A = lerp(prev, b.tip, sm(ramp(t, b.t0, b.t0 + 1.8)));
  A *= 1 - 0.7 * sm(ramp(t, T_IMPACT, 38));
  return A;
}
export function sway(t) {
  const A = swayEnv(t);
  const x = A * (0.92 * Math.sin(W1 * t + 3.30) + 0.12 * Math.sin(WF * t + 1.3));
  const z = A * 0.5 * (Math.sin(W2 * t + 2.1) + 0.12 * Math.sin(WF * 1.1 * t));
  const m2 = A * 0.10 * Math.sin(WF * t + 0.7);                 // 2nd flexural mode amplitude (m)
  const tor = A / 600 * 0.25 * Math.sin(WT * t + 0.3);           // top twist (rad), small
  // spire whip: extra rotation (rad) of the steel spire about its joint; spire period ≈ 2 s (estimate, see notes)
  const wl = spireWhipLevel(t);
  const whip = wl * Math.sin(WS * t + 1.1);
  return { x, z, m2, A, tor, whip, wl };
}
// spire whip amplitude (rad, true): tip offset relative to the concrete top ÷ 228 m spire length
export function spireWhipLevel(t) {
  return pw(t, WHIP_K) / 228;
}
// lateral slope du/dy (TRUE) of the sway profile at height y (concrete tower 0..600 governs the shape)
export function swaySlope(y, s) {
  const H = 600, e = clamp(y / H, 0, 1);
  const d1 = 1.8 * Math.pow(Math.max(e, 1e-4), 0.8) / H;          // d/dy of e^1.8 (mode-1 shape)
  const d2 = Math.cos(e * Math.PI * 2.2) * Math.PI * 2.2 / H * 0.5; // 2nd-mode shape derivative
  return { x: s.x * d1 + s.m2 * d2, z: s.z * d1 + s.m2 * d2 * 0.5 };
}
// HUD readout for the top sway (TRUE values)
export function swayText(t) {
  const A = swayEnv(t);
  if (A < 0.01) return '< 1 cm';
  if (A < 1) return Math.round(A * 100) + ' cm';
  return A.toFixed(1) + ' m';
}

// glass damage 0..1 over time
export const damage = (t) => 0.22 * sm(ramp(t, 17.8, 22.5)) + 0.25 * sm(ramp(t, 23, 28.5)) + 0.35 * sm(ramp(t, 29, 34));

// ---------- spire failure: pivots about the joint (fracture side holds briefly), then free-falls ----------
// spire ≈ 228 m steel appendage; pivoted rod ω² = 3g/(2L).
export const SPIRE_L = 228, SPIRE_PIVOT = 0.7;            // film-s of hinged rotation before the joint fully lets go
const WSP = Math.sqrt(3 * G_FILM / (2 * SPIRE_L)), SP0 = 0.03, SPV0 = 0.25;
export function spireAngle(t) {
  const u = t - T_SPIRE; if (u <= 0) return 0;
  const up = Math.min(u, SPIRE_PIVOT);
  let a = SP0 * Math.cosh(WSP * up) + SPV0 / WSP * Math.sinh(WSP * up) - SP0 * (1 - sm(up / 0.15));
  if (u > SPIRE_PIVOT) a += spireOmega() * (u - SPIRE_PIVOT);
  return a;
}
export function spireOmega() { const u = SPIRE_PIVOT; return SP0 * WSP * Math.sinh(WSP * u) + SPV0 * Math.cosh(WSP * u); }

// ---------- main failure: overturning about the crushed base ----------
// Rigid-body toppling about the compression-side pivot: θ'' = ω² sin θ, ω² = g·h_cm/k_p² ≈ 1.9 g / L for a tapered
// tower (CM ≈ 0.38 L, k_p² ≈ 0.2 L²). Falling-chimney effect: inertia bending peaks ≈ 1/3 of the height, the upper part
// lags → in-air fracture at Y_KINK (and a smaller one at Y_KINK2). θ'0 is solved so the top lands at T_IMPACT.
export const L_TOPPLE = 570;
const WT2 = 1.9 * G_FILM / L_TOPPLE, TH0 = 0.012;
export const LAG1 = 0.10, LAG2 = 0.05;
const lag1 = (th) => LAG1 * sm(ramp(th, 0.45, 1.05));
const lag2 = (th) => LAG2 * sm(ramp(th, 0.75, 1.3));
const TH_END = Math.PI / 2;
const DT = 1 / 240, NSTEP = Math.ceil((38.5 - T_BREAK) / DT) + 2;
function integrate(v0, out) {
  let th = TH0, v = v0; if (out) { out[0] = th; }
  const f = (x) => WT2 * Math.sin(Math.min(x, 2.2));
  for (let i = 1; i < NSTEP; i++) {
    const k1v = f(th), k1x = v, k2v = f(th + k1x * DT / 2), k2x = v + k1v * DT / 2, k3v = f(th + k2x * DT / 2), k3x = v + k2v * DT / 2, k4v = f(th + k3x * DT), k4x = v + k3v * DT;
    th += DT / 6 * (k1x + 2 * k2x + 2 * k3x + k4x); v += DT / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
    if (out) out[i] = th;
  }
  return th;
}
const THTAB = (() => {
  // solve v0 s.t. θ_top(T_IMPACT) = θ - lag1 - lag2 = π/2
  const target = TH_END + LAG1 + LAG2, iImp = Math.round((T_IMPACT - T_BREAK) / DT);
  const tab = new Float64Array(NSTEP);
  let lo = 0, hi = 2;
  for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; integrate(mid, tab); if (tab[iImp] > target) hi = mid; else lo = mid; }
  integrate((lo + hi) / 2, tab); tab.v0 = (lo + hi) / 2; return tab;
})();
export const TOPPLE_V0 = THTAB.v0;      // initial angular velocity (rad / film-s)
function thetaRaw(t) { const x = (t - T_BREAK) / DT; if (x <= 0) return TH0; const i = Math.min(NSTEP - 2, Math.floor(x)); return lerp(THTAB[i], THTAB[i + 1], Math.min(1, x - i)); }
// main break state: th (lower body 30–210 m), th1 (210–450 m), th2 (450–600 m) rotation about z (rad),
// kink = th - th1, crush = base crushing 0..1, drop = crush height loss (m), raft = raft tilt (rad), imp = 0..1 after impact
export function breakState(t) {
  const crush = sm(ramp(t, T_BREAK, T_BREAK + 1.2));
  const raft = 0.035 * sm(ramp(t, T_BREAK - 0.2, T_BREAK + 2.5));
  const drop = 30 * 0.45 * crush;
  if (t <= T_BREAK) return { th: 0, th1: 0, th2: 0, kink: 0, drop, crush, raft, u: 0, imp: 0 };
  const u = t - T_BREAK, raw = thetaRaw(t);
  // start from 0 rotation (θ0 is the sway tilt already drawn) — blend the offset away in 0.3 s
  const r = raw - TH0 * (1 - sm(u / 0.3));
  const th = Math.min(r, TH_END), th1 = Math.min(r - lag1(r), TH_END), th2 = Math.min(r - lag1(r) - lag2(r), TH_END);
  const imp = sm(ramp(t, T_IMPACT, T_IMPACT + 0.6));
  return { th, th1, th2, kink: th - th1, drop, crush, raft, u, imp };
}
export { clamp, sm, ramp, lerp };

// ---------- stress view: stylised DEMAND / CAPACITY along the height, 48 bins over 0..828 m ----------
// Value written = 0.95 × D/C so that D/C = 1 sits exactly on the legend's LIMIT tick (heat 0.95 = red).
// Overturning demand grows toward the base, but so does capacity (walls 1300→500 mm, wider footprint), so D/C is
// fairly even; beyond design it peaks at the base (largest overturning moment + base shear) and at the concrete→steel
// spire joint (stiffness jump, higher-mode whip; seismic governed the spire design [BKN]). Small bumps at outrigger
// levels (approx. heights, NOT floors) and at setback tier transitions = force/stiffness discontinuities.
export const SBINS = 48;
export const Y_JOINT = 600, Y_KINK = 210, Y_KINK2 = 450;
export const OUTRIGGERS_APPROX = [125, 245, 365, 470, 560];   // illustrative only — floors not sourced
const gauss = (y, c, w) => Math.exp(-(((y - c) / w) ** 2));
// D/C key tracks: M7 max 0.55 (base); M8 core < 0.6 while link beams > 0.9 (fuses yield → protect the
// walls: capacity design caps the wall demand); joint 0.85 at 25.6 → 1.00 exactly at T_SPIRE; base 0.80 at 29.0 →
// 1.00 exactly at T_BREAK. After a crossing the value keeps rising (> 1 = failed).
const BASE_K = [[3, 0], [4, 0.01], [7.4, 0.01], [8.4, 0.05], [12, 0.06], [13.5, 0.55], [17.4, 0.55], [18.5, 0.58], [23, 0.58], [24.5, 0.68], [26.4, 0.72], [29.0, 0.80], [T_BREAK, 1.0], [T_BREAK + 1.0, 1.25], [38, 1.3]];
const JOINT_K = [[3, 0], [4, 0.01], [7.4, 0.01], [8.4, 0.07], [12, 0.08], [13.5, 0.45], [17.4, 0.45], [18.5, 0.55], [23, 0.55], [24.5, 0.75], [25.6, 0.85], [T_SPIRE, 1.0]];
const LINK_K = [[3, 0], [4, 0.02], [7.4, 0.02], [8.4, 0.12], [12, 0.14], [13.5, 0.62], [17.4, 0.70], [17.9, 0.92], [19.0, 1.0], [23, 1.03], [38, 1.08]];
export const dcBase = (t) => pw(t, BASE_K);
export const dcLink = (t) => pw(t, LINK_K);
// joint: rises to 1.0 at T_SPIRE; afterwards the steel is gone, the fractured concrete lip reads 1.15
export const dcJoint = (t) => (t < T_SPIRE ? pw(t, JOINT_K) : 1.15);
// link (coupling) beams: demand peaks in the lower-middle third of the height (typical for coupled walls)
export function linkAt(y, t) { if (y > Y_JOINT) return 0; const e = y / Y_JOINT; return dcLink(t) * (0.72 + 0.28 * Math.exp(-(((e - 0.35) / 0.3) ** 2))); }
// wall/core/spire D/C at height y (envelope — the compression flange reaches it; other faces less)
export function stressAt(y, t) { return stressAtP(y, t, dcBase(t), dcJoint(t), t > T_BREAK ? breakState(t) : null, t >= T_SPIRE); }
// parametrised core: B = base D/C, J = joint D/C, br = breakState (or null before the base fails), spireGone
function stressAtP(y, t, B, J, br, spireGone) {
  if (y <= Y_JOINT + 1) {
    const e = Math.max(0, y) / Y_JOINT;
    let dc = B * (0.3 + 0.7 * Math.pow(1 - e, 1.6));
    let bump = 0; for (let k = 0; k < OUTRIGGERS_APPROX.length; k++) { const d = (y - OUTRIGGERS_APPROX[k]) / 14; if (d * d < 9) bump += Math.exp(-d * d); }
    dc += 0.08 * B * bump;
    dc += 0.03 * B * Math.max(0, Math.sin((y - 150) / 49.5 * Math.PI * 2)) * (y > 150 ? 1 : 0);   // setback tiers
    dc = Math.min(Math.max(dc, 0), Math.max(B, dc * 0.999));     // never above the base value
    dc = Math.max(dc, J * gauss(y, Y_JOINT, 22));
    if (br) dc = Math.max(dc, 1.25 * sm(ramp(br.th, 0.15, 0.5)) * gauss(y, Y_KINK, 22), 1.1 * sm(ramp(br.th, 0.4, 0.8)) * gauss(y, Y_KINK2, 20));
    return dc;
  }
  if (spireGone) return 0;                            // detached spire is a free body — no stress
  const e = (y - Y_JOINT) / (828 - Y_JOINT);
  return J * Math.max(gauss(y, Y_JOINT, 22), 0.6 * (1 - e));
}
// max D/C for the meter. region: 'all' | 'base' (0–60 m) | 'joint' (560–640 m) | 'link'
export function maxRatio(t, region = 'all') {
  if (region === 'link') return dcLink(t);
  if (region === 'base') return dcBase(t);
  if (region === 'joint') return Math.max(dcJoint(t), stressAt(Y_JOINT, t));
  let m = 0; for (let i = 0; i < SBINS; i++) m = Math.max(m, stressAt(i / (SBINS - 1) * 828, t)); return m;
}
// shader arrays: out = wall D/C per bin, outL (optional) = link-beam D/C per bin
export function stressProfile(t, out = new Float32Array(SBINS), outL) {
  for (let i = 0; i < SBINS; i++) {
    const y = i / (SBINS - 1) * 828;
    out[i] = Math.min(1.5, stressAt(y, t));
    if (outL) outL[i] = (t > T_BREAK ? 0 : Math.min(1.5, linkAt(y, t)));
  }
  return out;
}

// ---------- city buildings: period, sway, failure time ----------
// Rule of thumb [research §7]: T ≈ 0.1 s per storey, storey ≈ 3.5 m.
// bldPeriod(h): h in metres (pass {storeys: n} to give storeys). Returns REAL seconds.
export function bldPeriod(h) {
  const n = typeof h === 'object' ? h.storeys : h / 3.5;
  return Math.max(0.1, 0.1 * n);
}
// design-spectrum shape (5 % damping): Sa = 2.5·PGA on the plateau up to Tc, ∝ Tc/T after, Sd capped at ≈ PGD for long T.
function spectrum(T, b) {
  if (!b.pga) return { Sa: 0, Sd: 0 };
  const Sa = 2.5 * b.pga * (T <= b.Tc ? 1 : b.Tc / T);
  let Sd = Sa * 9.81 * (T / (2 * Math.PI)) ** 2;
  Sd = Math.min(Sd, Math.max(b.pgd * 1.5, 0.001));
  return { Sa, Sd };
}
// capacity (hash of seed): style 1 = older low/mid-rise concrete (non-ductile), style 0 = modern glass/steel-concrete
function capacity(style, seed) {
  return style === 1 ? { Sa: 0.8 + 1.2 * seed, drift: 0.010 + 0.006 * seed } : { Sa: 1.1 + 1.6 * seed, drift: 0.020 + 0.012 * seed };
}
function bldRatio(h, style, seed, b) {
  const T = bldPeriod(h), sp = spectrum(T, b), c = capacity(style, seed);
  const roof = 1.4 * sp.Sd, drift = roof / Math.max(h, 3);
  return Math.max(sp.Sa / c.Sa, drift / c.drift);
}
// lateral top displacement (TRUE m) of a city building of height h at film time t (draw it × DEF_SCALE).
// Oscillates at its own period (÷ TIME_SCALE); on-screen frequency is capped at 5 Hz to avoid strobing at 30 fps.
export function bldSway(h, t, seed = 0.5) {
  const i = beatIndex(t), b = BEATS[i]; if (!b.m) return 0;
  const T = bldPeriod(h), pb = BEATS[i - 1];
  const k = sm(ramp(t, b.t0, b.t0 + 1.0));
  const d = lerp(1.4 * spectrum(T, pb).Sd, 1.4 * spectrum(T, b).Sd, k) * (1 - 0.85 * sm(ramp(t, T_IMPACT + 0.4, 38.0)));
  const f = Math.min(5, TIME_SCALE / T);
  return d * (0.85 * Math.sin(2 * Math.PI * f * t + seed * 6.283) + 0.15 * Math.sin(2 * Math.PI * f * 1.7 * t + seed * 17.0));
}
// film time at which a building fails (1e9 = survives the shaking itself). Fails in the first beat whose
// demand/capacity ratio exceeds 1; more overloaded = earlier in that beat. Low/mid-rise (T 0.3–1.5 s) sit on the
// near-field spectral plateau → fail first (M7 for weak concrete); tall towers only when long-period content grows (M9/M10).
export function bldFailTime(h, style, seed = 0.5) {
  for (let i = 1; i < BEATS.length; i++) {
    const b = BEATS[i], r = bldRatio(h, style, seed, b);
    if (r >= 1) {
      const dur = (i === BEATS.length - 1 ? T_IMPACT : b.t1) - b.t0;
      const f = clamp((1.6 - r) / 0.6);                      // r ≥ 1.6 → right after the beat hits
      const j = ((seed * 7919.0) % 1) * 0.25;
      return b.t0 + 0.5 + (dur - 1.2) * clamp(f * 0.75 + j);
    }
  }
  return 1e9;
}
export function bldDC(h, style, seed, t) { const b = beatAt(t); return b.m ? bldRatio(h, style, seed, b) : 0; }
// time a city building at (x, z) of height h is struck by the toppling Burj (1e9 = not in the path).
// Tower falls toward +x about the base pivot (x ≈ 18); body half-width ≈ 40 m; top lands at x ≈ 590–620.
export function fallCrushTime(x, z, h) {
  if (Math.abs(z) > 45 || x < 45 || x > 660) return 1e9;
  for (let t = T_BREAK; t <= T_IMPACT + 0.05; t += 0.02) {
    const th = breakState(t).th2 || 1e-6;
    if (x - 18 > 600 * Math.sin(th) + 10) continue;            // the shaft does not reach this far yet
    const yAxis = (x - 18) / Math.tan(th);                     // axis height above the pivot at this x
    if (yAxis - 30 <= h) return t;
  }
  return T_IMPACT;
}


// =====================================================================================================================
// SCENARIO API (interactive app): makeScenario(M) for any continuous M in [3, 10]. All functions take t = seconds since
// shaking started (t >= 0). Strong shaking lasts 12 s (M3) … 15 s (M10), then calms over ~4 s. Failures happen exactly
// when load ÷ capacity crosses 1.0. Thresholds (see docs/ENGINEERING.md §8):
//   weak low-rises ≈ M6.7+, mid-rises ≈ M8, link beams yield (by design) ≈ M7.9, spire joint ≈ M8.85,
//   base overturning ≈ M9.7+ (beyond the largest ever recorded, M9.5).
// =====================================================================================================================
const MT = [3, 5, 7, 8, 9, 9.5, 10];
//               M3      M5     M7    M8    M9    M9.5  M10
const TAB = {
  A:     [0.01,   0.08,  0.9,  1.9,  4.2,  5.5,  7.0],   // drawn ground amplitude (m) — film scale
  pga:   [0.01,   0.10,  0.40, 0.55, 0.70, 0.85, 1.00],  // near-field PGA (g)
  Tc:    [0.25,   0.4,   0.6,  1.0,  1.6,  2.0,  2.5],   // spectral corner period (s)
  pgd:   [0.001,  0.02,  0.4,  1.2,  3.0,  4.8,  7.0],   // peak ground displacement (m)
  tip:   [0.004,  0.04,  0.8,  2.5,  5.0,  7.0,  10.0],  // Burj top sway, TRUE m (peak)
  whip:  [0.002,  0.03,  0.3,  1.0,  2.6,  2.9,  3.2],   // spire tip offset vs concrete top, TRUE m
  base:  [0.01,   0.06,  0.55, 0.58, 0.80, 0.92, 1.30],  // peak base D/C
  joint: [0.01,   0.08,  0.45, 0.55, 1.10, 1.25, 1.40],  // peak spire-joint D/C
  link:  [0.02,   0.13,  0.69, 1.03, 1.05, 1.06, 1.08],  // peak link-beam D/C
};
const LOGK = { A: 1, pga: 1, pgd: 1, tip: 1, whip: 1 };
function interpM(key, M) {
  const v = TAB[key]; M = clamp(M, 3, 10);
  let i = 0; while (i < MT.length - 2 && M > MT[i + 1]) i++;
  const u = (M - MT[i]) / (MT[i + 1] - MT[i]);
  return LOGK[key] ? Math.exp(lerp(Math.log(v[i]), Math.log(v[i + 1]), u)) : lerp(v[i], v[i + 1], u);
}
export function scenarioParams(M) { const o = { M }; for (const k in TAB) o[k] = interpM(k, M); o.dur = 12 + 3 * (clamp(M, 3, 10) - 3) / 7; return o; }
// first t in [a,b] with f(t) >= 1 (f rising there); Infinity if never
function crossT(f, a, b) { if (f(b) < 1) return Infinity; let lo = a, hi = b; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) >= 1) hi = m; else lo = m; } return hi; }

export function makeScenario(Mag) {
  const P = scenarioParams(Mag), dur = P.dur;
  const env = (t) => sm(ramp(t, 0, 1.5)) * (1 - sm(ramp(t, dur, dur + 4)));           // ground shaking envelope
  const gT = (t) => sm(ramp(t, 0.5, 9)) * (1 - 0.8 * sm(ramp(t, dur + 1, dur + 10)));  // 11.3 s mode builds up slowly
  const gJ = (t) => sm(ramp(t, 0.5, 6)) * (1 - 0.8 * sm(ramp(t, dur + 1, dur + 6)));   // spire (≈2 s) responds faster
  const gL = (t) => sm(ramp(t, 0.5, 7)) * (1 - 0.8 * sm(ramp(t, dur + 1, dur + 8)));
  // building response build-up: ~2.5 cycles of its own period (short buildings respond within seconds, tall ones slowly)
  const gB = (t, T) => sm(ramp(t, 0.3, 0.3 + Math.min(Math.max(3.5, 2.5 * T), dur - 1)));
  const tSpire = crossT((t) => P.joint * gJ(t), 0, 6);
  const tBreak = crossT((t) => P.base * gT(t), 0, 9);
  const tImpact = tBreak + (T_IMPACT - T_BREAK);
  const BREAK_SHIFT = T_BREAK - tBreak, SPIRE_SHIFT = T_SPIRE - tSpire;
  // phase: at tBreak the shaft is at its +x extreme (fall direction); otherwise arbitrary
  const ph1 = isFinite(tBreak) ? Math.PI / 2 - W1 * tBreak : 0.4;
  const after = (t) => (isFinite(tImpact) ? 1 - 0.7 * sm(ramp(t, tImpact, tImpact + 2.6)) : 1);
  const sc = {
    M: Mag, params: P, dur, tSpire, tBreak, tImpact, end: Math.max(dur + 6, isFinite(tImpact) ? tImpact + 3 : 0),
    amp: (t) => (t <= 0 ? 0 : P.A * env(t) * after(t)),
    ground(x, z, t, out = {}) { return groundA(x, z, t, sc.amp(t), out); },
    swayEnv: (t) => P.tip * gT(t),
    sway(t) {
      const A = P.tip * gT(t);
      const x = A * (0.92 * Math.sin(W1 * t + ph1) + 0.12 * Math.sin(WF * t + 1.3));
      const z = A * 0.5 * (Math.sin(W2 * t + 2.1) + 0.12 * Math.sin(WF * 1.1 * t));
      const wl = P.whip * gJ(t) / 228;
      return { x, z, m2: A * 0.10 * Math.sin(WF * t + 0.7), A, tor: A / 600 * 0.25 * Math.sin(WT * t + 0.3), whip: wl * Math.sin(WS * t + 1.1), wl };
    },
    swaySlope,
    dcBase: (t) => (t < tBreak ? P.base * gT(t) : 1 + 0.25 * sm((t - tBreak) / 1.0)),
    dcJoint: (t) => (t < tSpire ? P.joint * gJ(t) : 1.15),
    dcLink: (t) => (t > tBreak ? 0 : P.link * gL(t)),
    stressAt(y, t) { return stressAtP(y, t, sc.dcBase(t), sc.dcJoint(t), t > tBreak ? sc.breakState(t) : null, t >= tSpire); },
    linkAt(y, t) { if (y > Y_JOINT) return 0; const e = y / Y_JOINT; return sc.dcLink(t) * (0.72 + 0.28 * Math.exp(-(((e - 0.35) / 0.3) ** 2))); },
    stressProfile(t, out = new Float32Array(SBINS), outL) {
      const B = sc.dcBase(t), J = sc.dcJoint(t), br = t > tBreak ? sc.breakState(t) : null, gone = t >= tSpire;
      for (let i = 0; i < SBINS; i++) { const y = i / (SBINS - 1) * 828; out[i] = Math.min(1.5, stressAtP(y, t, B, J, br, gone)); if (outL) outL[i] = br ? 0 : Math.min(1.5, sc.linkAt(y, t)); }
      return out;
    },
    // max load ÷ capacity. region: 'all' | 'base' | 'joint' | 'link'
    stressMax(t, region = 'all') {
      if (region === 'base') return sc.dcBase(t);
      if (region === 'joint') return sc.dcJoint(t);
      if (region === 'link') return sc.dcLink(t);
      return Math.max(sc.dcBase(t), sc.dcJoint(t));
    },
    damage: (t) => 0.82 * sm(ramp(Math.max(sc.dcLink(t) * 0.9, sc.dcBase(t)), 0.6, 1.3)),
    spireAngle: (t) => (t <= tSpire ? 0 : spireAngle(t + SPIRE_SHIFT)),
    spireOmega,
    breakState: (t) => breakState(isFinite(tBreak) ? t + BREAK_SHIFT : -1),
    // city building failure time (s since start) or Infinity. Fails when its D/C (spectral demand × build-up) hits 1.
    bldFailTime(h, style, seed = 0.5) {
      const b = { pga: P.pga, Tc: P.Tc, pgd: P.pgd }, r = bldRatio(h, style, seed, b);
      if (r < 1) return Infinity;
      const T = bldPeriod(h), tc = crossT((t) => r * gB(t, T), 0, dur);
      const j = ((seed * 7919.0) % 1);
      return tc + 0.4 + (0.5 + 2.5 * clamp((1.6 - r) / 0.6)) * j;    // cycles to collapse after first exceedance
    },
    bldSway(h, t, seed = 0.5) {
      const T = bldPeriod(h), sp = spectrum(T, { pga: P.pga, Tc: P.Tc, pgd: P.pgd });
      const d = 1.4 * sp.Sd * gB(t, T) * (1 - sm(ramp(t, dur, dur + 4))), f = Math.min(5, 1 / T);
      return d * (0.85 * Math.sin(2 * Math.PI * f * t + seed * 6.283) + 0.15 * Math.sin(2 * Math.PI * f * 1.7 * t + seed * 17.0));
    },
    fallCrushTime(x, z, h) { const tf = fallCrushTime(x, z, h); return isFinite(tBreak) && tf < 1e8 ? tf - BREAK_SHIFT : Infinity; },
  };
  return sc;
}
// the film timeline wrapped in the same interface (default for makeTower) — t is film time
export const FILM = {
  M: null, tSpire: T_SPIRE, tBreak: T_BREAK, tImpact: T_IMPACT, end: 38,
  amp, ground, swayEnv, sway, swaySlope, dcBase, dcJoint, dcLink, stressAt, linkAt, stressProfile,
  stressMax: maxRatio, damage, spireAngle, spireOmega, breakState, bldFailTime, bldSway, fallCrushTime,
};
