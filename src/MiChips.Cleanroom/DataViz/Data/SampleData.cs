// =====================================================================================
//  SampleData.cs
//  MI-CHIPS (NSF #2606117): physically plausible synthetic datasets so the visualizer
//  is useful before real lab data is connected. Every dataset is generated
//  deterministically (fixed seeds) so screenshots and lessons are reproducible.
//
//  ⚠ These are teaching-grade models (square-law MOSFET, Laplace potential solve,
//    diffusion thermal solve). They are NOT calibrated TCAD or metrology results.
// =====================================================================================

using System;
using System.Collections.Generic;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public static class SampleData
    {
        public static List<Dataset> All() => new List<Dataset>
        {
            MosfetOutputCurves(),
            SheetResistanceWaferMap(),
            MosfetPotential(out FieldGrid efield),
            efield,
            ChipThermalMap(),
            ProcessWindow(),
            GateCdControlChart(),
        };

        // ---------------------------------------------------------------------------------
        //  Measurement: NMOS output characteristics (I_D vs V_DS for several V_GS)
        // ---------------------------------------------------------------------------------

        public static PlotData MosfetOutputCurves()
        {
            var rng = new Random(11);
            const float vth = 0.45f, k = 2.2f /* mA/V² */, lambda = 0.08f;
            var palette = new[] { Color.Hex(0x2FA4E7FF), Color.Hex(0x2EC4B6FF), Color.Hex(0x7BD14BFF), Color.Hex(0xF2D43DFF), Color.Hex(0xFF8A3DFF) };

            var p = new PlotData
            {
                Id = "iv-nmos", Title = "NMOS Output Curves", Category = DataCategory.Measurement,
                Description = "I_D vs V_DS at five gate voltages, W/L = 10 µm / 0.18 µm. Probe-station style data with measurement noise.",
                XLabel = "V_DS (V)", YLabel = "I_D (mA)",
            };

            for (int g = 0; g < 5; g++)
            {
                float vgs = 0.6f + 0.15f * g, vov = vgs - vth;
                var s = new Series { Name = $"V_GS = {vgs:F2} V", Color = palette[g] };
                for (int i = 0; i <= 48; i++)
                {
                    float vds = 1.2f * i / 48f;
                    float id = vds < vov
                        ? k * (vov * vds - 0.5f * vds * vds) * (1 + lambda * vds)   // triode
                        : 0.5f * k * vov * vov * (1 + lambda * vds);                // saturation
                    id += (float)(Gauss(rng) * 0.004);
                    s.Points.Add(new Vec2(vds, Math.Max(0, id)));
                }
                p.Series.Add(s);
            }
            return p;
        }

        // ---------------------------------------------------------------------------------
        //  Measurement: 300 mm wafer sheet-resistance map (4-point probe)
        // ---------------------------------------------------------------------------------

        public static WaferMap SheetResistanceWaferMap()
        {
            var rng = new Random(23);
            var w = new WaferMap
            {
                Id = "rs-wafer", Title = "Sheet Resistance Wafer Map", Category = DataCategory.Measurement,
                Description = "4-point-probe R_s per die after implant anneal. Shows a radial bowl, a slight left-to-right tilt and one hot cluster.",
                Quantity = "R_s", Unit = "Ω/sq", Lsl = 46f, Usl = 54f,
                DiameterMm = 300f, DieWidthMm = 10f, DieHeightMm = 12f,
            };

            float r = w.DiameterMm / 2 - 3f; // 3 mm edge exclusion
            int cols = (int)(w.DiameterMm / w.DieWidthMm) + 2, rows = (int)(w.DiameterMm / w.DieHeightMm) + 2;
            for (int row = -rows / 2; row <= rows / 2; row++)
            for (int col = -cols / 2; col <= cols / 2; col++)
            {
                float x = (col + 0.5f) * w.DieWidthMm, y = (row + 0.5f) * w.DieHeightMm;
                if (!DieInside(x, y, w.DieWidthMm, w.DieHeightMm, r)) continue;

                float rr = (float)Math.Sqrt(x * x + y * y) / r;
                float v = 50f * (1 + 0.06f * rr * rr + 0.015f * x / r);
                float dx = x - 60f, dy = y + 80f;
                v += 3.2f * (float)Math.Exp(-(dx * dx + dy * dy) / (2 * 18f * 18f)); // hot cluster
                v += (float)(Gauss(rng) * 0.4);
                w.Dies.Add(new Die { Col = col, Row = row, X = x, Y = y, Value = v });
            }
            w.ComputeStats();
            return w;
        }

        private static bool DieInside(float cx, float cy, float dw, float dh, float r)
        {
            for (int i = 0; i < 4; i++)
            {
                float x = cx + ((i & 1) == 0 ? -dw : dw) / 2, y = cy + ((i & 2) == 0 ? -dh : dh) / 2;
                if (x * x + y * y > r * r) return false;
            }
            return true;
        }

        // ---------------------------------------------------------------------------------
        //  Simulation: MOSFET cross-section electrostatic potential + |E| (Laplace solve)
        // ---------------------------------------------------------------------------------

        public static FieldGrid MosfetPotential(out FieldGrid efield)
        {
            const int nx = 81, ny = 41;
            const float width = 1.0f, depth = 0.5f; // µm
            const float vSource = 0f, vGate = 1.0f, vDrain = 1.2f, vBody = 0f;

            var phi = new float[nx * ny];
            var fixedMask = new bool[nx * ny];
            int Idx(int x, int y) => y * nx + x;

            // Boundary conditions. y = ny-1 is the silicon surface, y = 0 the substrate contact.
            for (int x = 0; x < nx; x++)
            {
                float xf = x / (nx - 1f) * width;
                int top = Idx(x, ny - 1);
                if (xf < 0.22f) { phi[top] = vSource; fixedMask[top] = true; }
                else if (xf > 0.35f && xf < 0.65f) { phi[top] = vGate; fixedMask[top] = true; }   // gate (oxide folded in)
                else if (xf > 0.78f) { phi[top] = vDrain; fixedMask[top] = true; }
                phi[Idx(x, 0)] = vBody; fixedMask[Idx(x, 0)] = true;
            }

            // Successive over-relaxation with Neumann (zero-flux) edges where no contact is present.
            const float omega = 1.85f;
            for (int iter = 0; iter < 900; iter++)
            {
                for (int y = 0; y < ny; y++)
                for (int x = 0; x < nx; x++)
                {
                    int i = Idx(x, y);
                    if (fixedMask[i]) continue;
                    float l = phi[Idx(x > 0 ? x - 1 : x + 1, y)];
                    float r = phi[Idx(x < nx - 1 ? x + 1 : x - 1, y)];
                    float d = phi[Idx(x, y > 0 ? y - 1 : y + 1)];
                    float u = phi[Idx(x, y < ny - 1 ? y + 1 : y - 1)];
                    float gs = 0.25f * (l + r + d + u);
                    phi[i] += omega * (gs - phi[i]);
                }
            }

            var g = new FieldGrid(nx, ny)
            {
                Id = "tcad-phi", Title = "MOSFET Potential", Category = DataCategory.Simulation,
                Description = "Electrostatic potential in a MOSFET cross-section: source 0 V, gate 1.0 V, drain 1.2 V, body 0 V. Simplified Laplace solve.",
                XMin = 0, XMax = width, YMin = -depth, YMax = 0,
                XLabel = "x (µm)", YLabel = "Depth (µm)", Quantity = "Potential", Unit = "V",
                DefaultContourCount = 11,
            };
            Array.Copy(phi, g.Values, phi.Length);
            g.RecomputeRange();

            // |E| = |∇φ|. 1 V/µm = 10 kV/cm.
            float dxu = width / (nx - 1), dyu = depth / (ny - 1);
            efield = new FieldGrid(nx, ny)
            {
                Id = "tcad-e", Title = "MOSFET Electric Field", Category = DataCategory.Simulation,
                Description = "|E| from the potential solve. Peaks near the drain edge of the gate, where hot-carrier damage starts.",
                XMin = 0, XMax = width, YMin = -depth, YMax = 0,
                XLabel = "x (µm)", YLabel = "Depth (µm)", Quantity = "|E|", Unit = "kV/cm",
                DefaultContourCount = 8,
            };
            for (int y = 0; y < ny; y++)
            for (int x = 0; x < nx; x++)
            {
                int xl = Math.Max(0, x - 1), xr = Math.Min(nx - 1, x + 1);
                int yd = Math.Max(0, y - 1), yu = Math.Min(ny - 1, y + 1);
                float ex = (phi[Idx(xr, y)] - phi[Idx(xl, y)]) / ((xr - xl) * dxu);
                float ey = (phi[Idx(x, yu)] - phi[Idx(x, yd)]) / ((yu - yd) * dyu);
                efield[x, y] = (float)Math.Sqrt(ex * ex + ey * ey) * 10f;
            }
            efield.RecomputeRange();
            return g;
        }

        // ---------------------------------------------------------------------------------
        //  Simulation: steady-state die temperature from a power map
        // ---------------------------------------------------------------------------------

        public static FieldGrid ChipThermalMap()
        {
            const int n = 64;
            const float size = 10f; // mm
            var q = new float[n * n];

            // Power map: 4 CPU cores, a GPU block, an I/O ring and background leakage (arbitrary units).
            void Hot(float cx, float cy, float sigma, float p)
            {
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float dx = (x / (n - 1f) * size) - cx, dy = (y / (n - 1f) * size) - cy;
                    q[y * n + x] += p * (float)Math.Exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
                }
            }
            Hot(2.5f, 7.5f, 0.8f, 1.0f); Hot(4.5f, 7.5f, 0.8f, 1.1f);
            Hot(2.5f, 5.5f, 0.8f, 0.9f); Hot(4.5f, 5.5f, 0.8f, 1.3f);   // hottest core
            Hot(7.5f, 4.0f, 1.8f, 0.6f);                                 // GPU
            for (int i = 0; i < q.Length; i++) q[i] += 0.08f;            // leakage

            // Solve (∇² − α) θ = −q with zero-flux edges (Gauss–Seidel).
            var t = new float[n * n];
            float h = size / (n - 1), alpha = 0.35f;
            for (int iter = 0; iter < 1500; iter++)
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float s = t[y * n + Math.Max(0, x - 1)] + t[y * n + Math.Min(n - 1, x + 1)]
                        + t[Math.Max(0, y - 1) * n + x] + t[Math.Min(n - 1, y + 1) * n + x];
                t[y * n + x] = (s + h * h * q[y * n + x] * 30f) / (4 + alpha * h * h);
            }

            float tMax = 0; foreach (float v in t) tMax = Math.Max(tMax, v);
            var g = new FieldGrid(n, n)
            {
                Id = "thermal", Title = "Die Thermal Map", Category = DataCategory.Simulation,
                Description = "Steady-state junction temperature of a 10 × 10 mm SoC under load: four CPU cores and a GPU block, 45 °C ambient.",
                XMin = 0, XMax = size, YMin = 0, YMax = size,
                XLabel = "x (mm)", YLabel = "y (mm)", Quantity = "T_j", Unit = "°C",
                DefaultContourCount = 9,
            };
            for (int i = 0; i < t.Length; i++) g.Values[i] = 45f + 50f * t[i] / tMax; // peak 95 °C
            g.HighlightLevels.Add(85f); // throttle threshold
            g.RecomputeRange();
            return g;
        }

        // ---------------------------------------------------------------------------------
        //  Quality / simulation: lithography process window (CD vs focus & dose)
        // ---------------------------------------------------------------------------------

        public static FieldGrid ProcessWindow()
        {
            const int nx = 61, ny = 51;
            var g = new FieldGrid(nx, ny)
            {
                Id = "process-window", Title = "Litho Process Window", Category = DataCategory.Quality,
                Description = "Printed CD across a focus–exposure matrix. The orange contours are the 43 nm and 47 nm spec limits, so the region between them is the usable process window.",
                XMin = -0.30f, XMax = 0.30f, YMin = 20f, YMax = 30f,
                XLabel = "Focus (µm)", YLabel = "Dose (mJ/cm²)", Quantity = "CD", Unit = "nm",
                Diverging = true, DefaultContourCount = 12,
            };
            for (int y = 0; y < ny; y++)
            for (int x = 0; x < nx; x++)
            {
                float f = g.DataX(x / (nx - 1f)), d = g.DataY(y / (ny - 1f)) - 25f;
                g[x, y] = 45f - 1.6f * d + 60f * f * f * (1 + 0.04f * d) - 0.8f * f * d; // Bossung-like curvature
            }
            g.HighlightLevels.Add(43f);
            g.HighlightLevels.Add(47f);
            g.RecomputeRange();
            return g;
        }

        // ---------------------------------------------------------------------------------
        //  Quality: SPC chart of gate CD across 60 lots (with an outlier and a late drift)
        // ---------------------------------------------------------------------------------

        public static ControlChart GateCdControlChart()
        {
            var rng = new Random(37);
            var c = new ControlChart
            {
                Id = "spc-cd", Title = "Gate CD Control Chart", Category = DataCategory.Quality,
                Description = "Post-etch gate CD per lot. Limits are set from lots 1–20. One excursion at lot 23, then the etch drifts upward from lot 42.",
                Quantity = "Gate CD", Unit = "nm", Target = 45f, Lsl = 43f, Usl = 47f,
                BaselineCount = 20, // limits frozen from lots 1–20 (Phase I)
            };
            for (int i = 0; i < 60; i++)
            {
                float v = 45f + (float)(Gauss(rng) * 0.45);
                if (i == 22) v += 2.3f;
                if (i >= 41) v += 0.11f * (i - 40);
                c.Values.Add(v);
            }
            c.Compute();
            return c;
        }

        private static double Gauss(Random rng)
        {
            double u1 = 1.0 - rng.NextDouble(), u2 = rng.NextDouble();
            return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
        }
    }
}
