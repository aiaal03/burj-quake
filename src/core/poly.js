// WhatIf Whale — low-poly "game shorts" renderer (accumulation: AA, soft shadows, sky AO, DOF, CA, cut-aware shutter). LEAD-OWNED.
// (clayMat/resinMat kept from the clay film; this film uses polyMat.)
// Real miniature-set photography in code: one output frame = N accumulated samples. Each sample jitters
//   · the pixel (AA) · the lens on a thin-lens aperture (real depth of field) · the KEY light inside its area (soft shadows)
//   · a SKY light direction over the hemisphere (accumulates into ambient occlusion / contact shadows)
//   · the camera time inside a short shutter (camera-only motion blur; clay objects are HELD frames → crisp, like stop-motion).
// Then: bloom, filmic tonemap, grade, vignette, grain, UI canvas (1080x1920, crisp) on top.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { W, H, FPS } from '../shared.js';
export { THREE };
export const R = {};

// ---------- global clay uniforms (shared by every clayMat) ----------
export const CLAY = { uBoil: { value: 0 }, uPrint: { value: 1 } };   // uBoil = held-frame index (surface "boil"), uPrint = global print strength

const NOISE = /* glsl */`
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
// clay height field: soft lumps + thumb smudges + fingerprint ridge patches. p in object units / print scale.
float clayH(vec3 p, float boil){
  vec3 q = p + boil * vec3(0.137, 0.071, 0.113);
  float lump = fbm3(q * 3.0);
  float smudge = fbm3(q * 9.0 + 3.1);
  float a = fbm3(q * 1.7) * 6.2831;
  float ridge = sin(dot(q.xz, vec2(cos(a), sin(a))) * 140.0 + fbm3(q * 6.0) * 9.0 + q.y * 60.0);
  float mask = smoothstep(0.55, 0.75, fbm3(q * 2.2 + 7.0));
  return lump * 0.55 + smudge * 0.25 + ridge * mask * 0.06;
}
vec3 perturbClay(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos)); vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad);
}`;

const toCol = (c) => c == null ? new THREE.Color(1, 1, 1) : c.isColor ? c.clone() : Array.isArray(c) ? new THREE.Color(c[0], c[1], c[2]) : new THREE.Color(c);

// clayMat: plasticine. o: color, rough (0.62), sheen (0.35), print (1: fingerprint/lump bump strength), printScale (1: bump feature DENSITY
// multiplier — features are sized for objects ~1 unit; use 3–6 for tiny props, 0.2–0.4 for the planet), boil (1: how much the surface
// "breathes" between held frames), tint (0.06: albedo smudge variation), emissive, emissiveIntensity, opacity/transparent, side, flat
export function clayMat(o = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: toCol(o.color ?? '#d9b38c'), roughness: o.rough ?? 0.62, metalness: 0, sheen: o.sheen ?? 0.35,
    sheenRoughness: 0.6, sheenColor: toCol(o.sheenColor ?? '#fff3e6'), envMapIntensity: o.env ?? 0.55,
    emissive: toCol(o.emissive ?? '#000000'), emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, flatShading: !!o.flat,
    clearcoat: o.clearcoat ?? 0, clearcoatRoughness: o.clearcoatRoughness ?? 0.2,
  });
  const P = { uPrintAmt: { value: o.print ?? 1 }, uPrintScale: { value: o.printScale ?? 1 }, uBoilAmt: { value: o.boil ?? 1 }, uTintAmt: { value: o.tint ?? 0.06 } };
  m.userData.clay = P;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, P, CLAY);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vClayP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClayP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vClayP; uniform float uBoil, uPrint, uPrintAmt, uPrintScale, uBoilAmt, uTintAmt;
${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ float tv = fbm3(vClayP * uPrintScale * 2.5 + 5.0); diffuseColor.rgb *= 1.0 + (tv - 0.5) * 2.0 * uTintAmt; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ float bo = floor(uBoil) * uBoilAmt; vec3 cp = vClayP * uPrintScale * 8.0;
  float hh = mix(clayH(cp, 0.0), clayH(cp, 1.0 + mod(bo, 7.0)), clamp(uBoilAmt, 0.0, 1.0) * 0.18 * step(0.5, bo));
  vec2 dh = vec2(dFdx(hh), dFdy(hh)) * 1.4 * uPrintAmt * uPrint;
  normal = perturbClay(-vViewPosition, normal, dh, faceDirection); }`);
  };
  m.customProgramCacheKey = () => 'clay1';
  return m;
}
// resinMat: glossy "stop-motion water" (clear resin / cellophane). o: color, opacity (0.85), rough (0.06), boil (0.6), print (0.25)
export function resinMat(o = {}) {
  const m = clayMat({ color: o.color ?? '#3f8fd6', rough: o.rough ?? 0.06, sheen: 0, print: o.print ?? 0.25, printScale: o.printScale ?? 1, boil: o.boil ?? 0.6, tint: 0.03,
    transparent: (o.opacity ?? 0.85) < 1, opacity: o.opacity ?? 0.85, env: o.env ?? 1.4, clearcoat: 1, clearcoatRoughness: 0.05, side: o.side });
  m.depthWrite = o.depthWrite ?? true;
  return m;
}
// polyMat: the low-poly "game shorts" material — faceted (flat shading), saturated, slightly satin. o: color, flat (true), rough (0.75),
// metal (0), emissive, emissiveIntensity, opacity/transparent, side, map, vcol (vertexColors), env (0.6)
export function polyMat(o = {}) {
  return new THREE.MeshStandardMaterial({ color: toCol(o.color ?? '#cccccc'), flatShading: o.flat ?? true, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0,
    emissive: toCol(o.emissive ?? '#000000'), emissiveIntensity: o.emissiveIntensity ?? 1, transparent: !!o.transparent || (o.opacity ?? 1) < 1,
    opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, map: o.map ?? null, vertexColors: !!o.vcol, envMapIntensity: o.env ?? 0.6,
    depthWrite: o.depthWrite ?? true });
}
// lightMat: unlit glowing material (sun, bulbs, stars, screens). o: color, intensity (2 = blooms)
export function lightMat(o = {}) {
  const c = toCol(o.color ?? '#fff1c8').multiplyScalar(o.intensity ?? 2);
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1 });
}
// make every mesh in obj cast + receive shadows (call once after building)
export function shadowAll(obj, cast = true, receive = true) { obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } }); return obj; }

export function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------- render targets & passes ----------
const rtCache = new Map();
function rt(key, w, h, { depth = false, half = true, samples = 0 } = {}) {
  const k = `${key}:${w}x${h}`; if (rtCache.has(k)) return rtCache.get(k);
  const t = new THREE.WebGLRenderTarget(w, h, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: depth, stencilBuffer: false,
    magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace, samples });
  rtCache.set(k, t); return t;
}
const FS_VS = /* glsl */`out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const mkPass = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VS, fragmentShader: fs, depthTest: false, depthWrite: false, glslVersion: THREE.GLSL3, ...extra });
const ACC_FS = /* glsl */`precision highp float; in vec2 vUv; uniform sampler2D tSrc; uniform float uW; out vec4 o;
bool bad(vec3 c){ return !(c.r == c.r && c.g == c.g && c.b == c.b) || max(c.r, max(c.g, c.b)) > 6.0e4 || min(c.r, min(c.g, c.b)) < 0.0; }
void main(){ vec3 c = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0).rgb; if (bad(c)) c = vec3(0.0); o = vec4(clamp(c, 0.0, 256.0) * uW, uW); }`;
const BRIGHT_FS = /* glsl */`precision highp float; in vec2 vUv; uniform sampler2D tSrc; uniform float uTh; uniform vec2 uTex; out vec4 o;
void main(){ vec3 c = vec3(0.0); for (int y = -1; y <= 1; y += 2) for (int x = -1; x <= 1; x += 2) c += texture(tSrc, vUv + vec2(float(x), float(y)) * uTex).rgb;
  c *= 0.25; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(uTh, uTh * 1.6 + 0.2, l), 1.0); }`;
const DOWN_FS = /* glsl */`precision highp float; in vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTex; out vec4 o;
void main(){ vec3 c = vec3(0.0); for (int y = -1; y <= 1; y += 2) for (int x = -1; x <= 1; x += 2) c += texture(tSrc, vUv + vec2(float(x), float(y)) * uTex * 0.5).rgb; o = vec4(c * 0.25, 1.0); }`;
const BLUR_FS = /* glsl */`precision highp float; in vec2 vUv; uniform sampler2D tSrc; uniform vec2 uDir; out vec4 o;
void main(){ float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216); vec3 c = texture(tSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) { c += texture(tSrc, vUv + uDir * float(i)).rgb * w[i]; c += texture(tSrc, vUv - uDir * float(i)).rgb * w[i]; } o = vec4(c, 1.0); }`;
const POST_FS = /* glsl */`precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D tAcc, tB1, tB2, tB3, tUI; uniform vec2 uOut;
uniform float uBloom, uExpo, uSat, uContrast, uVig, uGrain, uFrame, uFade, uWarm, uHalation, uCA;
uniform vec3 uTint, uLift, uFadeCol;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 tosrgb(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 c = texelFetch(tAcc, ivec2(gl_FragCoord.xy), 0).rgb;
  if (uCA > 0.0) { vec2 dq = (vUv - 0.5) * uCA / uOut; c.r = texture(tAcc, vUv + dq).r; c.b = texture(tAcc, vUv - dq).b; }
  vec3 b = texture(tB1, vUv).rgb * 0.45 + texture(tB2, vUv).rgb * 0.35 + texture(tB3, vUv).rgb * 0.3;
  c += b * uBloom * vec3(1.0, 0.85, 0.7) * (1.0 + uHalation);
  c *= uExpo;
  c = aces(c * 0.9);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, uSat);
  c = (c - 0.18) * uContrast + 0.18;
  c = c * uTint + uLift;
  c *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), uWarm);
  vec3 s = tosrgb(clamp(c, 0.0, 1.0));
  vec2 q = vUv - 0.5; s *= 1.0 - uVig * dot(q, q) * 1.5;
  s += (h12(gl_FragCoord.xy + uFrame * 13.17) - 0.5) * uGrain;
  s = mix(s, uFadeCol, uFade);
  vec4 u = texelFetch(tUI, ivec2(gl_FragCoord.x, uOut.y - 1.0 - gl_FragCoord.y), 0);
  s = s * (1.0 - u.a) + u.rgb;
  o = vec4(clamp(s, 0.0, 1.0), 1.0);
}`;

let fsScene, fsCam, fsMesh; const M = {};
function pass(mat, target) { fsMesh.material = mat; R.renderer.setRenderTarget(target); R.renderer.render(fsScene, fsCam); }

export function initRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  R.renderer = renderer;
  fsScene = new THREE.Scene(); fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsMesh.frustumCulled = false; fsScene.add(fsMesh);
  M.acc = mkPass(ACC_FS, { tSrc: { value: null }, uW: { value: 1 } }, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });
  M.bright = mkPass(BRIGHT_FS, { tSrc: { value: null }, uTh: { value: 1 }, uTex: { value: new THREE.Vector2() } });
  M.down = mkPass(DOWN_FS, { tSrc: { value: null }, uTex: { value: new THREE.Vector2() } });
  M.blur = mkPass(BLUR_FS, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
  M.post = mkPass(POST_FS, { tAcc: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null }, tUI: { value: null },
    uOut: { value: new THREE.Vector2(W, H) }, uBloom: { value: 0.25 }, uExpo: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 1 }, uVig: { value: 0.25 },
    uGrain: { value: 0.025 }, uFrame: { value: 0 }, uFade: { value: 0 }, uWarm: { value: 0.5 }, uHalation: { value: 0 }, uCA: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3() }, uFadeCol: { value: new THREE.Vector3() } });
  const pm = new THREE.PMREMGenerator(renderer); R.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  // light rig (re-parented into the active scene every sample)
  const rig = new THREE.Group(); rig.name = 'lightRig';
  const key = new THREE.DirectionalLight(0xffffff, 3); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 1.5;
  const sky = new THREE.DirectionalLight(0xffffff, 1); sky.castShadow = true; sky.shadow.mapSize.set(1024, 1024); sky.shadow.bias = -0.0006; sky.shadow.normalBias = 0.03; sky.shadow.radius = 2;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
  rig.add(key, key.target, sky, sky.target, hemi);
  R.rig = { group: rig, key, sky, hemi };
  const uc = document.createElement('canvas'); uc.width = W; uc.height = H;
  const utex = new THREE.CanvasTexture(uc); utex.premultiplyAlpha = true; utex.colorSpace = THREE.NoColorSpace; utex.flipY = false;
  utex.minFilter = THREE.LinearFilter; utex.magFilter = THREE.LinearFilter; utex.generateMipmaps = false;
  R.ui = { canvas: uc, ctx: uc.getContext('2d'), tex: utex };
  return R;
}

export const DEFAULT_LIGHT = {
  key: { dir: [0.55, 0.75, 0.45], col: '#fff4e2', intensity: 2.8, soft: 0.04 },     // soft = angular radius (rad) of the area light
  sky: { col: '#cfe0ff', intensity: 1.1, up: [0, 1, 0], spread: 1.0 },              // jittered hemisphere light (AO)
  hemi: { sky: '#dfe8ff', ground: '#8a6a55', intensity: 0.35 },
  env: 0.55,                                                                         // scene.environment strength multiplier (RoomEnvironment)
};
export const DEFAULT_LOOK = { aperture: 0.0, focus: null, bloom: 0.2, bloomTh: 1.2, expo: 1.0, sat: 1.04, contrast: 1.04, tint: [1, 1, 1], lift: [0, 0, 0],
  vig: 0.16, grain: 0.006, warm: 0.1, halation: 0, ca: 0, fade: 0, fadeCol: [0, 0, 0], clear: '#1a1420', shutter: 0.35 };
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), U = new THREE.Vector3(), RT = new THREE.Vector3(), FW = new THREE.Vector3(), FP = new THREE.Vector3();

function placeLights(F, s, N) {
  const L = { key: { ...DEFAULT_LIGHT.key, ...(F.light?.key || {}) }, sky: { ...DEFAULT_LIGHT.sky, ...(F.light?.sky || {}) },
    hemi: { ...DEFAULT_LIGHT.hemi, ...(F.light?.hemi || {}) } };
  const { key, sky, hemi } = R.rig;
  const sh = F.shadow || {}; const c = sh.center ? V2.set(...sh.center) : V2.set(F.c?.tx ?? 0, F.c?.ty ?? 0, F.c?.tz ?? 0);
  const rad = sh.radius ?? Math.max(1, (F.c?.d ?? 5) * 1.3);
  // key: area light jitter (stratified disk)
  const kd = V.set(...L.key.dir).normalize();
  const a = 2 * Math.PI * halton(s + 1, 3), r = Math.sqrt(halton(s + 1, 2)) * L.key.soft;
  const t1 = Math.abs(kd.y) < 0.9 ? U.set(0, 1, 0).cross(kd).normalize() : U.set(1, 0, 0).cross(kd).normalize();
  const t2 = RT.copy(kd).cross(t1).normalize();
  const dir = FW.copy(kd).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
  key.position.copy(c).addScaledVector(dir, rad * 3); key.target.position.copy(c);
  key.color.set(L.key.col); key.intensity = L.key.intensity;
  const kc = key.shadow.camera; kc.left = -rad; kc.right = rad; kc.top = rad; kc.bottom = -rad; kc.near = 0.01; kc.far = rad * 6; kc.updateProjectionMatrix();
  // sky: cosine hemisphere direction around `up`
  const up = U.set(...L.sky.up).normalize();
  const u1 = halton(s + 1, 5), u2 = halton(s + 1, 7);
  const ph = 2 * Math.PI * u1, ct = Math.sqrt(1 - u2 * L.sky.spread), st = Math.sqrt(1 - ct * ct);
  const b1 = Math.abs(up.y) < 0.9 ? V.set(0, 1, 0).cross(up).normalize() : V.set(1, 0, 0).cross(up).normalize();
  const b2 = RT.copy(up).cross(b1).normalize();
  const sd = FP.copy(up).multiplyScalar(ct).addScaledVector(b1, Math.cos(ph) * st).addScaledVector(b2, Math.sin(ph) * st).normalize();
  sky.position.copy(c).addScaledVector(sd, rad * 3); sky.target.position.copy(c);
  sky.color.set(L.sky.col); sky.intensity = L.sky.intensity;
  const scm = sky.shadow.camera; scm.left = -rad; scm.right = rad; scm.top = rad; scm.bottom = -rad; scm.near = 0.01; scm.far = rad * 6; scm.updateProjectionMatrix();
  hemi.color.set(L.hemi.sky); hemi.groundColor.set(L.hemi.ground); hemi.intensity = L.hemi.intensity;
}

// film = { state(t, {centre, frame}) -> F (F.scene, F.camera, F.light, F.look, F.shadow), ui(t, ctx, F) }
export function renderFrame(film, t, opts = {}) {
  const renderer = R.renderer;
  const N = Math.max(1, opts.samples ?? 1);
  const F0 = film.state(t, { centre: true, frame: opts.frame });
  const look = { ...DEFAULT_LOOK, ...(F0.look || {}) };
  const sceneRT = rt('scene', W, H, { depth: true });
  const accRT = rt('acc', W, H);
  renderer.setRenderTarget(accRT); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
  for (let s = 0; s < N; s++) {
    let ts = N > 1 ? t + ((s + 0.5) / N - 0.5) * look.shutter / FPS : t;
    if (film.shotRange) { const [a, b] = film.shotRange(t); ts = Math.min(Math.max(ts, a + 1e-4), b - 1e-4); }   // never blur across a cut
    const F = (s === 0 && N === 1) ? F0 : film.state(ts, { centre: false, frame: opts.frame });
    const lk = { ...DEFAULT_LOOK, ...(F.look || {}) };
    const scene = F.scene; if (!scene) continue;
    scene.add(R.rig.group);
    scene.environment = F.env || R.env; scene.environmentIntensity = (F.light?.env ?? DEFAULT_LIGHT.env);
    placeLights(F, N > 1 ? s : 0, N);
    const cam = F.camera; cam.aspect = W / H; cam.updateProjectionMatrix();
    // thin lens: move the eye on the aperture disk, re-aim at the focus point
    if (lk.aperture > 0 && N > 1) {
      const focus = lk.focus ?? (F.c?.d ?? 5);
      cam.getWorldDirection(FW); FP.copy(cam.position).addScaledVector(FW, focus);
      const a = 2 * Math.PI * halton(s + 1, 2), r = Math.sqrt(halton(s + 1, 3)) * lk.aperture;
      RT.set(1, 0, 0).applyQuaternion(cam.quaternion); U.set(0, 1, 0).applyQuaternion(cam.quaternion);
      cam.position.addScaledVector(RT, Math.cos(a) * r).addScaledVector(U, Math.sin(a) * r);
      cam.up.copy(U); cam.lookAt(FP); cam.up.set(0, 1, 0); cam.updateMatrixWorld();   // keep the camera's own up (no roll flips looking straight down)
    }
    if (N > 1) { const jx = halton(s + 1, 2) - 0.5, jy = halton(s + 1, 3) - 0.5; cam.projectionMatrix.elements[8] += 2 * jx / W; cam.projectionMatrix.elements[9] += 2 * jy / H; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert(); }
    renderer.setRenderTarget(sceneRT); renderer.setClearColor(new THREE.Color(lk.clear), 1); renderer.clear(true, true, false);
    renderer.render(scene, cam);
    M.acc.uniforms.tSrc.value = sceneRT.texture; M.acc.uniforms.uW.value = 1 / N; pass(M.acc, accRT);
  }
  // bloom
  const mk = (k, d) => rt(k, Math.max(2, W >> d), Math.max(2, H >> d));
  const b1 = mk('b1', 2), b1t = mk('b1t', 2), b2 = mk('b2', 3), b2t = mk('b2t', 3), b3 = mk('b3', 4), b3t = mk('b3t', 4);
  const blur = (a, tmp) => { M.blur.uniforms.tSrc.value = a.texture; M.blur.uniforms.uDir.value.set(1.5 / a.width, 0); pass(M.blur, tmp);
    M.blur.uniforms.tSrc.value = tmp.texture; M.blur.uniforms.uDir.value.set(0, 1.5 / a.height); pass(M.blur, a); };
  M.bright.uniforms.tSrc.value = accRT.texture; M.bright.uniforms.uTh.value = look.bloomTh; M.bright.uniforms.uTex.value.set(1 / W, 1 / H); pass(M.bright, b1); blur(b1, b1t);
  M.down.uniforms.tSrc.value = b1.texture; M.down.uniforms.uTex.value.set(1 / b1.width, 1 / b1.height); pass(M.down, b2); blur(b2, b2t);
  M.down.uniforms.tSrc.value = b2.texture; M.down.uniforms.uTex.value.set(1 / b2.width, 1 / b2.height); pass(M.down, b3); blur(b3, b3t); blur(b3, b3t);
  // UI
  const ctx = R.ui.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  if (film.ui) film.ui(t, ctx, F0);
  R.ui.tex.needsUpdate = true;
  const P = M.post.uniforms;
  P.tAcc.value = accRT.texture; P.tB1.value = b1.texture; P.tB2.value = b2.texture; P.tB3.value = b3.texture; P.tUI.value = R.ui.tex;
  P.uBloom.value = look.bloom; P.uExpo.value = look.expo; P.uSat.value = look.sat; P.uContrast.value = look.contrast; P.uVig.value = look.vig;
  P.uGrain.value = look.grain; P.uFrame.value = opts.frame ?? Math.round(t * FPS); P.uFade.value = look.fade; P.uWarm.value = look.warm; P.uHalation.value = look.halation; P.uCA.value = look.ca;
  P.uTint.value.set(...look.tint); P.uLift.value.set(...look.lift); P.uFadeCol.value.set(...look.fadeCol);
  pass(M.post, null);
  return F0;
}
