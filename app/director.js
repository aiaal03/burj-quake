// Director mode — live multi-shot camera + motivated view modes + lower-third captions while the quake plays.
// Plays by default on Shake (toggle "Director ↔ Free camera"); any drag / pinch / wheel on the canvas hands the
// camera back (Free camera). Pure function of sim time app.t (+ dt from tick for the aftermath) → deterministic
// under the capture hooks. Smooth eased moves inside a shot, hard cuts between shots, never any shake.
// Captions: short strings sourced from docs/SCIENCE.md (research brief) and docs/ENGINEERING.md (§4 captions, §9 collapse).
import * as THREE from 'three';
import { W_ } from '../src/lib/dubai.js';
import { SUN, LAKE } from '../src/lib/world.js';

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sm = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ease = (u) => 0.55 * u + 0.45 * sm(u);               // gentle drone: moving at the cut, eased overall
const L3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

// ---- copy (≤ 6 words, sourced) ----
const CAP = {
  core: 'Y-shaped buttressed core',                 // SCIENCE 1
  joint: 'Concrete → steel at level 156',           // SCIENCE 1
  felt: 'Felt by few',                              // ENGINEERING §4 M3
  sway: 'Short buildings sway fast',                // SCIENCE 7 / ENG §4 M5
  tune: 'Low-rises: in tune with the shaking',      // SCIENCE 7
  per: 'T ≈ 0.1 s per storey',                      // SCIENCE 7
  burjT: 'Burj · T = 11.3 s',                       // SCIENCE 4
  wind: 'Wind, not quakes, governed the tower',     // SCIENCE 5
  baseOk: 'Base: most bending, under limit',        // SCIENCE 6b (reasoning) + sim state
  link: 'Link beams yield · by design',             // SCIENCE 1, 6d
  fuse: 'Fuses protect the core',                   // SCIENCE 1 ("ductile fuse")
  mid: 'Mid-rises next',                            // ENG §8 thresholds
  spireJ: 'Spire joint · level 156',                // SCIENCE 6a
  spireF: 'Spire fails first',                      // SCIENCE 6a (reasoning)
  spireSeis: 'Quakes, not wind, sized the spire',   // SCIENCE 5
  bend: 'Bending peaks at the base',                // SCIENCE 6b
  crush: 'Base crushes · tower telescopes down',    // ENGINEERING §9
  down: 'Tall towers fall down, not over',          // ENGINEERING §9
  hypo: 'Hypothetical · beyond design',             // SCIENCE caption guidance
  rec: 'Largest recorded: M9.5, Chile 1960',        // SCIENCE caption guidance
};
const KICK = { orbit: 'Burj Khalifa', aerial: 'Establishing', street: 'Street level', mid: 'Street level', lake: 'Lake', spire: 'Spire', base: 'Base', side: 'Side view', wide: 'Aftermath', link: 'Core', after: 'Aftermath' };

export function makeDirector({ camera, canvas, orbit, app, setView, root }) {
  // ---------- DOM (own file, own classes; matches ui.css look) ----------
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./director.css', import.meta.url).href; document.head.append(css);
  const box = document.createElement('div'); box.className = 'bqd';
  box.innerHTML = `<div class="bqd-cap" aria-live="polite"><div class="bqd-kick"></div><div class="bqd-text"></div></div>
    <div class="bqd-toggle" role="group" aria-label="Camera mode"><button data-m="director" aria-pressed="true">Director</button><button data-m="free" aria-pressed="false">Free camera</button></div>
    <button class="bqd-tour" type="button" title="One continuous orbit: 5 s at M7, 7 s at M9, 9 s at M10">Tour  M7 → M9 → M10</button>`;
  root.append(box);
  const capEl = box.querySelector('.bqd-cap'), kickEl = box.querySelector('.bqd-kick'), textEl = box.querySelector('.bqd-text');
  const btns = [...box.querySelectorAll('.bqd-toggle button')];
  const tourBtn = box.querySelector('.bqd-tour');
  // Tour: escalating magnitudes in one continuous orbit (camera runs on tour time, not on each scenario's time)
  const TOUR = [{ M: 7, d: 5, sp: 1 }, { M: 9, d: 7, sp: 1 }, { M: 10, d: 9, sp: 1.3 }];
  const TOUR_CAP = { 7: 'M7 · low-rises fail first', 9: 'M9 · the spire joint gives', 10: 'M10 · beyond anything recorded' };
  let hooks = null;

  const D = { tour: null, switching: false, offX: 0, offY: 0, mode: 'director', active: false, phase: 'idle', plan: [], aft: 0, viewLock: false, lastView: null, baseFov: camera.fov, shotI: -1, sc: null };
  function setMode(m) {
    D.mode = m; btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
    if (m === 'free') { if (D.tour) { D.tour = null; app.speed = 1; tourBtn.classList.remove('is-on'); } stop(false); }
    else if (app.running && app.sc) start();
  }
  btns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
  tourBtn.addEventListener('click', () => startTour());
  function startTour() {
    if (!hooks) return;
    D.tour = { i: -1, T: 0, total: TOUR.reduce((a, s) => a + s.d, 0) }; setMode('director');
    tourBtn.classList.add('is-on');
  }
  function endTour() { if (!D.tour) return; D.tour = null; app.speed = 1; tourBtn.classList.remove('is-on'); D.phase = 'after'; D.aft = 0; }
  const userGrab = () => { if (D.mode === 'director') setMode('free'); };
  canvas.addEventListener('pointerdown', userGrab); canvas.addEventListener('wheel', userGrab, { passive: true });

  // phone: sit above the bottom panel; desktop: bottom-left of the scene area
  function layout() {
    const desk = innerWidth >= 900, panel = root.querySelector('.bq-panel'), ph = panel?.offsetHeight || 300;
    box.style.bottom = desk ? '24px' : `${ph + 18}px`;
    // subject offset in NDC (pan only — the camera position never moves): centre of the free scene area
    D.offX = desk ? 380 / innerWidth : 0;
    D.offY = desk ? 0 : Math.min(0.5, ph / innerHeight);
  }

  // ---------- geometry helpers ----------
  const B = () => W_.city.B;
  function blocked(x, z, y, skip, pad = 4) {   // point inside any building volume (footprint as circle)
    for (const b of B()) {
      if (b === skip || b.h + 2 < y) continue;
      const r = Math.hypot(b.w, b.d) * 0.5 + pad, dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
  function losClear(c, t, skip) {
    for (let k = 1; k <= 9; k++) { const u = k / 10, x = c[0] + (t[0] - c[0]) * u, z = c[2] + (t[2] - c[2]) * u, y = c[1] + (t[1] - c[1]) * u;
      if (blocked(x, z, y, skip, 1)) return false; }
    return true;
  }
  // camera spot looking at building b from street level, Burj behind it if possible, sun behind camera
  function streetCam(b, yc, far) {
    let best = null;
    const sunH = new THREE.Vector2(SUN.x, SUN.z).normalize();
    for (const D0 of far ? [b.h * 1.6 + 60, b.h * 2.1 + 80, b.h * 2.7 + 100] : [b.h * 2.0 + 40, b.h * 2.6 + 60, b.h * 3.2 + 80]) for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, cx = b.x + Math.cos(a) * D0, cz = b.z + Math.sin(a) * D0;
      if (blocked(cx, cz, yc, null, 6)) continue;
      const tg = [b.x, Math.min(b.h * 0.6, yc + b.h * 0.4), b.z], c = [cx, yc, cz];
      if (!losClear(c, tg, b)) continue;
      const lx = (b.x - cx) / D0, lz = (b.z - cz) / D0, tl = Math.hypot(cx, cz) || 1;
      const align = lx * (-cx / tl) + lz * (-cz / tl);            // Burj behind the subject
      const lit = -(lx * sunH.x + lz * sunH.y);                     // sun behind the camera
      const s = 1.0 * align + 0.35 * lit - D0 / 400;
      if (!best || s > best.s) best = { s, c, tg, a, D0 };
    }
    return best;
  }
  function pickBuilding(sc, band, w0, w1, minH, used) {
    const tcs = W_.city.tcOf(sc), list = B();
    const cand = [];
    list.forEach((b, i) => {
      if (b.band !== band || b.h < minH || used.has(b)) return;
      const r = Math.hypot(b.x, b.z); if (r < 230 || r > 950) return;
      const tc = tcs[i], fails = tc >= w0 && tc <= w1;
      if (w1 > 0 && !fails) return;
      let n = 0; if (fails) list.forEach((o, j) => { if (tcs[j] >= w0 - 0.6 && tcs[j] <= w1 + 0.4 && Math.hypot(o.x - b.x, o.z - b.z) < 90) n++; });
      cand.push({ b, n: n + b.h / 20 - r / 600 });
    });
    cand.sort((p, q) => q.n - p.n);
    for (const { b } of cand.slice(0, 30)) { const cam = streetCam(b, sc._yc, band !== 'low'); if (cam) { used.add(b); return { b, cam }; } }
    return null;
  }

  // ---------- shots ----------
  // each: {type, t0, t1, p:[p0,p1], g:[g0,g1], fov (× base), views:[[t,v]], caps:[[t,text]]}
  const S = {
    aerial: (t0, t1, v = 'xray', caps) => ({ type: 'aerial', t0, t1, p: [[-1250, 640, 1150], [-1060, 560, 990]], g: [[0, 380, 0], [0, 360, 0]], fov: 1, views: [[t0, v]], caps }),
    spire: (t0, t1, tev, caps) => ({ type: 'spire', t0, t1, p: [[-185, 515, 345], [-150, 530, 360]], g: [[-10, 660, 0], [-15, 650, 0]], fov: 1, views: isFinite(tev) ? [[t0, 'stress'], [tev, 'normal']] : [[t0, 'xray']], caps }),
    base: (t0, t1, tev, caps) => ({ type: 'base', t0, t1, p: [[-215, 52, 430], [-180, 48, 400]], g: [[15, 125, 0], [20, 120, 0]], fov: 1, views: isFinite(tev) ? [[t0, 'stress'], [tev, 'normal']] : [[t0, 'stress']], caps }),
    side: (t0, t1, caps) => ({ type: 'side', t0, t1, p: [[30, 270, 1560], [80, 250, 1470]], g: [[60, 330, 0], [90, 300, 0]], fov: 1, views: [[t0, 'normal']], caps }),
    lake: (t0, t1, yc, caps, v = 'normal') => ({ type: 'lake', t0, t1, p: [[-120, yc, LAKE.cz + LAKE.rz * 0.9], [-70, yc, LAKE.cz + LAKE.rz * 0.84]], g: [[40, 150, 0], [50, 160, 0]], fov: 1.1, views: [[t0, v]], caps }),
    link: (t0, t1, caps) => ({ type: 'link', t0, t1, p: [[-250, 300, 270], [-215, 318, 245]], g: [[0, 330, 0], [0, 335, 0]], fov: 1, views: [[t0, 'stress']], caps }),
    wide: (t0, t1, caps) => ({ type: 'wide', t0, t1, p: [[-1100, 560, 1250], [-1300, 640, 1450]], g: [[40, 80, 0], [40, 100, 0]], fov: 1, views: [[t0, 'normal']], caps }),
    top: (t0, t1, caps) => ({ type: 'wide', t0, t1, p: [[-640, 1250, 860], [-720, 1380, 960]], g: [[60, 40, 0], [60, 40, 0]], fov: 1, views: [[t0, 'normal']], caps }),
    street: (t0, t1, pick, caps, type = 'street') => {
      const { b, cam } = pick, c0 = cam.c, a1 = cam.a + 0.09, d1 = cam.D0 * 0.94;
      const c1 = [b.x + Math.cos(a1) * d1, c0[1], b.z + Math.sin(a1) * d1];
      const ok1 = !blocked(c1[0], c1[2], c0[1], null, 6) && losClear(c1, cam.tg, b);
      return { type, t0, t1, p: [c0, ok1 ? c1 : c0.map((v, i) => (i === 1 ? v + 2 : v))], g: [cam.tg, [cam.tg[0], cam.tg[1] * 0.92, cam.tg[2]]], fov: 1, views: [[t0, 'normal']], caps, bld: b };
    },
  };

  // One continuous orbit around the tower (no cuts): the tower stays whole in frame, the camera circles it and slowly
  // rises from the base to the spire; view modes and captions follow the load on the structure.
  function buildPlan(sc) {
    const M = sc.M, end = sc.end, tS = sc.tSpire, tB = sc.tBreak, tI = sc.tImpact;
    const views = [], caps = [];
    let last = null;
    for (let t = 0; t <= end; t += 0.05) {
      let v;
      if (t < 2.2 && !(D.tour && D.tour.i > 0)) v = 'xray';
      else if (isFinite(tB) && t >= tB + 0.3) v = 'normal';
      else if (isFinite(tS) && t >= tS + 0.2 && t < tS + 1.6) v = 'normal';            // watch the spire go
      else if (M < 6.5) v = t > 5 && t < 9.5 ? 'stress' : 'normal';                      // show how little load there is
      else v = sc.stressMax(t) >= 0.45 ? 'stress' : 'normal';
      if (v !== last) { views.push([t, v]); last = v; }
    }
    if (D.tour && TOUR_CAP[M]) caps.push([0, TOUR_CAP[M]]);
    else { caps.push([0, CAP.core]); caps.push([2.4, CAP.burjT]); }
    if (M < 6.5) caps.push([5.2, CAP.baseOk], [9.8, CAP.wind]);
    else if (!isFinite(tS)) { caps.push([5.0, CAP.bend]); if (M >= 7.85) caps.push([8.0, CAP.fuse]); caps.push([11.5, CAP.baseOk]); }
    else {
      caps.push([Math.max(2.6, tS - 1.6), CAP.spireJ], [tS, CAP.spireF]);
      if (isFinite(tB)) caps.push([Math.max(tS + 1.4, tB - 2.0), CAP.bend], [tB, CAP.crush], [tB + 2.2, CAP.down], [tI + 1.0, CAP.rec]);
      else caps.push([tS + 2.0, CAP.spireSeis], [tS + 6.0, CAP.hypo]);
    }
    caps.sort((p, q) => p[0] - q[0]);
    return [{ type: 'orbit', t0: 0, t1: end, views, caps }];
  }
  function orbitPose(t, end) {
    const u = clamp(t / Math.max(end, 1));
    const yaw = -70 + 300 * (0.15 * u + 0.85 * sm(u));             // ~5/6 of a circle over the whole shake
    const pitch = 4 + 14 * sm(u);                                   // from near-ground toward a higher view
    const dist = 1450 + 150 * Math.sin(u * Math.PI);
    const ty = 330 + 60 * Math.sin(u * Math.PI * 0.9);
    const y = yaw * Math.PI / 180, pp = pitch * Math.PI / 180;
    return { p: [Math.sin(y) * Math.cos(pp) * dist, ty + Math.sin(pp) * dist, Math.cos(y) * Math.cos(pp) * dist], g: [0, ty, 0] };
  }

  // ---------- run ----------
  const Pv = new THREE.Vector3(), Tv = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function put(p, g, fovK) {
    Pv.set(...p); Tv.set(...g); let d = Pv.clone().sub(Tv), dist = d.length();
    const th = Math.tan(D.baseFov * fovK * Math.PI / 360), fwd = d.clone().multiplyScalar(-1 / dist);
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize(), up = new THREE.Vector3().crossVectors(right, fwd);
    Tv.addScaledVector(right, dist * th * camera.aspect * D.offX).addScaledVector(up, -dist * th * D.offY);
    d = Pv.clone().sub(Tv); dist = d.length();
    const o = { tx: Tv.x, ty: Tv.y, tz: Tv.z, dist, pitch: Math.asin(d.y / dist) * 180 / Math.PI, yaw: Math.atan2(d.x, d.z) * 180 / Math.PI };
    Object.assign(orbit.S, o); Object.assign(orbit.G, o);
    const f = D.baseFov * fovK; if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); }
  }
  function start() {
    if (D.mode !== 'director' || !app.sc) return;
    D.sc = app.sc; D.plan = buildPlan(app.sc); D.active = true; D.phase = 'plan'; D.aft = 0; D.viewLock = false; D.lastView = null; D.shotI = -1;
    D.baseFov = camera.aspect < 0.8 ? 58 : 42;
    orbit.setAuto(false); layout();
    if (window.__dirLog) console.log('director plan', D.plan.map((s) => `${s.type} ${s.t0.toFixed(2)}–${s.t1.toFixed(2)}`).join(' | '));
  }
  function stop(handBack = true) {
    if (!D.active) { capEl.style.opacity = 0; return; }
    D.active = false; D.phase = 'idle'; capEl.style.opacity = 0;
    const f = camera.aspect < 0.8 ? 58 : 42; camera.fov = f; camera.updateProjectionMatrix();
    if (handBack) orbit.setAuto(true);
  }
  function caption(shot, t, alphaOut = 1) {
    let txt = null, tc = shot.t0; for (const [ct, s] of shot.caps || []) if (t >= ct - 1e-6) { txt = s; tc = ct; }
    if (!txt) { capEl.style.opacity = 0; return; }
    const a = sm((t - tc - 0.15) / 0.35) * alphaOut;
    if (textEl.textContent !== txt) textEl.textContent = txt;
    const v = D.lastView && D.lastView !== 'normal' ? ` · ${D.lastView === 'xray' ? 'X-ray' : 'Stress'}` : '';
    const k = `${KICK[shot.type] || ''}${v}`; if (kickEl.textContent !== k) kickEl.textContent = k;
    capEl.style.opacity = a.toFixed(3); capEl.style.transform = `translateY(${((1 - sm((t - tc) / 0.4)) * 8).toFixed(1)}px)`;
  }
  function applyView(v) { if (D.viewLock || v === D.lastView) return; D.lastView = v; setView(v); }

  function tick(dt) {
    if (D.tour) {
      const tr = D.tour; tr.T = tr.i < 0 ? 0 : tr.T + dt;
      let k = 0, acc = 0; for (let j = 0; j < TOUR.length; j++) { if (tr.T >= acc - 1e-9) k = j; acc += TOUR[j].d; }
      if (tr.T >= tr.total) endTour();
      else if (k !== tr.i) {
        tr.i = k; D.switching = true;
        hooks.setMagnitude(TOUR[k].M); app.speed = TOUR[k].sp; hooks.shake();
        D.switching = false;
      }
    }
    if (!D.active) return;
    if (D.sc !== app.sc) { stop(); return; }
    const sc = D.sc, t = app.t;
    if (D.phase === 'plan') {
      if (!app.running && t >= sc.end - 1e-6) { D.phase = 'after'; D.aft = 0; }
      else {
        let i = 0; for (let k = 0; k < D.plan.length; k++) if (t >= D.plan[k].t0 - 1e-6) i = k;
        const s = D.plan[i]; D.shotI = i;
        if (s.type === 'orbit') { const o = D.tour ? orbitPose(D.tour.T, D.tour.total) : orbitPose(t, sc.end); put(o.p, o.g, 1); }
        else { const u = ease(clamp((t - s.t0) / (s.t1 - s.t0))); put(L3(s.p[0], s.p[1], u), L3(s.g[0], s.g[1], u), s.fov); }
        let v = s.views[0][1]; for (const [vt, vv] of s.views) if (t >= vt - 1e-6) v = vv; applyView(v);
        const next = D.plan[i + 1], fadeOut = next && next.caps && next.caps[0] && next.caps[0][1] !== (s.caps?.at(-1)?.[1]) ? 1 - sm((t - (s.t1 - 0.25)) / 0.25) : 1;
        caption(s, t, fadeOut);
        return;
      }
    }
    // aftermath: slow orbit from the last framing (yaw drift + gentle pull-back), then hand back
    D.aft += dt;
    if (D.aft < dt * 1.5) { applyView('normal'); D.af0 = { ...orbit.S }; }
    const u = D.aft / 6;
    const o = { yaw: D.af0.yaw + 18 * ease(clamp(u)), dist: D.af0.dist * (1 + 0.12 * ease(clamp(u))) };
    Object.assign(orbit.S, o); Object.assign(orbit.G, o);
    const last = D.plan[D.plan.length - 1]; if (last) caption({ ...last, caps: last.caps }, last.t1 - 0.01, 1 - sm(D.aft / 0.6));
    if (D.aft >= 6) stop(true);
  }

  layout(); addEventListener('resize', layout);
  return {
    tick, start, stop, setMode, layout,
    onShake() { stop(false); if (D.mode === 'director') start(); },
    onReset() { if (D.switching) return; if (D.tour) { D.tour = null; app.speed = 1; tourBtn.classList.remove('is-on'); } stop(true); },
    setHooks(h) { hooks = h; },
    startTour,
    onUserView() { if (D.active) D.viewLock = true; },
    get state() { return D; },
  };
}
