// Real Downtown Dubai ground: terrain (GPU-heaved), painted plazas/parks/sidewalks, road strips with lane markings and
// crosswalks, elevated roads with piers, the Dubai Metro viaduct + trains, palms/broadleaf trees, street lamps, and cars
// driving on the real road graph. Everything flat rides quake.js ground() through the GLSL port in city_real.js.
import * as THREE from 'three';
import * as Q from './quake.js';
import { clamp } from './quake.js';
import { GU, hookFlat, hookInst, rng, hashStr, area, inPoly, distSeg, BURJ_CLEAR, GB } from './city_real.js';

const fnOf = (sc, n) => (sc && typeof sc[n] === 'function' ? sc[n].bind(sc) : Q[n]);
const ROADW = { motorway: 3.7, trunk: 3.6, primary: 3.4, secondary: 3.3, tertiary: 3.2, residential: 3.0, unclassified: 3.0, living_street: 2.8, service: 2.8 };
const DRIVE = /motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|_link/;
const SIDEWALK = /primary|secondary|tertiary|residential|unclassified|living_street/;
export const GSIZE = 5200;

// ---------------------------------------------------------------------------------------------------------------------
// polyline utilities
function resample(pts, step) {
  const o = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) o.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  return o;
}
function cumLen(p) { const s = [0]; for (let i = 1; i < p.length; i++) s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return s; }
// split a polyline wherever it enters the Burj clearing
function clipClear(pts, r) {
  const out = []; let cur = [];
  for (const p of resample(pts, 8)) { if (Math.hypot(p[0], p[1]) < r) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(p); }
  if (cur.length > 1) out.push(cur); return out;
}
const nodeKey = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);

// prepared road list (shared by strips, cars, lamps)
export function prepRoads(D) {
  const deg = new Map(), bridgeEnd = new Map();
  const roads = [];
  for (const r of D.roads || []) {
    if (!r.pts || r.pts.length < 2 || r.tunnel || (r.layer < 0 && !r.bridge)) continue;
    const cls = String(r.cls || 'residential');
    if (/footway|path|cycleway|steps|pedestrian|track|corridor|platform|construction|proposed/.test(cls)) continue;
    for (const pts of clipClear(+r.oneway === -1 ? r.pts.slice().reverse() : r.pts, BURJ_CLEAR - 10)) {
      const lanes = Math.max(1, +r.lanes || (/motorway|trunk/.test(cls) ? 3 : /primary|secondary/.test(cls) ? 2 : 1) * (r.oneway ? 1 : 2));
      const width = +r.width || lanes * (ROADW[cls.replace('_link', '')] || 3.0);
      roads.push({ cls, lanes, width: Math.min(width, 40), oneway: !!r.oneway, bridge: !!r.bridge, layer: +r.layer || 0, pts });
    }
  }
  for (const r of roads) for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) { const k = nodeKey(p); deg.set(k, (deg.get(k) || 0) + 1); if (r.bridge) bridgeEnd.set(k, true); }
  // interior junctions: points shared by other roads' endpoints
  for (const r of roads) {
    const p = resample(r.pts, 10); r.p = p; r.s = cumLen(p); r.len = r.s[r.s.length - 1];
    r.j0 = (deg.get(nodeKey(r.pts[0])) || 0) >= 3 ? 1 : 0; r.j1 = (deg.get(nodeKey(r.pts[r.pts.length - 1])) || 0) >= 3 ? 1 : 0;
    const H = r.bridge ? 6.5 * Math.max(1, r.layer) : 0, rp = Math.min(90, r.len * 0.45);
    const b0 = bridgeEnd.get(nodeKey(r.pts[0])) && (deg.get(nodeKey(r.pts[0])) || 0) > 1, b1 = bridgeEnd.get(nodeKey(r.pts[r.pts.length - 1])) && (deg.get(nodeKey(r.pts[r.pts.length - 1])) || 0) > 1;
    r.H = H; r.hAt = (s) => (H ? H * (b0 ? 1 : Q.sm(s / rp)) * (b1 ? 1 : Q.sm((r.len - s) / rp)) : 0);
  }
  return roads;
}
function posAt(r, s, out) {
  const S = r.s; let lo = 0, hi = S.length - 1; s = clamp(s, 0, r.len);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const a = r.p[lo], b = r.p[hi], L = S[hi] - S[lo] || 1, u = (s - S[lo]) / L;
  out.x = a[0] + (b[0] - a[0]) * u; out.z = a[1] + (b[1] - a[1]) * u; out.dx = (b[0] - a[0]) / L; out.dz = (b[1] - a[1]) / L; return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// terrain: big GPU-displaced grid with a painted map (desert, urban paving, plazas, parks, sidewalks, lake edge)
export function makeRealGround(K, opts, D, roads, water) {
  const seg = opts.quality === 'realtime' ? 320 : 448;
  const g = new THREE.PlaneGeometry(GSIZE, GSIZE, seg, seg); g.rotateX(-Math.PI / 2);
  // lake depression (static) as a per-vertex sink
  const pos = g.attributes.position, sink = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); if (water.inWater(x, z, -(GSIZE / seg + 3))) sink[i] = 30; }
  g.setAttribute('aSink', new THREE.BufferAttribute(sink, 1));
  const map = paintMap(K, D, roads, water); map.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
  hookFlat(m, 'bq-terrain', { vpars: 'attribute float aSink;', vmain: 'transformed.y -= aSink;' });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.frustumCulled = false;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); hookFlat(depth, 'bq-terrain-d', { vpars: 'attribute float aSink;', vmain: 'transformed.y -= aSink;' });
  mesh.customDepthMaterial = depth;
  const far = new THREE.Mesh(new THREE.RingGeometry(GSIZE * 0.45, 40000, 64, 1), new THREE.MeshStandardMaterial({ color: '#c09f77', roughness: 1, envMapIntensity: 0.35 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.6; far.receiveShadow = true;
  return { mesh, far, update: () => {} };
}
function paintMap(K, D, roads, water) {
  const N = 4096, s = N / GSIZE, P = (v) => (v + GSIZE / 2) * s, R = rng(11);
  let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
  for (const b of D.buildings || []) for (const [x, z] of b.poly || []) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  const path = (c, poly) => { c.beginPath(); poly.forEach(([x, z], i) => (i ? c.lineTo(P(x), P(z)) : c.moveTo(P(x), P(z)))); c.closePath(); };
  return K.canvasTex(N, N, (c) => {
    c.fillStyle = '#c4a47c'; c.fillRect(0, 0, N, N);
    for (let i = 0; i < 12000; i++) { c.fillStyle = `rgba(${165 + R() * 50 | 0},${130 + R() * 45 | 0},${95 + R() * 35 | 0},${0.06 + R() * 0.1})`; const r = 3 + R() * 40; c.beginPath(); c.arc(R() * N, R() * N, r, 0, 7); c.fill(); }
    // urban zone: paving with lots / blocks texture inside the data bbox (soft edge into the desert)
    if (bx1 > bx0) {
      const pad = 120, gr = c.createRadialGradient(P(0), P(0), 1500 * s, P(0), P(0), 2500 * s); gr.addColorStop(0, 'rgba(158,148,134,0.92)'); gr.addColorStop(1, 'rgba(158,148,134,0.0)');
      c.fillStyle = gr; c.fillRect(0, 0, N, N); void pad;
      for (let i = 0; i < 6000; i++) { const x = P(bx0) + R() * (bx1 - bx0) * s, y = P(bz0) + R() * (bz1 - bz0) * s; c.fillStyle = `rgba(${120 + R() * 70 | 0},${112 + R() * 60 | 0},${100 + R() * 50 | 0},0.22)`; c.fillRect(x, y, 6 + R() * 50, 6 + R() * 50); }
    }
    // sidewalks along urban roads (drawn under the road strips)
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const r of roads) { if (r.bridge || !SIDEWALK.test(r.cls)) continue; c.strokeStyle = '#cfc4b2'; c.lineWidth = (r.width + 7) * s; c.beginPath(); r.p.forEach(([x, z], i) => (i ? c.lineTo(P(x), P(z)) : c.moveTo(P(x), P(z)))); c.stroke(); }
    for (const r of roads) { if (r.bridge) continue; c.strokeStyle = '#4a4a4c'; c.lineWidth = (r.width + 0.6) * s; c.beginPath(); r.p.forEach(([x, z], i) => (i ? c.lineTo(P(x), P(z)) : c.moveTo(P(x), P(z)))); c.stroke(); }
    // plazas (light stone), lake promenade
    for (const p of D.plazas || []) { const poly = p.poly || p; if (!poly || poly.length < 3) continue; c.fillStyle = '#d6cab6'; path(c, poly); c.fill(); }
    for (const w of water.polys) { c.strokeStyle = '#ddd2bf'; c.lineWidth = 34 * s; path(c, w.poly); c.stroke(); }
    // parks / grass
    for (const gp of D.green || []) { const poly = gp.poly; if (!poly || poly.length < 3) continue;
      const kind = String(gp.kind || 'grass'); c.fillStyle = /golf|pitch/.test(kind) ? '#6f9a48' : /sand|beach/.test(kind) ? '#d9c09a' : '#68884a'; path(c, poly); c.fill();
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      c.save(); path(c, poly); c.clip(); const n = Math.min(800, ((x1 - x0) * (z1 - z0)) / 60 | 0);
      for (let i = 0; i < n; i++) { c.fillStyle = `rgba(${60 + R() * 50 | 0},${100 + R() * 50 | 0},${40 + R() * 30 | 0},0.45)`; c.beginPath(); c.arc(P(x0 + R() * (x1 - x0)), P(z0 + R() * (z1 - z0)), (1 + R() * 4) * s, 0, 7); c.fill(); }
      c.restore(); }
    // Burj plinth park + promenade (the tower's own site)
    c.fillStyle = '#d3c8b4'; c.beginPath(); c.arc(P(0), P(0), BURJ_CLEAR * s, 0, 7); c.fill();
    c.fillStyle = '#6c8b4c'; c.beginPath(); c.arc(P(0), P(0), (BURJ_CLEAR - 8) * s, 0, 7); c.arc(P(0), P(0), 78 * s, 0, 7, true); c.fill();
    for (const w of water.polys) { c.fillStyle = '#1d2a2c'; path(c, w.poly); for (const h of w.holes || []) { h.forEach(([x, z], i) => (i ? c.lineTo(P(x), P(z)) : c.moveTo(P(x), P(z)))); c.closePath(); } c.fill('evenodd'); }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// road strips (asphalt + markings in the fragment shader) + bridge structure + metro viaduct
const ROAD_VPARS = 'attribute vec4 aRd; attribute vec4 aRd2; varying vec4 vRd; varying vec4 vRd2;';
const ROAD_FPARS = /* glsl */`varying vec4 vRd; varying vec4 vRd2;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float lineM(float d, float hw) { float fw = max(fwidth(d), 1e-4); return smoothstep(hw + fw, hw - fw, abs(d)) * clamp(2.0 * hw / fw, 0.0, 1.0); }`;
const ROAD_FMAIN = /* glsl */`
float rRough = 0.88;
{
  float s = vRd.x, lat = vRd.y, w = vRd.z, lanes = vRd.w, len = vRd2.x, j0 = vRd2.y, j1 = vRd2.z, cls = vRd2.w;
  float oneway = cls >= 10.0 ? 1.0 : 0.0; float c = mod(cls, 10.0);
  vec3 asp = vec3(0.155, 0.148, 0.14) * (0.94 + 0.08 * h12(floor(vec2(s, lat) * 4.0)));
  asp *= 0.94 + 0.1 * h12(floor(vec2(s * 0.04, lat * 0.25))) - 0.06 * smoothstep(0.3, 0.0, abs(fract(lat / max(w / lanes, 1.0)) - 0.5));
  float jw = w * 0.5 + 2.0;
  float inJ = (j0 > 0.5 && s < jw) || (j1 > 0.5 && s > len - jw) ? 1.0 : 0.0;
  float m = 0.0; vec3 mc = vec3(0.86, 0.85, 0.80);
  if (inJ < 0.5) {
    float lw = w / lanes;
    for (int k = 1; k < 8; k++) { if (float(k) >= lanes) break;
      float d = lat + w * 0.5 - float(k) * lw;
      bool centre = oneway < 0.5 && abs(float(k) - lanes * 0.5) < 0.1;
      float dash = centre ? 1.0 : step(fract(s / 12.0), 0.25);
      m = max(m, lineM(d, centre ? 0.11 : 0.075) * dash);
      if (centre) m = max(m, lineM(d + 0.3, 0.075)); }
    if (c <= 3.0) m = max(m, lineM(abs(lat) - (w * 0.5 - 0.4), 0.09));
  }
  // zebra crossings just outside junctions
  float zj = (j0 > 0.5 && s > jw && s < jw + 4.0) || (j1 > 0.5 && s < len - jw && s > len - jw - 4.0) ? 1.0 : 0.0;
  if (zj > 0.5 && c >= 3.0) m = max(m, step(fract(lat / 1.1), 0.5) * clamp(1.0 - fwidth(lat) * 1.5, 0.0, 1.0));
  diffuseColor.rgb = mix(asp, mc, m * 0.9); rRough = mix(0.86, 0.55, m);
}`;
const CONC_FPARS = 'varying vec4 vRd; varying vec4 vRd2;';
export function makeRoads(D, roads) {
  const strip = { p: [], n: [], a: [], a2: [], i: [], v: 0 }, CLS = { motorway: 1, trunk: 2, primary: 3, secondary: 4, tertiary: 5 };
  const S = new GB();   // concrete: bridge fascia, barriers, underside, piers, metro viaduct
  const CC = [0.62, 0.60, 0.56], AB = [0, 0, 0, 0];
  for (const r of roads) {
    const w = r.width, hw = w / 2, p = r.p, n = p.length, cls = (CLS[r.cls.replace('_link', '')] || 6) + (r.oneway ? 10 : 0);
    const yOff = r.bridge ? 0 : 0.14 + (CLS[r.cls] ? 0.02 : 0);
    const L = [], Rr = [], Y = [];
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx, y = r.hAt(r.s[i]) + yOff;
      L.push([p[i][0] - nx * hw, p[i][1] - nz * hw]); Rr.push([p[i][0] + nx * hw, p[i][1] + nz * hw]); Y.push(y);
      for (const [q, lat] of [[L[i], -hw], [Rr[i], hw]]) { strip.p.push(q[0], y, q[1]); strip.n.push(0, 1, 0); strip.a.push(r.s[i], lat, w, r.lanes); strip.a2.push(r.len, r.j0, r.j1, cls); strip.v++; }
      if (i) { const k = strip.v - 4; strip.i.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    }
    if (r.H > 0) {   // deck structure
      for (let i = 1; i < n; i++) {
        if (Y[i] < 1.2 && Y[i - 1] < 1.2) continue;
        for (const [E, sg] of [[L, -1], [Rr, 1]]) {
          const a = E[i - 1], b = E[i], nx = sg * -(b[1] - a[1]), nz = sg * (b[0] - a[0]), l = Math.hypot(nx, nz) || 1;
          S.quad([[a[0], Y[i - 1] - 1.5, a[1]], [b[0], Y[i] - 1.5, b[1]], [b[0], Y[i] + 1.0, b[1]], [a[0], Y[i - 1] + 1.0, a[1]]], [nx / l, 0, nz / l], CC, AB, [[0, 0], [1, 0], [1, 1], [0, 1]]);
          S.quad([[a[0], Y[i - 1] + 1.0, a[1]], [b[0], Y[i] + 1.0, b[1]], [b[0] - nx / l * 0.4, Y[i] + 1.0, b[1] - nz / l * 0.4], [a[0] - nx / l * 0.4, Y[i - 1] + 1.0, a[1] - nz / l * 0.4]], [0, 1, 0], CC, AB, [[0, 0], [1, 0], [1, 1], [0, 1]]);
          S.quad([[a[0] - nx / l * 0.4, Y[i - 1], a[1] - nz / l * 0.4], [b[0] - nx / l * 0.4, Y[i], b[1] - nz / l * 0.4], [b[0] - nx / l * 0.4, Y[i] + 1.0, b[1] - nz / l * 0.4], [a[0] - nx / l * 0.4, Y[i - 1] + 1.0, a[1] - nz / l * 0.4]], [-nx / l, 0, -nz / l], CC, AB, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
        S.quad([[L[i - 1][0], Y[i - 1] - 1.5, L[i - 1][1]], [L[i][0], Y[i] - 1.5, L[i][1]], [Rr[i][0], Y[i] - 1.5, Rr[i][1]], [Rr[i - 1][0], Y[i - 1] - 1.5, Rr[i - 1][1]]], [0, -1, 0], CC.map((v) => v * 0.8), AB, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      for (let s = 20; s < r.len - 10; s += 34) { const h = r.hAt(s); if (h < 4) continue; const q = posAt(r, s, {});
        S.box(q.x, -2, q.z, 2.2, h - 1.5 + 2, 2.2, Math.atan2(q.dz, q.dx), CC, AB);
        S.box(q.x, h - 2.6, q.z, 1.6, 1.1, Math.min(w * 0.8, 14), Math.atan2(q.dz, q.dx), CC, AB); }
    }
  }
  // Dubai Metro: elevated viaduct (deck + parapets + piers + rails) along every elevated rail line
  const lines = [];
  for (const rl of D.rail || []) {
    if (!rl.pts || rl.pts.length < 2) continue; const kind = String(rl.kind || 'rail');
    if (rl.tunnel || (!rl.bridge && /subway/.test(kind))) continue;
    for (const pts of clipClear(rl.pts, BURJ_CLEAR)) {
      const p = resample(pts, 12), s = cumLen(p), H = rl.bridge ? 12 : 0.2; if (s[s.length - 1] < 60) continue;
      const ln = { p, s, len: s[s.length - 1], H, hAt: () => H, kind }; lines.push(ln);
      if (!rl.bridge) continue;
      const VC = [0.74, 0.72, 0.68];
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; const nx = -dz, nz = dx;
        for (const sg of [-1, 1]) { const o = 4.6 * sg;
          S.quad([[a[0] + nx * o, H - 1.8, a[1] + nz * o], [b[0] + nx * o, H - 1.8, b[1] + nz * o], [b[0] + nx * o * 0.9, H + 1.2, b[1] + nz * o * 0.9], [a[0] + nx * o * 0.9, H + 1.2, a[1] + nz * o * 0.9]], [nx * sg, 0, nz * sg], VC, AB, [[0, 0], [1, 0], [1, 1], [0, 1]]);
          S.quad([[a[0] + nx * o * 0.9, H + 1.2, a[1] + nz * o * 0.9], [b[0] + nx * o * 0.9, H + 1.2, b[1] + nz * o * 0.9], [b[0] + nx * o * 0.82, H, b[1] + nz * o * 0.82], [a[0] + nx * o * 0.82, H, a[1] + nz * o * 0.82]], [-nx * sg, 0.3, -nz * sg], VC, AB, [[0, 0], [1, 0], [1, 1], [0, 1]]);
          for (const rr of [0.9, 2.3]) { const q = rr * sg;   // rails
            S.quad([[a[0] + nx * (q - 0.08), H + 0.18, a[1] + nz * (q - 0.08)], [b[0] + nx * (q - 0.08), H + 0.18, b[1] + nz * (q - 0.08)], [b[0] + nx * (q + 0.08), H + 0.18, b[1] + nz * (q + 0.08)], [a[0] + nx * (q + 0.08), H + 0.18, a[1] + nz * (q + 0.08)]], [0, 1, 0], [0.3, 0.29, 0.28], AB, [[0, 0], [1, 0], [1, 1], [0, 1]]); }
        }
        S.quad([[a[0] - nx * 4.2, H, a[1] - nz * 4.2], [b[0] - nx * 4.2, H, b[1] - nz * 4.2], [b[0] + nx * 4.2, H, b[1] + nz * 4.2], [a[0] + nx * 4.2, H, a[1] + nz * 4.2]], [0, 1, 0], [0.42, 0.40, 0.38], AB, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        S.quad([[a[0] - nx * 4.6, H - 1.8, a[1] - nz * 4.6], [b[0] - nx * 4.6, H - 1.8, b[1] - nz * 4.6], [b[0] + nx * 4.6, H - 1.8, b[1] + nz * 4.6], [a[0] + nx * 4.6, H - 1.8, a[1] + nz * 4.6]], [0, -1, 0], VC.map((v) => v * 0.8), AB, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      for (let d = 15; d < ln.len - 5; d += 32) { const q = posAt(ln, d, {}), rot = Math.atan2(q.dz, q.dx);
        S.box(q.x, -2, q.z, 2.0, H - 3.0 + 2, 2.6, rot, VC, AB); S.box(q.x, H - 3.4, q.z, 3.0, 1.7, 7.5, rot, VC, AB); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(strip.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(strip.n, 3));
  g.setAttribute('aRd', new THREE.Float32BufferAttribute(strip.a, 4)); g.setAttribute('aRd2', new THREE.Float32BufferAttribute(strip.a2, 4));
  g.setIndex(strip.v > 65535 ? new THREE.Uint32BufferAttribute(strip.i, 1) : new THREE.Uint16BufferAttribute(strip.i, 1));
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, envMapIntensity: 0.2 });
  hookFlat(m, 'bq-road', { vpars: ROAD_VPARS, vmain: 'vRd = aRd; vRd2 = aRd2;', fpars: ROAD_FPARS, fmain: ROAD_FMAIN, frough: 'roughnessFactor = rRough;' });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.castShadow = false;
  const sg = S.geometry(); sg.deleteAttribute('aB'); sg.deleteAttribute('aFac');
  const sm_ = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 });
  hookFlat(sm_, 'bq-struct');
  const sd = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); hookFlat(sd, 'bq-struct-d');
  const smesh = new THREE.Mesh(sg, sm_); smesh.castShadow = true; smesh.receiveShadow = true; smesh.frustumCulled = false; smesh.customDepthMaterial = sd;
  const group = new THREE.Group(); group.add(mesh, smesh);
  // shadow casting by bridge decks: the road strip of elevated roads must cast too
  const bridges = roads.filter((r) => r.H > 0);
  console.log('roads:', roads.length, 'bridges', bridges.length, 'rail lines', lines.length, 'road verts', strip.v, 'struct verts', S.v);
  return { group, lines, update: () => {} };
}

// ---------------------------------------------------------------------------------------------------------------------
// trains on the metro lines (CPU positions; 3-car sets)
export function makeTrains(lines) {
  const L = lines.filter((l) => l.H > 5); const T = [];
  L.forEach((l, li) => { const n = Math.max(1, Math.round(l.len / 1400)); for (let k = 0; k < n; k++) for (const dir of [1, -1]) T.push({ l, s0: (k + (dir > 0 ? 0 : 0.5)) / n * l.len, dir, v: 18 + li * 2 }); });
  const car = new THREE.BoxGeometry(17, 3.3, 2.9); car.translate(0, 1.9, 0);
  const m = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.3, metalness: 0.5 });
  const im = new THREE.InstancedMesh(car, m, Math.max(1, T.length * 3)); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
  for (let i = 0; i < T.length * 3; i++) im.setColorAt(i, new THREE.Color(i % 3 === 0 ? '#c8202a' : '#eef0f2'));
  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), G = {}, q = {};
  function update(t, sc = null) {
    const ground = fnOf(sc, 'ground'), amp = fnOf(sc, 'amp'), A = amp(t);
    T.forEach((tr, i) => {
      const tt = t < 6 ? t : 6 + 2 * (1 - Math.exp(-(t - 6) / 2)) * (A > 0.3 ? 1 : (t - 6) / 2 + 1);
      for (let c = 0; c < 3; c++) {
        let s = tr.s0 + tr.dir * tr.v * tt - tr.dir * c * 17.6; s = ((s % tr.l.len) + tr.l.len) % tr.l.len;
        posAt(tr.l, s, q); ground(q.x, q.z, t, G);
        const off = 2.3 * tr.dir;
        E.set(-G.gz, Math.atan2(-q.dz, q.dx), G.gx + A * 0.004 * Math.sin(t * 9 + i)); Qn.setFromEuler(E);
        P.set(q.x - q.dz * off + G.hx * 0.6, tr.l.H + 0.2 + G.y, q.z + q.dx * off + G.hz * 0.6); M.compose(P, Qn, S); im.setMatrixAt(i * 3 + c, M);
      }
    });
    im.instanceMatrix.needsUpdate = true;
  }
  return { mesh: im, update };
}

// ---------------------------------------------------------------------------------------------------------------------
// trees (palms + broadleaf) and lamps — instanced, displaced on the GPU
function palmGeos() {
  const trunk = new THREE.CylinderGeometry(0.2, 0.36, 1, 7, 8, true); trunk.translate(0, 0.5, 0);
  { const p = trunk.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + y * y * 0.5); const r = 1 + 0.06 * Math.sin(y * 60); p.setZ(i, p.getZ(i) * r); } trunk.computeVertexNormals(); }
  const fr = [];
  for (let k = 0; k < 13; k++) {
    const g = new THREE.PlaneGeometry(1, 0.9, 6, 2); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) + 0.5, v = p.getY(i); const w = Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.8 + 0.1; p.setXYZ(i, u * 4.6, -u * u * 2.3 + 0.35 + Math.abs(v) * 0.35, v * w * 1.2); }
    g.rotateZ(0.32 - (k % 3) * 0.12); g.rotateY(k / 13 * Math.PI * 2 + (k % 2) * 0.24); g.translate(0.5, 0, 0); fr.push(g);
  }
  const crown = mergeGeos(fr); crown.computeVertexNormals();
  return { trunk, crown };
}
function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), idx = []; let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + o); o += g.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
export function makeTrees(D, roads, water, opts, skip) {
  const R = rng(99), palms = [], broad = [], lamps = [];
  const free = (x, z) => Math.hypot(x, z) > 82 && !water.inWater(x, z, 2) && !(skip && skip(x, z));
  for (const [x, z] of D.trees || []) { if (!free(x, z)) continue; (hashStr(x.toFixed(1) + z) < 0.68 ? palms : broad).push({ x, z, s: R() }); }
  // lake promenade palms + the Burj plinth ring
  for (const w of water.polys) { const p = resample(w.poly.concat([w.poly[0]]), 16), sg = Math.sign(area(w.poly));
    for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = sg * dz / l, nz = -sg * dx / l;
      const x = a[0] + nx * 11, z = a[1] + nz * 11; if (Math.hypot(x, z) > 82 && !water.inWater(x, z, 1)) palms.push({ x, z, s: R() }); } }
  for (let i = 0; i < 44; i++) { const a = i / 44 * Math.PI * 2; palms.push({ x: Math.cos(a) * 92, z: Math.sin(a) * 92, s: R() }); }
  // median palms + lamps on the boulevards (one row per carriageway, de-duplicated on a 22 m grid)
  const lampSeen = new Set();
  for (const r of roads) {
    if (r.bridge || !/primary|secondary|tertiary/.test(r.cls)) continue;
    for (let s = 12; s < r.len - 12; s += 42) { const q = posAt(r, s, {}), o = r.width / 2 + 1.6;
      for (const sg of r.oneway ? [1] : [-1, 1]) { const x = q.x - q.dz * o * sg, z = q.z + q.dx * o * sg, k = Math.round(x / 22) + ',' + Math.round(z / 22); if (lampSeen.has(k)) continue; lampSeen.add(k); if (free(x, z)) lamps.push({ x, z, yaw: Math.atan2(q.dz * sg, -q.dx * sg) + Math.PI / 2 * 0, nx: q.dz * sg, nz: -q.dx * sg }); }
      if (!r.oneway && r.lanes >= 4 && (s / 30 | 0) % 1 === 0 && free(q.x, q.z)) palms.push({ x: q.x, z: q.z, s: R(), med: true }); }
  }
  const lim = opts.quality === 'realtime' ? 6000 : 12000;
  if (palms.length > lim) palms.length = lim; if (broad.length > lim / 2) broad.length = lim / 2;
  const { trunk, crown } = palmGeos();
  const mT = hookInst(new THREE.MeshStandardMaterial({ color: '#7c6550', roughness: 0.95 }), 'bq-palmT', 0.6);
  const mC = hookInst(new THREE.MeshStandardMaterial({ color: '#4f6d2e', roughness: 0.75, side: THREE.DoubleSide }), 'bq-palmC', 0.6);
  const bT = new THREE.CylinderGeometry(0.16, 0.26, 1, 6, 1, true); bT.translate(0, 0.5, 0);
  const bC = new THREE.IcosahedronGeometry(1, 1); { const p = bC.attributes.position; for (let i = 0; i < p.count; i++) { const n = 0.85 + 0.3 * hashStr(i % 42); p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.8, p.getZ(i) * n); } bC.computeVertexNormals(); }
  const mB = hookInst(new THREE.MeshStandardMaterial({ color: '#5b7434', roughness: 0.85, flatShading: true }), 'bq-broad', 0.4);
  const pole = new THREE.CylinderGeometry(0.08, 0.13, 10, 6); pole.translate(0, 5, 0);
  const arm = new THREE.BoxGeometry(2.0, 0.12, 0.12); arm.translate(1.0, 10, 0);
  const head = new THREE.BoxGeometry(0.8, 0.18, 0.36); head.translate(1.9, 9.9, 0);
  const lampG = mergeGeos([pole, arm, head]); lampG.computeVertexNormals();
  const mL = hookInst(new THREE.MeshStandardMaterial({ color: '#9a9ea4', roughness: 0.45, metalness: 0.6 }), 'bq-lamp', 0.25);
  const mk = (geo, mat, n) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = n;
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); hookInst(d, mat.customProgramCacheKey() + '-d', 0.6); im.customDepthMaterial = d; return im; };
  const iT = mk(trunk, mT, palms.length), iC = mk(crown, mC, palms.length), iBT = mk(bT, mT, broad.length), iBC = mk(bC, mB, broad.length), iL = mk(lampG, mL, lamps.length);
  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), V = new THREE.Vector3(), C = new THREE.Color();
  palms.forEach((p, i) => {
    const h = (p.med ? 7 : 8.5) + p.s * 5, yaw = p.s * 6.28, lean = (hashStr(i + 'l') - 0.5) * 0.12;
    E.set(lean, yaw, (hashStr(i + 'k') - 0.5) * 0.1); Qn.setFromEuler(E); M.compose(P.set(p.x, 0, p.z), Qn, S.set(1, h, 1)); iT.setMatrixAt(i, M);
    V.set(0.5, h - 0.3, 0).applyQuaternion(Qn); E.set(lean * 0.5, yaw + p.s, 0); Qn.setFromEuler(E);
    M.compose(P.set(p.x + V.x, V.y, p.z + V.z), Qn, S.setScalar(0.85 + p.s * 0.35)); iC.setMatrixAt(i, M);
    iC.setColorAt(i, C.set('#ffffff').multiplyScalar(0.8 + p.s * 0.35));
  });
  broad.forEach((p, i) => {
    const h = 3 + p.s * 2.5, r = 2.6 + p.s * 2.2;
    M.compose(P.set(p.x, 0, p.z), Qn.identity(), S.set(1, h + r * 0.5, 1)); iBT.setMatrixAt(i, M);
    M.compose(P.set(p.x, h + r * 0.55, p.z), Qn.setFromEuler(E.set(0, p.s * 6, 0)), S.set(r, r, r)); iBC.setMatrixAt(i, M);
    iBC.setColorAt(i, C.set('#ffffff').multiplyScalar(0.75 + p.s * 0.4));
  });
  lamps.forEach((l, i) => { M.compose(P.set(l.x, 0, l.z), Qn.setFromEuler(E.set(0, Math.atan2(-l.nz, l.nx) + Math.PI, 0)), S.set(1, 1, 1)); iL.setMatrixAt(i, M); });
  const group = new THREE.Group(); group.add(iT, iC, iBT, iBC, iL);
  console.log('trees: palms', palms.length, 'broadleaf', broad.length, 'lamps', lamps.length);
  return { group, update: () => {} };
}

// ---------------------------------------------------------------------------------------------------------------------
// cars on the road graph (CPU: ~1 ground() call per car per frame)
export function makeRealCars(roads, opts) {
  const R = rng(77), CK = opts.quality === 'realtime' ? 0.5 : 1;
  const COLS = ['#f2f2f0', '#111214', '#8a8d92', '#c9ccd0', '#2a3550', '#6b0f14', '#e8e2d0', '#1d1f22', '#4a4e54', '#f4f4f2', '#ffffff', '#b8bcc2'];
  const drive = roads.filter((r) => DRIVE.test(r.cls) && r.cls !== 'service' && r.len > 40);
  const wsum = drive.reduce((a, r) => a + r.len * r.lanes * (/motorway|trunk/.test(r.cls) ? 1.6 : 1), 0);
  const L = [], n = Math.round(2400 * CK);
  for (let i = 0; i < n && drive.length; i++) {
    let u = R() * wsum, r = drive[0]; for (const q of drive) { u -= q.len * q.lanes * (/motorway|trunk/.test(q.cls) ? 1.6 : 1); if (u <= 0) { r = q; break; } }
    const lw = r.width / r.lanes, lane = Math.floor(R() * r.lanes);
    let dir = 1, off;
    if (r.oneway) off = -r.width / 2 + lw * (lane + 0.5);
    else { const half = Math.max(1, Math.floor(r.lanes / 2)), k = lane % half; dir = lane < half ? 1 : -1; off = (lw * (k + 0.5)) * dir; }
    const fast = /motorway|trunk/.test(r.cls);
    L.push({ r, off, dir, s0: R() * r.len, v: (fast ? 20 : 10) + R() * (fast ? 8 : 5), col: COLS[R() * COLS.length | 0], seed: R(), bus: !fast && R() < 0.03 });
  }
  const body = new THREE.BoxGeometry(4.5, 0.95, 1.85); body.translate(0, 0.72, 0);
  const cab = new THREE.BoxGeometry(2.4, 0.62, 1.62); cab.translate(-0.2, 1.48, 0);
  const mB = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.5 });
  const mC = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.08, metalness: 0.9 });
  const ib = new THREE.InstancedMesh(body, mB, Math.max(1, L.length)), ic = new THREE.InstancedMesh(cab, mC, Math.max(1, L.length));
  ib.castShadow = ic.castShadow = true; ib.receiveShadow = true; ib.frustumCulled = ic.frustumCulled = false;
  L.forEach((c, i) => ib.setColorAt(i, new THREE.Color(c.col)));
  const group = new THREE.Group(); group.add(ib, ic);
  const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), G = {}, q = {};
  // braking time per scenario: first moment the ground amplitude exceeds 0.3 drawn m
  const tsCache = new WeakMap();
  const tStop = (sc) => { const k = sc || Q.FILM; if (tsCache.has(k)) return tsCache.get(k); const amp = fnOf(sc, 'amp'); let ts = Infinity; for (let t = 0; t < 40; t += 0.1) if (amp(t) > 0.3) { ts = t; break; } tsCache.set(k, ts); return ts; };
  function update(t, sc = null) {
    const amp = fnOf(sc, 'amp'), ground = fnOf(sc, 'ground'), A = amp(t), T0 = tStop(sc);
    for (let i = 0; i < L.length; i++) {
      const c = L[i], r = c.r, ts = T0 + c.seed * 1.4, tt = t < ts ? t : ts + 0.9 * (1 - Math.exp(-(t - ts) / 0.9));
      let s = c.s0 + c.dir * c.v * tt; s = ((s % r.len) + r.len) % r.len;
      posAt(r, s, q); const x = q.x - q.dz * c.off, z = q.z + q.dx * c.off;
      ground(x, z, t, G);
      const j = A * 0.03 * Math.sin(t * 19 + c.seed * 40), bounce = Math.max(0, A * 0.05 * Math.sin(t * 13 + c.seed * 30));
      const yaw = Math.atan2(-q.dz, q.dx) + (c.dir < 0 ? Math.PI : 0);
      E.set(-G.gz + j, yaw + j * 2, G.gx - j, 'YXZ'); Qn.setFromEuler(E);
      P.set(x + G.hx * 0.8, G.y + bounce + r.hAt(s) + 0.16, z + G.hz * 0.8); S.set(c.bus ? 2.6 : 1, c.bus ? 2.2 : 1, c.bus ? 1.35 : 1);
      M.compose(P, Qn, S); ib.setMatrixAt(i, M); ic.setMatrixAt(i, M);
    }
    ib.instanceMatrix.needsUpdate = true; ic.instanceMatrix.needsUpdate = true;
  }
  console.log('cars:', L.length, 'on', drive.length, 'roads');
  return { group, update };
}

// ---------------------------------------------------------------------------------------------------------------------
// water polygons (lake, canals): containment with a pad, shapes for the reflective lake mesh
export function makeWater(D) {
  const polys = (D.water || []).filter((w) => !/^(pool|fountain)$/.test(w.kind || '') && w.poly && w.poly.length > 2 && Math.abs(area(w.poly)) > 300).map((w) => ({ poly: w.poly, holes: w.holes || [], kind: w.kind || 'water', name: w.name || null }));
  const bb = polys.map((w) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of w.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; });
  function inWater(x, z, pad = 0) {
    for (let i = 0; i < polys.length; i++) {
      const b = bb[i], m = Math.max(0, pad); if (x < b[0] - m || x > b[2] + m || z < b[1] - m || z > b[3] + m) continue;
      const w = polys[i]; let inside = inPoly(x, z, w.poly) && !w.holes.some((h) => inPoly(x, z, h));
      if (pad === 0) { if (inside) return true; continue; }
      let d = 1e9; for (const ring of [w.poly, ...w.holes]) for (let k = 0; k < ring.length; k++) d = Math.min(d, distSeg(x, z, ring[k], ring[(k + 1) % ring.length]));
      if (pad > 0 ? inside || d < pad : inside && d > -pad) return true;
    }
    return false;
  }
  const shapes = polys.map((w) => { const sh = new THREE.Shape(w.poly.map(([x, z]) => new THREE.Vector2(x, -z))); for (const h of w.holes) sh.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z)))); return sh; });
  // tessellated water surface (10 m cells overlapping the shore by a few metres, hidden under the shore terrain) so
  // the vertex shader can make it heave with the ground like everything else
  function geometry(maxLen = 14) {
    const src = new THREE.ShapeGeometry(shapes, 1).toNonIndexed(), A = src.attributes.position.array, out = [];
    const split = (a, b, c, d) => {
      const l0 = Math.hypot(a[0] - b[0], a[1] - b[1]), l1 = Math.hypot(b[0] - c[0], b[1] - c[1]), l2 = Math.hypot(c[0] - a[0], c[1] - a[1]), m = Math.max(l0, l1, l2);
      if (m <= maxLen || d > 14) { out.push(a[0], 0.06, -a[1], b[0], 0.06, -b[1], c[0], 0.06, -c[1]); return; }
      if (m === l0) { const q = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; split(a, q, c, d + 1); split(q, b, c, d + 1); }
      else if (m === l1) { const q = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]; split(a, b, q, d + 1); split(a, q, c, d + 1); }
      else { const q = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]; split(a, b, q, d + 1); split(q, b, c, d + 1); }
    };
    for (let i = 0; i < A.length; i += 9) split([A[i], A[i + 1]], [A[i + 3], A[i + 4]], [A[i + 6], A[i + 7]], 0);
    // (x, y) → (x, -y) on the xz plane is the same map as rotateX(-π/2): winding stays front-facing up
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); return g;
  }
  // biggest polygon → LAKE-like ellipse summary for camera code
  let big = -1, ba = 0; polys.forEach((w, i) => { const a = Math.abs(area(w.poly)) * (w.kind === 'lake' ? 100 : 1) * (/burj/i.test(w.name || '') ? 100 : 1); if (a > ba) { ba = a; big = i; } });
  let cx = 0, cz = 0; if (big >= 0) { for (const [x, z] of polys[big].poly) { cx += x; cz += z; } cx /= polys[big].poly.length; cz /= polys[big].poly.length; }
  const lake = big >= 0 ? { centroid: [cx, cz], bbox: bb[big], name: polys[big].name, cx: (bb[big][0] + bb[big][2]) / 2, cz: (bb[big][1] + bb[big][3]) / 2, rx: (bb[big][2] - bb[big][0]) / 2, rz: (bb[big][3] - bb[big][1]) / 2 } : null;
  return { polys, inWater, shapes, lake, geometry };
}
