// =====================================================================================
//  Markers.cs
//  MI-CHIPS (NSF #2606117): marker abstraction. The shared library doesn't depend on
//  the HoloLens QR API (UWP-only), so each app head supplies an IMarkerSource:
//    • HoloLens head → QrCodeMarkerSource (Microsoft.MixedReality.QR + World.FromSpatialNode)
//    • Desktop head  → SimulatedMarkerSource (button / M key places a fake marker)
// =====================================================================================

using StereoKit;

namespace MiChips.Cleanroom
{
    /// <summary>A marker sighting, in StereoKit world space.</summary>
    public struct MarkerObservation
    {
        /// <summary>Pose of the marker's CENTRE. Local -Z is the code's outward normal (toward the viewer).</summary>
        public Pose CenterPose;
        /// <summary>Physical edge length in metres (0 if unknown).</summary>
        public float SideLength;
    }

    public interface IMarkerSource
    {
        /// <summary>Begin detection (turn on the camera-backed watcher).</summary>
        void Start();
        /// <summary>Stop detection. Called once the anchor locks, to save battery and thermal headroom.</summary>
        void Stop();
        /// <summary>Called every frame on the main thread. Returns the latest fresh sighting of the payload.</summary>
        bool TryGetMarker(string payload, out MarkerObservation observation);
        /// <summary>True for the desktop simulator, so the UI can show a "Simulate marker" button.</summary>
        bool IsSimulated { get; }
    }

    /// <summary>Desktop/simulator stand-in: places a marker 1.5 m ahead of the head on request.</summary>
    public sealed class SimulatedMarkerSource : IMarkerSource
    {
        private bool running;
        private bool placed;
        private MarkerObservation observation;

        public bool IsSimulated => true;
        public void Start() { running = true; placed = false; }
        public void Stop() { running = false; }

        /// <summary>Drop a marker on a virtual "front panel" 2.2 m ahead at chest height, facing the user.</summary>
        public void PlaceInFrontOfHead()
        {
            Pose head = Input.Head;
            Vec3 fwd = head.Forward; fwd.y = 0;
            fwd = fwd.LengthSq < 1e-4f ? -Vec3.UnitZ : fwd.Normalized;

            Vec3 pos = head.position + fwd * 2.2f; // far enough to see the whole ~2 m tool
            pos.y = head.position.y - 0.35f;
            // Marker -Z (outward normal) must point back at the user, i.e. marker +Z along fwd.
            observation = new MarkerObservation
            {
                CenterPose = new Pose(pos, Quat.LookDir(-fwd)),
                SideLength = 0.12f,
            };
            placed = true;
        }

        public bool TryGetMarker(string payload, out MarkerObservation obs)
        {
            if (running && Input.Key(Key.M).IsJustActive()) PlaceInFrontOfHead();
            obs = observation;
            return running && placed;
        }
    }
}
