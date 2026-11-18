// =====================================================================================
//  plotView.js
//  MI-CHIPS (NSF #2606117): 2D line chart for measurement curves (I–V, C–V, spectra).
//  Point at the chart to read the nearest data point. Explode splits each series onto
//  its own layer, so overlapping curves can be told apart. In focus mode you can hide
//  series, zoom/pan the X axis, and switch between raw, normalized and derivative views.
// =====================================================================================

import { CanvasPanel } from '../render/panel.js';
import { PlotFrame, THEME, PALETTE, sig } from '../render/chart.js';

const TOP = 64 + 150;
export const PLOT_MODES = ['raw', 'normalized', 'derivative'];

export class PlotView extends CanvasPanel {
  constructor(d) {
    const legendRows = Math.ceil(d.series.length / 2);
    super({ title: d.title, width: 0.64, height: 0.53 + legendRows * 0.022, explodable: true });
    this.dataset = d;
    this.kind = 'Plot';
    this.interactables = [this.mesh];
    this.hoverPt = null;

    // Manipulation state (view-level; the dataset itself is never modified)
    this.hidden = new Set();
    this.mode = 'raw';
    const xs = d.series.flatMap((s) => s.points.map((p) => p[0]));
    this.xFull = [Math.min(...xs), Math.max(...xs)];
    this.xWin = [...this.xFull];

    this.frame = new PlotFrame(110, TOP, this.W - 150, 400, 0, 1, 0, 1);
    this.recompute();
    for (const s of d.series) this.addLayer(s.name, (ctx) => this.drawSeries(ctx, s));
  }

  // ---- data transforms -----------------------------------------------------------

  /** Points of one series after the X window and the current mode are applied. */
  transformed(s) {
    let pts = s.points.filter((p) => p[0] >= this.xWin[0] - 1e-12 && p[0] <= this.xWin[1] + 1e-12);
    if (this.mode === 'derivative') {
      const all = s.points;
      pts = pts.map((p) => {
        const i = all.indexOf(p), a = all[Math.max(0, i - 1)], b = all[Math.min(all.length - 1, i + 1)];
        return [p[0], b[0] !== a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0];
      });
    } else if (this.mode === 'normalized') {
      const m = Math.max(...s.points.map((p) => Math.abs(p[1]))) || 1;
      pts = pts.map((p) => [p[0], p[1] / m]);
    }
    return pts;
  }

  visibleSeries() { return this.dataset.series.filter((s) => !this.hidden.has(s.name)); }

  get yLabel() {
    const d = this.dataset;
    return this.mode === 'normalized' ? `${d.yLabel} / max` : this.mode === 'derivative' ? `d(${d.yLabel.split(' (')[0]}) / d(${d.xLabel.split(' (')[0]})` : d.yLabel;
  }

  /** Recomputes the axis ranges from what is currently visible. */
  recompute() {
    this.cache = new Map(this.dataset.series.map((s) => [s.name, this.transformed(s)]));
    const ys = this.visibleSeries().flatMap((s) => this.cache.get(s.name).map((p) => p[1]));
    const ymin = ys.length ? Math.min(...ys) : 0, ymax = ys.length ? Math.max(...ys) : 1;
    const pad = (ymax - ymin || 1) * 0.06;
    const y0 = ymin >= 0 && ymin < (ymax - ymin) * 0.25 ? 0 : ymin - pad; // anchor at zero when data starts near it
    this.frame.setRange(this.xWin[0], this.xWin[1], y0, ymax + pad);
  }

  /** Called after any manipulation. */
  refresh() {
    this.recompute();
    this.pointerLeave();
    this.dirty = this.layersDirty = true;
  }

  // Manipulations (used by the focus toolbar and voice commands)
  toggleSeries(name) { this.hidden.has(name) ? this.hidden.delete(name) : this.hidden.add(name); this.refresh(); }
  setMode(m) { this.mode = m; this.refresh(); }
  zoomX(factor) {
    const [a, b] = this.xWin, c = (a + b) / 2, half = Math.min((this.xFull[1] - this.xFull[0]) / 2, ((b - a) / 2) * factor);
    this.xWin = [Math.max(this.xFull[0], c - half), Math.min(this.xFull[1], c + half)];
    this.refresh();
  }
  panX(dir) {
    const [a, b] = this.xWin, w = b - a, step = w * 0.25 * dir;
    const na = Math.min(Math.max(this.xFull[0], a + step), this.xFull[1] - w);
    this.xWin = [na, na + w];
    this.refresh();
  }
  resetManipulation() { this.hidden.clear(); this.mode = 'raw'; this.xWin = [...this.xFull]; this.refresh(); }

  // ---- drawing --------------------------------------------------------------------

  drawSeries(ctx, s) {
    if (this.hidden.has(s.name)) return;
    const f = this.frame, pts = this.cache.get(s.name) || [];
    ctx.save();
    ctx.beginPath(); ctx.rect(f.x, f.y - 2, f.w, f.h + 4); ctx.clip();
    ctx.strokeStyle = s.color; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(f.px(px), f.py(py)) : ctx.moveTo(f.px(px), f.py(py))));
    ctx.stroke();
    ctx.restore();
  }

  draw(ctx) {
    const d = this.dataset, W = this.W, f = this.frame;
    const zoomed = this.xWin[0] > this.xFull[0] || this.xWin[1] < this.xFull[1];
    const tags = [this.mode !== 'raw' ? this.mode : '', zoomed ? 'zoomed' : '', this.hidden.size ? `${this.hidden.size} hidden` : ''].filter(Boolean);
    this.eyebrow(`${d.category} · plot${tags.length ? ' · ' + tags.join(' · ') : ''}`, 22, 78);
    this.paragraph(d.description || '', 22, 106, W - 44, { size: 19, maxLines: 3 });

    ctx.fillStyle = PALETTE.nightSlate;
    ctx.fillRect(f.x, f.y, f.w, f.h);
    f.drawAxes(ctx, d.xLabel, this.yLabel);


    // Legend, two per row (hidden series dimmed)
    let ly = f.y + f.h + 84;
    d.series.forEach((s, i) => {
      const lx = 30 + (i % 2) * ((W - 60) / 2);
      if (i && i % 2 === 0) ly += 34;
      const off = this.hidden.has(s.name);
      ctx.globalAlpha = off ? 0.35 : 1;
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly + 6, 28, 8);
      this.text(s.name + (off ? ' (hidden)' : ''), lx + 38, ly, { size: 21, color: THEME.caption });
      ctx.globalAlpha = 1;
    });

    this.readoutY = this.H - 91;
    this.text('Point at the chart to read values · tap it to focus', 22, this.H - 78, { size: 22, color: THEME.muted });
    this.text('Source: ' + (d.source || ''), 22, this.H - 42, { size: 17, color: THEME.muted });
  }

  /** Hover uses the 3D cursor + readout strip, so the big panel texture is never redrawn. */
  pointerMove(px, py) {
    const f = this.frame, uv = f.uv(px, py);
    if (!uv) { this.pointerLeave(); return false; }
    let best = Infinity, hit = null;
    for (const s of this.visibleSeries()) {
      for (const p of this.cache.get(s.name)) {
        const du = (p[0] - f.x0) / (f.x1 - f.x0) - uv[0], dv = (p[1] - f.y0) / (f.y1 - f.y0) - uv[1];
        const dist = du * du + dv * dv;
        if (dist < best) { best = dist; hit = { s, p }; }
      }
    }
    if (!hit || best > 0.01) { this.pointerLeave(); return false; }
    if (this.hoverPt && this.hoverPt.p === hit.p) return false;
    this.hoverPt = hit;
    this.setCursor(f.px(hit.p[0]), f.py(hit.p[1]), { ring: PALETTE.orange });
    this.setReadout(`${hit.s.name}:  ${this.dataset.xLabel} = ${sig(hit.p[0])},  ${this.yLabel} = ${sig(hit.p[1])}`);
    this.onInspect?.(`${hit.s.name}: (${sig(hit.p[0])}, ${sig(hit.p[1])})`);
    return false;
  }

  pointerLeave() { this.hoverPt = null; this.hideCursor(); this.setReadout(null); }

  /** Tapping the chart (not a button) asks the host to focus this view. */
  pointerDown(px, py) { return this.frame.uv(px, py) ? { focus: true } : null; }
}
