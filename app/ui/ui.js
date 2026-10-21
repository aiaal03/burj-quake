// Burj Quake — app UI overlay. createUI(root, handlers) → { update(state), destroy() }.
// Plain DOM + 2D canvas, no dependencies. All on-screen facts come from docs/SCIENCE.md (ids in `src`).
// Owner: motion designer. See README-ui.md for the API.

const HT = 828;                 // tower height (m)
const PERIOD_SMALL = 0.5;       // s — 5-storey block, ≈ 0.1 s per storey [research 7]
const PERIOD_BURJ = 11.3;       // s — mode 1 sway [research 4]
const LIMIT_SCALE = 1.25;       // meter shows 0 … 1.25; LIMIT (1.0) sits at 80 %
const LADDER = [3, 5, 7, 8, 9, 10];
const AMBER = '#FFB547', RED = '#FF4A3D';

// ---------------------------------------------------------------- copy (research.md only)
// kind: 'doc' = documented fact; 'hypo' = engineering reasoning / simulation depiction (tagged on screen).
const SRC = {
  A1: 'Abdelrazaq, SMAR 2011',
  BKN: 'Baker, Korista & Novak (SOM)',
};
export const CARDS = {
  anatomy: {
    kind: 'doc', title: 'Y-shaped buttressed core',
    text: ['A hexagonal central core with three wings. Each wing buttresses the other two.',
      'Reinforced concrete from the foundation to level 156; a braced structural-steel spire above, to 828 m.'],
    src: `${SRC.A1}; ${SRC.BKN}`,
  },
  period: {
    kind: 'doc', title: 'Why short buildings are in more danger',
    text: ['Natural sway period: T ≈ 0.1 s per storey. Low- and mid-rises (0.1–1 s) resonate with fast, near-field shaking.',
      'The Burj’s first sway mode is T = 11.3 s.'],
    src: `${SRC.BKN}; research brief §7`,
  },
  design: {
    kind: 'doc', title: 'What sized the tower',
    text: ['Wind, not earthquakes, governed the concrete tower. Seismic loads did govern the podium and the steel spire.',
      '“Designed for magnitude 7” is a myth: magnitude is not a design parameter — site ground motion is.'],
    src: `${SRC.BKN}`,
  },
  fuses: {
    kind: 'doc', title: 'Link beams: fuses by design',
    text: ['Link (coupling) beams at every level, 800–1100 mm deep, are ductile “fuse” elements.',
      'Core walls taper from 1300 to 500 mm up the height.'],
    src: `${SRC.A1}`,
  },
  spire: {
    kind: 'hypo', title: 'The spire joint goes first',
    text: ['Beyond design, the steel spire and its connection at level 156 would likely be damaged first: a concrete-to-steel stiffness jump plus higher-mode whip.',
      'Real record: in July 2010 a distant M5.8 (<1 milli-g at the site) made the pinnacle resonate.'],
    src: `Engineering reasoning, not documented. 2010 record: ${SRC.A1}`,
  },
  base: {
    kind: 'hypo', title: 'The base carries the most',
    text: ['The base — core, wing walls, nose columns, raft and piles — takes the largest overturning moment and base shear.',
      'It stands on a 3.7 m pile-supported raft over ~194 piles, Ø1.5 m and ~43–45 m long.'],
    src: `Engineering reasoning, not documented. Foundation: ${SRC.A1}; ${SRC.BKN}`,
  },
  never: {
    kind: 'doc', title: 'Beyond anything recorded',
    text: ['No M10 has ever been recorded. The strongest so far: M9.5, Chile, 1960.',
      'Magnitude is not site shaking — that depends on distance. This is a hypothetical near-field simulation.'],
    src: 'Research brief, caption guidance',
  },
};
// simulation-state lines (depiction of this sim, not documented thresholds)
const MAG_LINE = (M) => (M < 4 ? 'Barely a tremor' : M < 7 ? 'Low-rises start to rock' : M < 8 ? 'Short buildings fail'
  : M < 9 ? 'The fuses start to work' : M < 9.95 ? 'Beyond design' : 'Never recorded');
export function pickCard(s, view) {
  if (s.burjStatus === 'COLLAPSING') return 'base';
  if (s.burjStatus === 'SPIRE LOST') return 'spire';
  if (view === 'xray') return 'anatomy';
  if (view === 'stress') return s.M >= 9 ? 'spire' : 'base';
  const M = s.M ?? 3;
  if (M >= 9.6) return 'never';
  if (M >= 8.5) return 'fuses';
  if (M >= 7.5) return 'design';
  if (M >= 5) return 'period';
  return 'anatomy';
}

// ---------------------------------------------------------------- helpers
const el = (tag, cls, attrs = {}, kids = []) => {
  const e = document.createElement(tag); if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) e.append(k); return e;
};
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const RAMP = [[0, [27, 42, 74]], [0.4, [44, 143, 168]], [0.7, [233, 241, 238]], [0.9, [255, 181, 71]], [0.999, [255, 150, 62]]];
export function heat(v, a = 1) {
  let c; if (v >= 1) c = [255, 74, 61]; else {
    v = Math.max(0, v); c = RAMP[RAMP.length - 1][1];
    for (let i = 1; i < RAMP.length; i++) if (v <= RAMP[i][0]) { const [x0, c0] = RAMP[i - 1], [x1, c1] = RAMP[i], u = (v - x0) / (x1 - x0); c = c0.map((q, k) => Math.round(q + (c1[k] - q) * u)); break; }
  }
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0); return [ctx, r.width, r.height];
}

// ---------------------------------------------------------------- createUI
export function createUI(root, handlers = {}, opts = {}) {
  const H = { onMagnitude() {}, onShake() {}, onReset() {}, onView() {}, onSpeed() {}, ...handlers };
  const jointY = opts.jointY ?? 600;
  const ui = el('div', 'bq'); root.append(ui);
  let view = opts.view ?? 'normal', speed = opts.speed ?? '1x', S = { M: 3, t: 0, running: false, amp: 0, seis: [], loadMax: 0, stressBins: [], lowRiseDown: 0, midRiseDown: 0, burjStatus: 'STANDING', callouts: [] };
  let tab = 'info', tabPinned = false, collapsed = false, lastHit = false;

  // top
  const magNum = el('div', 'bq-mag-num', { text: '3.0', 'aria-hidden': 'true' });
  const magLine = el('div', 'bq-mag-line', { text: MAG_LINE(3) });
  const top = el('div', 'bq-top', {}, [
    el('div', 'bq-mag', {}, [el('div', 'bq-label', { text: 'Magnitude' }), magNum, magLine]),
    el('div', 'bq-tags', {}, [
      el('div', 'bq-tag', { text: 'Hypothetical simulation', title: 'Not a prediction. A hypothetical near-field simulation; failure locations are engineering reasoning.' }),
      el('div', 'bq-tag bq-tag-sub', { text: 'Sway ×3 · collapse 4× speed', title: 'Real displacements are invisible at this scale: tower sway is drawn ×3, city motion is exaggerated, and collapses play 4× faster than real time.' }),
    ]),
  ]);

  // panel: meter
  const meterVal = el('div', 'bq-meter-val', { text: '0.00' });
  const meterFill = el('div', 'bq-meter-fill');
  const limit = el('div', 'bq-limit', {}, [el('span', '', { text: 'LIMIT' })]);
  const meter = el('div', 'bq-meter', { role: 'meter', 'aria-label': 'Load divided by capacity', 'aria-valuemin': '0', 'aria-valuemax': String(LIMIT_SCALE), 'aria-valuenow': '0' }, [meterFill, limit]);
  const meterBox = el('div', '', {}, [el('div', 'bq-meter-head', {}, [el('div', 'bq-label', { text: 'Load ÷ capacity' }), meterVal]), meter]);
  // seismograph
  const seis = el('canvas', 'bq-seis', { 'aria-hidden': 'true' });
  const seisBox = el('div', 'bq-seis-box', {}, [el('div', 'bq-label bq-seis-label', { text: 'Seismograph' }), seis]);
  // status
  const stLow = el('span', '', { text: 'Low-rises down 0%' }), stMid = el('span', '', { text: 'Mid-rises down 0%' }), stBurj = el('span', '', { text: 'Burj · standing' });
  const status = el('div', 'bq-status bq-row', { role: 'status', 'aria-live': 'polite' }, [el('div', 'bq-status-l', {}, [stLow, stMid]), stBurj]);
  // slider
  const range = el('input', 'bq-range', { type: 'range', min: '3', max: '10', step: '0.1', value: '3', 'aria-label': 'Magnitude' });
  const ladder = el('div', 'bq-ladder');
  const ladderBtns = LADDER.map((m) => { const b = el('button', m === 10 ? 'is-red' : '', { type: 'button', text: String(m), 'aria-label': `Set magnitude ${m}` }); b.style.left = `${(m - 3) / 7 * 100}%`; b.onclick = () => setM(m, true); ladder.append(b); return b; });
  const sliderBox = el('div', 'bq-slider', {}, [range, ladder]);
  // buttons
  const bShake = el('button', 'bq-btn is-primary', { type: 'button', text: 'Shake' });
  const bReset = el('button', 'bq-btn', { type: 'button', text: 'Reset' });
  const seg = (name, items, cur, cb) => {
    const box = el('div', 'bq-seg', { role: 'group', 'aria-label': name });
    const btns = items.map(([v, label]) => { const b = el('button', '', { type: 'button', text: label, 'aria-pressed': String(v === cur) }); b.onclick = () => { btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); cb(v); }; box.append(b); return b; });
    box._set = (v) => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(items[i][0] === v)));
    return box;
  };
  const segView = seg('View', [['normal', 'Normal'], ['stress', 'Stress'], ['xray', 'X-ray']], view, (v) => { view = v; H.onView(v); renderCard(true); });
  const bSpeed = el('button', 'bq-btn bq-speed', { type: 'button', 'aria-label': 'Simulation speed' });
  const paintSpeed = () => { bSpeed.textContent = speed === 'real' ? 'Real time' : '1×'; bSpeed.setAttribute('aria-pressed', String(speed === 'real')); };
  bSpeed.onclick = () => { speed = speed === 'real' ? '1x' : 'real'; paintSpeed(); H.onSpeed(speed); }; paintSpeed();
  bShake.onclick = () => H.onShake(+range.value);
  bReset.onclick = () => H.onReset();
  const panel = el('div', 'bq-panel bq-glass', {}, [
    meterBox, seisBox, status, sliderBox,
    el('div', 'bq-btns', {}, [bShake, bReset, bSpeed]),
    segView,
  ]);

  // card (info / period)
  const tabInfo = el('button', '', { type: 'button', role: 'tab', text: 'Info', 'aria-selected': 'true' });
  const tabPer = el('button', '', { type: 'button', role: 'tab', text: 'Period', 'aria-selected': 'false' });
  const peek = el('span', 'bq-peek');
  const bCollapse = el('button', 'bq-collapse', { type: 'button', 'aria-label': 'Collapse card', 'aria-expanded': 'true', text: '–' });
  const cardBody = el('div', 'bq-card-body');
  const card = el('section', 'bq-card bq-glass', { 'aria-label': 'Explanation' }, [el('div', 'bq-tabs', { role: 'tablist' }, [tabInfo, tabPer, peek, bCollapse]), cardBody]);
  tabInfo.onclick = () => { tab = 'info'; tabPinned = true; renderCard(true); };
  tabPer.onclick = () => { tab = 'period'; tabPinned = true; renderCard(true); };
  const setCollapsed = (v) => { collapsed = v; card.classList.toggle('is-collapsed', collapsed); bCollapse.textContent = collapsed ? '+' : '–'; bCollapse.setAttribute('aria-label', collapsed ? 'Expand card' : 'Collapse card'); bCollapse.setAttribute('aria-expanded', String(!collapsed)); layout(); };
  bCollapse.onclick = () => setCollapsed(!collapsed);
  peek.onclick = () => setCollapsed(false);
  // period canvas (persistent so it can animate)
  const perCv = el('canvas', 'bq-period', { role: 'img', 'aria-label': 'Small building sways with a 0.5 second period, in tune with fast shaking; the Burj sways with an 11.3 second period.' });
  const perBox = el('div', '', {}, [
    perCv,
    el('div', 'bq-period-legend', {}, [
      el('div', '', {}, [document.createTextNode('Small building'), el('b', '', { text: 'T ≈ 0.5 s' }), el('span', 'bq-pill is-in', { text: 'IN TUNE' })]),
      el('div', '', { style: 'text-align:right' }, [document.createTextNode('Burj Khalifa'), el('b', '', { text: 'T = 11.3 s' }), el('span', 'bq-pill is-out', { text: 'OUT OF TUNE' })]),
    ]),
    el('p', 'bq-src', { text: 'Natural sway period T. Glyphs move at true relative speed (22.6×). Sources: research brief §4, §7.' }),
  ]);

  // strip
  const stripCv = el('canvas', '', { role: 'img', 'aria-label': 'Load divided by capacity along the height of the tower' });
  const strip = el('div', 'bq-strip', {}, [el('div', 'bq-label', { text: '828 m' }), stripCv, el('div', 'bq-label', { text: '0' })]);
  // callouts
  const coLayer = el('div', 'bq-callouts', { 'aria-hidden': 'true' });
  const coEls = new Map();
  ui.append(coLayer, top, strip, card, panel);

  let curCard = null;
  function renderCard(force) {
    const id = pickCard(S, view);
    if (!tabPinned) tab = id === 'period' ? 'period' : 'info';
    tabInfo.setAttribute('aria-selected', String(tab === 'info')); tabPer.setAttribute('aria-selected', String(tab === 'period'));
    const key = tab === 'period' ? 'period-glyphs' : id;
    if (!force && key === curCard) return; curCard = key;
    cardBody.replaceChildren();
    peek.textContent = tab === 'period' ? 'Sway period: 0.5 s vs 11.3 s' : CARDS[id].title;
    if (tab === 'period') { cardBody.append(perBox); }
    else {
      const c = CARDS[id];
      cardBody.append(
        el('span', `bq-chip ${c.kind === 'hypo' ? 'is-hypo' : 'is-doc'}`, { text: c.kind === 'hypo' ? 'Hypothetical · engineering reasoning' : 'Documented' }),
        el('div', 'bq-card-title', { text: c.title }),
        ...c.text.map((s) => el('p', 'bq-card-text', { text: s })),
        el('p', 'bq-src', { text: 'Source: ' + c.src }),
      );
    }
    layout();
  }

  function setM(m, emit) {
    m = Math.round(clamp(m, 3, 10) * 10) / 10; range.value = String(m);
    range.style.setProperty('--bq-p', `${(m - 3) / 7 * 100}%`);
    ladderBtns.forEach((b, i) => b.classList.toggle('is-passed', LADDER[i] <= m + 1e-6));
    if (emit) { S.M = m; paintTop(); H.onMagnitude(m); renderCard(); }
  }
  range.addEventListener('input', () => setM(+range.value, true));

  function paintTop() {
    const M = S.M ?? 3; magNum.textContent = M.toFixed(1); magNum.classList.toggle('is-red', M >= 9.95);
    magLine.textContent = MAG_LINE(M);
  }

  // layout: phone stacks card above the panel, strip on the right edge
  const desk = window.matchMedia('(min-width: 900px)');
  function layout() {
    const ph = panel.offsetHeight, rh = ui.clientHeight;
    if (desk.matches) {
      ui.style.setProperty('--bq-panel-h', ph + 'px'); card.style.top = ''; strip.style.top = ''; strip.style.height = '';
    } else {
      const topH = top.offsetHeight - 18;
      card.style.top = `${topH}px`; card.style.maxHeight = `${Math.max(120, rh - topH - ph - 28)}px`;
      const sTop = topH + card.offsetHeight + 10, bottom = ph + 18;
      strip.style.top = `${sTop}px`; strip.style.height = `${Math.max(120, rh - sTop - bottom)}px`;
      strip.style.display = rh - sTop - bottom < 110 ? 'none' : '';
    }
  }
  const ro = new ResizeObserver(layout); ro.observe(ui); ro.observe(panel);

  // ---- draw: seismograph
  function drawSeis() {
    const [c, w, h] = fitCanvas(seis); c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    const a = S.seis || []; if (a.length < 2) return;
    let mx = 1e-6; for (const v of a) mx = Math.max(mx, Math.abs(v));
    const sc = (h / 2 - 4) / Math.max(mx, opts.seisScale ?? 1);
    c.strokeStyle = 'rgba(255,255,255,0.92)'; c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath();
    a.forEach((v, i) => { const x = i / (a.length - 1) * (w - 6), y = h / 2 - v * sc; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(w - 6, h / 2 - a[a.length - 1] * sc, 3, 0, 7); c.fill();
  }
  // ---- draw: strip (tapered silhouette filled with the heat profile)
  function drawStrip() {
    const [c, w, h] = fitCanvas(stripCv); c.clearRect(0, 0, w, h);
    const bins = S.stressBins || [], cx = w / 2, y = (m) => h - 4 - (h - 8) * m / HT, hw = (m) => 1 + (w * 0.42) * Math.pow(clamp(1 - m / HT), 0.85);
    const spireGone = S.burjStatus !== 'STANDING';
    const path = (m0, m1) => { c.beginPath(); for (let m = m0; m <= m1; m += 6) c.lineTo(cx - hw(m), y(m)); for (let m = m1; m >= m0; m -= 6) c.lineTo(cx + hw(m), y(m)); c.closePath(); };
    const g = c.createLinearGradient(0, y(0), 0, y(HT));
    if (bins.length > 1) bins.forEach((v, i) => g.addColorStop(i / (bins.length - 1), heat(v)));
    else { g.addColorStop(0, heat(0)); g.addColorStop(1, heat(0)); }
    path(0, spireGone ? jointY : HT); c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5; c.stroke();
    if (spireGone) { c.setLineDash([2, 4]); path(jointY, HT); c.strokeStyle = 'rgba(255,255,255,0.3)'; c.stroke(); c.setLineDash([]); }
    // L156 tick
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y(jointY)); c.lineTo(5, y(jointY)); c.stroke();
    // hot markers (≥ 1)
    const now = performance.now() / 1000;
    bins.forEach((v, i) => { if (v < 1) return; const m = i / (bins.length - 1) * HT, ph = now % 1;
      c.fillStyle = RED; c.beginPath(); c.arc(cx, y(m), 4, 0, 7); c.fill();
      c.strokeStyle = `rgba(255,74,61,${0.8 * (1 - ph)})`; c.beginPath(); c.arc(cx, y(m), 4 + 10 * ph, 0, 7); c.stroke(); });
  }
  // ---- draw: period glyphs (true relative rates: 0.5 s vs 11.3 s)
  let t0wall = performance.now();
  function drawPeriod() {
    if (!perCv.isConnected || collapsed) return;
    const [c, w, h] = fitCanvas(perCv); c.clearRect(0, 0, w, h);
    // clock: sim time when running; otherwise wall clock (illustration)
    const t = S.running ? S.t : (performance.now() - t0wall) / 1000;
    const k = S.running ? clamp(0.35 + (S.amp ?? 0) * 0.65) : 0.6;
    const GY = h - 14, gx = 4 * k * (0.65 * Math.sin(2 * Math.PI * t / PERIOD_SMALL) + 0.35 * Math.sin(2 * Math.PI * t / 0.27 + 1.1));
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(8 + gx, GY); c.lineTo(w - 8 + gx, GY); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.3)'; for (let x = 12; x < w - 8; x += 14) { c.beginPath(); c.moveTo(x + gx, GY + 2); c.lineTo(x + gx - 5, GY + 8); c.stroke(); }
    const sx = w * 0.24 + gx, tip = 12 * k * Math.sin(2 * Math.PI * t / PERIOD_SMALL - 0.5), sh = h * 0.36;
    c.fillStyle = '#fff'; c.beginPath();
    for (let i = 0; i <= 8; i++) { const e = i / 8; c.lineTo(sx - 9 + tip * e * e, GY - sh * e); }
    for (let i = 8; i >= 0; i--) { const e = i / 8; c.lineTo(sx + 9 + tip * e * e, GY - sh * e); }
    c.fill();
    c.strokeStyle = 'rgba(14,18,26,0.7)'; c.lineWidth = 1.5;
    for (let f = 1; f <= 5; f++) { const e = f / 5 - 0.1; c.beginPath(); c.moveTo(sx - 6 + tip * e * e, GY - sh * e); c.lineTo(sx + 6 + tip * e * e, GY - sh * e); c.stroke(); }
    const bx = w * 0.76 + gx, btip = 7 * k * Math.sin(2 * Math.PI * t / PERIOD_BURJ), bh = h - 26;
    c.fillStyle = '#fff'; c.beginPath();
    for (let i = 0; i <= 16; i++) { const e = i / 16, hw = 10 - 9.2 * e; c.lineTo(bx - hw + btip * e * e, GY - bh * e); }
    for (let i = 16; i >= 0; i--) { const e = i / 16, hw = 10 - 9.2 * e; c.lineTo(bx + hw + btip * e * e, GY - bh * e); }
    c.fill();
  }
  // ---- callouts: HTML labels positioned each frame
  function drawCallouts() {
    const W = ui.clientWidth, Hh = ui.clientHeight, list = S.callouts || [], seen = new Set();
    const pr = panel.getBoundingClientRect(), ur = ui.getBoundingClientRect();
    const xmax = desk.matches ? pr.left - ur.left - 56 : W - 60;
    const ymin = desk.matches ? top.offsetHeight + 8 : card.getBoundingClientRect().bottom - ur.top + 12, ymax = desk.matches ? Hh - 16 : pr.top - ur.top - 12;
    const boxes = [];
    for (const co of list) {
      seen.add(co.id);
      let e = coEls.get(co.id);
      if (!e) { e = el('div', 'bq-co', {}, [el('div', 'bq-co-lead'), el('div', 'bq-co-dot'), el('div', 'bq-co-label')]); coLayer.append(e); coEls.set(co.id, e); }
      const lab = e.children[2]; if (lab.textContent !== co.text) lab.textContent = co.text;
      e.classList.toggle('is-hot', !!co.hot);
      const ok = co.visible !== false && co.x >= 0 && co.x <= xmax + 40 && co.y >= ymin && co.y <= ymax;
      e.classList.toggle('is-on', ok); if (!ok) continue;
      const lw = lab.offsetWidth, lh = lab.offsetHeight;
      let side = co.x + 30 + lw > xmax ? -1 : 1;
      if (side < 0 && co.x - 30 - lw < 12) side = 1;
      let ly = co.y - 44;
      if (ly - lh / 2 < ymin) ly = co.y + 44;
      for (const b of boxes) if (Math.abs(b.y - ly) < lh + 4 && b.x0 < co.x + 300 && b.x1 > co.x - 300) ly = b.y + lh + 6;
      let lx = side > 0 ? co.x + 30 : co.x - 30 - lw; lx = clamp(lx, 12, Math.max(12, xmax - lw));
      boxes.push({ y: ly, x0: lx, x1: lx + lw });
      e.style.transform = `translate(${co.x}px, ${co.y}px)`;
      lab.style.left = `${lx - co.x}px`; lab.style.top = `${ly - co.y - lh / 2}px`;
      const ex = (side > 0 ? lx - 6 : lx + lw + 6) - co.x, ey = ly - co.y, len = Math.hypot(ex, ey);
      const lead = e.children[0]; lead.style.width = `${Math.max(0, len - 8)}px`; lead.style.transform = `rotate(${Math.atan2(ey, ex)}rad) translateX(8px)`;
    }
    for (const [id, e] of coEls) if (!seen.has(id)) { e.remove(); coEls.delete(id); }
  }

  function paintStatus() {
    const lo = Math.round(S.lowRiseDown ?? 0), mi = Math.round(S.midRiseDown ?? 0), b = S.burjStatus || 'STANDING';
    stLow.textContent = `Low-rises down ${lo}%`; stLow.className = lo > 0 ? 'is-amber' : '';
    stMid.textContent = `Mid-rises down ${mi}%`; stMid.className = mi > 0 ? 'is-amber' : '';
    stBurj.textContent = `Burj · ${b.toLowerCase()}`; stBurj.className = b === 'STANDING' ? '' : 'is-red';
  }
  function paintMeter() {
    const v = Math.max(0, S.loadMax ?? 0), hit = v >= 1;
    meterVal.textContent = hit ? (v >= 1.005 ? '> 1' : '1.00') : v.toFixed(2); meterVal.classList.toggle('is-hot', hit);
    meterFill.style.width = `${clamp(Math.min(v, 1) / LIMIT_SCALE) * 100}%`;
    meterFill.style.setProperty('--bq-meter-w', meter.clientWidth + 'px');
    meter.setAttribute('aria-valuenow', v.toFixed(2));
    if (hit && !lastHit) { limit.classList.remove('is-flash'); void limit.offsetWidth; limit.classList.add('is-flash'); }
    lastHit = hit;
  }

  let raf = 0;
  const loop = () => { drawPeriod(); drawCallouts(); raf = requestAnimationFrame(loop); };
  if (!desk.matches) setCollapsed(true);
  setM(3, false); paintTop(); renderCard(true); layout(); raf = requestAnimationFrame(loop);

  return {
    update(state) {
      S = { ...S, ...state };
      if (state.M != null && document.activeElement !== range) setM(state.M, false);
      bShake.classList.toggle('is-running', !!S.running); bShake.textContent = S.running ? 'Shaking…' : 'Shake';
      // the height strip only makes sense as a heat map: show it in the Stress view only
      strip.classList.toggle('is-off', (S.view ?? view) !== 'stress');
      paintTop(); paintStatus(); paintMeter(); drawSeis(); drawStrip(); renderCard();
    },
    setView(v) { view = v; segView._set(v); renderCard(true); },
    setSpeed(v) { speed = v; paintSpeed(); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); ui.remove(); },
    el: ui,
  };
}
