// =====================================================================================
//  contours.js
//  MI-CHIPS (NSF #2606117): marching-squares iso-lines. Segments come back in normalized
//  grid coordinates (u, v) ∈ [0,1]², so the same result can be drawn on a 2D canvas,
//  lifted onto a 3D surface, or projected onto its base.
// =====================================================================================

import { fieldAt } from '../data/datasets.js';

/** N evenly spaced levels strictly inside (min, max), plus the field's highlight levels. */
export function contourLevels(f, count) {
  const levels = [];
  for (let k = 1; k <= count; k++) levels.push({ level: f.min + (k * (f.max - f.min)) / (count + 1), highlight: false });
  for (const h of f.highlightLevels || []) if (h > f.min && h < f.max) levels.push({ level: h, highlight: true });
  if (f.userThreshold != null && f.userThreshold > f.min && f.userThreshold < f.max) levels.push({ level: f.userThreshold, highlight: true }); // focus-mode threshold
  return levels;
}

export function computeContours(f, levels) {
  const segs = [];
  const { nx, ny } = f;
  const su = 1 / (nx - 1), sv = 1 / (ny - 1);
  for (const { level: L, highlight } of levels) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        // Corners: 0 = (x,y), 1 = (x+1,y), 2 = (x+1,y+1), 3 = (x,y+1)
        const v0 = fieldAt(f, x, y), v1 = fieldAt(f, x + 1, y), v2 = fieldAt(f, x + 1, y + 1), v3 = fieldAt(f, x, y + 1);
        const c = (v0 > L ? 1 : 0) | (v1 > L ? 2 : 0) | (v2 > L ? 4 : 0) | (v3 > L ? 8 : 0);
        if (c === 0 || c === 15) continue;
        const t = (a, b) => (Math.abs(b - a) < 1e-12 ? 0.5 : (L - a) / (b - a));
        const E = (e) => {
          switch (e) {
            case 0: return [(x + t(v0, v1)) * su, y * sv]; // bottom
            case 1: return [(x + 1) * su, (y + t(v1, v2)) * sv]; // right
            case 2: return [(x + t(v3, v2)) * su, (y + 1) * sv]; // top
            default: return [x * su, (y + t(v0, v3)) * sv]; // left
          }
        };
        const add = (a, b) => segs.push({ a: E(a), b: E(b), level: L, highlight });
        const centreAbove = (v0 + v1 + v2 + v3) / 4 > L;
        switch (c) {
          case 1: case 14: add(3, 0); break;
          case 2: case 13: add(0, 1); break;
          case 3: case 12: add(3, 1); break;
          case 4: case 11: add(1, 2); break;
          case 6: case 9: add(0, 2); break;
          case 7: case 8: add(3, 2); break;
          case 5: if (centreAbove) { add(0, 1); add(2, 3); } else { add(3, 0); add(1, 2); } break; // saddle
          case 10: if (centreAbove) { add(3, 0); add(1, 2); } else { add(0, 1); add(2, 3); } break; // saddle
        }
      }
    }
  }
  return segs;
}
