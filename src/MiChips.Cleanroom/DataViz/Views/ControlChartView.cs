// =====================================================================================
//  ControlChartView.cs
//  MI-CHIPS (NSF #2606117): SPC individuals chart. Shows the centre line, ±1σ/±2σ zones,
//  control limits (UCL/LCL), spec limits (LSL/USL), Western Electric rule violations,
//  and capability (Cp, Cpk, Ppk).
// =====================================================================================

using System;
using System.Linq;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public sealed class ControlChartView : VizView
    {
        private readonly ControlChart c;
        private readonly float y0, y1;
        private string readout = "Point at a sample to inspect it";

        public override Dataset Data => c;
        public override string Kind => "Chart";

        public ControlChartView(ControlChart chart)
        {
            c = chart;
            float lo = Math.Min(Math.Min(c.Lcl, c.Lsl), c.Values.Min());
            float hi = Math.Max(Math.Max(c.Ucl, c.Usl), c.Values.Max());
            float pad = (hi - lo) * 0.08f;
            y0 = lo - pad; y1 = hi + pad;
        }

        public override void Draw()
        {
            UI.WindowBegin(c.Title, ref Pose, new Vec2(0.50f, 0));
            if (!string.IsNullOrEmpty(c.Description)) UI.Text(c.Description);

            int n = c.Values.Count;
            PlotFrame f = PlotFrame.Reserve(0.48f, 0.26f, 0.050f, 0.040f, 0.045f, 0.012f);
            f.SetRange(0.5f, n + 0.5f, y0, y1);
            f.DrawAxes(c.SampleLabel, $"{c.Quantity} ({c.Unit})", grid: false);

            // Zones and limits
            for (int k = 1; k <= 2; k++)
            {
                HLine(f, c.Mean + k * c.SigmaWithin, VizStyle.Grid, 0.0006f, null);
                HLine(f, c.Mean - k * c.SigmaWithin, VizStyle.Grid, 0.0006f, null);
            }
            HLine(f, c.Mean, VizStyle.Axis, 0.0012f, "CL");
            HLine(f, c.Ucl, VizStyle.Orange, 0.0015f, "UCL");
            HLine(f, c.Lcl, VizStyle.Orange, 0.0015f, "LCL");
            HLine(f, c.Usl, VizStyle.Danger, 0.0015f, "USL");
            HLine(f, c.Lsl, VizStyle.Danger, 0.0015f, "LSL");

            // Data
            Color32 line = new Color32(47, 164, 231, 255);
            for (int i = 1; i < n; i++)
                VizDraw.LineLocal(f.Map(i, c.Values[i - 1]), f.Map(i + 1, c.Values[i]), line, 0.0014f);
            var flagged = new System.Collections.Generic.HashSet<int>(c.Violations.Select(v => v.Index));
            for (int i = 0; i < n; i++)
                Dot(f, i + 1, c.Values[i], flagged.Contains(i) ? VizStyle.Orange : line, flagged.Contains(i) ? 0.0040f : 0.0020f);

            Hover(f, n, flagged);

            // Capability summary
            UI.PushTextStyle(Brand.OrangeText);
            UI.Label($"Cpk {c.Cpk:F2}   Ppk {c.Ppk:F2}   Cp {c.Cp:F2}");
            UI.PopTextStyle();
            UI.Label($"Mean {c.Mean:F2}{Unit(c.Unit)}   σ(within) {c.SigmaWithin:F3}   Target {c.Target:G4}   Spec [{c.Lsl:G4}, {c.Usl:G4}]");
            UI.Label($"Rule violations: {c.Violations.Count}");
            foreach (Violation v in c.Violations.Take(4)) UI.Label($"   {c.SampleLabel} {v.Index + 1}: {v.Rule}");
            if (c.Violations.Count > 4) UI.Label($"   ... {c.Violations.Count - 4} more");

            UI.HSeparator();
            UI.Label(readout);
            if (UI.Button("Close")) IsOpen = false;
            UI.WindowEnd();
        }

        private void Hover(PlotFrame f, int n, System.Collections.Generic.HashSet<int> flagged)
        {
            foreach (Pointer p in VizDraw.HandPointers())
            {
                if (!f.RayToUV(p.ray, out float u, out _)) continue;
                int i = Math.Max(0, Math.Min(n - 1, (int)Math.Round(f.X0 + u * (f.X1 - f.X0)) - 1));
                Vec3 at = f.Map(i + 1, c.Values[i], 0.003f);
                VizDraw.LineLocal(f.Map(i + 1, y0, 0.003f), f.Map(i + 1, y1, 0.003f), VizStyle.Cursor, 0.0005f);
                Dot(f, i + 1, c.Values[i], VizStyle.Cursor, 0.005f);
                float z = (c.Values[i] - c.Mean) / c.SigmaWithin;
                string rule = flagged.Contains(i) ? "   ← " + c.Violations.First(v => v.Index == i).Rule : "";
                readout = $"{c.SampleLabel} {i + 1}:  {c.Values[i]:F2}{Unit(c.Unit)}  ({z:+0.0;-0.0}σ){rule}";
                ReportInspect(readout);
                break;
            }
        }

        private void HLine(PlotFrame f, float y, Color32 col, float th, string label)
        {
            VizDraw.LineLocal(f.Map(f.X0, y), f.Map(f.X1, y), col, th);
            if (label != null) VizDraw.TextLocal($"{label} {y:G4}", f.Map(f.X1, y) + f.Right * 0.004f, VizStyle.Tick, TextAlign.CenterLeft);
        }

        private static void Dot(PlotFrame f, float x, float y, Color32 col, float size)
        {
            Vec3 m = f.Map(x, y, 0.0025f);
            VizDraw.LineLocal(m - f.Right * size * 0.5f, m + f.Right * size * 0.5f, col, size);
        }
    }
}
