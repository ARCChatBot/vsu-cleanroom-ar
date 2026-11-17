// =====================================================================================
//  WorkInstructionCard.cs
//  MI-CHIPS (NSF #2606117): floating, VSU-branded HMI card for a selected tool part.
//  Built with StereoKit's immediate-mode UI: call Draw() every frame while it's open.
//  The window is grabbable by its title bar and turns to face the user when moved.
// =====================================================================================

using System;
using System.Collections.Generic;
using StereoKit;

namespace MiChips.Cleanroom
{
    /// <summary>VSU brand palette and StereoKit UI theming.</summary>
    public static class Brand
    {
        public static readonly Color TrojanBlue = Color.Hex(0x002B49FF);   // #002B49
        public static readonly Color TrojanOrange = Color.Hex(0xFF6600FF); // #FF6600
        /// <summary>Slightly lifted blue for button faces. Pure #002B49 is nearly invisible on an additive display.</summary>
        public static readonly Color TrojanBlueLift = Color.Hex(0x0B4F7EFF);

        private static TextStyle orange, header;
        public static TextStyle OrangeText => orange;
        public static TextStyle HeaderText => header;

        /// <summary>Call once after SK.Initialize.</summary>
        public static void Apply()
        {
            UI.SetThemeColor(UIColor.Primary, TrojanOrange);      // focus, active states, accents
            UI.SetThemeColor(UIColor.Background, TrojanBlue);     // window body
            UI.SetThemeColor(UIColor.Common, TrojanBlueLift);     // buttons and controls
            orange = Text.MakeStyle(Default.Font, 0.011f, TrojanOrange);
            header = Text.MakeStyle(Default.Font, 0.016f, Color.White); // additive display: body text must be bright
        }
    }

    public sealed class WorkInstructionCard
    {
        public PartData Data { get; }
        public MachinePart Part { get; }
        public bool IsOpen { get; private set; } = true;

        /// <summary>(partId, stepIndex): hook for xAPI progression tracking.</summary>
        public event Action<string, int> StepChanged;

        private readonly ITelemetrySource telemetry;
        private readonly List<(string text, bool alarm)> telemetryLines = new List<(string, bool)>();
        private Pose pose;
        private int step;
        private float nextTelemetryTime;

        private const float Width = 0.34f;
        private const float TelemetryRefresh = 0.25f;
        private const float MinViewerDistance = 0.45f; // close enough to poke the buttons directly
        private const float MaxViewerDistance = 1.0f;

        public WorkInstructionCard(MachinePart part, ITelemetrySource telemetrySource)
        {
            Part = part;
            Data = part.Data;
            telemetry = telemetrySource ?? new SimulatedTelemetrySource();
            pose = PlaceNear(part, Input.Head);
        }

        public void Close() => IsOpen = false;

        public void Draw()
        {
            if (!IsOpen) return;
            RefreshTelemetry();

            UI.WindowBegin("MI-CHIPS  |  " + Data.PartId, ref pose, new Vec2(Width, 0), UIWin.Normal, UIMove.FaceUser);

            // ---- Header ----
            UI.PushTextStyle(Brand.OrangeText);
            UI.Label(Data.PartId);
            UI.PopTextStyle();
            UI.PushTextStyle(Brand.HeaderText);
            UI.Label(Data.PartName);
            UI.PopTextStyle();
            if (!string.IsNullOrEmpty(Data.Summary)) UI.Text(Data.Summary);
            UI.HSeparator();

            // ---- Work instruction pager ----
            if (Data.Steps.Count == 0)
            {
                UI.Label("No work instructions authored.");
            }
            else
            {
                WorkStep s = Data.Steps[step];
                if (s.SafetyCritical)
                {
                    UI.PushTextStyle(Brand.OrangeText);
                    UI.Label("[SAFETY] Follow site EHS / LOTO procedure");  // ASCII only: default font lacks ⚠
                    UI.PopTextStyle();
                }
                UI.Label($"{Data.StepLabel} {step + 1} OF {Data.Steps.Count}  |  {s.Title}");
                UI.Text(s.Body);

                if (UI.Button("< Prev")) GoTo(step - 1);
                UI.SameLine();
                if (UI.Button("Next >")) GoTo(step + 1);
                UI.SameLine();
            }
            if (UI.Button("Close")) Close();

            // ---- Telemetry ----
            if (telemetryLines.Count > 0) // learning exhibits have no telemetry
            {
                UI.HSeparator();
                UI.Label("LIVE TELEMETRY (simulated)");
                foreach (var (text, alarm) in telemetryLines)
                {
                    if (alarm) UI.PushTextStyle(Brand.OrangeText);
                    UI.Label(alarm ? text + "  [OUT OF RANGE]" : text);
                    if (alarm) UI.PopTextStyle();
                }
            }

            UI.WindowEnd();
        }

        private void GoTo(int index)
        {
            int clamped = Math.Max(0, Math.Min(Data.Steps.Count - 1, index));
            if (clamped == step) return;
            step = clamped;
            StepChanged?.Invoke(Data.PartId, step);
        }

        private void RefreshTelemetry()
        {
            float t = Time.Totalf;
            if (t < nextTelemetryTime) return;
            nextTelemetryTime = t + TelemetryRefresh;

            telemetryLines.Clear();
            foreach (TelemetryChannel ch in Data.Telemetry)
            {
                float v = telemetry.Read(Data, ch, t);
                telemetryLines.Add(($"{ch.Label}: {ch.Format(v)}", ch.IsOutOfRange(v)));
            }
        }

        /// <summary>Beside the part, toward the user, clamped to a comfortable reach distance.</summary>
        private static Pose PlaceNear(MachinePart part, Pose head)
        {
            Vec3 center = part.WorldCenter;
            Vec3 toViewer = head.position - center; toViewer.y = 0;
            toViewer = toViewer.LengthSq > 1e-4f ? toViewer.Normalized : Vec3.UnitZ;

            Vec3 pos = center + toViewer * (part.WorldRadius + 0.12f) + Vec3.UnitY * 0.10f;

            Vec3 fromHead = pos - head.position;
            float d = fromHead.Length;
            if (d > 1e-3f)
                pos = head.position + fromHead / d * Math.Max(MinViewerDistance, Math.Min(MaxViewerDistance, d));

            return new Pose(pos, Quat.LookAt(pos, head.position));
        }
    }
}
