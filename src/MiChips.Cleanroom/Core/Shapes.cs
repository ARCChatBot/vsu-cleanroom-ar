// =====================================================================================
//  Shapes.cs
//  MI-CHIPS (NSF #2606117): primitive and telemetry helpers for building placeholder
//  equipment models. Meshes are created lazily because equipment definitions are read
//  before SK.Initialize.
// =====================================================================================

using StereoKit;

namespace MiChips.Cleanroom
{
    public static class Shapes
    {
        private static Mesh cyl;
        public static Mesh Cube => Mesh.Cube;                                               // 1 m cube, centred
        public static Mesh Sphere => Mesh.Sphere;                                           // 1 m diameter
        public static Mesh Cyl => cyl ??= Mesh.GenerateCylinder(1f, 1f, Vec3.UnitY, 24);   // 1 m dia × 1 m tall, Y-up

        public static Primitive Box(Vec3 center, Vec3 size, Color color, bool glow = false) =>
            new Primitive { Mesh = Cube, Color = color, Glow = glow, Local = Matrix.TS(center, size) };

        public static Primitive Box(Vec3 center, Vec3 size, Color color, Quat rotation) =>
            new Primitive { Mesh = Cube, Color = color, Local = Matrix.TRS(center, rotation, size) };

        public static Primitive Cylinder(Vec3 center, float diameter, float height, Color color, bool glow = false) =>
            new Primitive { Mesh = Cyl, Color = color, Glow = glow, Local = Matrix.TS(center, new Vec3(diameter, height, diameter)) };

        public static Primitive Ball(Vec3 center, float diameter, Color color) =>
            new Primitive { Mesh = Sphere, Color = color, Local = Matrix.TS(center, Vec3.One * diameter) };

        /// <summary>Adds an nx × nz grid of primitives centred on 'center' with the given pitch.</summary>
        public static void Grid(MachinePart part, int nx, int nz, float pitch, Vec3 center, System.Func<Vec3, Primitive> make)
        {
            for (int i = 0; i < nx; i++)
            for (int k = 0; k < nz; k++)
            {
                Vec3 p = center + new Vec3((i - (nx - 1) * 0.5f) * pitch, 0, (k - (nz - 1) * 0.5f) * pitch);
                part.Primitives.Add(make(p));
            }
        }

        public static TelemetryChannel Ch(string label, string unit, float nominal, float noise, float warnLow, float warnHigh, int decimals) =>
            new TelemetryChannel { Label = label, Unit = unit, Nominal = nominal, NoiseAmplitude = noise,
                                   WarnLow = warnLow, WarnHigh = warnHigh, Decimals = decimals };
    }
}
