// =====================================================================================
//  CsvLoader.cs
//  MI-CHIPS (NSF #2606117): loads lab data from Assets/Data/*.csv so real measurements
//  and simulation exports can be visualized without code changes.
//
//  Every file starts with '#' metadata lines. 'type' is required:
//
//    # type: series        columns: x, <series 1>, <series 2>, ...   (first row = header)
//    # x: V_DS (V)
//    # y: I_D (mA)
//
//    # type: field         a matrix of numbers; first row = YMin, columns run XMin → XMax
//    # xmin: 0   # xmax: 1   # ymin: -0.5   # ymax: 0
//    # x: x (µm)   # y: Depth (µm)   # quantity: Potential   # unit: V   # highlight: 43, 47
//
//    # type: wafer         columns: x_mm, y_mm, value          (first row = header)
//    # quantity: R_s   # unit: Ω/sq   # lsl: 46   # usl: 54   # diameter: 300   # die: 10 x 12
//
//    # type: spc           one value per row (optional header)
//    # quantity: Gate CD   # unit: nm   # target: 45   # lsl: 43   # usl: 47   # baseline: 20
//
//  Common keys: title, description, source, category (measurement | simulation | quality).
//  Several "# key: value" pairs may share one line.
// =====================================================================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public static class CsvLoader
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static List<Dataset> LoadFolder(string folder)
        {
            var result = new List<Dataset>();
            if (!Directory.Exists(folder)) return result;

            foreach (string path in Directory.GetFiles(folder, "*.csv").OrderBy(p => p))
            {
                try
                {
                    Dataset d = Load(path);
                    if (d != null) { result.Add(d); Log.Info($"[DataViz] Loaded {Path.GetFileName(path)} as {d.GetType().Name}"); }
                }
                catch (Exception e)
                {
                    Log.Warn($"[DataViz] Could not load {Path.GetFileName(path)}: {e.Message}");
                }
            }
            return result;
        }

        public static Dataset Load(string path)
        {
            var meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var rows = new List<string[]>();
            foreach (string raw in File.ReadAllLines(path))
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.StartsWith("#")) { ParseMeta(line, meta); continue; }
                rows.Add(line.Split(',').Select(s => s.Trim()).ToArray());
            }

            string id = Path.GetFileNameWithoutExtension(path);
            string type = Get(meta, "type", "").ToLowerInvariant();
            Dataset d;
            switch (type)
            {
                case "series": d = LoadSeries(rows, meta); break;
                case "field":  d = LoadField(rows, meta); break;
                case "wafer":  d = LoadWafer(rows, meta); break;
                case "spc":    d = LoadSpc(rows, meta); break;
                default: throw new FormatException("missing or unknown '# type:' (series | field | wafer | spc)");
            }

            d.Id = "csv-" + id;
            d.Title = Get(meta, "title", id);
            d.Description = Get(meta, "description", "");
            d.Source = Get(meta, "source", Path.GetFileName(path));
            string cat = Get(meta, "category", "").ToLowerInvariant();
            d.Category = cat == "simulation" ? DataCategory.Simulation
                       : cat == "quality" ? DataCategory.Quality
                       : cat == "measurement" ? DataCategory.Measurement
                       : d.Category;
            return d;
        }

        private static PlotData LoadSeries(List<string[]> rows, Dictionary<string, string> meta)
        {
            if (rows.Count < 2) throw new FormatException("series needs a header row and data rows");
            string[] header = rows[0];
            var palette = new uint[] { 0x2FA4E7FF, 0xFF8A3DFF, 0x7BD14BFF, 0xF2D43DFF, 0xE45FD6FF, 0x2EC4B6FF };
            var p = new PlotData
            {
                Category = DataCategory.Measurement,
                XLabel = Get(meta, "x", header[0]),
                YLabel = Get(meta, "y", "Value"),
            };
            for (int c = 1; c < header.Length; c++)
                p.Series.Add(new Series { Name = header[c], Color = Color.Hex(palette[(c - 1) % palette.Length]) });

            foreach (string[] r in rows.Skip(1))
            {
                if (!TryF(r[0], out float x)) continue;
                for (int c = 1; c < Math.Min(r.Length, header.Length); c++)
                    if (TryF(r[c], out float y)) p.Series[c - 1].Points.Add(new Vec2(x, y));
            }
            return p;
        }

        private static FieldGrid LoadField(List<string[]> rows, Dictionary<string, string> meta)
        {
            var numeric = rows.Where(r => r.All(s => TryF(s, out _))).ToList();
            int ny = numeric.Count, nx = numeric.Count > 0 ? numeric[0].Length : 0;
            if (nx < 2 || ny < 2) throw new FormatException("field needs at least a 2 × 2 numeric matrix");

            var g = new FieldGrid(nx, ny)
            {
                Category = DataCategory.Simulation,
                XMin = F(meta, "xmin", 0), XMax = F(meta, "xmax", nx - 1),
                YMin = F(meta, "ymin", 0), YMax = F(meta, "ymax", ny - 1),
                XLabel = Get(meta, "x", "x"), YLabel = Get(meta, "y", "y"),
                Quantity = Get(meta, "quantity", "Value"), Unit = Get(meta, "unit", ""),
                Diverging = Get(meta, "diverging", "false").Equals("true", StringComparison.OrdinalIgnoreCase),
            };
            for (int y = 0; y < ny; y++)
            for (int x = 0; x < nx; x++)
                g[x, y] = x < numeric[y].Length && TryF(numeric[y][x], out float v) ? v : 0;

            foreach (string s in Get(meta, "highlight", "").Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
                if (TryF(s.Trim(), out float h)) g.HighlightLevels.Add(h);

            g.RecomputeRange();
            return g;
        }

        private static WaferMap LoadWafer(List<string[]> rows, Dictionary<string, string> meta)
        {
            var w = new WaferMap
            {
                Category = DataCategory.Measurement,
                Quantity = Get(meta, "quantity", "Value"), Unit = Get(meta, "unit", ""),
                DiameterMm = F(meta, "diameter", 300),
                Lsl = meta.ContainsKey("lsl") ? F(meta, "lsl", 0) : (float?)null,
                Usl = meta.ContainsKey("usl") ? F(meta, "usl", 0) : (float?)null,
            };
            string[] die = Get(meta, "die", "10 x 10").ToLowerInvariant().Split('x');
            if (die.Length == 2 && TryF(die[0].Trim(), out float dw) && TryF(die[1].Trim(), out float dh)) { w.DieWidthMm = dw; w.DieHeightMm = dh; }

            foreach (string[] r in rows)
            {
                if (r.Length < 3 || !TryF(r[0], out float x) || !TryF(r[1], out float y) || !TryF(r[2], out float v)) continue; // skips header
                w.Dies.Add(new Die { X = x, Y = y, Value = v,
                                     Col = (int)Math.Floor(x / w.DieWidthMm), Row = (int)Math.Floor(y / w.DieHeightMm) });
            }
            if (w.Dies.Count == 0) throw new FormatException("wafer file has no x_mm, y_mm, value rows");
            w.ComputeStats();
            return w;
        }

        private static ControlChart LoadSpc(List<string[]> rows, Dictionary<string, string> meta)
        {
            var c = new ControlChart
            {
                Category = DataCategory.Quality,
                Quantity = Get(meta, "quantity", "Value"), Unit = Get(meta, "unit", ""),
            };
            foreach (string[] r in rows)
                if (TryF(r[r.Length - 1], out float v)) c.Values.Add(v);
            if (c.Values.Count < 8) throw new FormatException("spc needs at least 8 values");

            float mean = c.Values.Average();
            c.Target = F(meta, "target", mean);
            c.Lsl = F(meta, "lsl", mean - 1);
            c.Usl = F(meta, "usl", mean + 1);
            c.BaselineCount = (int)F(meta, "baseline", 0);
            c.Compute();
            return c;
        }

        // ---------------------------------------------------------------------------------

        private static void ParseMeta(string line, Dictionary<string, string> meta)
        {
            // "# key: value   # key2: value2"
            foreach (string part in line.Split('#'))
            {
                int colon = part.IndexOf(':');
                if (colon <= 0) continue;
                meta[part.Substring(0, colon).Trim()] = part.Substring(colon + 1).Trim();
            }
        }

        private static string Get(Dictionary<string, string> m, string k, string fallback) => m.TryGetValue(k, out string v) ? v : fallback;
        private static float F(Dictionary<string, string> m, string k, float fallback) => m.TryGetValue(k, out string v) && TryF(v, out float f) ? f : fallback;
        private static bool TryF(string s, out float f) => float.TryParse(s, NumberStyles.Float, Inv, out f);
    }
}
