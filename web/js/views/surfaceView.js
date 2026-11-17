// =====================================================================================
//  surfaceView.js
//  MI-CHIPS (NSF #2606117): 3D height-field of a scalar field standing on a grabbable
//  base plate. Height and colour both encode value. Contours ride on the surface and are
//  projected onto the base. Point at the surface to read the value under the ray.
//  The colourbar is as tall as the surface, so a colour sits at the same height as that
//  value. Local frame: +Z faces the viewer, +X is the viewer's right, data y runs away.
// =====================================================================================

import * as THREE from 'three';
import { CanvasPanel, makeLabel, disposeObject } from '../render/panel.js';
import { THEME, niceTicks, fmt, sig } from '../render/chart.js';
import { COLORMAPS, defaultColormapIndex } from '../render/colormap.js';
import { contourLevels, computeContours } from '../render/contours.js';
import { fieldAt, normalize, sampleUV, dataX, dataY } from '../data/datasets.js';

const HMAX = 0.16;

export class SurfaceView {
  constructor(f) {
    this.dataset = f;
    this.kind = '3D';
    this.is3D = true;
    this.root = new THREE.Group();
    this.root.userData.yawOnly = true;

    const aspect = Math.min(1.4, Math.max(0.35, (f.yMax - f.yMin) / (f.xMax - f.xMin) || 1));
    this.W = 0.44; this.D = this.W * aspect;
    this.heightScale = 1;
    this.cmapIdx = defaultColormapIndex(f);
    this.showSurfaceContours = true;
    this.showFloorContours = true;
    this.readout = 'Point at the surface to read values';

    // Base plate (grab to move)
    this.base = new THREE.Mesh(
      new THREE.BoxGeometry(this.W + 0.06, 0.02, this.D + 0.06),
      new THREE.MeshStandardMaterial({ color: 0x0f2236, roughness: 0.8 }));
    this.base.position.y = -0.011;
    this.base.userData.target = { onDown: () => ({ dragRoot: this.root, face: true }) };
    this.root.add(this.base);

    // Surface mesh: x = (u − ½)W, y = h (scaled by H), z = (½ − v)D
    const geo = new THREE.BufferGeometry();
    const n = f.nx * f.ny, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let y = 0; y < f.ny; y++) for (let x = 0; x < f.nx; x++) {
      const i = y * f.nx + x, u = x / (f.nx - 1), v = y / (f.ny - 1);
      pos.set([(u - 0.5) * this.W, normalize(f, fieldAt(f, x, y)), (0.5 - v) * this.D], i * 3);
      uv.set([u, v], i * 2);
    }
    const idx = [];
    for (let y = 0; y < f.ny - 1; y++) for (let x = 0; x < f.nx - 1; x++) {
      const a = y * f.nx + x, b = a + 1, c = a + f.nx, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.surface = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.0 }));
    this.surface.userData.target = {
      onHover: (hit) => this.hoverAt(hit),
      onLeave: () => this.clearHover(),
      onDown: () => ({ consumed: true }),
    };
    this.root.add(this.surface);

    // Contours: surface lines live in a group scaled with height, floor lines stay flat.
    this.surfaceLines = new THREE.Group();
    this.floorLines = new THREE.Group();
    this.root.add(this.surfaceLines, this.floorLines);
    this.buildContours();

    // Colourbar (back-right corner, as tall as the surface)
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.root.add(this.bar);

    // Hover marker
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.006, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.dropLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.marker.visible = this.dropLine.visible = false;
    this.root.add(this.marker, this.dropLine);

    this.labels = new THREE.Group();
    this.root.add(this.labels);

    this.panel = new SurfacePanel(this);
    // Control panel hangs below the front edge of the base so it never hides the surface.
    this.panel.root.position.set(0, -0.115, this.D / 2 + 0.045);
    this.panel.root.rotation.x = -0.3;
    this.root.add(this.panel.root);

    this.interactables = [this.base, this.surface, this.panel.mesh];
    this.applyColormap();
    this.applyHeight();
  }

  get cmap() { return COLORMAPS[this.cmapIdx]; }
  get H() { return HMAX * this.heightScale; }

  applyColormap() {
    const f = this.dataset, col = this.surface.geometry.attributes.color;
    for (let i = 0; i < f.nx * f.ny; i++) {
      const [r, g, b] = this.cmap.rgb(normalize(f, f.values[i]));
      col.setXYZ(i, r, g, b);
    }
    col.needsUpdate = true;
    this.surface.material.color.setRGB(1, 1, 1);

    const c = document.createElement('canvas'); c.width = 8; c.height = 256;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 256; y++) { ctx.fillStyle = this.cmap.css(1 - y / 255); ctx.fillRect(0, y, 8, 1); }
    this.bar.material.map?.dispose();
    this.bar.material.map = new THREE.CanvasTexture(c);
    this.bar.material.map.colorSpace = THREE.SRGBColorSpace;
    this.bar.material.needsUpdate = true;
    this.buildContours();
  }

  buildContours() {
    const f = this.dataset;
    for (const g of [this.surfaceLines, this.floorLines]) { disposeObject(g); g.clear(); }
    const segs = computeContours(f, contourLevels(f, f.contourCount || 10));
    const surf = { n: [], h: [] }, floor = { n: [], h: [] };
    for (const s of segs) {
      const hz = normalize(f, s.level);
      const P = (p, y) => [(p[0] - 0.5) * this.W, y, (0.5 - p[1]) * this.D];
      (s.highlight ? surf.h : surf.n).push(...P(s.a, hz), ...P(s.b, hz));
      (s.highlight ? floor.h : floor.n).push(...P(s.a, 0.0015), ...P(s.b, 0.0015));
    }
    const lines = (arr, color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    };
    this.surfaceLines.add(lines(surf.n, 0xffffff, 0.8), lines(surf.h, 0xff6600, 1));
    this.floorLines.add(lines(floor.n, new THREE.Color(this.cmap.css(0.75)), 0.9), lines(floor.h, 0xff6600, 1));
    this.surfaceLines.position.y = 0.0015;
    this.surfaceLines.visible = this.showSurfaceContours;
    this.floorLines.visible = this.showFloorContours;
    this.surfaceLines.scale.y = this.H;
  }

  applyHeight() {
    const f = this.dataset, H = this.H, W = this.W, D = this.D;
    this.surface.scale.y = H;
    this.surfaceLines.scale.y = H;
    this.bar.scale.y = H;
    this.bar.position.set(W / 2 + 0.04, H / 2, -D / 2);
    this.surface.geometry.computeBoundingSphere();

    disposeObject(this.labels); this.labels.clear();
    const add = (text, x, y, z, opts) => { const s = makeLabel(text, opts); s.position.set(x, y, z); this.labels.add(s); };
    const xt = niceTicks(f.xMin, f.xMax, 5);
    for (const t of xt.ticks) add(fmt(t, xt.step), ((t - f.xMin) / (f.xMax - f.xMin) - 0.5) * W, 0.012, D / 2 + 0.03, { height: 0.014 });
    add(f.xLabel, 0, 0.012, D / 2 + 0.058, { height: 0.016 });
    const yt = niceTicks(f.yMin, f.yMax, 5);
    for (const t of yt.ticks) add(fmt(t, yt.step), -W / 2 - 0.035, 0.012, (0.5 - (t - f.yMin) / (f.yMax - f.yMin)) * D, { height: 0.014 });
    add(f.yLabel, -W / 2 - 0.04, 0.012, -D / 2 - 0.03, { height: 0.016 });
    const vt = niceTicks(f.min, f.max, 5);
    for (const t of vt.ticks) add(fmt(t, vt.step), W / 2 + 0.075, normalize(f, t) * H, -D / 2, { height: 0.013 });
    add(`${f.title}  (${f.quantity}, ${f.unit})`, 0, H + 0.06, -D / 2, { height: 0.024, color: THEME.orange });
  }

  hoverAt(hit) {
    if (!hit.uv) return;
    const f = this.dataset, u = hit.uv.x, v = hit.uv.y, val = sampleUV(f, u, v);
    const local = this.root.worldToLocal(hit.point.clone());
    this.marker.position.copy(local);
    this.dropLine.geometry.setFromPoints([local, new THREE.Vector3(local.x, 0.001, local.z)]);
    this.marker.visible = this.dropLine.visible = true;

    const text = `${sig(val)} ${f.unit}`;
    if (text !== this.valueText) {
      if (this.valueLabel) { disposeObject(this.valueLabel); this.root.remove(this.valueLabel); }
      this.valueLabel = makeLabel(text, { height: 0.02, color: '#ffffff', bg: 'rgba(255,102,0,0.85)' });
      this.root.add(this.valueLabel);
      this.valueText = text;
    }
    this.valueLabel.position.set(local.x, local.y + 0.03, local.z);
    this.valueLabel.visible = true;
    this.readout = `${f.xLabel} = ${sig(dataX(f, u), 3)},  ${f.yLabel} = ${sig(dataY(f, v), 3)}  →  ${f.quantity} = ${text}`;
    this.panel.dirty = true;
    this.onInspect?.(this.readout);
  }

  clearHover() {
    this.marker.visible = this.dropLine.visible = false;
    if (this.valueLabel) this.valueLabel.visible = false;
    this.readout = 'Point at the surface to read values';
    this.panel.dirty = true;
  }

  update() { this.panel.update(); }

  dispose() { this.panel.dispose(); disposeObject(this.root); }
}

class SurfacePanel extends CanvasPanel {
  constructor(view) {
    super({ title: view.dataset.title + '  ·  3D', width: 0.46, height: 0.17, closable: true, draggable: false });
    this.view = view;
    this.onClose = () => view.onClose?.();
  }

  draw() {
    const v = this.view;
    this.text(v.readout, 20, 72, { size: 20, weight: 600 });
    let y = 112, x = 20;
    x = this.button('Height −', x, y, 130, 44, () => { v.heightScale = Math.max(0.25, v.heightScale - 0.25); v.applyHeight(); });
    this.text(`${v.heightScale.toFixed(2)}×`, x, y + 22, { size: 20, baseline: 'middle' });
    x += 76;
    x = this.button('Height +', x, y, 130, 44, () => { v.heightScale = Math.min(3, v.heightScale + 0.25); v.applyHeight(); });
    x = this.button('Surface lines', x, y, 170, 44, () => { v.showSurfaceContours = !v.showSurfaceContours; v.surfaceLines.visible = v.showSurfaceContours; }, { active: v.showSurfaceContours });
    x = this.button('Floor lines', x, y, 150, 44, () => { v.showFloorContours = !v.showFloorContours; v.floorLines.visible = v.showFloorContours; }, { active: v.showFloorContours });
    y += 56; x = 20;
    x = this.button('Colormap: ' + v.cmap.name, x, y, 280, 44, () => { v.cmapIdx = (v.cmapIdx + 1) % COLORMAPS.length; v.applyColormap(); });
    x = this.button('2D view', x, y, 120, 44, () => v.onOpenField?.(v.dataset, '2D'));
    this.text('Grab the base plate to move', x + 6, y + 22, { size: 17, color: THEME.muted, baseline: 'middle' });
  }
}
