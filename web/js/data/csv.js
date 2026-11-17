// =====================================================================================
//  csv.js
//  MI-CHIPS (NSF #2606117): parses lab-data CSVs into datasets. Files start with '#'
//  metadata lines (several "# key: value" pairs may share a line); 'type' is required.
//
//    # type: series   header row  x,<name1>,<name2>,...   then rows        keys: x, y
//    # type: field    numeric matrix, first row = ymin, columns xmin→xmax
//                     keys: xmin xmax ymin ymax x y quantity unit highlight(43, 47) diverging(true)
//    # type: wafer    rows x_mm,y_mm,value      keys: quantity unit lsl usl diameter die(10 x 12)
//    # type: spc      one value per row         keys: quantity unit target lsl usl baseline
//  Common keys: title, description, source, category (measurement | simulation | quality)
// =====================================================================================

import { makeField, fieldSet, recomputeRange, waferStats, spcCompute } from './datasets.js';

const PALETTE = ['#2FA4E7', '#FF8A3D', '#7BD14B', '#F2D43D', '#E45FD6', '#2EC4B6'];
const num = (s) => {
  const v = Number(String(s).trim());
  return String(s).trim() !== '' && Number.isFinite(v) ? v : null;
};

export function parseCsv(text, fileName = 'data.csv') {
  const meta = {};
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      for (const part of line.split('#')) {
        const i = part.indexOf(':');
        if (i > 0) meta[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
      }
      continue;
    }
    rows.push(line.split(',').map((s) => s.trim()));
  }

  const f = (k, d) => (meta[k] != null && num(meta[k]) != null ? num(meta[k]) : d);
  const base = fileName.replace(/\.csv$/i, '');
  let d;
  switch ((meta.type || '').toLowerCase()) {
    case 'series': d = series(rows, meta); break;
    case 'field': d = field(rows, meta, f); break;
    case 'wafer': d = wafer(rows, meta, f); break;
    case 'spc': d = spc(rows, meta, f); break;
    default: throw new Error("missing or unknown '# type:' (series | field | wafer | spc)");
  }
  d.id = 'csv-' + base;
  d.title = meta.title || base;
  d.description = meta.description || '';
  d.source = meta.source || fileName;
  const cat = (meta.category || '').toLowerCase();
  if (cat) d.category = cat[0].toUpperCase() + cat.slice(1);
  return d;
}

function series(rows, meta) {
  if (rows.length < 2) throw new Error('series needs a header row and data rows');
  const header = rows[0];
  const s = header.slice(1).map((name, i) => ({ name, color: PALETTE[i % PALETTE.length], points: [] }));
  for (const r of rows.slice(1)) {
    const x = num(r[0]);
    if (x == null) continue;
    for (let c = 1; c < Math.min(r.length, header.length); c++) {
      const y = num(r[c]);
      if (y != null) s[c - 1].points.push([x, y]);
    }
  }
  return { kind: 'plot', category: 'Measurement', xLabel: meta.x || header[0], yLabel: meta.y || 'Value', series: s, refLines: [] };
}

function field(rows, meta, f) {
  const m = rows.filter((r) => r.every((s) => num(s) != null));
  const ny = m.length, nx = ny ? m[0].length : 0;
  if (nx < 2 || ny < 2) throw new Error('field needs at least a 2 × 2 numeric matrix');
  const g = makeField(nx, ny, {
    category: 'Simulation',
    xMin: f('xmin', 0), xMax: f('xmax', nx - 1), yMin: f('ymin', 0), yMax: f('ymax', ny - 1),
    xLabel: meta.x || 'x', yLabel: meta.y || 'y', quantity: meta.quantity || 'Value', unit: meta.unit || '',
    diverging: (meta.diverging || '').toLowerCase() === 'true',
    highlightLevels: (meta.highlight || '').split(/[,;]/).map(num).filter((v) => v != null),
  });
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) fieldSet(g, x, y, num(m[y][x]) ?? 0);
  return recomputeRange(g);
}

function wafer(rows, meta, f) {
  const [dw, dh] = (meta.die || '10 x 10').toLowerCase().split('x').map(num);
  const w = {
    kind: 'wafer', category: 'Measurement', quantity: meta.quantity || 'Value', unit: meta.unit || '',
    diameterMm: f('diameter', 300), dieW: dw || 10, dieH: dh || 10,
    lsl: meta.lsl != null ? f('lsl', null) : null, usl: meta.usl != null ? f('usl', null) : null, dies: [],
  };
  for (const r of rows) {
    const x = num(r[0]), y = num(r[1]), v = num(r[2]);
    if (x == null || y == null || v == null) continue; // skips the header
    w.dies.push({ x, y, value: v, col: Math.floor(x / w.dieW), row: Math.floor(y / w.dieH) });
  }
  if (!w.dies.length) throw new Error('wafer file has no x_mm, y_mm, value rows');
  return waferStats(w);
}

function spc(rows, meta, f) {
  const values = rows.map((r) => num(r[r.length - 1])).filter((v) => v != null);
  if (values.length < 8) throw new Error('spc needs at least 8 values');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return spcCompute({
    kind: 'spc', category: 'Quality', quantity: meta.quantity || 'Value', unit: meta.unit || '', sampleLabel: 'Sample',
    target: f('target', mean), lsl: f('lsl', mean - 1), usl: f('usl', mean + 1), baseline: f('baseline', 0), values,
  });
}
