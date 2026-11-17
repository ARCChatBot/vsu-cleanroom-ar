// =====================================================================================
//  panel.js
//  MI-CHIPS (NSF #2606117): CanvasPanel, a floating panel in the Operation SEMI /
//  MI-CHIPS presentation color system. A 2D canvas is drawn as a texture on a plane in
//  the 3D scene, so the same panel works with a mouse on desktop and with hand rays or
//  controllers in AR.
//
//  • Title bar: drag to move. Controls: Explode, scale (− / +), close.
//  • Layers: views can split their data into separate transparent planes (e.g. heatmap,
//    contours, spec limits). "Explode" animates the layers apart into a 3D stack so each
//    one is easy to see on its own, then back again.
//  Also includes sprite text labels, easing and a dispose helper.
// =====================================================================================

import * as THREE from 'three';
import { THEME, PALETTE, wrapText } from './chart.js';

export const PX_PER_M = 1600;   // canvas pixels per metre of panel
export const TITLE_H = 64;      // title bar height (px)
const LAYER_GAP_Z = 0.055;      // metres between exploded layers (toward the viewer)
const LAYER_SHIFT_X = 0.03;     // sideways cascade so the stack reads even face-on
const LAYER_SHIFT_Y = 0.012;

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class CanvasPanel {
  constructor({ title, width, height, closable = true, draggable = true, explodable = false, scalable = true }) {
    this.title = title;
    this.closable = closable;
    this.draggable = draggable;
    this.explodable = explodable;
    this.scalable = scalable;
    this.widthM = width;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * PX_PER_M);
    this.canvas.height = Math.round(height * PX_PER_M);
    this.ctx = this.canvas.getContext('2d');

    this.texture = makeTexture(this.canvas);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.mesh.userData.target = this;

    this.root = new THREE.Group();
    this.root.add(this.mesh);
    this.buttons = [];
    this.hoverPx = null;
    this.hoverBtn = null;
    this.dirty = true;
    this.layersDirty = true;
    this.layers = [];
    this.explodeT = 0;
    this.explodeTarget = 0;
    this.onClose = null;
    this.onScale = null;     // set by the host: (factor) => void
    this.onExplode = null;   // set by the host or a parent view: () => void
  }

  get W() { return this.canvas.width; }
  get H() { return this.canvas.height; }
  get exploded() { return this.explodeTarget > 0.5; }

  /** Subclasses draw their (non-layer) content below the title bar. */
  draw(_ctx) {}

  // ---------------------------------------------------------------------------------
  //  Layers + explode
  // ---------------------------------------------------------------------------------

  /** Adds a transparent data layer drawn by drawFn(ctx) on its own plane. */
  addLayer(name, drawFn) {
    const canvas = document.createElement('canvas');
    canvas.width = this.W; canvas.height = this.H;
    const texture = makeTexture(canvas);
    const mesh = new THREE.Mesh(this.mesh.geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    mesh.renderOrder = 1 + this.layers.length;
    const label = makeLabel(name, { height: 0.016, color: PALETTE.iceBlue });
    label.visible = false;
    this.root.add(mesh, label);
    const layer = { name, canvas, ctx: canvas.getContext('2d'), texture, mesh, label, drawFn };
    this.layers.push(layer);
    this.applyExplode();
    return layer;
  }

  setExploded(on) { this.explodeTarget = on ? 1 : 0; this.dirty = true; }

  applyExplode() {
    const e = easeInOut(this.explodeT);
    const { width, height } = this.mesh.geometry.parameters;
    this.layers.forEach((l, i) => {
      const k = i + 1;
      l.mesh.position.set(e * LAYER_SHIFT_X * k, e * LAYER_SHIFT_Y * k, 0.0012 * k + e * LAYER_GAP_Z * k);
      // Label just outside each layer's right edge, stepping down so the tags never overlap.
      const lw = l.label.scale.x;
      l.label.position.set(width / 2 + lw / 2 + 0.015 + e * LAYER_SHIFT_X * k, height / 2 - 0.2 - 0.03 * i + e * LAYER_SHIFT_Y * k, l.mesh.position.z + 0.004);
      l.label.visible = e > 0.05;
      l.label.material.opacity = e;
    });
  }

  update(dt = 1 / 60) {
    if (this.explodeT !== this.explodeTarget) {
      const step = dt / 0.7; // 0.7 s animation
      this.explodeT = this.explodeTarget > this.explodeT ? Math.min(1, this.explodeT + step) : Math.max(0, this.explodeT - step);
      this.applyExplode();
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.redraw();
  }

  redraw() {
    const { ctx, W, H } = this;
    this.buttons = [];
    ctx.clearRect(0, 0, W, H);

    // Surface: C01 Deep Academic Slate with a C07 hairline border
    ctx.fillStyle = 'rgba(11,15,25,0.96)';
    roundRect(ctx, 0, 0, W, H, 20); ctx.fill();
    ctx.strokeStyle = 'rgba(83,97,122,0.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, W - 2, H - 2, 19); ctx.stroke();

    // Title bar: C05 Night Slate, orange accent rule (small accent), white title
    ctx.fillStyle = PALETTE.nightSlate;
    roundRect(ctx, 2, 2, W - 4, TITLE_H - 2, 18); ctx.fill();
    ctx.fillRect(2, TITLE_H / 2, W - 4, TITLE_H / 2);
    ctx.fillStyle = PALETTE.orange;
    ctx.fillRect(18, 16, 6, TITLE_H - 32);

    // Title-bar controls, right to left
    let bx = W - 14;
    const ctrl = (label, w, onClick, opts) => { bx -= w; this.button(label, bx, 12, w, 40, onClick, { ...opts, compact: true }); bx -= 8; };
    if (this.closable) ctrl('✕', 44, () => this.close());
    if (this.scalable && this.onScale) { ctrl('+', 44, () => this.onScale(1.15)); ctrl('−', 44, () => this.onScale(1 / 1.15)); }
    if (this.explodable && this.onExplode) ctrl(this.exploded ? 'Collapse' : 'Explode', 120, () => this.onExplode(), { active: this.exploded });

    ctx.fillStyle = THEME.ink;
    ctx.font = `700 25px ${THEME.font}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(ctx, this.title, bx - 44), 38, TITLE_H / 2 + 1);

    this.draw(ctx);
    this.texture.needsUpdate = true;

    if (this.layersDirty) {
      this.layersDirty = false;
      for (const l of this.layers) {
        l.ctx.clearRect(0, 0, W, H);
        l.drawFn(l.ctx);
        l.texture.needsUpdate = true;
      }
    }
  }

  close() { this.onClose?.(); }

  /** Change the panel height (e.g. when the dashboard gains datasets). Keeps the top edge in place. */
  resize(height) {
    const oldH = this.mesh.geometry.parameters.height;
    const width = this.mesh.geometry.parameters.width;
    this.canvas.height = Math.round(height * PX_PER_M);
    this.texture.dispose();
    this.texture = makeTexture(this.canvas);
    this.mesh.material.map = this.texture;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(width, height);
    this.mesh.position.y -= (height - oldH) / 2;
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------------
  //  Drawing helpers (call from draw)
  // ---------------------------------------------------------------------------------

  button(label, x, y, w, h, onClick, { active = false, compact = false, primary = false } = {}) {
    const { ctx } = this;
    const hovered = this.hoverPx && inRect(this.hoverPx, x, y, w, h);
    ctx.fillStyle = primary ? PALETTE.trojanBlue
      : active ? 'rgba(115,197,251,0.20)'
      : hovered ? 'rgba(115,197,251,0.14)' : 'rgba(255,255,255,0.05)';
    roundRect(ctx, x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = active || hovered ? PALETTE.iceBlue : primary ? PALETTE.trojanBlue : 'rgba(83,97,122,1)';
    ctx.lineWidth = 2; roundRect(ctx, x, y, w, h, 10); ctx.stroke();
    if (active) { // small orange accent dot marks the active state
      ctx.fillStyle = PALETTE.orange;
      ctx.beginPath(); ctx.arc(x + 14, y + h / 2, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = active ? PALETTE.frost : PALETTE.white;
    ctx.font = `600 ${compact ? 21 : 21}px ${THEME.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2 + (active ? 7 : 0), y + h / 2 + 1);
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

  /** Uppercase, letter-spaced eyebrow line in C11 Advisor Blue Gray (like "OPERATION SEMI / MI-CHIPS"). */
  eyebrow(str, x, y) {
    const { ctx } = this;
    ctx.font = `700 17px ${THEME.font}`;
    ctx.fillStyle = THEME.eyebrow;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    if ('letterSpacing' in ctx) { ctx.letterSpacing = '3px'; ctx.fillText(str.toUpperCase(), x, y); ctx.letterSpacing = '0px'; }
    else ctx.fillText(str.toUpperCase().split('').join(' '), x, y);
  }

  /** Wrapped paragraph in C06 Body Silver. Returns the y below it. */
  paragraph(str, x, y, maxW, { size = 20, color = THEME.muted, lineH = 1.35, maxLines = 4 } = {}) {
    const { ctx } = this;
    ctx.font = `400 ${size}px ${THEME.font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const lines = wrapText(ctx, str, maxW);
    lines.slice(0, maxLines).forEach((line, i) => {
      ctx.fillText(i === maxLines - 1 && lines.length > maxLines ? ellipsize(ctx, line + '…', maxW) : line, x, y);
      y += size * lineH;
    });
    return y;
  }

  // ---------------------------------------------------------------------------------
  //  Input (called by the interaction system)
  // ---------------------------------------------------------------------------------

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

  dispose() { disposeObject(this.root); }
}

function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
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

export function makeLabel(text, { height = 0.022, color = THEME.ink, weight = 600, bg = 'rgba(11,15,25,0.72)' } = {}) {
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

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeTexture(c), transparent: true, depthWrite: false }));
  sprite.scale.set((height * w) / h, height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  });
}
