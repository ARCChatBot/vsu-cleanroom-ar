// =====================================================================================
//  EquipmentDefinition.cs
//  MI-CHIPS (NSF #2606117): describes one trainable tool. Each equipment module
//  (Lithography/, Packaging/, ...) exposes a static Definition. The host lists them
//  in a picker and auto-loads whichever tool's QR code the trainee looks at.
// =====================================================================================

using System;
using StereoKit;

namespace MiChips.Cleanroom
{
    public sealed class EquipmentDefinition
    {
        /// <summary>Stable id, also used to name the persisted-anchor file. E.g. "litho-01".</summary>
        public string Id;
        public string DisplayName;
        public string Description;

        /// <summary>QR payload printed on this physical tool.</summary>
        public string MarkerPayload;

        /// <summary>Measured offset from the QR centre to the machine origin (floor centre), machine frame.</summary>
        public Vec3 MarkerToMachineOffset;

        /// <summary>Builds the holographic model. The argument is the folder holding optional &lt;PartId&gt;.glb overrides.</summary>
        public Func<string, MachineModel> BuildModel;

        public ControllerConfig CreateConfig() => new ControllerConfig
        {
            MarkerPayload = MarkerPayload,
            MarkerToMachineOffset = MarkerToMachineOffset,
            AnchorFileName = Id + "_anchor.txt",
        };
    }
}
