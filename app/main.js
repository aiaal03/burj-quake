// Burj Quake — interactive real-time app. Pick a magnitude, shake, orbit, switch views.
// Rendering: scene → linear HDR target → post (cheap bloom, ACES, grade, sRGB) — same look as the film renderer.
import * as THREE from 'three';
import { canvasTex, polyMat, lightMat, shadowAll } from '../src/core/poly.js';
import * as T from '../src/core/time.js';
import { setup as setupWorld, updateWorld, W_ } from '../src/lib/dubai.js';
import * as Q from '../src/lib/quake.js';
import { makeOrbit } from './orbit.js';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const DPR = Math.min(window.devicePixelRatio || 1, qs.get('dpr') ? +qs.get('dpr') : 1.5);
renderer.setPixelRatio(DPR);

// ---------- post ----------
const FS_VS = `out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D tScene, tBloom; uniform float uBloom, uExpo, uSat, uContrast, uVig, uWarm; uniform vec3 uTint, uLift;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 tosrgb(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){ vec3 c = texture(tScene, vUv).rgb + texture(tBloom, vUv).rgb * uBloom * vec3(1.0, 0.85, 0.7);
  c = aces(c * uExpo * 0.9); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, uSat);
  c = (c - 0.18) * uContrast + 0.18; c = c * uTint + uLift; c *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), uWarm);
  vec3 s = tosrgb(clamp(c, 0.0, 1.0)); vec2 q = vUv - 0.5; s *= 1.0 - uVig * dot(q, q) * 1.5; o = vec4(s, 1.0); }`;
const BRIGHT_FS = `precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D tSrc; uniform float uTh;
void main(){ vec3 c = texture(tSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(uTh, uTh * 1.6 + 0.2, l), 1.0); }`;
const BLUR_FS = `precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D tSrc; uniform vec2 uDir;
void main(){ float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216); vec3 c = texture(tSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) { c += texture(tSrc, vUv + uDir * float(i)).rgb * w[i]; c += texture(tSrc, vUv - uDir * float(i)).rgb * w[i]; } o = vec4(c, 1.0); }`;
const mkPass = (fs, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: FS_VS, fragmentShader: fs, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false });
const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); fsMesh.frustumCulled = false; fsScene.add(fsMesh);
const P = {
  post: mkPass(POST_FS, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.2 }, uExpo: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 1.08 }, uVig: { value: 0.18 }, uWarm: { value: 0.12 },
    uTint: { value: new THREE.Vector3(1.015, 1.0, 0.975) }, uLift: { value: new THREE.Vector3(0.006, 0.009, 0.014) } }),
  bright: mkPass(BRIGHT_FS, { tSrc: { value: null }, uTh: { value: 1.6 } }),
  blur: mkPass(BLUR_FS, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }),
};
const mkRT = (w, h, depth) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: depth, samples: depth ? 4 : 0 });
let rtScene, rtB1, rtB2;
const pass = (m, target) => { fsMesh.material = m; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); };

// ---------- world ----------
const K = { THREE, R: { renderer }, canvasTex, polyMat, lightMat, shadowAll, T, quality: qs.get('quality') || 'realtime' };
const camera = new THREE.PerspectiveCamera(45, 1, 1.5, 30000);
const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
const skyL = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
const ambSky = new THREE.DirectionalLight(0xffffff, 0.3);

const app = { M: 7.0, t: 0, running: false, speed: 1, view: 'normal', sc: null, seis: new Float32Array(360), seisI: 0, fps: 0 };
window.app = app;

function setMagnitude(M) {
  app.M = Math.round(M * 10) / 10; app.sc = Q.makeScenario(app.M); app.t = 0; app.running = false;
  W_.scenario = app.sc; W_.tower.setScenario?.(app.sc); W_.rebuildFx?.(app.sc); app.seis.fill(0);
}
function shake() { if (app.t > 0) app.t = 0; app.seis.fill(0); app.running = true; }
function reset() { app.t = 0; app.running = false; app.seis.fill(0); }
function setView(v) { app.view = v; }

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 58 : 42; camera.updateProjectionMatrix();
  const pw = Math.round(w * DPR), ph = Math.round(h * DPR);
  rtScene?.dispose(); rtB1?.dispose(); rtB2?.dispose();
  rtScene = mkRT(pw, ph, true); rtB1 = mkRT(pw >> 2, ph >> 2, false); rtB2 = mkRT(pw >> 2, ph >> 2, false);
}

const V = new THREE.Vector3();
function towerPoint(y) {
  const segs = W_.tower.segs, st = W_.tower.state; let i = segs.findIndex((s) => y < s.s1); if (i < 0) i = segs.length - 1;
  const sw = st.segWorld[i]; if (!segs[i].g.visible) return null;
  return V.set(0, y - segs[i].s0, 0).applyQuaternion(sw.q).add(sw.p).clone();
}
function project(p) {
  const v = p.clone().project(camera); return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (0.5 - v.y * 0.5) * window.innerHeight, visible: v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 };
}

function burjStatus(sc, t) {
  if (t >= sc.tImpact) return 'COLLAPSED';
  if (t >= sc.tBreak) return 'OVERTURNING';
  if (t >= sc.tSpire) return 'SPIRE LOST';
  return 'STANDING';
}

function buildState() {
  const sc = app.sc, t = app.t, low = 100 * (W_.city.lowDown?.(t, sc) ?? 0), mid = 100 * (W_.city.midDown?.(t, sc) ?? 0);
  const n = app.seis.length, seis = new Array(n); for (let k = 0; k < n; k++) seis[k] = app.seis[(app.seisI + 1 + k) % n];
  const callouts = [];
  const add = (id, y, text, hot, show) => { if (!show) return; const p = towerPoint(y); if (!p) return; const s = project(p); callouts.push({ id, x: s.x, y: s.y, visible: s.visible, text, hot }); };
  const jr = sc.stressMax(t, 'joint'), br = sc.stressMax(t, 'base');
  if (app.view === 'stress') {
    add('joint', 600, t >= sc.tSpire ? 'Spire joint failed · L156' : `Spire joint · L156 · ${jr.toFixed(2)}`, jr >= 1, true);
    add('base', 25, t >= sc.tBreak ? 'Base overturning' : `Base · peak bending · ${br.toFixed(2)}`, br >= 1, true);
  } else if (app.view === 'xray') {
    add('steel', 700, 'Steel spire', false, true);
    add('joint', 600, 'Concrete → steel · L156', false, true);
    add('core', 300, 'Y-shaped buttressed core', false, true);
    add('base', 10, '3.7 m raft · ~194 piles', false, true);
  }
  return { M: app.M, t, running: app.running, amp: sc.amp(t), seis, loadMax: sc.stressMax(t), loadJoint: jr, loadBase: br,
    stressBins: W_.tower.U.uS.value, lowRiseDown: low, midRiseDown: mid, burjStatus: burjStatus(sc, t), tSpire: sc.tSpire, tBreak: sc.tBreak, tImpact: sc.tImpact,
    view: app.view, callouts, fps: app.fps, end: sc.end };
}

let orbit, ui, last = performance.now(), fpsAcc = 0, fpsN = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (window.__capture) return;
  tick(dt);
  requestAnimationFrame(frame);
}
function tick(dt) {
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { app.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (app.running) { app.t += dt * app.speed; if (app.t > app.sc.end) { app.t = app.sc.end; app.running = false; } }
  const st = updateWorld(app.t, app.sc);
  // seismograph sample (ground velocity-ish at the tower)
  const g = app.sc.ground(0, 0, app.t);
  app.seis[app.seisI = (app.seisI + 1) % app.seis.length] = app.running || app.t > 0 ? g.y + (g.hx + g.hz) * 0.5 : 0;
  // views
  const stress = app.view === 'stress' ? 1 : 0, xray = app.view === 'xray' ? 1 : 0;
  const U = W_.tower.U; if (U.uStress) U.uStress.value += (stress - U.uStress.value) * Math.min(1, dt * 6);
  if (U.uXray) U.uXray.value += (xray - U.uXray.value) * Math.min(1, dt * 6);
  if (U.uWipeY) U.uWipeY.value = 2000;
  const dim = 1 - 0.55 * Math.max(U.uStress?.value || 0, U.uXray?.value || 0);
  // lights from the world state
  const L = st.light;
  orbit.update(dt);
  W_.sky.mesh.position.copy(camera.position);
  const scene = W_.scene;
  if (sun.parent !== scene) scene.add(sun, sun.target, skyL, ambSky, ambSky.target);
  const c = orbit.S, sd = new THREE.Vector3(...L.key.dir).normalize();
  const fc = new THREE.Vector3(c.tx, 0, c.tz), rad = Math.min(1800, Math.max(400, c.dist * 0.9));
  sun.position.copy(fc).addScaledVector(sd, rad * 3); sun.target.position.copy(fc);
  Object.assign(sun.shadow.camera, { left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: rad * 6 }); sun.shadow.camera.updateProjectionMatrix();
  sun.color.set(L.key.col); sun.intensity = L.key.intensity * dim;
  ambSky.position.set(0, 1000, 0); ambSky.color.set(L.sky.col); ambSky.intensity = L.sky.intensity * dim;
  skyL.color.set(L.hemi.sky); skyL.groundColor.set(L.hemi.ground); skyL.intensity = (L.hemi.intensity + 0.15) * dim;
  scene.environment = st.dz > 0.3 ? W_.env1 : W_.env0; scene.environmentIntensity = L.env * dim;
  // render
  camera.updateMatrixWorld();
  renderer.setRenderTarget(rtScene); renderer.setClearColor(0xd9b48a, 1); renderer.clear(); renderer.render(scene, camera);
  P.bright.uniforms.tSrc.value = rtScene.texture; pass(P.bright, rtB1);
  P.blur.uniforms.tSrc.value = rtB1.texture; P.blur.uniforms.uDir.value.set(1.5 / rtB1.width, 0); pass(P.blur, rtB2);
  P.blur.uniforms.tSrc.value = rtB2.texture; P.blur.uniforms.uDir.value.set(0, 1.5 / rtB1.height); pass(P.blur, rtB1);
  P.post.uniforms.tScene.value = rtScene.texture; P.post.uniforms.tBloom.value = rtB1.texture; pass(P.post, null);
  ui?.update(buildState());
}

async function boot() {
  const fonts = [['Inter', 'Inter-Regular', '400'], ['Inter', 'Inter-Medium', '500'], ['Inter', 'Inter-SemiBold', '600'], ['Inter', 'Inter-Bold', '700'], ['Inter', 'Inter-ExtraBold', '800']];
  await Promise.all(fonts.map(async ([f, n, w]) => { try { const ff = new FontFace(f, `url(${new URL(`../assets/fonts/${n}.woff2`, import.meta.url)})`, { weight: w }); await ff.load(); document.fonts.add(ff); } catch (e) { /* system font fallback */ } }));
  await setupWorld(K);
  const phone = innerWidth / innerHeight < 0.8;
  orbit = makeOrbit(camera, canvas, { target: [0, phone ? 300 : 330, 0], dist: phone ? 2500 : 1750, yaw: -42, pitch: phone ? 14 : 10 });
  if (qs.has('cam')) { const [d, yw, pt, ty] = qs.get('cam').split(',').map(Number); Object.assign(orbit.S, { dist: d, yaw: yw, pitch: pt, ty }); orbit.goTo({ dist: d, yaw: yw, pitch: pt, ty }); orbit.setAuto(false); }
  resize(); addEventListener('resize', resize);
  setMagnitude(+(qs.get('m') || 7));
  try {
    const { createUI } = await import('./ui/ui.js');
    ui = createUI(document.getElementById('ui'), {
      onMagnitude: (m) => setMagnitude(m), onShake: shake, onReset: reset, onView: setView, onSpeed: (s) => { app.speed = s; },
      initial: { M: app.M, view: app.view, speed: app.speed },
    });
  } catch (e) { console.error('UI', e); }
  if (qs.get('ui') === '0') document.getElementById('ui').style.display = 'none';
  document.body.classList.add('ready');
  if (qs.has('t')) { app.t = +qs.get('t'); }
  if (qs.has('view')) { setView(qs.get('view')); ui?.setView?.(qs.get('view')); }
  window.bq = { setMagnitude, shake, reset, setView: (v) => { setView(v); ui?.setView?.(v); }, tick, orbit };
  window.ready = true;
  requestAnimationFrame(frame);
}
boot().catch((e) => { console.error('BOOT', e); window.bootError = String(e && e.stack || e); });
