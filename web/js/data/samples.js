// =====================================================================================
//  samples.js
//  MI-CHIPS (NSF #2606117): physically plausible synthetic datasets, seeded so lessons
//  and screenshots are reproducible.
//
//  ⚠ Teaching-grade models (square-law MOSFET, SOR Laplace solve, diffusion thermal solve).
//    They are NOT calibrated TCAD or metrology results.
// =====================================================================================

import { SERIES_COLORS } from '../render/chart.js';
import { makeField, fieldAt, fieldSet, recomputeRange, dataX, dataY, waferStats, spcCompute } from './datasets.js';

/** Deterministic RNG (mulberry32) with a Gaussian helper. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.gauss = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return next;
}

export function allSamples() {
  const [phi, efield] = mosfetFields();
  return [mosfetOutputCurves(), sheetResistanceWafer(), phi, efield, chipThermal(), processWindow(), gateCdChart()];
}

// ---------------------------------------------------------------------------------
//  Measurement: NMOS output characteristics
// ---------------------------------------------------------------------------------

function mosfetOutputCurves() {
  const r = rng(11);
  const vth = 0.45, k = 2.2 /* mA/V² */, lambda = 0.08;
  const colors = SERIES_COLORS; // MI-CHIPS palette, ordered by gate voltage
  const series = [];
  for (let g = 0; g < 5; g++) {
    const vgs = 0.6 + 0.15 * g, vov = vgs - vth, pts = [];
    for (let i = 0; i <= 48; i++) {
      const vds = (1.2 * i) / 48;
      let id = vds < vov
        ? k * (vov * vds - 0.5 * vds * vds) * (1 + lambda * vds) // triode
        : 0.5 * k * vov * vov * (1 + lambda * vds); // saturation
      id += r.gauss() * 0.004;
      pts.push([vds, Math.max(0, id)]);
    }
    series.push({ name: `V_GS = ${vgs.toFixed(2)} V`, color: colors[g], points: pts });
  }
  return {
    kind: 'plot', id: 'iv-nmos', title: 'NMOS Output Curves', category: 'Measurement',
    description: 'I_D vs V_DS at five gate voltages, W/L = 10 µm / 0.18 µm. Probe-station style data with measurement noise.',
    xLabel: 'V_DS (V)', yLabel: 'I_D (mA)', series, refLines: [], source: 'Synthetic sample data',
  };
}

// ---------------------------------------------------------------------------------
//  Measurement: 300 mm wafer sheet resistance
// ---------------------------------------------------------------------------------

function sheetResistanceWafer() {
  const r = rng(23);
  const w = {
    kind: 'wafer', id: 'rs-wafer', title: 'Sheet Resistance Wafer Map', category: 'Measurement',
    description: '4-point-probe R_s per die after implant anneal: radial bowl, slight left-to-right tilt, one hot cluster.',
    quantity: 'R_s', unit: 'Ω/sq', lsl: 46, usl: 54, diameterMm: 300, dieW: 10, dieH: 12, dies: [],
    source: 'Synthetic sample data',
  };
  const rad = w.diameterMm / 2 - 3; // 3 mm edge exclusion
  const inside = (cx, cy) => [[-1, -1], [1, -1], [-1, 1], [1, 1]]
    .every(([sx, sy]) => (cx + (sx * w.dieW) / 2) ** 2 + (cy + (sy * w.dieH) / 2) ** 2 <= rad * rad);
  const cols = Math.floor(w.diameterMm / w.dieW) + 2, rows = Math.floor(w.diameterMm / w.dieH) + 2;
  for (let row = -Math.floor(rows / 2); row <= Math.floor(rows / 2); row++) {
    for (let col = -Math.floor(cols / 2); col <= Math.floor(cols / 2); col++) {
      const x = (col + 0.5) * w.dieW, y = (row + 0.5) * w.dieH;
      if (!inside(x, y)) continue;
      const rr = Math.hypot(x, y) / rad;
      let v = 50 * (1 + 0.06 * rr * rr + (0.015 * x) / rad);
      v += 3.2 * Math.exp(-((x - 60) ** 2 + (y + 80) ** 2) / (2 * 18 * 18)); // hot cluster
      v += r.gauss() * 0.4;
      w.dies.push({ col, row, x, y, value: v });
    }
  }
  return waferStats(w);
}

// ---------------------------------------------------------------------------------
//  Simulation: MOSFET cross-section potential and |E| (SOR Laplace solve)
// ---------------------------------------------------------------------------------

function mosfetFields() {
  const nx = 81, ny = 41, width = 1.0, depth = 0.5; // µm
  const phi = new Float32Array(nx * ny), fixed = new Uint8Array(nx * ny);
  const idx = (x, y) => y * nx + x;

  // y = ny-1 is the silicon surface, y = 0 the substrate contact.
  for (let x = 0; x < nx; x++) {
    const xf = (x / (nx - 1)) * width, top = idx(x, ny - 1);
    if (xf < 0.22) { phi[top] = 0; fixed[top] = 1; } // source
    else if (xf > 0.35 && xf < 0.65) { phi[top] = 1.0; fixed[top] = 1; } // gate (oxide folded in)
    else if (xf > 0.78) { phi[top] = 1.2; fixed[top] = 1; } // drain
    phi[idx(x, 0)] = 0; fixed[idx(x, 0)] = 1; // body
  }
  const w = 1.85;
  for (let it = 0; it < 900; it++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = idx(x, y);
        if (fixed[i]) continue;
        const l = phi[idx(x > 0 ? x - 1 : x + 1, y)], r = phi[idx(x < nx - 1 ? x + 1 : x - 1, y)];
        const d = phi[idx(x, y > 0 ? y - 1 : y + 1)], u = phi[idx(x, y < ny - 1 ? y + 1 : y - 1)];
        phi[i] += w * (0.25 * (l + r + d + u) - phi[i]);
      }
    }
  }

  const common = { nx, ny, xMin: 0, xMax: width, yMin: -depth, yMax: 0, xLabel: 'x (µm)', yLabel: 'Depth (µm)', category: 'Simulation' };
  const p = makeField(nx, ny, {
    ...common, id: 'tcad-phi', title: 'MOSFET Potential', quantity: 'Potential', unit: 'V', contourCount: 11,
    description: 'Electrostatic potential in a MOSFET cross-section: source 0 V, gate 1.0 V, drain 1.2 V, body 0 V. Simplified Laplace solve.',
  });
  p.values.set(phi);
  recomputeRange(p);

  const e = makeField(nx, ny, {
    ...common, id: 'tcad-e', title: 'MOSFET Electric Field', quantity: '|E|', unit: 'kV/cm', contourCount: 8,
    description: '|E| from the potential solve. It peaks near the drain edge of the gate, where hot-carrier damage starts.',
  });
  const dx = width / (nx - 1), dy = depth / (ny - 1);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(nx - 1, x + 1), yd = Math.max(0, y - 1), yu = Math.min(ny - 1, y + 1);
      const ex = (phi[idx(xr, y)] - phi[idx(xl, y)]) / ((xr - xl) * dx);
      const ey = (phi[idx(x, yu)] - phi[idx(x, yd)]) / ((yu - yd) * dy);
      fieldSet(e, x, y, Math.hypot(ex, ey) * 10); // 1 V/µm = 10 kV/cm
    }
  }
  recomputeRange(e);
  return [p, e];
}

// ---------------------------------------------------------------------------------
//  Simulation: steady-state die temperature from a power map
// ---------------------------------------------------------------------------------

function chipThermal() {
  const n = 64, size = 10; // mm
  const q = new Float32Array(n * n);
  const hot = (cx, cy, s, p) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x / (n - 1)) * size - cx, dy = (y / (n - 1)) * size - cy;
      q[y * n + x] += p * Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
    }
  };
  hot(2.5, 7.5, 0.8, 1.0); hot(4.5, 7.5, 0.8, 1.1); hot(2.5, 5.5, 0.8, 0.9); hot(4.5, 5.5, 0.8, 1.3); // 4 CPU cores
  hot(7.5, 4.0, 1.8, 0.6); // GPU
  for (let i = 0; i < q.length; i++) q[i] += 0.08; // leakage

  // (∇² − α) θ = −q, zero-flux edges, Gauss–Seidel.
  const t = new Float32Array(n * n), h = size / (n - 1), alpha = 0.35;
  for (let it = 0; it < 1500; it++) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const s = t[y * n + Math.max(0, x - 1)] + t[y * n + Math.min(n - 1, x + 1)]
              + t[Math.max(0, y - 1) * n + x] + t[Math.min(n - 1, y + 1) * n + x];
      t[y * n + x] = (s + h * h * q[y * n + x] * 30) / (4 + alpha * h * h);
    }
  }
  let tMax = 0;
  for (const v of t) tMax = Math.max(tMax, v);

  const f = makeField(n, n, {
    id: 'thermal', title: 'Die Thermal Map', category: 'Simulation',
    description: 'Steady-state junction temperature of a 10 × 10 mm SoC under load: four CPU cores and a GPU block, 45 °C ambient. The orange contour marks the 85 °C throttle threshold.',
    xMin: 0, xMax: size, yMin: 0, yMax: size, xLabel: 'x (mm)', yLabel: 'y (mm)', quantity: 'T_j', unit: '°C',
    contourCount: 9, highlightLevels: [85],
  });
  for (let i = 0; i < t.length; i++) f.values[i] = 45 + (50 * t[i]) / tMax; // peak 95 °C
  return recomputeRange(f);
}

// ---------------------------------------------------------------------------------
//  Quality: lithography process window (CD vs focus × dose)
// ---------------------------------------------------------------------------------

function processWindow() {
  const nx = 61, ny = 51;
  const f = makeField(nx, ny, {
    id: 'process-window', title: 'Litho Process Window', category: 'Quality',
    description: 'Printed CD across a focus–exposure matrix. The orange contours are the 43 nm and 47 nm spec limits, so the region between them is the usable process window.',
    xMin: -0.3, xMax: 0.3, yMin: 20, yMax: 30, xLabel: 'Focus (µm)', yLabel: 'Dose (mJ/cm²)', quantity: 'CD', unit: 'nm',
    diverging: true, contourCount: 12, highlightLevels: [43, 47],
  });
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const fo = dataX(f, x / (nx - 1)), d = dataY(f, y / (ny - 1)) - 25;
    fieldSet(f, x, y, 45 - 1.6 * d + 60 * fo * fo * (1 + 0.04 * d) - 0.8 * fo * d); // Bossung-like curvature
  }
  return recomputeRange(f);
}

// ---------------------------------------------------------------------------------
//  Quality: gate-CD SPC chart
// ---------------------------------------------------------------------------------

function gateCdChart() {
  const r = rng(37);
  const values = [];
  for (let i = 0; i < 60; i++) {
    let v = 45 + r.gauss() * 0.45;
    if (i === 22) v += 2.3; // excursion
    if (i >= 41) v += 0.11 * (i - 40); // etch drift
    values.push(v);
  }
  return spcCompute({
    kind: 'spc', id: 'spc-cd', title: 'Gate CD Control Chart', category: 'Quality',
    description: 'Post-etch gate CD per lot. Limits are set from lots 1–20. One excursion at lot 23, then the etch drifts upward from lot 42.',
    quantity: 'Gate CD', unit: 'nm', sampleLabel: 'Lot', target: 45, lsl: 43, usl: 47, baseline: 20, values,
    source: 'Synthetic sample data',
  });
}

export { fieldAt };
