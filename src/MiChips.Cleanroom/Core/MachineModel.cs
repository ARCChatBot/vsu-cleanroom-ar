// =====================================================================================
//  MachineModel.cs
//  MI-CHIPS (NSF #2606117): a holographic equipment model (any tool). It holds:
//    • the scene graph:  machine root → zones (explode as units) → parts (selectable) → primitives
//    • the exploded-view animation (staggered, eased, reversible mid-flight)
//    • chassis ghosting (opaque ⇄ alpha-blended fade)
//    • ray hit-testing for hand-ray / pinch selection
//    • a path overlay (UV beam, die-transfer path, ...) as glowing lines that stretch on explode
//
//  Geometry: the built-in placeholder is made from primitives sized like a real stepper.
//  To use real CAD, export one GLB per part to Assets/Models/<PartId>.glb. A part
//  with a matching file draws that model instead of its primitives, and is hit-tested
//  against the model's bounds.
//
//  Coordinate convention (machine space, metres): origin = floor centre of the footprint,
//  +Y up, +Z = machine FRONT (the side the trainee stands on), +X = trainee's right.
// =====================================================================================

using System;
using System.Collections.Generic;
using System.IO;
using StereoKit;

namespace MiChips.Cleanroom
{
    public sealed class Primitive
    {
        public Mesh Mesh;
        public Matrix Local;
        public Color Color;
        public bool Glow; // unlit (UV windows, status LEDs)
    }

    public sealed class MachinePart
    {
        public string Name;
        /// <summary>Null = decorative, not selectable.</summary>
        public PartData Data;
        public Matrix Local = Matrix.Identity;
        public readonly List<Primitive> Primitives = new List<Primitive>();
        /// <summary>Optional real CAD model (Assets/Models/&lt;PartId&gt;.glb).</summary>
        public Model Model;
        public Bounds LocalBounds;

        /// <summary>World matrix from the last Draw call (used for hit-testing and card placement).</summary>
        public Matrix World { get; internal set; } = Matrix.Identity;

        public Vec3 WorldCenter => World.Transform(LocalBounds.center);
        public float WorldRadius => (World.TransformNormal(LocalBounds.dimensions)).Length * 0.5f;
    }

    public sealed class Zone
    {
        public string Id;
        public string Label;
        public Vec3 Home;               // zone origin in machine space
        public Vec3 ExplodeDirection;   // machine space, normalised at runtime
        public float ExplodeDistance;   // metres at 1:1
        public float StaggerDelay;      // seconds; collapse plays the delays in reverse
        public readonly List<MachinePart> Parts = new List<MachinePart>();

        internal Vec3 Offset, StartOffset;
        internal Vec3 ExplodedOffset => ExplodeDirection.Normalized * ExplodeDistance;
    }

    public sealed class MachineModel
    {
        public readonly List<Zone> Zones = new List<Zone>();
        public readonly List<Primitive> Chassis = new List<Primitive>();

        /// <summary>Beam path waypoints: (part, point in that part's local space).</summary>
        public readonly List<(MachinePart part, Vec3 local)> BeamPath = new List<(MachinePart, Vec3)>();

        // ---- Explode animation settings ----
        public float ExplodeDuration = 1.2f;
        /// <summary>0 = plain ease-in-out. ~1.2 gives a gentle overshoot-and-settle.</summary>
        public float Overshoot = 0.9f;
        public float GhostAlpha = 0.15f;

        public bool IsAnimating { get; private set; }
        public bool TargetExploded { get; private set; }
        public bool ChassisGhosted => chassisAlpha < 0.999f;

        private float elapsed, maxStagger, alphaFrom, alphaTo;
        private float chassisAlpha = 1f;

        private readonly Material opaque = Material.Default;
        private readonly Material glow = Material.Unlit;
        private readonly Material ghost;

        /// <summary>Colour of the path overlay (UV beam for litho, die-transfer path for packaging).</summary>
        public Color32 PathColor = new Color32(170, 90, 255, 255);

        public MachineModel()
        {
            ghost = Material.Default.Copy();
            ghost.Transparency = Transparency.Blend;
            ghost.DepthWrite = false; // lets internals show through without sorting artefacts
        }

        // =================================================================================
        //  Explode / collapse
        // =================================================================================

        /// <summary>Explode (true) or collapse (false). Safe mid-animation: reverses from the current pose.</summary>
        public void SetExploded(bool explode)
        {
            if (explode == TargetExploded && IsAnimating) return;
            TargetExploded = explode;

            maxStagger = 0;
            foreach (Zone z in Zones)
            {
                z.StartOffset = z.Offset;
                maxStagger = Math.Max(maxStagger, z.StaggerDelay);
            }
            alphaFrom = chassisAlpha;
            alphaTo = explode ? GhostAlpha : 1f;
            elapsed = 0;
            IsAnimating = true;
        }

        public void SnapCollapsed()
        {
            foreach (Zone z in Zones) z.Offset = Vec3.Zero;
            chassisAlpha = 1f;
            TargetExploded = false;
            IsAnimating = false;
        }

        public void Update(float dt)
        {
            if (!IsAnimating) return;
            elapsed += dt;
            bool explode = TargetExploded;

            foreach (Zone z in Zones)
            {
                // On collapse, reverse the stagger: last out, first back.
                float delay = explode ? z.StaggerDelay : (maxStagger - z.StaggerDelay);
                float u = Clamp01((elapsed - delay) / ExplodeDuration);
                Vec3 target = explode ? z.ExplodedOffset : Vec3.Zero;
                z.Offset = Vec3.Lerp(z.StartOffset, target, Ease(u)); // Ease may exceed 1 → overshoot
            }

            chassisAlpha = Lerp(alphaFrom, alphaTo, EaseInOut(Clamp01(elapsed / ExplodeDuration)));

            if (elapsed >= ExplodeDuration + maxStagger)
            {
                foreach (Zone z in Zones) z.Offset = explode ? z.ExplodedOffset : Vec3.Zero; // kill float drift
                chassisAlpha = alphaTo;
                IsAnimating = false;
            }
        }

        // =================================================================================
        //  Rendering
        // =================================================================================

        public void Draw(Matrix root, MachinePart hovered, MachinePart selected)
        {
            foreach (Zone z in Zones)
            {
                Matrix zoneWorld = Matrix.T(z.Home + z.Offset) * root; // SK: child * parent
                foreach (MachinePart p in z.Parts)
                {
                    p.World = p.Local * zoneWorld;
                    Color tint = p == selected ? new Color(1.0f, 0.55f, 0.25f)
                               : p == hovered ? new Color(1.25f, 1.1f, 0.95f)
                               : Color.White;

                    if (p.Model != null) { p.Model.Draw(p.World, tint); continue; }

                    foreach (Primitive prim in p.Primitives)
                        prim.Mesh.Draw(prim.Glow ? glow : opaque, prim.Local * p.World, prim.Glow ? prim.Color : Mul(prim.Color, tint));
                }
            }

            DrawBeam();

            // Chassis: opaque when closed, alpha-blended ghost while exploded.
            Material chassisMat = ChassisGhosted ? ghost : opaque;
            foreach (Primitive prim in Chassis)
            {
                Color c = prim.Color; c.a = chassisAlpha;
                prim.Mesh.Draw(chassisMat, prim.Local * root, c);
            }
        }

        private void DrawBeam()
        {
            // Only meaningful (and visible) once the chassis is see-through.
            if (!ChassisGhosted || BeamPath.Count < 2) return;
            float pulse = 0.004f + 0.002f * (float)Math.Sin(Time.Totalf * 6f);
            for (int i = 0; i < BeamPath.Count - 1; i++)
            {
                Vec3 a = BeamPath[i].part.World.Transform(BeamPath[i].local);
                Vec3 b = BeamPath[i + 1].part.World.Transform(BeamPath[i + 1].local);
                Lines.Add(a, b, PathColor, pulse);
            }
        }

        // =================================================================================
        //  Hit-testing (hand ray / mouse ray)
        // =================================================================================

        /// <summary>Nearest selectable part hit by a world-space ray, using World matrices from the last Draw.</summary>
        public MachinePart Raycast(Ray worldRay)
        {
            MachinePart best = null;
            float bestDist = float.MaxValue;

            foreach (Zone z in Zones)
            foreach (MachinePart p in z.Parts)
            {
                if (p.Data == null) continue;

                Matrix inv = p.World.Inverse;
                var local = new Ray(inv.Transform(worldRay.position), inv.TransformNormal(worldRay.direction));
                if (!p.LocalBounds.Intersect(local, out Vec3 hitLocal)) continue;

                float d = Vec3.Distance(worldRay.position, p.World.Transform(hitLocal));
                if (d < bestDist) { bestDist = d; best = p; }
            }
            return best;
        }

        public IEnumerable<MachinePart> SelectableParts()
        {
            foreach (Zone z in Zones)
                foreach (MachinePart p in z.Parts)
                    if (p.Data != null) yield return p;
        }

        // =================================================================================
        //  Bounds / CAD loading
        // =================================================================================

        /// <summary>Compute local bounds for every part and load optional GLB overrides. Call once after building.</summary>
        public void Finalise(string modelsFolder)
        {
            foreach (Zone z in Zones)
            foreach (MachinePart p in z.Parts)
            {
                if (p.Data != null && !string.IsNullOrEmpty(modelsFolder))
                {
                    string path = Path.Combine(modelsFolder, p.Data.PartId + ".glb");
                    if (File.Exists(path))
                    {
                        p.Model = Model.FromFile(path);
                        if (p.Model != null) { p.LocalBounds = p.Model.Bounds; continue; }
                    }
                }
                p.LocalBounds = BoundsOf(p.Primitives);
            }
        }

        private static Bounds BoundsOf(List<Primitive> prims)
        {
            if (prims.Count == 0) return new Bounds(Vec3.Zero, Vec3.One * 0.1f);
            Vec3 min = new Vec3(float.MaxValue, float.MaxValue, float.MaxValue);
            Vec3 max = -min;
            foreach (Primitive prim in prims)
            {
                Bounds mb = prim.Mesh.Bounds;
                for (int i = 0; i < 8; i++)
                {
                    Vec3 corner = mb.center + new Vec3(
                        (i & 1) == 0 ? -mb.dimensions.x : mb.dimensions.x,
                        (i & 2) == 0 ? -mb.dimensions.y : mb.dimensions.y,
                        (i & 4) == 0 ? -mb.dimensions.z : mb.dimensions.z) * 0.5f;
                    Vec3 w = prim.Local.Transform(corner);
                    min = new Vec3(Math.Min(min.x, w.x), Math.Min(min.y, w.y), Math.Min(min.z, w.z));
                    max = new Vec3(Math.Max(max.x, w.x), Math.Max(max.y, w.y), Math.Max(max.z, w.z));
                }
            }
            return new Bounds((min + max) * 0.5f, max - min);
        }

        // =================================================================================
        //  Easing helpers
        // =================================================================================

        private float Ease(float u)
        {
            if (Overshoot <= 0f) return EaseInOut(u);
            // easeOutBack: overshoots slightly past 1, then settles.
            float c1 = Overshoot, c3 = c1 + 1f, x = u - 1f;
            return 1f + c3 * x * x * x + c1 * x * x;
        }

        private static float EaseInOut(float u) => u < 0.5f ? 4f * u * u * u : 1f - (float)Math.Pow(-2f * u + 2f, 3) / 2f;
        private static Color Mul(Color a, Color b) => new Color(a.r * b.r, a.g * b.g, a.b * b.b, a.a * b.a);
        private static float Clamp01(float v) => v < 0 ? 0 : v > 1 ? 1 : v;
        private static float Lerp(float a, float b, float t) => a + (b - a) * t;
    }
}
