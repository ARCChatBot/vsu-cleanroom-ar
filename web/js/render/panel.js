// =====================================================================================
//  panel.js
//  MI-CHIPS (NSF #2606117): CanvasPanel, a VSU-branded floating panel. A 2D canvas is
//  drawn as a texture on a plane in the 3D scene. The same panel works with a mouse on
//  desktop and with hand rays or controllers in AR. It has a title bar to drag, a close
//  button, and clickable buttons registered while it draws.
//  Also includes sprite text labels and a dispose helper.
// =====================================================================================

import * as THREE from 'three';
import { THEME, wrapText } from './chart.js';

export const PX_PER_M = 1600;   // canvas pixels per metre of panel
export const TITLE_H = 60;      // title bar height (px)

export class CanvasPanel {
  constructor({ title, width, height, closable = true, draggable = true }) {
    this.title = title;
    this.closable = closable;
    this.draggable = draggable;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * PX_PER_M);
    this.canvas.height = Math.round(height * PX_PER_M);
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.mesh.userData.target = this;

    this.root = new THREE.Group();
    this.root.add(this.mesh);
    this.buttons = [];
    this.hoverPx = null;
    this.hoverBtn = null;
    this.dirty = true;
    this.onClose = null;
  }

  get W() { return this.canvas.width; }
  get H() { return this.canvas.height; }

  /** Subclasses draw their content below the title bar. */
  draw(_ctx) {}

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.redraw();
  }

  redraw() {
    const { ctx, W, H } = this;
    this.buttons = [];
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(0,43,73,0.94)';
    roundRect(ctx, 0, 0, W, H, 22); ctx.fill();
    ctx.strokeStyle = 'rgba(255,102,0,0.85)';
    ctx.lineWidth = 3;
    roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 21); ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(ctx, 3, 3, W - 6, TITLE_H - 3, 19); ctx.fill();
    ctx.fillStyle = THEME.orange;
    ctx.font = `700 26px ${THEME.font}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this.title, 22, TITLE_H / 2 + 2);
    if (this.draggable) {
      ctx.fillStyle = THEME.muted; ctx.font = `18px ${THEME.font}`; ctx.textAlign = 'right';
      ctx.fillText('drag to move', W - (this.closable ? 80 : 22), TITLE_H / 2 + 2);
    }
    if (this.closable) this.button('✕', W - 62, 10, 48, 40, () => this.close());

    this.draw(ctx);
    this.texture.needsUpdate = true;
  }

  close() {
    this.onClose?.();
  }

  /** Change the panel height (e.g. when the dashboard gains datasets). Keeps the top edge in place. */
  resize(height) {
    const oldH = this.mesh.geometry.parameters.height;
    const width = this.mesh.geometry.parameters.width;
    this.canvas.height = Math.round(height * PX_PER_M);
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh.material.map = this.texture;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, height);
    this.mesh.position.y -= (height - oldH) / 2;
    this.dirty = true;
  }

  // ---- drawing helpers (call from draw) ----

  button(label, x, y, w, h, onClick, { active = false } = {}) {
    const { ctx } = this;
    const hovered = this.hoverPx && inRect(this.hoverPx, x, y, w, h);
    ctx.fillStyle = active ? THEME.orange : hovered ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.10)';
    roundRect(ctx, x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = active ? THEME.orange : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2; roundRect(ctx, x, y, w, h, 10); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `600 22px ${THEME.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    this.buttons.push({ x, y, w, h, onClick });
    return x + w + 10;
  }

  text(str, x, y, { size = 22, color = THEME.ink, weight = 400, align = 'left', baseline = 'top' } = {}) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${THEME.font}`;
    ctx.textAlign = align; ctx.textBaseline = baseline;
    ctx.fillText(str, x, y);
  }

  /** Wrapped paragraph. Returns the y below it. */
  paragraph(str, x, y, maxW, { size = 21, color = THEME.muted, lineH = 1.3 } = {}) {
    const { ctx } = this;
    ctx.font = `400 ${size}px ${THEME.font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (const line of wrapText(ctx, str, maxW)) { ctx.fillText(line, x, y); y += size * lineH; }
    return y;
  }

  // ---- input (called by the interaction system) ----

  toPx(uv) { return [uv.x * this.W, (1 - uv.y) * this.H]; }
  buttonAt(p) { return this.buttons.find((b) => inRect(p, b.x, b.y, b.w, b.h)) || null; }

  onHover(hit) {
    const p = this.toPx(hit.uv);
    this.hoverPx = p;
    const b = this.buttonAt(p);
    if (b !== this.hoverBtn) { this.hoverBtn = b; this.dirty = true; }
    if (this.pointerMove?.(p[0], p[1])) this.dirty = true;
  }

  onLeave() {
    this.hoverPx = null;
    this.hoverBtn = null;
    this.pointerLeave?.();
    this.dirty = true;
  }

  onDown(hit) {
    const p = this.toPx(hit.uv);
    const b = this.buttonAt(p);
    if (b) { b.onClick(); this.dirty = true; return { consumed: true }; }
    if (this.draggable && p[1] < TITLE_H) return { dragRoot: this.root, face: true };
    return this.pointerDown?.(p[0], p[1]) || { consumed: true };
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const inRect = (p, x, y, w, h) => p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h;

// ---------------------------------------------------------------------------------
//  Sprite text labels (always face the camera; work in AR too)
// ---------------------------------------------------------------------------------

export function makeLabel(text, { height = 0.022, color = THEME.ink, weight = 600, bg = 'rgba(0,20,40,0.55)' } = {}) {
  const fontPx = 64, pad = 18;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${weight} ${fontPx}px ${THEME.font}`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2, h = fontPx + pad * 2;
  c.width = w; c.height = h;
  if (bg) { ctx.fillStyle = bg; roundRect(ctx, 0, 0, w, h, 16); ctx.fill(); }
  ctx.font = `${weight} ${fontPx}px ${THEME.font}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 3);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set((height * w) / h, height, 1);
  sprite.renderOrder = 2;
  return sprite;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  });
}
