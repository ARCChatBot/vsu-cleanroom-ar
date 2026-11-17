// =====================================================================================
//  controlChartView.js
//  MI-CHIPS (NSF #2606117): SPC individuals chart with the centre line, ±1σ/±2σ zones,
//  UCL/LCL, LSL/USL, Western Electric violations (orange) and Cp/Cpk/Ppk.
// =====================================================================================

import { CanvasPanel } from '../render/panel.js';
import { PlotFrame, THEME } from '../render/chart.js';

export class ControlChartView extends CanvasPanel {
  constructor(c) {
    super({ title: c.title, width: 0.82, height: 0.66 });
    this.dataset = c;
    this.kind = 'Chart';
    this.interactables = [this.mesh];
    this.hoverIdx = -1;
    this.flagged = new Map(c.violations.map((v) => [v.index, v.rule]));
    const lo = Math.min(c.lcl, c.lsl, ...c.values), hi = Math.max(c.ucl, c.usl, ...c.values), pad = (hi - lo) * 0.08;
    this.y0 = lo - pad; this.y1 = hi + pad;
  }

  draw(ctx) {
    const c = this.dataset, W = this.W, n = c.values.length;
    let y = this.paragraph(c.description || '', 22, 74, W - 44, { size: 20 });
    y = Math.max(y, 120) + 30;

    const f = (this.frame = new PlotFrame(100, y, W - 230, 400, 0.5, n + 0.5, this.y0, this.y1));
    f.drawAxes(ctx, c.sampleLabel || 'Sample', `${c.quantity} (${c.unit})`, { grid: false });

    const hline = (v, color, width, label, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(f.x, f.py(v)); ctx.lineTo(f.x + f.w, f.py(v)); ctx.stroke();
      ctx.setLineDash([]);
      if (label) this.text(`${label} ${v.toFixed(2)}`, f.x + f.w + 10, f.py(v), { size: 19, color, baseline: 'middle', weight: 600 });
    };
    for (const k of [1, 2]) {
      hline(c.mean + k * c.sigmaWithin, THEME.grid, 1.5, null, [4, 6]);
      hline(c.mean - k * c.sigmaWithin, THEME.grid, 1.5, null, [4, 6]);
    }
    hline(c.mean, THEME.axis, 2, 'CL');
    hline(c.ucl, THEME.orange, 3, 'UCL');
    hline(c.lcl, THEME.orange, 3, 'LCL');
    hline(c.usl, THEME.danger, 3, 'USL', [12, 6]);
    hline(c.lsl, THEME.danger, 3, 'LSL', [12, 6]);

    // Baseline window shading
    if (c.baseline >= 8) {
      ctx.fillStyle = 'rgba(47,164,231,0.08)';
      ctx.fillRect(f.x, f.y, f.px(c.baseline + 0.5) - f.x, f.h);
      this.text('baseline', f.x + 8, f.y + 6, { size: 17, color: THEME.muted });
    }

    ctx.strokeStyle = THEME.line; ctx.lineWidth = 3;
    ctx.beginPath();
    c.values.forEach((v, i) => (i ? ctx.lineTo(f.px(i + 1), f.py(v)) : ctx.moveTo(f.px(i + 1), f.py(v))));
    ctx.stroke();
    c.values.forEach((v, i) => {
      const bad = this.flagged.has(i);
      ctx.fillStyle = i === this.hoverIdx ? '#fff' : bad ? THEME.orange : THEME.line;
      ctx.beginPath(); ctx.arc(f.px(i + 1), f.py(v), i === this.hoverIdx ? 10 : bad ? 8 : 5, 0, Math.PI * 2); ctx.fill();
    });
    if (this.hoverIdx >= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(f.px(this.hoverIdx + 1), f.y); ctx.lineTo(f.px(this.hoverIdx + 1), f.y + f.h); ctx.stroke();
    }

    // Capability and rule summary
    let sy = f.y + f.h + 80;
    this.text(`Cpk ${c.cpk.toFixed(2)}    Ppk ${c.ppk.toFixed(2)}    Cp ${c.cp.toFixed(2)}`, 22, sy, { size: 26, weight: 700, color: THEME.orange });
    this.text(`Mean ${c.mean.toFixed(2)} ${c.unit}   σ(within) ${c.sigmaWithin.toFixed(3)}   Target ${c.target}   Spec [${c.lsl}, ${c.usl}]   Violations: ${c.violations.length}`, 22, sy + 38, { size: 20 });

    const i = this.hoverIdx;
    const readout = i >= 0
      ? `${c.sampleLabel || 'Sample'} ${i + 1}:  ${c.values[i].toFixed(2)} ${c.unit}  (${((c.values[i] - c.mean) / c.sigmaWithin).toFixed(1)}σ)${this.flagged.has(i) ? '   ← ' + this.flagged.get(i) : ''}`
      : 'Point at a sample to inspect it';
    this.text(readout, 22, this.H - 50, { size: 22, weight: i >= 0 ? 600 : 400, color: i >= 0 ? THEME.ink : THEME.muted });
  }

  pointerMove(px, py) {
    const uv = this.frame?.uv(px, py);
    const n = this.dataset.values.length;
    const idx = uv ? Math.max(0, Math.min(n - 1, Math.round(this.frame.x0 + uv[0] * (this.frame.x1 - this.frame.x0)) - 1)) : -1;
    if (idx === this.hoverIdx) return false;
    this.hoverIdx = idx;
    if (idx >= 0) this.onInspect?.(`lot ${idx + 1} = ${this.dataset.values[idx].toFixed(2)}`);
    return true;
  }

  pointerLeave() { this.hoverIdx = -1; }
}
