// =====================================================================================
//  fieldView.js
//  MI-CHIPS (NSF #2606117): 2D field panel. A heatmap and/or contour plot with axes, a
//  colourbar (orange ticks mark highlight levels), a pointer readout, and a button to
//  open the field as a 3D surface.
// =====================================================================================

import { CanvasPanel } from '../render/panel.js';
import { PlotFrame, THEME, niceTicks, fmt, sig } from '../render/chart.js';
import { COLORMAPS, defaultColormapIndex } from '../render/colormap.js';
import { contourLevels, computeContours } from '../render/contours.js';
import { fieldAt, normalize, sampleUV, dataX, dataY } from '../data/datasets.js';

const PLOT_W = 600;

export class FieldView extends CanvasPanel {
  constructor(f) {
    const aspect = Math.min(1.1, Math.max(0.4, (f.yMax - f.yMin) / (f.xMax - f.xMin) || 1));
    const plotH = Math.round(PLOT_W * aspect);
    super({ title: f.title + '  ·  2D', width: 0.62, height: (60 + 140 + plotH + 90 + 200) / 1600 });
    this.dataset = f;
    this.kind = '2D';
    this.interactables = [this.mesh];
    this.plotH = plotH;
    this.showHeat = true;
    this.showContours = true;
    this.count = f.contourCount || 10;
    this.cmapIdx = defaultColormapIndex(f);
    this.hover = null;
    this.rebuild();
  }

  get cmap() { return COLORMAPS[this.cmapIdx]; }

  rebuild() {
    const f = this.dataset;
    // Heatmap image at grid resolution; the browser smooths it when scaling.
    const img = document.createElement('canvas');
    img.width = f.nx; img.height = f.ny;
    const ictx = img.getContext('2d'), data = ictx.createImageData(f.nx, f.ny);
    for (let y = 0; y < f.ny; y++) {
      for (let x = 0; x < f.nx; x++) {
        const [r, g, b] = this.cmap.rgb(normalize(f, fieldAt(f, x, y)));
        const o = ((f.ny - 1 - y) * f.nx + x) * 4; // image row 0 = top = yMax
        data.data[o] = r * 255; data.data[o + 1] = g * 255; data.data[o + 2] = b * 255; data.data[o + 3] = 255;
      }
    }
    ictx.putImageData(data, 0, 0);
    this.heatImg = img;
    this.segments = computeContours(f, contourLevels(f, this.count));
    this.dirty = true;
  }

  draw(ctx) {
    const f = this.dataset;
    this.text(`${f.quantity} (${f.unit})`, 22, 72, { size: 24, weight: 700 });
    this.paragraph(f.description || '', 22, 106, this.W - 44, { size: 19 });

    const top = 60 + 140;
    const fr = (this.frame = new PlotFrame(110, top, PLOT_W, this.plotH, f.xMin, f.xMax, f.yMin, f.yMax));

    if (this.showHeat) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.heatImg, fr.x, fr.y, fr.w, fr.h);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(fr.x, fr.y, fr.w, fr.h);
    }
    if (this.showContours) {
      for (const s of this.segments) {
        ctx.strokeStyle = s.highlight ? THEME.orange : this.showHeat ? 'rgba(255,255,255,0.75)' : this.cmap.css(normalize(f, s.level));
        ctx.lineWidth = s.highlight ? 5 : 2;
        ctx.beginPath();
        ctx.moveTo(fr.x + s.a[0] * fr.w, fr.y + (1 - s.a[1]) * fr.h);
        ctx.lineTo(fr.x + s.b[0] * fr.w, fr.y + (1 - s.b[1]) * fr.h);
        ctx.stroke();
      }
    }
    fr.drawAxes(ctx, f.xLabel, f.yLabel, { grid: false });

    // Colourbar
    const bx = fr.x + fr.w + 26, bw = 26;
    const grad = ctx.createLinearGradient(0, fr.y + fr.h, 0, fr.y);
    for (let i = 0; i <= 16; i++) grad.addColorStop(i / 16, this.cmap.css(i / 16));
    ctx.fillStyle = grad; ctx.fillRect(bx, fr.y, bw, fr.h);
    const yOf = (v) => fr.y + fr.h - normalize(f, v) * fr.h;
    const t = niceTicks(f.min, f.max, 6);
    for (const v of t.ticks) {
      ctx.strokeStyle = THEME.axis; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx + bw, yOf(v)); ctx.lineTo(bx + bw + 7, yOf(v)); ctx.stroke();
      this.text(fmt(v, t.step), bx + bw + 11, yOf(v), { size: 18, color: THEME.muted, baseline: 'middle' });
    }
    for (const h of f.highlightLevels || []) {
      if (h < f.min || h > f.max) continue;
      ctx.strokeStyle = THEME.orange; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(bx - 4, yOf(h)); ctx.lineTo(bx + bw + 4, yOf(h)); ctx.stroke();
    }

    // Cursor
    if (this.hover) {
      const hx = fr.x + this.hover.u * fr.w, hy = fr.y + (1 - this.hover.v) * fr.h;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hx - 14, hy); ctx.lineTo(hx + 14, hy); ctx.moveTo(hx, hy - 14); ctx.lineTo(hx, hy + 14); ctx.stroke();
      ctx.strokeStyle = THEME.orange; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx - 6, yOf(this.hover.value)); ctx.lineTo(bx + bw + 6, yOf(this.hover.value)); ctx.stroke();
    }

    // Readout + controls
    let y = fr.y + fr.h + 84;
    const readout = this.hover
      ? `${f.xLabel} = ${sig(this.hover.x, 3)},  ${f.yLabel} = ${sig(this.hover.y, 3)}   →   ${f.quantity} = ${sig(this.hover.value)} ${f.unit}`
      : 'Point at the field to read values';
    this.text(readout, 22, y, { size: 22, weight: this.hover ? 600 : 400, color: this.hover ? THEME.ink : THEME.muted });
    y += 44;
    let x = 22;
    x = this.button('Heatmap', x, y, 130, 46, () => { this.showHeat = !this.showHeat; }, { active: this.showHeat });
    x = this.button('Contours', x, y, 140, 46, () => { this.showContours = !this.showContours; }, { active: this.showContours });
    x = this.button('−', x, y, 50, 46, () => { this.count = Math.max(3, this.count - 1); this.rebuild(); });
    this.text(`${this.count} levels`, x, y + 23, { size: 20, baseline: 'middle' });
    x += 100;
    x = this.button('+', x, y, 50, 46, () => { this.count = Math.min(30, this.count + 1); this.rebuild(); });
    y += 58;
    x = 22;
    x = this.button('Colormap: ' + this.cmap.name, x, y, 290, 46, () => { this.cmapIdx = (this.cmapIdx + 1) % COLORMAPS.length; this.rebuild(); });
    this.button('Open 3D surface', x, y, 230, 46, () => this.onOpenField?.(f, '3D'));
    this.text('Source: ' + (f.source || ''), 22, this.H - 36, { size: 17, color: THEME.muted });
  }

  pointerMove(px, py) {
    const uv = this.frame?.uv(px, py);
    if (!uv) { if (this.hover) { this.hover = null; return true; } return false; }
    const f = this.dataset;
    this.hover = { u: uv[0], v: uv[1], x: dataX(f, uv[0]), y: dataY(f, uv[1]), value: sampleUV(f, uv[0], uv[1]) };
    this.onInspect?.(`${f.quantity}=${sig(this.hover.value)}`);
    return true;
  }

  pointerLeave() { this.hover = null; }
}
