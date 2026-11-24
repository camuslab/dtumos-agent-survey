/*
 * 표지 배경: DTUMOS로 돌린 서울 도심 호출택시·대중교통 실행을 <canvas>에 다시 그린다.
 * camuslab/dtumos-lecture의 frontend/src/landing/flow.js(Apache-2.0)를 가져와
 * 모듈 import/export를 일반 스크립트 형태로 바꾸고 세 가지를 고쳤다. 그리는 방식은 원본과 같다.
 *   - 색 변수를 canvas에서 읽는다 (원본은 문서 루트).
 *   - opts.onTime(분)으로 지금 그리는 시뮬레이션 시각(자정부터의 분)을 알린다.
 *   - canvas가 화면 밖에 있는 동안에는 그리지 않는다.
 * 도로는 전경색을 옅게, 움직이는 구간은 수단별 색(--t-occupied 등 CSS 변수)으로 그린다.
 */
(function () {
const TRAIL = 0.8;           // minutes of tail behind each vehicle
const MINUTES_PER_SECOND = 1; // playback speed
const MAX_DPR = 2;

function decode(data) {
  const trips = data.trips.map(raw => {
    const n = (raw.length - 1) / 3;
    const x = new Float32Array(n), y = new Float32Array(n), t = new Float32Array(n);
    let ax = 0, ay = 0, at = 0;
    for (let i = 0; i < n; i++) {
      ax += raw[1 + i * 3]; ay += raw[2 + i * 3]; at += raw[3 + i * 3];
      x[i] = ax; y[i] = ay; t[i] = at / 10;
    }
    return { mode: raw[0], x, y, t, start: t[0], end: t[n - 1] };
  });
  return { w: data.w, h: data.h, L: data.L, t0: data.t0 || 0, roads: data.roads, trips: level(trips, data.L) };
}

// The run gets busier through the window (about 80 legs on screen early on,
// 450 by the end), so the loop would open crowded and then thin out. Keep a
// share of each mode's legs so the count on screen stays near LEVEL all the
// way round: each leg's keep chance is scaled by how crowded its own minutes
// are, a few times over, then a fixed hash decides (same picture every load).
const LEVEL = 100;
const MIX = [0.08, 0.37, 0.34, 0.19, 0.02]; // share per mode, as in the quiet minutes

function level(trips, L) {
  const B = Math.round(L * 2); // half-minute bins around the loop
  const bins = trips.map(p => {
    const out = new Set();
    for (let k = Math.floor(p.start * 2); k / 2 <= p.end; k++) out.add(((k % B) + B) % B);
    return [...out];
  });
  const keep = trips.map(() => 1);
  for (let round = 0; round < 6; round++) {
    const load = MIX.map(() => new Float32Array(B));
    trips.forEach((p, i) => { for (const b of bins[i]) load[p.mode][b] += keep[i]; });
    trips.forEach((p, i) => {
      const crowd = bins[i].reduce((sum, b) => sum + load[p.mode][b], 0) / bins[i].length;
      const want = LEVEL * (MIX[p.mode] ?? 0.1);
      keep[i] = Math.min(1, keep[i] * Math.min(2, want / Math.max(crowd, 1e-6)));
    });
  }
  return trips.filter((_, i) => {
    let x = Math.imul(i, 2654435761) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13;
    return (x >>> 0) / 4294967296 < keep[i];
  });
}

function startFlow(canvas, flowUrl, opts) {
  if (!canvas || !canvas.getContext || !window.fetch) return;
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // mode (scripts/landing_flow.py) -> CSS variable, line width, strength
  const STYLE = [
    { css: '--t-pickup', color: '#c2185b', width: 1.1, alpha: 0.6 },
    { css: '--t-occupied', color: '#e0620d', width: 1.5, alpha: 0.85 },
    { css: '--t-bus', color: '#52a044', width: 1.4, alpha: 0.75 },
    { css: '--t-subway', color: '#3068c8', width: 1.8, alpha: 0.8 },
    { css: '--t-rail', color: '#8e44ad', width: 2.0, alpha: 0.8 },
  ];
  let flow = null, base = null, fg = '#0a0a0a';
  let view = null, raf = 0, startedAt = 0, pausedAt = 0;

  function colour() {
    const css = getComputedStyle(canvas); // 표지에만 어두운 색을 쓰므로 canvas에서 읽는다 (원본은 root)
    fg = css.getPropertyValue('--t-fg').trim() || fg;
    for (const s of STYLE) s.color = css.getPropertyValue(s.css).trim() || s.color;
  }

  // Cover the canvas with the data box (like background-size: cover), north up.
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const s = Math.max(cw / flow.w, ch / flow.h);
    view = { dpr, s, ox: (cw - flow.w * s) / 2, oy: (ch - flow.h * s) / 2, cw, ch };
  }
  const X = x => view.ox + x * view.s;
  const Y = y => view.oy + (flow.h - y) * view.s;

  // Static layer: arterials plus a faint trace of every path, which together
  // read as the street network.
  function drawBase() {
    base = document.createElement('canvas');
    base.width = canvas.width; base.height = canvas.height;
    const b = base.getContext('2d');
    b.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    b.strokeStyle = fg; b.lineCap = 'round'; b.lineJoin = 'round';
    b.globalAlpha = 0.05; b.lineWidth = 0.8;
    b.beginPath();
    for (const p of flow.trips) {
      b.moveTo(X(p.x[0]), Y(p.y[0]));
      for (let i = 1; i < p.x.length; i++) b.lineTo(X(p.x[i]), Y(p.y[i]));
    }
    b.stroke();
    for (const [cls, alpha, width] of [[2, 0.10, 1], [3, 0.16, 1.4]]) {
      b.globalAlpha = alpha; b.lineWidth = width;
      b.beginPath();
      for (const r of flow.roads) {
        if (r[0] !== cls) continue;
        b.moveTo(X(r[1]), Y(r[2])); b.lineTo(X(r[3]), Y(r[4]));
      }
      b.stroke();
    }
  }

  // Position along a trip at time tm (linear between stored points).
  function at(p, tm) {
    const { t, x, y } = p;
    let i = 1;
    while (i < t.length - 1 && t[i] < tm) i++;
    const span = t[i] - t[i - 1] || 1;
    const k = Math.min(1, Math.max(0, (tm - t[i - 1]) / span));
    return [x[i - 1] + (x[i] - x[i - 1]) * k, y[i - 1] + (y[i] - y[i - 1]) * k, i];
  }

  function drawTrip(p, now) {
    const from = now - TRAIL;
    if (p.end < from || p.start > now) return;
    const t0 = Math.max(from, p.start), t1 = Math.min(now, p.end);
    const [sx, sy, si] = at(p, t0);
    const [ex, ey, ei] = at(p, t1);
    const style = STYLE[p.mode] || STYLE[1];
    // Older part of the trail is fainter: draw it in a few steps.
    const pts = [[sx, sy, t0]];
    for (let i = si; i < ei; i++) pts.push([p.x[i], p.y[i], p.t[i]]);
    pts.push([ex, ey, t1]);
    ctx.lineWidth = style.width;
    ctx.strokeStyle = ctx.fillStyle = style.color;
    for (let i = 1; i < pts.length; i++) {
      const age = (now - pts[i][2]) / TRAIL;
      ctx.globalAlpha = style.alpha * Math.max(0.05, 1 - age);
      ctx.beginPath();
      ctx.moveTo(X(pts[i - 1][0]), Y(pts[i - 1][1]));
      ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
      ctx.stroke();
    }
    if (t1 === now) {
      ctx.globalAlpha = Math.min(1, style.alpha + 0.15);
      ctx.beginPath();
      ctx.arc(X(ex), Y(ey), style.width * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    // Butt caps: round ones overlap at every joint and leave a row of dots.
    ctx.lineCap = 'butt';
    // The data runs a little past both ends of the loop; drawing the same
    // moment one loop earlier and later hides the seam.
    for (const shift of [0, flow.L, -flow.L]) {
      const tm = now + shift;
      for (const p of flow.trips) drawTrip(p, tm);
    }
  }

  const onTime = opts && opts.onTime;
  let onScreen = true;
  if (window.IntersectionObserver) {
    new IntersectionObserver(entries => { onScreen = entries[entries.length - 1].isIntersecting; }).observe(canvas);
  }

  function tick(ts) {
    if (!startedAt) startedAt = ts;
    if (onScreen) {
      const now = (((ts - startedAt) / 1000) * MINUTES_PER_SECOND) % flow.L;
      frame(now);
      if (onTime) onTime(flow.t0 + now);
    }
    raf = requestAnimationFrame(tick);
  }

  function redraw() {
    if (!flow) return;
    fit(); drawBase();
    if (still) frame(flow.L / 2);
  }

  fetch(flowUrl)
    .then(r => r.json())
    .then(data => {
      flow = decode(data);
      colour(); redraw();
      canvas.classList.add('on');
      if (still && onTime) onTime(flow.t0 + flow.L / 2);
      if (!still) raf = requestAnimationFrame(tick);
    })
    .catch(() => {});

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redraw, 120);
  });
  // The theme switch (data-theme on <html>) recolours it.
  const recolour = () => { colour(); if (flow) { drawBase(); if (still) frame(flow.L / 2); } };
  new MutationObserver(recolour).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  // Stop drawing while the tab is hidden; resume where it left off.
  document.addEventListener('visibilitychange', () => {
    if (!flow || still) return;
    if (document.hidden) {
      cancelAnimationFrame(raf); pausedAt = performance.now();
    } else {
      startedAt += performance.now() - pausedAt;
      raf = requestAnimationFrame(tick);
    }
  });
}

  window.startFlow = startFlow;
})();
