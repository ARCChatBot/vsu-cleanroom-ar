// =====================================================================================
//  waferView.js
//  MI-CHIPS (NSF #2606117): 3D wafer map. Each die is a bar whose height and colour
//  encode the measurement; out-of-spec dies get an orange cap. Point at a die to read it.
//  Explode spreads the dies apart radially and lifts the out-of-spec dies above the
//  wafer so they stand out. Scale and rotate from the panel (or the mouse wheel).
//  Local frame: +Z faces the viewer, wafer +X to the viewer's right, wafer +Y away from
//  the viewer, so the notch (−Y) sits nearest the viewer.
// =====================================================================================

import * as THREE from 'three';
import { CanvasPanel, makeLabel, disposeObject, easeInOut } from '../render/panel.js';
import { THEME, PALETTE } from '../render/chart.js';
import { COLORMAPS } from '../render/colormap.js';
import { inSpec, waferStats } from '../data/datasets.js';

const DISPLAY_D = 0.42, BAR_MAX = 0.10, BAR_MIN = 0.003;
const SPREAD = 0.45, LIFT_BAD = 0.09; // exploded radial spread factor and out-of-spec lift (m)

export class WaferView {
  constructor(w) {
    this.dataset = w;
    this.kind = '3D map';
    this.is3D = true;
    this.root = new THREE.Group();
    this.root.userData.yawOnly = true;
    this.content = new THREE.Group();
    this.root.add(this.content);
    this.s = DISPLAY_D / w.diameterMm;
    this.heightScale = 1;
    this.cmapIdx = 0;
    this.highlight = true;
    this.hovered = -1;
    this.explodeT = 0; this.explodeTarget = 0;
    this.readout = 'Point at a die to read it';
    this.badCount = w.dies.filter((d) => !inSpec(w, d.value)).length;
    const r = DISPLAY_D / 2;

    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.006, 96), new THREE.MeshStandardMaterial({ color: PALETTE.nightSlate, roughness: 0.7 }));
    this.disc.position.y = -0.004;
    this.disc.userData.target = { onDown: () => ({ dragRoot: this.root, face: true }) };
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.008, 0.01), new THREE.MeshBasicMaterial({ color: PALETTE.orange }));
    notch.position.set(0, -0.003, r + 0.004);
    this.content.add(this.disc, notch);

    const n = w.dies.length;
    this.bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), n);
    this.caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: PALETTE.orange }), n);
    this.bars.userData.target = { onHover: (hit) => this.setHover(hit.instanceId), onLeave: () => this.setHover(-1), onDown: () => ({ focus: true }) };
    this.content.add(this.bars, this.caps);

    this.badLabel = makeLabel(`Out-of-spec dies (${this.badCount})`, { height: 0.018, color: PALETTE.orange });
    this.badLabel.visible = false;
    this.content.add(this.badLabel);

    this.panel = new WaferPanel(this);
    this.panel.root.position.set(0, -0.16, r + 0.05);
    this.panel.root.rotation.x = -0.3;
    this.root.add(this.panel.root);

    this.title = makeLabel(`${w.title}  (${w.quantity}, ${w.unit})`, { height: 0.024, color: PALETTE.white });
    this.content.add(this.title);

    this.interactables = [this.disc, this.bars, this.panel.mesh];
    this.layout();
  }

  get cmap() { return COLORMAPS[this.cmapIdx]; }
  get exploded() { return this.explodeTarget > 0.5; }
  setExploded(on) { this.explodeTarget = on ? 1 : 0; this.panel.dirty = true; }
  rotate(deg) { this.content.rotation.y += THREE.MathUtils.degToRad(deg); }
  barH(d) { const w = this.dataset; return BAR_MIN + ((d.value - w.min) / (w.max - w.min)) * BAR_MAX * this.heightScale; }

  /** Die base position including the explode animation. */
  diePos(d) {
    const e = easeInOut(this.explodeT), k = 1 + SPREAD * e;
    const lift = !inSpec(this.dataset, d.value) ? LIFT_BAD * e : 0;
    return new THREE.Vector3(d.x * this.s * k, lift, -d.y * this.s * k);
  }

  layout() {
    const w = this.dataset, s = this.s, m = new THREE.Matrix4(), c = new THREE.Color();
    const q = new THREE.Quaternion(), hidden = new THREE.Vector3(0, 0, 0);
    w.dies.forEach((d, i) => {
      const h = this.barH(d), p = this.diePos(d);
      const shown = !this.onlyBad || !inSpec(w, d.value); // focus filter: show only out-of-spec dies
      m.compose(new THREE.Vector3(p.x, p.y + h / 2, p.z), q, shown ? new THREE.Vector3(w.dieW * s * 0.88, h, w.dieH * s * 0.88) : hidden);
      this.bars.setMatrixAt(i, m);
      if (i === this.hovered) c.set(PALETTE.white);
      else c.setRGB(...this.cmap.rgb((d.value - w.min) / (w.max - w.min)));
      this.bars.setColorAt(i, c);
      const bad = this.highlight && !inSpec(w, d.value);
      m.compose(new THREE.Vector3(p.x, p.y + h + 0.001, p.z), q, bad ? new THREE.Vector3(w.dieW * s * 0.9, 0.002, w.dieH * s * 0.9) : hidden);
      this.caps.setMatrixAt(i, m);
    });
    this.bars.instanceMatrix.needsUpdate = true;
    this.bars.instanceColor.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    this.bars.computeBoundingSphere();
    const e = easeInOut(this.explodeT);
    this.title.position.set(0, BAR_MAX * this.heightScale + 0.06 + LIFT_BAD * e, -DISPLAY_D * 0.3 * (1 + SPREAD * e));
    this.badLabel.position.set(0, BAR_MAX * this.heightScale + LIFT_BAD * e + 0.02, 0);
    this.badLabel.visible = e > 0.05 && this.badCount > 0;
    this.badLabel.material.opacity = e;
  }

  dieColor(i, c = new THREE.Color()) {
    const w = this.dataset, d = w.dies[i];
    return i === this.hovered ? c.set(PALETTE.white) : c.setRGB(...this.cmap.rgb((d.value - w.min) / (w.max - w.min)));
  }

  setHover(i) {
    if (i === this.hovered || i == null) return;
    const prev = this.hovered;
    this.hovered = i;
    for (const k of [prev, i]) if (k >= 0) this.bars.setColorAt(k, this.dieColor(k));
    this.bars.instanceColor.needsUpdate = true;
    const w = this.dataset;
    if (this.valueLabel) { disposeObject(this.valueLabel); this.content.remove(this.valueLabel); this.valueLabel = null; }
    if (i >= 0) {
      const d = w.dies[i], p = this.diePos(d);
      this.valueLabel = makeLabel(`${d.value.toFixed(2)} ${w.unit}`, { height: 0.02, color: PALETTE.white, bg: 'rgba(0,53,142,0.95)' });
      this.valueLabel.position.set(p.x, p.y + this.barH(d) + 0.025, p.z);
      this.content.add(this.valueLabel);
      this.readout = `Die (${d.col}, ${d.row}) at (${d.x.toFixed(0)}, ${d.y.toFixed(0)}) mm  →  ${w.quantity} = ${d.value.toFixed(2)} ${w.unit}${inSpec(w, d.value) ? '' : '   OUT OF SPEC'}`;
      this.onInspect?.(this.readout);
    } else this.readout = 'Point at a die to read it';
    this.panel.dirty = true;
  }

  /** Recompute stats and redraw after the spec limits or the filter changed. */
  refresh() {
    const w = this.dataset;
    waferStats(w);
    this.badCount = w.dies.filter((d) => !inSpec(w, d.value)).length;
    disposeObject(this.badLabel); this.content.remove(this.badLabel);
    this.badLabel = makeLabel(`Out-of-spec dies (${this.badCount})`, { height: 0.018, color: PALETTE.orange });
    this.content.add(this.badLabel);
    this.layout();
    this.panel.dirty = true;
  }

  update(dt = 1 / 60) {
    if (this.explodeT !== this.explodeTarget) {
      const step = dt / 0.8;
      this.explodeT = this.explodeTarget > this.explodeT ? Math.min(1, this.explodeT + step) : Math.max(0, this.explodeT - step);
      this.layout();
    }
    this.panel.update(dt);
  }

  dispose() { disposeObject(this.root); }
}

class WaferPanel extends CanvasPanel {
  constructor(view) {
    super({ title: view.dataset.title + '  ·  3D', width: 0.52, height: 0.255, draggable: false, explodable: true });
    this.view = view;
    this.onClose = () => view.onClose?.();
    this.onExplode = () => view.setExploded(!view.exploded);
  }

  get exploded() { return this.view.exploded; }

  draw() {
    const v = this.view, w = v.dataset;
    this.eyebrow(`${w.category} · wafer map`, 22, 78);
    let y = this.paragraph(w.description || '', 22, 102, this.W - 44, { size: 18, maxLines: 2 }) + 6;
    const spec = w.lsl != null || w.usl != null ? `   In spec ${w.inSpecPct.toFixed(1)}%` : '';
    this.text(`Mean ${w.mean.toFixed(2)} ${w.unit}   σ ${w.sigma.toFixed(2)}   CV ${((100 * w.sigma) / w.mean).toFixed(1)}%${spec}`, 22, y, { size: 22, weight: 700 });
    y += 32;
    this.text(`${w.dies.length} dies   Min ${w.min.toFixed(2)}   Max ${w.max.toFixed(2)}   Uniformity ±${w.uniformityPct.toFixed(1)}%   Spec [${w.lsl ?? '–'}, ${w.usl ?? '–'}]`, 22, y, { size: 19, color: THEME.muted });
    y += 32;
    this.text(v.readout, 22, y, { size: 20, weight: v.hovered >= 0 ? 600 : 400, color: v.hovered >= 0 ? PALETTE.iceBlue : THEME.muted });
    y += 38;
    let x = 22;
    x = this.button('Bars −', x, y, 104, 44, () => { v.heightScale = Math.max(0.1, v.heightScale - 0.25); v.layout(); });
    x = this.button('Bars +', x, y, 104, 44, () => { v.heightScale = Math.min(3, v.heightScale + 0.25); v.layout(); });
    x = this.button('Spec caps', x, y, 150, 44, () => { v.highlight = !v.highlight; v.layout(); }, { active: v.highlight });
    x = this.button('⟲', x, y, 52, 44, () => v.rotate(-30));
    x = this.button('⟳', x, y, 52, 44, () => v.rotate(30));
    this.button('Colors: ' + v.cmap.name, x, y, 250, 44, () => { v.cmapIdx = (v.cmapIdx + 1) % COLORMAPS.length; v.layout(); });
  }
}
