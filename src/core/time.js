// Time helpers: easings, ramps, splines, springs, held drawings, deterministic noise. LEAD-OWNED.
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ilerp = (a, b, x) => clamp((x - a) / (b - a));
export const ramp = (t, t0, t1) => clamp((t - t0) / (t1 - t0)); // 0..1 linear window
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };

// Easings (input clamped 0..1)
export const E = {
  lin: (x) => clamp(x),
  in2: (x) => { x = clamp(x); return x * x; },
  out2: (x) => { x = clamp(x); return 1 - (1 - x) * (1 - x); },
  io2: (x) => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x); },
  in3: (x) => { x = clamp(x); return x * x * x; },
  out3: (x) => { x = clamp(x); return 1 - (1 - x) ** 3; },
  io3: (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - 4 * (1 - x) ** 3; },
  out4: (x) => { x = clamp(x); return 1 - (1 - x) ** 4; },
  out5: (x) => { x = clamp(x); return 1 - (1 - x) ** 5; },
  io5: (x) => { x = clamp(x); return x < 0.5 ? 16 * x ** 5 : 1 - 16 * (1 - x) ** 5; },
  inExpo: (x) => { x = clamp(x); return x <= 0 ? 0 : 2 ** (10 * x - 10); },
  outExpo: (x) => { x = clamp(x); return x >= 1 ? 1 : 1 - 2 ** (-10 * x); },
  ioExpo: (x) => { x = clamp(x); if (x <= 0) return 0; if (x >= 1) return 1; return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2; },
  outBack: (x, s = 1.70158) => { x = clamp(x); const c = s + 1; return 1 + c * (x - 1) ** 3 + s * (x - 1) ** 2; },
  inBack: (x, s = 1.70158) => { x = clamp(x); return (s + 1) * x * x * x - s * x * x; },
  // fast-out, soft settle (the house "snap"): reaches ~90% at 35% of the window
  snap: (x) => { x = clamp(x); return 1 - (1 - x) ** 4.2; },
  // anticipation-free whip: slow start, very fast middle, soft land
  whip: (x) => { x = clamp(x); return x < 0.5 ? 0.5 * (2 * x) ** 3.2 : 1 - 0.5 * (2 - 2 * x) ** 2.2; },
  smooth, smoother,
};

// damped spring step response 0 -> 1 (overshoots). f = Hz, z = damping ratio (0.3 bouncy .. 1 critical)
export function spring(t, f = 3, z = 0.45) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * f;
  if (z >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}

// keys: [[t, v], ...] -> value with per-segment easing (default io3). keys(t, [[0,0],[1,10,'out3']]) : the 3rd item eases INTO that key.
export function keys(t, ks, def = 'io3') {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i][0]) {
      const [t0, v0] = ks[i - 1], [t1, v1, ez] = ks[i];
      const e = typeof ez === 'function' ? ez : E[ez || def];
      return lerp(v0, v1, e((t - t0) / (t1 - t0)));
    }
  }
  return ks[ks.length - 1][1];
}

// C1 spline through timed keys [[t, v], ...] (Catmull-Rom tangents with uneven spacing; zero slope at the ends).
// Optional 3rd item = tangent scale at that key (0 = momentary stop, 1 = default).
export function cr(t, ks) {
  const n = ks.length;
  if (n === 1 || t <= ks[0][0]) return ks[0][1];
  if (t >= ks[n - 1][0]) return ks[n - 1][1];
  let i = 0; while (i < n - 2 && t > ks[i + 1][0]) i++;
  const tan = (k) => {
    if (k === 0 || k === n - 1) return 0;
    const s = ks[k][2] ?? 1;
    return s * (ks[k + 1][1] - ks[k - 1][1]) / (ks[k + 1][0] - ks[k - 1][0]);
  };
  const [t0, p0] = ks[i], [t1, p1] = ks[i + 1], h = t1 - t0, u = (t - t0) / h;
  const m0 = tan(i) * h, m1 = tan(i + 1) * h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

// Held drawings: quantise time to `fps` (cartoon "on twos/threes"), anchored at t0 so a pose lands on t0 exactly.
// Use F.tf (frame-centre time) as input so all motion-blur sub-samples see the same drawing.
export const toonT = (t, t0 = 0, fps = 12) => t0 + Math.floor((t - t0) * fps + 1e-6) / fps;

// Deterministic randomness (never Math.random in draw code)
export function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return n - Math.floor(n); }
export const hash2 = (a, b) => hash(a * 157.31 + b * 113.97);
export function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; }
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
