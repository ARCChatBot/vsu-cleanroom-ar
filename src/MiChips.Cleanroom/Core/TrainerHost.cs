// =====================================================================================
//  TrainerHost.cs
//  MI-CHIPS (NSF #2606117): top-level StereoKit stepper. Shows an equipment picker,
//  auto-loads a tool when its QR code is seen, and runs one EquipmentARController at a time.
// =====================================================================================

using System;
using System.Collections.Generic;
using StereoKit;
using StereoKit.Framework;

namespace MiChips.Cleanroom
{
    public sealed class TrainerHost : IStepper
    {
        /// <summary>Raised whenever a tool is loaded. Subscribe to wire analytics to its events.</summary>
        public event Action<EquipmentARController> ControllerStarted;

        public bool Enabled => true;
        public EquipmentARController Active { get; private set; }

        private readonly IReadOnlyList<EquipmentDefinition> equipment;
        private readonly IMarkerSource markers;
        private Pose pickerPose;
        private readonly HashSet<string> hasSavedAnchor = new HashSet<string>();

        public TrainerHost(IReadOnlyList<EquipmentDefinition> equipmentList, IMarkerSource markerSource)
        {
            equipment = equipmentList;
            markers = markerSource;
        }

        public bool Initialize()
        {
            if (equipment.Count == 1) Launch(equipment[0]);
            else ShowPicker();
            return true;
        }

        public void Step()
        {
            if (Active != null) { Active.Step(); return; }
            AutoDetect();
            if (Active == null) DrawPicker();
        }

        public void Shutdown()
        {
            Active?.Shutdown();
            markers.Stop();
        }

        private void ShowPicker()
        {
            Pose head = Input.Head;
            Vec3 pos = head.position + head.Forward * 0.6f;
            pickerPose = new Pose(pos, Quat.LookAt(pos, head.position));

            // Read the anchor files once per picker visit, not every frame.
            hasSavedAnchor.Clear();
            foreach (EquipmentDefinition eq in equipment)
                if (new AnchorService(eq.Id + "_anchor.txt").HasSavedAnchor) hasSavedAnchor.Add(eq.Id);
            if (!markers.IsSimulated) markers.Start(); // look for any registered tool's QR code
        }

        private void AutoDetect()
        {
            // The simulator's fake marker answers for every payload, so in the simulator the trainee picks manually.
            if (markers.IsSimulated) return;
            foreach (EquipmentDefinition eq in equipment)
            {
                if (markers.TryGetMarker(eq.MarkerPayload, out _)) { Launch(eq); return; }
            }
        }

        private void DrawPicker()
        {
            UI.WindowBegin("MI-CHIPS  |  Select Equipment", ref pickerPose, new Vec2(0.30f, 0));
            UI.PushTextStyle(Brand.OrangeText);
            UI.Label(markers.IsSimulated ? "Choose a tool to train on" : "Look at a tool's QR code, or choose:");
            UI.PopTextStyle();

            foreach (EquipmentDefinition eq in equipment)
            {
                bool saved = hasSavedAnchor.Contains(eq.Id);
                if (UI.Button(eq.DisplayName + (saved ? "  (saved position)" : ""))) Launch(eq);
                UI.Text(eq.Description);
                UI.HSeparator();
            }
            UI.WindowEnd();
        }

        private void Launch(EquipmentDefinition eq)
        {
            Log.Info($"[MI-CHIPS] Loading equipment '{eq.Id}'");
            Active = new EquipmentARController(eq, markers);
            Active.SwitchRequested += Unload;
            Active.Initialize();
            ControllerStarted?.Invoke(Active);
        }

        private void Unload()
        {
            if (Active == null) return;
            Active.SwitchRequested -= Unload;
            Active.Shutdown();
            Active = null;
            ShowPicker();
        }
    }
}
