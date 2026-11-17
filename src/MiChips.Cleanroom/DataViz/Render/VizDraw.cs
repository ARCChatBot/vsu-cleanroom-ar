// =====================================================================================
//  VizDraw.cs
//  MI-CHIPS (NSF #2606117): shared drawing helpers, text styles and the PlotFrame used
//  by every 2D chart inside a StereoKit window.
// =====================================================================================

using System;
using System.Collections.Generic;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    /// <summary>Text styles and colours for charts. Call Init() once after SK.Initialize.</summary>
    public static class VizStyle
    {
        public static TextStyle Tick, Label, Title, Value;
        public static readonly Color32 Axis = new Color32(220, 225, 235, 255);
        public static readonly Color32 Grid = new Color32(120, 135, 160, 255);
        public static readonly Color32 Orange = new Color32(255, 102, 0, 255);      // Trojan Orange: highlights, limits
        public static readonly Color32 Danger = new Color32(255, 77, 109, 255);     // spec limits
        public static readonly Color32 Cursor = new Color32(255, 255, 255, 255);

        private static readonly Dictionary<uint, TextStyle> colored = new Dictionary<uint, TextStyle>();

        public static void Init()
        {
            Tick = Text.MakeStyle(Default.Font, 0.0065f, Color.Hex(0xC8D2E0FF));
            Label = Text.MakeStyle(Default.Font, 0.0080f, Color.White);
            Title = Text.MakeStyle(Default.Font, 0.0110f, Brand.TrojanOrange);
            Value = Text.MakeStyle(Default.Font, 0.0090f, Color.White);
        }

        /// <summary>Cached label style in a specific colour (legends, coloured readouts).</summary>
        public static TextStyle LabelIn(Color c)
        {
            Color32 k = Colormap.ToColor32(c);
            uint key = (uint)(k.r << 24 | k.g << 16 | k.b << 8 | k.a);
            if (!colored.TryGetValue(key, out TextStyle s))
            {
                s = Text.MakeStyle(Default.Font, 0.0080f, c);
                colored[key] = s;
            }
            return s;
        }
    }

    public static class VizDraw
    {
        private static Material unlitDoubleSided, litDoubleSided;

        /// <summary>Unlit, double-sided: true data colours on heatmaps and colourbars.</summary>
        public static Material Unlit => unlitDoubleSided ?? (unlitDoubleSided = MakeDoubleSided(Default.MaterialUnlit));
        /// <summary>Lit, double-sided: shading that reveals the shape of 3D surfaces.</summary>
        public static Material Lit => litDoubleSided ?? (litDoubleSided = MakeDoubleSided(Default.Material));

        private static Material MakeDoubleSided(Material m)
        {
            Material c = m.Copy();
            c.FaceCull = Cull.None;
            return c;
        }

        /// <summary>
        /// Line in hierarchy-local space. Points are converted to world space explicitly and the
        /// hierarchy is bypassed, so this works the same inside and outside UI windows.
        /// </summary>
        public static void LineLocal(Vec3 a, Vec3 b, Color32 c, float thickness)
        {
            Vec3 wa = Hierarchy.ToWorld(a), wb = Hierarchy.ToWorld(b);
            bool was = Hierarchy.Enabled;
            Hierarchy.Enabled = false;
            Lines.Add(wa, wb, c, thickness);
            Hierarchy.Enabled = was;
        }

        /// <summary>Text in hierarchy-local space (inside a window this faces the reader like UI labels).</summary>
        public static void TextLocal(string s, Vec3 at, TextStyle style, TextAlign position = TextAlign.Center)
            => Text.Add(s, Matrix.T(at), style, position, TextAlign.Center);

        /// <summary>World-space text that turns to face the viewer.</summary>
        public static void TextFacing(string s, Vec3 worldPos, TextStyle style, TextAlign position = TextAlign.Center)
            => Text.Add(s, Matrix.TR(worldPos, Quat.LookAt(worldPos, Input.Head.position)), style, position, TextAlign.Center);

        /// <summary>Tracked hand rays (the simulator drives a hand from the mouse).</summary>
        public static IEnumerable<Pointer> HandPointers()
        {
            int n = Input.PointerCount(InputSource.Hand);
            for (int i = 0; i < n; i++)
            {
                Pointer p = Input.Pointer(i, InputSource.Hand);
                if (p.tracked.IsActive()) yield return p;
            }
        }

        public static string Fmt(float v, float step)
        {
            int dec = step <= 0 ? 2 : Math.Max(0, Math.Min(5, (int)Math.Ceiling(-Math.Log10(step) + 1e-6)));
            return v.ToString("F" + dec);
        }

        /// <summary>"Nice" tick positions (1, 2, 5 × 10ⁿ) covering [lo, hi].</summary>
        public static List<float> NiceTicks(float lo, float hi, int target, out float step)
        {
            var ticks = new List<float>();
            float range = Nice(hi - lo, false);
            step = Nice(range / Math.Max(1, target - 1), true);
            if (step <= 0 || float.IsNaN(step)) return ticks;
            double start = Math.Ceiling(lo / step - 1e-6) * step;
            for (double t = start; t <= hi + step * 1e-6; t += step) ticks.Add((float)t);
            return ticks;
        }

        private static float Nice(float x, bool round)
        {
            if (x <= 0) return 0;
            double exp = Math.Floor(Math.Log10(x)), f = x / Math.Pow(10, exp), nf;
            if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
            else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
            return (float)(nf * Math.Pow(10, exp));
        }
    }

    /// <summary>
    /// A rectangular chart area reserved inside the current UI window. It works out which way
    /// "right", "up" and "toward the viewer" point in the window's local space, so charts
    /// don't depend on StereoKit's internal UI axis conventions.
    /// </summary>
    public sealed class PlotFrame
    {
        public Vec3 Origin, Right, Up, Front;
        public float W, H;
        public float X0, X1, Y0, Y1;
        private const float Lift = 0.0015f;

        public static PlotFrame Reserve(float width, float height, float marginLeft, float marginBottom, float marginRight, float marginTop)
        {
            Vec3 topLeft = UI.LayoutAt;
            Bounds b = UI.LayoutReserve(new Vec2(width, height), false, 0.004f);

            float sx = b.center.x - topLeft.x;
            Vec3 right = Math.Abs(sx) < 1e-6f ? -Vec3.UnitX : (sx > 0 ? Vec3.UnitX : -Vec3.UnitX);
            Vec3 up = (topLeft.y - b.center.y) >= 0 ? Vec3.UnitY : -Vec3.UnitY;
            Vec3 front = b.center.z >= 0 ? Vec3.UnitZ : -Vec3.UnitZ; // reserved depth sits on the viewer's side
            Vec3 surface = new Vec3(b.center.x, b.center.y, b.center.z - front.z * b.dimensions.z * 0.5f);

            Vec3 bottomLeft = surface - right * (width * 0.5f) - up * (height * 0.5f);
            return new PlotFrame
            {
                Origin = bottomLeft + right * marginLeft + up * marginBottom,
                Right = right, Up = up, Front = front,
                W = width - marginLeft - marginRight,
                H = height - marginBottom - marginTop,
                X0 = 0, X1 = 1, Y0 = 0, Y1 = 1,
            };
        }

        public void SetRange(float x0, float x1, float y0, float y1)
        {
            X0 = x0; X1 = Math.Abs(x1 - x0) < 1e-12f ? x0 + 1 : x1;
            Y0 = y0; Y1 = Math.Abs(y1 - y0) < 1e-12f ? y0 + 1 : y1;
        }

        public Vec3 MapUV(float u, float v, float lift = Lift) => Origin + Right * (u * W) + Up * (v * H) + Front * lift;
        public Vec3 Map(float x, float y, float lift = Lift) => MapUV((x - X0) / (X1 - X0), (y - Y0) / (Y1 - Y0), lift);

        /// <summary>Matrix mapping canonical (u, v, 0) ∈ [0,1]² onto the plot area.</summary>
        public Matrix CanonicalToLocal(float lift = Lift * 0.5f)
            => Matrix.TS(Origin + Front * lift, new Vec3(Right.x * W, Up.y * H, Front.z));

        /// <summary>Intersects a world ray with the plot plane. Returns normalized (u, v) if inside.</summary>
        public bool RayToUV(Ray worldRay, out float u, out float v)
        {
            u = v = 0;
            Vec3 p = Hierarchy.ToLocal(worldRay.position);
            Vec3 d = Hierarchy.ToLocalDirection(worldRay.direction);
            float denom = Vec3.Dot(d, Front);
            if (Math.Abs(denom) < 1e-6f) return false;
            float t = Vec3.Dot(Origin - p, Front) / denom;
            if (t < 0) return false;
            Vec3 hit = p + d * t - Origin;
            u = Vec3.Dot(hit, Right) / W;
            v = Vec3.Dot(hit, Up) / H;
            return u >= 0 && u <= 1 && v >= 0 && v <= 1;
        }

        public void DrawAxes(string xLabel, string yLabel, bool grid = true)
        {
            const float th = 0.0012f;
            Vec3 o = MapUV(0, 0), xr = MapUV(1, 0), yt = MapUV(0, 1), tr = MapUV(1, 1);
            VizDraw.LineLocal(o, xr, VizStyle.Axis, th);
            VizDraw.LineLocal(o, yt, VizStyle.Axis, th);
            VizDraw.LineLocal(yt, tr, VizStyle.Grid, th * 0.5f);
            VizDraw.LineLocal(xr, tr, VizStyle.Grid, th * 0.5f);

            foreach (float x in VizDraw.NiceTicks(X0, X1, 6, out float xs))
            {
                Vec3 a = Map(x, Y0);
                VizDraw.LineLocal(a, a - Up * 0.004f, VizStyle.Axis, th);
                if (grid) VizDraw.LineLocal(a, Map(x, Y1), VizStyle.Grid, th * 0.4f);
                VizDraw.TextLocal(VizDraw.Fmt(x, xs), a - Up * 0.006f, VizStyle.Tick, TextAlign.TopCenter);
            }
            foreach (float y in VizDraw.NiceTicks(Y0, Y1, 5, out float ys))
            {
                Vec3 a = Map(X0, y);
                VizDraw.LineLocal(a, a - Right * 0.004f, VizStyle.Axis, th);
                if (grid) VizDraw.LineLocal(a, Map(X1, y), VizStyle.Grid, th * 0.4f);
                VizDraw.TextLocal(VizDraw.Fmt(y, ys), a - Right * 0.006f, VizStyle.Tick, TextAlign.CenterRight);
            }

            if (!string.IsNullOrEmpty(xLabel)) VizDraw.TextLocal(xLabel, MapUV(0.5f, 0) - Up * 0.020f, VizStyle.Label, TextAlign.TopCenter);
            if (!string.IsNullOrEmpty(yLabel)) VizDraw.TextLocal(yLabel, MapUV(0, 1) + Up * 0.006f, VizStyle.Label, TextAlign.BottomCenter);
        }
    }
}
