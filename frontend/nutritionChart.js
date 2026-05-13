/* Lightweight nutrition pie chart (no external libs)
   Renders proteins, carbohydrates, fats, energy slices on a <canvas id="nutrition-chart">.
*/

let nutritionChartState = {
  ctx: null,
  canvas: null,
};

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '').trim();
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clearChart() {
  if (!nutritionChartState.ctx || !nutritionChartState.canvas) return;
  nutritionChartState.ctx.clearRect(0, 0, nutritionChartState.canvas.width, nutritionChartState.canvas.height);
}

function drawArc(cx, cy, radius, startAngle, endAngle, fillStyle) {
  const ctx = nutritionChartState.ctx;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawLegendText(label, valueText, color) {
  // Legend is handled in DOM; keep function for future expansion.
  void label;
  void valueText;
  void color;
}

function parseMaybeNumber(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string') {
    const s = x.trim();
    if (!s || s.toLowerCase() === 'not available') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeValues(values) {
  // Ensure non-negative and compute sum; if all zero => return equal.
  const cleaned = values.map(v => (typeof v === 'number' && v > 0 ? v : 0));
  const sum = cleaned.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const equal = 1 / cleaned.length;
    return cleaned.map(() => equal);
  }
  return cleaned.map(v => v / sum);
}

function renderNutritionChart({ proteins, carbohydrates, fats, energy }) {
  const canvas = document.getElementById('nutrition-chart');
  if (!canvas) return;

  // init ctx
  nutritionChartState.canvas = canvas;
  nutritionChartState.ctx = canvas.getContext('2d');

  clearChart();

  const ctx = nutritionChartState.ctx;
  const w = canvas.width;
  const h = canvas.height;

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.38;

  const p = parseMaybeNumber(proteins);
  const c = parseMaybeNumber(carbohydrates);
  const f = parseMaybeNumber(fats);
  const e = parseMaybeNumber(energy);

  // Use grams for macros, energy as relative contribution (kcal/10 to keep scale reasonable).
  const v = normalizeValues([
    p ?? 0,
    c ?? 0,
    f ?? 0,
    e != null ? e / 10 : 0,
  ]);

  const colors = [
    '#10b981', // proteins
    '#60a5fa', // carbs
    '#f59e0b', // fats
    '#764ba2', // energy
  ];

  // Draw pie with subtle gaps
  const gap = 0.006; // radians gap per slice
  let start = -Math.PI / 2;

  for (let i = 0; i < v.length; i++) {
    const slice = v[i] * (Math.PI * 2);
    const end = start + slice;
    const sliceStart = start + gap;
    const sliceEnd = end - gap;

    // If slice is too small, just skip.
    if (sliceEnd - sliceStart > 0.01) {
      drawArc(cx, cy, radius, sliceStart, sliceEnd, hexToRgba(colors[i], 0.95));
      // Border overlay
      drawArc(cx, cy, radius, sliceStart, sliceEnd, 'rgba(255,255,255,0.05)');
    }
    start = end;
  }

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.54, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fill();

  // Center text
  ctx.fillStyle = 'rgba(17,24,39,0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const label = 'Nutrition';
  ctx.font = '700 14px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText(label, cx, cy - 10);

  const totalText = (() => {
    const pT = p != null ? `${p}g` : '—';
    const cT = c != null ? `${c}g` : '—';
    const fT = f != null ? `${f}g` : '—';
    const eT = e != null ? `${e}kcal` : '—';
    return `${pT} / ${cT} / ${fT}`;
  })();

  ctx.font = '600 11px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial';
  // Wrap-ish: truncate to fit.
  const maxWidth = radius * 1.6;
  const trimmed = totalText.length > 34 ? totalText.slice(0, 33) + '…' : totalText;
  ctx.fillText(trimmed, cx, cy + 10, maxWidth);
}

export { renderNutritionChart };

