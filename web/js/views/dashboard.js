// =====================================================================================
//  dashboard.js
//  MI-CHIPS (NSF #2606117): in-scene dashboard listing every dataset by category, with
//  a button per view type. It lives in the 3D scene, so it works the same in AR (no DOM).
// =====================================================================================

import { CanvasPanel, PX_PER_M } from '../render/panel.js';
import { THEME, PALETTE } from '../render/chart.js';
import { CATEGORIES, VIEW_KINDS } from '../data/datasets.js';

export class Dashboard extends CanvasPanel {
  constructor(app) {
    super({ title: 'Lab Data Visualization', width: 0.58, height: Dashboard.heightFor(app.datasets), closable: false });
    this.app = app;
    this.kind = 'dashboard';
    this.interactables = [this.mesh];
  }

  static heightFor(datasets) {
    const cats = new Set(datasets.map((d) => d.category)).size;
    return (64 + 150 + cats * 54 + datasets.length * 64 + 110) / PX_PER_M;
  }

  refresh() {
    const h = Dashboard.heightFor(this.app.datasets);
    if (Math.abs(h - this.mesh.geometry.parameters.height) > 1e-6) this.resize(h);
    this.dirty = true;
  }

  draw(ctx) {
    const app = this.app, W = this.W;
    this.eyebrow(`Operation SEMI / MI-CHIPS${app.user ? `  ·  ${app.user.first} ${app.user.last} (${app.user.id})` : ''}`, 22, 80);
    let y = this.paragraph('Measurements, simulation fields and quality metrics as charts, contour maps and 3D renderings. Grab title bars or base plates to move views, use Explode to separate layers, and ask the AI analyst by voice. In AR, point at empty space and air-tap and hold for a second to bring every view in front of you; you can also poke panel buttons with a fingertip.', 22, 108, W - 44, { size: 19 }) + 6;

    for (const cat of CATEGORIES) {
      const list = app.datasets.filter((d) => d.category === cat);
      if (!list.length) continue;
      ctx.fillStyle = PALETTE.labelSlate;
      ctx.fillRect(22, y + 10, W - 44, 1.5);
      ctx.fillStyle = PALETTE.orange;
      ctx.fillRect(22, y + 22, 6, 22);
      this.text(cat.toUpperCase(), 38, y + 22, { size: 20, weight: 800, color: THEME.eyebrow });
      y += 54;
      for (const d of list) {
        this.text(d.title, 22, y + 22, { size: 22, weight: 600, baseline: 'middle' });
        let x = W - 22;
        for (const kind of [...(VIEW_KINDS[d.kind] || [])].reverse()) {
          const open = app.isOpen(d, kind);
          const bw = 44 + kind.length * 13;
          x -= bw;
          this.button(kind, x, y, bw, 44, () => app.toggle(d, kind), { active: open });
          x -= 10;
        }
        y += 64;
      }
    }

    y += 10;
    let x = 22;
    x = this.button('Arrange around me', x, y, 250, 48, () => app.arrange());
    x = this.button(app.anyExploded() ? 'Collapse all' : 'Explode all', x, y, 170, 48, () => app.execute({ type: 'explode', target: 'all', exploded: !app.anyExploded() }));
    this.button('Close all', x, y, 140, 48, () => app.closeAll());
  }
}
