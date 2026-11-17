// =====================================================================================
//  FieldView.cs
//  MI-CHIPS (NSF #2606117): 2D field view. A heatmap, contour plot, or both, with
//  axes, a colourbar, a pointer readout, and a button to pop the field out as a 3D surface.
// =====================================================================================

using System;
using System.Collections.Generic;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public sealed class FieldView : VizView
    {
        private readonly FieldGrid g;
        private bool showHeatmap = true, showContours = true;
        private float contourCount;
        private int cmapIndex;

        private Mesh heatMesh, barMesh;
        private int builtCmap = -1, builtCount = -1;
        private List<ContourSegment> segments;
        private string readout = "Point at the field to read values";

        public override Dataset Data => g;
        public override string Kind => "2D";

        public FieldView(FieldGrid field)
        {
            g = field;
            contourCount = g.DefaultContourCount;
            cmapIndex = Colormap.DefaultIndexFor(g);
        }

        private Colormap Cmap => Colormap.All[cmapIndex];

        private void EnsureBuilt()
        {
            if (builtCmap != cmapIndex)
            {
                heatMesh = GridMesh.Build(g, Cmap, (u, v, h) => new Vec3(u, v, 0));
                barMesh = GridMesh.BuildGradient(Cmap, (u, v) => new Vec3(u, v, 0));
                builtCmap = cmapIndex;
            }
            int count = (int)Math.Round(contourCount);
            if (builtCount != count)
            {
                segments = Contours.Compute(g, Contours.Levels(g, count));
                builtCount = count;
            }
        }

        public override void Draw()
        {
            EnsureBuilt();

            float aspect = Math.Max(0.35f, Math.Min(1.2f, (g.YMax - g.YMin) / (g.XMax - g.XMin)));
            if (g.XLabel == g.YLabel || float.IsNaN(aspect)) aspect = 1;
            const float plotW = 0.34f;
            float plotH = plotW * aspect;

            UI.WindowBegin(g.Title + "  |  2D", ref Pose, new Vec2(0.47f, 0));
            UI.Label($"{g.Quantity} ({g.Unit})");
            if (!string.IsNullOrEmpty(g.Description)) UI.Text(g.Description);

            // Field
            PlotFrame f = PlotFrame.Reserve(plotW + 0.065f, plotH + 0.045f, 0.055f, 0.040f, 0.010f, 0.005f);
            f.SetRange(g.XMin, g.XMax, g.YMin, g.YMax);
            if (showHeatmap) heatMesh.Draw(VizDraw.Unlit, f.CanonicalToLocal());
            if (showContours) DrawContours(f, !showHeatmap);
            f.DrawAxes(g.XLabel, g.YLabel, grid: false);

            // Colourbar
            UI.SameLine();
            PlotFrame bar = PlotFrame.Reserve(0.055f, plotH + 0.045f, 0.004f, 0.040f, 0.033f, 0.005f);
            barMesh.Draw(VizDraw.Unlit, bar.CanonicalToLocal());
            bar.SetRange(0, 1, g.Min, g.Max);
            foreach (float t in VizDraw.NiceTicks(g.Min, g.Max, 6, out float step))
            {
                Vec3 a = bar.Map(1, t);
                VizDraw.LineLocal(a, a + bar.Right * 0.003f, VizStyle.Axis, 0.0008f);
                VizDraw.TextLocal(VizDraw.Fmt(t, step), a + bar.Right * 0.005f, VizStyle.Tick, TextAlign.CenterLeft);
            }
            foreach (float h in g.HighlightLevels)
                if (h >= g.Min && h <= g.Max) VizDraw.LineLocal(bar.Map(0, h, 0.002f), bar.Map(1, h, 0.002f), VizStyle.Orange, 0.0015f);

            Hover(f);

            // Controls
            UI.Label(readout);
            UI.Toggle("Heatmap", ref showHeatmap); UI.SameLine();
            UI.Toggle("Contours", ref showContours); UI.SameLine();
            if (UI.Button("Colormap: " + Cmap.Name)) cmapIndex = (cmapIndex + 1) % Colormap.All.Length;
            UI.Label($"Contour levels: {(int)Math.Round(contourCount)}");
            UI.HSlider("levels", ref contourCount, 3, 24, 1);
            if (UI.Button("Open as 3D surface")) RequestField(g, true);
            UI.SameLine();
            if (UI.Button("Close")) IsOpen = false;
            UI.Label("Source: " + g.Source);
            UI.WindowEnd();
        }

        private void DrawContours(PlotFrame f, bool colourByLevel)
        {
            foreach (ContourSegment s in segments)
            {
                Color32 c = s.Highlight ? VizStyle.Orange
                          : colourByLevel ? Cmap.Sample32(g.Normalize(s.Level))
                          : new Color32(255, 255, 255, 200);
                VizDraw.LineLocal(f.MapUV(s.A.x, s.A.y, 0.002f), f.MapUV(s.B.x, s.B.y, 0.002f), c, s.Highlight ? 0.0020f : 0.0008f);
            }
        }

        private void Hover(PlotFrame f)
        {
            foreach (Pointer p in VizDraw.HandPointers())
            {
                if (!f.RayToUV(p.ray, out float u, out float v)) continue;
                float val = g.SampleUV(u, v);
                Vec3 at = f.MapUV(u, v, 0.003f);
                VizDraw.LineLocal(at - f.Right * 0.006f, at + f.Right * 0.006f, VizStyle.Cursor, 0.0008f);
                VizDraw.LineLocal(at - f.Up * 0.006f, at + f.Up * 0.006f, VizStyle.Cursor, 0.0008f);
                readout = $"{g.XLabel} = {g.DataX(u):G3},  {g.YLabel} = {g.DataY(v):G3}   →   {g.Quantity} = {val:G4}{Unit(g.Unit)}";
                ReportInspect(readout);
                break;
            }
        }
    }
}
