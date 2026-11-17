// =====================================================================================
//  PackagingCellFactory.cs
//  MI-CHIPS (NSF #2606117): Advanced Packaging cell. A die-to-wafer bonder used to build
//  precision multichip modules (MCM / 2.5D) and 3D die stacks, plus a floating,
//  explodable "3D stack" learning exhibit showing what the tool produces.
//
//  Tool zones (machine space, +Z = front where the trainee stands):
//    Z1 Die supply        tape-frame stage, die ejector, flipper, frame cassette
//    Z2 Bond head/vision  heated force-controlled bond head; up- and down-looking alignment cameras
//    Z3 Bond stage        heated vacuum chuck holding the target wafer / interposer
//    Z4 Surface prep      plasma activation chamber (hybrid bonding), underfill / NCF dispenser
//  Exhibit (left of the tool, NOT to scale):
//    organic substrate → silicon interposer with TSVs → logic die + HBM stack (base die + 4 DRAM dies)
//
//  ⚠ Maintenance steps, telemetry ranges and process numbers are PLACEHOLDERS / typical
//    industry ranges for development. Have a packaging equipment SME check them against
//    the OEM manual and the site's EHS / LOTO procedures before students use them.
// =====================================================================================

using MiChips.Cleanroom;
using StereoKit;
using static MiChips.Cleanroom.Shapes;

namespace MiChips.Cleanroom.Packaging
{
    public static class PackagingCellFactory
    {
        public static readonly EquipmentDefinition Definition = new EquipmentDefinition
        {
            Id = "pkg-01",
            DisplayName = "Advanced Packaging Bonder",
            Description = "Die-to-wafer bonder for multichip modules and 3D stacking: die supply, bond head and vision, bond stage, plasma and underfill. Includes a 3D-stack exhibit.",
            MarkerPayload = "MICHIPS-PKG-01",
            MarkerToMachineOffset = new Vec3(0f, -1.2f, -0.625f), // QR on front window frame at 1.2 m; tool 1.25 m deep
            BuildModel = Build,
        };

        // Placeholder palette
        private static readonly Color Steel = new Color(0.62f, 0.65f, 0.70f);
        private static readonly Color DarkSteel = new Color(0.30f, 0.32f, 0.36f);
        private static readonly Color Granite = new Color(0.20f, 0.20f, 0.22f);
        private static readonly Color Panel = new Color(0.82f, 0.84f, 0.86f);
        private static readonly Color Silicon = new Color(0.55f, 0.50f, 0.75f);
        private static readonly Color Copper = new Color(0.80f, 0.50f, 0.30f);
        private static readonly Color Solder = new Color(0.78f, 0.78f, 0.80f);
        private static readonly Color Tape = new Color(0.45f, 0.65f, 0.90f);
        private static readonly Color Heater = new Color(1.00f, 0.45f, 0.15f);   // glowing: heated collet
        private static readonly Color CamGlow = new Color(0.30f, 0.90f, 1.00f);  // camera ring lights
        private static readonly Color Plasma = new Color(0.95f, 0.40f, 0.85f);   // glowing: plasma viewport
        private static readonly Color Syringe = new Color(0.92f, 0.92f, 0.88f);
        private static readonly Color Substrate = new Color(0.15f, 0.35f, 0.22f);
        private static readonly Color LogicDie = new Color(0.25f, 0.30f, 0.45f);
        private static readonly Color DramDie = new Color(0.40f, 0.42f, 0.55f);

        public static MachineModel Build(string modelsFolder)
        {
            var m = new MachineModel { PathColor = new Color32(60, 210, 255, 255) }; // die-transfer path

            // ---------------- Z1 Die supply (left) ----------------
            var z1 = new Zone { Id = "Z1", Label = "Z1 Die Supply", Home = new Vec3(-0.58f, 0, 0.10f),
                                ExplodeDirection = new Vec3(-1, 0, 0.25f), ExplodeDistance = 0.45f, StaggerDelay = 0f };
            var ejector = new MachinePart { Name = "Die ejector & tape-frame stage", Data = DieEjector() };
            ejector.Primitives.Add(Box(new Vec3(0, 0.45f, 0), new Vec3(0.34f, 0.90f, 0.40f), Panel));       // pedestal
            ejector.Primitives.Add(Cylinder(new Vec3(0, 0.905f, 0), 0.34f, 0.010f, DarkSteel));            // frame ring
            ejector.Primitives.Add(Cylinder(new Vec3(0, 0.9105f, 0), 0.32f, 0.001f, Tape));                // dicing tape
            ejector.Primitives.Add(Cylinder(new Vec3(0, 0.912f, 0), 0.28f, 0.002f, Silicon));              // diced wafer
            ejector.Primitives.Add(Cylinder(new Vec3(0, 0.885f, 0), 0.04f, 0.030f, Steel));                // ejector cap
            ejector.Primitives.Add(Box(new Vec3(0.15f, 0.95f, 0), new Vec3(0.12f, 0.02f, 0.04f), Steel));   // flipper arm
            ejector.Primitives.Add(Box(new Vec3(0.21f, 0.94f, 0), new Vec3(0.03f, 0.015f, 0.03f), DarkSteel)); // flipper collet
            var cassette = new MachinePart { Name = "Frame cassette" };
            cassette.Primitives.Add(Box(new Vec3(0, 1.10f, -0.28f), new Vec3(0.30f, 0.36f, 0.14f), Panel));
            z1.Parts.Add(ejector); z1.Parts.Add(cassette);

            // ---------------- Z2 Bond head & vision (upper centre) ----------------
            var z2 = new Zone { Id = "Z2", Label = "Z2 Bond Head & Vision", Home = Vec3.Zero,
                                ExplodeDirection = new Vec3(0, 1, 0), ExplodeDistance = 0.50f, StaggerDelay = 0.08f };
            var gantry = new MachinePart { Name = "Gantry" };
            gantry.Primitives.Add(Box(new Vec3(0, 1.38f, 0), new Vec3(1.30f, 0.08f, 0.10f), DarkSteel));
            var bondHead = new MachinePart { Name = "Bond head", Data = BondHead() };
            bondHead.Primitives.Add(Box(new Vec3(0, 1.25f, 0), new Vec3(0.12f, 0.18f, 0.12f), Steel));       // carriage + force sensor
            bondHead.Primitives.Add(Cylinder(new Vec3(0, 1.12f, 0), 0.05f, 0.10f, DarkSteel));               // Z spindle
            bondHead.Primitives.Add(Box(new Vec3(0, 1.06f, 0), new Vec3(0.045f, 0.02f, 0.045f), Heater, glow: true)); // heated collet
            bondHead.Primitives.Add(Box(new Vec3(0, 1.048f, 0), new Vec3(0.02f, 0.004f, 0.02f), Silicon));   // die on collet
            var downCam = new MachinePart { Name = "Down-looking camera", Data = Vision() };
            downCam.Primitives.Add(Cylinder(new Vec3(0.11f, 1.17f, 0), 0.035f, 0.12f, DarkSteel));
            downCam.Primitives.Add(Cylinder(new Vec3(0.11f, 1.108f, 0), 0.030f, 0.004f, CamGlow, glow: true));
            var upCam = new MachinePart { Name = "Up-looking camera", Data = Vision() };
            upCam.Primitives.Add(Cylinder(new Vec3(-0.32f, 0.95f, 0.18f), 0.035f, 0.10f, DarkSteel));
            upCam.Primitives.Add(Cylinder(new Vec3(-0.32f, 1.002f, 0.18f), 0.030f, 0.004f, CamGlow, glow: true));
            z2.Parts.Add(gantry); z2.Parts.Add(bondHead); z2.Parts.Add(downCam); z2.Parts.Add(upCam);

            // ---------------- Z3 Bond stage (centre, low) ----------------
            var z3 = new Zone { Id = "Z3", Label = "Z3 Bond Stage", Home = Vec3.Zero,
                                ExplodeDirection = new Vec3(0, 0, 1), ExplodeDistance = 0.45f, StaggerDelay = 0.16f };
            var granite = new MachinePart { Name = "Granite base" };
            granite.Primitives.Add(Box(new Vec3(0, 0.40f, 0), new Vec3(0.80f, 0.80f, 0.70f), Granite));
            var stage = new MachinePart { Name = "Bond stage & heated chuck", Data = BondStage() };
            stage.Primitives.Add(Box(new Vec3(0, 0.83f, 0), new Vec3(0.50f, 0.06f, 0.45f), DarkSteel));     // XY stage
            stage.Primitives.Add(Cylinder(new Vec3(0, 0.88f, 0), 0.32f, 0.04f, Copper));                    // heated chuck
            stage.Primitives.Add(Cylinder(new Vec3(0, 0.9015f, 0), 0.30f, 0.003f, Silicon));                // target wafer
            Grid(stage, 5, 5, 0.04f, new Vec3(0, 0.905f, 0),                                                // bonded dies
                 p => Box(p, new Vec3(0.022f, 0.004f, 0.022f), LogicDie));
            z3.Parts.Add(granite); z3.Parts.Add(stage);

            // ---------------- Z4 Surface prep (right) ----------------
            var z4 = new Zone { Id = "Z4", Label = "Z4 Surface Prep & Dispense", Home = new Vec3(0.60f, 0, -0.05f),
                                ExplodeDirection = new Vec3(1, 0, -0.2f), ExplodeDistance = 0.45f, StaggerDelay = 0.24f };
            var cabinet = new MachinePart { Name = "Utility cabinet" };
            cabinet.Primitives.Add(Box(new Vec3(0, 0.60f, 0), new Vec3(0.34f, 1.20f, 0.60f), DarkSteel));
            var plasma = new MachinePart { Name = "Plasma activation chamber", Data = PlasmaChamber() };
            plasma.Primitives.Add(Cylinder(new Vec3(0, 1.32f, 0), 0.28f, 0.22f, Steel));
            plasma.Primitives.Add(Box(new Vec3(0, 1.32f, 0.141f), new Vec3(0.08f, 0.06f, 0.004f), Plasma, glow: true)); // viewport
            plasma.Primitives.Add(Box(new Vec3(0, 1.47f, 0), new Vec3(0.16f, 0.08f, 0.16f), Panel));        // RF match
            var dispenser = new MachinePart { Name = "Underfill / NCF dispenser", Data = Dispenser() };
            dispenser.Primitives.Add(Box(new Vec3(-0.22f, 1.06f, 0.10f), new Vec3(0.06f, 0.12f, 0.06f), Steel));
            dispenser.Primitives.Add(Cylinder(new Vec3(-0.22f, 0.96f, 0.10f), 0.026f, 0.09f, Syringe));
            dispenser.Primitives.Add(Cylinder(new Vec3(-0.22f, 0.905f, 0.10f), 0.004f, 0.02f, Steel));      // needle
            z4.Parts.Add(cabinet); z4.Parts.Add(plasma); z4.Parts.Add(dispenser);

            m.Zones.Add(z1); m.Zones.Add(z2); m.Zones.Add(z3); m.Zones.Add(z4);

            // ---------------- 3D stack exhibit (left of tool, NOT to scale) ----------------
            AddStackExhibit(m, new Vec3(-1.25f, 1.15f, 0.35f));

            // ---------------- Chassis ----------------
            const float W = 1.70f, H = 1.95f, D = 1.25f, T = 0.02f;
            m.Chassis.Add(Box(new Vec3(0, H / 2, -D / 2), new Vec3(W, H, T), Panel));   // back
            m.Chassis.Add(Box(new Vec3(-W / 2, H / 2, 0), new Vec3(T, H, D), Panel));   // left
            m.Chassis.Add(Box(new Vec3(W / 2, H / 2, 0), new Vec3(T, H, D), Panel));    // right
            m.Chassis.Add(Box(new Vec3(0, H, 0), new Vec3(W, T, D), Panel));            // roof (FFU)
            m.Chassis.Add(Box(new Vec3(0, H / 2, D / 2), new Vec3(W, H, T), Panel));    // front window frame
            m.Chassis.Add(Box(new Vec3(0, 1.75f, D / 2 + 0.011f), new Vec3(W, 0.06f, 0.002f), new Color(1f, 0.4f, 0f))); // accent stripe

            // ---------------- Die-transfer path ----------------
            // eject from tape → flipper flips die → bond head picks → align over up-looking camera → bond on target site
            m.BeamPath.Add((ejector, new Vec3(0, 0.915f, 0)));
            m.BeamPath.Add((ejector, new Vec3(0.21f, 0.94f, 0)));
            m.BeamPath.Add((bondHead, new Vec3(0, 1.046f, 0)));
            m.BeamPath.Add((upCam, new Vec3(-0.32f, 1.004f, 0.18f)));
            m.BeamPath.Add((stage, new Vec3(0.04f, 0.907f, 0.04f)));

            m.Finalise(modelsFolder);
            return m;
        }

        /// <summary>
        /// Each layer is its own zone exploding straight up by increasing distances, so the stack
        /// fans apart like a cross-section diagram. Heights are exaggerated for visibility.
        /// </summary>
        private static void AddStackExhibit(MachineModel m, Vec3 basePos)
        {
            Zone Layer(string id, string label, float distance, float stagger) =>
                new Zone { Id = id, Label = label, Home = basePos, ExplodeDirection = Vec3.UnitY,
                           ExplodeDistance = distance, StaggerDelay = stagger };

            // Organic substrate with BGA balls
            var subZone = Layer("X1", "Package substrate", 0f, 0f);
            var substrate = new MachinePart { Name = "Organic package substrate", Data = ExSubstrate() };
            substrate.Primitives.Add(Box(Vec3.Zero, new Vec3(0.30f, 0.02f, 0.30f), Substrate));
            Grid(substrate, 6, 6, 0.045f, new Vec3(0, -0.016f, 0), p => Ball(p, 0.014f, Solder));
            subZone.Parts.Add(substrate);

            // Silicon interposer with C4 bumps and TSVs
            var intZone = Layer("X2", "Silicon interposer", 0.06f, 0.05f);
            var interposer = new MachinePart { Name = "Silicon interposer", Data = ExInterposer() };
            Grid(interposer, 5, 5, 0.04f, new Vec3(0, 0.014f, 0), p => Ball(p, 0.008f, Solder));      // C4 bumps
            interposer.Primitives.Add(Box(new Vec3(0, 0.024f, 0), new Vec3(0.24f, 0.008f, 0.22f), Silicon));
            Grid(interposer, 4, 4, 0.05f, new Vec3(0, 0.024f, 0), p => Cylinder(p, 0.004f, 0.0085f, Copper)); // TSVs
            intZone.Parts.Add(interposer);

            // Logic die (SoC) on microbumps
            var socZone = Layer("X3", "Logic die", 0.12f, 0.10f);
            var soc = new MachinePart { Name = "Logic die (SoC)", Data = ExLogicDie() };
            Grid(soc, 4, 5, 0.022f, new Vec3(-0.055f, 0.030f, 0), p => Ball(p, 0.004f, Solder));      // microbumps
            soc.Primitives.Add(Box(new Vec3(-0.055f, 0.036f, 0), new Vec3(0.09f, 0.008f, 0.12f), LogicDie));
            socZone.Parts.Add(soc);

            // HBM: base die + 4 DRAM core dies, each with TSVs
            var baseZone = Layer("X4", "HBM base die", 0.14f, 0.15f);
            var hbmBase = new MachinePart { Name = "HBM base die", Data = ExHbmBase() };
            Grid(hbmBase, 3, 4, 0.02f, new Vec3(0.06f, 0.030f, 0), p => Ball(p, 0.004f, Solder));
            hbmBase.Primitives.Add(Box(new Vec3(0.06f, 0.034f, 0), new Vec3(0.07f, 0.006f, 0.09f), LogicDie));
            AddTsvs(hbmBase, 0.034f);
            baseZone.Parts.Add(hbmBase);
            m.Zones.Add(subZone); m.Zones.Add(intZone); m.Zones.Add(socZone); m.Zones.Add(baseZone);

            PartData dram = ExDram(); // shared card for all four core dies
            for (int k = 1; k <= 4; k++)
            {
                float y = 0.034f + k * 0.0075f;
                var z = Layer("X" + (4 + k), "DRAM core die " + k, 0.14f + 0.03f * k, 0.15f + 0.04f * k);
                var die = new MachinePart { Name = "HBM DRAM core die " + k, Data = dram };
                die.Primitives.Add(Box(new Vec3(0.06f, y, 0), new Vec3(0.07f, 0.006f, 0.09f), DramDie));
                AddTsvs(die, y);
                z.Parts.Add(die);
                m.Zones.Add(z);
            }
        }

        private static void AddTsvs(MachinePart die, float y)
        {
            for (int i = -1; i <= 1; i++)
                die.Primitives.Add(Cylinder(new Vec3(0.06f + i * 0.02f, y, 0), 0.003f, 0.0065f, Copper));
        }

        // ---------------------------------------------------------------------------------
        //  Tool part catalogue (PLACEHOLDER content: see header)
        // ---------------------------------------------------------------------------------

        private static PartData DieEjector() => new PartData
        {
            PartId = "PKG-Z1-EJT", PartName = "Die Ejector & Tape-Frame Stage", Zone = "Z1",
            Summary = "Holds the diced wafer on tape. Needles or a plunger push one die up so the flipper can pick it.",
            Steps =
            {
                new WorkStep("Keep clear", "Keep hands out of the frame-stage travel. Pinch points.", true),
                new WorkStep("Verify wafer map", "Confirm the frame ID and wafer map match the recipe before picking. Only known-good dies should be picked."),
                new WorkStep("Inspect ejector", "Inspect the ejector cap and needles for wear, chips or adhesive build-up."),
                new WorkStep("Tape vacuum", "Check that the ejector-cap vacuum holds the tape flat around the target die."),
                new WorkStep("Needle height", "Run the needle-rise calibration. Too high cracks thin dies; too low fails the pick."),
            },
            Telemetry =
            {
                Ch("Ejector-cap vacuum", "kPa", -70f, 2f, -80f, -60f, 1),
                Ch("Needle rise height", "µm", 350f, 5f, 330f, 370f, 0),
                Ch("Frame stage temp", "°C", 23f, 0.2f, 22f, 24f, 1),
            }
        };

        private static PartData BondHead() => new PartData
        {
            PartId = "PKG-Z2-BH", PartName = "Bond Head", Zone = "Z2",
            Summary = "Heated, force-controlled head. Thermocompression bonding (TCB) ramps to ~250–300 °C under force. Hybrid bonding places at room temperature with low force, then anneals the batch.",
            Steps =
            {
                new WorkStep("Hot surface", "The collet can be above 300 °C. Let it cool below 50 °C before touching.", true),
                new WorkStep("Collet inspection", "Inspect the collet face for particles or damage. One particle can cause a bond void."),
                new WorkStep("Planarity check", "Verify head-to-stage parallelism with pressure-sensitive film or the built-in tilt routine."),
                new WorkStep("Force calibration", "Calibrate the force sensor against the reference load cell across the recipe range."),
                new WorkStep("Collet change", "Fit the collet size for the recipe's die size and re-teach the pick height."),
            },
            Telemetry =
            {
                Ch("Head temperature", "°C", 300f, 1.5f, 290f, 310f, 1),
                Ch("Bond force", "N", 50f, 0.8f, 45f, 55f, 1),
                Ch("Head-stage parallelism", "µm", 1.0f, 0.3f, 0f, 2f, 2),
            }
        };

        private static PartData Vision() => new PartData
        {
            PartId = "PKG-Z2-VIS", PartName = "Dual Vision Alignment", Zone = "Z2",
            Summary = "The up-looking camera images the die's fiducials and the down-looking camera images the target site. Their offset drives sub-micron placement.",
            Steps =
            {
                new WorkStep("Clean optics", "Clean the camera windows with an approved lint-free wipe. Never touch the lenses."),
                new WorkStep("Offset calibration", "Run the camera-to-head offset calibration with the glass calibration die."),
                new WorkStep("Illumination", "Check ring-light intensity and recipe exposure. Poor contrast causes misalignment."),
                new WorkStep("Verify overlay", "Bond test dies and confirm post-bond overlay on the metrology tool."),
            },
            Telemetry =
            {
                Ch("Alignment offset X", "µm", 0f, 0.15f, -0.5f, 0.5f, 2),
                Ch("Alignment offset Y", "µm", 0f, 0.15f, -0.5f, 0.5f, 2),
                Ch("Rotation θ", "µrad", 0f, 2f, -5f, 5f, 1),
                Ch("Ring-light intensity", "%", 72f, 1f, 60f, 85f, 0),
            }
        };

        private static PartData BondStage() => new PartData
        {
            PartId = "PKG-Z3-STG", PartName = "Bond Stage & Heated Chuck", Zone = "Z3",
            Summary = "Vacuum chuck on a precision XY stage. Holds the target wafer or interposer at a controlled temperature during bonding.",
            Steps =
            {
                new WorkStep("Stage to load", "From the HMI, move the stage to LOAD, wait for motion to stop and let the chuck cool.", true),
                new WorkStep("Clean the chuck", "Wipe the chuck with an approved cleanroom wipe and IPA, centre outward."),
                new WorkStep("Vacuum leak-up", "Seal a test wafer and confirm the vacuum decay stays within spec over 60 s."),
                new WorkStep("Thermal uniformity", "Map chuck temperature with a thermocouple wafer and compare against spec."),
            },
            Telemetry =
            {
                Ch("Chuck temperature", "°C", 150f, 0.5f, 147f, 153f, 1),
                Ch("Chuck vacuum", "kPa", -85f, 1f, -90f, -80f, 1),
                Ch("Stage position error", "µm", 0f, 0.1f, -0.3f, 0.3f, 2),
            }
        };

        private static PartData PlasmaChamber() => new PartData
        {
            PartId = "PKG-Z4-PLS", PartName = "Plasma Activation Chamber", Zone = "Z4",
            Summary = "Cleans and activates bonding surfaces before hybrid bonding so dielectric-to-dielectric bonds form at room temperature.",
            Steps =
            {
                new WorkStep("RF off and interlocked", "Confirm RF power is OFF and the lid interlock is engaged before venting.", true),
                new WorkStep("Vent and open", "Vent to atmosphere with N2 and open the lid only when pressure reads ambient."),
                new WorkStep("Inspect", "Inspect the electrode and viewport for deposits or arcing marks."),
                new WorkStep("Gas and leak check", "Pump down, check process gas flows, and run the leak-up rate test."),
            },
            Telemetry =
            {
                Ch("RF power", "W", 300f, 5f, 280f, 320f, 0),
                Ch("Chamber pressure", "Pa", 30f, 1f, 25f, 35f, 1),
                Ch("N2 flow", "sccm", 50f, 1f, 45f, 55f, 0),
            }
        };

        private static PartData Dispenser() => new PartData
        {
            PartId = "PKG-Z4-DSP", PartName = "Underfill / NCF Dispenser", Zone = "Z4",
            Summary = "Dispenses capillary underfill around bonded dies to protect microbump joints. The TCB alternative is non-conductive film (NCF) applied before bonding.",
            Steps =
            {
                new WorkStep("Chemical PPE", "Underfill is an epoxy. Wear the PPE on the SDS and handle syringes only in the approved area.", true),
                new WorkStep("Thaw syringe", "Thaw the frozen syringe to room temperature per the datasheet before opening to avoid moisture."),
                new WorkStep("Purge and weigh", "Purge the needle and weigh test shots against the recipe shot weight."),
                new WorkStep("Needle height", "Calibrate needle height and offset to the die edge."),
                new WorkStep("Verify fill", "After cure, check fillet shape and scan for voids (C-SAM)."),
            },
            Telemetry =
            {
                Ch("Dispense pressure", "kPa", 200f, 3f, 185f, 215f, 0),
                Ch("Needle temperature", "°C", 60f, 0.5f, 57f, 63f, 1),
                Ch("Shot weight", "mg", 1.20f, 0.02f, 1.12f, 1.28f, 2),
            }
        };

        // ---------------------------------------------------------------------------------
        //  3D stack exhibit catalogue (learning points, no telemetry)
        // ---------------------------------------------------------------------------------

        private static PartData ExSubstrate() => new PartData
        {
            PartId = "PKG-X-SUB", PartName = "Organic Package Substrate", Zone = "Exhibit", StepLabel = "POINT",
            Summary = "Bottom of the package (exhibit not to scale).",
            Steps =
            {
                new WorkStep("What it is", "A multilayer laminate that fans signals out from fine silicon pitch to coarse board pitch."),
                new WorkStep("Board connection", "BGA solder balls, typically ~0.4–1.0 mm pitch, connect the package to the PCB."),
                new WorkStep("Watch for", "Warpage. A bending substrate strains bumps during reflow and can crack joints."),
            }
        };

        private static PartData ExInterposer() => new PartData
        {
            PartId = "PKG-X-INT", PartName = "Silicon Interposer (2.5D)", Zone = "Exhibit", StepLabel = "POINT",
            Summary = "Passive silicon bridge between the dies and the substrate.",
            Steps =
            {
                new WorkStep("What it is", "A silicon layer with very fine wiring that connects logic and memory side by side. This is 2.5D integration, a multichip module on an interposer."),
                new WorkStep("TSVs", "Through-silicon vias (copper, ~10 µm diameter) carry signals and power vertically down to the C4 bumps."),
                new WorkStep("C4 bumps", "Controlled-collapse solder bumps (~130–150 µm pitch) join the interposer to the substrate."),
            }
        };

        private static PartData ExLogicDie() => new PartData
        {
            PartId = "PKG-X-SOC", PartName = "Logic Die (SoC)", Zone = "Exhibit", StepLabel = "POINT",
            Summary = "The processor, flip-chip bonded face-down.",
            Steps =
            {
                new WorkStep("Microbumps", "Copper pillars with solder caps at ~40–55 µm pitch, joined by thermocompression bonding on this tool."),
                new WorkStep("Underfill", "Epoxy underfill fills the gap and shares thermal-expansion stress so joints don't fatigue."),
                new WorkStep("Why side by side", "Placing memory next to logic on the interposer gives a short, wide, fast connection."),
            }
        };

        private static PartData ExHbmBase() => new PartData
        {
            PartId = "PKG-X-HBB", PartName = "HBM Base (Logic) Die", Zone = "Exhibit", StepLabel = "POINT",
            Summary = "Bottom die of the high-bandwidth-memory stack.",
            Steps =
            {
                new WorkStep("Role", "Holds the interface logic (PHY) that talks to the processor across the interposer."),
                new WorkStep("Connections", "Microbumps go down to the interposer and TSVs go up into the DRAM dies above."),
            }
        };

        private static PartData ExDram() => new PartData
        {
            PartId = "PKG-X-HBM", PartName = "HBM DRAM Core Die", Zone = "Exhibit", StepLabel = "POINT",
            Summary = "One layer of the 3D memory stack (4 shown; production stacks are 8–16 high).",
            Steps =
            {
                new WorkStep("Thinned silicon", "Each die is thinned to roughly 30–50 µm so TSVs can pass all the way through."),
                new WorkStep("3D stacking", "Thousands of TSVs form a very wide, very short bus. That is where HBM's bandwidth comes from."),
                new WorkStep("Bonding options", "Microbump TCB with NCF or molded underfill, or hybrid Cu–Cu bonding (≤10 µm pitch) with no solder at all."),
                new WorkStep("Watch for", "Die warpage, voids and TSV misalignment. Overlay accuracy from Z2 vision is critical."),
            }
        };
    }
}
