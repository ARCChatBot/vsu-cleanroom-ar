// =====================================================================================
//  GridMesh.cs
//  MI-CHIPS (NSF #2606117): builds vertex-coloured meshes from scalar fields.
//  One builder serves flat heatmaps, 3D height-field surfaces and colourbars; a mapping
//  function decides where each (u, v, h) sample lands in the view's local space.
// =====================================================================================

using System;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public static class GridMesh
    {
        /// <summary>
        /// Builds a mesh over the field. 'map' converts normalized grid coordinates u, v ∈ [0,1]
        /// and normalized value h ∈ [0,1] into a local-space position.
        /// </summary>
        public static Mesh Build(FieldGrid g, Colormap cmap, Func<float, float, float, Vec3> map)
        {
            int nx = g.Nx, ny = g.Ny;
            var pos = new Vec3[nx * ny];
            var verts = new Vertex[nx * ny];

            for (int y = 0; y < ny; y++)
            for (int x = 0; x < nx; x++)
            {
                float u = x / (nx - 1f), v = y / (ny - 1f), h = g.Normalize(g[x, y]);
                pos[y * nx + x] = map(u, v, h);
                verts[y * nx + x] = new Vertex(pos[y * nx + x], Vec3.UnitY, new Vec2(u, v), cmap.Sample32(h));
            }

            // Smooth normals from neighbouring positions, oriented toward "increasing value".
            for (int y = 0; y < ny; y++)
            for (int x = 0; x < nx; x++)
            {
                Vec3 dx = pos[y * nx + Math.Min(nx - 1, x + 1)] - pos[y * nx + Math.Max(0, x - 1)];
                Vec3 dy = pos[Math.Min(ny - 1, y + 1) * nx + x] - pos[Math.Max(0, y - 1) * nx + x];
                Vec3 n = Vec3.Cross(dx, dy);
                float u = x / (nx - 1f), v = y / (ny - 1f);
                Vec3 up = map(u, v, 1) - map(u, v, 0);
                if (up.LengthSq < 1e-12f) up = Vec3.Cross(map(1, 0, 0) - map(0, 0, 0), map(0, 1, 0) - map(0, 0, 0));
                if (Vec3.Dot(n, up) < 0) n = -n;
                verts[y * nx + x].norm = n.LengthSq > 1e-16f ? n.Normalized : Vec3.UnitY;
            }

            var inds = new uint[(nx - 1) * (ny - 1) * 6];
            int k = 0;
            for (int y = 0; y < ny - 1; y++)
            for (int x = 0; x < nx - 1; x++)
            {
                uint a = (uint)(y * nx + x), b = a + 1, c = a + (uint)nx, d = c + 1;
                inds[k++] = a; inds[k++] = c; inds[k++] = b;
                inds[k++] = b; inds[k++] = c; inds[k++] = d;
            }

            var mesh = new Mesh();
            mesh.SetData(verts, inds, true);
            return mesh;
        }

        /// <summary>A vertical gradient strip for colourbars: u ∈ [0,1] across, v ∈ [0,1] = value.</summary>
        public static Mesh BuildGradient(Colormap cmap, Func<float, float, Vec3> map, int steps = 48)
        {
            var verts = new Vertex[2 * (steps + 1)];
            for (int i = 0; i <= steps; i++)
            {
                float v = i / (float)steps;
                Color32 c = cmap.Sample32(v);
                verts[i * 2] = new Vertex(map(0, v), Vec3.UnitZ, new Vec2(0, v), c);
                verts[i * 2 + 1] = new Vertex(map(1, v), Vec3.UnitZ, new Vec2(1, v), c);
            }
            var inds = new uint[steps * 6];
            for (int i = 0; i < steps; i++)
            {
                uint a = (uint)(i * 2), b = a + 1, c = a + 2, d = a + 3;
                inds[i * 6 + 0] = a; inds[i * 6 + 1] = c; inds[i * 6 + 2] = b;
                inds[i * 6 + 3] = b; inds[i * 6 + 4] = c; inds[i * 6 + 5] = d;
            }
            var mesh = new Mesh();
            mesh.SetData(verts, inds, true);
            return mesh;
        }
    }
}
