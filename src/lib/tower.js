// Procedural Burj Khalifa: Y-plan (3 wings + hex core), 24 spiral setbacks, pinnacle + spire.
// Built as a chain of rigid segments so it can sway (small rotations per joint) and break/topple.
import * as THREE from 'three';
import { SBINS, DEF_SCALE, G_FILM, SPIRE_PIVOT, FILM, MOUND_X } from './quake.js';

export const HT = 828;
const WING_A = [90, 210, 330].map((d) => d * Math.PI / 180);
const L0 = 60, L1 = 13, W0 = 36, W1 = 22, RC = 18;
const SETBACK = Array.from({ length: 24 }, (_, j) => 140 + j * 18.5);   // 'two dozen' spiral setbacks (Baker)
export const BOUNDS = [...Array.from({ length: 21 }, (_, i) => i * 30), 645, 690, 740, 790, 828];
// Y_SPIRE: concrete→steel joint. Real: RC to L155/156 (≈585–600 m), steel spire above [A1]. Our concrete wings/core end
// at 600 m — the segment boundary that IS the material transition — so the spire (600–828, 228 m ≈ real ~244 m
// unoccupied spire) detaches there. Y_BREAK: top of the base crush zone (the collapse starts at the base).
// Y_CROWN: the crown (450–600 m) breaks off the telescoping body and topples onto the pile. Y_FOLD: the falling spire
// folds at ≈1/3 of its length (690 m). Y_KINK/Y_KINK2 kept as aliases for older callers.
export const Y_SPIRE = 600, Y_BREAK = 30, Y_CROWN = 450, Y_FOLD = 690, Y_KINK = 450, Y_KINK2 = 450;
export const PIVOT_X = 18;                 // lean pivot: compression-side toe (+x = lean / crown-topple direction)
export const FALL_DIR = [1, 0, 0];         // lean + crown topple toward +x (side cameras should look along ±z)

function wingDims(k, y) {
  let c = 0; for (let j = 0; j < SETBACK.length; j++) if (j % 3 === k && SETBACK[j] < y - 1e-3) c++;
  const n = SETBACK.length / 3;
  return { L: L0 - c * (L0 - L1) / n, W: W0 - c * (W0 - W1) / n, c };
}
// Star-shaped plan outline: union of the hexagonal core and three rounded wings ("Hymenocallis" Y-plan). Sampled as
// r(θ) at fixed angles, so every tier shares the same angular grid: walls stay continuous and setback terraces are
// clean rings between two outlines (no overlapping slabs).
const NA = 216, ANG = Array.from({ length: NA }, (_, i) => i / NA * Math.PI * 2);
function insideWing(x, z, k, L, W) {
  const a = WING_A[k], ca = Math.cos(a), sa = Math.sin(a);
  const u = x * ca + z * sa, v = -x * sa + z * ca, r = W / 2, cu = Math.max(L - r, 0.5);
  const uu = Math.min(Math.max(u, 0), cu);
  // slightly waisted sides: the wing narrows a little at mid-length (petal look)
  const waist = 1 - 0.07 * Math.sin(Math.PI * Math.min(Math.max(u / cu, 0), 1));
  return Math.hypot(u - uu, v / waist) <= r;
}
const outlineCache = new Map();
function outline(y) {
  const d = [0, 1, 2].map((k) => wingDims(k, y)), key = d.map((o) => o.c).join(',');
  if (outlineCache.has(key)) return outlineCache.get(key);
  const pts = ANG.map((t) => {
    const cx = Math.cos(t), cz = Math.sin(t);
    let lo = 0, hi = 90;
    const ins = (r) => { if (r <= RC * 0.93) return true; const x = cx * r, z = cz * r;
      for (let k = 0; k < 3; k++) if (insideWing(x, z, k, d[k].L, d[k].W)) return true; return false; };
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ins(m)) lo = m; else hi = m; }
    return [cx * lo, cz * lo];
  });
  outlineCache.set(key, pts); return pts;
}
function hexPoly(r, n = 6, rot = Math.PI / 6) { const p = []; for (let i = 0; i < n; i++) { const a = rot + i * 2 * Math.PI / n; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; }

// geometry builder with custom attributes
class GB {
  constructor() { this.p = []; this.n = []; this.gy = []; this.s = []; this.f = []; this.k = []; this.idx = []; }
  v(x, y, z, nx, ny, nz, gy, s, f, k) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.gy.push(gy); this.s.push(s); this.f.push(f); this.k.push(k); return this.p.length / 3 - 1; }
  // side walls of a convex polygon prism between global heights a..b (local y = gy - base). closed = last→first edge too
  prism(poly, a, b, base, f, k, closed = false, ra = 1, rb = 1) {
    const n = poly.length, cx = poly.reduce((s, p) => s + p[0], 0) / n, cz = poly.reduce((s, p) => s + p[1], 0) / n;
    const E = closed ? n : n - 1;
    const en = [];
    for (let i = 0; i < E; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % n]; let nx = p1[1] - p0[1], nz = -(p1[0] - p0[0]); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      if (nx * ((p0[0] + p1[0]) / 2 - cx) + nz * ((p0[1] + p1[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      en.push([nx, nz]);
    }
    let s = 0;
    for (let i = 0; i < E; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % n], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const nn = (j, end) => {   // vertex normal: smooth with neighbour if the turn is small
        const o = en[j], q = en[(j + (end ? 1 : -1) + E) % E];
        if ((!closed && (end ? j === E - 1 : j === 0)) || o[0] * q[0] + o[1] * q[1] < 0.8) return o;
        const x = o[0] + q[0], z = o[1] + q[1], l = Math.hypot(x, z); return [x / l, z / l];
      };
      const n0 = nn(i, false), n1 = nn(i, true);
      const i0 = this.v(p0[0] * ra, a - base, p0[1] * ra, n0[0], 0, n0[1], a, s, f, k);
      const i1 = this.v(p1[0] * ra, a - base, p1[1] * ra, n1[0], 0, n1[1], a, s + len, f, k);
      const i2 = this.v(p1[0] * rb, b - base, p1[1] * rb, n1[0], 0, n1[1], b, s + len, f, k);
      const i3 = this.v(p0[0] * rb, b - base, p0[1] * rb, n0[0], 0, n0[1], b, s, f, k);
      // winding must match the outward normal (polygon orientation varies): front face = (p1 - p0) × up
      const ex = p1[0] - p0[0], ez = p1[1] - p0[1], fn = (-ez) * (n0[0] + n1[0]) + ex * (n0[1] + n1[1]);
      if (fn >= 0) this.idx.push(i0, i1, i2, i0, i2, i3); else this.idx.push(i0, i2, i1, i0, i3, i2);
      s += len;
    }
  }
  cap(poly, y, base, f, k, sc = 1) {
    const n = poly.length, cx = poly.reduce((s, p) => s + p[0], 0) / n * sc, cz = poly.reduce((s, p) => s + p[1], 0) / n * sc;
    const c = this.v(cx, y - base, cz, 0, 1, 0, y, 0, f, k);
    const ids = poly.map((p) => this.v(p[0] * sc, y - base, p[1] * sc, 0, 1, 0, y, 0, f, k));
    for (let i = 0; i < n; i++) {
      const a = ids[i], b = ids[(i + 1) % n];
      const ax = poly[i][0] - cx, az = poly[i][1] - cz, bx = poly[(i + 1) % n][0] - cx, bz = poly[(i + 1) % n][1] - cz;
      this.tri(c, a, b, 0, 1, 0);
    }
  }
  tri(a, b, c, nx, ny, nz) {
    const P = this.p, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (d >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  ring(outer, inner, y, base, f, k) {   // terrace between two star outlines sharing angles (outer below, inner above)
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, o0 = outer[i], o1 = outer[j], i0 = inner[i], i1 = inner[j];
      if (Math.hypot(o0[0], o0[1]) - Math.hypot(i0[0], i0[1]) < 0.05 && Math.hypot(o1[0], o1[1]) - Math.hypot(i1[0], i1[1]) < 0.05) continue;
      const a = this.v(o0[0], y - base, o0[1], 0, 1, 0, y, Math.hypot(o0[0], o0[1]), f, k), b = this.v(o1[0], y - base, o1[1], 0, 1, 0, y, Math.hypot(o1[0], o1[1]), f, k);
      const c = this.v(i1[0], y - base, i1[1], 0, 1, 0, y, Math.hypot(i1[0], i1[1]), f, k), d = this.v(i0[0], y - base, i0[1], 0, 1, 0, y, Math.hypot(i0[0], i0[1]), f, k);
      // keep the face pointing up (+y): (c - a) × (b - a) must have +y
      this.tri(a, b, c, 0, 1, 0); this.tri(a, c, d, 0, 1, 0);
    }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aGY', new THREE.Float32BufferAttribute(this.gy, 1));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.s, 1));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(this.f, 1));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.k, 1));
    g.setIndex(this.idx); g.computeBoundingSphere(); return g;
  }
}

function buildSegment(s0, s1) {
  const g = new GB();
  if (s0 < 600) {
    const cuts = [s0, ...SETBACK.filter((y) => y > s0 && y < s1), s1];
    for (let c = 0; c < cuts.length - 1; c++) {
      const a = cuts[c], b = cuts[c + 1], ol = outline((a + b) / 2);
      g.prism(ol, a, b, s0, 1, 0, true);
      if (c < cuts.length - 2) g.ring(ol, outline((b + cuts[c + 2]) / 2), b, s0, 1, 2);
      if (Math.abs(b - 600) < 1e-3) g.cap(ol, b, s0, 1, 2);
    }
    // a terrace that falls exactly on the segment's top boundary (setback == boundary)
    const jb = SETBACK.findIndex((y) => Math.abs(y - s1) < 1e-3);
    if (jb >= 0) g.ring(outline(s1 - 0.5), outline(s1 + 0.5), s1, s0, 1, 2);
  } else {
    // pinnacle (glass crown, 600–690) and braced steel spire (690–828): tapered 24-gons + three tapering fins
    const rAt = (y) => y <= 690 ? 9.5 - (y - 600) / 90 * 4.6 : 4.6 - (y - 690) / 138 * 4.0;
    const finW = (y) => Math.max(0, 6.5 * Math.pow(Math.max(0, 1 - (y - 600) / 150), 1.3));
    const N = 24, circ = hexPoly(1, N, 0);
    const steps = Math.ceil((s1 - s0) / 5);
    for (let i = 0; i < steps; i++) {
      const a = s0 + (s1 - s0) * i / steps, b = s0 + (s1 - s0) * (i + 1) / steps;
      g.prism(circ, a, b, s0, 5, s0 >= 690 ? 1 : 0, true, rAt(a), rAt(b));
      for (let k = 0; k < 3; k++) {
        const wa = finW(a), wb = finW(b); if (wa <= 0.05) continue;
        const ang = WING_A[k], ca = Math.cos(ang), sa = Math.sin(ang), t = 0.35;
        const P = (r, v) => [r * ca - v * sa, r * sa + v * ca];
        const fa = [P(rAt(a) - 0.5, -t), P(rAt(a) + wa, -t), P(rAt(a) + wa, t), P(rAt(a) - 0.5, t)];
        const fb = [P(rAt(b) - 0.5, -t), P(rAt(b) + wb, -t), P(rAt(b) + wb, t), P(rAt(b) - 0.5, t)];
        // fins taper: build each band as a quad loop between fa (bottom) and fb (top)
        for (let e = 0; e < 4; e++) {
          const p0 = fa[e], p1 = fa[(e + 1) % 4], q1 = fb[(e + 1) % 4], q0 = fb[e];
          let nx = p1[1] - p0[1], nz = -(p1[0] - p0[0]); const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2, cx = (fa[0][0] + fa[2][0]) / 2, cz = (fa[0][1] + fa[2][1]) / 2;
          const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
          const i0 = g.v(p0[0], a - s0, p0[1], nx, 0, nz, a, 0, 6, 1), i1 = g.v(p1[0], a - s0, p1[1], nx, 0, nz, a, 1, 6, 1);
          const i2 = g.v(q1[0], b - s0, q1[1], nx, 0, nz, b, 1, 6, 1), i3 = g.v(q0[0], b - s0, q0[1], nx, 0, nz, b, 0, 6, 1);
          g.tri(i0, i1, i2, nx, 0, nz); g.tri(i0, i2, i3, nx, 0, nz);
        }
      }
    }
    if (s1 >= 828) g.cap(circ, 828, s0, 5, 1, rAt(828));
    if (s0 === 600) { g.prism(circ, 600, 602.5, s0, 6, 1, true, 14, 14); g.cap(circ, 602.5, s0, 6, 1, 14); }
  }
  return g.geo();
}

const HASH = /* glsl */`
float h13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }`;

export function towerMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.85, envMapIntensity: 1.6 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float aGY; attribute float aS; attribute float aF; attribute float aK; varying float vGY; varying float vS; varying float vF; varying float vK; varying vec2 vXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGY = aGY; vS = aS; vF = aF; vK = aK; vXZ = position.xz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uDmg; uniform float uXray; uniform float uStress; uniform float uS[48]; uniform float uL[48]; uniform vec2 uBend; varying float vGY; varying float vS; varying float vF; varying float vK; varying vec2 vXZ; ${HASH}
// x = demand/capacity. Red ONLY at >= 1.0 (LIMIT); below that the ramp tops out at amber.
vec3 heat(float x){ x = clamp(x, 0.0, 1.25);
  vec3 c = mix(vec3(0.05,0.15,0.9), vec3(0.0,0.8,1.0), smoothstep(0.0,0.3,x)); c = mix(c, vec3(0.2,1.0,0.45), smoothstep(0.3,0.55,x));
  c = mix(c, vec3(1.0,0.95,0.1), smoothstep(0.55,0.78,x)); c = mix(c, vec3(1.0,0.55,0.05), smoothstep(0.78,0.97,x));
  if (x >= 1.0) c = mix(vec3(1.0,0.12,0.04), vec3(1.0,0.9,0.85), smoothstep(1.0,1.25,x)); return pow(c, vec3(2.2)); }   // palette authored in sRGB; emissive is linear`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float mMetal = 0.85, mRough = 0.12; vec3 mEmis = vec3(0.0); float mGlass = 0.0;
{
  float fl = vGY / 3.75, ff = fract(fl), ms = vS / 1.55, mf = fract(ms);
  float fwS = fwidth(ms), fwF = fwidth(fl);
  float aaS = clamp(1.6 - fwS * 2.0, 0.0, 1.0), aaF = clamp(1.6 - fwF * 2.0, 0.0, 1.0);
  float heavy = step(0.5, fract(floor(ms) * 0.5));
  float fin = (1.0 - smoothstep(mix(0.10, 0.22, heavy), mix(0.20, 0.32, heavy) + fwS, abs(mf - 0.5) * -2.0 + 1.0)) ;
  fin = mix(0.18, fin, aaS);
  float span = smoothstep(0.80 - fwF, 0.82 + fwF, ff) * (1.0 - smoothstep(0.97 - fwF, 1.0, ff));
  span = mix(0.17, span, aaF);
  vec3 cell = vec3(floor(fl), floor(ms), vF);
  float h1 = h13(cell), h2 = h13(cell + 17.3), h3 = h13(vec3(floor(fl / 5.0), floor(ms / 4.0), vF + 9.0));
  vec3 col;
  if (vK < 0.5) {
    float tier = h13(vec3(floor(vGY / 18.5), vF, 3.0));
    vec3 glass = vec3(0.11, 0.155, 0.235) * (0.9 + 0.14 * h2 + 0.08 * tier);
    float gr = 0.14 + 0.05 * h1;
    float broken = step(h1, uDmg * (0.35 + 1.3 * h3)) * (1.0 - fin);
    vec3 finC = vec3(0.80, 0.81, 0.83), spC = vec3(0.42, 0.45, 0.50);
    col = mix(glass, mix(glass, spC, 0.45), span); span *= 0.4; mRough = mix(gr, 0.35, span); mMetal = mix(0.55, 0.4, span);
    col = mix(col, vec3(0.78, 0.79, 0.81), fin); mRough = mix(mRough, 0.38, fin); mMetal = mix(mMetal, 0.25, fin);
    mGlass = (1.0 - fin) * (1.0 - span);
    float mech = 0.0; const float MH[5] = float[](125.0, 245.0, 365.0, 470.0, 560.0);
    for (int i = 0; i < 5; i++) mech = max(mech, 1.0 - smoothstep(3.2, 4.2, abs(vGY - MH[i])));
    if (mech > 0.0) { float lv = 0.5 + 0.5 * smoothstep(0.3, 0.7, fract(vGY / 0.75)); vec3 lc = vec3(0.16, 0.17, 0.19) * (0.8 + 0.4 * lv);
      col = mix(col, lc, mech * (1.0 - fin * 0.5)); mRough = mix(mRough, 0.55, mech); mMetal = mix(mMetal, 0.6, mech); mGlass *= 1.0 - mech; }
    if (broken > 0.5 && span < 0.5) { col = vec3(0.05, 0.045, 0.04); mRough = 0.95; mMetal = 0.0; mEmis = vec3(0.08, 0.05, 0.03) * h2; mGlass = 0.0; }
  } else if (vK < 1.5) {
    float band = smoothstep(0.85, 0.9, fract(vGY / 6.0));
    col = mix(vec3(0.78, 0.79, 0.81), vec3(0.45, 0.47, 0.5), band); mRough = 0.3; mMetal = 1.0;
  } else {
    col = vec3(0.70, 0.68, 0.64) * (0.9 + 0.1 * h13(vec3(floor(vS / 6.0), vGY, 1.0))); mRough = 0.75; mMetal = 0.05;
  }
  if (uStress > 0.0) {
    float fi = clamp(vGY / 828.0, 0.0, 1.0) * 47.0; int i0 = int(floor(fi)); int i1 = min(i0 + 1, 47);
    float sv = mix(uS[i0], uS[i1], fract(fi)), lv = mix(uL[i0], uL[i1], fract(fi));
    // flanges: compression side (facing the bend) carries the full D/C, tension flange 0.85, webs 0.7, alternates with sway
    float dd = dot(normalize(vXZ + vec2(1e-3)), uBend);
    float side = 0.7 + 0.3 * max(dd, 0.0) + 0.15 * max(-dd, 0.0);
    float hv = sv * side;
    // link (coupling) beams = the floor bands: show their own D/C (fuses) on the spandrel stripes
    hv = mix(hv, max(hv, lv), span * step(vK, 0.5));
    float iso = 1.0 - smoothstep(0.0, 0.09, abs(fract(hv * 8.0) - 0.5) * 2.0 - 0.82);
    vec3 hc = heat(hv) * (0.75 + 0.25 * iso);
    float mesh = max(1.0 - smoothstep(0.0, 0.06, min(ff, 1.0 - ff) * 2.0), 0.0) * 0.25;
    col = mix(col, vec3(0.02), uStress); mMetal = mix(mMetal, 0.0, uStress); mRough = mix(mRough, 0.9, uStress);
    mEmis = mix(mEmis, hc * (0.85 - mesh * 0.85), uStress);   // kept below tone-map clipping so hue reads
  }
  if (uXray > 0.0) {
    // X-ray: reinforced concrete (ivory) up to level 156 (~600 m), structural steel (cool graphite-blue) above; floor plates + amber L156 band
    float steel = step(600.0, vGY);
    float fpl = 1.0 - smoothstep(0.0, 0.08 + fwidth(vGY / 3.75), abs(fract(vGY / 3.75) - 0.5) * -2.0 + 1.0);
    float brace = steel * (1.0 - smoothstep(0.0, 0.12, abs(fract((vGY + vS * 1.3) / 9.0) - 0.5) * -2.0 + 1.0));
    float l156 = 1.0 - smoothstep(1.5, 3.5, abs(vGY - 600.0));
    vec3 xc = mix(vec3(0.62, 0.56, 0.46), vec3(0.22, 0.30, 0.42), steel);
    xc += vec3(0.35, 0.30, 0.22) * fpl * (1.0 - steel) + vec3(0.25, 0.38, 0.55) * brace;
    xc = mix(xc, vec3(1.0, 0.62, 0.18) * 1.4, l156);
    col = mix(col, vec3(0.02), uXray); mMetal = mix(mMetal, 0.0, uXray); mRough = mix(mRough, 0.9, uXray);
    mEmis = mix(mEmis, xc * 0.55, uXray);
  }
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mMetal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += mEmis;`);
  };
  m.customProgramCacheKey = () => 'burj3';
  return m;
}

// makeTower(scenario?) — default FILM (the 38 s timeline). For the app: makeTower(makeScenario(M)) or tower.setScenario(sc);
// pose(t, sc?) also accepts a scenario per call. t is the scenario's own time (film time for FILM).
export function makeTower(scenario = FILM) {
  let SC = scenario;
  const U = { uDmg: { value: 0 }, uXray: { value: 0 }, uStress: { value: 0 }, uS: { value: new Float32Array(SBINS) }, uL: { value: new Float32Array(SBINS) }, uBend: { value: new THREE.Vector2(1, 0) } };
  const mat = towerMaterial(U);
  const root = new THREE.Group(); root.name = 'burj';
  const segs = [];
  for (let i = 0; i < BOUNDS.length - 1; i++) {
    const s0 = BOUNDS[i], s1 = BOUNDS[i + 1];
    const mesh = new THREE.Mesh(buildSegment(s0, s1), mat); mesh.castShadow = true; mesh.receiveShadow = true;
    const g = new THREE.Group(); g.add(mesh); root.add(g);
    segs.push({ s0, s1, g, mesh });
  }
  // podium ring (low base around the tower)
  // Y-shaped stone plinth following the tower's own footprint (two steps), instead of a generic disc
  const pg = new GB(), ol0 = outline(1), sc = (o, k) => o.map(([x, z]) => [x * k, z * k]);
  pg.prism(sc(ol0, 1.55), -1, 1.2, 0, 7, 2, true); pg.cap(sc(ol0, 1.55), 1.2, 0, 7, 2);
  pg.prism(sc(ol0, 1.22), 1.2, 6.5, 0, 7, 2, true); pg.cap(sc(ol0, 1.22), 6.5, 0, 7, 2);
  const pod = new THREE.Mesh(pg.geo(), mat); pod.castShadow = pod.receiveShadow = true;
  const podG = new THREE.Group(); podG.add(pod); root.add(podG);
  const Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), QR = new THREE.Quaternion(), V = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Vector3();
  const AZ = new THREE.Vector3(0, 0, 1), XA = new THREE.Vector3(1, 0, 0), YA = new THREE.Vector3(0, 1, 0);
  const G = {};
  const N = segs.length, iSp = segs.findIndex((sg) => sg.s0 >= Y_SPIRE);
  const hash = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  const state = { hinge: new THREE.Vector3(), top: new THREE.Vector3(), spireHinge: new THREE.Vector3(), kink: new THREE.Vector3(), kink2: new THREE.Vector3(),
    spireCM: new THREE.Vector3(), spireLand: null, segWorld: segs.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() })) };
  const cp = segs.map(() => new THREE.Vector3()), cq = segs.map(() => new THREE.Quaternion());
  // standing chain (tower frame, origin = ground point under the axis): sway × DEF_SCALE, faded by fs; seg 0 height × cs
  function chain(t, s, fs, cs) {
    P.set(0, 0, 0);
    for (let i = 0; i < N; i++) {
      const sg = segs[i], h = (sg.s1 - sg.s0) * (i === 0 ? cs : 1), ym = (sg.s0 + sg.s1) / 2;
      const sl = SC.swaySlope(Math.min(ym, Y_SPIRE), s), k = DEF_SCALE * fs;
      let ax = sl.x * k, az = sl.z * k;
      if (sg.s0 >= Y_SPIRE) ax += s.whip * DEF_SCALE * fs * (1 + 0.6 * (ym - Y_SPIRE) / 228);   // spire whip (higher mode)
      Q.setFromAxisAngle(AZ, -ax); Q2.setFromAxisAngle(XA, az); Q.multiply(Q2);
      Q2.setFromAxisAngle(YA, s.tor * DEF_SCALE * fs * Math.min(1, ym / Y_SPIRE)); Q.multiply(Q2);
      cp[i].copy(P); cq[i].copy(Q);
      V.set(0, h, 0).applyQuaternion(Q); P.add(V);
    }
    return P;   // tip
  }
  // spire while hinged at the joint (SC.tSpire..+SPIRE_PIVOT): rotates toward −x about the joint's −x edge
  // (at SC.tSpire the shaft is near its −x extreme, so the inertial load on the spire points −x)
  const spP = segs.map(() => new THREE.Vector3()), spQ = segs.map(() => new THREE.Quaternion());
  function spireHinged(t) {
    const s = SC.sway(t); chain(t, s, 1, 1);
    SC.ground(0, 0, t, G);
    const J = C.copy(cp[iSp]).add(V.set(-7, 0, 0).applyQuaternion(cq[iSp])).add(new THREE.Vector3(G.hx, G.y, G.hz));
    QR.setFromAxisAngle(AZ, SC.spireAngle(t));
    for (let i = iSp; i < N; i++) {
      spP[i].copy(cp[i]).add(V.set(G.hx, G.y, G.hz)).sub(J).applyQuaternion(QR).add(J);
      spQ[i].copy(QR).multiply(cq[i]);
    }
    return J;
  }
  // release state (cached): CM position/velocity, segment offsets about CM
  let REL = null;
  function release() {
    if (REL) return REL;
    const tr = SC.tSpire + SPIRE_PIVOT, dt = 1e-3, cmAt = (t) => { spireHinged(t); return spP[iSp].clone().add(V.set(0, 80, 0).applyQuaternion(spQ[iSp])); };
    const c0 = cmAt(tr - dt), c1 = cmAt(tr);
    REL = { tr, cm: c1, v: c1.clone().sub(c0).multiplyScalar(1 / dt), w: SC.spireOmega(), off: [], q: [] };
    for (let i = iSp; i < N; i++) { REL.off[i] = spP[i].clone().sub(c1); REL.q[i] = spQ[i].clone(); }
    // landing: first time the lowest end touches the ground (y ≈ 3)
    const tmp = new THREE.Vector3();
    for (let u = 0; u < 6; u += 0.005) {
      const cmy = c1.y + REL.v.y * u - 0.5 * G_FILM * u * u; QR.setFromAxisAngle(AZ, REL.w * u);
      tmp.copy(REL.off[iSp]).applyQuaternion(QR); const yb = cmy + tmp.y;
      tmp.copy(REL.off[N - 1]).add(V.set(0, segs[N - 1].s1 - segs[N - 1].s0, 0).applyQuaternion(REL.q[N - 1])).applyQuaternion(QR); const yt = cmy + tmp.y;
      if (Math.min(yb, yt) < 3) { REL.tl = tr + u; REL.pl = new THREE.Vector3(c1.x + REL.v.x * u, 0, c1.z + REL.v.z * u); break; }
    }
    if (REL.tl === undefined) { REL.tl = tr + 6; REL.pl = c1.clone().setY(0); }
    state.spireLand = { t: REL.tl, p: REL.pl };
    return REL;
  }
  // pose the whole tower for time t. returns state (world positions of key points)
  function setScenario(sc) { SC = sc || FILM; REL = null; state.spireLand = null; state.crownLand = null; }
  // fracture faces at the crown break (450 m): body top (faces up) and crown underside (faces down). Shown once separated.
  const iCr = segs.findIndex((sg) => sg.s0 >= Y_CROWN), iFold = segs.findIndex((sg) => sg.s0 >= Y_FOLD);
  const capMesh = (y, base, down) => {
    const g = new GB(); g.cap(outline(y + (down ? 0.5 : -0.5)), y, base, 1, 2); const geo = g.geo();
    if (down) { const n = geo.attributes.normal.array; for (let i = 1; i < n.length; i += 3) n[i] = -n[i]; const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; } }
    const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; m.visible = false; return m;
  };
  const bodyCap = capMesh(Y_CROWN, segs[iCr - 1].s0, false); segs[iCr - 1].g.add(bodyCap);
  const crownCap = capMesh(Y_CROWN, Y_CROWN, true); segs[iCr].g.add(crownCap);
  // rubble mound: unit dome (radius 1, height 1) with deterministic lumps; scaled to (rubbleR, rubbleH, rubbleR)
  const mound = (() => {
    const NR = 14, NA2 = 56, pos = [], idx = [];
    for (let j = 0; j <= NR; j++) for (let k = 0; k <= NA2; k++) {
      const rho = j / NR, a = k / NA2 * Math.PI * 2, n = j === 0 ? 0 : (hash(j * 7 + (k % NA2), 9) - 0.5);
      const rr = rho * (1 + 0.08 * Math.sin(a * 3 + 1) + (j === NR ? 0 : 0.06 * n));
      const h = j === NR ? -0.06 : Math.pow(1 - rho * rho, 1.2) * (0.86 + 0.28 * hash(j * 13 + (k % NA2), 5)) + 0.1 * Math.sin(a * 5) * rho * (1 - rho);
      pos.push(Math.cos(a) * rr, h, Math.sin(a) * rr);
    }
    for (let j = 0; j < NR; j++) for (let k = 0; k < NA2; k++) { const a = j * (NA2 + 1) + k, b = a + NA2 + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    const m = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ color: '#958a7c', roughness: 0.97, metalness: 0, flatShading: true }));
    m.castShadow = m.receiveShadow = true; m.visible = false; m.name = 'rubble'; return m;
  })();
  root.add(mound);
  Object.assign(state, { crushFront: new THREE.Vector3(), crownCM: new THREE.Vector3(), crownLand: null, rubble: { h: 0, r: 0, x: 0, z: 0 } });
  const Cb = new THREE.Vector3(), E = new THREE.Vector3(), GO = new THREE.Vector3(), F = new THREE.Vector3();
  const qTh = new THREE.Quaternion(), qCr = new THREE.Quaternion(), qFold = new THREE.Quaternion();
  function pose(t, sc) {
    if (sc && sc !== SC) setScenario(sc);
    SC.ground(0, 0, t, G);
    podG.position.set(G.hx, G.y, G.hz);
    const s = SC.sway(t), sa = SC.spireAngle(t), br = SC.breakState(t), broken = t > SC.tBreak;
    U.uDmg.value = SC.damage(t); SC.stressProfile(t, U.uS.value, U.uL.value);
    if (broken) U.uBend.value.set(1, 0);
    else { const bx = s.x || 1e-6, bz = s.z || 0, l = Math.hypot(bx, bz); U.uBend.value.set(bx / l, bz / l); }
    const fs = 1 - (broken ? Math.min(1, (t - SC.tBreak) / 1.0) ** 2 * (3 - 2 * Math.min(1, (t - SC.tBreak) / 1.0)) : 0);
    const cs = 1 - 0.6 * br.crush;                     // crush zone (0–30 m) loses height on the compression side
    chain(t, s, fs, cs);
    GO.set(G.hx, G.y, G.hz);
    // lean pivot: compression-side toe at the top of the crush zone; then the whole body descends by br.drop
    Cb.copy(cp[1]).add(V.set(PIVOT_X, 0, 0));
    qTh.setFromAxisAngle(AZ, -br.th);
    // crown pivot: +x edge of the body top (450 m), after lean + descent
    E.copy(cp[iCr]).add(V.set(22, 0, 0).applyQuaternion(cq[iCr])).sub(Cb).applyQuaternion(qTh).add(Cb); E.y -= br.drop;
    if (br.sep) E.y = Math.max(E.y, br.rubbleH * 0.85);   // the crown rides on the pile; it cannot sink into it
    qCr.setFromAxisAngle(AZ, -br.crown);
    const rubH = br.rubbleH, mx = MOUND_X + 30 * Math.min(1, br.drop / 430);
    let foldSet = false;
    for (let i = 0; i < N; i++) {
      const sg = segs[i], wp = state.segWorld[i], h = (sg.s1 - sg.s0) * (i === 0 ? cs : 1);
      P.copy(cp[i]); Q.copy(cq[i]);
      if (i >= 1 && broken) {
        P.sub(Cb).applyQuaternion(qTh).add(Cb); Q.premultiply(qTh); P.y -= br.drop;
        if (i >= iCr && br.sep) { P.sub(E).applyQuaternion(qCr).add(E); Q.premultiply(qCr); }
        if (br.imp > 0 && i >= iCr) {   // crown breaks up on landing: pieces settle/skew independently
          QR.setFromAxisAngle(XA, br.imp * 0.08 * (hash(i, 1) - 0.5)); Q.premultiply(QR);
          QR.setFromAxisAngle(YA, br.imp * 0.06 * (hash(i, 2) - 0.5)); Q.premultiply(QR);
          P.y -= br.imp * (3 + 6 * hash(i, 3)); P.z += br.imp * 6 * (hash(i, 4) - 0.5); P.x += br.imp * 4 * (i - iCr);
        }
      }
      P.add(GO);
      let vis = true;
      if (i >= iSp && t >= SC.tSpire) {
        if (t < SC.tSpire + SPIRE_PIVOT) { spireHinged(t); P.copy(spP[i]); Q.copy(spQ[i]); SC.ground(0, 0, t, G); }
        else {
          const R = release(), u = t - R.tr;
          QR.setFromAxisAngle(AZ, R.w * u);
          P.set(R.cm.x + R.v.x * u, R.cm.y + R.v.y * u - 0.5 * G_FILM * u * u, R.cm.z + R.v.z * u).add(V.copy(R.off[i]).applyQuaternion(QR));
          Q.copy(QR).multiply(R.q[i]);
          // fold at ≈1/3 length: the slender upper spire lags the tumbling lower part and buckles at 690 m
          if (i >= iFold) {
            if (!foldSet) { F.copy(P); foldSet = true; }
            qFold.setFromAxisAngle(AZ, -0.75 * sm01((u - 0.25) / 0.7));
            P.sub(F).applyQuaternion(qFold).add(F); Q.premultiply(qFold);
          }
          if (t >= R.tl) vis = false;
        }
      }
      // telescoping: a storey block fully below the rubble top is gone (crushed into the pile)
      if (broken && i < (br.sep ? iCr : iSp)) {
        V.set(0, h, 0).applyQuaternion(Q).add(P);
        if (Math.max(V.y, P.y) < rubH + GO.y - 1.5) vis = false;
        if (i === 0 && br.drop > 12) vis = false;
      }
      sg.g.visible = vis;
      sg.g.position.copy(P); sg.g.quaternion.copy(Q);
      sg.g.scale.set(1, i === 0 ? cs : 1, 1);
      wp.p.copy(P); wp.q.copy(Q);
    }
    bodyCap.visible = crownCap.visible = !!br.sep && t < SC.tImpact + 0.6 && segs[iCr - 1].g.visible;
    if (br.sep) bodyCap.visible = segs[iCr - 1].g.visible;
    // rubble mound (centre drifts a little toward the lean)
    mound.visible = broken && br.drop > 0.5;
    if (mound.visible) { mound.position.set(mx + GO.x, GO.y - 0.5, GO.z); mound.scale.set(br.rubbleR, Math.max(0.5, rubH), br.rubbleR * 0.92); }
    // key points
    state.crushFront.set(mx * 0.6 + GO.x, GO.y + rubH + 4, GO.z);
    state.hinge.copy(state.crushFront);                                        // dust / debris emitter at the crush front
    state.kink.copy(E).add(GO); state.kink2.copy(state.kink);                 // crown fracture
    { const w = state.segWorld[iCr + 2]; state.crownCM.copy(V.set(0, 15, 0).applyQuaternion(w.q).add(w.p)); }
    state.rubble.h = rubH; state.rubble.r = br.rubbleR; state.rubble.x = mx + GO.x; state.rubble.z = GO.z;
    { const j = iSp - 1, w = state.segWorld[j]; state.spireHinge.copy(V.set(0, segs[j].s1 - segs[j].s0, 0).applyQuaternion(w.q).add(w.p)); }
    { const j = t >= SC.tSpire ? iSp - 1 : N - 1, w = state.segWorld[j]; state.top.copy(V.set(0, segs[j].s1 - segs[j].s0, 0).applyQuaternion(w.q).add(w.p)); }
    { const w = state.segWorld[iSp]; state.spireCM.copy(V.set(0, 80, 0).applyQuaternion(w.q).add(w.p)); }
    if (!state.spireLand && isFinite(SC.tSpire)) release();
    state.sway = s; state.br = br; state.sa = sa;
    return state;
  }
  const sm01 = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  // a point on the facade (for glass shards): returns local-in-segment position + outward normal (tower frame, unswayed)
  function facadePoint(y, r1, r2) {
    if (y >= 600) { const a = r1 * 2 * Math.PI, rr = 10; return { p: [Math.cos(a) * rr, y, Math.sin(a) * rr], n: [Math.cos(a), 0, Math.sin(a)] }; }
    const k = Math.floor(r1 * 3) % 3, { L, W } = wingDims(k, y), a = WING_A[k], ca = Math.cos(a), sa = Math.sin(a);
    const u = RC * 0.9 + r2 * (L - W / 2 - RC * 0.9), side = (r1 * 3 % 1) < 0.5 ? -1 : 1, v = side * W / 2;
    return { p: [u * ca - v * sa, y, u * sa + v * ca], n: [-side * sa, 0, side * ca] };
  }
  function segIndex(y) { for (let i = 0; i < segs.length; i++) if (y < segs[i].s1) return i; return segs.length - 1; }
  return { root, segs, pose, setScenario, get scenario() { return SC; }, state, U, facadePoint, segIndex, mat };
}
