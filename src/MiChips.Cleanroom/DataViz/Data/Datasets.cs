// =====================================================================================
//  Datasets.cs
//  MI-CHIPS (NSF #2606117): data models for AR lab data visualization.
//    • PlotData      2D measurement curves (I–V, C–V, transfer curves, spectra, ...)
//    • FieldGrid     2D scalar fields on a regular grid (TCAD/FEM fields, thermal maps,
//                    process-window maps): heatmap, contour and 3D surface views
//    • WaferMap      per-die measurements across a wafer (sheet resistance, Vth, yield bins)
//    • ControlChart  SPC individuals chart with Western Electric rules and Cp/Cpk
// =====================================================================================

using System;
using System.Collections.Generic;
using System.Linq;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public enum DataCategory { Measurement, Simulation, Quality }

    public abstract class Dataset
    {
        public string Id;
        public string Title;
        public string Description;
        public string Source = "Synthetic sample data";
        public DataCategory Category;
    }

    // ---------------------------------------------------------------------------------
    //  2D plots
    // ---------------------------------------------------------------------------------

    public sealed class Series
    {
        public string Name;
        public List<Vec2> Points = new List<Vec2>();
        public Color Color = Color.White;
        public bool Markers;
    }

    public sealed class RefLine
    {
        public float Value;
        public string Label;
        public Color Color = Color.White;
        public bool Vertical;
    }

    public sealed class PlotData : Dataset
    {
        public string XLabel, YLabel;
        public List<Series> Series = new List<Series>();
        public List<RefLine> RefLines = new List<RefLine>();
    }

    // ---------------------------------------------------------------------------------
    //  Scalar fields
    // ---------------------------------------------------------------------------------

    public sealed class FieldGrid : Dataset
    {
        public int Nx, Ny;
        /// <summary>Row-major values: index = iy * Nx + ix. iy = 0 is YMin.</summary>
        public float[] Values;
        public float XMin, XMax, YMin, YMax;
        public string XLabel, YLabel;
        public string Quantity, Unit;
        /// <summary>Use a diverging colormap (values symmetric around a meaningful midpoint).</summary>
        public bool Diverging;
        /// <summary>Contour levels drawn thicker in Trojan Orange, e.g. spec limits on a process-window map.</summary>
        public List<float> HighlightLevels = new List<float>();
        public int DefaultContourCount = 10;

        public float Min { get; private set; }
        public float Max { get; private set; }

        public FieldGrid(int nx, int ny)
        {
            Nx = nx; Ny = ny;
            Values = new float[nx * ny];
        }

        public float this[int ix, int iy]
        {
            get => Values[iy * Nx + ix];
            set => Values[iy * Nx + ix] = value;
        }

        public void RecomputeRange()
        {
            Min = Values.Min();
            Max = Values.Max();
            if (Max - Min < 1e-12f) Max = Min + 1f;
        }

        public float Normalize(float v) => (v - Min) / (Max - Min);
        public float DataX(float u) => XMin + u * (XMax - XMin);
        public float DataY(float v) => YMin + v * (YMax - YMin);

        /// <summary>Bilinear sample at normalized coordinates (u, v) ∈ [0,1]².</summary>
        public float SampleUV(float u, float v)
        {
            float fx = Clamp01(u) * (Nx - 1), fy = Clamp01(v) * (Ny - 1);
            int x0 = Math.Min((int)fx, Nx - 2), y0 = Math.Min((int)fy, Ny - 2);
            float tx = fx - x0, ty = fy - y0;
            float a = this[x0, y0] + (this[x0 + 1, y0] - this[x0, y0]) * tx;
            float b = this[x0, y0 + 1] + (this[x0 + 1, y0 + 1] - this[x0, y0 + 1]) * tx;
            return a + (b - a) * ty;
        }

        private static float Clamp01(float v) => v < 0 ? 0 : v > 1 ? 1 : v;
    }

    // ---------------------------------------------------------------------------------
    //  Wafer maps
    // ---------------------------------------------------------------------------------

    public sealed class Die
    {
        public int Col, Row;
        public float X, Y;     // die centre, mm from wafer centre (+Y toward the flat/notch-opposite side)
        public float Value;
    }

    public sealed class WaferMap : Dataset
    {
        public float DiameterMm = 300f;
        public float DieWidthMm = 10f, DieHeightMm = 12f;
        public string Quantity, Unit;
        public float? Lsl, Usl;
        public List<Die> Dies = new List<Die>();

        public float Mean, Sigma, Min, Max;
        /// <summary>Range uniformity, (max − min) / (2 × mean) × 100 %.</summary>
        public float UniformityPct;
        public float InSpecPct;

        public bool InSpec(float v) => (!Lsl.HasValue || v >= Lsl.Value) && (!Usl.HasValue || v <= Usl.Value);

        public void ComputeStats()
        {
            var v = Dies.Select(d => d.Value).ToArray();
            Mean = v.Average();
            Sigma = (float)Math.Sqrt(v.Select(x => (x - Mean) * (x - Mean)).Sum() / Math.Max(1, v.Length - 1));
            Min = v.Min(); Max = v.Max();
            if (Max - Min < 1e-12f) Max = Min + 1f;
            UniformityPct = Mean != 0 ? (Max - Min) / (2 * Mean) * 100f : 0;
            InSpecPct = 100f * v.Count(InSpec) / v.Length;
        }
    }

    // ---------------------------------------------------------------------------------
    //  SPC control chart (individuals / moving-range)
    // ---------------------------------------------------------------------------------

    public sealed class Violation
    {
        public int Index;
        public string Rule;
    }

    public sealed class ControlChart : Dataset
    {
        public string Quantity, Unit, SampleLabel = "Lot";
        public List<float> Values = new List<float>();
        public float Target, Lsl, Usl;
        /// <summary>
        /// Phase-I baseline: limits are frozen from the first N samples (0 = use all). Standard SPC
        /// practice, so a later drift can't drag the limits along with it and hide itself.
        /// </summary>
        public int BaselineCount;

        public float Mean, SigmaWithin, SigmaOverall, Ucl, Lcl, Cp, Cpk, Ppk;
        public List<Violation> Violations = new List<Violation>();

        /// <summary>Computes limits from the moving range (σ̂ = MR̄ / 1.128) and applies Western Electric rules 1–4.</summary>
        public void Compute()
        {
            int n = Values.Count;
            int nb = BaselineCount >= 8 && BaselineCount <= n ? BaselineCount : n;
            var baseline = Values.Take(nb).ToList();
            Mean = baseline.Average();
            float mrBar = 0;
            for (int i = 1; i < nb; i++) mrBar += Math.Abs(baseline[i] - baseline[i - 1]);
            mrBar /= Math.Max(1, nb - 1);
            SigmaWithin = mrBar / 1.128f;
            float overallMean = Values.Average();
            SigmaOverall = (float)Math.Sqrt(Values.Select(x => (x - overallMean) * (x - overallMean)).Sum() / Math.Max(1, n - 1));
            Ucl = Mean + 3 * SigmaWithin;
            Lcl = Mean - 3 * SigmaWithin;
            Cp = (Usl - Lsl) / (6 * SigmaWithin);
            Cpk = Math.Min(Usl - Mean, Mean - Lsl) / (3 * SigmaWithin);
            Ppk = Math.Min(Usl - overallMean, overallMean - Lsl) / (3 * SigmaOverall); // actual performance, all samples

            Violations.Clear();
            float s = SigmaWithin;
            int Side(int i) => Values[i] >= Mean ? 1 : -1;
            float Z(int i) => (Values[i] - Mean) / s;

            for (int i = 0; i < n; i++)
            {
                // Rule 1: one point beyond 3σ
                if (Math.Abs(Z(i)) > 3) { Add(i, "Rule 1: beyond 3σ"); continue; }
                // Rule 2: 2 of 3 consecutive beyond 2σ on the same side
                if (i >= 2 && CountSameSide(i, 3, 2f) >= 2) { Add(i, "Rule 2: 2 of 3 beyond 2σ"); continue; }
                // Rule 3: 4 of 5 consecutive beyond 1σ on the same side
                if (i >= 4 && CountSameSide(i, 5, 1f) >= 4) { Add(i, "Rule 3: 4 of 5 beyond 1σ"); continue; }
                // Rule 4: 8 consecutive on the same side of the mean
                if (i >= 7)
                {
                    int side = Side(i); bool all = true;
                    for (int k = i - 7; k <= i; k++) if (Side(k) != side) { all = false; break; }
                    if (all) Add(i, "Rule 4: 8 in a row on one side");
                }
            }

            int CountSameSide(int end, int window, float zLimit)
            {
                int side = Side(end), count = 0;
                for (int k = end - window + 1; k <= end; k++)
                    if (Side(k) == side && Math.Abs(Z(k)) > zLimit) count++;
                return count;
            }
            void Add(int i, string rule) => Violations.Add(new Violation { Index = i, Rule = rule });
        }
    }
}
