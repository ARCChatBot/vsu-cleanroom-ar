// =====================================================================================
//  SurfaceView.cs
//  MI-CHIPS (NSF #2606117): free-standing 3D height-field of a scalar field. Height and
//  colour both encode the value. Contours can ride on the surface and/or be projected
//  onto the base. A hand ray marches across the surface to read values, and the base
//  plate can be grabbed to move the whole view.
//
//  Local frame: the pose faces the viewer (local −Z toward them), so the viewer's right is
//  local −X. Data x runs left→right, data y runs front→back, and the value runs up.
// =====================================================================================

using System;
using System.Collections.Generic;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public sealed class SurfaceView : VizView
    {
        private readonly FieldGrid g;
        private readonly float W, D;
        private const float HMax = 0.16f;

        private float heightScale = 1f;
        private bool contoursOnSurface = true, contoursOnFloor = true;
        private int cmapIndex, builtCmap = -1;
        private Mesh surface, bar;
        private readonly List<ContourSegment> segments;
        private Pose panelPose;
        private string readout = "Point at the surface to read values";
        private static readonly Color BaseColor = new Color(0.10f, 0.17f, 0.26f);

        public override Dataset Data => g;
        public override string Kind => "3D";
        public override bool Is3D => true;

        public SurfaceView(FieldGrid field)
        {
            g = field;
            float aspect = Math.Max(0.35f, Math.Min(1.4f, (g.YMax - g.YMin) / (g.XMax - g.XMin)));
            if (float.IsNaN(aspect)) aspect = 1;
            W = 0.42f; D = W * aspect;
            cmapIndex = Colormap.DefaultIndexFor(g);
            segments = Contours.Compute(g, Contours.Levels(g, g.DefaultContourCount));
        }

        private Colormap Cmap => Colormap.All[cmapIndex];
        private float H => HMax * heightScale;
        private Vec3 Local(float u, float v, float h) => new Vec3((0.5f - u) * W, h * H, (v - 0.5f) * D);

        public override void Draw()
        {
            if (builtCmap != cmapIndex)
            {
                surface = GridMesh.Build(g, Cmap, (u, v, h) => new Vec3((0.5f - u) * W, h, (v - 0.5f) * D));
                bar = GridMesh.BuildGradient(Cmap, (u, v) => new Vec3(-u * 0.014f, v, 0));
                builtCmap = cmapIndex;
            }

            // Grab the base plate to move the view (position only, so it stays level).
            var handle = new Bounds(new Vec3(0, -0.012f, 0), new Vec3(W + 0.06f, 0.024f, D + 0.06f));
            UI.Handle("surf-" + g.Id, ref Pose, handle, false, UIMove.PosOnly, UIGesture.PinchGrip);

            Matrix root = Matrix.TR(Pose.position, Pose.orientation);
            Mesh.Cube.Draw(VizDraw.Lit, Matrix.TS(handle.center, handle.dimensions) * root, BaseColor);
            surface.Draw(VizDraw.Lit, Matrix.S(new Vec3(1, H, 1)) * root);

            DrawContours(root);
            DrawAxes(root);
            DrawColorbar(root);
            Hover(root);
            DrawPanel(root);
        }

        private void DrawContours(Matrix root)
        {
            foreach (ContourSegment s in segments)
            {
                Color32 c = s.Highlight ? VizStyle.Orange : new Color32(255, 255, 255, 210);
                float th = s.Highlight ? 0.0022f : 0.0010f;
                if (contoursOnSurface)
                {
                    float h = g.Normalize(s.Level);
                    Lines.Add(root.Transform(Local(s.A.x, s.A.y, h) + Vec3.UnitY * 0.0015f),
                              root.Transform(Local(s.B.x, s.B.y, h) + Vec3.UnitY * 0.0015f), c, th);
                }
                if (contoursOnFloor)
                {
                    Color32 fc = s.Highlight ? VizStyle.Orange : Cmap.Sample32(g.Normalize(s.Level));
                    Lines.Add(root.Transform(Local(s.A.x, s.A.y, 0) + Vec3.UnitY * 0.001f),
                              root.Transform(Local(s.B.x, s.B.y, 0) + Vec3.UnitY * 0.001f), fc, th);
                }
            }
        }

        private void DrawAxes(Matrix root)
        {
            // Data-x ticks along the front edge (toward the viewer)
            foreach (float x in VizDraw.NiceTicks(g.XMin, g.XMax, 5, out float xs))
            {
                float u = (x - g.XMin) / (g.XMax - g.XMin);
                Vec3 a = Local(u, 0, 0) + new Vec3(0, 0, -0.030f);
                VizDraw.TextFacing(VizDraw.Fmt(x, xs), root.Transform(a), VizStyle.Tick);
            }
            VizDraw.TextFacing(g.XLabel, root.Transform(Local(0.5f, 0, 0) + new Vec3(0, 0, -0.055f)), VizStyle.Label);

            // Data-y ticks along the viewer's left edge
            foreach (float y in VizDraw.NiceTicks(g.YMin, g.YMax, 5, out float ys))
            {
                float v = (y - g.YMin) / (g.YMax - g.YMin);
                Vec3 a = Local(0, v, 0) + new Vec3(0.035f, 0, 0);
                VizDraw.TextFacing(VizDraw.Fmt(y, ys), root.Transform(a), VizStyle.Tick);
            }
            VizDraw.TextFacing(g.YLabel, root.Transform(Local(0, 1, 0) + new Vec3(0.035f, 0, 0.035f)), VizStyle.Label);

            VizDraw.TextFacing($"{g.Title}  ({g.Quantity}, {g.Unit})", root.Transform(new Vec3(0, H + 0.06f, D * 0.5f)), VizStyle.Title);
        }

        private void DrawColorbar(Matrix root)
        {
            // Vertical bar at the back-right corner. Its height matches the surface height, so a
            // colour on the bar sits at the same height as that value on the surface.
            Vec3 at = new Vec3(-W * 0.5f - 0.035f, 0, D * 0.5f);
            bar.Draw(VizDraw.Unlit, Matrix.TS(at, new Vec3(1, H, 1)) * root);
            foreach (float t in VizDraw.NiceTicks(g.Min, g.Max, 5, out float step))
            {
                Vec3 p = at + new Vec3(-0.026f, g.Normalize(t) * H, 0);
                VizDraw.TextFacing(VizDraw.Fmt(t, step), root.Transform(p), VizStyle.Tick, TextAlign.CenterLeft);
            }
        }

        private void Hover(Matrix root)
        {
            Matrix inv = root.Inverse;
            foreach (Pointer p in VizDraw.HandPointers())
            {
                Vec3 o = inv.Transform(p.ray.position), d = inv.TransformNormal(p.ray.direction).Normalized;
                if (!RayBox(o, d, new Vec3(-W / 2, 0, -D / 2), new Vec3(W / 2, H + 0.001f, D / 2), out float t0, out float t1)) continue;

                // March along the ray; the first sample below the surface brackets the hit, then bisect.
                const int steps = 120;
                float prev = t0; bool found = false;
                for (int i = 0; i <= steps && !found; i++)
                {
                    float t = t0 + (t1 - t0) * i / steps;
                    if (Below(o + d * t))
                    {
                        float a = prev, b = t;
                        for (int k = 0; k < 8; k++) { float m = (a + b) * 0.5f; if (Below(o + d * m)) b = m; else a = m; }
                        prev = b; found = true;
                    }
                    else prev = t;
                }
                if (!found) continue;

                Vec3 hit = o + d * prev;
                float u = 0.5f - hit.x / W, v = hit.z / D + 0.5f, val = g.SampleUV(u, v);
                Vec3 wHit = root.Transform(hit);
                Mesh.Sphere.Draw(VizDraw.Unlit, Matrix.TS(wHit, 0.008f), Color.White);
                Lines.Add(wHit, root.Transform(new Vec3(hit.x, 0.001f, hit.z)), VizStyle.Cursor, 0.0008f);
                readout = $"{g.XLabel} = {g.DataX(u):G3},  {g.YLabel} = {g.DataY(v):G3}   →   {g.Quantity} = {val:G4}{Unit(g.Unit)}";
                VizDraw.TextFacing($"{val:G4}{Unit(g.Unit)}", wHit + Vec3.UnitY * 0.025f, VizStyle.Value);
                ReportInspect(readout);
                break;
            }
        }

        private bool Below(Vec3 local)
        {
            float u = 0.5f - local.x / W, v = local.z / D + 0.5f;
            if (u < 0 || u > 1 || v < 0 || v > 1) return false;
            return local.y <= g.Normalize(g.SampleUV(u, v)) * H;
        }

        private static bool RayBox(Vec3 o, Vec3 d, Vec3 min, Vec3 max, out float tNear, out float tFar)
        {
            tNear = 0; tFar = float.MaxValue;
            for (int a = 0; a < 3; a++)
            {
                float oa = a == 0 ? o.x : a == 1 ? o.y : o.z, da = a == 0 ? d.x : a == 1 ? d.y : d.z;
                float lo = a == 0 ? min.x : a == 1 ? min.y : min.z, hi = a == 0 ? max.x : a == 1 ? max.y : max.z;
                if (Math.Abs(da) < 1e-8f) { if (oa < lo || oa > hi) return false; continue; }
                float t1 = (lo - oa) / da, t2 = (hi - oa) / da;
                if (t1 > t2) { float tmp = t1; t1 = t2; t2 = tmp; }
                tNear = Math.Max(tNear, t1); tFar = Math.Min(tFar, t2);
                if (tNear > tFar) return false;
            }
            return true;
        }

        private void DrawPanel(Matrix root)
        {
            // The control panel rides along in front of the base.
            panelPose = new Pose(root.Transform(new Vec3(0, -0.04f, -D * 0.5f - 0.09f)), Pose.orientation);
            UI.WindowBegin(g.Title + "  |  3D", ref panelPose, new Vec2(0.36f, 0), UIWin.Normal, UIMove.None);
            UI.Label(readout);
            UI.Label($"Height scale  {heightScale:F2}×");
            UI.HSlider("hscale", ref heightScale, 0.2f, 2.5f, 0);
            UI.Toggle("Contours on surface", ref contoursOnSurface); UI.SameLine();
            UI.Toggle("Floor contours", ref contoursOnFloor);
            if (UI.Button("Colormap: " + Cmap.Name)) cmapIndex = (cmapIndex + 1) % Colormap.All.Length;
            UI.SameLine();
            if (UI.Button("Turn to me")) TurnToUser();
            UI.SameLine();
            if (UI.Button("2D view")) RequestField(g, false);
            UI.SameLine();
            if (UI.Button("Close")) IsOpen = false;
            UI.Label("Grab the base plate to move.  Source: " + g.Source);
            UI.WindowEnd();
        }
    }
}
