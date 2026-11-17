// =====================================================================================
//  surfaceView.js
//  MI-CHIPS (NSF #2606117): 3D height-field of a scalar field on a grabbable base plate.
//  Height and colour both encode value, contours ride on the surface and are projected
//  onto the base, and pointing at the surface reads the value under the ray.
//  Explode lifts the surface off its floor contours and floats the iso-lines above it,
//  as three labelled tiers. Scale and rotate from the control panel (or the mouse wheel).
//  Local frame: +Z faces the viewer, +X is the viewer's right, data y runs away.
// =====================================================================================

import * as THREE from 'three';
import { CanvasPanel, makeLabel, disposeObject, easeInOut } from '../render/panel.js';
import { THEME, PALETTE, niceTicks, fmt, sig } from '../render/chart.js';
import { COLORMAPS, defaultColormapIndex } from '../render/colormap.js';
import { contourLevels, computeContours } from '../render/contours.js';
import { fieldAt, normalize, sampleUV, dataX, dataY } from '../data/datasets.js';

const HMAX = 0.16;
const LIFT_SURFACE = 0.11, LIFT_LINES = 0.20; // exploded heights (m)

export class SurfaceView {
  constructor(f) {
    this.dataset = f;
    this.kind = '3D';
    this.is3D = true;
    this.root = new THREE.Group();
    this.root.userData.yawOnly = true;
    this.content = new THREE.Group(); // rotates (yaw) without moving the control panel
    this.root.add(this.content);

    const aspect = Math.min(1.4, Math.max(0.35, (f.yMax - f.yMin) / (f.xMax - f.xMin) || 1));
    this.W = 0.44; this.D = this.W * aspect;
    this.heightScale = 1;
    this.cmapIdx = defaultColormapIndex(f);
    this.showSurfaceContours = true;
    this.showFloorContours = true;
    this.explodeT = 0; this.explodeTarget = 0;
    this.readout = 'Point at the surface to read values';

    this.base = new THREE.Mesh(
      new THREE.BoxGeometry(this.W + 0.06, 0.02, this.D + 0.06),
      new THREE.MeshStandardMaterial({ color: PALETTE.nightSlate, roughness: 0.8 }));
    this.base.position.y = -0.011;
    this.base.userData.target = { onDown: () => ({ dragRoot: this.root, face: true }) };
    const rim = new THREE.Mesh(new THREE.BoxGeometry(this.W + 0.062, 0.003, 0.004), new THREE.MeshBasicMaterial({ color: PALETTE.orange }));
    rim.position.set(0, -0.0015, (this.D + 0.06) / 2); // small orange accent on the front edge
    this.content.add(this.base, rim);

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
    this.surface = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55 }));
    this.surface.userData.target = { onHover: (hit) => this.hoverAt(hit), onLeave: () => this.clearHover(), onDown: () => ({ consumed: true }) };
    this.surfaceGroup = new THREE.Group();
    this.surfaceGroup.add(this.surface);
    this.content.add(this.surfaceGroup);

    this.surfaceLines = new THREE.Group();
    this.floorLines = new THREE.Group();
    this.content.add(this.surfaceLines, this.floorLines);

    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.content.add(this.bar);

    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.006, 16, 12), new THREE.MeshBasicMaterial({ color: PALETTE.white }));
    this.dropLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: PALETTE.iceBlue }));
    this.marker.visible = this.dropLine.visible = false;
    this.content.add(this.marker, this.dropLine);

    this.labels = new THREE.Group();
    this.tierLabels = ['Floor contours', 'Surface', 'Iso-lines'].map((t) => {
      const s = makeLabel(t, { height: 0.017, color: PALETTE.iceBlue });
      s.visible = false; this.content.add(s); return s;
    });
    this.content.add(this.labels);

    this.panel = new SurfacePanel(this);
    this.panel.root.position.set(0, -0.12, this.D / 2 + 0.045);
    this.panel.root.rotation.x = -0.3;
    this.root.add(this.panel.root);

    this.interactables = [this.base, this.surface, this.panel.mesh];
    this.applyColormap();
    this.applyHeight();
  }

  get cmap() { return COLORMAPS[this.cmapIdx]; }
  get H() { return HMAX * this.heightScale; }
  get exploded() { return this.explodeTarget > 0.5; }
  setExploded(on) { this.explodeTarget = on ? 1 : 0; this.panel.dirty = true; }
  rotate(deg) { this.content.rotation.y += THREE.MathUtils.degToRad(deg); }

  applyColormap() {
    const f = this.dataset, col = this.surface.geometry.attributes.color;
    for (let i = 0; i < f.nx * f.ny; i++) col.setXYZ(i, ...this.cmap.rgb(normalize(f, f.values[i])));
    col.needsUpdate = true;
    const c = document.createElement('canvas'); c.width = 8; c.height = 256;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 256; y++) { ctx.fillStyle = this.cmap.css(1 - y / 255); ctx.fillRect(0, y, 8, 1); }
    this.bar.material.map?.dispose();
    this.bar.material.map = new THREE.CanvasTexture(c);
    this.bar.material.map.colorSpace = THREE.SRGBColorSpace;
    this.bar.material.map.generateMipmaps = false;
    this.bar.material.map.minFilter = THREE.LinearFilter;
    this.bar.material.needsUpdate = true;
    this.buildContours();
  }

  buildContours() {
    const f = this.dataset;
    for (const g of [this.surfaceLines, this.floorLines]) { disposeObject(g); g.clear(); }
    const segs = computeContours(f, contourLevels(f, f.contourCount || 10));
    const surf = { n: [], h: [] }, floor = { n: [], h: [] };
    const P = (p, y) => [(p[0] - 0.5) * this.W, y, (0.5 - p[1]) * this.D];
    for (const s of segs) {
      const hz = normalize(f, s.level);
      (s.highlight ? surf.h : surf.n).push(...P(s.a, hz), ...P(s.b, hz));
      (s.highlight ? floor.h : floor.n).push(...P(s.a, 0.0015), ...P(s.b, 0.0015));
    }
    const lines = (arr, color, opacity = 1) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    };
    this.surfaceLines.add(lines(surf.n, PALETTE.frost, 0.85), lines(surf.h, PALETTE.orange));
    this.floorLines.add(lines(floor.n, PALETTE.iceBlue, 0.9), lines(floor.h, PALETTE.orange));
    this.surfaceLines.visible = this.showSurfaceContours;
    this.floorLines.visible = this.showFloorContours;
    this.applyExplode();
  }

  applyHeight() {
    const f = this.dataset, H = this.H, W = this.W, D = this.D;
    this.surface.scale.y = H;
    this.surfaceLines.scale.y = H;
    this.bar.scale.y = H;
    this.surface.geometry.computeBoundingSphere();

    disposeObject(this.labels); this.labels.clear();
    const add = (text, x, y, z, opts) => { const s = makeLabel(text, opts); s.position.set(x, y, z); this.labels.add(s); return s; };
    const xt = niceTicks(f.xMin, f.xMax, 5);
    for (const t of xt.ticks) add(fmt(t, xt.step), ((t - f.xMin) / (f.xMax - f.xMin) - 0.5) * W, 0.012, D / 2 + 0.03, { height: 0.014, color: THEME.muted });
    add(f.xLabel, 0, 0.012, D / 2 + 0.058, { height: 0.016, color: THEME.caption });
    const yt = niceTicks(f.yMin, f.yMax, 5);
    for (const t of yt.ticks) add(fmt(t, yt.step), -W / 2 - 0.035, 0.012, (0.5 - (t - f.yMin) / (f.yMax - f.yMin)) * D, { height: 0.014, color: THEME.muted });
    add(f.yLabel, -W / 2 - 0.04, 0.012, -D / 2 - 0.03, { height: 0.016, color: THEME.caption });
    this.valueTicks = new THREE.Group();
    this.labels.add(this.valueTicks);
    const vt = niceTicks(f.min, f.max, 5);
    for (const t of vt.ticks) {
      const s = makeLabel(fmt(t, vt.step), { height: 0.013, color: THEME.muted });
      s.position.set(W / 2 + 0.075, normalize(f, t) * H, -D / 2);
      this.valueTicks.add(s);
    }
    this.titleLabel = add(`${f.title}  (${f.quantity}, ${f.unit})`, 0, H + 0.06, -D / 2, { height: 0.024, color: PALETTE.white });
    this.applyExplode();
  }

  applyExplode() {
    const e = easeInOut(this.explodeT), H = this.H, W = this.W, D = this.D;
    const ls = e * LIFT_SURFACE, ll = e * LIFT_LINES;
    this.surfaceGroup.position.y = ls;
    this.surfaceLines.position.y = 0.0015 + ll;
    this.bar.position.set(W / 2 + 0.04 + e * 0.03, H / 2 + ls, -D / 2);
    if (this.valueTicks) { this.valueTicks.position.set(e * 0.03, ls, 0); }
    if (this.titleLabel) this.titleLabel.position.y = H + 0.06 + ll;
    const tiers = [0.02, ls + H * 0.55, ll + H + 0.02];
    this.tierLabels.forEach((s, i) => {
      s.position.set(-W / 2 - 0.09, tiers[i], 0);
      s.visible = e > 0.05; s.material.opacity = e;
    });
  }

  hoverAt(hit) {
    if (!hit.uv) return;
    const f = this.dataset, u = hit.uv.x, v = hit.uv.y, val = sampleUV(f, u, v);
    const local = this.content.worldToLocal(hit.point.clone());
    this.marker.position.copy(local);
    this.dropLine.geometry.setFromPoints([local, new THREE.Vector3(local.x, 0.001, local.z)]);
    this.marker.visible = this.dropLine.visible = true;
    const text = `${sig(val)} ${f.unit}`;
    const now = performance.now();
    if (text !== this.valueText && now - (this.labelAt || 0) > 150) { // ≤ ~7 label rebuilds per second
      this.labelAt = now;
      if (this.valueLabel) { disposeObject(this.valueLabel); this.content.remove(this.valueLabel); }
      this.valueLabel = makeLabel(text, { height: 0.02, color: PALETTE.white, bg: 'rgba(0,53,142,0.95)' });
      this.content.add(this.valueLabel);
      this.valueText = text;
    }
    if (this.valueLabel) { this.valueLabel.position.set(local.x, local.y + 0.03, local.z); this.valueLabel.visible = true; }
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

  update(dt = 1 / 60) {
    if (this.explodeT !== this.explodeTarget) {
      const step = dt / 0.8;
      this.explodeT = this.explodeTarget > this.explodeT ? Math.min(1, this.explodeT + step) : Math.max(0, this.explodeT - step);
      this.applyExplode();
    }
    this.panel.update(dt);
  }

  dispose() { disposeObject(this.root); }
}

class SurfacePanel extends CanvasPanel {
  constructor(view) {
    super({ title: view.dataset.title + '  ·  3D', width: 0.5, height: 0.19, draggable: false, explodable: true });
    this.view = view;
    this.onClose = () => view.onClose?.();
    this.onExplode = () => view.setExploded(!view.exploded);
  }

  get exploded() { return this.view.exploded; }

  draw() {
    const v = this.view;
    this.text(v.readout, 22, 78, { size: 20, weight: 600, color: v.marker.visible ? PALETTE.iceBlue : THEME.muted });
    let y = 118, x = 22;
    x = this.button('Height −', x, y, 124, 44, () => { v.heightScale = Math.max(0.25, v.heightScale - 0.25); v.applyHeight(); });
    this.text(`${v.heightScale.toFixed(2)}×`, x, y + 22, { size: 20, baseline: 'middle', color: THEME.caption });
    x += 70;
    x = this.button('Height +', x, y, 124, 44, () => { v.heightScale = Math.min(3, v.heightScale + 0.25); v.applyHeight(); });
    x = this.button('Iso-lines', x, y, 130, 44, () => { v.showSurfaceContours = !v.showSurfaceContours; v.surfaceLines.visible = v.showSurfaceContours; }, { active: v.showSurfaceContours });
    this.button('Floor', x, y, 100, 44, () => { v.showFloorContours = !v.showFloorContours; v.floorLines.visible = v.showFloorContours; }, { active: v.showFloorContours });
    y += 56; x = 22;
    x = this.button('⟲', x, y, 52, 44, () => v.rotate(-30));
    x = this.button('⟳', x, y, 52, 44, () => v.rotate(30));
    x = this.button('Colormap: ' + v.cmap.name, x, y, 290, 44, () => { v.cmapIdx = (v.cmapIdx + 1) % COLORMAPS.length; v.applyColormap(); });
    this.button('2D view', x, y, 120, 44, () => v.onOpenField?.(v.dataset, '2D'));
  }
}
