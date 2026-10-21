// Render quality presets + auto-degrade.
//   ?quality=realtime (default) | high      ?ao=0  ?csm=0  ?haze=0  ?degrade=0
// Auto-degrade: if fps < 40 for 2 s → AO 1/2 → 1/3 res (fewer samples), then cascades −1 (min 2), then AO off.
export const PRESETS = {
  realtime: { cascades: 3, shadowSize: 2048, aoScale: 0.5, aoSamples: 10 },
  high: { cascades: 4, shadowSize: 4096, aoScale: 0.5, aoSamples: 16 },
};

export function makeQuality(qs) {
  const name = PRESETS[qs.get('quality')] ? qs.get('quality') : 'realtime';
  const P = { ...PRESETS[name] };
  const Q = { name, P, ao: qs.get('ao') !== '0', csm: qs.get('csm') !== '0', haze: qs.get('haze') !== '0', degrade: qs.get('degrade') !== '0', level: 0, log: [] };
  let low = 0, cool = 0;
  // fps: smoothed fps; dt: frame dt; apply(step) performs the step and returns false if nothing left to do
  Q.tick = (fps, dt, apply) => {
    if (!Q.degrade || !fps) return;
    if (cool > 0) { cool -= dt; low = 0; return; }
    low = fps < 40 ? low + dt : 0;
    if (low >= 2) { low = 0; cool = 3; const s = apply(Q.level); if (s) { Q.level++; Q.log.push(s); console.log('[render] auto-degrade:', s, 'fps', fps.toFixed(1)); } else Q.degrade = false; }
  };
  return Q;
}
