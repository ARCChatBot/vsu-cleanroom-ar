// =====================================================================================
//  Contours.cs
//  MI-CHIPS (NSF #2606117): marching-squares iso-lines over a FieldGrid.
//  Output segments are in normalized grid coordinates (u, v) ∈ [0,1]², so the same result
//  can be drawn on a flat heatmap, lifted onto a 3D surface, or projected onto its base.
// =====================================================================================

using System.Collections.Generic;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public struct ContourSegment
    {
        public Vec2 A, B;
        public float Level;
        public bool Highlight;
    }

    public static class Contours
    {
        /// <summary>N evenly spaced levels strictly inside (min, max), plus the field's highlight levels.</summary>
        public static List<(float level, bool highlight)> Levels(FieldGrid g, int count)
        {
            var levels = new List<(float, bool)>();
            for (int k = 1; k <= count; k++) levels.Add((g.Min + k * (g.Max - g.Min) / (count + 1), false));
            foreach (float h in g.HighlightLevels)
                if (h > g.Min && h < g.Max) levels.Add((h, true));
            return levels;
        }

        public static List<ContourSegment> Compute(FieldGrid g, List<(float level, bool highlight)> levels)
        {
            var segs = new List<ContourSegment>();
            int nx = g.Nx, ny = g.Ny;
            float su = 1f / (nx - 1), sv = 1f / (ny - 1);

            foreach (var (L, hl) in levels)
            {
                for (int y = 0; y < ny - 1; y++)
                for (int x = 0; x < nx - 1; x++)
                {
                    // Corners: 0 = (x,y) bottom-left, 1 = (x+1,y), 2 = (x+1,y+1), 3 = (x,y+1)
                    float v0 = g[x, y], v1 = g[x + 1, y], v2 = g[x + 1, y + 1], v3 = g[x, y + 1];
                    int c = (v0 > L ? 1 : 0) | (v1 > L ? 2 : 0) | (v2 > L ? 4 : 0) | (v3 > L ? 8 : 0);
                    if (c == 0 || c == 15) continue;

                    // Edge crossing points (normalized coordinates)
                    Vec2 E(int edge)
                    {
                        switch (edge)
                        {
                            case 0: return new Vec2((x + T(v0, v1)) * su, y * sv);         // bottom
                            case 1: return new Vec2((x + 1) * su, (y + T(v1, v2)) * sv);   // right
                            case 2: return new Vec2((x + T(v3, v2)) * su, (y + 1) * sv);   // top
                            default: return new Vec2(x * su, (y + T(v0, v3)) * sv);        // left
                        }
                    }
                    float T(float a, float b) => System.Math.Abs(b - a) < 1e-12f ? 0.5f : (L - a) / (b - a);
                    void Add(int e1, int e2) => segs.Add(new ContourSegment { A = E(e1), B = E(e2), Level = L, Highlight = hl });

                    bool centreAbove = (v0 + v1 + v2 + v3) * 0.25f > L;
                    switch (c)
                    {
                        case 1: case 14: Add(3, 0); break;
                        case 2: case 13: Add(0, 1); break;
                        case 3: case 12: Add(3, 1); break;
                        case 4: case 11: Add(1, 2); break;
                        case 6: case 9:  Add(0, 2); break;
                        case 7: case 8:  Add(3, 2); break;
                        case 5:  // corners 0 and 2 above (saddle)
                            if (centreAbove) { Add(0, 1); Add(2, 3); } else { Add(3, 0); Add(1, 2); }
                            break;
                        case 10: // corners 1 and 3 above (saddle)
                            if (centreAbove) { Add(3, 0); Add(1, 2); } else { Add(0, 1); Add(2, 3); }
                            break;
                    }
                }
            }
            return segs;
        }
    }
}
