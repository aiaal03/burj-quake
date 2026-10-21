// Assembles the Dubai set + Burj + FX into one scene; world(F) poses everything for F.t.
import * as THREE from 'three';
import * as Q from './quake.js';
import { makeTower } from './tower.js';
import { SUN, makeSky, makeEnv, makeLake, makeGround, makeCity, makeCars, makePalmsLamps, makeRift, RIFT, inLake, fnOf, riftT } from './world.js';
import { makeDust, makeBits } from './fx.js';

export const W_ = {};
const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const DUSTC = ['#ffffff', '#f6eee4', '#ece7e2', '#fff4e6', '#e4ddd6', '#f2e6d6'];   // tints around white; light colours live in fx.js

export async function setup(K) {
  const R = K.R.renderer;
  // quality: 'high' (offline film renders, default) | 'realtime' (interactive app: smaller ground grid, fewer cars/FX, smaller lake RT)
  const quality = K.quality || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('quality')) || 'high', opts = { quality }, RT_ = quality === 'realtime';
  const scene = new THREE.Scene();
  const sky = makeSky(); scene.add(sky.mesh);
  const env0 = makeEnv(R, 0), env1 = makeEnv(R, 0.55);
  const groundM = makeGround(K, opts); scene.add(groundM.mesh, groundM.far);
  const lake = makeLake(R, opts); scene.add(lake.mesh); lake.hide.push(groundM.mesh);
  const city = makeCity(K, opts); scene.add(city.group);
  const cars = makeCars(opts); scene.add(cars.group);
  const pl = makePalmsLamps(); scene.add(pl.group);
  const rift = makeRift(); scene.add(rift.mesh);
  const tower = makeTower(Q.FILM); scene.add(tower.root);
  scene.fog = new THREE.FogExp2('#d9b48a', 0.00009);
  const noDust = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nodust') === '1';   // QA: inspect the structure under the dust
  Object.assign(W_, { scene, sky, env0, env1, groundM, lake, city, cars, pl, rift, tower, quality, noDust, fxK: RT_ ? 0.45 : 1, dustThin: RT_ ? 2 : 1 });
  const T0 = performance.now();
  const L = buildFx(Q.FILM);
  const shardMat = new THREE.MeshStandardMaterial({ color: '#dfe6ee', metalness: 1, roughness: 0.025, side: THREE.DoubleSide, envMapIntensity: 1.8 });
  const gY = (x, z, t) => (W_.fxSc || Q.FILM).ground(x, z, t, GO).y;
  const shardB = makeBits(new THREE.PlaneGeometry(1, 1), shardMat, L.shards, gY, Math.ceil(L.shards.length * 1.4)); shardB.mesh.castShadow = false; scene.add(shardB.mesh);
  const debMat = new THREE.MeshStandardMaterial({ color: '#a39887', roughness: 0.92 });
  const debB = makeBits(new THREE.BoxGeometry(1, 1, 1), debMat, L.deb, gY, Math.ceil(L.deb.length * 1.6)); scene.add(debB.mesh);
  const dustM = makeDust(K, L.dust, Math.ceil(L.dust.length * 1.5)); scene.add(dustM.mesh);
  Object.assign(W_, { shardB, debB, dustM, impactCenter: L.ic, fxSc: Q.FILM, rebuildFx });
  console.log('dubai:', quality, 'buildings', city.B.length, 'shards', L.shards.length, 'debris', L.deb.length, 'dust', L.dust.length, 'fx ms', (performance.now() - T0).toFixed(0));
}
const GO = {};

// Rebuild dust / shard / debris lists for a scenario (only for events that happen). Reuses the GPU buffers.
export function rebuildFx(sc) {
  sc = sc || Q.FILM;
  const T0 = performance.now(), L = buildFx(sc);
  W_.shardB.set(L.shards); W_.debB.set(L.deb); W_.dustM.set(L.dust); W_.impactCenter = L.ic; W_.fxSc = sc;
  W_.tower.pose(0, sc);
  return { ms: performance.now() - T0, shards: L.shards.length, debris: L.deb.length, dust: L.dust.length };
}

// all FX particles for scenario sc, deterministic (seeded); times are scenario times
function buildFx(sc) {
  const { tower, city } = W_, fxK = W_.fxK, film = sc === Q.FILM;
  const r = rng(42), G = {}, gY = (x, z, t) => sc.ground(x, z, t, G).y;
  const tS = sc.tSpire, tB = sc.tBreak, tI = sc.tImpact, end = sc.end || 38;
  const M = film ? 10 : sc.M;
  // ---------- glass shards: spawn times follow the façade damage curve sc.damage(t) ----------
  const shards = [], V = new THREE.Vector3(), N = new THREE.Vector3(), V2 = new THREE.Vector3();
  const spawnShard = (ts, y) => {
    if (ts >= tS && y >= 600) y = 60 + (y - 60) * 0.9 * 540 / 740;   // no spire left
    const fp = tower.facadePoint(y, r(), r()), i = tower.segIndex(y);
    const st = tower.pose(ts, sc); const sw = st.segWorld[i]; const p0 = V.set(fp.p[0], y - tower.segs[i].s0, fp.p[2]).applyQuaternion(sw.q).add(sw.p).clone();
    const st2 = tower.pose(ts + 0.05, sc); const sw2 = st2.segWorld[i]; const p1 = V2.set(fp.p[0], y - tower.segs[i].s0, fp.p[2]).applyQuaternion(sw2.q).add(sw2.p);
    if (!tower.segs[i].g.visible) return;
    const vel = p1.clone().sub(p0).multiplyScalar(20);
    N.set(...fp.n).applyQuaternion(sw.q); const out = 2 + r() * 7;
    shards.push({ t0: ts, p: [p0.x, p0.y, p0.z], v: [vel.x + N.x * out + (r() - 0.5) * 3, vel.y + 1 + r() * 3, vel.z + N.z * out + (r() - 0.5) * 3], ax: [r() - 0.5, r() - 0.5, r() - 0.5],
      w: 4 + r() * 10, sx: 0.5 + r() * 0.9, sy: 0.7 + r() * 1.2, sz: 1, r0: [r() * 6, r() * 6, r() * 6], vt: 9 + r() * 10, drag: 0.35 + r() * 0.3, life: 60 });
  };
  { const NS = 160, dt = end / NS, D = []; for (let i = 0; i <= NS; i++) D.push(Math.max(0, sc.damage(i * dt)));
    for (let i = 1; i <= NS; i++) D[i] = Math.max(D[i], D[i - 1]);
    const dmax = D[NS], n = Math.round(4300 * fxK * Math.min(1, dmax / 0.82));
    for (let k = 0; k < n; k++) { const u = r() * dmax; let i = 1; while (i < NS && D[i] < u) i++;
      const ts = (i - 1 + (u - D[i - 1]) / Math.max(1e-6, D[i] - D[i - 1])) * dt;
      spawnShard(ts, ts > tB ? 40 + r() * 540 : 60 + r() * 560); } }
  // ---------- concrete debris (structural falls run at the 4× time scale → gravity ×16 after the spire fails) ----------
  const deb = [];
  const addDeb = (ts, p, spd, up, sz) => { const fast = ts >= tS; deb.push({ t0: ts, p, v: [(r() - 0.5) * spd, up * (0.3 + r()), (r() - 0.5) * spd], ax: [r() - 0.5, r() - 0.5, r() - 0.5], w: 1 + r() * 3,
    sx: sz * (0.5 + r()), sy: sz * (0.4 + r() * 0.8), sz: sz * (0.5 + r()), r0: [r() * 6, r() * 6, r() * 6], vt: fast ? 160 : 40, drag: 0.15, life: 60, g: fast ? 9.81 * 16 : 9.81 }); };
  // ---------- dust ----------
  const dust = []; let pk = 0; const thin = W_.dustThin;
  const puff = (t0, p, v, life, s0, s1, a, rise, drag = 0.6) => ((pk++ % thin) ? 0 : dust.push({ t0, p, v, life, s0, s1, a, rise, drag, rot: r() * 6.28, spin: r(), col: DUSTC[r() * DUSTC.length | 0] }));
  const randCity = () => { for (;;) { const a = r() * 6.28, d = 150 + Math.pow(r(), 0.7) * 1300, x = Math.cos(a) * d, z = Math.sin(a) * d; if (!inLake(x, z, 10)) return [x, z]; } };
  const amb = (a, b, n, al) => { for (let i = 0; i < n; i++) { const [x, z] = randCity(), ts = a + r() * (b - a);
    puff(ts, [x, gY(x, z, ts) + 3, z], [(r() - 0.5) * 6, 2, (r() - 0.5) * 6], 6 + r() * 3, 25 + r() * 15, 90 + r() * 70, al * 0.55 * (0.6 + r() * 0.6), 1.5 + r() * 2); } };
  if (film) for (const w of [[12.2, 17.4, 260, 0.22], [17.4, 23, 420, 0.3], [23, 29, 800, 0.36], [29, 36, 900, 0.42]]) amb(...w);
  else { const k = Math.max(0, Math.min(1, (M - 6) / 4)); if (k > 0) amb(1.0, (sc.dur || 12) + 2, Math.round(2400 * k * k), 0.2 + 0.2 * k); }
  // building collapses (this scenario's fail times): ground skirt + slower column
  const tcs = city.tcOf(film ? null : sc);
  city.B.forEach((bd, bi) => {
    const tc = tcs[bi]; if (!(tc < end)) return;
    const big = bd.hero && film ? 2.2 : 1, n = Math.round(Math.min(30, 5 + bd.h / 6) * big);
    for (let i = 0; i < n; i++) { const ts = tc + 0.15 + Math.pow(r(), 1.4) * bd.dur * 1.1, a = r() * 6.28, rr = Math.max(bd.w, bd.d) * 0.5 * (0.4 + r() * 0.6);
      const x = bd.x + Math.cos(a) * rr, z = bd.z + Math.sin(a) * rr, col = r() < 0.35;
      const hh = col ? bd.h * (0.2 + 0.6 * r()) * Math.max(0, 1 - (ts - tc) / bd.dur) : r() * 4;
      const sp = col ? 2 + r() * 4 : 8 + r() * 14;
      puff(ts, [x, gY(x, z, ts) + 3 + hh, z], [Math.cos(a) * sp, col ? 2 + r() * 4 : 0.5 + r() * 1.5, Math.sin(a) * sp], 7 + r() * 5, bd.w * 0.35 + 4,
        (bd.w * 0.8 + bd.h * 0.45 + 18) * (col ? 1.0 : 1.25) * (0.7 + r() * 0.5), (col ? 0.42 : 0.55) + r() * 0.25, col ? 1.2 + r() * 1.8 : 0.4 + r() * 0.8, 0.55); }
  });
  // rift
  const tR = riftT(sc);
  if (tR != null) for (let i = 0; i < 380; i++) { const k = 0.42 + (r() - 0.5) * 1.1; if (k < 0 || k > 1) continue; const pi = Math.round(k * (RIFT.length - 1)); const [x, z] = RIFT[pi];
    const ts = tR + Math.abs(k - 0.42) / 0.6 * 1.6 * (0.8 + r() * 0.4); puff(ts, [x + (r() - 0.5) * 20, gY(x, z, ts) + 2, z + (r() - 0.5) * 20], [(r() - 0.5) * 8, 6 + r() * 6, (r() - 0.5) * 8], 7 + r() * 3, 15, 70 + r() * 50, 0.55, 3); }
  // spire: break at the 600 m joint + landing burst
  if (isFinite(tS)) {
    const h = tower.pose(tS, sc).spireHinge.clone();
    for (let i = 0; i < 60; i++) addDeb(tS + r() * 0.3, [h.x, h.y, h.z], 22, 8, 1.5);
    for (let i = 0; i < 50; i++) puff(tS + r() * 0.6, [h.x + (r() - 0.5) * 8, h.y + (r() - 0.5) * 8, h.z + (r() - 0.5) * 8], [(r() - 0.5) * 25, (r() - 0.3) * 10, (r() - 0.5) * 25], 4 + r() * 2, 4, 25 + r() * 20, 0.5, 0.5);
    tower.pose(tS + 3, sc); const sl = tower.state.spireLand;
    if (sl && sl.p && isFinite(sl.t)) { const p = sl.p;
      for (let i = 0; i < 90; i++) addDeb(sl.t + r() * 0.3, [p.x + (r() - 0.5) * 30, Math.max(gY(p.x, p.z, sl.t), 0) + 2 + r() * 6, p.z + (r() - 0.5) * 30], 40, 18, 1 + r() * 2);
      for (let i = 0; i < 160; i++) { const a = r() * 6.28, sp = 20 + r() * 40, x = p.x + (r() - 0.5) * 60, z = p.z + (r() - 0.5) * 60;
        puff(sl.t + r() * 0.5, [x, gY(x, z, sl.t) + 4 + r() * 10, z], [Math.cos(a) * sp, 3 + r() * 6, Math.sin(a) * sp], 8 + r() * 3, 15, 70 + r() * 50, 0.6, 2.5, 0.45); } }
  }
  // base collapse: crush front at the base (continuous dust + ejecta while the body telescopes into the pile), crown
  // fracture at 450 m, crown landing on the pile, radial dust surge from the mound
  let ic = new THREE.Vector3(60, 0, 0);
  if (isFinite(tB)) {
    const NT = 24, fr = [];
    for (let k = 0; k <= NT; k++) { const ts = tB + (tI - tB) * k / NT, st = tower.pose(ts, sc); fr.push({ t: ts, p: st.crushFront.clone(), h: st.rubble.h, r: st.rubble.r, x: st.rubble.x, z: st.rubble.z }); }
    const frAt = (ts) => fr[Math.min(NT, Math.max(0, Math.round((ts - tB) / (tI - tB) * NT)))];
    // first crush: compression-side walls burst at the base
    const h0 = fr[0].p;
    for (let i = 0; i < 140; i++) puff(tB + r() * 0.6, [h0.x + 20 + (r() - 0.3) * 40, 6 + r() * 25, h0.z + (r() - 0.5) * 60], [(r() - 0.2) * 50, 2 + r() * 8, (r() - 0.5) * 50], 6 + r() * 3, 12, 60 + r() * 40, 0.6, 1.5, 0.7);
    for (let i = 0; i < 1100 * fxK; i++) {      // ejecta from the crush front: chunks thrown outward over the pile
      const ts = tB + Math.pow(r(), 0.8) * (tI - tB + 0.3), f = frAt(ts), a = r() * 6.28, rr = 25 + r() * 30;
      addDeb(ts, [f.x + Math.cos(a) * rr, f.h + 3 + r() * 20, f.z + Math.sin(a) * rr], 60, 14, 1.5 + r() * 4);
    }
    for (let i = 0; i < 1300; i++) {            // dust: jets at the crush front + a skirt rolling off the growing mound
      const ts = tB + r() * (tI - tB + 0.8), f = frAt(Math.min(ts, tI)), a = r() * 6.28;
      if (r() < 0.55) { const rr = 20 + r() * 35; puff(ts, [f.x + Math.cos(a) * rr, f.h + 4 + r() * 30, f.z + Math.sin(a) * rr], [Math.cos(a) * (15 + r() * 30), 4 + r() * 10, Math.sin(a) * (15 + r() * 30)], 7 + r() * 3, 18, 80 + r() * 70, 0.62, 3, 0.5); }
      else { const rr = f.r * (0.7 + r() * 0.35), x = f.x + Math.cos(a) * rr, z = f.z + Math.sin(a) * rr; puff(ts, [x, gY(x, z, ts) + 5, z], [Math.cos(a) * (25 + r() * 35), 2 + r() * 3, Math.sin(a) * (25 + r() * 35)], 8 + r() * 3, 25, 100 + r() * 60, 0.55, 2, 0.4); }
    }
    // crown fracture (separation at U_SEP) and crown landing on the pile
    const tSep = tB + Q.U_SEP;
    if (tSep < tI) { const k = tower.pose(tSep, sc).kink.clone();
      for (let i = 0; i < 120 * fxK + 40; i++) addDeb(tSep + r() * 0.4, [k.x - r() * 40, k.y + (r() - 0.5) * 10, k.z + (r() - 0.5) * 40], 35, 8, 2 + r() * 4);
      for (let i = 0; i < 90; i++) puff(tSep + r() * 0.5, [k.x - r() * 40, k.y + (r() - 0.5) * 10, k.z + (r() - 0.5) * 40], [(r() - 0.5) * 30, -6 - r() * 10, (r() - 0.5) * 30], 2.5 + r() * 1.5, 10, 40 + r() * 25, 0.5, 0, 0.6); }
    const impactPts = [];
    { const st = tower.pose(tI, sc); for (let i = 0; i < tower.segs.length; i++) { const sg = tower.segs[i]; if (sg.s0 >= Q.Y_JOINT - 150 && sg.s0 < Q.Y_JOINT) impactPts.push(st.segWorld[i].p.clone()); }
      impactPts.push(st.crushFront.clone()); }
    for (let i = 0; i < 600 * fxK; i++) { const p = impactPts[r() * impactPts.length | 0]; addDeb(tI + r() * 0.5, [p.x + (r() - 0.5) * 40, Math.max(p.y, 5) + r() * 20, p.z + (r() - 0.5) * 40], 70, 30, 2 + r() * 5); }
    for (let i = 0; i < 700; i++) { const p = impactPts[r() * impactPts.length | 0]; const ts = tI + r() * 0.6;
      puff(ts, [p.x + (r() - 0.5) * 50, Math.max(4, p.y * 0.6) + r() * 20, p.z + (r() - 0.5) * 50], [(r() - 0.5) * 70, 10 + r() * 25, (r() - 0.5) * 70], 9 + r() * 4, 25, 150 + r() * 120, 0.7, 4, 0.5); }
    ic = impactPts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / impactPts.length);
    const fe = fr[NT];       // final radial surge from the mound edge
    for (let i = 0; i < 800; i++) { const a = r() * 6.28, ts = tI + 0.1 + r() * 0.7, sp = 60 + r() * 80; const x = fe.x + Math.cos(a) * fe.r * 0.8, z = fe.z + Math.sin(a) * fe.r * 0.8;
      puff(ts, [x, gY(x, z, ts) + 8 + r() * 20, z], [Math.cos(a) * sp, 2 + r() * 6, Math.sin(a) * sp], 9 + r() * 3, 30, 120 + r() * 90, 0.65, 3, 0.35); }
  }
  return { shards, deb, dust, ic };
}

const FOGC = new THREE.Color('#d9b48a'), FOGD = new THREE.Color('#b8987a');
// pose the world at time t (sample time). returns world state
// pose the world at time t. sc = scenario (quake.js makeScenario(M) or FILM); default F.scenario ?? W_.scenario ?? FILM.
// The app calls world({ t }, sc) every frame (1 sample). Switching scenario rebuilds the FX lists once (rebuildFx).
export function world(F, sc) {
  sc = sc ?? F.scenario ?? W_.scenario ?? Q.FILM;
  const st = updateWorld(F.t, sc);
  F.scene = W_.scene;
  F.env = st.dz > 0.3 ? W_.env1 : W_.env0;
  F.light = st.light;
  return st.tower;
}
export function updateWorld(t, sc = Q.FILM) {
  const W = W_; sc = sc || Q.FILM;
  if (sc !== W.fxSc) rebuildFx(sc);
  const st = W.tower.pose(t, sc);   // also sets uDmg / stress profile uniforms from sc
  const wsc = sc === Q.FILM ? null : sc;
  W.groundM.update(t, wsc); W.city.update(t, wsc); W.cars.update(t, wsc); W.pl.update(t, wsc); W.rift.update(t, wsc);
  W.shardB.update(t); W.debB.update(t);
  if (W.noDust) W.dustM.mesh.visible = false;
  const dz = dustLevel(sc, t);
  W.sky.U.uDust.value = dz * 0.85; W.sky.U.uSunI.value = 1 - dz * 0.5;
  W.scene.fog.color.copy(FOGC).lerp(FOGD, dz); W.scene.fog.density = 0.00009 + dz * 0.00024;
  W.dustM.U.uTime.value = t; W.dustM.U.uSun.value.copy(SUN);
  W.dustM.U.fogColor.value.copy(W.scene.fog.color); W.dustM.U.fogDensity.value = W.scene.fog.density;
  const A = sc.amp(t);
  W.lake.U.uTime.value = t; W.lake.U.uRip.value = Math.min(0.9, A * 3.0); W.lake.U.uSlosh.value = Math.min(1.6, Math.max(0, A - 0.4) * 0.35);
  W.lake.mesh.position.y = 0.4 + sc.ground(LAKEC[0], LAKEC[1], t, GO).y * 0.7;
  // one golden-hour light for the whole film (sun 12° WSW); dust only dims it, never changes its colour/direction
  const light = { key: { dir: [SUN.x, SUN.y, SUN.z], col: '#ffc387', intensity: 5.4 * (1 - dz * 0.45), soft: 0.01 },
    sky: { col: '#9fb8dc', intensity: 0.30 + dz * 0.2, up: [0, 1, 0], spread: 1 }, hemi: { sky: '#a0b4d4', ground: '#9c7b5a', intensity: 0.2 + dz * 0.16 }, env: 0.55 };
  return { tower: st, dz, light, A };
}
// haze level 0..1: film timeline, or from the scenario (shaking strength × time + overturning)
export function dustLevel(sc, t) {
  if (typeof sc.dustLevel === 'function') return sc.dustLevel(t);
  if (sc === Q.FILM) return Q.sm(Q.ramp(t, 20, 30)) * 0.35 + Q.sm(Q.ramp(t, 30.8, 37)) * 0.45;
  const k = Math.max(0, Math.min(1, (sc.M - 6.5) / 3));
  return 0.35 * k * Q.sm(Q.ramp(t, 1, (sc.dur || 12) + 2)) + (isFinite(sc.tBreak) ? 0.45 * Q.sm(Q.ramp(t, sc.tBreak, sc.tBreak + 6)) : 0);
}
const LAKEC = [-60, 330];
export { Q };
