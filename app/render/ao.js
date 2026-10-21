// Screen-space ambient occlusion from the resolved MSAA depth (no extra geometry pass).
// Half-res (or 1/3) SAO-style obscurance with normals reconstructed from depth, world-space radius that grows
// with distance (street-level corners at 5–7 m, block-scale contact at aerial views), then a depth-aware
// separable bilateral blur. The result is applied in the post pass before tonemapping (see main.js POST_FS).
import * as THREE from 'three';

const VS = `out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMMON = /* glsl */`
uniform sampler2D tDepth; uniform vec2 uFull; uniform float uNear, uFar; uniform vec2 uTan;
float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }   // negative in front of the camera
vec3 vpix(ivec2 p){ p = clamp(p, ivec2(0), ivec2(uFull) - 1); float z = viewZ(texelFetch(tDepth, p, 0).r); vec2 uv = (vec2(p) + 0.5) / uFull; return vec3((uv * 2.0 - 1.0) * uTan * -z, z); }
vec3 vpos(vec2 uv){ return vpix(ivec2(floor(uv * uFull))); }`;
const AO_FS = /* glsl */`precision highp float; in vec2 vUv; out vec4 o; ${COMMON}
uniform float uProj, uRadius, uInt, uFade, uFrame;
#ifndef NS
#define NS 10
#endif
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d = texelFetch(tDepth, ivec2(floor(vUv * uFull)), 0).r;
  if (d >= 0.999999) { o = vec4(1.0); return; }
  ivec2 pc = ivec2(floor(vUv * uFull));
  vec3 C = vpix(pc); float dist = -C.z;
  vec2 tx = 1.0 / uFull;
  vec3 pr = vpix(pc + ivec2(1, 0)), pl = vpix(pc - ivec2(1, 0)), pu = vpix(pc + ivec2(0, 1)), pd = vpix(pc - ivec2(0, 1));
  vec3 dx = abs(pr.z - C.z) < abs(C.z - pl.z) ? pr - C : C - pl;
  vec3 dy = abs(pu.z - C.z) < abs(C.z - pd.z) ? pu - C : C - pd;
  vec3 n = normalize(cross(dx, dy));
  if (uFrame > 0.5) { o = vec4(n * 0.5 + 0.5, 1.0); return; }
  float R = uRadius * mix(1.0, 4.0, smoothstep(250.0, 2600.0, dist));
  float rpx = clamp(R * uProj / dist, 2.0, 90.0);
  float R2 = R * R;
  float ang = ign(gl_FragCoord.xy) * 6.2831853, acc = 0.0;
  for (int i = 0; i < NS; i++) {
    float t = (float(i) + 0.5) / float(NS);
    float a = ang + t * 6.2831853 * 3.7;             // 3.7 turns golden-ish spiral
    vec2 off = vec2(cos(a), sin(a)) * rpx * t;
    vec3 v = vpix(pc + ivec2(round(off))) - C;
    float vv = dot(v, v), vn = dot(v, n);
    float f = max(R2 - vv, 0.0) / R2;
    acc += f * max(vn - 0.0006 * dist, 0.0) * R / (vv + 0.06 * R2);
  }
  float ao = max(0.0, 1.0 - uInt * 2.0 * acc / float(NS));
  ao = mix(ao, 1.0, smoothstep(2600.0, 6500.0, dist) * 0.85 + 0.0) ;
  ao = mix(1.0, ao, uFade);
  o = vec4(ao, ao, ao, 1.0);
}`;
const BLUR_FS = /* glsl */`precision highp float; in vec2 vUv; out vec4 o; ${COMMON}
uniform sampler2D tAO; uniform vec2 uDir;
void main(){
  float z0 = viewZ(texture(tDepth, vUv).r), s = 0.0, w = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = viewZ(texture(tDepth, uv).r);
    float ww = exp(-float(i * i) / 8.0) * exp(-abs(z - z0) / (0.03 * abs(z0) + 0.3));
    s += texture(tAO, uv).r * ww; w += ww;
  }
  o = vec4(vec3(s / max(w, 1e-4)), 1.0);
}`;

export function makeAO({ renderer, samples = 10, scale = 0.5, radius = 8.0, intensity = 1.1 }) {
  const mk = (fs, u, defs) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: fs, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, defines: defs || {} });
  const base = () => ({ tDepth: { value: null }, uFull: { value: new THREE.Vector2(1, 1) }, uNear: { value: 1 }, uFar: { value: 1000 }, uTan: { value: new THREE.Vector2(1, 1) } });
  const aoM = mk(AO_FS, { ...base(), uProj: { value: 1 }, uRadius: { value: radius }, uInt: { value: intensity }, uFade: { value: 1 }, uFrame: { value: 0 } }, { NS: samples });
  const blurM = mk(BLUR_FS, { ...base(), tAO: { value: null }, uDir: { value: new THREE.Vector2() } });
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); mesh.frustumCulled = false; scene.add(mesh);
  const A = { enabled: true, scale, samples, rt1: null, rt2: null, fw: 1, fh: 1, white: null };
  const mkRT = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  A.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); A.white.needsUpdate = true;
  A.resize = (fw, fh) => {
    A.fw = fw; A.fh = fh; A.rt1?.dispose(); A.rt2?.dispose();
    const w = Math.max(1, Math.round(fw * A.scale)), h = Math.max(1, Math.round(fh * A.scale));
    A.rt1 = mkRT(w, h); A.rt2 = mkRT(w, h);
  };
  A.setScale = (s) => { if (s === A.scale) return; A.scale = s; A.resize(A.fw, A.fh); };
  A.setSamples = (n) => { if (n === A.samples) return; A.samples = n; aoM.defines.NS = n; aoM.needsUpdate = true; };
  const pass = (m, rt) => { mesh.material = m; renderer.setRenderTarget(rt); renderer.render(scene, cam); };
  // depthTex: resolved scene depth; returns the AO texture (white when disabled)
  A.render = (depthTex, camera, fade = 1) => {
    if (!A.enabled) return A.white;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    for (const m of [aoM, blurM]) { const u = m.uniforms; u.tDepth.value = depthTex; u.uFull.value.set(A.fw, A.fh); u.uNear.value = camera.near; u.uFar.value = camera.far; u.uTan.value.set(t * camera.aspect, t); }
    aoM.uniforms.uProj.value = 0.5 * A.fh / t; aoM.uniforms.uFade.value = fade;
    pass(aoM, A.rt1); if (aoM.uniforms.uFrame.value > 0.5) return A.rt1.texture;
    blurM.uniforms.tAO.value = A.rt1.texture; blurM.uniforms.uDir.value.set(1.0 / A.rt1.width, 0); pass(blurM, A.rt2);
    blurM.uniforms.tAO.value = A.rt2.texture; blurM.uniforms.uDir.value.set(0, 1.0 / A.rt1.height); pass(blurM, A.rt1);
    return A.rt1.texture;
  };
  A.uniforms = aoM.uniforms;
  return A;
}
