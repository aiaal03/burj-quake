// City-wide sun shadows: cascaded shadow maps (three r185 jsm/csm) with splits driven by the orbit distance,
// so the first cascade always wraps what the camera is looking at (crisp at street level) and the last one
// reaches the far edge of the 3.2 km city at aerial views. Falls back to one fitted shadow map (?csm=0).
//
// CSM patches lights_fragment_begin globally: every lit built-in material (MeshStandard/Physical/Lambert/Phong)
// MUST go through setupMaterial or it sums all cascade lights (N× sun). sync(scene) does that for every material
// it hasn't seen (cheap WeakSet check each frame) and chains any existing onBeforeCompile hook.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

const LIT = (m) => m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function makeShadows({ renderer, camera, sunDir, enabled = true, cascades = 3, size = 2048 }) {
  const S = { enabled, cascades, size, csm: null, scene: null, legacy: null, seen: new WeakSet(), mats: new Set(), D: 1000, lastKey: '' };
  const lightDir = sunDir.clone().normalize().negate();

  // split distances (fractions of maxFar) from the orbit distance D
  const splits = (n, near, far, out) => {
    const D = S.D, b = [];
    if (n === 2) b.push(clamp(D * 1.15, 150, 2600));
    else if (n === 3) { const b1 = clamp(D * 0.95, 120, 2400); b.push(b1, Math.min(b1 * 2.5, far * 0.75)); }
    else { const b1 = clamp(D * 0.55, 80, 1600), b2 = clamp(D * 1.15, b1 * 1.6, 2800); b.push(b1, b2, Math.min(b2 * 2.2, far * 0.8)); }
    for (const x of b) out.push(Math.min(0.98, x / far));
    out.push(1);
  };

  function setupMat(m) {
    if (!S.csm) return;
    if (!m.userData.__bqOBC) {
      m.userData.__bqOBC = m.onBeforeCompile;
      m.userData.__bqKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey : null;
    }
    const prev = m.userData.__bqOBC, prevKey = m.userData.__bqKey;
    S.csm.setupMaterial(m);
    const hook = m.onBeforeCompile;
    m.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); hook.call(this, sh, r); };
    // the wrapper's source is the same for every material → keep program keys distinct
    const k = prevKey ? prevKey.call(m) : prev.toString();
    m.customProgramCacheKey = () => k + '|csm';
    m.needsUpdate = true;
  }
  function unsetupMat(m) {
    if (!m.userData.__bqOBC) return;
    m.onBeforeCompile = m.userData.__bqOBC;
    if (m.userData.__bqKey) m.customProgramCacheKey = m.userData.__bqKey; else delete m.customProgramCacheKey;
    if (m.defines) { delete m.defines.USE_CSM; delete m.defines.CSM_CASCADES; delete m.defines.CSM_FADE; }
    m.needsUpdate = true;
  }

  function build(scene) {
    S.scene = scene;
    if (S.csm) { S.csm.remove(); for (const l of S.csm.lights) l.dispose?.(); S.csm.shaders.clear(); S.csm = null; }
    if (!S.enabled) {
      for (const m of S.mats) unsetupMat(m);
      if (!S.legacy) { const l = new THREE.DirectionalLight(0xffffff, 3); l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -0.0005; l.shadow.normalBias = 0.6; S.legacy = l; }
      scene.add(S.legacy, S.legacy.target);
      return;
    }
    if (S.legacy) { scene.remove(S.legacy, S.legacy.target); }
    S.csm = new CSM({ camera, parent: scene, cascades: S.cascades, maxFar: 5000, mode: 'custom', customSplitsCallback: splits, shadowMapSize: S.size,
      lightDirection: lightDir, lightIntensity: 5, lightNear: 1, lightFar: 12000, lightMargin: 2000, shadowBias: -0.00002 });
    S.csm.fade = true;
    // keep CSM lights first in the light list (three sorts shadow casters first anyway)
    for (const m of S.mats) setupMat(m);
    S.lastKey = '';
  }

  // set up all lit materials in the scene that we have not seen yet
  function sync(scene) {
    scene.traverse((o) => {
      const mm = o.material; if (!mm) return;
      const arr = Array.isArray(mm) ? mm : [mm];
      for (const m of arr) if (LIT(m) && !S.seen.has(m)) { S.seen.add(m); S.mats.add(m); if (S.csm) setupMat(m); }
    });
  }

  // per frame: fit cascades around the orbit (D = orbit distance, focus = orbit target), set sun colour/intensity
  function update({ D, focus, color, intensity }) {
    if (S.csm) {
      S.D = D;
      const far = Math.min(7000, D + 3600), key = `${Math.round(Math.log(D) * 40)}|${Math.round(far / 50)}|${camera.near}|${camera.fov}|${camera.aspect.toFixed(3)}`;
      if (key !== S.lastKey) { S.csm.maxFar = far; S.csm.updateFrustums(); S.lastKey = key; fitBias(); }
      S.csm.update();
      for (const l of S.csm.lights) { l.color.set(color); l.intensity = intensity; }
    } else if (S.legacy) {
      const l = S.legacy, rad = Math.min(1800, Math.max(400, D * 0.9));
      l.position.copy(focus).addScaledVector(sunDir, rad * 3); l.target.position.copy(focus);
      Object.assign(l.shadow.camera, { left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: rad * 6 }); l.shadow.camera.updateProjectionMatrix();
      l.color.set(color); l.intensity = intensity;
    }
  }
  // normalBias in world metres ∝ cascade texel size (the 828 m tower + flat-roofed blocks: ~1.5 texels)
  function fitBias() {
    for (const l of S.csm.lights) {
      const c = l.shadow.camera, texel = (c.right - c.left) / S.size;
      l.shadow.normalBias = clamp(texel * 1.6, 0.08, 3.0); l.shadow.bias = -0.00002; l.shadow.radius = 2;
      l.shadow.mapSize.set(S.size, S.size);
    }
  }

  return {
    S, sync, update,
    attach(scene) { build(scene); sync(scene); },
    setCascades(n) { if (n === S.cascades && S.csm) return; S.cascades = n; if (S.scene) build(S.scene); },
    setEnabled(on) { if (on === S.enabled) return; S.enabled = on; if (S.scene) build(S.scene); },
    refresh() { if (S.scene) sync(S.scene); for (const m of S.mats) m.needsUpdate = true; },
    info() { return S.csm ? { cascades: S.cascades, size: S.size, breaks: S.csm.breaks.map((b) => Math.round(b * S.csm.maxFar)), maxFar: S.csm.maxFar } : { legacy: true }; },
  };
}
