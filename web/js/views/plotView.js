// =====================================================================================
//  plotView.js
//  MI-CHIPS (NSF #2606117): 2D line chart for measurement curves (I–V, C–V, spectra).
//  Point at the chart to read the nearest data point. Explode splits each series onto
//  its own layer, so overlapping curves can be told apart.
// =====================================================================================

import { CanvasPanel } from '../render/panel.js';
import { PlotFrame, THEME, PALETTE, sig } from '../render/chart.js';

const TOP = 64 + 150;

export class PlotView extends CanvasPanel {
  constructor(d) {
    const legendRows = Math.ceil(d.series.length / 2);
    super({ title: d.title, width: 0.64, height: 0.53 + legendRows * 0.022, explodable: true });
    this.dataset = d;
    this.kind = 'Plot';
    this.interactables = [this.mesh];
    this.hoverPt = null;

    const pts = d.series.flatMap((s) => s.points);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const ymin = Math.min(...ys), ymax = Math.max(...ys), pad = (ymax - ymin) * 0.06;
    const y0 = ymin >= 0 && ymin < (ymax - ymin) * 0.25 ? 0 : ymin - pad; // anchor at zero when data starts near it
    this.frame = new PlotFrame(110, TOP, this.W - 150, 400, x0, x1, y0, ymax + pad);

    for (const s of d.series) this.addLayer(s.name, (ctx) => this.drawSeries(ctx, s));
  }

  drawSeries(ctx, s) {
    const f = this.frame;
    ctx.save();
    ctx.beginPath(); ctx.rect(f.x, f.y - 2, f.w, f.h + 4); ctx.clip();
    ctx.strokeStyle = s.color; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.beginPath();
    s.points.forEach(([px, py], i) => (i ? ctx.lineTo(f.px(px), f.py(py)) : ctx.moveTo(f.px(px), f.py(py))));
    ctx.stroke();
    ctx.restore();
  }

  draw(ctx) {
    const d = this.dataset, W = this.W, f = this.frame;
    this.eyebrow(`${d.category} · plot`, 22, 78);
    this.paragraph(d.description || '', 22, 106, W - 44, { size: 19, maxLines: 3 });

    ctx.fillStyle = PALETTE.nightSlate;
    ctx.fillRect(f.x, f.y, f.w, f.h);
    f.drawAxes(ctx, d.xLabel, d.yLabel);

    if (this.hoverPt) {
      const [hx, hy] = this.hoverPt.p;
      ctx.strokeStyle = 'rgba(227,237,252,0.75)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(f.px(hx), f.y + f.h); ctx.lineTo(f.px(hx), f.py(hy)); ctx.lineTo(f.x, f.py(hy)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = PALETTE.orange; ctx.beginPath(); ctx.arc(f.px(hx), f.py(hy), 9, 0, Math.PI * 2); ctx.fill();
    }

    // Legend, two per row
    let ly = f.y + f.h + 84;
    d.series.forEach((s, i) => {
      const lx = 30 + (i % 2) * ((W - 60) / 2);
      if (i && i % 2 === 0) ly += 34;
      ctx.fillStyle = s.color; ctx.fillRect(lx, ly + 6, 28, 8);
      this.text(s.name, lx + 38, ly, { size: 21, color: THEME.caption });
    });

    const readout = this.hoverPt
      ? `${this.hoverPt.s.name}:  ${d.xLabel} = ${sig(this.hoverPt.p[0])},  ${d.yLabel} = ${sig(this.hoverPt.p[1])}`
      : 'Point at the chart to read values';
    this.text(readout, 22, this.H - 78, { size: 22, color: this.hoverPt ? PALETTE.iceBlue : THEME.muted, weight: this.hoverPt ? 600 : 400 });
    this.text('Source: ' + (d.source || ''), 22, this.H - 42, { size: 17, color: THEME.muted });
  }

  pointerMove(px, py) {
    const f = this.frame, uv = f.uv(px, py);
    if (!uv) { if (this.hoverPt) { this.hoverPt = null; return true; } return false; }
    let best = Infinity, hit = null;
    for (const s of this.dataset.series) {
      for (const p of s.points) {
        const du = (p[0] - f.x0) / (f.x1 - f.x0) - uv[0], dv = (p[1] - f.y0) / (f.y1 - f.y0) - uv[1];
        const dist = du * du + dv * dv;
        if (dist < best) { best = dist; hit = { s, p }; }
      }
    }
    if (!hit || best > 0.01 || (this.hoverPt && this.hoverPt.p === hit.p)) return false;
    this.hoverPt = hit;
    this.onInspect?.(`${hit.s.name}: (${sig(hit.p[0])}, ${sig(hit.p[1])})`);
    return true;
  }

  pointerLeave() { this.hoverPt = null; }
}
