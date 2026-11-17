// =====================================================================================
//  VizView.cs
//  MI-CHIPS (NSF #2606117): base class for every visualization placed in the room.
//  2D views live inside grabbable StereoKit windows; 3D views (surfaces, wafer maps)
//  stand on a grabbable base plate.
// =====================================================================================

using System;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public abstract class VizView
    {
        public Pose Pose;
        public bool IsOpen = true;

        public abstract Dataset Data { get; }
        /// <summary>Short view kind shown on dashboard buttons, e.g. "Plot", "2D", "3D".</summary>
        public abstract string Kind { get; }
        /// <summary>3D views are placed lower and flat (yaw only); 2D windows face the user.</summary>
        public virtual bool Is3D => false;
        public string Key => Data.Id + ":" + Kind;

        /// <summary>Raised when a view asks the host to open another view of a field (e.g. 2D → 3D).</summary>
        public event Action<FieldGrid, bool> OpenFieldRequested;
        protected void RequestField(FieldGrid g, bool as3D) => OpenFieldRequested?.Invoke(g, as3D);

        /// <summary>Raised when the trainee inspects a value. Hook for analytics.</summary>
        public event Action<string, string> Inspected;
        private string lastInspect;
        protected void ReportInspect(string readout)
        {
            if (readout == lastInspect) return;
            lastInspect = readout;
            Inspected?.Invoke(Data.Id, readout);
        }

        public abstract void Draw();

        /// <summary>Re-face a 3D view toward the user, keeping it level.</summary>
        protected void TurnToUser()
        {
            Vec3 head = Input.Head.position; head.y = Pose.position.y;
            if ((head - Pose.position).LengthSq > 1e-4f) Pose.orientation = Quat.LookAt(Pose.position, head);
        }

        protected static string Unit(string u) => string.IsNullOrEmpty(u) ? "" : " " + u;
    }
}
