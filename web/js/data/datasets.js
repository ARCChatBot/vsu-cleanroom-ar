// =====================================================================================
//  datasets.js
//  MI-CHIPS (NSF #2606117): data models for web AR lab data visualization.
//    kind 'plot'   2D measurement curves (I–V, C–V, spectra, ...)
//    kind 'field'  scalar field on a regular grid (TCAD/FEM fields, thermal maps, process windows)
//    kind 'wafer'  per-die wafer map (sheet resistance, Vth, ...)
//    kind 'spc'    individuals control chart with Western Electric rules and Cp/Cpk/Ppk
// =====================================================================================

export const CATEGORIES = ['Measurement', 'Simulation', 'Quality'];

/** Views available for each dataset kind (labels on the dashboard buttons). */
export const VIEW_KINDS = {
  plot: ['Plot'],
  field: ['2D', '3D'],
  wafer: ['3D map'],
  spc: ['Chart'],
};

// ---------------------------------------------------------------------------------
//  Fields
// ---------------------------------------------------------------------------------

export function makeField(nx, ny, props) {
  const f = {
    kind: 'field', nx, ny, values: new Float32Array(nx * ny),
    xMin: 0, xMax: 1, yMin: 0, yMax: 1, xLabel: 'x', yLabel: 'y', quantity: 'Value', unit: '',
    diverging: false, highlightLevels: [], contourCount: 10, min: 0, max: 1,
    source: 'Synthetic sample data', description: '', category: 'Simulation',
    ...props,
  };
  return f;
}

export const fieldAt = (f, ix, iy) => f.values[iy * f.nx + ix];
export const fieldSet = (f, ix, iy, v) => { f.values[iy * f.nx + ix] = v; };

export function recomputeRange(f) {
  let lo = Infinity, hi = -Infinity;
  for (const v of f.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 1e-12) hi = lo + 1;
  f.min = lo; f.max = hi;
  return f;
}

export const normalize = (f, v) => (v - f.min) / (f.max - f.min);

/**
 * Colour mapping with an optional user colour window [colorLo, colorHi] (focus mode). Values
 * outside the window clamp to the ends of the colormap, which raises contrast where it matters.
 * Heights and contours still use the full data range.
 */
export function colorNorm(f, v) {
  const lo = f.colorLo ?? f.min, hi = f.colorHi ?? f.max;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1)));
}

/** Fraction of the field above a level (0–1). */
export function fractionAbove(f, level) {
  let n = 0;
  for (const v of f.values) if (v > level) n++;
  return n / f.values.length;
}

/** Remembers a dataset's original adjustable fields the first time it is manipulated (for Reset). */
export function snapshot(d, keys) {
  d._orig ||= {};
  for (const k of keys) if (!(k in d._orig)) d._orig[k] = d[k];
}
export function restore(d) {
  if (!d._orig) return;
  Object.assign(d, d._orig);
  delete d._orig;
}
export const dataX = (f, u) => f.xMin + u * (f.xMax - f.xMin);
export const dataY = (f, v) => f.yMin + v * (f.yMax - f.yMin);

/** Bilinear sample at normalized (u, v) ∈ [0,1]². v = 0 is yMin. */
export function sampleUV(f, u, v) {
  const fx = Math.min(Math.max(u, 0), 1) * (f.nx - 1), fy = Math.min(Math.max(v, 0), 1) * (f.ny - 1);
  const x0 = Math.min(Math.floor(fx), f.nx - 2), y0 = Math.min(Math.floor(fy), f.ny - 2);
  const tx = fx - x0, ty = fy - y0;
  const a = fieldAt(f, x0, y0) + (fieldAt(f, x0 + 1, y0) - fieldAt(f, x0, y0)) * tx;
  const b = fieldAt(f, x0, y0 + 1) + (fieldAt(f, x0 + 1, y0 + 1) - fieldAt(f, x0, y0 + 1)) * tx;
  return a + (b - a) * ty;
}

// ---------------------------------------------------------------------------------
//  Wafer maps
// ---------------------------------------------------------------------------------

export const inSpec = (w, v) => (w.lsl == null || v >= w.lsl) && (w.usl == null || v <= w.usl);

export function waferStats(w) {
  const v = w.dies.map((d) => d.value);
  const n = v.length;
  w.mean = v.reduce((a, b) => a + b, 0) / n;
  w.sigma = Math.sqrt(v.reduce((a, x) => a + (x - w.mean) ** 2, 0) / Math.max(1, n - 1));
  w.min = Math.min(...v);
  w.max = Math.max(...v);
  if (w.max - w.min < 1e-12) w.max = w.min + 1;
  w.uniformityPct = w.mean ? ((w.max - w.min) / (2 * w.mean)) * 100 : 0;
  w.inSpecPct = (100 * v.filter((x) => inSpec(w, x)).length) / n;
  return w;
}

// ---------------------------------------------------------------------------------
//  SPC (individuals / moving range)
// ---------------------------------------------------------------------------------

/**
 * Limits are frozen from a Phase-I baseline (first `baseline` samples, 0 = all), which is
 * standard practice so a later drift can't drag the limits along and hide itself.
 * σ̂(within) = MR̄ / 1.128. Western Electric rules 1–4 are applied to every sample.
 */
export function spcCompute(c) {
  const vals = c.values, n = vals.length;
  const nb = c.baseline >= 8 && c.baseline <= n ? c.baseline : n;
  const base = vals.slice(0, nb);
  const mean = base.reduce((a, b) => a + b, 0) / nb;
  let mr = 0;
  for (let i = 1; i < nb; i++) mr += Math.abs(base[i] - base[i - 1]);
  const sw = mr / Math.max(1, nb - 1) / 1.128;
  const overallMean = vals.reduce((a, b) => a + b, 0) / n;
  const so = Math.sqrt(vals.reduce((a, x) => a + (x - overallMean) ** 2, 0) / Math.max(1, n - 1));

  Object.assign(c, {
    mean, sigmaWithin: sw, sigmaOverall: so, overallMean,
    ucl: mean + 3 * sw, lcl: mean - 3 * sw,
    cp: (c.usl - c.lsl) / (6 * sw),
    cpk: Math.min(c.usl - mean, mean - c.lsl) / (3 * sw),
    ppk: Math.min(c.usl - overallMean, overallMean - c.lsl) / (3 * so),
  });

  const z = (i) => (vals[i] - mean) / sw;
  const side = (i) => (vals[i] >= mean ? 1 : -1);
  const countSameSide = (end, win, lim) => {
    let k = 0;
    for (let j = end - win + 1; j <= end; j++) if (side(j) === side(end) && Math.abs(z(j)) > lim) k++;
    return k;
  };

  c.violations = [];
  for (let i = 0; i < n; i++) {
    let rule = null;
    if (Math.abs(z(i)) > 3) rule = 'Rule 1: beyond 3σ';
    else if (i >= 2 && countSameSide(i, 3, 2) >= 2) rule = 'Rule 2: 2 of 3 beyond 2σ';
    else if (i >= 4 && countSameSide(i, 5, 1) >= 4) rule = 'Rule 3: 4 of 5 beyond 1σ';
    else if (i >= 7) {
      let all = true;
      for (let j = i - 7; j <= i; j++) if (side(j) !== side(i)) { all = false; break; }
      if (all) rule = 'Rule 4: 8 in a row on one side';
    }
    if (rule) c.violations.push({ index: i, rule });
  }
  return c;
}
