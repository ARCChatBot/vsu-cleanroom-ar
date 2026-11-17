// =====================================================================================
//  waferView.js
//  MI-CHIPS (NSF #2606117): 3D wafer map. Each die is a bar whose height and colour
//  encode the measurement; out-of-spec dies get an orange cap. Point at a die to read it.
//  Local frame: +Z faces the viewer, wafer +X to the viewer's right, wafer +Y away from
//  the viewer, so the notch (−Y) sits nearest the viewer.
// =====================================================================================

import * as THREE from 'three';
import { CanvasPanel, makeLabel, disposeObject } from '../render/panel.js';
import { THEME } from '../render/chart.js';
import { COLORMAPS } from '../render/colormap.js';
import { inSpec } from '../data/datasets.js';

const DISPLAY_D = 0.42, BAR_MAX = 0.10, BAR_MIN = 0.003;

export class WaferView {
  constructor(w) {
    this.dataset = w;
    this.kind = '3D map';
    this.is3D = true;
    this.root = new THREE.Group();
    this.root.userData.yawOnly = true;
    this.s = DISPLAY_D / w.diameterMm;
    this.heightScale = 1;
    this.cmapIdx = 0;
    this.highlight = true;
    this.hovered = -1;
    this.readout = 'Point at a die to read it';
    const r = DISPLAY_D / 2;

    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.006, 96), new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.7 }));
    this.disc.position.y = -0.004;
    this.disc.userData.target = { onDown: () => ({ dragRoot: this.root, face: true }) };
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.01), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    notch.position.set(0, -0.003, r + 0.004);
    this.root.add(this.disc, notch);

    const n = w.dies.length;
    this.bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), n);
    this.caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff6600 }), n);
    this.bars.userData.target = {
      onHover: (hit) => this.setHover(hit.instanceId),
      onLeave: () => this.setHover(-1),
      onDown: () => ({ consumed: true }),
    };
    this.root.add(this.bars, this.caps);

    this.panel = new WaferPanel(this);
    // Stats/control panel hangs below the front edge of the wafer so it never hides the bars.
    this.panel.root.position.set(0, -0.15, r + 0.05);
    this.panel.root.rotation.x = -0.3;
    this.root.add(this.panel.root);

    this.title = makeLabel(`${w.title}  (${w.quantity}, ${w.unit})`, { height: 0.024, color: THEME.orange });
    this.root.add(this.title);

    this.interactables = [this.disc, this.bars, this.panel.mesh];
    this.layout();
  }

  get cmap() { return COLORMAPS[this.cmapIdx]; }
  barH(d) { const w = this.dataset; return BAR_MIN + ((d.value - w.min) / (w.max - w.min)) * BAR_MAX * this.heightScale; }

  layout() {
    const w = this.dataset, s = this.s, m = new THREE.Matrix4(), c = new THREE.Color();
    const q = new THREE.Quaternion(), hidden = new THREE.Vector3(0, 0, 0);
    w.dies.forEach((d, i) => {
      const h = this.barH(d);
      m.compose(new THREE.Vector3(d.x * s, h / 2, -d.y * s), q, new THREE.Vector3(w.dieW * s * 0.88, h, w.dieH * s * 0.88));
      this.bars.setMatrixAt(i, m);
      if (i === this.hovered) c.set(0xffffff);
      else c.setRGB(...this.cmap.rgb((d.value - w.min) / (w.max - w.min)));
      this.bars.setColorAt(i, c);
      const bad = this.highlight && !inSpec(w, d.value);
      m.compose(new THREE.Vector3(d.x * s, h + 0.001, -d.y * s), q, bad ? new THREE.Vector3(w.dieW * s * 0.9, 0.002, w.dieH * s * 0.9) : hidden);
      this.caps.setMatrixAt(i, m);
    });
    this.bars.instanceMatrix.needsUpdate = true;
    this.bars.instanceColor.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    this.bars.computeBoundingSphere();
    this.title.position.set(0, BAR_MAX * this.heightScale + 0.06, -DISPLAY_D * 0.3);
  }

  setHover(i) {
    if (i === this.hovered || i == null) return;
    this.hovered = i;
    const w = this.dataset;
    if (this.valueLabel) { disposeObject(this.valueLabel); this.root.remove(this.valueLabel); this.valueLabel = null; }
    if (i >= 0) {
      const d = w.dies[i];
      this.valueLabel = makeLabel(`${d.value.toFixed(2)} ${w.unit}`, { height: 0.02, color: '#fff', bg: 'rgba(255,102,0,0.85)' });
      this.valueLabel.position.set(d.x * this.s, this.barH(d) + 0.025, -d.y * this.s);
      this.root.add(this.valueLabel);
      this.readout = `Die (${d.col}, ${d.row}) at (${d.x.toFixed(0)}, ${d.y.toFixed(0)}) mm  →  ${w.quantity} = ${d.value.toFixed(2)} ${w.unit}${inSpec(w, d.value) ? '' : '   OUT OF SPEC'}`;
      this.onInspect?.(this.readout);
    } else this.readout = 'Point at a die to read it';
    this.layout();
    this.panel.dirty = true;
  }

  update() { this.panel.update(); }
  dispose() { this.panel.dispose(); disposeObject(this.root); }
}

class WaferPanel extends CanvasPanel {
  constructor(view) {
    super({ title: view.dataset.title + '  ·  3D', width: 0.5, height: 0.24, closable: true, draggable: false });
    this.view = view;
    this.onClose = () => view.onClose?.();
  }

  draw() {
    const v = this.view, w = v.dataset;
    let y = this.paragraph(w.description || '', 20, 72, this.W - 40, { size: 18 }) + 6;
    const spec = w.lsl != null || w.usl != null ? `   In spec ${w.inSpecPct.toFixed(1)}%` : '';
    this.text(`Mean ${w.mean.toFixed(2)} ${w.unit}   σ ${w.sigma.toFixed(2)}   CV ${((100 * w.sigma) / w.mean).toFixed(1)}%${spec}`, 20, y, { size: 22, weight: 700, color: THEME.orange });
    y += 32;
    this.text(`${w.dies.length} dies   Min ${w.min.toFixed(2)}   Max ${w.max.toFixed(2)}   Uniformity ±${w.uniformityPct.toFixed(1)}%   Spec [${w.lsl ?? '–'}, ${w.usl ?? '–'}]`, 20, y, { size: 19 });
    y += 34;
    this.text(v.readout, 20, y, { size: 20, weight: v.hovered >= 0 ? 600 : 400, color: v.hovered >= 0 ? THEME.ink : THEME.muted });
    y += 40;
    let x = 20;
    x = this.button('Bars −', x, y, 110, 44, () => { v.heightScale = Math.max(0.1, v.heightScale - 0.25); v.layout(); });
    x = this.button('Bars +', x, y, 110, 44, () => { v.heightScale = Math.min(3, v.heightScale + 0.25); v.layout(); });
    x = this.button('Out-of-spec caps', x, y, 210, 44, () => { v.highlight = !v.highlight; v.layout(); }, { active: v.highlight });
    this.button('Colormap: ' + v.cmap.name, x, y, 250, 44, () => { v.cmapIdx = (v.cmapIdx + 1) % COLORMAPS.length; v.layout(); });
  }
}
