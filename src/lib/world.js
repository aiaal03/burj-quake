// Dubai set: sky dome + env, displaced ground, Burj Lake with planar reflection, procedural Downtown, cars, palms, lamps.
import * as THREE from 'three';
import { ground, amp, T_RIFT, sm, ramp, clamp } from './quake.js';
import * as Q from './quake.js';
// Scenario contract (interactive app): every update takes (t, sc). sc = null → the film timeline in quake.js.
// Otherwise sc may override any of: amp(t), ground(x,z,t,out), bldSway(h,t,seed), bldFailTime(h,style,seed), T_RIFT
// (number, or null = no rift). Anything missing falls back to quake.js.
export const fnOf = (sc, n) => (sc && typeof sc[n] === 'function' ? sc[n].bind(sc) : Q[n]);
export const QUALITY = { high: { gseg: 320, lakeRT: [540, 960], cars: 1, carSeg: 1 }, realtime: { gseg: 128, lakeRT: [360, 640], cars: 0.45 } };
export const qOf = (o) => QUALITY[(o && o.quality) || 'high'] || QUALITY.high;

// late golden hour: sun 12° above the horizon from the WSW (−x / +z), one light for the whole film
export const SUN = new THREE.Vector3(-0.905, 0.208, 0.372).normalize();
const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

// ---------------- sky ----------------
const SKY_VS = /* glsl */`varying vec3 vDir; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w * 0.99999; }`;
const SKY_VS_ENV = /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = /* glsl */`uniform vec3 uSun; uniform float uDust; uniform float uSunI; varying vec3 vDir;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 x){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(h12(i), h12(i + vec2(1,0)), f.x), mix(h12(i + vec2(0,1)), h12(i + vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir); float e = d.y;
  // warm horizon #F3C58E -> soft mid -> zenith #6E8FB8
  vec3 zen = vec3(0.155, 0.27, 0.48), mid = vec3(0.52, 0.60, 0.70), hor = vec3(0.95, 0.70, 0.46), haze = vec3(0.85, 0.66, 0.47);
  float s = max(dot(d, uSun), 0.0);
  float ee = max(e, 0.0);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.28, ee)); c = mix(c, zen, smoothstep(0.2, 0.9, ee));
  // sun-side glow: warmer + brighter toward the sun azimuth, fading with height
  float az = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
  c = mix(c, vec3(1.08, 0.72, 0.42), pow(az, 3.0) * (1.0 - smoothstep(0.0, 0.45, ee)) * 0.55);
  c = mix(c, haze, (1.0 - smoothstep(0.0, 0.07, ee)) * 0.6);
  // faint cirrus streaks, lit warm on the sun side
  vec2 cp = d.xz / max(e + 0.08, 0.05);
  float cl = fbm(vec2(cp.x * 0.55 + cp.y * 0.2, cp.y * 2.4) * 0.9);
  cl = smoothstep(0.52, 0.85, cl) * smoothstep(0.03, 0.18, e) * (1.0 - smoothstep(0.5, 0.95, e));
  c = mix(c, mix(vec3(0.96, 0.86, 0.78), vec3(1.25, 0.88, 0.6), pow(s, 6.0)), cl * 0.42);
  if (e < 0.0) c = mix(haze, vec3(0.55, 0.43, 0.33), smoothstep(0.0, -0.2, e));
  vec3 dust = mix(vec3(0.80, 0.62, 0.44), vec3(0.56, 0.47, 0.40), smoothstep(0.0, 0.7, ee));
  c = mix(c, dust, uDust);
  // sun disc + halo (bloom picks up the disc)
  float disc = smoothstep(0.99985, 0.99993, s);
  c += vec3(1.0, 0.80, 0.55) * (disc * 14.0 + pow(s, 900.0) * 3.0 + pow(s, 60.0) * 0.55 + pow(s, 9.0) * 0.22) * uSunI * (1.0 - uDust * 0.7);
  gl_FragColor = vec4(c, 1.0);
}`;

export function makeSky() {
  const U = { uSun: { value: SUN.clone() }, uDust: { value: 0 }, uSunI: { value: 1 } };
  const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), m); mesh.renderOrder = -10; mesh.frustumCulled = false;
  return { mesh, U };
}
export function makeEnv(renderer, dust = 0) {
  const sc = new THREE.Scene();
  const U = { uSun: { value: SUN.clone() }, uDust: { value: dust }, uSunI: { value: 0.25 } };
  const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VS_ENV, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), m));
  const city = new THREE.Mesh(new THREE.CircleGeometry(98, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.26, 0.21) }));
  city.rotation.x = -Math.PI / 2; city.position.y = -2; sc.add(city);
  const pm = new THREE.PMREMGenerator(renderer); const tex = pm.fromScene(sc, 0, 0.1, 500).texture; pm.dispose();
  return tex;
}

// ---------------- lake ----------------
export const LAKE = { cx: -60, cz: 330, rx: 330, rz: 215 };
export function inLake(x, z, pad = 0) {
  const a = Math.atan2((z - LAKE.cz) / LAKE.rz, (x - LAKE.cx) / LAKE.rx);
  const w = 1 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 5 + 2);
  const r = Math.hypot((x - LAKE.cx) / (LAKE.rx * w + pad), (z - LAKE.cz) / (LAKE.rz * w + pad));
  return r < 1;
}
function lakeShape() {
  const sh = new THREE.Shape(); const N = 96;
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, w = 1 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 5 + 2);
    const x = LAKE.cx + Math.cos(a) * LAKE.rx * w, z = LAKE.cz + Math.sin(a) * LAKE.rz * w;
    if (i === 0) sh.moveTo(x, -z); else sh.lineTo(x, -z);
  }
  return sh;
}
const WATER_VS = /* glsl */`uniform mat4 uTexM; varying vec4 vR; varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vR = uTexM * w; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const WATER_FS = /* glsl */`uniform sampler2D tRefl; uniform float uTime, uRip, uSlosh; uniform vec3 uSun; varying vec4 vR; varying vec3 vW;
#include <fog_pars_fragment>
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 x){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(h12(i), h12(i + vec2(1,0)), f.x), mix(h12(i + vec2(0,1)), h12(i + vec2(1,1)), f.x), f.y); }
float hgt(vec2 p){ float t = uTime;
  float h = vn(p * 0.09 + vec2(t * 0.15, t * 0.05)) * 0.6 + vn(p * 0.23 - vec2(t * 0.1, -t * 0.2)) * 0.3 + vn(p * 0.6 + t * 0.3) * 0.12;
  h += uRip * (sin(dot(p, vec2(0.94, 0.34)) * 0.07 - t * 5.0) * 0.6 + vn(p * 0.4 + t * 2.0) * 0.6);
  h += uSlosh * sin(dot(p, vec2(0.94, 0.34)) * 0.022 - t * 2.1) * 0.8;
  return h; }
void main(){
  vec2 p = vW.xz; float e = 0.6;
  float h0 = hgt(p), hx = hgt(p + vec2(e, 0.0)), hz = hgt(p + vec2(0.0, e));
  vec3 n = normalize(vec3(-(hx - h0) / e * 0.9, 1.0, -(hz - h0) / e * 0.9));
  vec3 v = normalize(cameraPosition - vW);
  float fr = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec2 uv = clamp(vR.xy / vR.w + n.xz * 0.02, 0.001, 0.999);
  vec3 refl = texture2D(tRefl, uv).rgb;
  vec3 deep = vec3(0.035, 0.05, 0.058);
  vec3 c = mix(deep, refl * vec3(0.86, 0.9, 0.93), clamp(fr * 1.05 + 0.18, 0.0, 1.0));
  vec3 hv = normalize(uSun + v); c += vec3(1.0, 0.8, 0.55) * pow(max(dot(n, hv), 0.0), 350.0) * 6.0;
  gl_FragColor = vec4(c, 1.0);
#include <fog_fragment>
}`;
export function makeLake(renderer, opts) {
  const [rw, rh] = qOf(opts).lakeRT;
  const rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType });
  const U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tRefl: { value: null }, uTexM: { value: new THREE.Matrix4() }, uTime: { value: 0 }, uRip: { value: 0 }, uSlosh: { value: 0 }, uSun: { value: SUN.clone() } }]);
  U.tRefl.value = rt.texture;
  const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true });
  const g = new THREE.ShapeGeometry(lakeShape(), 4); g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m); mesh.position.y = 0.4; mesh.receiveShadow = false;
  const vc = new THREE.PerspectiveCamera(); const tm = new THREE.Matrix4(), V = new THREE.Vector3(), D = new THREE.Vector3(), up = new THREE.Vector3();
  const hide = [];
  mesh.onBeforeRender = (r, scene, camera) => {
    if (mesh.userData.busy) return; mesh.userData.busy = true;
    const wy = mesh.position.y;
    camera.getWorldDirection(D); V.copy(camera.position); vc.position.set(V.x, 2 * wy - V.y, V.z);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion); up.y = -up.y;
    vc.up.copy(up); D.y = -D.y; vc.lookAt(vc.position.clone().add(D));
    vc.projectionMatrix.copy(camera.projectionMatrix); vc.fov = camera.fov; vc.near = camera.near; vc.far = camera.far; vc.updateMatrixWorld();
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1); tm.multiply(vc.projectionMatrix); tm.multiply(vc.matrixWorldInverse);
    U.uTexM.value.copy(tm);
    const cur = r.getRenderTarget(), au = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
    mesh.visible = false; for (const o of hide) o.visible = false;
    r.setRenderTarget(rt); r.setClearColor(0xd9b48a, 1); r.clear(true, true, false); r.render(scene, vc);
    for (const o of hide) o.visible = true; mesh.visible = true;
    r.shadowMap.autoUpdate = au; r.setRenderTarget(cur); mesh.userData.busy = false;
  };
  return { mesh, U, hide };
}

// ---------------- ground ----------------
const GSIZE = 3200;
export const ROAD = { pitch: 120, origin: -1020, w: 18 };
const isRoadLine = (v) => { const r = ((v - ROAD.origin) % ROAD.pitch + ROAD.pitch) % ROAD.pitch; return Math.min(r, ROAD.pitch - r) < ROAD.w / 2; };
export const PARK_R = 175;
export const SZR_X = -660;   // the big highway with the tower row
function paintGround(K) {
  const N = 4096, s = N / GSIZE;
  return K.canvasTex(N, N, (c) => {
    const P = (x) => (x + GSIZE / 2) * s;
    const R = rng(11);
    c.fillStyle = '#b89a76'; c.fillRect(0, 0, N, N);
    for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${150 + R() * 60 | 0},${120 + R() * 50 | 0},${90 + R() * 40 | 0},${0.08 + R() * 0.1})`; const r = 2 + R() * 30; c.beginPath(); c.arc(R() * N, R() * N, r, 0, 7); c.fill(); }
    // urban paving zone
    c.fillStyle = 'rgba(150,140,128,0.85)'; c.beginPath(); c.arc(P(0), P(0), 1500 * s, 0, 7); c.fill();
    for (let i = 0; i < 4000; i++) { const x = R() * N, y = R() * N; c.fillStyle = `rgba(${110 + R() * 70 | 0},${105 + R() * 60 | 0},${95 + R() * 55 | 0},0.35)`; c.fillRect(x, y, 6 + R() * 60, 6 + R() * 60); }
    // roads
    c.fillStyle = '#3d3f43';
    for (let v = ROAD.origin - ROAD.pitch * 2; v < 1500; v += ROAD.pitch) { c.fillRect(P(v - ROAD.w / 2), P(-1500), ROAD.w * s, 3000 * s); c.fillRect(P(-1500), P(v - ROAD.w / 2), 3000 * s, ROAD.w * s); }
    c.fillStyle = '#34363a'; c.fillRect(P(SZR_X - 30), 0, 60 * s, N);
    c.strokeStyle = 'rgba(240,235,220,0.55)'; c.lineWidth = 0.35 * s; c.setLineDash([3 * s, 6 * s]);
    for (let v = ROAD.origin - ROAD.pitch * 2; v < 1500; v += ROAD.pitch) { c.beginPath(); c.moveTo(P(v), P(-1500)); c.lineTo(P(v), P(1500)); c.stroke(); c.beginPath(); c.moveTo(P(-1500), P(v)); c.lineTo(P(1500), P(v)); c.stroke(); }
    for (const o of [-20, -8, 8, 20]) { c.beginPath(); c.moveTo(P(SZR_X + o), 0); c.lineTo(P(SZR_X + o), N); c.stroke(); }
    c.setLineDash([]);
    // park around the tower + promenade
    c.fillStyle = '#6f8d4e'; c.beginPath(); c.arc(P(0), P(0), PARK_R * s, 0, 7); c.fill();
    c.fillStyle = '#c9bca6'; c.beginPath(); c.arc(P(0), P(0), 118 * s, 0, 7); c.fill();
    for (let i = 0; i < 1500; i++) { const a = R() * 7, r = 120 + R() * 55; c.fillStyle = `rgba(${70 + R() * 40 | 0},${110 + R() * 40 | 0},${50 + R() * 30 | 0},0.5)`; c.beginPath(); c.arc(P(Math.cos(a) * r), P(Math.sin(a) * r), (1 + R() * 3) * s, 0, 7); c.fill(); }
    c.fillStyle = '#d8ccb6'; c.beginPath();
    for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2, w = 1 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 5 + 2);
      const x = LAKE.cx + Math.cos(a) * (LAKE.rx * w + 22), z = LAKE.cz + Math.sin(a) * (LAKE.rz * w + 22); if (i) c.lineTo(P(x), P(z)); else c.moveTo(P(x), P(z)); }
    c.fill();
    c.fillStyle = '#1d2a2c'; c.beginPath();
    for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2, w = 1 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 5 + 2);
      const x = LAKE.cx + Math.cos(a) * LAKE.rx * w, z = LAKE.cz + Math.sin(a) * LAKE.rz * w; if (i) c.lineTo(P(x), P(z)); else c.moveTo(P(x), P(z)); }
    c.fill();
  });
}
export function makeGround(K, opts) {
  const GSEG = qOf(opts).gseg;
  const g = new THREE.PlaneGeometry(GSIZE, GSIZE, GSEG, GSEG); g.rotateX(-Math.PI / 2);
  const map = paintGround(K); map.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, envMapIntensity: 0.4 });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true;
  const pos = g.attributes.position, nor = g.attributes.normal, base = Float32Array.from(pos.array);
  const far = new THREE.Mesh(new THREE.RingGeometry(GSIZE * 0.45, 40000, 64, 1), new THREE.MeshStandardMaterial({ color: '#b39572', roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.6; far.receiveShadow = true;
  const G = {}; let lastA = -1;
  let lastSc;
  function update(t, sc = null) {
    const amp = fnOf(sc, 'amp'), ground = fnOf(sc, 'ground');
    const A = amp(t);
    if (A === 0 && lastA === 0 && sc === lastSc) return; lastA = A; lastSc = sc;   // flat & unchanged: skip the CPU grid loop
    const a = pos.array, n = nor.array;
    for (let i = 0; i < a.length; i += 3) {
      const x = base[i], z = base[i + 2];
      ground(x, z, t, G);
      let y = G.y; if (inLake(x, z, -2)) y -= 30;
      a[i + 1] = y;
      const l = Math.hypot(G.gx, 1, G.gz); n[i] = -G.gx / l; n[i + 1] = 1 / l; n[i + 2] = -G.gz / l;
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
  }
  // initial lake depression
  { const a = pos.array; for (let i = 0; i < a.length; i += 3) if (inLake(a[i], a[i + 2], -2)) a[i + 1] = -30; pos.needsUpdate = true; }
  return { mesh, far, update };
}

// ---------------- city buildings (instanced) ----------------
const BLD_VS_INJ = /* glsl */`
attribute float aStyle; attribute float aSeed; varying float vStyle; varying float vSeed; varying vec3 vB; varying vec3 vNo;`;
const BLD_FS_INJ = /* glsl */`
varying float vStyle; varying float vSeed; varying vec3 vB; varying vec3 vNo;
float h13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }`;
export function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2, envMapIntensity: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + BLD_VS_INJ)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vB = (position + vec3(0.5, 0.0, 0.5)) * sc; vNo = normal; vStyle = aStyle; vSeed = aSeed;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + BLD_FS_INJ)
      .replace('#include <color_fragment>', `#include <color_fragment>
float mMetal = 0.0, mRough = 0.8; vec3 mEmis = vec3(0.0);
{
  float s = abs(vNo.x) > 0.5 ? vB.z : vB.x;
  float fl = vB.y / 3.5, ff = fract(fl), cs = s / (vStyle < 0.5 ? 1.6 : 3.0), cf = fract(cs);
  float fw = max(fwidth(fl), fwidth(cs)); float aa = clamp(1.6 - fw * 2.0, 0.0, 1.0);
  vec3 base = diffuseColor.rgb; float hc = h13(vec3(floor(fl), floor(cs), vSeed * 91.0)); float hb = h13(vec3(floor(fl / 4.0), vSeed * 13.0, 3.0));
  // shadow-side warm interiors (golden hour), ~3 %
  float shade = 1.0 - clamp(dot(normalize(vNo), normalize(vec3(-0.9, 0.2, 0.37))) * 2.0, 0.0, 1.0);
  if (abs(vNo.y) > 0.5) { diffuseColor.rgb = mix(base, vec3(0.60, 0.56, 0.50), 0.65) * (0.92 + 0.12 * hc); mRough = 0.92; }
  else if (vStyle > 1.5) { diffuseColor.rgb = base * (0.9 + 0.15 * hc); mRough = 0.95; }
  else if (vStyle < 0.5) {
    // curtain wall: tinted glass, thin mullions, spandrel bands
    float span = mix(0.25, smoothstep(0.76, 0.80, ff) * (1.0 - smoothstep(0.96, 1.0, ff)), aa);
    float mul = mix(0.12, 1.0 - smoothstep(0.04, 0.10, abs(cf - 0.5) * -2.0 + 1.0), aa);
    vec3 glass = base * (0.82 + 0.22 * hc);
    diffuseColor.rgb = mix(mix(glass, base * 0.6 + 0.16, span), base * 0.5 + 0.25, mul * 0.5);
    mMetal = mix(0.65, 0.2, span); mRough = mix(0.10 + 0.10 * hc, 0.55, max(span, mul * 0.5));
    if (hc < 0.03 * shade) mEmis = vec3(1.0, 0.70, 0.40) * 0.10;
  } else {
    // concrete / stone: punched windows, slight per-floor value variation
    float win = aa * smoothstep(0.24, 0.28, ff) * (1.0 - smoothstep(0.76, 0.80, ff)) * smoothstep(0.16, 0.2, cf) * (1.0 - smoothstep(0.8, 0.84, cf));
    vec3 wall = base * (0.95 + 0.08 * hb);
    diffuseColor.rgb = mix(wall, vec3(0.10, 0.11, 0.12) + base * 0.08, win * 0.85);
    mMetal = mix(0.0, 0.5, win); mRough = mix(0.88, 0.18, win);
    if (win > 0.5 && hc < 0.04 * shade) mEmis = vec3(1.0, 0.70, 0.40) * 0.10;
  }
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mEmis;');
  };
  m.customProgramCacheKey = () => 'bld2';
  return m;
}

// city palette: sand / ivory / bronze glass / graphite / blue-grey glass, ±6 % value jitter per building
const CONC_COLS = ['#d9c4a0', '#e4d8c3', '#cdb48e', '#e9e1d2', '#c9b9a0', '#d6c7ad'];
const GLASS_COLS = ['#5e5244', '#6b5d4c', '#3e4349', '#4d5966', '#5f7183', '#4a4f55'];
export const BAND = { LOW: 0, MID: 1, TOWER: 2 };
// explicit hero buildings that the board keeps in frame (see seg/main.js shots S4 and S9)
export const HERO = {
  s4: { x: -311, z: 521, w: 15, d: 13, h: 18.5, band: 0, style: 1, col: '#dccaa6', rot: 0.52 },  // 5-storey block, street-level shot
  s9: { x: -327, z: 620, w: 32, d: 26, h: 58, band: 1, style: 1, col: '#d3c2a4', rot: 0.6, tc: 20.6, dur: 1.9 }, // ~16-storey mid-rise
};
export const CLEAR = [[-314, 570, 26], [-368, 821, 40], [0, 1470, 170], [300, 1500, 120]];   // camera positions kept free of buildings [x, z, r]

export function makeCity(K, opts) {
  const R = rng(1234);
  const B = [];
  const add = (o) => {
    const { x, z, w, d } = o, rr = Math.max(w, d) * 0.5;
    if (!o.hero) {
      if (Math.hypot(x, z) < PARK_R + rr) return;
      if (inLake(x, z, rr * 1.2 + 26)) return;
      if (Math.abs(x - SZR_X) < 36 + w / 2) return;
      for (const [cx, cz, r] of CLEAR) if (Math.hypot(x - cx, z - cz) < r + rr + 8) return;
      for (const k in HERO) { const hb = HERO[k]; if (Math.hypot(x - hb.x, z - hb.z) < Math.max(hb.w, hb.d) * 0.7 + rr + 6) return; }
    }
    const glass = o.band === 2 ? true : o.band === 1 ? R() < 0.5 : R() < 0.15;
    const style = o.style ?? (glass ? 0 : 1);
    const pal = style === 0 ? GLASS_COLS : CONC_COLS;
    const c = new THREE.Color(o.col || pal[R() * pal.length | 0]); c.multiplyScalar(0.94 + R() * 0.12);
    B.push({ ...o, style, col: c, seed: R(), ph: R() * 6.28, rot: o.rot ?? 0, setback: o.band > 0 && !o.round && R() < 0.6, roof: R() });
  };
  for (const k in HERO) add({ ...HERO[k], hero: k });
  for (let gx = ROAD.origin - 2 * ROAD.pitch; gx < 1400; gx += ROAD.pitch) for (let gz = ROAD.origin - 2 * ROAD.pitch; gz < 1400; gz += ROAD.pitch) {
    const cx = gx + ROAD.pitch / 2, cz = gz + ROAD.pitch / 2, r = Math.hypot(cx, cz);
    if (r > 1500) continue;
    const inner = ROAD.pitch - ROAD.w - 10;
    const nearSZR = Math.abs(cx - SZR_X) < 140;
    const dens = r < 700 ? 1 : r < 1100 ? 0.85 : 0.6;
    if (R() > dens) continue;
    // block band mix: towers along Sheikh Zayed Rd + a few downtown, mid-rises in the ring, low-rises everywhere
    const pT = nearSZR ? 0.75 : r < 650 ? 0.10 : r < 1100 ? 0.03 : 0.0;
    const pM = nearSZR ? 0.2 : r < 650 ? 0.32 : r < 1100 ? 0.22 : 0.08;
    const q = R(), band = q < pT ? 2 : q < pT + pM ? 1 : 0;
    const split = band === 0 ? (R() < 0.5 ? 3 : 2) : band === 1 ? (R() < 0.6 ? 2 : 1) : (R() < 0.35 ? 2 : 1);
    for (let i = 0; i < split; i++) for (let j = 0; j < split; j++) {
      if (split > 1 && R() < 0.14) continue;
      const cw = inner / split, x = cx - inner / 2 + cw * (i + 0.5), z = cz - inner / 2 + cw * (j + 0.5);
      let h, bb = band;
      if (bb === 1 && split === 2 && R() < 0.35) bb = 0;               // mixed blocks
      if (bb === 2) h = 3.5 * (40 + Math.round(R() * R() * 45));      // 40–85 storeys
      else if (bb === 1) h = 3.5 * (12 + Math.round(R() * 13));        // 12–25
      else h = 3.5 * (2 + Math.round(Math.pow(R(), 1.3) * 6));         // 2–8
      const fill = bb === 0 ? 0.72 + 0.22 * R() : 0.6 + 0.25 * R();
      const w = cw * fill, d = cw * (bb === 0 ? 0.72 + 0.22 * R() : 0.6 + 0.25 * R());
      add({ x: x + (R() - 0.5) * 5, z: z + (R() - 0.5) * 5, w, d, h, band: bb, round: bb === 2 && R() < 0.25 });
    }
  }
  // failure schedule from the engineer's model (period vs spectrum, capacity per style)
  // bands as strings for the HUD: 'low' | 'mid' | 'tower'
  for (const b of B) b.band = ['low', 'mid', 'tower'][b.band];
  for (const b of B) {
    b.tc = b.tc ?? Math.min(Q.bldFailTime(b.h, b.style, b.seed), Q.rubbleCrushTime(b.x, b.z, b.h));
    if (!isFinite(b.tc)) b.tc = 1e9;
    b.dur = b.dur ?? (b.band === 'low' ? 1.3 + b.seed * 0.5 : b.band === 'mid' ? 2.2 + b.seed * 0.6 : 3.2);
  }
  for (const b of B) { const d = riftDist(b.x, b.z); if (d < 70 && !b.hero) b.tc = Math.min(b.tc, 29.6 + Math.abs(b.x) / 1500 * 1.2 + d / 140); }
  B.heroS4 = B.find((b) => b.hero === 's4'); B.heroS9 = B.find((b) => b.hero === 's9'); B.heroMid = B.heroS9; B.heroS6 = B.heroS9; B.heroS8 = B.heroS9;   // heroMid: mid-rise failing in M8 (20.6)
  B.tcs = B.map((b) => b.tc).sort((a, b) => a - b);
  const LOW = B.filter((b) => b.band === 'low'), lowTc = LOW.map((b) => b.tc).sort((a, b) => a - b);
  const MID = B.filter((b) => b.band === 'mid'), midTc = MID.map((b) => b.tc).sort((a, b) => a - b);
  const frac = (arr, t) => { let n = 0; while (n < arr.length && arr[n] <= t) n++; return n / Math.max(1, arr.length); };
  // collapse events for HUD ping rings: {x, z, h, tc, band}
  const events = B.filter((b) => b.tc < 37).map((b) => ({ x: b.x, z: b.z, h: b.h, tc: b.tc, band: b.band, hero: b.hero || null })).sort((a, b) => a.tc - b.tc);

  // ---- parts: body, setback crown, roof plant box, rubble mound ----
  const parts = { box: [], cyl: [] };
  B.forEach((b, bi) => {
    const P = (geo, o) => parts[geo].push({ bi, ...o });
    if (b.round) { P('cyl', { y0: 0, hh: b.h, sx: b.w, sz: b.w, ox: 0, oz: 0, col: b.col }); P('cyl', { y0: b.h, hh: 6, sx: b.w * 0.55, sz: b.w * 0.55, ox: 0, oz: 0, col: b.col.clone().multiplyScalar(0.8) }); return; }
    if (b.setback) {
      const k = 0.62 + b.seed * 0.2;
      P('box', { y0: 0, hh: b.h * k, sx: b.w, sz: b.d, ox: 0, oz: 0, col: b.col });
      P('box', { y0: b.h * k, hh: b.h * (1 - k), sx: b.w * 0.72, sz: b.d * 0.72, ox: (b.roof - 0.5) * b.w * 0.12, oz: 0, col: b.col.clone().multiplyScalar(1.04) });
    } else P('box', { y0: 0, hh: b.h, sx: b.w, sz: b.d, ox: 0, oz: 0, col: b.col });
    const pw = b.setback ? 0.72 : 1, rh = b.band === 'low' ? 1.6 + b.roof * 1.6 : 3 + b.roof * 4;
    P('box', { y0: b.h, hh: rh, sx: b.w * pw * (0.3 + 0.2 * b.roof), sz: b.d * pw * (0.3 + 0.15 * b.seed), ox: (b.seed - 0.5) * b.w * 0.25 * pw, oz: (b.roof - 0.5) * b.d * 0.25 * pw, col: new THREE.Color('#b7ab98').multiplyScalar(0.9 + b.roof * 0.2), roofbox: 1 });
    if (b.band === 'low') P('box', { y0: b.h, hh: 1.1, sx: b.w, sz: b.d, ox: 0, oz: 0, col: b.col.clone().multiplyScalar(0.92), parapet: 1 });
  });
  const rubble = B.map((b, bi) => ({ bi }));
  const mat = buildingMaterial();
  const mk = (geo, list, style) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    const st = new Float32Array(list.length), sd = new Float32Array(list.length);
    list.forEach((p, i) => { const b = B[p.bi]; st[i] = style ?? (p.roofbox ? 2 : b.style); sd[i] = b.seed; im.setColorAt(i, p.col || new THREE.Color('#8f8473').multiplyScalar(0.9 + b.seed * 0.2)); });
    geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(st, 1)); geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sd, 1));
    return im;
  };
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28); cyl.translate(0, 0.5, 0);
  const mound = new THREE.CylinderGeometry(0.35, 0.62, 1, 7, 1); mound.translate(0, 0.5, 0);
  const imB = mk(box, parts.box), imC = mk(cyl, parts.cyl), imR = mk(mound, rubble, 2);
  const group = new THREE.Group(); group.add(imB, imC, imR);
  // per-building pose for time t: base transform + lateral shear (sway) + vertical crush (collapse)
  const Mb = new THREE.Matrix4(), Ms = new THREE.Matrix4(), Mp = new THREE.Matrix4(), M = new THREE.Matrix4(), Q0 = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), G = {};
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const pose = B.map(() => ({ M: new THREE.Matrix4(), crush: 1, gone: false, rub: 0 }));
  // drawn city sway: TRUE metres × CITY_VIS, capped at 6 % drift. NOTE: much more than the Burj's ×DEF_SCALE —
  // at ×3 a 5-storey block moves ~6 cm at M5 and nothing reads on screen. Lead to decide how the HUD labels it.
  const CITY_VIS = 35;
  // failure times per scenario (timeline: precomputed b.tc incl. the hero overrides)
  const TC = new WeakMap(); let TL = null;
  const tcOf = (sc) => {
    if (!sc || sc === Q.FILM) return TL || (TL = B.map((b) => b.tc));
    let a = TC.get(sc); if (a) return a;
    const ft = fnOf(sc, 'bldFailTime'), fc = fnOf(sc, 'rubbleCrushTime'); a = B.map((b) => { const v = Math.min(ft(b.h, b.style, b.seed), fc(b.x, b.z, b.h)); return isFinite(v) ? v : 1e9; }); TC.set(sc, a); return a;
  };
  let calmSc, calmN = -1;
  function update(t, sc = null) {
    const ground = fnOf(sc, 'ground'), amp = fnOf(sc, 'amp'), bldSway = fnOf(sc, 'bldSway'), tcs = tcOf(sc);
    // skip all matrix work when nothing moves (no shaking, no collapse in progress) and the set of fallen buildings
    // is the one already uploaded — the realtime app idles here for free
    let busy = amp(t) !== 0, nDown = 0;
    for (let bi = 0; bi < B.length && !busy; bi++) { const u = t - tcs[bi]; if (u > 0) { nDown++; if (u < B[bi].dur * 1.5) busy = true; } }
    if (!busy && calmSc === sc && calmN === nDown) return;
    calmSc = busy ? undefined : sc; calmN = busy ? -1 : nDown;
    for (let bi = 0; bi < B.length; bi++) {
      const b = B[bi], ps = pose[bi];
      ground(b.x, b.z, t, G);
      const u = t - tcs[bi], k = u > 0 ? clamp(u / b.dur) : 0;
      // pancake: accelerating vertical crush + a lean toward the weaker side
      const crush = 1 - 0.93 * Math.pow(k, 1.7);
      const lean = 0.10 * sm(k) * (b.seed > 0.5 ? 1 : -1);
      ps.crush = crush; ps.gone = k >= 1 && false; ps.rub = sm(clamp(k * 1.4));
      const d = clamp(bldSway(b.h, t, b.seed) * CITY_VIS, -0.06 * b.h, 0.06 * b.h) * (1 - k);
      const kx = (d * 0.94) / b.h, kz = (d * 0.34) / b.h;
      E.set(-G.gz * 0.6 + lean * 0.4, b.rot, G.gx * 0.6 - lean); Q0.setFromEuler(E);
      P.set(b.x + G.hx * 0.6, G.y - 0.3, b.z + G.hz * 0.6); Mb.compose(P, Q0, S.set(1, 1, 1));
      Ms.set(1, kx, 0, 0, 0, crush, 0, 0, 0, kz, 1, 0, 0, 0, 0, 1);
      ps.M.multiplyMatrices(Mb, Ms);
    }
    const put = (im, list) => {
      for (let i = 0; i < list.length; i++) {
        const p = list[i], ps = pose[p.bi];
        Mp.compose(P.set(p.ox, p.y0, p.oz), Q0.identity(), S.set(p.sx, p.hh, p.sz));
        M.multiplyMatrices(ps.M, Mp); im.setMatrixAt(i, M);
      }
      im.instanceMatrix.needsUpdate = true;
    };
    put(imB, parts.box); put(imC, parts.cyl);
    for (let bi = 0; bi < B.length; bi++) {
      const b = B[bi], ps = pose[bi];
      if (ps.rub <= 0) { imR.setMatrixAt(bi, ZERO); continue; }
      ground(b.x, b.z, t, G);
      const rr = Math.max(b.w, b.d) * (1.0 + 0.35 * ps.rub), hh = Math.min(b.h * 0.16, 14) * ps.rub + 0.5;
      M.compose(P.set(b.x + G.hx * 0.6, G.y - 0.4, b.z + G.hz * 0.6), Q0.setFromEuler(E.set(0, b.seed * 6, 0)), S.set(rr, hh, rr * (b.d / b.w)));
      imR.setMatrixAt(bi, M);
    }
    imR.instanceMatrix.needsUpdate = true;
  }
  const fracSc = (band, t, sc) => { const a = tcOf(sc); let n = 0, m = 0; for (let i = 0; i < B.length; i++) if (B[i].band === band) { m++; if (a[i] <= t) n++; } return n / Math.max(1, m); };
  const lowDown = (t, sc) => (sc && sc !== Q.FILM ? fracSc('low', t, sc) : frac(lowTc, t)), midDown = (t, sc) => (sc && sc !== Q.FILM ? fracSc('mid', t, sc) : frac(midTc, t));
  console.log('city: buildings', B.length, 'low', LOW.length, 'mid', MID.length, 'tower', B.length - LOW.length - MID.length,
    'low down @17.4', lowDown(17.39).toFixed(2), '@23', lowDown(22.99).toFixed(2), 'mid down @23', midDown(22.99).toFixed(2), '@29', midDown(28.99).toFixed(2));
  return { group, B, update, imB, imC, imR, events, lowDown, midDown, pose, tcOf };
}

// ---------------- cars ----------------
export function makeCars(opts) {
  const R = rng(77), L = [], CK = qOf(opts).cars;
  const COLS = ['#f2f2f0', '#111214', '#8a8d92', '#c9ccd0', '#2a3550', '#6b0f14', '#e8e2d0', '#1d1f22', '#4a4e54'];
  for (let i = 0; i < Math.round(900 * CK); i++) {
    const alongX = R() < 0.5, lineV = ROAD.origin + ROAD.pitch * Math.floor(R() * 21);
    const lane = (R() < 0.5 ? -1 : 1) * (2.5 + (R() < 0.5 ? 3.3 : 0));
    L.push({ alongX, line: lineV + lane, dir: lane > 0 ? 1 : -1, s0: -1400 + R() * 2800, v: 9 + R() * 7, col: COLS[R() * COLS.length | 0], seed: R() });
  }
  // the hero street (z = 60, x < -200) gets dense traffic
  for (let i = 0; i < 70; i++) { const lane = (i % 2 ? -1 : 1) * (2.6 + (i % 4 > 1 ? 3.3 : 0)); L.push({ alongX: true, line: 60 + lane, dir: lane > 0 ? 1 : -1, s0: -1050 + R() * 830, v: 10 + R() * 5, col: COLS[R() * COLS.length | 0], seed: R(), hero: true }); }
  // highway
  for (let i = 0; i < Math.round(220 * CK); i++) { const lane = (i % 2 ? -1 : 1) * (4 + 4 * (i % 3)); L.push({ alongX: false, line: SZR_X + lane, dir: lane > 0 ? 1 : -1, s0: -1500 + R() * 3000, v: 22 + R() * 8, col: COLS[R() * COLS.length | 0], seed: R() }); }
  const body = new THREE.BoxGeometry(4.5, 1.0, 1.85); body.translate(0, 0.75, 0);
  const cab = new THREE.BoxGeometry(2.4, 0.6, 1.6); cab.translate(-0.25, 1.5, 0);
  const mB = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.5 });
  const mC = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.08, metalness: 0.9 });
  const ib = new THREE.InstancedMesh(body, mB, L.length), ic = new THREE.InstancedMesh(cab, mC, L.length);
  ib.castShadow = ic.castShadow = true; ib.receiveShadow = true; ib.frustumCulled = ic.frustumCulled = false;
  L.forEach((c, i) => ib.setColorAt(i, new THREE.Color(c.col)));
  const group = new THREE.Group(); group.add(ib, ic);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), G = {};
  function update(t, sc = null) {
    const amp = fnOf(sc, 'amp'), ground = fnOf(sc, 'ground');
    const A = amp(t);
    L.forEach((c, i) => {
      const ts = 11.6 + c.seed * 1.4, tt = t < ts ? t : ts + 0.9 * (1 - Math.exp(-(t - ts) / 0.9));
      let s = c.s0 + c.dir * c.v * tt; const span = 2800; s = ((s + 1400) % span + span) % span - 1400;
      if (c.hero) { s = ((c.s0 + c.dir * c.v * tt + 1050) % 830 + 830) % 830 - 1050; }
      const x = c.alongX ? s : c.line, z = c.alongX ? c.line : s;
      if (Math.hypot(x, z) < PARK_R || inLake(x, z, 4)) { M.makeScale(0, 0, 0); ib.setMatrixAt(i, M); ic.setMatrixAt(i, M); return; }
      ground(x, z, t, G);
      const j = A * 0.03 * Math.sin(t * 19 + c.seed * 40), bounce = Math.max(0, A * 0.05 * Math.sin(t * 13 + c.seed * 30));
      E.set(-G.gz + j, (c.alongX ? 0 : Math.PI / 2) + (c.dir < 0 ? Math.PI : 0) + j * 2, G.gx - j);
      Q.setFromEuler(E); P.set(x + G.hx * 0.8, G.y + bounce, z + G.hz * 0.8);
      M.compose(P, Q, S); ib.setMatrixAt(i, M); ic.setMatrixAt(i, M);
    });
    ib.instanceMatrix.needsUpdate = true; ic.instanceMatrix.needsUpdate = true;
  }
  return { group, update };
}

// ---------------- palms + lamps ----------------
function palmGeos() {
  const trunk = new THREE.CylinderGeometry(0.22, 0.38, 1, 8, 6, true); trunk.translate(0, 0.5, 0);
  { const p = trunk.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + y * y * 0.6); } trunk.computeVertexNormals(); }
  const fr = [];
  for (let k = 0; k < 11; k++) {
    const g = new THREE.PlaneGeometry(1, 0.9, 8, 1); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) + 0.5, v = p.getY(i); const w = (1 - u) * 0.9 + 0.1; p.setXYZ(i, u * 4.4, -u * u * 2.0 + 0.3, v * w * 1.1); }
    g.rotateZ(0.25); g.rotateY(k / 11 * Math.PI * 2 + (k % 2) * 0.2); g.translate(0.6, 1, 0); fr.push(g);
  }
  const crown = mergeGeos(fr); crown.computeVertexNormals();
  return { trunk, crown };
}
function mergeGeos(list) {
  let n = 0, ni = 0; for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), idx = []; let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + o); o += g.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
export function makePalmsLamps() {
  const R = rng(99), palms = [], lamps = [];
  // promenade palms around the lake
  for (let i = 0; i < 120; i++) { const a = i / 120 * Math.PI * 2 + R() * 0.02, w = 1 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 5 + 2);
    palms.push({ x: LAKE.cx + Math.cos(a) * (LAKE.rx * w + 14), z: LAKE.cz + Math.sin(a) * (LAKE.rz * w + 14), h: 9 + R() * 4, s: R() }); }
  for (let i = 0; i < 60; i++) { const a = R() * Math.PI * 2, r = 125 + R() * 40; palms.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h: 8 + R() * 4, s: R() }); }
  // hero street (z = 60): median palms + lamps on both sides
  for (let x = -1040; x < -200; x += 22) { palms.push({ x: x + R() * 2, z: 60, h: 9 + R() * 3, s: R() }); lamps.push({ x: x + 11, z: 60 - 11, s: R(), side: 1 }); lamps.push({ x: x + 11, z: 60 + 11, s: R(), side: -1 }); }
  for (let i = 0; i < 70; i++) { const a = i / 70 * Math.PI * 2, w = 1 + 0.08 * Math.sin(a * 3 + 1) + 0.05 * Math.sin(a * 5 + 2);
    lamps.push({ x: LAKE.cx + Math.cos(a) * (LAKE.rx * w + 5), z: LAKE.cz + Math.sin(a) * (LAKE.rz * w + 5), s: R(), side: 0 }); }
  const { trunk, crown } = palmGeos();
  const it = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#7a6248', roughness: 0.95 }), palms.length);
  const icr = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: '#4d6b2c', roughness: 0.8, side: THREE.DoubleSide }), palms.length);
  const pole = new THREE.CylinderGeometry(0.09, 0.14, 9, 6); pole.translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(1.8, 0.12, 0.12); arm.translate(0.9, 9, 0);
  const head = new THREE.BoxGeometry(0.7, 0.18, 0.35); head.translate(1.7, 8.9, 0);
  const lampG = mergeGeos([pole, arm, head]); lampG.computeVertexNormals();
  const il = new THREE.InstancedMesh(lampG, new THREE.MeshStandardMaterial({ color: '#5a5e64', roughness: 0.4, metalness: 0.8 }), lamps.length);
  for (const m of [it, icr, il]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
  const group = new THREE.Group(); group.add(it, icr, il);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), G = {};
  function update(t, sc = null) {
    const amp = fnOf(sc, 'amp'), ground = fnOf(sc, 'ground');
    const A = amp(t), wind = 0.03;
    palms.forEach((p, i) => {
      ground(p.x, p.z, t, G);
      const sw = wind * Math.sin(t * 1.3 + p.s * 9) + Math.min(A, 3) * 0.06 * Math.sin(t * 4.1 + p.s * 20) + Math.min(A, 3) * 0.04 * Math.sin(t * 6.7 + p.s * 7);
      E.set(sw * 0.5 - G.gz, p.s * 6.28, sw + G.gx); Q.setFromEuler(E); P.set(p.x + G.hx * 0.8, G.y, p.z + G.hz * 0.8);
      S.set(1, p.h, 1); M.compose(P, Q, S); it.setMatrixAt(i, M);
      // crown at the bent trunk top
      const V = new THREE.Vector3(0.6, p.h, 0).applyQuaternion(Q);
      E.set(sw * 1.2 - G.gz, p.s * 6.28 + sw, sw * 1.5 + G.gx); Q.setFromEuler(E);
      S.set(1, 1, 1).multiplyScalar(0.9 + p.s * 0.3); M.compose(P.clone().add(V).sub(new THREE.Vector3(0, 1, 0)), Q, S); icr.setMatrixAt(i, M);
    });
    lamps.forEach((l, i) => {
      ground(l.x, l.z, t, G);
      const sw = Math.min(A, 2.5) * 0.05 * Math.sin(t * 5.3 + l.s * 30) + Math.min(A, 2.5) * 0.03 * Math.sin(t * 8.1 + l.s * 11);
      const yaw = l.side === 1 ? Math.PI / 2 : l.side === -1 ? -Math.PI / 2 : Math.atan2(l.x - LAKE.cx, l.z - LAKE.cz) + Math.PI / 2;
      E.set(sw - G.gz, yaw, sw * 0.7 + G.gx); Q.setFromEuler(E); P.set(l.x + G.hx, G.y, l.z + G.hz); S.set(1, 1, 1);
      M.compose(P, Q, S); il.setMatrixAt(i, M);
    });
    it.instanceMatrix.needsUpdate = icr.instanceMatrix.needsUpdate = il.instanceMatrix.needsUpdate = true;
  }
  return { group, update };
}

// ---------------- rift (M10) ----------------
export const RIFT = (() => { const pts = []; const R = rng(5); let x = -1500, z = -270;
  for (let i = 0; i <= 60; i++) { const u = i / 60; pts.push([x + u * 3000, z + u * 700 + Math.sin(u * 17) * 40 + (R() - 0.5) * 30]); }
  return pts; })();
export function makeRift() {
  const N = RIFT.length, g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 2 * 3), idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#0d0a08', roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 })); mesh.frustumCulled = false; mesh.receiveShadow = true;
  const G = {}, R = rng(8), jag = RIFT.map(() => [0.6 + R() * 0.8, 0.6 + R() * 0.8]);
  function update(t, sc = null) {
    const ground = fnOf(sc, 'ground'), T_R = riftT(sc);
    const u = T_R == null ? -1 : t - T_R; mesh.visible = u > 0; if (!mesh.visible) return;
    const reach = clamp(u / 1.6), wmax = 34 * sm(ramp(t, T_R, T_R + 3.5));
    for (let i = 0; i < N; i++) {
      const [x, z] = RIFT[i], k = i / (N - 1);
      const open = clamp((reach - Math.abs(k - 0.42) / 0.6) * 4);
      const prev = RIFT[Math.max(0, i - 1)], next = RIFT[Math.min(N - 1, i + 1)];
      let nx = -(next[1] - prev[1]), nz = next[0] - prev[0]; const l = Math.hypot(nx, nz); nx /= l; nz /= l;
      const w = wmax * open * (0.7 + 0.3 * Math.sin(k * 40));
      ground(x, z, t, G);
      pos[i * 6] = x + nx * w * 0.5 * jag[i][0]; pos[i * 6 + 1] = G.y + 0.35; pos[i * 6 + 2] = z + nz * w * 0.5 * jag[i][0];
      pos[i * 6 + 3] = x - nx * w * 0.5 * jag[i][1]; pos[i * 6 + 4] = G.y + 0.35; pos[i * 6 + 5] = z - nz * w * 0.5 * jag[i][1];
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals();
  }
  return { mesh, update };
}
// rift opening time for a scenario: film 29.3; app scenarios open it 1.5 s before the base fails (M ≳ 9.6), else none
export function riftT(sc) {
  if (!sc || sc === Q.FILM) return T_RIFT;
  if ('T_RIFT' in sc) return sc.T_RIFT;
  return isFinite(sc.tBreak) ? Math.max(0.5, sc.tBreak - 1.5) : null;
}
export function riftDist(x, z) { let d = 1e9; for (const p of RIFT) d = Math.min(d, Math.hypot(p[0] - x, p[1] - z)); return d; }
