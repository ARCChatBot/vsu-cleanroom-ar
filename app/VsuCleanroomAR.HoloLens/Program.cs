// HoloLens 2 (UWP) entry point. Replaces the Program.cs from the StereoKit UWP template.
using MiChips.Cleanroom;

namespace VsuCleanroomAR.HoloLens
{
    internal static class Program
    {
        private static void Main(string[] args)
        {
            AppBootstrap.Run(new QrCodeMarkerSource());
        }
    }
}
