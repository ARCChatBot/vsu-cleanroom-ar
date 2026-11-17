// =====================================================================================
//  DataVizHost.cs
//  MI-CHIPS (NSF #2606117): AR lab data visualization. A dashboard lists every dataset
//  (built-in samples plus any CSVs in Assets/Data) grouped as Measurement, Simulation or
//  Quality. Opening a view places it on an arc around the user. Every view can be
//  grabbed and moved.
// =====================================================================================

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using StereoKit;
using StereoKit.Framework;

namespace MiChips.Cleanroom.DataViz
{
    public sealed class DataVizHost : IStepper
    {
        /// <summary>(datasetId, readout) when a user inspects a value. Hook for xAPI analytics.</summary>
        public event Action<string, string> Inspected;
        /// <summary>(datasetId, viewKind) when a view opens.</summary>
        public event Action<string, string> ViewOpened;

        public bool Enabled => true;
        public IReadOnlyList<Dataset> Datasets => datasets;

        private readonly string dataFolder;
        private List<Dataset> datasets = new List<Dataset>();
        private readonly List<VizView> views = new List<VizView>();
        private Pose dashPose;
        private int nextSlot;

        // Arc slots around the user, in degrees from straight ahead (positive = to the right).
        private static readonly float[] SlotAngles = { 0, 38, -38, 76, -76, 114, -114 };

        public DataVizHost(string dataFolder = null)
        {
            this.dataFolder = dataFolder ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "Data");
        }

        public bool Initialize()
        {
            VizStyle.Init();
            datasets = SampleData.All();
            datasets.AddRange(CsvLoader.LoadFolder(dataFolder));

            Pose head = Input.Head;
            Vec3 fwd = Flat(head.Forward);
            Vec3 right = Vec3.Cross(fwd, Vec3.UnitY).Normalized;
            Vec3 pos = head.position + fwd * 0.55f - right * 0.38f - Vec3.UnitY * 0.12f;
            dashPose = new Pose(pos, Quat.LookAt(pos, head.position));

            // Open a showcase so there's something to look at straight away.
            Open(datasets.First(d => d.Id == "process-window"), "2D");
            Open(datasets.First(d => d.Id == "thermal"), "3D");
            return true;
        }

        public void Step()
        {
            DrawDashboard();
            foreach (VizView v in views.ToArray()) v.Draw();
            views.RemoveAll(v => !v.IsOpen);
        }

        public void Shutdown() { }

        // ---------------------------------------------------------------------------------

        private void DrawDashboard()
        {
            UI.WindowBegin("MI-CHIPS  |  Lab Data Visualization", ref dashPose, new Vec2(0.36f, 0));
            UI.Text("Open a dataset as a 2D chart, contour map, 3D surface or wafer map. Grab any window or base plate to move it. Point at data to read values.");

            foreach (DataCategory cat in new[] { DataCategory.Measurement, DataCategory.Simulation, DataCategory.Quality })
            {
                var inCat = datasets.Where(d => d.Category == cat).ToList();
                if (inCat.Count == 0) continue;

                UI.HSeparator();
                UI.PushTextStyle(Brand.OrangeText);
                UI.Label(cat.ToString().ToUpperInvariant());
                UI.PopTextStyle();

                foreach (Dataset d in inCat)
                {
                    UI.PushId(d.Id);
                    UI.Label(d.Title);
                    bool first = true;
                    foreach (string kind in KindsFor(d))
                    {
                        if (!first) UI.SameLine();
                        first = false;
                        VizView open = views.FirstOrDefault(v => v.Data == d && v.Kind == kind);
                        if (UI.Button(open != null ? "Hide " + kind : kind))
                        {
                            if (open != null) open.IsOpen = false;
                            else Open(d, kind);
                        }
                    }
                    UI.PopId();
                }
            }

            UI.HSeparator();
            if (UI.Button("Arrange around me")) Arrange();
            UI.SameLine();
            if (UI.Button("Close all")) foreach (VizView v in views) v.IsOpen = false;
            UI.Label($"{datasets.Count} datasets  ·  CSV folder: Assets/Data");
            UI.WindowEnd();
        }

        private static IEnumerable<string> KindsFor(Dataset d)
        {
            switch (d)
            {
                case FieldGrid _:    return new[] { "2D", "3D" };
                case PlotData _:     return new[] { "Plot" };
                case WaferMap _:     return new[] { "3D map" };
                case ControlChart _: return new[] { "Chart" };
                default:             return Array.Empty<string>();
            }
        }

        private void Open(Dataset d, string kind)
        {
            if (views.Any(v => v.Data == d && v.Kind == kind && v.IsOpen)) return;

            VizView view;
            switch (d)
            {
                case FieldGrid g when kind == "3D": view = new SurfaceView(g); break;
                case FieldGrid g:                   view = new FieldView(g); break;
                case PlotData p:                    view = new PlotView(p); break;
                case WaferMap w:                    view = new WaferMapView(w); break;
                case ControlChart c:                view = new ControlChartView(c); break;
                default: return;
            }

            view.OpenFieldRequested += (g, as3D) => Open(g, as3D ? "3D" : "2D");
            view.Inspected += (id, text) => Inspected?.Invoke(id, text);
            Place(view, nextSlot++);
            views.Add(view);
            ViewOpened?.Invoke(d.Id, kind);
        }

        private void Arrange()
        {
            int i = 0;
            foreach (VizView v in views) Place(v, i++);
            nextSlot = i;
        }

        /// <summary>Places a view on an arc around the head. 3D views sit lower and level so you look down onto them.</summary>
        private static void Place(VizView v, int slot)
        {
            Pose head = Input.Head;
            Vec3 fwd = Flat(head.Forward);
            float ang = SlotAngles[slot % SlotAngles.Length] * (float)Math.PI / 180f;
            Vec3 right = Vec3.Cross(fwd, Vec3.UnitY).Normalized;
            Vec3 dir = fwd * (float)Math.Cos(ang) + right * (float)Math.Sin(ang);

            float dist = v.Is3D ? 0.85f : 0.75f;
            Vec3 pos = head.position + dir * dist + Vec3.UnitY * (v.Is3D ? -0.42f : -0.05f);
            Vec3 lookAt = v.Is3D ? new Vec3(head.position.x, pos.y, head.position.z) : head.position;
            v.Pose = new Pose(pos, Quat.LookAt(pos, lookAt));
        }

        private static Vec3 Flat(Vec3 v)
        {
            v.y = 0;
            return v.LengthSq < 1e-4f ? -Vec3.UnitZ : v.Normalized;
        }
    }
}
