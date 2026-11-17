// =====================================================================================
//  WaferMapView.cs
//  MI-CHIPS (NSF #2606117): 3D wafer map. Each die is a bar whose height and colour
//  encode the measurement. Out-of-spec dies get an orange cap. Point at a die to read it.
//  Summary stats: mean, σ, CV, range uniformity, and the in-spec percentage.
//
//  Local frame: the pose faces the viewer (local −Z toward them). Wafer +X is drawn to the
//  viewer's right and wafer +Y away from them, so the notch (−Y) sits nearest the viewer.
// =====================================================================================

using System;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public sealed class WaferMapView : VizView
    {
        private readonly WaferMap w;
        private const float DisplayDiameter = 0.42f, BarMax = 0.10f, BarMin = 0.003f;
        private readonly float s; // metres per mm

        private float heightScale = 1f;
        private bool highlightOutOfSpec = true;
        private int cmapIndex;
        private Pose panelPose;
        private Die hovered;
        private string readout = "Point at a die to read it";
        private static readonly Color DiscColor = new Color(0.16f, 0.18f, 0.24f);

        public override Dataset Data => w;
        public override string Kind => "3D map";
        public override bool Is3D => true;

        public WaferMapView(WaferMap map)
        {
            w = map;
            s = DisplayDiameter / w.DiameterMm;
        }

        private Colormap Cmap => Colormap.All[cmapIndex];
        private float BarHeight(Die d) => BarMin + (d.Value - w.Min) / (w.Max - w.Min) * BarMax * heightScale;
        private Vec3 DieCentre(Die d) => new Vec3(-d.X * s, 0, d.Y * s);
        private Vec3 DieSize(Die d) => new Vec3(w.DieWidthMm * s * 0.88f, BarHeight(d), w.DieHeightMm * s * 0.88f);

        public override void Draw()
        {
            float r = DisplayDiameter * 0.5f;
            var handle = new Bounds(new Vec3(0, -0.006f, 0), new Vec3(2 * r + 0.03f, 0.012f, 2 * r + 0.03f));
            UI.Handle("wafer-" + w.Id, ref Pose, handle, false, UIMove.PosOnly, UIGesture.PinchGrip);

            Matrix root = Matrix.TR(Pose.position, Pose.orientation);
            Shapes.Cyl.Draw(VizDraw.Lit, Matrix.TS(new Vec3(0, -0.004f, 0), new Vec3(2 * r + 0.01f, 0.006f, 2 * r + 0.01f)) * root, DiscColor);
            Mesh.Cube.Draw(VizDraw.Lit, Matrix.TS(new Vec3(0, -0.002f, -r - 0.002f), new Vec3(0.012f, 0.007f, 0.01f)) * root, Color.Black); // notch

            hovered = PickDie(root);
            foreach (Die d in w.Dies)
            {
                float h = BarHeight(d);
                Vec3 c = DieCentre(d) + Vec3.UnitY * (h * 0.5f);
                Color col = Cmap.Sample((d.Value - w.Min) / (w.Max - w.Min));
                if (d == hovered) col = Color.White;
                Mesh.Cube.Draw(VizDraw.Lit, Matrix.TS(c, DieSize(d)) * root, col);

                if (highlightOutOfSpec && !w.InSpec(d.Value))
                {
                    Vec3 cap = DieCentre(d) + Vec3.UnitY * (h + 0.001f);
                    Mesh.Cube.Draw(VizDraw.Unlit, Matrix.TS(cap, new Vec3(w.DieWidthMm * s * 0.9f, 0.002f, w.DieHeightMm * s * 0.9f)) * root, Brand.TrojanOrange);
                }
            }

            if (hovered != null)
            {
                Vec3 top = root.Transform(DieCentre(hovered) + Vec3.UnitY * (BarHeight(hovered) + 0.02f));
                VizDraw.TextFacing($"{hovered.Value:F2}{Unit(w.Unit)}", top, VizStyle.Value);
                readout = $"Die ({hovered.Col}, {hovered.Row})  at ({hovered.X:F0}, {hovered.Y:F0}) mm  →  {w.Quantity} = {hovered.Value:F2}{Unit(w.Unit)}"
                        + (w.InSpec(hovered.Value) ? "" : "   OUT OF SPEC");
                ReportInspect(readout);
            }

            VizDraw.TextFacing($"{w.Title}  ({w.Quantity}, {w.Unit})", root.Transform(new Vec3(0, BarMax * heightScale + 0.06f, r * 0.6f)), VizStyle.Title);
            DrawPanel(root, r);
        }

        private Die PickDie(Matrix root)
        {
            Matrix inv = root.Inverse;
            foreach (Pointer p in VizDraw.HandPointers())
            {
                var ray = new Ray(inv.Transform(p.ray.position), inv.TransformNormal(p.ray.direction).Normalized);
                Die best = null; float bestT = float.MaxValue;
                foreach (Die d in w.Dies)
                {
                    float h = BarHeight(d);
                    var b = new Bounds(DieCentre(d) + Vec3.UnitY * (h * 0.5f), DieSize(d));
                    if (!b.Intersect(ray, out Vec3 at)) continue;
                    float t = Vec3.Distance(ray.position, at);
                    if (t < bestT) { bestT = t; best = d; }
                }
                if (best != null) return best;
            }
            return null;
        }

        private void DrawPanel(Matrix root, float r)
        {
            panelPose = new Pose(root.Transform(new Vec3(0, -0.04f, -r - 0.09f)), Pose.orientation);
            UI.WindowBegin(w.Title + "  |  3D", ref panelPose, new Vec2(0.38f, 0), UIWin.Normal, UIMove.None);
            if (!string.IsNullOrEmpty(w.Description)) UI.Text(w.Description);
            UI.PushTextStyle(Brand.OrangeText);
            string spec = w.Lsl.HasValue || w.Usl.HasValue ? $"   In spec {w.InSpecPct:F1}%" : "";
            UI.Label($"Mean {w.Mean:F2}{Unit(w.Unit)}   σ {w.Sigma:F2}   CV {100 * w.Sigma / w.Mean:F1}%{spec}");
            UI.PopTextStyle();
            UI.Label($"{w.Dies.Count} dies   Min {w.Min:F2}   Max {w.Max:F2}   Uniformity ±{w.UniformityPct:F1}%");
            if (w.Lsl.HasValue || w.Usl.HasValue) UI.Label($"Spec: [{(w.Lsl?.ToString("G4") ?? "–")}, {(w.Usl?.ToString("G4") ?? "–")}]{Unit(w.Unit)}");
            UI.HSeparator();
            UI.Label(readout);
            UI.Label($"Bar height  {heightScale:F2}×");
            UI.HSlider("bars", ref heightScale, 0.1f, 2.5f, 0);
            UI.Toggle("Highlight out-of-spec", ref highlightOutOfSpec); UI.SameLine();
            if (UI.Button("Colormap: " + Cmap.Name)) cmapIndex = (cmapIndex + 1) % Colormap.All.Length;
            if (UI.Button("Turn to me")) TurnToUser();
            UI.SameLine();
            if (UI.Button("Close")) IsOpen = false;
            UI.Label("Grab the wafer edge to move.  Source: " + w.Source);
            UI.WindowEnd();
        }
    }
}
