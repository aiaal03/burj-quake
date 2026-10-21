// FX: GPU dust puffs (pure function of uTime), CPU glass shards + concrete debris (ballistic). Deterministic lists built at setup.
import * as THREE from 'three';

const DUST_VS = /* glsl */`
attribute vec3 aP0; attribute vec3 aV; attribute vec4 aT; attribute vec4 aC; attribute vec4 aR;
uniform float uTime; uniform vec3 uSun;
varying vec2 vUv; varying float vA; varying vec3 vCol; varying vec2 vSun; varying float vFogDepth;
void main(){
  float age = uTime - aT.x;
  if (age < 0.0 || age > aT.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
  float k = aR.y; vec3 p = aP0 + aV * (1.0 - exp(-k * age)) / k + vec3(0.0, aR.z * age, 0.0);
  float u = age / aT.y; float sz = mix(aT.z, aT.w, 1.0 - exp(-3.0 * u));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float a = aR.x + age * 0.08 * (aR.w - 0.5);
  float ca = cos(a), sa = sin(a);
  vec2 c = position.xy; c = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca);
  vec3 w = p + (right * c.x + up * c.y) * sz;
  vUv = uv;
  vec2 ss = vec2(dot(uSun, right), dot(uSun, up)); vSun = vec2(ss.x * ca + ss.y * sa, -ss.x * sa + ss.y * ca);
  vA = aC.a * smoothstep(0.0, 0.07, u) * (1.0 - smoothstep(0.5, 1.0, u));
  vCol = aC.rgb;
  vec4 mv = viewMatrix * vec4(w, 1.0); vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FS = /* glsl */`
uniform sampler2D tPuff; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 fogColor; uniform float fogDensity;
varying vec2 vUv; varying float vA; varying vec3 vCol; varying vec2 vSun; varying float vFogDepth;
void main(){
  if (vA <= 0.001) discard;
  vec4 tx = texture2D(tPuff, vUv);
  float al = tx.a * vA; if (al < 0.003) discard;
  vec2 q = vUv * 2.0 - 1.0;
  // fake volumetric shading: sun-facing side of the billow lit warm, core and underside cool; tx.g = billow "normal" detail
  vec2 sd = normalize(vSun + 1e-4);
  float side = dot(q, sd) * min(length(vSun) * 1.3, 1.0);
  float lit = clamp(0.42 + 0.62 * side + 0.55 * (tx.g - 0.5) + 0.12 * q.y, 0.0, 1.0);
  lit = lit * lit * (3.0 - 2.0 * lit);
  vec3 LIT = vec3(0.91, 0.78, 0.60) * 1.45, SHD = vec3(0.54, 0.50, 0.44) * 0.62;   // #E8C79A / #8A8070
  vec3 c = mix(SHD, LIT, lit) * vCol;
  c += vec3(1.0, 0.72, 0.45) * pow(clamp(1.0 - tx.a * 1.4, 0.0, 1.0), 3.0) * max(side, 0.0) * 0.35;  // silver lining at thin edges
  float f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  c = mix(c, fogColor, f);
  gl_FragColor = vec4(c, al);
}`;

function puffTex(K) {
  // billowy cauliflower puff: many sub-blobs (alpha) + a pseudo-normal shading channel (g = lit from upper-left blob edges)
  return K.canvasTex(256, 256, (c, w, h) => {
    let s = 3; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const A = new Float32Array(w * h), Lt = new Float32Array(w * h);
    for (let i = 0; i < 140; i++) {
      const a = R() * 6.28, r = Math.pow(R(), 0.6) * 78, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r, rr = (14 + R() * 34) * (1 - r / 140);
      const x0 = Math.max(0, x - rr | 0), x1 = Math.min(w - 1, x + rr | 0), y0 = Math.max(0, y - rr | 0), y1 = Math.min(h - 1, y + rr | 0);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx - x) / rr, dy = (yy - y) / rr, d2 = dx * dx + dy * dy; if (d2 >= 1) continue;
        const k = (1 - d2) * (1 - d2), j = yy * w + xx;
        A[j] += k * 0.22; Lt[j] += k * 0.22 * (0.5 + 0.5 * (-dx * 0.7 - dy * 0.7) / Math.max(Math.sqrt(d2), 0.3));
      }
    }
    const id = c.createImageData(w, h), d = id.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = y * w + x, rad = Math.hypot(x - 128, y - 128) / 128, fall = Math.max(0, 1 - Math.pow(rad, 2.2));
      const a = Math.min(1, A[j]) * fall, l = A[j] > 1e-4 ? Lt[j] / A[j] : 0.5;
      d[j * 4] = 200; d[j * 4 + 1] = Math.max(0, Math.min(255, l * 255)) | 0; d[j * 4 + 2] = 200; d[j * 4 + 3] = Math.min(255, a * 255) | 0;
    }
    c.putImageData(id, 0, 0);
  }, { srgb: false });
}

// GPU dust: fixed-capacity instanced buffers; set(list) rewrites them in place (scenario rebuilds reuse the GPU buffers)
export function makeDust(K, list, cap = list.length) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  cap = Math.max(cap, list.length, 1);
  const P0 = new Float32Array(cap * 3), V = new Float32Array(cap * 3), TT = new Float32Array(cap * 4), C = new Float32Array(cap * 4), RR = new Float32Array(cap * 4);
  const A = { aP0: [P0, 3], aV: [V, 3], aT: [TT, 4], aC: [C, 4], aR: [RR, 4] };
  for (const k in A) { const at = new THREE.InstancedBufferAttribute(A[k][0], A[k][1]); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, at); }
  const c = new THREE.Color();
  function set(L) {
    const n = Math.min(L.length, cap);
    for (let i = 0; i < n; i++) {
      const d = L[i];
      P0[i * 3] = d.p[0]; P0[i * 3 + 1] = d.p[1]; P0[i * 3 + 2] = d.p[2]; V[i * 3] = d.v[0]; V[i * 3 + 1] = d.v[1]; V[i * 3 + 2] = d.v[2];
      TT[i * 4] = d.t0; TT[i * 4 + 1] = d.life; TT[i * 4 + 2] = d.s0; TT[i * 4 + 3] = d.s1;
      c.set(d.col); C[i * 4] = c.r; C[i * 4 + 1] = c.g; C[i * 4 + 2] = c.b; C[i * 4 + 3] = d.a;
      RR[i * 4] = d.rot; RR[i * 4 + 1] = d.drag; RR[i * 4 + 2] = d.rise; RR[i * 4 + 3] = d.spin;
    }
    for (const k in A) { const at = g.attributes[k]; at.clearUpdateRanges?.(); at.needsUpdate = true; }
    g.instanceCount = n;
    if (n < L.length) console.warn('dust: capacity', cap, 'list', L.length);
  }
  set(list);
  const U = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() }, tPuff: { value: puffTex(K) }, uSunCol: { value: new THREE.Color(1.15, 0.95, 0.75) }, uAmb: { value: new THREE.Color(0.5, 0.48, 0.5) },
    fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } };
  const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, U, set, cap };
}

// ballistic instanced rigid bits. items: {t0, p:[x,y,z], v:[x,y,z], ax:[x,y,z], w (rad/s), sx, sy, sz, vt (terminal), drag, g? (gravity,
// default 9.81; collapse debris uses 9.81·16 to match the 4× structural time scale)}. set(items) swaps the list (capacity fixed).
export function makeBits(geo, mat, items, groundY, cap = items.length) {
  cap = Math.max(cap, items.length, 1);
  const im = new THREE.InstancedMesh(geo, mat, cap); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), AX = new THREE.Vector3(), Z = new THREE.Matrix4().makeScale(0, 0, 0), E = new THREE.Euler();
  let L = [];
  function set(list) {
    L = list.length > cap ? list.slice(0, cap) : list;
    L.forEach((b) => { AX.set(...b.ax).normalize(); b.axv = AX.clone(); b.q0 = new THREE.Quaternion().setFromEuler(E.set(b.r0[0], b.r0[1], b.r0[2])); });
    for (let i = L.length; i < cap; i++) im.setMatrixAt(i, Z);
    im.instanceMatrix.needsUpdate = true;
  }
  set(items);
  function update(t) {
    for (let i = 0; i < L.length; i++) {
      const b = L[i], u = t - b.t0;
      if (u < 0 || u > b.life) { im.setMatrixAt(i, Z); continue; }
      const dr = b.drag, vt = b.vt, g = b.g || 9.81;
      let x = b.p[0] + b.v[0] * (1 - Math.exp(-dr * u)) / dr, z = b.p[2] + b.v[2] * (1 - Math.exp(-dr * u)) / dr;
      let y = b.p[1] + b.v[1] * u - (vt * u - vt * vt / g * (1 - Math.exp(-g * u / vt)));
      const gy = groundY(x, z, t) + b.sy * 0.5;
      if (y < gy) { y = gy; Q.copy(b.q0); } else Q.setFromAxisAngle(b.axv, b.w * u).multiply(b.q0);
      P.set(x, y, z); S.set(b.sx, b.sy, b.sz); M.compose(P, Q, S); im.setMatrixAt(i, M);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  return { mesh: im, update, set, cap };
}
