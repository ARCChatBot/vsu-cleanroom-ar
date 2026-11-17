// =====================================================================================
//  LithoToolFactory.cs
//  MI-CHIPS (NSF #2606117): builds the placeholder photolithography tool and its
//  part catalogue (work instructions + telemetry).
//
//  ⚠ The maintenance steps and telemetry values below are PLACEHOLDERS for development.
//    Have a cleanroom equipment SME check every step against the OEM maintenance
//    manual and the site's EHS / LOTO procedures before students use them.
// =====================================================================================

using MiChips.Cleanroom;
using StereoKit;

namespace MiChips.Cleanroom.Lithography
{
    public static class LithoToolFactory
    {
        public static readonly EquipmentDefinition Definition = new EquipmentDefinition
        {
            Id = "litho-01",
            DisplayName = "Photolithography Tool",
            Description = "Stepper/scanner: wafer robot, UV optics, wafer stage, fluid and electrical racks.",
            MarkerPayload = "MICHIPS-LITHO-01",
            MarkerToMachineOffset = new Vec3(0f, -1.2f, -0.65f), // QR on front doors at 1.2 m; tool 1.3 m deep
            BuildModel = Build,
        };

        // Lazy: Definition is read before SK.Initialize, so no GPU resources may be touched at type-init time.
        private static Mesh cyl;
        private static Mesh Cube => Mesh.Cube;                                                  // 1 m unit cube, centred
        private static Mesh Cyl => cyl ??= Mesh.GenerateCylinder(1f, 1f, Vec3.UnitY, 24);      // 1 m dia × 1 m tall, Y-up

        // Palette for the placeholder (not brand colours; those are for UI only).
        private static readonly Color Steel = new Color(0.62f, 0.65f, 0.70f);
        private static readonly Color DarkSteel = new Color(0.30f, 0.32f, 0.36f);
        private static readonly Color Granite = new Color(0.20f, 0.20f, 0.22f);
        private static readonly Color Silicon = new Color(0.55f, 0.50f, 0.75f);
        private static readonly Color Glass = new Color(0.55f, 0.75f, 0.90f);
        private static readonly Color Mirror = new Color(0.85f, 0.88f, 0.95f);
        private static readonly Color UvGlow = new Color(0.65f, 0.35f, 1.00f);
        private static readonly Color Panel = new Color(0.82f, 0.84f, 0.86f);
        private static readonly Color CoolantBlue = new Color(0.20f, 0.45f, 0.80f);
        private static readonly Color PowerAmber = new Color(0.95f, 0.65f, 0.15f);
        private static readonly Color CtrlGreen = new Color(0.25f, 0.75f, 0.40f);

        public static MachineModel Build(string modelsFolder)
        {
            var m = new MachineModel { PathColor = new Color32(170, 90, 255, 255) }; // UV beam (visualisation; real UV is invisible)

            // ---------------- Z3 Wafer stage chuck (centre, low) ----------------
            var z3 = new Zone { Id = "Z3", Label = "Z3 Wafer Stage",
                                Home = Vec3.Zero, ExplodeDirection = new Vec3(0, 0, 1), ExplodeDistance = 0.45f, StaggerDelay = 0.16f };
            var granite = new MachinePart { Name = "Granite base" };
            granite.Primitives.Add(Box(new Vec3(0, 0.35f, 0), new Vec3(0.70f, 0.70f, 0.70f), Granite));
            var stage = new MachinePart { Name = "Wafer stage chuck", Data = WaferStage() };
            stage.Primitives.Add(Box(new Vec3(0, 0.74f, 0), new Vec3(0.50f, 0.08f, 0.50f), DarkSteel)); // XY stage
            stage.Primitives.Add(Cylinder(new Vec3(0, 0.80f, 0), 0.32f, 0.04f, Steel));                 // vacuum chuck
            stage.Primitives.Add(Cylinder(new Vec3(0, 0.8215f, 0), 0.30f, 0.003f, Silicon));            // 300 mm wafer
            stage.Primitives.Add(Box(new Vec3(0.26f, 0.80f, 0), new Vec3(0.01f, 0.06f, 0.40f), Mirror)); // interferometer mirror
            z3.Parts.Add(granite); z3.Parts.Add(stage);

            // ---------------- Z2 Projection / UV optics (upper) ----------------
            var z2 = new Zone { Id = "Z2", Label = "Z2 Projection Optics",
                                Home = Vec3.Zero, ExplodeDirection = new Vec3(0, 1, 0), ExplodeDistance = 0.50f, StaggerDelay = 0.08f };
            var lens = new MachinePart { Name = "Projection lens", Data = ProjectionLens() };
            lens.Primitives.Add(Cylinder(new Vec3(0, 1.05f, 0), 0.22f, 0.30f, DarkSteel));
            lens.Primitives.Add(Cylinder(new Vec3(0, 1.27f, 0), 0.28f, 0.14f, DarkSteel));
            lens.Primitives.Add(Cylinder(new Vec3(0, 0.895f, 0), 0.12f, 0.01f, Glass)); // final element
            var reticle = new MachinePart { Name = "Reticle stage" };
            reticle.Primitives.Add(Box(new Vec3(0, 1.43f, 0), new Vec3(0.40f, 0.04f, 0.40f), Steel));
            reticle.Primitives.Add(Box(new Vec3(0, 1.455f, 0), new Vec3(0.15f, 0.006f, 0.15f), Glass)); // reticle/mask
            var mirror = new MachinePart { Name = "Fold mirror assembly", Data = FoldMirror(),
                                           Local = Matrix.T(new Vec3(0, 1.66f, 0)) };
            mirror.Primitives.Add(Box(Vec3.Zero, new Vec3(0.20f, 0.012f, 0.20f), Mirror, Quat.FromAngles(0, 0, 45)));
            mirror.Primitives.Add(Box(new Vec3(-0.09f, -0.06f, 0), new Vec3(0.03f, 0.14f, 0.18f), DarkSteel)); // mount
            var source = new MachinePart { Name = "UV illumination source", Data = UvSource(),
                                           Local = Matrix.T(new Vec3(0.45f, 1.66f, -0.10f)) };
            source.Primitives.Add(Box(Vec3.Zero, new Vec3(0.40f, 0.22f, 0.30f), Panel));
            source.Primitives.Add(new Primitive { Mesh = Cube, Color = UvGlow, Glow = true,
                                                  Local = Matrix.TS(new Vec3(-0.201f, 0, 0), new Vec3(0.004f, 0.06f, 0.06f)) });
            z2.Parts.Add(lens); z2.Parts.Add(reticle); z2.Parts.Add(mirror); z2.Parts.Add(source);

            // ---------------- Z1 Wafer handling robot (left) ----------------
            var z1 = new Zone { Id = "Z1", Label = "Z1 Wafer Handling Robot",
                                Home = new Vec3(-0.60f, 0, 0.15f), ExplodeDirection = new Vec3(-1, 0, 0.3f), ExplodeDistance = 0.45f, StaggerDelay = 0f };
            var robot = new MachinePart { Name = "Wafer handling robot", Data = Robot() };
            robot.Primitives.Add(Box(new Vec3(0, 0.40f, 0), new Vec3(0.30f, 0.80f, 0.30f), Panel));        // pedestal
            robot.Primitives.Add(Cylinder(new Vec3(0, 0.85f, 0), 0.18f, 0.10f, DarkSteel));               // shoulder
            robot.Primitives.Add(Box(new Vec3(0.12f, 0.88f, 0), new Vec3(0.28f, 0.05f, 0.08f), Steel));    // link 1
            robot.Primitives.Add(Box(new Vec3(0.30f, 0.92f, 0), new Vec3(0.22f, 0.04f, 0.06f), Steel));    // link 2
            robot.Primitives.Add(Box(new Vec3(0.45f, 0.935f, 0), new Vec3(0.12f, 0.01f, 0.10f), DarkSteel)); // end effector
            robot.Primitives.Add(Cylinder(new Vec3(0.47f, 0.942f, 0), 0.20f, 0.003f, Silicon));            // wafer in transit
            z1.Parts.Add(robot);

            // ---------------- Z4 Fluid / electrical racks (right) ----------------
            var z4 = new Zone { Id = "Z4", Label = "Z4 Fluid & Electrical Racks",
                                Home = new Vec3(0.70f, 0, -0.10f), ExplodeDirection = new Vec3(1, 0, -0.2f), ExplodeDistance = 0.45f, StaggerDelay = 0.24f };
            var racks = new MachinePart { Name = "Fluid & electrical racks", Data = Racks() };
            racks.Primitives.Add(Box(new Vec3(0, 0.70f, 0), new Vec3(0.36f, 1.40f, 0.60f), DarkSteel));
            racks.Primitives.Add(Box(new Vec3(0, 0.25f, 0.305f), new Vec3(0.30f, 0.30f, 0.01f), CoolantBlue)); // chiller / TCU
            racks.Primitives.Add(Box(new Vec3(0, 0.70f, 0.305f), new Vec3(0.30f, 0.30f, 0.01f), PowerAmber));  // power distribution
            racks.Primitives.Add(Box(new Vec3(0, 1.15f, 0.305f), new Vec3(0.30f, 0.30f, 0.01f), CtrlGreen));   // controller
            racks.Primitives.Add(Cylinder(new Vec3(-0.20f, 0.50f, 0.15f), 0.03f, 0.60f, CoolantBlue));         // coolant line
            z4.Parts.Add(racks);

            m.Zones.Add(z1); m.Zones.Add(z2); m.Zones.Add(z3); m.Zones.Add(z4);

            // ---------------- Chassis (ghosted when exploded) ----------------
            const float W = 1.90f, H = 1.95f, D = 1.30f, T = 0.02f;
            m.Chassis.Add(Box(new Vec3(0, H / 2, -D / 2), new Vec3(W, H, T), Panel));           // back
            m.Chassis.Add(Box(new Vec3(-W / 2, H / 2, 0), new Vec3(T, H, D), Panel));           // left
            m.Chassis.Add(Box(new Vec3(W / 2, H / 2, 0), new Vec3(T, H, D), Panel));            // right
            m.Chassis.Add(Box(new Vec3(0, H, 0), new Vec3(W, T, D), Panel));                    // roof
            m.Chassis.Add(Box(new Vec3(0, H / 2, D / 2), new Vec3(W, H, T), Panel));            // front doors
            m.Chassis.Add(Box(new Vec3(0, 1.75f, D / 2 + 0.011f), new Vec3(W, 0.06f, 0.002f), new Color(1f, 0.4f, 0f))); // accent stripe

            // ---------------- UV beam path (visualisation) ----------------
            m.BeamPath.Add((source, new Vec3(-0.20f, 0, 0)));     // source exit window
            m.BeamPath.Add((mirror, Vec3.Zero));                  // fold mirror (90° turn down)
            m.BeamPath.Add((reticle, new Vec3(0, 1.455f, 0)));    // through the reticle
            m.BeamPath.Add((lens, new Vec3(0, 1.34f, 0)));        // into the projection lens
            m.BeamPath.Add((lens, new Vec3(0, 0.89f, 0)));        // out of the final element
            m.BeamPath.Add((stage, new Vec3(0, 0.823f, 0)));      // exposure field on the wafer

            m.Finalise(modelsFolder);
            return m;
        }

        // ---------------------------------------------------------------------------------
        //  Primitive helpers
        // ---------------------------------------------------------------------------------

        private static Primitive Box(Vec3 center, Vec3 size, Color color) =>
            new Primitive { Mesh = Cube, Color = color, Local = Matrix.TS(center, size) };

        private static Primitive Box(Vec3 center, Vec3 size, Color color, Quat rotation) =>
            new Primitive { Mesh = Cube, Color = color, Local = Matrix.TRS(center, rotation, size) };

        private static Primitive Cylinder(Vec3 center, float diameter, float height, Color color) =>
            new Primitive { Mesh = Cyl, Color = color, Local = Matrix.TS(center, new Vec3(diameter, height, diameter)) };

        private static TelemetryChannel Ch(string label, string unit, float nominal, float noise, float warnLow, float warnHigh, int decimals) =>
            new TelemetryChannel { Label = label, Unit = unit, Nominal = nominal, NoiseAmplitude = noise,
                                   WarnLow = warnLow, WarnHigh = warnHigh, Decimals = decimals };

        // ---------------------------------------------------------------------------------
        //  Part catalogue (PLACEHOLDER content: see header)
        // ---------------------------------------------------------------------------------

        private static PartData Robot() => new PartData
        {
            PartId = "LITHO-Z1-ROB", PartName = "Wafer Handling Robot", Zone = "Z1",
            Summary = "Moves wafers between the FOUP load port, the pre-aligner and the wafer stage.",
            Steps =
            {
                new WorkStep("Verify load port", "Confirm the FOUP is seated and clamped and the door-open sensor reads OPEN."),
                new WorkStep("Clear the envelope", "Make sure no hands or tools are inside the robot's work envelope before homing.", true),
                new WorkStep("Home the robot", "From the tool HMI, run ROBOT > HOME ALL AXES. Watch for a smooth, collision-free move."),
                new WorkStep("Teach-position check", "Step to each station and compare the end-effector position against the taught values."),
                new WorkStep("End-effector vacuum", "Pick a test wafer and confirm vacuum holds below the threshold for 30 s."),
            },
            Telemetry =
            {
                Ch("End-effector vacuum", "kPa", -80f, 2f, -90f, -70f, 1),
                Ch("Axis-2 motor temp", "°C", 34f, 1.5f, 0f, 45f, 1),
            }
        };

        private static PartData UvSource() => new PartData
        {
            PartId = "LITHO-Z2-SRC", PartName = "UV Illumination Source", Zone = "Z2",
            Summary = "Excimer laser (ArF 193 nm) or mercury lamp (i-line 365 nm) feeding the illuminator.",
            Steps =
            {
                new WorkStep("Interlocks and shutter", "Confirm the laser interlock chain is closed and the shutter reads CLOSED. Never defeat an interlock.", true),
                new WorkStep("Hour meter", "Record the lamp/laser hours and compare them against the replacement interval."),
                new WorkStep("Gas / lamp status", "Check gas fill pressure (excimer) or lamp current (mercury) on the source panel."),
                new WorkStep("Dose check", "With the shutter under tool control, run the dose-monitor routine at the reticle plane."),
            },
            Telemetry =
            {
                Ch("Wavelength", "nm", 193.368f, 0.0005f, 193.366f, 193.370f, 4),
                Ch("Pulse energy", "mJ", 10f, 0.3f, 9.2f, 10.8f, 2),
                Ch("Repetition rate", "kHz", 6f, 0.01f, 5.9f, 6.1f, 2),
            }
        };

        private static PartData FoldMirror() => new PartData
        {
            PartId = "LITHO-Z2-MIR", PartName = "Fold Mirror Assembly", Zone = "Z2",
            Summary = "45° turning mirror that folds the illumination beam down toward the reticle.",
            Steps =
            {
                new WorkStep("Lock out the source", "Source OFF and locked out. UV exposure can injure eyes and skin.", true),
                new WorkStep("Visual inspection", "Inspect the coating with a UV-safe inspection lamp for haze, particles or burn marks."),
                new WorkStep("Purge flow", "Confirm the N2 purge flow to the optics housing is within spec."),
                new WorkStep("Handling", "Never touch optical surfaces. Escalate contamination to the optics engineer.", true),
            },
            Telemetry =
            {
                Ch("N2 purge flow", "L/min", 5f, 0.2f, 4.5f, 5.5f, 2),
                Ch("Mirror temp", "°C", 22f, 0.05f, 21.8f, 22.2f, 2),
            }
        };

        private static PartData ProjectionLens() => new PartData
        {
            PartId = "LITHO-Z2-LNS", PartName = "Projection Lens", Zone = "Z2",
            Summary = "Reduction lens (typically 4×) that images the reticle pattern onto the wafer.",
            Steps =
            {
                new WorkStep("Environmental control", "Check that lens temperature and pressure control are stable and in spec."),
                new WorkStep("Calibration log", "Review the most recent focus and aberration calibration results."),
                new WorkStep("Final element", "Inspect the final element for contamination. Report anything found; don't clean it yourself."),
            },
            Telemetry =
            {
                Ch("Lens temp", "°C", 22f, 0.01f, 21.98f, 22.02f, 3),
                Ch("Lens pressure", "kPa", 101.3f, 0.05f, 101.1f, 101.5f, 2),
            }
        };

        private static PartData WaferStage() => new PartData
        {
            PartId = "LITHO-Z3-STG", PartName = "Wafer Stage Chuck", Zone = "Z3",
            Summary = "Vacuum chuck on an interferometer-controlled XY stage that positions the wafer under the lens.",
            Steps =
            {
                new WorkStep("Stage to load position", "From the HMI, move the stage to LOAD and confirm motion has stopped.", true),
                new WorkStep("Clean the chuck", "Wipe the chuck with an approved cleanroom wipe and IPA, centre outward."),
                new WorkStep("Vacuum leak-up test", "Seal a test wafer and confirm the vacuum decay stays within spec over 60 s."),
                new WorkStep("Interferometer calibration", "Run the stage interferometer calibration routine and record the residuals."),
            },
            Telemetry =
            {
                Ch("Stage temp", "°C", 22f, 0.01f, 21.98f, 22.02f, 3),
                Ch("Chuck vacuum", "kPa", -85f, 1f, -90f, -80f, 1),
                Ch("Position error", "nm", 0f, 3f, -5f, 5f, 1),
            }
        };

        private static PartData Racks() => new PartData
        {
            PartId = "LITHO-Z4-RCK", PartName = "Fluid & Electrical Racks", Zone = "Z4",
            Summary = "Chiller/TCU, vacuum, power distribution and tool controller.",
            Steps =
            {
                new WorkStep("Lockout / tagout", "Apply LOTO at the main disconnect following the site procedure.", true),
                new WorkStep("Verify zero energy", "Use a rated meter to verify zero voltage. Bleed stored pneumatic and hydraulic energy.", true),
                new WorkStep("Chiller check", "Check the coolant level, supply temperature and flow against spec."),
                new WorkStep("Leak inspection", "Inspect fittings and drip trays for leaks or residue. Report any findings."),
            },
            Telemetry =
            {
                Ch("Chiller supply", "°C", 21.5f, 0.1f, 21.0f, 22.0f, 2),
                Ch("Coolant flow", "L/min", 12f, 0.4f, 10.5f, 13.5f, 1),
                Ch("Mains voltage", "VAC", 208f, 2f, 198f, 218f, 0),
            }
        };
    }
}
