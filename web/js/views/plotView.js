// =====================================================================================
//  plotView.js
//  MI-CHIPS (NSF #2606117): 2D line chart for measurement curves (I–V, C–V, spectra).
//  Point at the chart to read the nearest data point.
// =====================================================================================

import { CanvasPanel } from '../render/panel.js';
import { PlotFrame, THEME, sig } from '../render/chart.js';

export class PlotView extends CanvasPanel {
  constructor(d) {
    const legendRows = Math.ceil(d.series.length / 2);
    super({ title: d.title, width: 0.64, height: 0.50 + legendRows * 0.02 });
    this.dataset = d;
    this.kind = 'Plot';
    this.interactables = [this.mesh];
    this.readout = 'Point at the chart to read values';
    this.hoverPt = null;

    const pts = d.series.flatMap((s) => s.points);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    this.x0 = Math.min(...xs); this.x1 = Math.max(...xs);
    const ymin = Math.min(...ys), ymax = Math.max(...ys), pad = (ymax - ymin) * 0.06;
    this.y0 = ymin >= 0 && ymin < (ymax - ymin) * 0.25 ? 0 : ymin - pad; // anchor at zero when data starts near it
    this.y1 = ymax + pad;
  }

  draw(ctx) {
    const d = this.dataset, W = this.W;
    let y = this.paragraph(d.description || '', 22, 74, W - 44, { size: 20 });
    y = Math.max(y, 120) + 30;

    const f = (this.frame = new PlotFrame(110, y, W - 150, 400, this.x0, this.x1, this.y0, this.y1));
    f.drawAxes(ctx, d.xLabel, d.yLabel);

    ctx.save();
    ctx.beginPath(); ctx.rect(f.x, f.y - 2, f.w, f.h + 4); ctx.clip();
    for (const s of d.series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 4;
      ctx.beginPath();
      s.points.forEach(([px, py], i) => (i ? ctx.lineTo(f.px(px), f.py(py)) : ctx.moveTo(f.px(px), f.py(py))));
      ctx.stroke();
    }
    if (this.hoverPt) {
      const [hx, hy] = this.hoverPt.p;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(f.px(hx), f.y + f.h); ctx.lineTo(f.px(hx), f.py(hy)); ctx.lineTo(f.x, f.py(hy)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = THEME.orange; ctx.beginPath(); ctx.arc(f.px(hx), f.py(hy), 9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Legend, two per row
    let ly = f.y + f.h + 82;
    d.series.forEach((s, i) => {
      const lx = 30 + (i % 2) * ((W - 60) / 2);
      if (i && i % 2 === 0) ly += 34;
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly + 6, 28, 8);
      this.text(s.name, lx + 38, ly, { size: 21 });
    });

    this.text(this.readout, 22, this.H - 78, { size: 22, color: this.hoverPt ? THEME.ink : THEME.muted, weight: this.hoverPt ? 600 : 400 });
    this.text('Source: ' + (d.source || ''), 22, this.H - 42, { size: 18, color: THEME.muted });
  }

  pointerMove(px, py) {
    const uv = this.frame?.uv(px, py);
    if (!uv) { if (this.hoverPt) { this.hoverPt = null; return true; } return false; }
    let best = Infinity, hit = null;
    for (const s of this.dataset.series) {
      for (const p of s.points) {
        const du = (p[0] - this.x0) / (this.x1 - this.x0) - uv[0], dv = (p[1] - this.y0) / (this.y1 - this.y0) - uv[1];
        const dist = du * du + dv * dv;
        if (dist < best) { best = dist; hit = { s, p }; }
      }
    }
    if (!hit || best > 0.01) return false;
    if (this.hoverPt && this.hoverPt.p === hit.p) return false;
    this.hoverPt = hit;
    this.readout = `${hit.s.name}:  ${this.dataset.xLabel} = ${sig(hit.p[0])},  ${this.dataset.yLabel} = ${sig(hit.p[1])}`;
    this.onInspect?.(this.readout);
    return true;
  }

  pointerLeave() { this.hoverPt = null; }
}
