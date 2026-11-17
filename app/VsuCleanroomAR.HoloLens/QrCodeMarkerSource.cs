// =====================================================================================
//  QrCodeMarkerSource.cs  (HoloLens 2 / UWP head only)
//  MI-CHIPS (NSF #2606117): QR detection through Microsoft.MixedReality.QR, with poses
//  resolved through StereoKit's World.FromSpatialNode.
//
//  NuGet:       Microsoft.MixedReality.QR (0.5.x)
//  Capability:  <DeviceCapability Name="webcam" />. Without it, the watcher never reports codes.
// =====================================================================================

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.MixedReality.QR;
using MiChips.Cleanroom;
using StereoKit;

namespace VsuCleanroomAR.HoloLens
{
    public sealed class QrCodeMarkerSource : IMarkerSource
    {
        private readonly object gate = new object();
        private readonly Dictionary<string, QRCode> latestByPayload = new Dictionary<string, QRCode>();
        private QRCodeWatcher watcher;
        private bool accessGranted;
        private bool wantRunning;
        private bool watcherRunning;
        private DateTimeOffset startedAt;

        /// <summary>
        /// The QR spatial node's origin is the code's TOP-LEFT corner: +X right, +Y down, +Z into the code.
        /// We shift to the centre, and the node's -Z is already the outward normal our convention expects.
        /// The scan view draws an axis gizmo at the result, so check it once on device.
        /// </summary>
        public bool FlipNormal = false;

        public bool IsSimulated => false;

        public QrCodeMarkerSource()
        {
            _ = RequestAccessAsync();
        }

        private async Task RequestAccessAsync()
        {
            if (!QRCodeWatcher.IsSupported())
            {
                Log.Warn("[MI-CHIPS] QR code tracking is not supported on this device.");
                return;
            }

            QRCodeWatcherAccessStatus status = await QRCodeWatcher.RequestAccessAsync();
            accessGranted = status == QRCodeWatcherAccessStatus.Allowed;
            if (!accessGranted) Log.Warn($"[MI-CHIPS] QR access not granted ({status}). Is the webcam capability declared?");
            else if (wantRunning) StartWatcher();
        }

        public void Start()
        {
            wantRunning = true;
            if (accessGranted) StartWatcher();
        }

        public void Stop()
        {
            wantRunning = false;
            if (watcherRunning) watcher.Stop();
            watcherRunning = false;
            lock (gate) latestByPayload.Clear();
        }

        private void StartWatcher()
        {
            if (watcherRunning) return; // the picker and the controller may both call Start()
            if (watcher == null)
            {
                watcher = new QRCodeWatcher();
                watcher.Added += (s, e) => Record(e.Code);
                watcher.Updated += (s, e) => Record(e.Code);
            }
            startedAt = DateTimeOffset.Now;
            watcher.Start();
            watcherRunning = true;
        }

        // Watcher events arrive on a background thread. Store them here; poses are resolved on the main thread.
        private void Record(QRCode code)
        {
            // The watcher also replays codes the device saw in earlier sessions. Ignore anything
            // not seen since we started, or we'd anchor to wherever the marker USED to be.
            if (code.LastDetectedTime < startedAt) return;
            lock (gate) latestByPayload[code.Data] = code;
        }

        public bool TryGetMarker(string payload, out MarkerObservation observation)
        {
            observation = default;
            QRCode code;
            lock (gate)
            {
                if (!latestByPayload.TryGetValue(payload, out code)) return false;
            }

            Pose node = World.FromSpatialNode(code.SpatialGraphNodeId);
            if (node.orientation.x == 0 && node.orientation.y == 0 && node.orientation.z == 0 && node.orientation.w == 0)
                return false; // node not locatable this frame

            float s = code.PhysicalSideLength;
            Vec3 center = node.position + node.orientation * new Vec3(s * 0.5f, s * 0.5f, 0);
            Quat orientation = FlipNormal ? node.orientation * Quat.FromAngles(0, 180, 0) : node.orientation;

            observation = new MarkerObservation { CenterPose = new Pose(center, orientation), SideLength = s };
            return true;
        }
    }
}
