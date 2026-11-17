// =====================================================================================
//  PlotView.cs
//  MI-CHIPS (NSF #2606117): 2D line/scatter chart for measurement curves (I–V, C–V,
//  transfer curves, spectra). Point at the chart to read the nearest data point.
// =====================================================================================

using System;
using System.Linq;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public sealed class PlotView : VizView
    {
        private readonly PlotData d;
        private readonly float x0, x1, y0, y1;
        private string readout = "Point at the chart to read values";

        public override Dataset Data => d;
        public override string Kind => "Plot";

        public PlotView(PlotData data)
        {
            d = data;
            var pts = d.Series.SelectMany(s => s.Points).ToList();
            if (pts.Count == 0) pts.Add(Vec2.Zero);
            x0 = pts.Min(p => p.x); x1 = pts.Max(p => p.x);
            float ymin = pts.Min(p => p.y), ymax = pts.Max(p => p.y);
            foreach (RefLine r in d.RefLines.Where(r => !r.Vertical)) { ymin = Math.Min(ymin, r.Value); ymax = Math.Max(ymax, r.Value); }
            float pad = (ymax - ymin) * 0.06f;
            y0 = ymin >= 0 && ymin < (ymax - ymin) * 0.25f ? 0 : ymin - pad; // anchor at zero when the data starts near it
            y1 = ymax + pad;
        }

        public override void Draw()
        {
            UI.WindowBegin(d.Title, ref Pose, new Vec2(0.44f, 0));
            if (!string.IsNullOrEmpty(d.Description)) UI.Text(d.Description);

            PlotFrame f = PlotFrame.Reserve(0.42f, 0.27f, 0.055f, 0.040f, 0.012f, 0.016f);
            f.SetRange(x0, x1, y0, y1);
            f.DrawAxes(d.XLabel, d.YLabel);

            foreach (RefLine r in d.RefLines)
            {
                Vec3 a = r.Vertical ? f.Map(r.Value, y0) : f.Map(x0, r.Value);
                Vec3 b = r.Vertical ? f.Map(r.Value, y1) : f.Map(x1, r.Value);
                VizDraw.LineLocal(a, b, Colormap.ToColor32(r.Color), 0.0012f);
                if (!string.IsNullOrEmpty(r.Label)) VizDraw.TextLocal(r.Label, b, VizStyle.Tick, TextAlign.CenterLeft);
            }

            foreach (Series s in d.Series)
            {
                Color32 c = Colormap.ToColor32(s.Color);
                for (int i = 1; i < s.Points.Count; i++)
                    VizDraw.LineLocal(f.Map(s.Points[i - 1].x, s.Points[i - 1].y), f.Map(s.Points[i].x, s.Points[i].y), c, 0.0018f);
                if (s.Markers)
                    foreach (Vec2 p in s.Points) Marker(f, p, c, 0.0025f);
            }

            HoverNearest(f);

            // Legend, two entries per row
            for (int i = 0; i < d.Series.Count; i++)
            {
                if (i % 2 == 1) UI.SameLine();
                UI.PushTextStyle(VizStyle.LabelIn(d.Series[i].Color));
                UI.Label("■ " + d.Series[i].Name);
                UI.PopTextStyle();
            }

            UI.HSeparator();
            UI.Label(readout);
            UI.Label("Source: " + d.Source);
            if (UI.Button("Close")) IsOpen = false;
            UI.WindowEnd();
        }

        private void HoverNearest(PlotFrame f)
        {
            foreach (Pointer p in VizDraw.HandPointers())
            {
                if (!f.RayToUV(p.ray, out float u, out float v)) continue;

                float best = float.MaxValue; Series bs = null; Vec2 bp = default;
                foreach (Series s in d.Series)
                foreach (Vec2 pt in s.Points)
                {
                    float du = (pt.x - x0) / (x1 - x0) - u, dv = (pt.y - y0) / (y1 - y0) - v;
                    float dist = du * du + dv * dv;
                    if (dist < best) { best = dist; bs = s; bp = pt; }
                }
                if (bs == null || best > 0.01f) continue;

                Vec3 at = f.Map(bp.x, bp.y, 0.003f);
                VizDraw.LineLocal(f.Map(bp.x, y0, 0.003f), at, VizStyle.Cursor, 0.0006f);
                VizDraw.LineLocal(f.Map(x0, bp.y, 0.003f), at, VizStyle.Cursor, 0.0006f);
                Marker(f, bp, VizStyle.Orange, 0.004f);
                readout = $"{bs.Name}:  {d.XLabel} = {bp.x:G4},  {d.YLabel} = {bp.y:G4}";
                ReportInspect(readout);
                break;
            }
        }

        private static void Marker(PlotFrame f, Vec2 p, Color32 c, float size)
        {
            Vec3 m = f.Map(p.x, p.y, 0.0025f);
            VizDraw.LineLocal(m - f.Right * size, m + f.Right * size, c, size * 0.6f);
            VizDraw.LineLocal(m - f.Up * size, m + f.Up * size, c, size * 0.6f);
        }
    }
}
