// =====================================================================================
//  summaries.js
//  MI-CHIPS (NSF #2606117): compact, numeric summaries of each dataset. They are the
//  data context sent to the AI analyst, and the local (offline) analyst uses them too.
//  Kept small on purpose (key statistics plus a coarse downsample), never the raw data.
// =====================================================================================

import { fieldAt, normalize, dataX, dataY, inSpec } from '../data/datasets.js';

const r = (v, n = 4) => Number(v.toPrecision(n));

export function summarize(d) {
  switch (d.kind) {
    case 'field': return summarizeField(d);
    case 'wafer': return summarizeWafer(d);
    case 'spc': return summarizeSpc(d);
    case 'plot': return summarizePlot(d);
    default: return { headline: d.title, lines: [] };
  }
}

function summarizeField(f) {
  let max = -Infinity, min = Infinity, mx = 0, my = 0, nx = 0, ny = 0, sum = 0;
  for (let y = 0; y < f.ny; y++) for (let x = 0; x < f.nx; x++) {
    const v = fieldAt(f, x, y); sum += v;
    if (v > max) { max = v; mx = x; my = y; }
    if (v < min) { min = v; nx = x; ny = y; }
  }
  const at = (ix, iy) => `(${f.xLabel} ${r(dataX(f, ix / (f.nx - 1)), 3)}, ${f.yLabel} ${r(dataY(f, iy / (f.ny - 1)), 3)})`;
  const mean = sum / (f.nx * f.ny);
  const lines = [
    `${f.quantity} ranges ${r(min)} to ${r(max)} ${f.unit}; mean ${r(mean)} ${f.unit}.`,
    `Maximum at ${at(mx, my)}; minimum at ${at(nx, ny)}.`,
  ];
  const hl = [...(f.highlightLevels || [])].sort((a, b) => a - b);
  if (hl.length >= 2) {
    const n = f.values.filter((v) => v >= hl[0] && v <= hl[hl.length - 1]).length;
    lines.push(`${r((100 * n) / f.values.length, 3)}% of the map lies inside [${hl[0]}, ${hl[hl.length - 1]}] ${f.unit} (the orange limit contours).`);
  } else if (hl.length === 1) {
    const n = f.values.filter((v) => v > hl[0]).length;
    lines.push(`${r((100 * n) / f.values.length, 3)}% of the map is above the ${hl[0]} ${f.unit} threshold (orange contour).`);
  }
  // 6×6 coarse grid, top row = yMax
  const g = 6, rows = [];
  for (let j = g - 1; j >= 0; j--) {
    const row = [];
    for (let i = 0; i < g; i++) row.push(r(fieldAt(f, Math.round((i / (g - 1)) * (f.nx - 1)), Math.round((j / (g - 1)) * (f.ny - 1))), 3));
    rows.push(row.join(', '));
  }
  lines.push(`Coarse 6×6 grid (rows from ${f.yLabel} max to min, columns ${f.xLabel} min to max): ${rows.join(' | ')}`);
  return { headline: `${f.title}: ${f.quantity} ${r(min, 3)}–${r(max, 3)} ${f.unit}, peak at ${at(mx, my)}.`, lines };
}

function summarizeWafer(w) {
  const bad = w.dies.filter((d) => !inSpec(w, d.value));
  const rad = w.diameterMm / 2;
  const bands = [0, 0.25, 0.5, 0.75, 1.01].map((k) => k * rad);
  const radial = [];
  for (let i = 0; i < 4; i++) {
    const sel = w.dies.filter((d) => { const rr = Math.hypot(d.x, d.y); return rr >= bands[i] && rr < bands[i + 1]; });
    if (sel.length) radial.push(`${Math.round(bands[i])}–${Math.round(bands[i + 1])} mm: ${r(sel.reduce((a, d) => a + d.value, 0) / sel.length)}`);
  }
  const side = (pred) => { const s = w.dies.filter(pred); return s.length ? r(s.reduce((a, d) => a + d.value, 0) / s.length) : '–'; };
  const maxD = w.dies.reduce((a, d) => (d.value > a.value ? d : a)), minD = w.dies.reduce((a, d) => (d.value < a.value ? d : a));
  const lines = [
    `${w.dies.length} dies on a ${w.diameterMm} mm wafer. Mean ${r(w.mean)} ${w.unit}, σ ${r(w.sigma, 3)}, CV ${r((100 * w.sigma) / w.mean, 3)}%, range uniformity ±${r(w.uniformityPct, 3)}%.`,
    `Spec [${w.lsl ?? '–'}, ${w.usl ?? '–'}] ${w.unit}: ${r(w.inSpecPct, 3)}% in spec, ${bad.length} dies out of spec.`,
    `Max ${r(maxD.value)} at (${maxD.x}, ${maxD.y}) mm; min ${r(minD.value)} at (${minD.x}, ${minD.y}) mm.`,
    `Radial mean profile: ${radial.join('; ')}.`,
    `Left half mean ${side((d) => d.x < 0)}, right half ${side((d) => d.x > 0)}; bottom half ${side((d) => d.y < 0)}, top half ${side((d) => d.y > 0)}.`,
  ];
  if (bad.length) lines.push(`Out-of-spec die centres (x, y mm → value): ${bad.slice(0, 20).map((d) => `(${d.x}, ${d.y}) → ${r(d.value)}`).join('; ')}${bad.length > 20 ? '; …' : ''}.`);
  return { headline: `${w.title}: mean ${r(w.mean)} ${w.unit}, ${r(w.inSpecPct, 3)}% in spec, ${bad.length} dies out of spec.`, lines };
}

function summarizeSpc(c) {
  const n = c.values.length, last = c.values.slice(-10);
  const slope = last.length > 1 ? (last[last.length - 1] - last[0]) / (last.length - 1) : 0;
  const lines = [
    `${n} ${c.sampleLabel || 'sample'}s of ${c.quantity} (${c.unit}). Limits from the first ${c.baseline || n} samples: mean ${r(c.mean)}, σ(within) ${r(c.sigmaWithin, 3)}, UCL ${r(c.ucl)}, LCL ${r(c.lcl)}.`,
    `Spec [${c.lsl}, ${c.usl}], target ${c.target}. Cp ${r(c.cp, 3)}, Cpk ${r(c.cpk, 3)} (baseline), Ppk ${r(c.ppk, 3)} (all samples).`,
    `Last 10 samples trend ${slope >= 0 ? '+' : ''}${r(slope, 3)} ${c.unit} per ${c.sampleLabel || 'sample'}; latest value ${r(c.values[n - 1])}.`,
    `Western Electric violations (${c.violations.length}): ${c.violations.map((v) => `${c.sampleLabel || 'sample'} ${v.index + 1} = ${r(c.values[v.index])} (${v.rule})`).join('; ') || 'none'}.`,
  ];
  return { headline: `${c.title}: Cpk ${r(c.cpk, 3)}, Ppk ${r(c.ppk, 3)}, ${c.violations.length} rule violations.`, lines };
}

function summarizePlot(p) {
  const lines = p.series.map((s) => {
    const ys = s.points.map((q) => q[1]), xs = s.points.map((q) => q[0]);
    const iMax = ys.indexOf(Math.max(...ys)), iMin = ys.indexOf(Math.min(...ys));
    const step = Math.max(1, Math.floor(s.points.length / 8));
    const sample = s.points.filter((_, i) => i % step === 0).map((q) => `(${r(q[0], 3)}, ${r(q[1], 3)})`).join(' ');
    return `${s.name}: ${s.points.length} points, ${p.xLabel} ${r(Math.min(...xs), 3)}–${r(Math.max(...xs), 3)}; max ${p.yLabel} ${r(ys[iMax])} at ${r(xs[iMax], 3)}, min ${r(ys[iMin])} at ${r(xs[iMin], 3)}. Samples: ${sample}`;
  });
  return { headline: `${p.title}: ${p.series.length} series of ${p.yLabel} vs ${p.xLabel}.`, lines };
}

/** Full text block for the AI system prompt. */
export function datasetContext(datasets) {
  return datasets.map((d) => {
    const s = summarize(d);
    return `### ${d.title}  [id: ${d.id}, kind: ${d.kind}, category: ${d.category}]\n${d.description || ''}\n${s.lines.map((l) => '- ' + l).join('\n')}`;
  }).join('\n\n');
}
