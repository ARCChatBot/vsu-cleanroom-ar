// =====================================================================================
//  WorkInstructionCard.cs
//  MI-CHIPS (NSF #2606117): floating, VSU-branded HMI card for a selected tool part.
//
//  Prefab setup (world-space Canvas, ~0.32 m wide; Canvas scale 0.001 with 320 px width):
//    Card (this script, Canvas, CanvasScaler, TrackedDeviceGraphicRaycaster)
//    ├── Backplate         Image  → add to trojanBlueGraphics
//    ├── HeaderBar         Image  → add to trojanBlueGraphics
//    │   ├── PartIdText    TMP    (orange)
//    │   └── PartNameText  TMP    (white)
//    ├── AccentRule        Image  → add to trojanOrangeGraphics
//    ├── StepCounterText   TMP
//    ├── SafetyBanner      GameObject with Image (orange) + TMP "[SAFETY]"
//    ├── StepBodyText      TMP
//    ├── TelemetryText     TMP    (rich text on)
//    └── Buttons           MRTK3 PressableButtons → OnClicked: PreviousStep / NextStep / Close
// =====================================================================================

using System;
using System.Text;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace MICHIPS.Lithography
{
    public class WorkInstructionCard : MonoBehaviour
    {
        // VSU brand palette
        public static readonly Color TrojanBlue = new Color32(0x00, 0x2B, 0x49, 0xFF);   // #002B49
        public static readonly Color TrojanOrange = new Color32(0xFF, 0x66, 0x00, 0xFF); // #FF6600
        private const string OrangeHex = "#FF6600";

        [Header("Text")]
        [SerializeField] private TMP_Text partIdText;
        [SerializeField] private TMP_Text partNameText;
        [SerializeField] private TMP_Text stepCounterText;
        [SerializeField] private TMP_Text stepBodyText;
        [SerializeField] private TMP_Text telemetryText;
        [SerializeField] private GameObject safetyBanner;

        [Header("Branding")]
        [SerializeField] private Graphic[] trojanBlueGraphics;
        [SerializeField] private Graphic[] trojanOrangeGraphics;
        [Tooltip("Backplate alpha. HoloLens is additive, so dark blue already reads as translucent.")]
        [SerializeField, Range(0f, 1f)] private float backplateAlpha = 0.92f;

        [Header("Placement")]
        [SerializeField] private float standOff = 0.12f;         // m in front of the part, toward the user
        [SerializeField] private float verticalOffset = 0.10f;   // m above the part centre
        [SerializeField] private float minViewerDistance = 0.45f; // reachable by direct poke
        [SerializeField] private float maxViewerDistance = 1.0f;
        [SerializeField] private float faceViewerSmoothing = 8f;

        [Header("Telemetry")]
        [SerializeField, Min(0.05f)] private float telemetryRefreshSeconds = 0.25f;

        /// <summary>Raised when the card closes, for controller bookkeeping.</summary>
        public event Action<WorkInstructionCard> Closed;

        /// <summary>Raised on step navigation: (partId, stepIndex). Hook for xAPI progression tracking.</summary>
        public event Action<string, int> StepChanged;

        private PhotolithographyPartData data;
        private ITelemetrySource telemetry;
        private Transform viewer;
        private int stepIndex;
        private float nextTelemetryTime;
        private readonly StringBuilder sb = new StringBuilder(256);
        private bool closing;

        // ---------------------------------------------------------------------------------

        public void Show(PhotolithographyPartData partData, Transform part, Transform viewerTransform, ITelemetrySource source)
        {
            data = partData;
            viewer = viewerTransform != null ? viewerTransform : (Camera.main != null ? Camera.main.transform : null);
            telemetry = source ?? new SimulatedTelemetrySource();
            stepIndex = 0;

            ApplyBranding();

            if (partIdText) partIdText.text = data.partId;
            if (partNameText) partNameText.text = data.partName;

            RenderStep();
            RenderTelemetry();
            PlaceNear(part);
            gameObject.SetActive(true);
        }

        public void NextStep() => GoToStep(stepIndex + 1);
        public void PreviousStep() => GoToStep(stepIndex - 1);

        public void Close()
        {
            if (closing) return;
            closing = true;
            Closed?.Invoke(this);
            Destroy(gameObject);
        }

        // ---------------------------------------------------------------------------------

        private void Update()
        {
            if (data == null) return;
            if (Time.time >= nextTelemetryTime)
            {
                nextTelemetryTime = Time.time + telemetryRefreshSeconds;
                RenderTelemetry();
            }
        }

        private void LateUpdate()
        {
            if (viewer == null) return;

            // Yaw-only billboard. A world-space canvas reads correctly when its +Z points away from the viewer.
            Vector3 away = transform.position - viewer.position;
            away.y = 0f;
            if (away.sqrMagnitude < 1e-4f) return;

            Quaternion target = Quaternion.LookRotation(away.normalized, Vector3.up);
            transform.rotation = Quaternion.Slerp(transform.rotation, target, 1f - Mathf.Exp(-faceViewerSmoothing * Time.deltaTime));
        }

        // ---------------------------------------------------------------------------------

        private void GoToStep(int index)
        {
            if (data == null || data.steps.Count == 0) return;
            int clamped = Mathf.Clamp(index, 0, data.steps.Count - 1);
            if (clamped == stepIndex) return;
            stepIndex = clamped;
            RenderStep();
            StepChanged?.Invoke(data.partId, stepIndex);
        }

        private void RenderStep()
        {
            if (data.steps.Count == 0)
            {
                if (stepCounterText) stepCounterText.text = "No work instructions authored";
                if (stepBodyText) stepBodyText.text = data.summary;
                if (safetyBanner) safetyBanner.SetActive(false);
                return;
            }

            WorkStep step = data.steps[stepIndex];
            if (stepCounterText) stepCounterText.text = $"STEP {stepIndex + 1} OF {data.steps.Count}  ·  {step.title}";
            if (stepBodyText) stepBodyText.text = step.body;
            if (safetyBanner) safetyBanner.SetActive(step.safetyCritical);
        }

        private void RenderTelemetry()
        {
            if (telemetryText == null || data == null) return;

            sb.Clear();
            sb.Append("<b>LIVE TELEMETRY</b> <size=70%>(simulated)</size>\n");
            float t = Time.time;
            foreach (TelemetryChannel ch in data.telemetry)
            {
                float v = telemetry.Read(data, ch, t);
                bool alarm = ch.IsOutOfRange(v);

                sb.Append(ch.label).Append(": ");
                if (alarm) sb.Append("<color=").Append(OrangeHex).Append("><b>");
                sb.Append(ch.Format(v));
                if (alarm) sb.Append("  [OUT OF RANGE]</b></color>"); // ASCII only: default TMP fonts lack ⚠
                sb.Append('\n');
            }
            telemetryText.text = sb.ToString();
        }

        private void ApplyBranding()
        {
            if (trojanBlueGraphics != null)
            {
                Color blue = TrojanBlue;
                blue.a = backplateAlpha;
                foreach (var g in trojanBlueGraphics) if (g) g.color = blue;
            }
            if (trojanOrangeGraphics != null)
                foreach (var g in trojanOrangeGraphics) if (g) g.color = TrojanOrange;

            if (partIdText) partIdText.color = TrojanOrange;
            foreach (var txt in new[] { partNameText, stepCounterText, stepBodyText, telemetryText })
                if (txt) txt.color = Color.white; // additive display: body text must be bright
        }

        /// <summary>Put the card beside the part, toward the user, clamped to a comfortable reach distance.</summary>
        private void PlaceNear(Transform part)
        {
            Bounds b = WorldBounds(part);
            Vector3 center = b.center;

            Vector3 toViewer = viewer != null ? viewer.position - center : -Vector3.forward;
            toViewer.y = 0f;
            toViewer = toViewer.sqrMagnitude > 1e-4f ? toViewer.normalized : Vector3.back;

            float horizontalRadius = new Vector2(b.extents.x, b.extents.z).magnitude;
            Vector3 pos = center + toViewer * (horizontalRadius + standOff) + Vector3.up * (b.extents.y + verticalOffset);

            if (viewer != null)
            {
                Vector3 fromViewer = pos - viewer.position;
                float d = fromViewer.magnitude;
                if (d > 1e-3f)
                    pos = viewer.position + fromViewer / d * Mathf.Clamp(d, minViewerDistance, maxViewerDistance);

                Vector3 away = pos - viewer.position; away.y = 0f;
                if (away.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(away.normalized, Vector3.up);
            }

            transform.position = pos;
        }

        private static Bounds WorldBounds(Transform t)
        {
            Renderer[] rs = t.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return new Bounds(t.position, Vector3.one * 0.1f);
            Bounds b = rs[0].bounds;
            for (int i = 1; i < rs.Length; i++) b.Encapsulate(rs[i].bounds);
            return b;
        }
    }
}
