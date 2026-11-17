// =====================================================================================
//  AppBootstrap.cs
//  MI-CHIPS (NSF #2606117): shared startup used by both the desktop and HoloLens heads.
//  The default mode is AR lab data visualization. The equipment trainers
//  (photolithography, advanced packaging) are still available as AppMode.EquipmentTrainer.
// =====================================================================================

using System.Collections.Generic;
using MiChips.Cleanroom.DataViz;
using MiChips.Cleanroom.Lithography;
using MiChips.Cleanroom.Packaging;
using StereoKit;

namespace MiChips.Cleanroom
{
    public enum AppMode
    {
        DataVisualization,
        EquipmentTrainer,
    }

    public static class AppBootstrap
    {
        /// <summary>Every trainable tool (EquipmentTrainer mode). Add new equipment modules here.</summary>
        public static readonly IReadOnlyList<EquipmentDefinition> AllEquipment = new[]
        {
            LithoToolFactory.Definition,
            PackagingCellFactory.Definition,
        };

        public static void Run(IMarkerSource markers, AppMode mode = AppMode.DataVisualization)
        {
            var settings = new SKSettings
            {
                appName = "VSU Cleanroom AR",
                assetsFolder = "Assets",
            };
            if (!SK.Initialize(settings)) return;
            Brand.Apply();

            if (mode == AppMode.DataVisualization)
            {
                DataVizHost viz = SK.AddStepper(new DataVizHost());
                // Analytics hooks: replace these logs with an xAPI statement emitter.
                viz.ViewOpened += (id, kind) => Log.Info($"[xAPI] opened {kind} view of {id}");
                viz.Inspected += (id, readout) => Log.Info($"[xAPI] inspected {id}: {readout}");
            }
            else
            {
                TrainerHost host = SK.AddStepper(new TrainerHost(AllEquipment, markers));
                host.ControllerStarted += c =>
                {
                    string tool = c.Equipment.Id;
                    c.PartSelected += id => Log.Info($"[xAPI] {tool}: inspected {id}");
                    c.StepChanged += (id, step) => Log.Info($"[xAPI] {tool}: {id} viewed step {step + 1}");
                    c.ExplodedChanged += exploded => Log.Info($"[xAPI] {tool}: exploded view {(exploded ? "opened" : "closed")}");
                };
            }

            SK.Run(() => { });
        }
    }
}
