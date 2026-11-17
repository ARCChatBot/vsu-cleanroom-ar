// =====================================================================================
//  EquipmentARController.cs
//  MI-CHIPS: Mixed Immersion Cleanroom & Hardware Intelligence & Progression System
//  NSF Award #2606117
//
//  Generic AR equipment trainer for Microsoft HoloLens 2 (StereoKit / OpenXR).
//  It runs any EquipmentDefinition (photolithography, advanced packaging, ...):
//    1. Restores a persisted spatial anchor, or scans for the tool's QR marker and
//       creates and persists a new anchor once the marker pose is stable.
//    2. Positions and scales the holographic machine on that anchor every frame.
//    3. Drives the exploded view (staggered, eased, reversible) and chassis ghosting.
//    4. Hit-tests hand rays. A pinch on a part opens a VSU-branded WorkInstructionCard.
//    5. Raises events for analytics and progression (xAPI / LRS).
//
//  Stepped once per frame by TrainerHost.
// =====================================================================================

using System;
using System.IO;
using StereoKit;

namespace MiChips.Cleanroom
{
    public enum SimState
    {
        Idle,
        RestoringAnchor,
        ScanningForMarker,
        Locking,
        Anchored,
        Exploding,
        Exploded,
        Collapsing,
    }

    public sealed class ControllerConfig
    {
        /// <summary>Exact QR payload printed on the tool. Other QR codes are ignored.</summary>
        public string MarkerPayload = "MICHIPS-TOOL";

        /// <summary>How long (s) the marker pose must hold within tolerance before the anchor locks.</summary>
        public float RequiredStableSeconds = 1.0f;
        /// <summary>Maximum drift (m) allowed during the stability window.</summary>
        public float StabilityTolerance = 0.01f;

        /// <summary>
        /// Offset (m) from the QR centre to the machine origin (floor centre), in the machine frame:
        /// +X right, +Y up, +Z machine front. Measure this on the real tool.
        /// </summary>
        public Vec3 MarkerToMachineOffset = new Vec3(0f, -1.2f, -0.65f);
        /// <summary>Extra yaw (deg) for fine alignment.</summary>
        public float YawOffsetDegrees = 0f;

        /// <summary>1 = life-size overlay on the real tool. Use e.g. 0.25 for a tabletop model.</summary>
        public float ModelScale = 1f;

        public bool PersistAnchor = true;
        public string AnchorFileName = "tool_anchor.txt";
        public float AnchorRestoreTimeout = 5f;
        public float AnchorTrackingTimeout = 5f;

        /// <summary>Parts are selectable only while exploded (chassis ghosted). Keeps novices on the guided flow.</summary>
        public bool RequireExplodedForSelection = true;

        /// <summary>Folder with optional per-part CAD overrides: &lt;PartId&gt;.glb</summary>
        public string ModelsFolder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "Models");
    }

    public sealed class EquipmentARController
    {
        // ---- Events (bind to analytics / progression) ----
        public event Action Anchored;
        public event Action<bool> ExplodedChanged;
        public event Action<string> PartSelected;
        public event Action<string, int> StepChanged;
        public event Action SelectionBlocked;
        /// <summary>Trainee pressed "Switch equipment". The host unloads this controller.</summary>
        public event Action SwitchRequested;

        public EquipmentDefinition Equipment { get; }
        public SimState State { get; private set; } = SimState.Idle;
        public bool IsExploded => State == SimState.Exploding || State == SimState.Exploded;
        public MachineModel Model => model;

        private readonly IMarkerSource markers;
        private readonly ControllerConfig cfg;
        private readonly AnchorService anchors;
        private ITelemetrySource telemetry = new SimulatedTelemetrySource();

        private MachineModel model;
        private Anchor anchor;          // null in the simulator (no anchor support) → fixedPose is used
        private Pose fixedPose;
        private float stateTimer;

        // Marker stability
        private bool hasCandidate;
        private Pose candidate;
        private float candidateStableFor;

        // Interaction / UI
        private MachinePart hovered;
        private WorkInstructionCard card;
        private Pose panelPose;
        private float toastUntil;
        private string toast;

        public EquipmentARController(EquipmentDefinition equipment, IMarkerSource markerSource, ControllerConfig config = null)
        {
            Equipment = equipment ?? throw new ArgumentNullException(nameof(equipment));
            markers = markerSource ?? throw new ArgumentNullException(nameof(markerSource));
            cfg = config ?? equipment.CreateConfig();
            anchors = new AnchorService(cfg.AnchorFileName);
        }

        // =================================================================================
        #region Lifecycle
        // =================================================================================

        public void Initialize()
        {
            model = Equipment.BuildModel(cfg.ModelsFolder);

            Pose head = Input.Head;
            Vec3 panelPos = head.position + head.Forward * 0.6f + head.Right * -0.25f;
            panelPose = new Pose(panelPos, Quat.LookAt(panelPos, head.position));

            if (cfg.PersistAnchor && anchors.HasSavedAnchor) SetState(SimState.RestoringAnchor);
            else BeginMarkerScan();
        }

        public void Step()
        {
            float dt = Time.Stepf;
            stateTimer += dt;

            switch (State)
            {
                case SimState.RestoringAnchor:   StepRestore(); break;
                case SimState.ScanningForMarker: StepScan(dt); break;
                case SimState.Locking:           StepLock(); break;
            }

            if (State >= SimState.Anchored)
            {
                model.Update(dt);
                SyncExplodeState();

                Pose root = anchor != null ? anchor.Pose : fixedPose; // anchors can be re-localised by the runtime
                Matrix rootM = Matrix.TRS(root.position, root.orientation, Vec3.One * cfg.ModelScale);

                model.Draw(rootM, hovered, card?.Part); // also refreshes part World matrices
                HandleSelection();

                if (card != null)
                {
                    card.Draw();
                    if (!card.IsOpen) card = null;
                }

                if (Input.Key(Key.E).IsJustActive()) ToggleExploded(); // desktop shortcut
            }

            DrawControlPanel();
        }

        public void Shutdown()
        {
            card = null;
            markers.Stop();
        }

        #endregion

        // =================================================================================
        #region 1. Anchor restore
        // =================================================================================

        private void StepRestore()
        {
            // Persisted anchors can take a few frames to load and localise after launch.
            Anchor saved = anchors.FindSaved();
            if (saved != null && saved.Tracked.IsActive())
            {
                anchor = saved;
                Log.Info($"[MI-CHIPS] {Equipment.Id}: restored persisted anchor.");
                EnterAnchored();
                return;
            }

            if (stateTimer > cfg.AnchorRestoreTimeout)
            {
                Log.Info($"[MI-CHIPS] {Equipment.Id}: persisted anchor not found here; falling back to QR scan.");
                BeginMarkerScan();
            }
        }

        #endregion

        // =================================================================================
        #region 2. QR marker scan & stability gating
        // =================================================================================

        private void BeginMarkerScan()
        {
            hasCandidate = false;
            markers.Start();
            SetState(SimState.ScanningForMarker);
        }

        private void StepScan(float dt)
        {
            if (!markers.TryGetMarker(cfg.MarkerPayload, out MarkerObservation obs)) return;

            Lines.AddAxis(obs.CenterPose, 0.08f); // visual confirmation (and a quick way to check the axis convention)
            Pose pose = ComputeMachinePose(obs.CenterPose);

            // Only lock once the pose has held steady. That filters out the jittery first frames after detection.
            if (!hasCandidate || Vec3.Distance(pose.position, candidate.position) > cfg.StabilityTolerance)
            {
                hasCandidate = true;
                candidate = pose;
                candidateStableFor = 0;
                return;
            }

            candidate = new Pose(Vec3.Lerp(candidate.position, pose.position, 0.3f),
                                 Quat.Slerp(candidate.orientation, pose.orientation, 0.3f));
            candidateStableFor += dt;

            if (candidateStableFor >= cfg.RequiredStableSeconds) BeginLock(candidate);
        }

        /// <summary>
        /// Converts the marker's centre pose into a gravity-aligned machine pose. Tools stand
        /// upright, so only yaw comes from the marker. That removes QR tilt noise.
        /// </summary>
        private Pose ComputeMachinePose(Pose marker)
        {
            // Convention (see Markers.cs): marker local -Z is the outward normal, out of the tool's front.
            Vec3 front = marker.orientation * -Vec3.UnitZ;
            front.y = 0;
            if (front.LengthSq < 1e-4f)
            {
                // Marker is lying flat on a horizontal surface, so use its "up" edge for yaw instead.
                front = marker.orientation * Vec3.UnitY; front.y = 0;
            }
            front = front.Normalized;

            // FromAngles(0, θ, 0) rotates +Z to (sin θ, 0, cos θ), so θ = atan2(x, z) puts the machine's +Z on 'front'.
            float yaw = (float)(Math.Atan2(front.x, front.z) * 180.0 / Math.PI) + cfg.YawOffsetDegrees;
            Quat rot = Quat.FromAngles(0, yaw, 0);
            Vec3 pos = marker.position + rot * (cfg.MarkerToMachineOffset * cfg.ModelScale);
            return new Pose(pos, rot);
        }

        #endregion

        // =================================================================================
        #region 3. Anchor creation & persistence
        // =================================================================================

        private void BeginLock(Pose pose)
        {
            ReleaseAnchor();
            fixedPose = pose;
            anchor = anchors.Create(pose);
            SetState(SimState.Locking);

            if (anchor == null)
            {
                // Simulator or runtime without anchors: keep the fixed world pose.
                Log.Info("[MI-CHIPS] Anchors unavailable; using a fixed world pose.");
                EnterAnchored();
            }
        }

        private void StepLock()
        {
            if (anchor.Tracked.IsActive())
            {
                if (cfg.PersistAnchor)
                {
                    bool ok = anchors.Persist(anchor);
                    Log.Info(ok ? "[MI-CHIPS] Anchor persisted."
                                : "[MI-CHIPS] Anchor not persisted; the tool will need a re-scan next session.");
                }
                EnterAnchored();
            }
            else if (stateTimer > cfg.AnchorTrackingTimeout)
            {
                Log.Warn("[MI-CHIPS] Anchor never reached tracking; re-scanning.");
                ReleaseAnchor();
                BeginMarkerScan();
            }
        }

        private void EnterAnchored()
        {
            markers.Stop(); // the QR watcher keeps the PV camera on, which costs battery and thermal headroom
            model.SnapCollapsed();
            SetState(SimState.Anchored);
            Anchored?.Invoke();
        }

        private void ReleaseAnchor()
        {
            // We drop our reference; persisted anchors stay in the store until Forget().
            anchor = null;
        }

        #endregion

        // =================================================================================
        #region 4. Exploded view
        // =================================================================================

        public void ToggleExploded() => SetExploded(!IsExploded);

        public void SetExploded(bool explode)
        {
            if (State < SimState.Anchored || explode == IsExploded) return;
            if (!explode) card = null;
            model.SetExploded(explode);
            SetState(explode ? SimState.Exploding : SimState.Collapsing);
            ExplodedChanged?.Invoke(explode);
        }

        private void SyncExplodeState()
        {
            if (model.IsAnimating) return;
            if (State == SimState.Exploding) SetState(SimState.Exploded);
            else if (State == SimState.Collapsing) SetState(SimState.Anchored);
        }

        #endregion

        // =================================================================================
        #region 5. Hand-ray selection & work-instruction cards
        // =================================================================================

        private void HandleSelection()
        {
            hovered = null;
            bool uiBusy = UI.IsInteracting(Handed.Left) || UI.IsInteracting(Handed.Right);
            bool selectable = (!cfg.RequireExplodedForSelection || State == SimState.Exploded) && model.ChassisGhosted;

            int count = Input.PointerCount(InputSource.Hand);
            for (int i = 0; i < count; i++)
            {
                Pointer p = Input.Pointer(i, InputSource.Hand);
                if (!p.tracked.IsActive()) continue;

                MachinePart hit = model.Raycast(p.ray);
                if (hit == null) continue;
                if (selectable) hovered = hit;

                if (p.state.IsJustActive() && !uiBusy) // pinch / air-tap
                {
                    if (selectable) OpenCard(hit);
                    else
                    {
                        ShowToast("Open the exploded view to inspect parts");
                        SelectionBlocked?.Invoke();
                    }
                }
            }
        }

        private void OpenCard(MachinePart part)
        {
            if (card != null && card.Part == part) return;
            card = new WorkInstructionCard(part, telemetry);
            card.StepChanged += (id, step) => StepChanged?.Invoke(id, step);
            PartSelected?.Invoke(part.Data.PartId);
        }

        /// <summary>Swap in a live data bridge (MQTT, OPC UA, etc.) without touching the UI.</summary>
        public void SetTelemetrySource(ITelemetrySource source) => telemetry = source ?? new SimulatedTelemetrySource();

        #endregion

        // =================================================================================
        #region Control panel & utilities
        // =================================================================================

        private void DrawControlPanel()
        {
            UI.WindowBegin("MI-CHIPS  |  " + Equipment.DisplayName, ref panelPose, new Vec2(0.28f, 0));

            UI.PushTextStyle(Brand.OrangeText);
            UI.Label(StatusText());
            UI.PopTextStyle();

            if (State == SimState.ScanningForMarker)
            {
                UI.Text("Look at the QR code on the tool's front panel and hold still.");
                if (markers is SimulatedMarkerSource sim && UI.Button("Simulate marker (M)"))
                    sim.PlaceInFrontOfHead();
            }

            if (State >= SimState.Anchored)
            {
                if (UI.Button(IsExploded ? "Collapse view (E)" : "Explode view (E)")) ToggleExploded();
                UI.SameLine();
                if (UI.Button("Recalibrate")) ResetAndRescan();
                UI.Text(IsExploded ? "Pinch a part to open its card."
                                   : "Explode the view to see inside the tool.");
            }

            if (Time.Totalf < toastUntil) UI.Label(toast);

            UI.HSeparator();
            bool switchPressed = UI.Button("Switch equipment");
            UI.WindowEnd();

            if (switchPressed) SwitchRequested?.Invoke(); // after WindowEnd so the UI stack stays balanced
        }

        private string StatusText()
        {
            switch (State)
            {
                case SimState.RestoringAnchor:   return "Locating saved position...";
                case SimState.ScanningForMarker: return "Scanning for tool marker";
                case SimState.Locking:           return "Locking spatial anchor...";
                case SimState.Anchored:          return "Anchored";
                case SimState.Exploding:
                case SimState.Exploded:          return "Exploded view";
                case SimState.Collapsing:        return "Collapsing...";
                default:                         return "Starting...";
            }
        }

        private void ShowToast(string message)
        {
            toast = message;
            toastUntil = Time.Totalf + 2.5f;
        }

        /// <summary>Recalibrate: forget the persisted anchor and re-scan the QR code (tool or marker moved).</summary>
        public void ResetAndRescan()
        {
            card = null;
            model.SnapCollapsed();
            anchors.Forget(anchor);
            ReleaseAnchor();
            BeginMarkerScan();
        }

        private void SetState(SimState next)
        {
            if (State == next) return;
            Log.Info($"[MI-CHIPS] {Equipment.Id}: {State} -> {next}");
            State = next;
            stateTimer = 0;
        }

        #endregion
    }
}
