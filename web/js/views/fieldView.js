// =====================================================================================
//  fieldView.js
//  MI-CHIPS (NSF #2606117): 2D field panel. A heatmap and/or contour plot with axes,
//  a colourbar, a pointer readout and a button to open the field as a 3D surface.
//  Explode separates the heatmap, iso-lines and highlight contours (spec / threshold)
//  into a 3D layer stack.
// =====================================================================================

import { CanvasPanel } from '../render/panel.js';
import { PlotFrame, THEME, PALETTE, niceTicks, fmt, sig } from '../render/chart.js';
import { COLORMAPS, defaultColormapIndex } from '../render/colormap.js';
import { contourLevels, computeContours } from '../render/contours.js';
import { fieldAt, normalize, colorNorm, sampleUV, dataX, dataY } from '../data/datasets.js';

const PLOT_W = 600, TOP = 64 + 168;

export class FieldView extends CanvasPanel {
  constructor(f) {
    const aspect = Math.min(1.1, Math.max(0.4, (f.yMax - f.yMin) / (f.xMax - f.xMin) || 1));
    const plotH = Math.round(PLOT_W * aspect);
    super({ title: f.title, width: 0.62, height: (TOP + plotH + 90 + 200) / 1600, explodable: true });
    this.dataset = f;
    this.kind = '2D';
    this.interactables = [this.mesh];
    this.plotH = plotH;
    this.showHeat = true;
    this.showContours = true;
    this.count = f.contourCount || 10;
    this.cmapIdx = defaultColormapIndex(f);
    this.frame = new PlotFrame(110, TOP, PLOT_W, plotH, f.xMin, f.xMax, f.yMin, f.yMax);

    this.addLayer('Heatmap', (ctx) => { if (this.showHeat) this.drawHeat(ctx); });
    this.addLayer('Iso-lines', (ctx) => { if (this.showContours) this.drawContours(ctx, false); });
    if (f.highlightLevels?.length) this.addLayer(f.diverging ? 'Spec limits' : 'Threshold', (ctx) => this.drawContours(ctx, true));
    this.rebuild();
  }

  get cmap() { return COLORMAPS[this.cmapIdx]; }

  rebuild() {
    const f = this.dataset;
    const img = document.createElement('canvas');
    img.width = f.nx; img.height = f.ny;
    const ictx = img.getContext('2d'), data = ictx.createImageData(f.nx, f.ny);
    for (let y = 0; y < f.ny; y++) {
      for (let x = 0; x < f.nx; x++) {
        const [r, g, b] = this.cmap.rgb(colorNorm(f, fieldAt(f, x, y)));
        const o = ((f.ny - 1 - y) * f.nx + x) * 4; // image row 0 = top = yMax
        data.data[o] = r * 255; data.data[o + 1] = g * 255; data.data[o + 2] = b * 255; data.data[o + 3] = 255;
      }
    }
    ictx.putImageData(data, 0, 0);
    this.heatImg = img;
    this.segments = computeContours(f, contourLevels(f, this.count));
    this.dirty = this.layersDirty = true;
  }

  drawHeat(ctx) {
    const fr = this.frame;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.heatImg, fr.x, fr.y, fr.w, fr.h);
  }

  drawContours(ctx, highlight) {
    const fr = this.frame, f = this.dataset;
    for (const s of this.segments) {
      if (s.highlight !== highlight) continue;
      ctx.strokeStyle = highlight ? PALETTE.orange : this.showHeat ? 'rgba(227,237,252,0.85)' : this.cmap.css(colorNorm(f, s.level));
      ctx.lineWidth = highlight ? 5 : 2;
      ctx.beginPath();
      ctx.moveTo(fr.x + s.a[0] * fr.w, fr.y + (1 - s.a[1]) * fr.h);
      ctx.lineTo(fr.x + s.b[0] * fr.w, fr.y + (1 - s.b[1]) * fr.h);
      ctx.stroke();
    }
  }

  draw(ctx) {
    const f = this.dataset, fr = this.frame;
    this.eyebrow(`${f.category} · 2D field`, 22, 78);
    this.text(`${f.quantity} (${f.unit})`, 22, 104, { size: 25, weight: 700 });
    this.paragraph(f.description || '', 22, 140, this.W - 44, { size: 19, maxLines: 3 });

    // Plot well (layers draw the data on top of it)
    ctx.fillStyle = PALETTE.nightSlate;
    ctx.fillRect(fr.x, fr.y, fr.w, fr.h);
    fr.drawAxes(ctx, f.xLabel, f.yLabel, { grid: false });

    // Colourbar
    const bx = fr.x + fr.w + 26, bw = 26;
    const grad = ctx.createLinearGradient(0, fr.y + fr.h, 0, fr.y);
    for (let i = 0; i <= 16; i++) { const v = f.min + (i / 16) * (f.max - f.min); grad.addColorStop(i / 16, this.cmap.css(colorNorm(f, v))); }
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
      ctx.strokeStyle = PALETTE.orange; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(bx - 4, yOf(h)); ctx.lineTo(bx + bw + 4, yOf(h)); ctx.stroke();
    }
    // Idle readout line (the live readout is a small overlay strip drawn on top of it)
    let y = fr.y + fr.h + 84;
    this.readoutY = y - 13;
    this.text('Point at the field to read values · tap it to focus', 22, y, { size: 22, color: THEME.muted });
    y += 44;
    let x = 22;
    x = this.button('Heatmap', x, y, 140, 46, () => { this.showHeat = !this.showHeat; this.layersDirty = true; }, { active: this.showHeat });
    x = this.button('Contours', x, y, 150, 46, () => { this.showContours = !this.showContours; this.layersDirty = true; }, { active: this.showContours });
    x = this.button('−', x, y, 50, 46, () => { this.count = Math.max(3, this.count - 1); this.rebuild(); });
    this.text(`${this.count} levels`, x, y + 23, { size: 20, baseline: 'middle', color: THEME.caption });
    x += 100;
    this.button('+', x, y, 50, 46, () => { this.count = Math.min(30, this.count + 1); this.rebuild(); });
    y += 58; x = 22;
    x = this.button('Colormap: ' + this.cmap.name, x, y, 300, 46, () => { this.cmapIdx = (this.cmapIdx + 1) % COLORMAPS.length; this.rebuild(); });
    this.button('Open 3D surface', x, y, 230, 46, () => this.onOpenField?.(f, '3D'), { primary: true });
    this.text('Source: ' + (f.source || ''), 22, this.H - 36, { size: 17, color: THEME.muted });
  }

  /** Hover uses the 3D cursor + readout strip, so the big panel texture is never redrawn. */
  pointerMove(px, py) {
    const fr = this.frame, uv = fr.uv(px, py);
    if (!uv) { this.pointerLeave(); return false; }
    const f = this.dataset, x = dataX(f, uv[0]), y = dataY(f, uv[1]), value = sampleUV(f, uv[0], uv[1]);
    this.setCursor(fr.x + uv[0] * fr.w, fr.y + (1 - uv[1]) * fr.h);
    this.setReadout(`${f.xLabel} = ${sig(x, 3)},  ${f.yLabel} = ${sig(y, 3)}   →   ${f.quantity} = ${sig(value)} ${f.unit}`);
    this.onInspect?.(`${f.quantity}=${sig(value)} at (${sig(x, 3)}, ${sig(y, 3)})`);
    return false;
  }

  pointerLeave() { this.hideCursor(); this.setReadout(null); }

  /** Tapping the field (not a button) asks the host to focus this view. */
  pointerDown(px, py) { return this.frame.uv(px, py) ? { focus: true } : null; }

  /** Re-render after the dataset was manipulated (colour window, threshold). */
  refresh() { this.rebuild(); }
}
