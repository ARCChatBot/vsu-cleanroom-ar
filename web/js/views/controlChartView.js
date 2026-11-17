// =====================================================================================
//  controlChartView.js
//  MI-CHIPS (NSF #2606117): SPC individuals chart with the centre line, ±1σ/±2σ zones,
//  UCL/LCL, LSL/USL, Western Electric violations and Cp/Cpk/Ppk.
//  Explode separates control limits, spec limits, the data and the violations into layers.
// =====================================================================================

import { CanvasPanel } from '../render/panel.js';
import { PlotFrame, THEME, PALETTE } from '../render/chart.js';

const TOP = 64 + 150;

export class ControlChartView extends CanvasPanel {
  constructor(c) {
    super({ title: c.title, width: 0.84, height: 0.68, explodable: true });
    this.dataset = c;
    this.kind = 'Chart';
    this.interactables = [this.mesh];
    this.hoverIdx = -1;
    this.flagged = new Map(c.violations.map((v) => [v.index, v.rule]));
    const lo = Math.min(c.lcl, c.lsl, ...c.values), hi = Math.max(c.ucl, c.usl, ...c.values), pad = (hi - lo) * 0.08;
    this.frame = new PlotFrame(100, TOP, this.W - 250, 400, 0.5, c.values.length + 0.5, lo - pad, hi + pad);

    this.addLayer('Control limits', (ctx) => {
      for (const k of [1, 2]) {
        this.hline(ctx, c.mean + k * c.sigmaWithin, THEME.grid, 1.5, null, [4, 6]);
        this.hline(ctx, c.mean - k * c.sigmaWithin, THEME.grid, 1.5, null, [4, 6]);
      }
      this.hline(ctx, c.mean, PALETTE.frost, 2, 'CL');
      this.hline(ctx, c.ucl, PALETTE.iceBlue, 3, 'UCL', [14, 6]);
      this.hline(ctx, c.lcl, PALETTE.iceBlue, 3, 'LCL', [14, 6]);
    });
    this.addLayer('Spec limits', (ctx) => {
      this.hline(ctx, c.usl, PALETTE.orange, 3, 'USL');
      this.hline(ctx, c.lsl, PALETTE.orange, 3, 'LSL');
    });
    this.addLayer('Measurements', (ctx) => {
      const f = this.frame;
      ctx.strokeStyle = PALETTE.advisorGray; ctx.lineWidth = 3;
      ctx.beginPath();
      c.values.forEach((v, i) => (i ? ctx.lineTo(f.px(i + 1), f.py(v)) : ctx.moveTo(f.px(i + 1), f.py(v))));
      ctx.stroke();
      c.values.forEach((v, i) => { ctx.fillStyle = PALETTE.iceBlue; ctx.beginPath(); ctx.arc(f.px(i + 1), f.py(v), 5, 0, Math.PI * 2); ctx.fill(); });
    });
    this.addLayer(`Violations (${c.violations.length})`, (ctx) => {
      const f = this.frame;
      for (const { index } of c.violations) {
        ctx.fillStyle = PALETTE.orange;
        ctx.beginPath(); ctx.arc(f.px(index + 1), f.py(c.values[index]), 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = PALETTE.white; ctx.lineWidth = 2; ctx.stroke();
      }
    });
  }

  hline(ctx, v, color, width, label, dash) {
    const f = this.frame;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(f.x, f.py(v)); ctx.lineTo(f.x + f.w, f.py(v)); ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.fillStyle = color; ctx.font = `600 19px ${THEME.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${label} ${v.toFixed(2)}`, f.x + f.w + 10, f.py(v));
    }
  }

  draw(ctx) {
    const c = this.dataset, W = this.W, f = this.frame;
    this.eyebrow(`${c.category} · SPC individuals chart`, 22, 78);
    this.paragraph(c.description || '', 22, 106, W - 44, { size: 19, maxLines: 3 });

    ctx.fillStyle = PALETTE.nightSlate;
    ctx.fillRect(f.x, f.y, f.w, f.h);
    if (c.baseline >= 8) { // Phase-I baseline window in a Trojan Blue tint
      ctx.fillStyle = 'rgba(0,53,142,0.35)';
      ctx.fillRect(f.x, f.y, f.px(c.baseline + 0.5) - f.x, f.h);
      this.text('baseline', f.x + 8, f.y + 6, { size: 17, color: THEME.eyebrow });
    }
    f.drawAxes(ctx, c.sampleLabel || 'Sample', `${c.quantity} (${c.unit})`, { grid: false });
    if (this.hoverIdx >= 0) {
      ctx.strokeStyle = 'rgba(227,237,252,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(f.px(this.hoverIdx + 1), f.y); ctx.lineTo(f.px(this.hoverIdx + 1), f.y + f.h); ctx.stroke();
      ctx.fillStyle = PALETTE.white;
      ctx.beginPath(); ctx.arc(f.px(this.hoverIdx + 1), f.py(c.values[this.hoverIdx]), 11, 0, Math.PI * 2); ctx.fill();
    }

    const sy = f.y + f.h + 82;
    this.text(`Cpk ${c.cpk.toFixed(2)}    Ppk ${c.ppk.toFixed(2)}    Cp ${c.cp.toFixed(2)}`, 22, sy, { size: 27, weight: 700 });
    ctx.fillStyle = PALETTE.orange; ctx.fillRect(22, sy + 36, 46, 4);
    this.text(`Mean ${c.mean.toFixed(2)} ${c.unit}   σ(within) ${c.sigmaWithin.toFixed(3)}   Target ${c.target}   Spec [${c.lsl}, ${c.usl}]   Violations ${c.violations.length}`, 22, sy + 50, { size: 20, color: THEME.muted });

    const i = this.hoverIdx;
    const readout = i >= 0
      ? `${c.sampleLabel || 'Sample'} ${i + 1}:  ${c.values[i].toFixed(2)} ${c.unit}  (${((c.values[i] - c.mean) / c.sigmaWithin).toFixed(1)}σ)${this.flagged.has(i) ? '   ← ' + this.flagged.get(i) : ''}`
      : 'Point at a sample to inspect it';
    this.text(readout, 22, this.H - 50, { size: 22, weight: i >= 0 ? 600 : 400, color: i >= 0 ? PALETTE.iceBlue : THEME.muted });
  }

  pointerMove(px, py) {
    const f = this.frame, uv = f.uv(px, py), n = this.dataset.values.length;
    const idx = uv ? Math.max(0, Math.min(n - 1, Math.round(f.x0 + uv[0] * (f.x1 - f.x0)) - 1)) : -1;
    if (idx === this.hoverIdx) return false;
    this.hoverIdx = idx;
    if (idx >= 0) this.onInspect?.(`${this.dataset.sampleLabel || 'sample'} ${idx + 1} = ${this.dataset.values[idx].toFixed(2)}`);
    return true;
  }

  pointerLeave() { this.hoverIdx = -1; }
}
