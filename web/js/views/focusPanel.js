// =====================================================================================
//  focusPanel.js
//  MI-CHIPS (NSF #2606117): the data toolbar shown under a focused view. The controls
//  depend on the kind of data:
//    plot   show/hide curves · zoom & pan X · raw / normalized / derivative
//    field  colour window (low/high) · movable threshold contour with % area above · contours
//    wafer  LSL / USL · show all dies or only out-of-spec
//    spc    LSL / USL · baseline length (limits, Cpk/Ppk and rule violations recompute)
//  Every change is non-destructive and "Reset data" restores the original values.
// =====================================================================================

import { CanvasPanel, PX_PER_M } from '../render/panel.js';
import { THEME, PALETTE, sig } from '../render/chart.js';
import { PLOT_MODES } from './plotView.js';
import { fractionAbove, snapshot, restore } from '../data/datasets.js';

const ROW_H = 64;

export class FocusPanel extends CanvasPanel {
  constructor(view, app) {
    const spec = buildSpec(view, app);
    super({
      title: 'Focus  ·  ' + view.dataset.title,
      width: 0.68,
      height: (64 + 116 + spec.rows.length * ROW_H + 92) / PX_PER_M,
      closable: true, draggable: false, scalable: false,
    });
    this.view = view;
    this.app = app;
    this.spec = spec;
    this.kind = 'focus';
    this.interactables = [this.mesh];
    this.onClose = () => app.exitFocus();
  }

  draw() {
    this.eyebrow('Focus mode · manipulate the data', 22, 78);
    this.text(this.spec.summary(), 22, 106, { size: 23, weight: 700, color: PALETTE.iceBlue });

    let y = 160;
    for (const row of this.spec.rows) {
      this.text(row.label, 22, y + 23, { size: 19, weight: 700, color: THEME.eyebrow, baseline: 'middle' });
      let x = 230;
      if (row.value) {
        this.text(row.value(), x, y + 23, { size: 21, color: PALETTE.white, baseline: 'middle' });
        x += row.valueW ?? 190;
      }
      for (const b of row.buttons()) {
        const w = b.w ?? Math.max(56, 28 + b.label.length * 12);
        x = this.button(b.label, x, y, w, 46, () => { b.onClick(); this.dirty = true; }, { active: b.active });
      }
      y += ROW_H;
    }

    y = this.H - 72;
    let x = 22;
    x = this.button('Reset data', x, y, 170, 50, () => { this.spec.reset(); this.dirty = true; });
    x = this.button(this.view.exploded ? 'Collapse' : 'Explode', x, y, 150, 50, () => { this.view.setExploded(!this.view.exploded); this.dirty = true; }, { active: this.view.exploded });
    this.button('Done', x, y, 130, 50, () => this.app.exitFocus(), { primary: true });
  }
}

/** Builds { summary(), rows[{label, value?, buttons()}], reset() } for a view. */
function buildSpec(view, app) {
  const d = view.dataset;
  const changed = () => app.dataChanged(d);

  if (d.kind === 'plot') {
    const short = (name) => (name.includes('=') ? name.split('=').pop().trim() : name.length > 14 ? name.slice(0, 13) + '…' : name);
    return {
      summary: () => `${view.visibleSeries().length}/${d.series.length} curves · ${view.mode} · ${d.xLabel} ${sig(view.xWin[0], 3)} – ${sig(view.xWin[1], 3)}`,
      rows: [
        { label: 'Curves', buttons: () => d.series.map((s) => ({ label: short(s.name), active: !view.hidden.has(s.name), onClick: () => view.toggleSeries(s.name) })) },
        { label: 'X range', value: () => `${sig(view.xWin[0], 3)} – ${sig(view.xWin[1], 3)}`, buttons: () => [
          { label: '◀', w: 56, onClick: () => view.panX(-1) },
          { label: '▶', w: 56, onClick: () => view.panX(1) },
          { label: 'Zoom in', onClick: () => view.zoomX(0.6) },
          { label: 'Zoom out', onClick: () => view.zoomX(1 / 0.6) },
        ] },
        { label: 'View', buttons: () => PLOT_MODES.map((m) => ({ label: m === 'derivative' ? 'dY/dX' : m[0].toUpperCase() + m.slice(1), active: view.mode === m, onClick: () => view.setMode(m) })) },
      ],
      reset: () => view.resetManipulation(),
    };
  }

  if (d.kind === 'field') {
    const step = (d.max - d.min) / 20;
    const lo = () => d.colorLo ?? d.min, hi = () => d.colorHi ?? d.max;
    const keep = () => snapshot(d, ['colorLo', 'colorHi', 'userThreshold']);
    const setLo = (v) => { keep(); d.colorLo = Math.min(Math.max(d.min, v), hi() - step); changed(); };
    const setHi = (v) => { keep(); d.colorHi = Math.max(Math.min(d.max, v), lo() + step); changed(); };
    const setThr = (v) => { keep(); d.userThreshold = v == null ? null : Math.min(d.max - step / 2, Math.max(d.min + step / 2, v)); changed(); };
    const rows = [
      { label: 'Colour low', value: () => `${sig(lo(), 4)} ${d.unit}`, buttons: () => [{ label: '−', w: 56, onClick: () => setLo(lo() - step) }, { label: '+', w: 56, onClick: () => setLo(lo() + step) }] },
      { label: 'Colour high', value: () => `${sig(hi(), 4)} ${d.unit}`, buttons: () => [{ label: '−', w: 56, onClick: () => setHi(hi() - step) }, { label: '+', w: 56, onClick: () => setHi(hi() + step) }] },
      { label: 'Threshold', value: () => (d.userThreshold == null ? 'off' : `${sig(d.userThreshold, 4)} ${d.unit}`), buttons: () => [
        { label: d.userThreshold == null ? 'Show' : 'Hide', active: d.userThreshold != null, onClick: () => setThr(d.userThreshold == null ? (d.min + d.max) / 2 : null) },
        { label: '−', w: 56, onClick: () => setThr((d.userThreshold ?? (d.min + d.max) / 2) - step) },
        { label: '+', w: 56, onClick: () => setThr((d.userThreshold ?? (d.min + d.max) / 2) + step) },
      ] },
    ];
    if (view.kind === '2D') rows.push({ label: 'Contours', value: () => `${view.count} levels`, buttons: () => [
      { label: '−', w: 56, onClick: () => { view.count = Math.max(3, view.count - 1); view.rebuild(); } },
      { label: '+', w: 56, onClick: () => { view.count = Math.min(30, view.count + 1); view.rebuild(); } },
    ] });
    return {
      summary: () => `${d.quantity} ${sig(d.min, 3)}–${sig(d.max, 3)} ${d.unit}${d.userThreshold != null ? ` · ${(100 * fractionAbove(d, d.userThreshold)).toFixed(1)}% of area above ${sig(d.userThreshold, 3)}` : ' · colour window ' + sig(lo(), 3) + '–' + sig(hi(), 3)}`,
      rows,
      reset: () => { restore(d); changed(); },
    };
  }

  if (d.kind === 'wafer') {
    const step = Math.max(0.05, Math.round((d.sigma / 2) * 20) / 20);
    const keep = () => snapshot(d, ['lsl', 'usl']);
    const set = (k, v) => { keep(); d[k] = Number(v.toFixed(2)); if (d.lsl != null && d.usl != null && d.lsl >= d.usl) d[k] = k === 'lsl' ? d.usl - step : d.lsl + step; changed(); };
    return {
      summary: () => `${d.inSpecPct.toFixed(1)}% in spec · ${view.badCount} dies out of spec · mean ${d.mean.toFixed(2)} ${d.unit}`,
      rows: [
        { label: 'Lower spec (LSL)', value: () => `${d.lsl ?? '–'} ${d.unit}`, buttons: () => [{ label: '−', w: 56, onClick: () => set('lsl', (d.lsl ?? d.min) - step) }, { label: '+', w: 56, onClick: () => set('lsl', (d.lsl ?? d.min) + step) }] },
        { label: 'Upper spec (USL)', value: () => `${d.usl ?? '–'} ${d.unit}`, buttons: () => [{ label: '−', w: 56, onClick: () => set('usl', (d.usl ?? d.max) - step) }, { label: '+', w: 56, onClick: () => set('usl', (d.usl ?? d.max) + step) }] },
        { label: 'Show', buttons: () => [
          { label: 'All dies', active: !view.onlyBad, onClick: () => { view.onlyBad = false; view.layout(); } },
          { label: 'Out-of-spec only', active: !!view.onlyBad, onClick: () => { view.onlyBad = true; view.layout(); } },
        ] },
      ],
      reset: () => { restore(d); view.onlyBad = false; changed(); },
    };
  }

  if (d.kind === 'spc') {
    const step = Math.max(0.05, Math.round((d.sigmaWithin / 2) * 20) / 20);
    const keep = () => snapshot(d, ['lsl', 'usl', 'baseline']);
    const n = d.values.length;
    const set = (k, v) => { keep(); d[k] = Number(v.toFixed(2)); if (d.lsl >= d.usl) d[k] = k === 'lsl' ? d.usl - step : d.lsl + step; changed(); };
    const setBase = (v) => { keep(); d.baseline = Math.max(8, Math.min(n, v)); changed(); };
    return {
      summary: () => `Cpk ${d.cpk.toFixed(2)} · Ppk ${d.ppk.toFixed(2)} · ${d.violations.length} rule violations · UCL ${d.ucl.toFixed(2)} / LCL ${d.lcl.toFixed(2)}`,
      rows: [
        { label: 'Lower spec (LSL)', value: () => `${d.lsl} ${d.unit}`, buttons: () => [{ label: '−', w: 56, onClick: () => set('lsl', d.lsl - step) }, { label: '+', w: 56, onClick: () => set('lsl', d.lsl + step) }] },
        { label: 'Upper spec (USL)', value: () => `${d.usl} ${d.unit}`, buttons: () => [{ label: '−', w: 56, onClick: () => set('usl', d.usl - step) }, { label: '+', w: 56, onClick: () => set('usl', d.usl + step) }] },
        { label: 'Baseline', value: () => `${d.baseline >= 8 ? d.baseline : n} ${d.sampleLabel || 'sample'}s`, buttons: () => [
          { label: '−5', onClick: () => setBase((d.baseline >= 8 ? d.baseline : n) - 5) },
          { label: '+5', onClick: () => setBase((d.baseline >= 8 ? d.baseline : n) + 5) },
          { label: 'All', active: !(d.baseline >= 8 && d.baseline < n), onClick: () => setBase(n) },
        ] },
      ],
      reset: () => { restore(d); changed(); },
    };
  }

  return { summary: () => d.title, rows: [], reset: () => {} };
}
