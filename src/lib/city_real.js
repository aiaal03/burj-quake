// Real Downtown Dubai (OpenStreetMap footprints, data/city.json) — buildings as merged, tiled geometry whose per-building
// earthquake state (sway shear, tilt, ground offset, crush) lives in a float DataTexture read by the vertex shader.
// One texture upload per frame drives shaking, failure and collapse of every building (and its shadow).
// Coordinates: metres, origin at the Burj base, x = east, z = south, y = up.
import * as THREE from 'three';
import * as Q from './quake.js';
import { clamp, sm } from './quake.js';

const fnOf = (sc, n) => (sc && typeof sc[n] === 'function' ? sc[n].bind(sc) : Q[n]);
export const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
export const hashStr = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
export const BURJ_CLEAR = 110;   // plinth radius kept free of city buildings

// ---------------------------------------------------------------------------------------------------------------------
// material hook (app/render/shadows.js chains CSM's onBeforeCompile after this one and keeps our cache key)
export function hookMat(m, fn, key) {
  m.onBeforeCompile = fn;
  m.customProgramCacheKey = () => key;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// GLSL port of quake.js groundA(x, z, t, A): uniforms uGT (t) and uGA (A = sc.amp(t)) are shared by every material.
export const GU = { uGT: { value: 0 }, uGA: { value: 0 } };
export function setGroundUniforms(t, sc) { GU.uGT.value = t; GU.uGA.value = fnOf(sc, 'amp')(t); }
export const GROUND_GLSL = /* glsl */`
uniform float uGT, uGA;
void gWave(vec2 p, float lam, float c, float a, float ph, vec2 d, inout vec3 acc, inout float h) {
  float k = 6.2831853 / lam; float s = dot(p, d); float q = k * s - k * c * uGT + ph;
  float sn = sin(q), cs = cos(q); acc.x += a * sn; float g = a * k * cs; acc.y += g * d.x; acc.z += g * d.y; h += a * cs; }
// returns (y, dy/dx, dy/dz); hor = horizontal shake (hx, hz)
vec3 groundF(vec2 p, out vec2 hor) {
  hor = vec2(0.0); if (uGA == 0.0) return vec3(0.0);
  vec2 D1 = normalize(vec2(0.94, 0.34)), D2 = normalize(vec2(0.55, -0.83));
  float m = 0.75 + 0.25 * sin(p.x * 0.0041 + p.y * 0.0063 + 1.3);
  vec3 acc = vec3(0.0); float h = 0.0;
  gWave(p, 320.0, 300.0, 1.0, 0.3, D1, acc, h); gWave(p, 170.0, 270.0, 0.55, 1.7, D1, acc, h);
  gWave(p, 90.0, 240.0, 0.28, 4.1, D2, acc, h); gWave(p, 560.0, 360.0, 0.5, 2.2, D2, acc, h);
  float am = uGA * m;
  float j = sin(uGT * 23.0 + p.x * 0.05) * 0.15 + sin(uGT * 31.0 + p.y * 0.04) * 0.1;
  hor = am * vec2(h * 0.5 * D1.x + j, h * 0.5 * D1.y - j * 0.6);
  return am * acc; }
`;
// flat world-space geometry (roads, bridges, terrain …): every vertex rides the ground surface
export function hookFlat(m, key, extra = {}) {
  return hookMat(m, (sh) => {
    sh.uniforms.uGT = GU.uGT; sh.uniforms.uGA = GU.uGA;
    Object.assign(sh.uniforms, extra.uniforms || {});
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GROUND_GLSL + (extra.vpars || ''))
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{ vec2 gh_; vec3 gg_ = groundF(position.xz, gh_); if (abs(objectNormal.y) > 0.9) objectNormal = normalize(vec3(-gg_.y, 1.0, -gg_.z) * sign(objectNormal.y)); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{ vec2 gh_; vec3 gg_ = groundF(position.xz, gh_); transformed.y += gg_.x; ${extra.vmain || ''} }`);
    if (extra.fpars) sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + extra.fpars);
    if (extra.fmain) sh.fragmentShader = sh.fragmentShader.replace(extra.fat || '#include <color_fragment>', (extra.fat || '#include <color_fragment>') + '\n' + extra.fmain);
    if (extra.frough) sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + extra.frough);
  }, key);
}
// instanced props (trees, lamps): instance origin rides the ground; height-proportional sway with shaking
export function hookInst(m, key, swayK = 1) {
  return hookMat(m, (sh) => {
    sh.uniforms.uGT = GU.uGT; sh.uniforms.uGA = GU.uGA;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GROUND_GLSL)
      .replace('#include <project_vertex>', `vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
#endif
{ vec2 ip = instanceMatrix[3].xz; vec2 gh; vec3 g = groundF(ip, gh);
  float hy = max(mvPosition.y - instanceMatrix[3].y, 0.0);
  float sd = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);
  float A = min(uGA, 3.0);
  vec2 sw = vec2(0.012 * sin(uGT * 1.3 + sd * 9.0) + A * 0.03 * sin(uGT * 4.1 + sd * 20.0) + A * 0.02 * sin(uGT * 6.7 + sd * 7.0),
                 0.008 * sin(uGT * 1.1 + sd * 5.0) + A * 0.025 * sin(uGT * 5.3 + sd * 11.0));
  mvPosition.xz += sw * hy * hy * ${(0.08 * swayK).toFixed(3)} - g.yz * hy + gh * 0.8; mvPosition.y += g.x; }
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`);
  }, key);
}

// ---------------------------------------------------------------------------------------------------------------------
// data
export async function loadCityData() {
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (!(qs && qs.get('city') === 'mock')) {
    try {
      const r = await fetch(new URL('../../data/city.json', import.meta.url));
      if (r.ok) { const D = await r.json(); if (D && D.buildings && D.buildings.length) { D.meta = { ...(D.meta || {}), source: D.meta?.source || 'osm' }; return D; } }
    } catch (e) { /* fall through to the mock */ }
  }
  return mockCity();
}

// Small stand-in with the same schema (until the data engineer's OSM export lands).
export function mockCity() {
  const R = rng(4242), D = { buildings: [], roads: [], rail: [], water: [], green: [], trees: [], plazas: [], landmarks: [], meta: { source: 'mock' } };
  const c45 = Math.SQRT1_2, toW = (u, v) => [(u - v) * c45, (u + v) * c45];   // grid frame (u along SZR NE→SW axis)
  // Sheikh Zayed Road: SW → NE, ~640 m NW of the Burj; metro viaduct along its SE side
  const szr = (k) => { const pts = []; for (let i = 0; i <= 50; i++) { const u = -2400 + i * 96; pts.push([u * c45 - 450 + k * c45, -u * c45 - 450 + k * c45]); } return pts; };
  D.roads.push({ cls: 'trunk', lanes: 6, width: 24, oneway: true, bridge: false, layer: 0, pts: szr(-14) }, { cls: 'trunk', lanes: 6, width: 24, oneway: true, bridge: false, layer: 0, pts: szr(14).reverse() });
  D.roads.push({ cls: 'primary', lanes: 3, width: 11, oneway: true, bridge: true, layer: 1, pts: [[-1000, 300], [-760, 60], [-520, -180], [-300, -420], [-120, -620]] });
  D.rail.push({ kind: 'subway', bridge: true, pts: szr(40) });
  // lake: irregular blob south of the tower
  const lk = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2, w = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 5 + 2); lk.push([-40 + Math.cos(a) * 300 * w, 330 + Math.sin(a) * 190 * w]); }
  D.water.push({ poly: lk });
  // grid of local streets (rotated 45°) and blocks
  const P = 170;
  for (let i = -9; i <= 9; i++) {
    const a = []; for (let k = -10; k <= 10; k++) a.push(toW(i * P + 30, k * P * 0.5 + 30)); D.roads.push({ cls: i % 3 ? 'residential' : 'secondary', lanes: i % 3 ? 2 : 4, width: i % 3 ? 8 : 15, oneway: false, bridge: false, layer: 0, pts: a });
    const b = []; for (let k = -10; k <= 10; k++) b.push(toW(k * P * 0.5 + 30, i * P + 30)); D.roads.push({ cls: i % 3 ? 'residential' : 'secondary', lanes: i % 3 ? 2 : 4, width: i % 3 ? 8 : 15, oneway: false, bridge: false, layer: 0, pts: b });
  }
  const inLk = (x, z, pad) => Math.hypot((x + 40) / (300 + pad), (z - 330) / (190 + pad)) < 1.2;
  let id = 1;
  for (let i = -9; i < 9; i++) for (let j = -9; j < 9; j++) {
    const u0 = i * P + 30, v0 = j * P + 30, [cx, cz] = toW(u0 + P / 2, v0 + P / 2), r = Math.hypot(cx, cz);
    if (r > 1700 || r < 220 || inLk(cx, cz, 80)) continue;
    const dSZR = Math.abs((cx + cz + 900) * c45);
    if (dSZR < 40) continue;
    if (R() < 0.12) { const g = [toW(u0 + 12, v0 + 12), toW(u0 + P - 12, v0 + 12), toW(u0 + P - 12, v0 + P - 12), toW(u0 + 12, v0 + P - 12)]; D.green.push({ kind: 'park', poly: g });
      for (let k = 0; k < 30; k++) D.trees.push(toW(u0 + 20 + R() * (P - 40), v0 + 20 + R() * (P - 40))); continue; }
    const n = R() < 0.5 ? 2 : 3, cw = (P - 30) / n;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (R() < 0.1) continue;
      const x0 = u0 + 15 + a * cw + 3, z0 = v0 + 15 + b * cw + 3, w = cw - 6 - R() * 10, d = cw - 6 - R() * 10;
      const tower = dSZR < 200 ? R() < 0.7 : r < 800 ? R() < 0.25 : R() < 0.06;
      const h = tower ? 120 + R() * R() * 260 : dSZR < 400 || r < 900 ? 20 + R() * 70 : 10 + R() * 25;
      let poly = [toW(x0, z0), toW(x0 + w, z0), toW(x0 + w, z0 + d), toW(x0, z0 + d)];
      if (tower && R() < 0.3) { poly = []; const [px, pz] = toW(x0 + w / 2, z0 + d / 2), rr = Math.min(w, d) / 2; for (let q = 0; q < 16; q++) poly.push([px + Math.cos(q / 16 * 6.283) * rr, pz + Math.sin(q / 16 * 6.283) * rr]); }
      D.buildings.push({ id: 'm' + id++, type: tower ? (R() < 0.6 ? 'office' : 'apartments') : (R() < 0.5 ? 'apartments' : 'commercial'), h, minH: 0, poly });
      if (tower && R() < 0.4) { const [px, pz] = toW(x0 + w / 2, z0 + d / 2), k = 0.6; D.buildings.push({ id: 'm' + id++, type: 'office', h: h + 30 + R() * 60, minH: h, poly: poly.map(([x, z]) => [px + (x - px) * k, pz + (z - pz) * k]) }); }
    }
    for (let k = 0; k < 6; k++) D.trees.push(toW(u0 + R() * P, v0 + 8));
  }
  // landmarks
  const mall = []; for (const [u, v] of [[-60, -140], [260, -140], [260, 120], [120, 220], [-60, 120]]) { const [x, z] = toW(u + 520, v + 300); mall.push([x, z]); }
  D.buildings.push({ id: 'dubai_mall', name: 'The Dubai Mall', type: 'retail', h: 32, minH: 0, poly: mall, landmark: true });
  const ad = []; for (let q = 0; q < 12; q++) ad.push([380 + Math.cos(q / 12 * 6.283) * 22, 120 + Math.sin(q / 12 * 6.283) * 18]);
  D.buildings.push({ id: 'address', name: 'Address Downtown', type: 'hotel', h: 306, minH: 0, poly: ad, landmark: true });
  for (const b of D.buildings) { const ar = area(b.poly); if (ar < 0) b.poly.reverse(); }
  D.plazas.push({ poly: lk.map(([x, z]) => [-40 + (x + 40) * 1.12, 330 + (z - 330) * 1.18]) });
  return D;
}

// ---------------------------------------------------------------------------------------------------------------------
// geometry helpers
export function area(p) { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % n]; a += x0 * z1 - x1 * z0; } return a / 2; }
export function inPoly(x, z, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
export function distSeg(x, z, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz; let u = l > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l : 0; u = u < 0 ? 0 : u > 1 ? 1 : u; return Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z); }
export function distPoly(x, z, p) { let d = 1e9; for (let i = 0; i < p.length; i++) d = Math.min(d, distSeg(x, z, p[i], p[(i + 1) % p.length])); return d; }
const clean = (p) => { const o = []; for (const q of p) { const l = o[o.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.05) o.push(q); } if (o.length > 2 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 0.05) o.pop(); return o; };
// inset a ring by d metres toward its interior (miter, clamped)
function inset(p, d) {
  const n = p.length, s = Math.sign(area(p)) || 1, out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
    let e1x = b[0] - a[0], e1z = b[1] - a[1], e2x = c[0] - b[0], e2z = c[1] - b[1];
    const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1; e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2;
    // inward normals (CCW: interior on the left of (dx,dz) → (-dz, dx))
    const n1x = -e1z * s, n1z = e1x * s, n2x = -e2z * s, n2z = e2x * s;
    let mx = n1x + n2x, mz = n1z + n2z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = Math.min(2.5, 1 / Math.max(0.4, mx * n1x + mz * n1z));
    out.push([b[0] + mx * d * k, b[1] + mz * d * k]);
  }
  return out;
}

// growable typed geometry builder
class GB {
  constructor() { this.p = []; this.n = []; this.c = []; this.b = []; this.f = []; this.i = []; this.v = 0; }
  vert(x, y, z, nx, ny, nz, col, b, fu, fv) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.b.push(b[0], b[1], b[2], b[3]); this.f.push(fu, fv); return this.v++; }
  tri(a, b, c) { this.i.push(a, b, c); }
  // quad p0..p3 (counter-clockwise seen from the normal side is enforced)
  quad(P, N, col, b, F) {
    const [p0, p1, p2] = P, ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, flip = cx * N[0] + cy * N[1] + cz * N[2] < 0;
    const i0 = this.v; for (let k = 0; k < 4; k++) this.vert(P[k][0], P[k][1], P[k][2], N[0], N[1], N[2], col, b, F[k][0], F[k][1]);
    if (flip) { this.tri(i0, i0 + 2, i0 + 1); this.tri(i0, i0 + 3, i0 + 2); } else { this.tri(i0, i0 + 1, i0 + 2); this.tri(i0, i0 + 2, i0 + 3); }
  }
  // horizontal polygon with holes at height y, facing up (dir 1) or down (-1)
  cap(outer, holes, y, dir, col, b) {
    const V = (r) => r.map(([x, z]) => new THREE.Vector2(x, z));
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(V(outer), (holes || []).map(V)); } catch (e) { return; }
    const all = outer.concat(...(holes || [])), i0 = this.v;
    for (const [x, z] of all) this.vert(x, y, z, 0, dir, 0, col, b, x, z);
    for (const [a, bb, c] of tris) {
      const A = all[a], B = all[bb], C = all[c], cy = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
      if ((cy > 0) === (dir > 0)) this.tri(i0 + a, i0 + bb, i0 + c); else this.tri(i0 + a, i0 + c, i0 + bb);
    }
  }
  box(cx, y0, cz, sx, sy, sz, rot, col, b) {   // axis box rotated by rot around y
    const c = Math.cos(rot), s = Math.sin(rot), P = (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
    const q = [P(-sx / 2, -sz / 2), P(sx / 2, -sz / 2), P(sx / 2, sz / 2), P(-sx / 2, sz / 2)];
    for (let k = 0; k < 4; k++) { const a = q[k], bb = q[(k + 1) % 4], nx = (bb[1] - a[1]), nz = -(bb[0] - a[0]), l = Math.hypot(nx, nz);
      this.quad([[a[0], y0, a[1]], [bb[0], y0, bb[1]], [bb[0], y0 + sy, bb[1]], [a[0], y0 + sy, a[1]]], [nx / l, 0, nz / l], col, b, [[0, y0], [1, y0], [1, y0 + sy], [0, y0 + sy]]); }
    this.quad([[q[0][0], y0 + sy, q[0][1]], [q[1][0], y0 + sy, q[1][1]], [q[2][0], y0 + sy, q[2][1]], [q[3][0], y0 + sy, q[3][1]]], [0, 1, 0], col, b, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  cyl(cx, y0, cz, r, hh, seg, col, b, top = true) {
    for (let k = 0; k < seg; k++) { const a0 = k / seg * 6.2832, a1 = (k + 1) / seg * 6.2832, am = (a0 + a1) / 2;
      this.quad([[cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx + Math.cos(a1) * r, y0 + hh, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y0 + hh, cz + Math.sin(a0) * r]],
        [Math.cos(am), 0, Math.sin(am)], col, b, [[k, y0], [k + 1, y0], [k + 1, y0 + hh], [k, y0 + hh]]); }
    if (top) { const ring = []; for (let k = 0; k < seg; k++) ring.push([cx + Math.cos(k / seg * 6.2832) * r, cz + Math.sin(k / seg * 6.2832) * r]); this.cap(ring, null, y0 + hh, 1, col, b); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Uint8BufferAttribute(Uint8Array.from(this.c, (v) => Math.max(0, Math.min(255, Math.round(v * 255)))), 3, true));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.b, 4));
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.f, 2));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    return g;
  }
}
export { GB };

// ---------------------------------------------------------------------------------------------------------------------
// building shader: GPU state (3 texels / building) + procedural facades
// state texel 0: (cx, cz, hTop, 0) · 1: (offX, offY, offZ, crush) · 2: (shearX, shearZ, tiltX, tiltZ)
// aB = (building index, facade kind, building height, hash) · aFac = (u along the perimeter m, v height m)
// kinds: 0 glass curtain wall · 1 concrete/stone punched windows · 2 roof · 3 parapet/coping · 4 mall stone ·
//        5 rooftop plant · 6 helipad · 7 parking deck · 8 crown glass
const STW = 1024;
const BLD_VPARS = /* glsl */`
uniform highp sampler2D uBState;
attribute vec4 aB; attribute vec2 aFac;
varying vec2 vFac; varying vec4 vBk; varying vec3 vNo0;
vec4 bst(int i) { return texelFetch(uBState, ivec2(i & ${STW - 1}, i >> ${Math.log2(STW)}), 0); }
mat3 bRot(vec4 s2) { float cx = cos(s2.z), sx = sin(s2.z), cz = cos(s2.w), sz = sin(s2.w);
  return mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx) * mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0); }
`;
const BLD_VNORM = /* glsl */`
vNo0 = objectNormal;
{ int bi_ = int(aB.x + 0.5); objectNormal = bRot(bst(bi_ * 3 + 2)) * objectNormal; }`;
const BLD_VPOS = /* glsl */`
vFac = aFac; vBk = aB;
{ int bi_ = int(aB.x + 0.5); vec4 s0 = bst(bi_ * 3), s1 = bst(bi_ * 3 + 1), s2 = bst(bi_ * 3 + 2);
  vec3 l = transformed - vec3(s0.x, 0.0, s0.y);
  l.x += s2.x * l.y; l.z += s2.y * l.y; l.y *= s1.w;
  transformed = bRot(s2) * l + vec3(s0.x + s1.x, s1.y, s0.y + s1.z); }`;
const BLD_FPARS = /* glsl */`
varying vec2 vFac; varying vec4 vBk; varying vec3 vNo0;
float h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float bandAA(float x, float a, float b, float fw) { return smoothstep(a - fw, a + fw, x) * (1.0 - smoothstep(b - fw, b + fw, x)); }
`;
// sun direction (world): matches world.js SUN
const BLD_FMAIN = /* glsl */`
float mMetal = 0.0, mRough = 0.85; vec3 mEmis = vec3(0.0);
{
  float kind = floor(vBk.y + 0.5), hb = vBk.w, H = vBk.z;
  vec3 base = diffuseColor.rgb; vec3 N0 = normalize(vNo0);
  float u = vFac.x, v = vFac.y;
  float shade = 1.0 - clamp(dot(N0, normalize(vec3(-0.905, 0.208, 0.372))) * 2.5, 0.0, 1.0);
  float flH = kind == 0.0 || kind == 8.0 ? 3.9 + hb * 0.4 : 3.5 + hb * 0.3;
  float fl = v / flH, ff = fract(fl), fi = floor(fl);
  if (kind == 2.0) {               // flat roof: gravel / membrane, faint panels
    float p = h13(vec3(floor(u * 0.25), floor(v * 0.25), hb * 77.0));
    diffuseColor.rgb = mix(vec3(0.30, 0.27, 0.23), vec3(0.42, 0.39, 0.34), hb) * (0.93 + 0.1 * p); mRough = 0.95;
  } else if (kind == 3.0) { diffuseColor.rgb = base * 1.08; mRough = 0.8;
  } else if (kind == 5.0) { diffuseColor.rgb = base; mRough = 0.6; mMetal = 0.35;
  } else if (kind == 6.0) {        // helipad: dark deck, white circle + H
    vec2 q = vFac; float r = length(q); float R = vBk.z;
    float ring = bandAA(r, R * 0.72, R * 0.78, 0.15);
    float Hm = (step(abs(q.x), R * 0.28) * step(abs(q.y), R * 0.06)) + (step(abs(abs(q.x) - R * 0.24), R * 0.05) * step(abs(q.y), R * 0.32));
    diffuseColor.rgb = mix(vec3(0.16, 0.17, 0.18), vec3(0.92), clamp(ring + Hm, 0.0, 1.0)); mRough = 0.7;
  } else {
    float cw = kind == 0.0 || kind == 8.0 ? 1.5 : kind == 4.0 ? 6.0 : 2.8 + hb * 0.8;
    float cs = u / cw, cf = fract(cs), ci = floor(cs);
    float fw = max(fwidth(fl), fwidth(cs)), aa = clamp(1.4 - fw * 2.2, 0.0, 1.0);
    float hc = h13(vec3(fi, ci, hb * 91.0)), hf = h13(vec3(fi, hb * 13.0, 3.0));
    bool lobby = v < 7.2 && H > 40.0 && kind != 4.0 && kind != 7.0;
    bool shop = !lobby && v < 4.6 && H <= 40.0 && H > 8.0 && kind == 1.0;
    if (lobby || shop) {
      float top = lobby ? 7.2 : 4.6, mul = 1.0 - bandAA(fract(u / (lobby ? 3.0 : 4.0)), 0.04, 0.96, fwidth(u) * 0.3);
      float canopy = bandAA(v, top - 0.7, top, fwidth(v));
      vec3 inside = vec3(0.10, 0.09, 0.08) + vec3(1.0, 0.75, 0.45) * 0.05 * h13(vec3(ci, 7.0, hb));
      diffuseColor.rgb = mix(mix(inside, vec3(0.20, 0.21, 0.22), mul * aa), base * 0.75, canopy);
      mMetal = 0.6 * (1.0 - canopy); mRough = mix(0.08, 0.5, max(mul, canopy));
      if (shop) mEmis = vec3(1.0, 0.72, 0.45) * 0.10 * (1.0 - canopy) * (1.0 - mul) * step(0.35, h13(vec3(ci, 3.0, hb)));
      if (v < 0.4) { diffuseColor.rgb = base * 0.6; mMetal = 0.0; mRough = 0.9; }
    } else if (kind == 0.0 || kind == 8.0) {
      // curtain wall: tinted glass, mullions, spandrel bands, per-panel tint jitter (reflects env)
      float span = mix(0.3, bandAA(ff, 0.80, 0.98, fwidth(fl)), aa);
      float mul = mix(0.1, 1.0 - bandAA(cf, 0.05, 0.95, fwidth(cs)), aa);
      vec3 glass = base * (0.86 + 0.2 * hc);
      diffuseColor.rgb = mix(mix(glass, base * 0.55 + 0.12, span), vec3(0.62, 0.64, 0.66) * (0.6 + base), mul * 0.6);
      mMetal = mix(0.85, 0.3, max(span, mul * 0.6)); mRough = mix(0.04 + 0.08 * hc, 0.45, max(span, mul * 0.6));
      if (kind == 8.0) { mMetal = 0.9; mRough = 0.08; }
      if (hc < 0.02 * smoothstep(0.5, 1.0, shade) && span < 0.5) mEmis = vec3(1.0, 0.74, 0.46) * 0.06;
    } else if (kind == 7.0) {        // parking deck: open horizontal bands
      float open = aa * bandAA(ff, 0.35, 0.9, fwidth(fl));
      diffuseColor.rgb = mix(base, vec3(0.08, 0.08, 0.09), open * 0.9); mRough = 0.9;
    } else {
      // concrete / stone with punched windows (stone mall: tall narrow slots, long horizontal coping bands)
      float win = kind == 4.0 ? aa * bandAA(cf, 0.42, 0.58, fwidth(cs)) * bandAA(fract(v / 9.0), 0.25, 0.85, fwidth(v / 9.0)) * 0.7
                              : aa * bandAA(ff, 0.26, 0.80, fwidth(fl)) * bandAA(cf, 0.18, 0.82, fwidth(cs));
      float band = kind == 4.0 ? bandAA(fract(v / 9.0), 0.0, 0.08, fwidth(v / 9.0)) : 0.0;
      vec3 wall = base * (0.95 + 0.07 * hf) * (1.0 - 0.12 * band);
      vec3 glazing = vec3(0.09, 0.10, 0.12) + base * 0.06;
      diffuseColor.rgb = mix(wall, glazing, win * 0.9);
      mMetal = mix(0.0, 0.55, win); mRough = mix(0.9, 0.12, win);
      if (win > 0.5 && hc < 0.03 * smoothstep(0.5, 1.0, shade)) mEmis = vec3(1.0, 0.72, 0.42) * 0.07;
    }
    // ground grime and roof-edge darkening
    diffuseColor.rgb *= 0.86 + 0.14 * smoothstep(0.0, 3.0, v);
  }
}`;
export function buildingMaterials(stateTex) {
  const U = { uBState: { value: stateTex } };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 1.0 });
  hookMat(m, (sh) => {
    sh.uniforms.uBState = U.uBState;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + BLD_VPARS)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + BLD_VNORM)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BLD_VPOS);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + BLD_FPARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + BLD_FMAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mEmis;');
  }, 'bq-bld-real');
  const dv = (M, key) => hookMat(M, (sh) => {
    sh.uniforms.uBState = U.uBState;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + BLD_VPARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BLD_VPOS);
  }, key);
  const depth = dv(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 'bq-bld-depth');
  const dist = dv(new THREE.MeshDistanceMaterial(), 'bq-bld-dist');
  return { m, depth, dist, U };
}

// ---------------------------------------------------------------------------------------------------------------------
const CONC = ['#dccbaa', '#e6dccb', '#cfb791', '#ebe3d4', '#cdbda4', '#d8c9b0', '#c9b8a0', '#e1d3bb'];
const GLASS = ['#55708c', '#4c6a74', '#5c6a78', '#7f8b96', '#6a5b4a', '#3f4750', '#4f6266', '#8c9aa6'];
const hex = (h, k = 1) => { const c = new THREE.Color(h); return [c.r * k, c.g * k, c.b * k]; };
// colour space: vertex colours are interpreted as linear by three; convert from sRGB-ish palette
const lin = (h, k = 1) => { const c = new THREE.Color(h); return [c.r * k, c.g * k, c.b * k]; };

export function makeRealCity(K, opts, D, ext = {}) {
  const T0 = performance.now();
  // ---- 1. group building:part entries into physical buildings ----
  const raw = [];
  for (const e of D.buildings || []) {
    const poly = clean(e.poly || []); if (poly.length < 3) continue;
    const ar = area(poly); if (Math.abs(ar) < 8) continue;
    const ring = ar < 0 ? poly.slice().reverse() : poly;
    let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
    const h = Math.max(3, +e.h || (e.levels ? e.levels * 3.6 : 10)), minH = Math.max(0, +e.minH || 0);
    if (h - minH < 0.5) continue;
    let near = 1e9; for (const [x, z] of ring) near = Math.min(near, Math.hypot(x, z));
    if (Math.hypot(cx, cz) < BURJ_CLEAR || near < BURJ_CLEAR - 20) continue;
    if (ext.skip && ext.skip(cx, cz, Math.sqrt(Math.abs(ar)))) continue;
    raw.push({ e, ring, holes: (e.holes || []).map(clean).filter((r) => r.length > 2), cx, cz, h, minH, ar: Math.abs(ar) });
  }
  // roots: parts that start at the ground; elevated parts attach to the root containing their centroid
  raw.sort((a, b) => a.minH - b.minH || b.ar - a.ar);
  const B = [], cell = 120, grid = new Map(), key = (i, j) => i * 100003 + j;
  const gAdd = (b, x0, z0, x1, z1) => { for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); } };
  for (const r of raw) {
    let host = null;
    if (r.minH > 0.5 || r.e.part) { for (const b of grid.get(key(Math.floor(r.cx / cell), Math.floor(r.cz / cell))) || []) if (inPoly(r.cx, r.cz, b.parts[0].ring)) { host = b; break; } }
    if (host) { host.parts.push(r); continue; }
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of r.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const b = { parts: [r], x0, z0, x1, z1 };
    B.push(b); gAdd(b, x0, z0, x1, z1);
  }
  // ---- 2. per-building physics + look ----
  const R = rng(1234);
  B.forEach((b, bi) => {
    const r0 = b.parts[0], e = r0.e;
    for (const p of b.parts) for (const [x, z] of p.ring) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); }
    b.id = e.id ?? 'b' + bi; b.name = e.name || (b.parts.find((p) => p.e.name)?.e.name) || null;
    b.x = (b.x0 + b.x1) / 2; b.z = (b.z0 + b.z1) / 2; b.w = b.x1 - b.x0; b.d = b.z1 - b.z0;
    b.h = Math.max(...b.parts.map((p) => p.h)); b.hTop = b.h;
    b.seed = hashStr(b.id); b.ph = b.seed * 6.28;
    b.type = String(e.type || 'yes').toLowerCase();
    b.landmark = !!(e.landmark || b.parts.some((p) => p.e.landmark));
    b.band = b.h < 30 ? 'low' : b.h <= 120 ? 'mid' : 'tower';
    const nm = (b.name || '').toLowerCase(), hs = hashStr(b.id + 'g');
    const mall = b.h < 60 && (/dubai mall|souk|mall\b/.test(nm) || (b.type === 'retail' && r0.ar > 6000));
    const parking = /parking|garage/.test(b.type);
    let glassP = b.h > 150 ? 0.85 : b.h > 60 ? (/office|commercial|hotel/.test(b.type) ? 0.75 : /apartments|residential/.test(b.type) ? 0.35 : 0.55) : b.h > 30 ? 0.3 : 0.1;
    if (/address|vida|burj vista|boulevard point|emaar|opera grand/.test(nm)) glassP = 1;
    if (/glass/.test(e.material || '')) glassP = 1; if (/concrete|stone|brick|plaster/.test(e.material || '')) glassP = 0;
    if (/house|villa|detached|terrace|roof|garage|industrial/.test(b.type)) glassP = 0;
    if (mall || parking) glassP = 0;
    b.style = hs < glassP ? 0 : 1;
    b.kind = mall ? 4 : parking ? 7 : b.style === 0 ? 0 : 1;
    const pal = b.style === 0 ? GLASS : CONC, ci = Math.floor(hashStr(b.id + 'c') * pal.length);
    let col = pal[ci];
    if (mall) col = '#d9c39a'; if (parking) col = '#c7bba8';
    if (/address/.test(nm)) col = '#8a96a0';
    b.col = lin(col, 0.94 + hashStr(b.id + 'v') * 0.12);
    b.mall = mall;
  });
  // ---- 3. failure schedule (film timeline; scenarios via tcOf) ----
  for (const b of B) {
    b.tc = Math.min(Q.bldFailTime(b.h, b.style, b.seed), Q.rubbleCrushTime(b.x, b.z, b.h)); if (!isFinite(b.tc)) b.tc = 1e9;
    b.dur = b.band === 'low' ? 1.3 + b.seed * 0.5 : b.band === 'mid' ? 2.2 + b.seed * 0.6 : 3.2;
    if (ext.riftDist) { const d = ext.riftDist(b.x, b.z); if (d < 70) b.tc = Math.min(b.tc, 29.6 + Math.abs(b.x) / 1500 * 1.2 + d / 140); }
  }
  // ---- 4. geometry, tiled ----
  const TILE = 450, tiles = new Map();
  const tileOf = (b) => { const k = Math.floor(b.x / TILE) + ':' + Math.floor(b.z / TILE); if (!tiles.has(k)) tiles.set(k, new GB()); return tiles.get(k); };
  const tall = B.filter((b) => b.h > 150 && b.parts[b.parts.length - 1].ar > 500).sort((a, b) => b.h - a.h).slice(0, 10);
  const heli = new Set(tall);
  const PLANT = lin('#a9a49b'), PLANT2 = lin('#cfcac0'), TANK = lin('#e8e6e0');
  B.forEach((b, bi) => {
    const G = tileOf(b), Rr = rng(1 + Math.floor(b.seed * 1e6));
    const topPart = b.parts.reduce((a, p) => (p.h > a.h ? p : a), b.parts[0]);
    for (const p of b.parts) {
      const y0 = p.minH > 0.5 ? p.minH : -4, y1 = p.h, isTop = p === topPart;
      const crown = isTop && b.style === 0 && b.h > 140 && b.parts.length === 1 && p.ar > 300;
      const parapet = (b.h < 140 || b.style === 1) && p.ar > 60 ? (b.band === 'low' ? 1.1 : 1.4) : 0;
      const kindW = b.kind, AB = [bi, kindW, b.h, b.seed];
      for (const [ri, ring] of [p.ring, ...p.holes].entries()) {
        const s = Math.sign(area(ring)) * (ri === 0 ? 1 : -1);
        let u = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.01) continue;
          const nx = s * dz / L, nz = -s * dx / L, top = y1 + (ri === 0 ? parapet : 0);
          G.quad([[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], top, c[1]], [a[0], top, a[1]]], [nx, 0, nz], b.col, AB, [[u, y0], [u + L, y0], [u + L, top], [u, top]]);
          u += Math.ceil(L / 1.5) * 1.5 + 0.0;
        }
      }
      if (p.minH > 0.5) G.cap(p.ring, p.holes, p.minH, -1, b.col, [bi, 3, b.h, b.seed]);
      // roof
      const ROOF = lin('#9c968c'), roofK = [bi, 2, b.h, b.seed];
      if (parapet) {
        const inner = inset(p.ring, 0.45), ck = b.col.map((v) => v * 1.05), AB3 = [bi, 3, b.h, b.seed];
        for (let i = 0; i < p.ring.length; i++) {
          const a = p.ring[i], c = p.ring[(i + 1) % p.ring.length], ai = inner[i], ci2 = inner[(i + 1) % inner.length];
          const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1, s = Math.sign(area(p.ring));
          G.quad([[ai[0], y1, ai[1]], [ci2[0], y1, ci2[1]], [ci2[0], y1 + parapet, ci2[1]], [ai[0], y1 + parapet, ai[1]]], [-s * dz / L, 0, s * dx / L], ck, AB3, [[0, 0], [1, 0], [1, 1], [0, 1]]);
          G.quad([[a[0], y1 + parapet, a[1]], [c[0], y1 + parapet, c[1]], [ci2[0], y1 + parapet, ci2[1]], [ai[0], y1 + parapet, ai[1]]], [0, 1, 0], ck, AB3, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
        G.cap(inner, p.holes, y1, 1, ROOF, roofK);
      } else if (crown) {
        // glass crown: inset top storeys + a slim fin
        const inner = inset(p.ring, Math.min(3, Math.sqrt(p.ar) * 0.08)), ch = Math.max(8, b.h * 0.05), AB8 = [bi, 8, b.h, b.seed];
        G.cap(p.ring, p.holes, y1, 1, b.col.map((v) => v * 0.9), [bi, 3, b.h, b.seed]);
        let u = 0;
        for (let i = 0; i < inner.length; i++) { const a = inner[i], c = inner[(i + 1) % inner.length], dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1, s = Math.sign(area(inner));
          G.quad([[a[0], y1, a[1]], [c[0], y1, c[1]], [c[0], y1 + ch, c[1]], [a[0], y1 + ch, a[1]]], [s * dz / L, 0, -s * dx / L], b.col, AB8, [[u, y1], [u + L, y1], [u + L, y1 + ch], [u, y1 + ch]]); u += L; }
        G.cap(inner, null, y1 + ch, 1, ROOF, roofK);
        const [fx, fz] = inner[0]; G.box((fx + b.x) / 2, y1 + ch, (fz + b.z) / 2, 1.2, ch * 1.6, 1.2, 0, lin('#b9c0c6'), [bi, 5, b.h, b.seed]);
      } else G.cap(p.ring, p.holes, y1, 1, ROOF, roofK);
      // rooftop clutter on the top part
      if (isTop && !crown) {
        const ring = parapet ? inset(p.ring, 2.5) : inset(p.ring, 1.5);
        let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        const ok = (x, z, r) => inPoly(x, z, ring) && distPoly(x, z, ring) > r && !p.holes.some((hh) => inPoly(x, z, hh));
        if (heli.has(b)) {
          const rr = Math.min(11, Math.sqrt(p.ar) * 0.28);
          if (ok(b.x, b.z, rr)) { const oct = []; for (let k = 0; k < 8; k++) oct.push([b.x + Math.cos(k / 8 * 6.283 + 0.39) * rr, b.z + Math.sin(k / 8 * 6.283 + 0.39) * rr]);
            const AB6 = [bi, 6, rr, b.seed], i0 = G.v; G.box(b.x, y1, b.z, rr * 1.5, 0.6, rr * 1.5, 0.39, lin('#6b6d70'), [bi, 5, b.h, b.seed]);
            const st = G.v; G.cap(oct, null, y1 + 0.65, 1, lin('#ffffff'), AB6); for (let k = st; k < G.v; k++) { G.f[k * 2] -= b.x; G.f[k * 2 + 1] -= b.z; } continue; }
        }
        const n = Math.min(b.mall ? 40 : 10, Math.max(1, Math.round(p.ar / (b.mall ? 700 : 260))));
        const rot = Math.atan2(p.ring[1][1] - p.ring[0][1], p.ring[1][0] - p.ring[0][0]);
        for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
          const x = x0 + Rr() * (x1 - x0), z = z0 + Rr() * (z1 - z0), q = Rr();
          if (q < 0.25 && b.style === 1 && b.band !== 'tower') { if (!ok(x, z, 1.6)) continue; G.cyl(x, y1, z, 1.2, 2.2, 8, TANK, [bi, 5, b.h, b.seed]); k++; continue; }
          if (b.mall && q < 0.5) {   // long barrel skylights on the mall roofs
            const sx = 18 + Rr() * 40, sz = 5 + Rr() * 3; if (!ok(x, z, sx / 2)) continue;
            G.box(x, y1, z, sx, 1.6, sz, rot, lin('#8d99a3'), [bi, 8, b.h, b.seed]); G.box(x, y1 + 1.6, z, sx, 0.9, sz * 0.6, rot, lin('#a7b3bc'), [bi, 8, b.h, b.seed]); k++; continue; }
          const sx = 2 + Rr() * (b.mall ? 10 : 4), sz = 1.6 + Rr() * 3, sy = 1.2 + Rr() * (b.band === 'low' ? 1.2 : 2.6);
          if (!ok(x, z, Math.hypot(sx, sz) / 2)) continue;
          G.box(x, y1, z, sx, sy, sz, rot, Rr() < 0.5 ? PLANT : PLANT2, [bi, 5, b.h, b.seed]); k++;
        }
      }
    }
  });
  // ---- 5. state texture + materials + meshes ----
  const N = B.length, rows = Math.max(1, Math.ceil(N * 3 / STW));
  const st = new Float32Array(STW * rows * 4);
  const tex = new THREE.DataTexture(st, STW, rows, THREE.RGBAFormat, THREE.FloatType); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  B.forEach((b, i) => { const o = i * 12; st[o] = b.x; st[o + 1] = b.z; st[o + 2] = b.h; st[o + 7] = 1; st[o + 5] = -0.3; });
  tex.needsUpdate = true;
  const mats = buildingMaterials(tex);
  const group = new THREE.Group(); group.name = 'city-real';
  let verts = 0;
  for (const [k, G] of tiles) {
    if (!G.v) continue; verts += G.v;
    const g = G.geometry(); g.computeBoundingSphere(); g.boundingSphere.radius += 60;
    const mesh = new THREE.Mesh(g, mats.m); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = mats.depth; mesh.customDistanceMaterial = mats.dist; mesh.name = 'bld-' + k;
    group.add(mesh);
  }
  // rubble mounds (instanced; matrices only while something is collapsing)
  const mound = new THREE.CylinderGeometry(0.35, 0.62, 1, 7, 1); mound.translate(0, 0.5, 0);
  const imR = new THREE.InstancedMesh(mound, new THREE.MeshStandardMaterial({ color: '#a89c8a', roughness: 0.95, flatShading: true }), Math.max(1, N));
  imR.castShadow = imR.receiveShadow = true; imR.frustumCulled = false; group.add(imR);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < N; i++) imR.setMatrixAt(i, ZERO);
  // ---- 6. runtime ----
  const tcCache = new WeakMap(); let TL = null;
  const tcOf = (sc) => {
    if (!sc || sc === Q.FILM) return TL || (TL = B.map((b) => b.tc));
    let a = tcCache.get(sc); if (a) return a;
    const ft = fnOf(sc, 'bldFailTime'), fc = fnOf(sc, 'rubbleCrushTime');
    a = B.map((b) => { const v = Math.min(ft(b.h, b.style, b.seed), fc(b.x, b.z, b.h)); return isFinite(v) ? v : 1e9; }); tcCache.set(sc, a); return a;
  };
  const CITY_VIS = 35, G = {}, M = new THREE.Matrix4(), P = new THREE.Vector3(), Qt = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
  const pose = B.map(() => ({ crush: 1, rub: 0 }));
  let calmSc, calmN = -1;
  function update(t, sc = null) {
    const ground = fnOf(sc, 'ground'), amp = fnOf(sc, 'amp'), bldSway = fnOf(sc, 'bldSway'), tcs = tcOf(sc);
    let busy = amp(t) !== 0, nDown = 0;
    for (let bi = 0; bi < N && !busy; bi++) { const u = t - tcs[bi]; if (u > 0) { nDown++; if (u < B[bi].dur * 1.5) busy = true; } }
    if (!busy && calmSc === sc && calmN === nDown) return;
    calmSc = busy ? undefined : sc; calmN = busy ? -1 : nDown;
    for (let bi = 0; bi < N; bi++) {
      const b = B[bi], ps = pose[bi], o = bi * 12;
      ground(b.x, b.z, t, G);
      const u = t - tcs[bi], k = u > 0 ? clamp(u / b.dur) : 0;
      const crush = 1 - 0.93 * Math.pow(k, 1.7), lean = 0.10 * sm(k) * (b.seed > 0.5 ? 1 : -1);
      ps.crush = crush; ps.rub = sm(clamp(k * 1.4));
      const d = clamp(bldSway(b.h, t, b.seed) * CITY_VIS, -0.06 * b.h, 0.06 * b.h) * (1 - k);
      st[o + 4] = G.hx * 0.6; st[o + 5] = G.y - 0.3; st[o + 6] = G.hz * 0.6; st[o + 7] = crush;
      st[o + 8] = d * 0.94 / b.h; st[o + 9] = d * 0.34 / b.h; st[o + 10] = -G.gz * 0.6 + lean * 0.4; st[o + 11] = G.gx * 0.6 - lean;
      if (ps.rub <= 0) { imR.setMatrixAt(bi, ZERO); continue; }
      const rr = Math.max(b.w, b.d) * (1.0 + 0.35 * ps.rub), hh = Math.min(b.h * 0.16, 14) * ps.rub + 0.5;
      M.compose(P.set(b.x + G.hx * 0.6, G.y - 0.4, b.z + G.hz * 0.6), Qt.setFromEuler(E.set(0, b.seed * 6, 0)), S.set(rr, hh, Math.max(b.d, 4) / Math.max(b.w, 4) * rr));
      imR.setMatrixAt(bi, M);
    }
    tex.needsUpdate = true; imR.instanceMatrix.needsUpdate = true;
  }
  const fracSc = (band, t, sc) => { const a = tcOf(sc); let n = 0, m = 0; for (let i = 0; i < N; i++) if (B[i].band === band) { m++; if (a[i] <= t) n++; } return n / Math.max(1, m); };
  const lowDown = (t, sc) => fracSc('low', t, sc && sc !== Q.FILM ? sc : null), midDown = (t, sc) => fracSc('mid', t, sc && sc !== Q.FILM ? sc : null);
  const events = B.filter((b) => b.tc < 37).map((b) => ({ x: b.x, z: b.z, h: b.h, tc: b.tc, band: b.band, hero: null })).sort((a, b) => a.tc - b.tc);
  B.tcs = B.map((b) => b.tc).sort((a, b) => a - b);
  const nb = { low: 0, mid: 0, tower: 0 }; for (const b of B) nb[b.band]++;
  console.log('city(real):', D.meta?.source, 'buildings', N, nb, 'tiles', group.children.length - 1, 'verts', verts, 'ms', (performance.now() - T0).toFixed(0));
  return { group, B, update, events, lowDown, midDown, pose, tcOf, imR, stateTex: tex, materials: mats };
}
