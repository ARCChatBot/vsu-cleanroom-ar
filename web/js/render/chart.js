// =====================================================================================
//  chart.js
//  MI-CHIPS (NSF #2606117): 2D chart helpers for canvas panels: nice ticks, number
//  formatting, a plot frame (data ↔ pixel mapping, axes) and text wrapping.
// =====================================================================================

/** Operation SEMI / MI-CHIPS presentation color system (C01–C12). */
export const PALETTE = {
  deepSlate: '#0B0F19',    // C01 Deep Academic Slate: primary dark surface
  white: '#FFFFFF',        // C02 Presentation White: headlines on dark
  trojanBlue: '#00358E',   // C03 Trojan Blue: brand blue, primary actions
  orange: '#FF6700',       // C04 Precision Orange: small accents and highlights only
  nightSlate: '#111928',   // C05 Night Slate: secondary dark surfaces
  bodySilver: '#A6AFC1',   // C06 Body Silver: body copy on dark
  labelSlate: '#53617A',   // C07 Label Slate: borders/secondary on dark
  softWhite: '#FAFBFD',    // C08 Soft White
  divider: '#E0E5EC',      // C09 Divider Gray
  iceBlue: '#73C5FB',      // C10 Technology Ice Blue: indicators and highlights on dark
  advisorGray: '#A4B4D0',  // C11 Advisor Blue Gray: eyebrow text on dark
  frost: '#E3EDFC',        // C12 Caption Frost: bright captions on dark
};

export const THEME = {
  font: 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
  ink: PALETTE.white,
  muted: PALETTE.bodySilver,
  eyebrow: PALETTE.advisorGray,
  caption: PALETTE.frost,
  axis: PALETTE.advisorGray,
  grid: 'rgba(83,97,122,0.45)',
  orange: PALETTE.orange,
  ice: PALETTE.iceBlue,
  blue: PALETTE.trojanBlue,
  line: PALETTE.iceBlue,
  surface: PALETTE.deepSlate,
  surface2: PALETTE.nightSlate,
  border: PALETTE.labelSlate,
};

/** Ordered series colours on dark surfaces (low → high emphasis; orange last as the highlight). */
export const SERIES_COLORS = [PALETTE.advisorGray, PALETTE.iceBlue, PALETTE.frost, PALETTE.white, PALETTE.orange];
/** Unordered series colours (CSV imports). */
export const CATEGORY_COLORS = [PALETTE.iceBlue, PALETTE.orange, PALETTE.frost, PALETTE.advisorGray, PALETTE.bodySilver, PALETTE.white];

export function niceTicks(lo, hi, target = 5) {
  const nice = (x, round) => {
    if (x <= 0) return 0;
    const e = Math.floor(Math.log10(x)), f = x / 10 ** e;
    const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
    return nf * 10 ** e;
  };
  const step = nice(nice(hi - lo, false) / Math.max(1, target - 1), true);
  const ticks = [];
  if (!(step > 0)) return { ticks, step: 1 };
  for (let t = Math.ceil(lo / step - 1e-6) * step; t <= hi + step * 1e-6; t += step) ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  return { ticks, step };
}

export function fmt(v, step) {
  const dec = step > 0 ? Math.max(0, Math.min(5, Math.ceil(-Math.log10(step) - 1e-9))) : 2;
  return v.toFixed(dec);
}

/** Significant-figure formatting for readouts. */
export const sig = (v, n = 4) => (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(n - 1) : Number(v.toPrecision(n)).toString());

export function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** A plot rectangle in canvas pixels with a data range. y grows upward in data space. */
export class PlotFrame {
  constructor(x, y, w, h, x0 = 0, x1 = 1, y0 = 0, y1 = 1) {
    Object.assign(this, { x, y, w, h });
    this.setRange(x0, x1, y0, y1);
  }

  setRange(x0, x1, y0, y1) {
    this.x0 = x0; this.x1 = x1 === x0 ? x0 + 1 : x1;
    this.y0 = y0; this.y1 = y1 === y0 ? y0 + 1 : y1;
  }

  px(xv) { return this.x + ((xv - this.x0) / (this.x1 - this.x0)) * this.w; }
  py(yv) { return this.y + this.h - ((yv - this.y0) / (this.y1 - this.y0)) * this.h; }
  /** Pixel → normalized (u, v) with v up; null if outside. */
  uv(px, py) {
    const u = (px - this.x) / this.w, v = 1 - (py - this.y) / this.h;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u, v] : null;
  }

  drawAxes(ctx, xLabel, yLabel, { grid = true, s = 1 } = {}) {
    const { x, y, w, h } = this;
    ctx.save();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = THEME.axis;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
    ctx.font = `${20 * s}px ${THEME.font}`;
    ctx.fillStyle = THEME.muted;

    const xt = niceTicks(this.x0, this.x1, 6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const t of xt.ticks) {
      const p = this.px(t);
      if (grid) { ctx.strokeStyle = THEME.grid; ctx.lineWidth = 1 * s; ctx.beginPath(); ctx.moveTo(p, y); ctx.lineTo(p, y + h); ctx.stroke(); }
      ctx.strokeStyle = THEME.axis; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(p, y + h); ctx.lineTo(p, y + h + 8 * s); ctx.stroke();
      ctx.fillText(fmt(t, xt.step), p, y + h + 11 * s);
    }
    const yt = niceTicks(this.y0, this.y1, 5);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of yt.ticks) {
      const p = this.py(t);
      if (grid) { ctx.strokeStyle = THEME.grid; ctx.lineWidth = 1 * s; ctx.beginPath(); ctx.moveTo(x, p); ctx.lineTo(x + w, p); ctx.stroke(); }
      ctx.strokeStyle = THEME.axis; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(x, p); ctx.lineTo(x - 8 * s, p); ctx.stroke();
      ctx.fillText(fmt(t, yt.step), x - 12 * s, p);
    }

    ctx.fillStyle = THEME.ink;
    ctx.font = `600 ${22 * s}px ${THEME.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (xLabel) ctx.fillText(xLabel, x + w / 2, y + h + 40 * s);
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    if (yLabel) ctx.fillText(yLabel, x - 50 * s, y - 10 * s);
    ctx.restore();
  }
}
