// =====================================================================================
//  PhotolithographyARController.cs
//  MI-CHIPS: Mixed Immersion Cleanroom & Hardware Intelligence & Progression System
//  NSF Award #2606117
//
//  AR holographic photolithography tool trainer for Microsoft HoloLens 2.
//  What this script does:
//    1. Restores a persisted OpenXR spatial anchor, or scans for a QR marker on the
//       physical tool and creates and persists a new anchor once the pose is stable.
//    2. Positions and scales the virtual machine on that anchor.
//    3. Animates the exploded view: staggered Lerp along per-zone vectors driven by an
//       AnimationCurve, with the outer chassis fading to a transparent ghost.
//    4. Wires MRTK3 ray/pinch/poke selection on parts and spawns a VSU-branded
//       WorkInstructionCard with work instructions and simulated telemetry.
//
//  Requires: Mixed Reality OpenXR Plugin (1.10+), AR Foundation 5.x, MRTK3, TextMeshPro.
//  Scene setup: ARMarkerManager and ARAnchorManager must sit on the XR Origin (MRTK XR Rig).
//  Manifest capabilities: WebCam (QR detection) and SpatialPerception (anchors).
// =====================================================================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.MixedReality.OpenXR;   // ARMarkerManager, ARMarker, ARMarkersChangedEventArgs, XRAnchorStore, TransformMode
using MixedReality.Toolkit;            // StatefulInteractable
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.XR.ARFoundation;     // ARAnchorManager, ARAnchor
using UnityEngine.XR.ARSubsystems;     // TrackingState, TrackableId

namespace MICHIPS.Lithography
{
    /// <summary>High-level simulation state. Exposed read-only for UI and analytics.</summary>
    public enum SimState
    {
        Idle,
        ScanningForMarker,
        Locking,
        Anchored,
        Exploding,
        Exploded,
        Collapsing
    }

    /// <summary>One functional zone that moves outward in the exploded view.</summary>
    [Serializable]
    public class ExplodableSubAssembly
    {
        [Tooltip("Display/debug label, e.g. 'Z2 Projection Optics'.")]
        public string label;

        [Tooltip("Root transform of the zone. Should be a direct child of the 'Assemblies' node.")]
        public Transform root;

        [Tooltip("Explode direction in the PARENT's local space (normalized at runtime).")]
        public Vector3 explodeDirection = Vector3.up;

        [Tooltip("Explode distance in the parent's local units (metres when the model is at 1:1 scale).")]
        public float explodeDistance = 0.4f;

        [Tooltip("Delay before this zone starts moving on explode. Collapse plays the delays in reverse.")]
        [Min(0f)] public float staggerDelay = 0f;

        [NonSerialized] public Vector3 homeLocalPosition;
        [NonSerialized] public Vector3 startLocalPosition;

        public Vector3 ExplodedLocalPosition =>
            homeLocalPosition + explodeDirection.normalized * explodeDistance;
    }

    /// <summary>A clickable component that opens a work-instruction card.</summary>
    [Serializable]
    public class SelectablePart
    {
        [Tooltip("GameObject to make selectable. Must NOT be a parent or child of another selectable part.")]
        public GameObject target;

        [Tooltip("Part metadata: ID, name, steps, telemetry channels.")]
        public PhotolithographyPartData data;

        [NonSerialized] public StatefulInteractable interactable;
        [NonSerialized] public UnityAction clickHandler;
    }

    [Serializable] public class BoolEvent : UnityEvent<bool> { }
    [Serializable] public class StringEvent : UnityEvent<string> { }

    [DisallowMultipleComponent]
    public class PhotolithographyARController : MonoBehaviour
    {
        // ---------------------------------------------------------------------------------
        #region Inspector: XR managers & marker
        // ---------------------------------------------------------------------------------

        [Header("XR Managers (on the XR Origin / MRTK XR Rig)")]
        [SerializeField] private ARMarkerManager markerManager;
        [SerializeField] private ARAnchorManager anchorManager;

        [Header("Marker Recognition")]
        [Tooltip("Exact QR payload printed on the tool. Other QR codes are ignored.")]
        [SerializeField] private string expectedMarkerPayload = "MICHIPS-LITHO-01";

        [Tooltip("How long (s) the marker pose must stay within tolerance before the anchor locks.")]
        [SerializeField, Min(0f)] private float requiredStableSeconds = 1.0f;

        [Tooltip("Maximum pose drift (m) allowed during the stability window.")]
        [SerializeField, Min(0.001f)] private float stabilityTolerance = 0.01f;

        [Tooltip("Marker-local axis that is the QR code's surface normal (points out of the code). " +
                 "Check this once with an axis gizmo on the ARMarkerManager marker prefab.")]
        [SerializeField] private Vector3 markerNormalAxis = Vector3.up;

        [Tooltip("Flip the normal if the machine comes out facing backwards.")]
        [SerializeField] private bool flipMarkerNormal = false;

        [Tooltip("Offset (m) from the marker to the machine-model origin, in the gravity-aligned machine frame " +
                 "(x = right, y = up, z = machine front). Measure on the physical tool.")]
        [SerializeField] private Vector3 markerToMachinePositionOffset = new Vector3(0f, -1.1f, -0.6f);

        [Tooltip("Extra rotation (deg) applied after gravity alignment, for fine-tuning only.")]
        [SerializeField] private Vector3 markerToMachineEulerOffset = Vector3.zero;

        #endregion

        // ---------------------------------------------------------------------------------
        #region Inspector: Anchor persistence
        // ---------------------------------------------------------------------------------

        [Header("Spatial Anchor Persistence")]
        [SerializeField] private bool persistAnchor = true;
        [SerializeField] private string persistedAnchorName = "MICHIPS_LithoTool_01";
        [SerializeField, Min(0.5f)] private float subsystemTimeout = 5f;
        [SerializeField, Min(0.5f)] private float anchorTrackingTimeout = 5f;

        #endregion

        // ---------------------------------------------------------------------------------
        #region Inspector: Model
        // ---------------------------------------------------------------------------------

        [Header("Machine Model")]
        [Tooltip("Root of the holographic machine. Kept hidden until it's anchored.")]
        [SerializeField] private Transform machineRoot;

        [Tooltip("Uniform scale on the anchor. 1 = life-size overlay on the real tool.")]
        [SerializeField, Min(0.01f)] private float modelScale = 1f;

        [Tooltip("Optional prompt shown while scanning (e.g. 'Look at the QR code on the tool').")]
        [SerializeField] private GameObject scanPrompt;

        #endregion

        // ---------------------------------------------------------------------------------
        #region Inspector: Exploded view
        // ---------------------------------------------------------------------------------

        [Header("Exploded View")]
        [SerializeField] private List<ExplodableSubAssembly> subAssemblies = new List<ExplodableSubAssembly>();

        [SerializeField, Min(0.05f)] private float explodeDuration = 1.2f;

        [Tooltip("0..1 easing. A slight overshoot above 1 near the end gives a 'settle' feel.")]
        [SerializeField] private AnimationCurve explodeCurve = AnimationCurve.EaseInOut(0f, 0f, 1f, 1f);

        [Header("Chassis Ghosting")]
        [Tooltip("Outer skins/doors. Its renderers switch to the ghost material while exploded, and its colliders are disabled.")]
        [SerializeField] private Transform chassisRoot;

        [Tooltip("Transparent material (e.g. Graphics Tools/Standard in Fade mode, or URP Lit Transparent).")]
        [SerializeField] private Material chassisGhostMaterial;

        [Tooltip("Colour property on the ghost shader: '_Color' (Graphics Tools / Standard) or '_BaseColor' (URP Lit).")]
        [SerializeField] private string ghostColorProperty = "_Color";

        [SerializeField, Range(0f, 1f)] private float ghostAlpha = 0.15f;

        #endregion

        // ---------------------------------------------------------------------------------
        #region Inspector: Interaction & UI
        // ---------------------------------------------------------------------------------

        [Header("Part Selection & Work Instructions")]
        [SerializeField] private List<SelectablePart> selectableParts = new List<SelectablePart>();
        [SerializeField] private WorkInstructionCard workInstructionCardPrefab;

        [Tooltip("If true, parts can only be selected while the view is exploded (keeps novices on the guided flow).")]
        [SerializeField] private bool requireExplodedForSelection = true;

        #endregion

        // ---------------------------------------------------------------------------------
        #region Inspector: Events (analytics / progression hooks)
        // ---------------------------------------------------------------------------------

        [Header("Events")]
        public UnityEvent onAnchored = new UnityEvent();
        public BoolEvent onExplodedChanged = new BoolEvent();
        public StringEvent onPartSelected = new StringEvent();
        public UnityEvent onSelectionBlocked = new UnityEvent();

        #endregion

#if UNITY_EDITOR
        [Header("Editor Testing")]
        [Tooltip("In Play Mode with no device, place the model in front of the camera after 1 s.")]
        [SerializeField] private bool simulateMarkerInEditor = true;
#endif

        // ---------------------------------------------------------------------------------
        #region Runtime state
        // ---------------------------------------------------------------------------------

        public SimState State { get; private set; } = SimState.Idle;
        public bool IsExploded => State == SimState.Exploded || State == SimState.Exploding;

        private XRAnchorStore anchorStore;
        private ARAnchor currentAnchor;
        private Transform viewer;

        // Marker stability tracking
        private bool hasCandidatePose;
        private Pose candidatePose;
        private float candidateStableSince;

        // Explode animation
        private Coroutine explodeRoutine;

        // Chassis ghosting
        private Renderer[] chassisRenderers = Array.Empty<Renderer>();
        private Collider[] chassisColliders = Array.Empty<Collider>();
        private Material[][] chassisOriginalMaterials;
        private Material[][] chassisGhostMaterials;
        private MaterialPropertyBlock chassisBlock;
        private int ghostColorId;
        private Color ghostBaseColor = Color.white;
        private bool chassisGhosted;
        private float chassisAlpha = 1f;

        // UI
        private WorkInstructionCard activeCard;
        private ITelemetrySource telemetrySource = new SimulatedTelemetrySource();

        #endregion

        // =================================================================================
        #region Unity lifecycle
        // =================================================================================

        private void Awake()
        {
            viewer = Camera.main != null ? Camera.main.transform : null;

            // Cache home poses BEFORE anything moves, so collapse always returns to the authored layout.
            foreach (var sa in subAssemblies)
            {
                if (sa.root != null) sa.homeLocalPosition = sa.root.localPosition;
            }

            CacheChassis();
            WireSelectableParts();
        }

        private void OnEnable()
        {
            if (markerManager != null) markerManager.markersChanged += OnMarkersChanged;
        }

        private void OnDisable()
        {
            if (markerManager != null) markerManager.markersChanged -= OnMarkersChanged;
        }

        private void Start()
        {
            StartCoroutine(InitializeRoutine());
        }

        private void OnDestroy()
        {
            foreach (var p in selectableParts)
            {
                if (p.interactable != null && p.clickHandler != null)
                    p.interactable.OnClicked.RemoveListener(p.clickHandler);
            }
        }

        #endregion

        // =================================================================================
        #region 1. Initialization: restore persisted anchor or start QR scan
        // =================================================================================

        private IEnumerator InitializeRoutine()
        {
            SetMachineVisible(false);

            if (persistAnchor && anchorManager != null)
            {
                // The anchor subsystem can come up a few frames after Start.
                float t = 0f;
                while (anchorManager.subsystem == null && t < subsystemTimeout)
                {
                    t += Time.unscaledDeltaTime;
                    yield return null;
                }

                if (anchorManager.subsystem != null)
                {
                    // NOTE: in some newer Mixed Reality OpenXR Plugin versions this API is
                    // superseded by XRAnchorStore.LoadAsync(...). Swap it in if the compiler warns.
                    Task<XRAnchorStore> loadTask = XRAnchorStore.LoadAnchorStoreAsync(anchorManager.subsystem);
                    while (!loadTask.IsCompleted) yield return null;

                    if (loadTask.Status == TaskStatus.RanToCompletion)
                        anchorStore = loadTask.Result;
                    else
                        Debug.LogWarning($"[MI-CHIPS] Anchor store failed to load: {loadTask.Exception?.GetBaseException().Message}");
                }

                if (anchorStore != null && anchorStore.PersistedAnchorNames.Contains(persistedAnchorName))
                {
                    bool restored = false;
                    yield return RestorePersistedAnchor(result => restored = result);
                    if (restored) yield break;

                    Debug.Log("[MI-CHIPS] Persisted anchor could not be located here; falling back to QR scan.");
                }
            }

#if UNITY_EDITOR
            // Editor Play Mode has no QR tracking. Turn this off when testing over Holographic Remoting.
            if (simulateMarkerInEditor)
            {
                yield return new WaitForSeconds(1f);
                DebugSimulateMarker();
                yield break;
            }
#endif
            BeginMarkerScan();
        }

        private IEnumerator RestorePersistedAnchor(Action<bool> onComplete)
        {
            TrackableId id = anchorStore.LoadAnchor(persistedAnchorName);
            if (id == TrackableId.invalidId)
            {
                onComplete(false);
                yield break;
            }

            // ARAnchorManager creates the ARAnchor GameObject asynchronously. Wait for it to track.
            ARAnchor anchor = null;
            float t = 0f;
            while (t < anchorTrackingTimeout)
            {
                anchor = anchorManager.GetAnchor(id);
                if (anchor != null && anchor.trackingState == TrackingState.Tracking) break;
                t += Time.unscaledDeltaTime;
                yield return null;
            }

            if (anchor == null || anchor.trackingState != TrackingState.Tracking)
            {
                onComplete(false);
                yield break;
            }

            currentAnchor = anchor;
            AttachMachineToAnchor(anchor.transform);
            SetState(SimState.Anchored);
            onAnchored.Invoke();
            Debug.Log($"[MI-CHIPS] Restored persisted anchor '{persistedAnchorName}'.");
            onComplete(true);
        }

        #endregion

        // =================================================================================
        #region 2. QR marker detection & stability gating
        // =================================================================================

        private void BeginMarkerScan()
        {
            hasCandidatePose = false;

            if (markerManager == null)
            {
                Debug.LogError("[MI-CHIPS] No ARMarkerManager assigned; cannot scan for the tool marker.");
                return;
            }

            // Report the QR centre (not the top-left corner) so the offset is measured from the code's middle.
            markerManager.defaultTransformMode = TransformMode.Center;
            markerManager.enabled = true;

            if (scanPrompt != null) scanPrompt.SetActive(true);
            SetState(SimState.ScanningForMarker);
        }

        private void OnMarkersChanged(ARMarkersChangedEventArgs args)
        {
            if (State != SimState.ScanningForMarker) return;

            // Treat added and updated the same way. Either can bring the pose we need.
            foreach (ARMarker marker in args.added) EvaluateMarker(marker);
            foreach (ARMarker marker in args.updated) EvaluateMarker(marker);
        }

        private void EvaluateMarker(ARMarker marker)
        {
            if (State != SimState.ScanningForMarker) return;
            if (marker.trackingState != TrackingState.Tracking) return;
            if (!string.Equals(marker.GetDecodedString(), expectedMarkerPayload, StringComparison.Ordinal)) return;

            Pose pose = ComputeMachinePose(marker.transform);

            // Only accept the pose once it has held steady for requiredStableSeconds.
            // That filters out the first jittery frames after detection.
            if (!hasCandidatePose || Vector3.Distance(pose.position, candidatePose.position) > stabilityTolerance)
            {
                hasCandidatePose = true;
                candidatePose = pose;
                candidateStableSince = Time.time;
                return;
            }

            // Smooth toward the latest reading while it's stable.
            candidatePose = new Pose(
                Vector3.Lerp(candidatePose.position, pose.position, 0.3f),
                Quaternion.Slerp(candidatePose.rotation, pose.rotation, 0.3f));

            if (Time.time - candidateStableSince >= requiredStableSeconds)
            {
                StartCoroutine(LockAnchorRoutine(candidatePose));
            }
        }

        /// <summary>
        /// Converts the QR pose into a gravity-aligned machine pose. The tool stands upright,
        /// so only the yaw comes from the marker. That removes tilt noise from QR tracking.
        /// </summary>
        private Pose ComputeMachinePose(Transform marker)
        {
            Vector3 normal = marker.rotation * markerNormalAxis.normalized;
            if (flipMarkerNormal) normal = -normal;

            // The marker normal (pointing out of the tool's front panel) becomes the machine's +Z.
            Vector3 forward = Vector3.ProjectOnPlane(normal, Vector3.up);
            if (forward.sqrMagnitude < 1e-4f)
            {
                // Marker is lying flat (normal is vertical), so use its in-plane forward axis for yaw.
                forward = Vector3.ProjectOnPlane(marker.forward, Vector3.up);
            }

            Quaternion rotation = Quaternion.LookRotation(forward.normalized, Vector3.up)
                                  * Quaternion.Euler(markerToMachineEulerOffset);
            Vector3 position = marker.position + rotation * markerToMachinePositionOffset;
            return new Pose(position, rotation);
        }

        #endregion

        // =================================================================================
        #region 3. Anchor creation & persistence
        // =================================================================================

        private IEnumerator LockAnchorRoutine(Pose pose)
        {
            SetState(SimState.Locking);

            // Stop QR scanning. It keeps the PV camera running and costs battery and thermal headroom.
            if (markerManager != null) markerManager.enabled = false;
            if (scanPrompt != null) scanPrompt.SetActive(false);

            ClearCurrentAnchor();

            var anchorGO = new GameObject("MI-CHIPS_LithoAnchor");
            anchorGO.transform.SetPositionAndRotation(pose.position, pose.rotation);
            currentAnchor = anchorGO.AddComponent<ARAnchor>(); // registers with ARAnchorManager

            float t = 0f;
            while ((currentAnchor.pending || currentAnchor.trackingState != TrackingState.Tracking)
                   && t < anchorTrackingTimeout)
            {
                t += Time.unscaledDeltaTime;
                yield return null;
            }

            if (currentAnchor.trackingState != TrackingState.Tracking)
            {
                Debug.LogWarning("[MI-CHIPS] Anchor did not reach Tracking; re-scanning.");
                ClearCurrentAnchor();
                BeginMarkerScan();
                yield break;
            }

            AttachMachineToAnchor(currentAnchor.transform);

            if (persistAnchor && anchorStore != null)
            {
                if (anchorStore.PersistedAnchorNames.Contains(persistedAnchorName))
                    anchorStore.UnpersistAnchor(persistedAnchorName);

                bool ok = anchorStore.TryPersistAnchor(currentAnchor.trackableId, persistedAnchorName);
                Debug.Log(ok
                    ? $"[MI-CHIPS] Anchor persisted as '{persistedAnchorName}'."
                    : "[MI-CHIPS] Anchor persist failed; the tool will need a re-scan next session.");
            }

            SetState(SimState.Anchored);
            onAnchored.Invoke();
        }

        private void AttachMachineToAnchor(Transform anchor)
        {
            machineRoot.SetParent(anchor, worldPositionStays: false);
            machineRoot.localPosition = Vector3.zero;
            machineRoot.localRotation = Quaternion.identity;
            machineRoot.localScale = Vector3.one * modelScale;
            SetMachineVisible(true);
        }

        private void ClearCurrentAnchor()
        {
            if (currentAnchor == null) return;
            if (machineRoot != null && machineRoot.parent == currentAnchor.transform)
                machineRoot.SetParent(null, worldPositionStays: true);
            Destroy(currentAnchor.gameObject); // removing the ARAnchor releases the native anchor
            currentAnchor = null;
        }

        #endregion

        // =================================================================================
        #region 4. Exploded-view animation
        // =================================================================================

        /// <summary>Toggle exploded view. Bind to a hand-menu button or a voice command.</summary>
        public void ToggleExploded() => SetExploded(!IsExploded);

        /// <summary>Explode (true) or collapse (false). Safe to call mid-animation; it reverses smoothly from the current pose.</summary>
        public void SetExploded(bool explode)
        {
            if (State < SimState.Anchored)
            {
                Debug.Log("[MI-CHIPS] Ignoring explode request: machine not anchored yet.");
                return;
            }
            if (explode == IsExploded) return; // already heading that way (Exploding counts as exploded)

            if (explodeRoutine != null) StopCoroutine(explodeRoutine);
            if (!explode) CloseActiveCard();
            explodeRoutine = StartCoroutine(ExplodeRoutine(explode));
        }

        private IEnumerator ExplodeRoutine(bool explode)
        {
            SetState(explode ? SimState.Exploding : SimState.Collapsing);
            onExplodedChanged.Invoke(explode);

            // Ghost the chassis first so the internals are visible as they move out.
            if (explode) SetChassisGhosted(true);

            float maxStagger = 0f;
            foreach (var sa in subAssemblies)
            {
                if (sa.root == null) continue;
                sa.startLocalPosition = sa.root.localPosition; // start from wherever we are now (supports reversal)
                maxStagger = Mathf.Max(maxStagger, sa.staggerDelay);
            }

            float alphaFrom = chassisAlpha;
            float alphaTo = explode ? ghostAlpha : 1f;
            float total = explodeDuration + maxStagger;
            float elapsed = 0f;

            while (elapsed < total)
            {
                elapsed += Time.deltaTime;

                foreach (var sa in subAssemblies)
                {
                    if (sa.root == null) continue;

                    // On collapse, reverse the stagger order: last out, first back.
                    float delay = explode ? sa.staggerDelay : (maxStagger - sa.staggerDelay);
                    float u = Mathf.Clamp01((elapsed - delay) / explodeDuration);
                    float eased = explodeCurve.Evaluate(u);

                    Vector3 target = explode ? sa.ExplodedLocalPosition : sa.homeLocalPosition;
                    sa.root.localPosition = Vector3.LerpUnclamped(sa.startLocalPosition, target, eased);
                }

                float a = explodeCurve.Evaluate(Mathf.Clamp01(elapsed / explodeDuration));
                SetChassisAlpha(Mathf.Lerp(alphaFrom, alphaTo, a));

                yield return null;
            }

            // Snap to exact end values to avoid float drift across many toggles.
            foreach (var sa in subAssemblies)
            {
                if (sa.root == null) continue;
                sa.root.localPosition = explode ? sa.ExplodedLocalPosition : sa.homeLocalPosition;
            }
            SetChassisAlpha(alphaTo);
            if (!explode) SetChassisGhosted(false);

            SetState(explode ? SimState.Exploded : SimState.Anchored);
            explodeRoutine = null;
        }

        private void SnapCollapsed()
        {
            if (explodeRoutine != null) { StopCoroutine(explodeRoutine); explodeRoutine = null; }
            foreach (var sa in subAssemblies)
                if (sa.root != null) sa.root.localPosition = sa.homeLocalPosition;
            SetChassisAlpha(1f);
            SetChassisGhosted(false);
        }

        #endregion

        // =================================================================================
        #region 4b. Chassis transparency
        // =================================================================================

        private void CacheChassis()
        {
            chassisBlock = new MaterialPropertyBlock();
            ghostColorId = Shader.PropertyToID(ghostColorProperty);

            if (chassisRoot == null) return;

            chassisRenderers = chassisRoot.GetComponentsInChildren<Renderer>(includeInactive: true);
            chassisColliders = chassisRoot.GetComponentsInChildren<Collider>(includeInactive: true);

            if (chassisGhostMaterial != null && chassisGhostMaterial.HasProperty(ghostColorId))
                ghostBaseColor = chassisGhostMaterial.GetColor(ghostColorId);

            chassisOriginalMaterials = new Material[chassisRenderers.Length][];
            chassisGhostMaterials = new Material[chassisRenderers.Length][];
            for (int i = 0; i < chassisRenderers.Length; i++)
            {
                Material[] original = chassisRenderers[i].sharedMaterials;
                chassisOriginalMaterials[i] = original;
                chassisGhostMaterials[i] = Enumerable.Repeat(chassisGhostMaterial, original.Length).ToArray();
            }
        }

        /// <summary>Swap between the authored opaque materials and the shared transparent ghost material.</summary>
        private void SetChassisGhosted(bool ghosted)
        {
            if (chassisGhosted == ghosted || chassisGhostMaterial == null) return;
            chassisGhosted = ghosted;

            for (int i = 0; i < chassisRenderers.Length; i++)
            {
                chassisRenderers[i].sharedMaterials = ghosted ? chassisGhostMaterials[i] : chassisOriginalMaterials[i];
                if (!ghosted) chassisRenderers[i].SetPropertyBlock(null);
            }

            // Disable chassis colliders while ghosted so hand rays reach the internal parts.
            foreach (var c in chassisColliders) c.enabled = !ghosted;
        }

        private void SetChassisAlpha(float alpha)
        {
            chassisAlpha = alpha;
            if (!chassisGhosted) return;

            Color c = ghostBaseColor;
            c.a = alpha;
            chassisBlock.SetColor(ghostColorId, c);
            foreach (var r in chassisRenderers) r.SetPropertyBlock(chassisBlock);
        }

        #endregion

        // =================================================================================
        #region 5. MRTK3 part selection & work-instruction UI
        // =================================================================================

        /// <summary>
        /// Gives every selectable part a collider and an MRTK3 StatefulInteractable, then
        /// subscribes to OnClicked. OnClicked fires for far-ray pinch, near poke and gaze-pinch.
        /// Authoring these components on the prefab is preferred; this is a safety net.
        /// </summary>
        private void WireSelectableParts()
        {
            foreach (var part in selectableParts)
            {
                if (part.target == null || part.data == null) continue;

                // The collider must exist BEFORE the interactable is added: XRI collects colliders in Awake.
                if (part.target.GetComponentInChildren<Collider>() == null)
                    FitBoxCollider(part.target);

                StatefulInteractable si = part.target.GetComponent<StatefulInteractable>();
                if (si == null) si = part.target.AddComponent<StatefulInteractable>();

                SelectablePart captured = part; // closure capture per iteration
                part.interactable = si;
                part.clickHandler = () => OnPartClicked(captured);
                si.OnClicked.AddListener(part.clickHandler);
            }
        }

        private void OnPartClicked(SelectablePart part)
        {
            if (requireExplodedForSelection && State != SimState.Exploded)
            {
                onSelectionBlocked.Invoke(); // e.g. play a tooltip: "Open the exploded view first"
                return;
            }

            CloseActiveCard();

            if (workInstructionCardPrefab == null)
            {
                Debug.LogError("[MI-CHIPS] WorkInstructionCard prefab not assigned.");
                return;
            }

            activeCard = Instantiate(workInstructionCardPrefab);
            activeCard.Closed += HandleCardClosed;
            activeCard.Show(part.data, part.target.transform, viewer, telemetrySource);

            onPartSelected.Invoke(part.data.partId);
        }

        private void HandleCardClosed(WorkInstructionCard card)
        {
            card.Closed -= HandleCardClosed;
            if (activeCard == card) activeCard = null;
        }

        public void CloseActiveCard()
        {
            if (activeCard != null) activeCard.Close();
            activeCard = null;
        }

        /// <summary>Swap in a live data bridge (MQTT, OPC UA, etc.) without touching the UI.</summary>
        public void SetTelemetrySource(ITelemetrySource source)
        {
            telemetrySource = source ?? new SimulatedTelemetrySource();
        }

        #endregion

        // =================================================================================
        #region Public utilities
        // =================================================================================

        /// <summary>Recalibrate: drop the anchor, forget the persisted copy and re-scan the QR code.</summary>
        public void ResetAndRescan()
        {
            StopAllCoroutines();
            explodeRoutine = null;
            CloseActiveCard();
            SnapCollapsed();
            ClearPersistedAnchor();
            ClearCurrentAnchor();
            SetMachineVisible(false);
            BeginMarkerScan();
        }

        public void ClearPersistedAnchor()
        {
            if (anchorStore != null && anchorStore.PersistedAnchorNames.Contains(persistedAnchorName))
                anchorStore.UnpersistAnchor(persistedAnchorName);
        }

        [ContextMenu("Debug: Simulate Marker (1.5 m in front of camera)")]
        private void DebugSimulateMarker()
        {
            if (viewer == null) viewer = Camera.main != null ? Camera.main.transform : transform;

            Vector3 fwd = Vector3.ProjectOnPlane(viewer.forward, Vector3.up).normalized;
            if (fwd.sqrMagnitude < 1e-4f) fwd = Vector3.forward;

            // Machine front faces the viewer.
            var pose = new Pose(viewer.position + fwd * 1.5f + Vector3.down * 1.4f,
                                Quaternion.LookRotation(-fwd, Vector3.up));

            var anchorGO = new GameObject("MI-CHIPS_EditorAnchor");
            anchorGO.transform.SetPositionAndRotation(pose.position, pose.rotation);
            if (scanPrompt != null) scanPrompt.SetActive(false);
            AttachMachineToAnchor(anchorGO.transform);
            SetState(SimState.Anchored);
            onAnchored.Invoke();
        }

        [ContextMenu("Debug: Toggle Exploded")]
        private void DebugToggleExploded() => ToggleExploded();

        #endregion

        // =================================================================================
        #region Helpers
        // =================================================================================

        private void SetState(SimState next)
        {
            if (State == next) return;
            Debug.Log($"[MI-CHIPS] State {State} -> {next}");
            State = next;
        }

        private void SetMachineVisible(bool visible)
        {
            if (machineRoot != null) machineRoot.gameObject.SetActive(visible);
        }

        /// <summary>Adds a BoxCollider fitted to all child renderers, in the target's local space.</summary>
        private static void FitBoxCollider(GameObject target)
        {
            Renderer[] renderers = target.GetComponentsInChildren<Renderer>(includeInactive: true);
            var box = target.AddComponent<BoxCollider>();
            if (renderers.Length == 0) return;

            Transform tf = target.transform;
            bool init = false;
            Bounds local = default;
            foreach (var r in renderers)
            {
                Bounds wb = r.bounds;
                // Transform all 8 corners so rotated children are enclosed correctly.
                for (int i = 0; i < 8; i++)
                {
                    Vector3 corner = wb.center + Vector3.Scale(wb.extents, new Vector3(
                        (i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                    Vector3 lp = tf.InverseTransformPoint(corner);
                    if (!init) { local = new Bounds(lp, Vector3.zero); init = true; }
                    else local.Encapsulate(lp);
                }
            }
            box.center = local.center;
            box.size = local.size;
        }

        #endregion
    }
}
