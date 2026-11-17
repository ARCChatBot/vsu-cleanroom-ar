// =====================================================================================
//  dashboard.js
//  MI-CHIPS (NSF #2606117): in-scene dashboard listing every dataset by category, with
//  a button per view type. Lives in the 3D scene so it works the same in AR (no DOM).
// =====================================================================================

import { CanvasPanel, PX_PER_M } from '../render/panel.js';
import { THEME } from '../render/chart.js';
import { CATEGORIES, VIEW_KINDS } from '../data/datasets.js';

export class Dashboard extends CanvasPanel {
  constructor(app) {
    super({ title: 'MI-CHIPS  ·  Lab Data Visualization', width: 0.56, height: Dashboard.heightFor(app.datasets), closable: false });
    this.app = app;
    this.kind = 'dashboard';
    this.interactables = [this.mesh];
  }

  static heightFor(datasets) {
    const cats = new Set(datasets.map((d) => d.category)).size;
    return (60 + 110 + cats * 52 + datasets.length * 64 + 100) / PX_PER_M;
  }

  refresh() {
    const h = Dashboard.heightFor(this.app.datasets);
    if (Math.abs(h - this.mesh.geometry.parameters.height) > 1e-6) this.resize(h);
    this.dirty = true;
  }

  draw() {
    const app = this.app, W = this.W;
    let y = this.paragraph('Measurements, simulation fields and quality metrics as 2D charts, contour maps and 3D renderings. Point at data to read values; drag title bars or base plates to move views.', 22, 74, W - 44, { size: 19 }) + 10;

    for (const cat of CATEGORIES) {
      const list = app.datasets.filter((d) => d.category === cat);
      if (!list.length) continue;
      this.ctx.fillStyle = 'rgba(255,255,255,0.12)';
      this.ctx.fillRect(22, y + 8, W - 44, 2);
      this.text(cat.toUpperCase(), 22, y + 18, { size: 21, weight: 800, color: THEME.orange });
      y += 52;
      for (const d of list) {
        this.text(d.title, 22, y + 22, { size: 22, weight: 600, baseline: 'middle' });
        let x = W - 22;
        for (const kind of [...(VIEW_KINDS[d.kind] || [])].reverse()) {
          const open = app.isOpen(d, kind);
          const bw = 30 + kind.length * 14;
          x -= bw;
          this.button(kind, x, y, bw, 44, () => app.toggle(d, kind), { active: open });
          x -= 10;
        }
        y += 64;
      }
    }

    y += 8;
    let x = 22;
    x = this.button('Arrange around me', x, y, 250, 46, () => app.arrange());
    x = this.button('Close all', x, y, 150, 46, () => app.closeAll());
    this.text(`${app.datasets.length} datasets`, x + 6, y + 23, { size: 18, color: THEME.muted, baseline: 'middle' });
  }
}
