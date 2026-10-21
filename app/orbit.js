// Minimal orbit camera: drag = rotate, wheel / pinch = zoom, two-finger drag / right-drag = pan (height only). Damped.
import * as THREE from 'three';
export function makeOrbit(camera, el, { target = [0, 330, 0], dist = 1500, yaw = -40, pitch = 12, min = 120, max = 4200 } = {}) {
  const S = { yaw, pitch, dist, ty: target[1], tx: target[0], tz: target[2] };
  const G = { ...S };            // goal (damped toward)
  const ptrs = new Map(); let pinch0 = 0, dist0 = 0, last = null, auto = true, idle = 0;
  const clampP = (p) => Math.max(-4, Math.min(85, p));
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY, e.button]); auto = false; idle = 0;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = G.dist; } last = [e.clientX, e.clientY]; });
  el.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return; const p = ptrs.get(e.pointerId); const dx = e.clientX - p[0], dy = e.clientY - p[1]; p[0] = e.clientX; p[1] = e.clientY;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) G.dist = Math.max(min, Math.min(max, dist0 * pinch0 / d)); G.ty = Math.max(20, Math.min(820, G.ty + dy * G.dist / 1500)); return; }
    if (p[2] === 2) { G.ty = Math.max(20, Math.min(820, G.ty + dy * G.dist / 900)); return; }
    G.yaw -= dx * 0.25; G.pitch = clampP(G.pitch + dy * 0.2);
  });
  const up = (e) => { ptrs.delete(e.pointerId); pinch0 = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => { e.preventDefault(); auto = false; idle = 0; G.dist = Math.max(min, Math.min(max, G.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  const T = new THREE.Vector3();
  return {
    S, G,
    setAuto(v) { auto = v; },
    goTo(o) { Object.assign(G, o); },
    update(dt) {
      idle += dt; if (idle > 12) auto = true;
      if (auto) G.yaw += dt * 2.2;
      const k = 1 - Math.exp(-dt * 6);
      for (const n of ['yaw', 'pitch', 'dist', 'ty', 'tx', 'tz']) S[n] += (G[n] - S[n]) * (n === 'dist' ? k * 0.8 : k);
      const y = S.yaw * Math.PI / 180, p = S.pitch * Math.PI / 180;
      T.set(S.tx, S.ty, S.tz);
      camera.position.set(T.x + S.dist * Math.sin(y) * Math.cos(p), Math.max(2, T.y + S.dist * Math.sin(p)), T.z + S.dist * Math.cos(y) * Math.cos(p));
      camera.lookAt(T);
      return T;
    },
  };
}
