// =====================================================================================
//  Colormap.cs
//  MI-CHIPS (NSF #2606117): perceptual colormaps for heatmaps, surfaces and wafer maps.
//
//  HoloLens 2 has an ADDITIVE display, so black renders as transparent and dark colours
//  render dim and see-through. Classic maps like Viridis and Inferno start near black and
//  lose their low end in the headset. The defaults here ("Holo" and "Holo Diverging") keep
//  a lifted minimum lightness so every value stays visible. Viridis and Inferno remain
//  available for screenshots and the desktop simulator.
// =====================================================================================

using System;
using StereoKit;

namespace MiChips.Cleanroom.DataViz
{
    public sealed class Colormap
    {
        public readonly string Name;
        private readonly Color[] stops;

        private Colormap(string name, params uint[] hex)
        {
            Name = name;
            stops = Array.ConvertAll(hex, h => Color.Hex(h));
        }

        public Color Sample(float t)
        {
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            float f = t * (stops.Length - 1);
            int i = Math.Min((int)f, stops.Length - 2);
            return Color.Lerp(stops[i], stops[i + 1], f - i);
        }

        public Color32 Sample32(float t) => ToColor32(Sample(t));

        public static Color32 ToColor32(Color c) => new Color32(B(c.r), B(c.g), B(c.b), B(c.a));
        private static byte B(float v) => (byte)(Math.Max(0f, Math.Min(1f, v)) * 255f + 0.5f);

        // Sequential, HoloLens-safe: blue → cyan → teal → green → yellow → orange → red (no dark end).
        public static readonly Colormap Holo = new Colormap("Holo",
            0x3E63DDFF, 0x2FA4E7FF, 0x2EC4B6FF, 0x7BD14BFF, 0xF2D43DFF, 0xFF8A3DFF, 0xFF4D6DFF);

        // Diverging, HoloLens-safe: blue → light grey → red (for values around a midpoint).
        public static readonly Colormap HoloDiverging = new Colormap("Holo Diverging",
            0x3B6FF5FF, 0x8FB3FFFF, 0xE6E6E6FF, 0xFF9B7AFF, 0xE8443AFF);

        public static readonly Colormap Viridis = new Colormap("Viridis",
            0x440154FF, 0x472D7BFF, 0x3B528BFF, 0x2C728EFF, 0x21918CFF, 0x28AE80FF, 0x5EC962FF, 0xADDC30FF, 0xFDE725FF);

        public static readonly Colormap Inferno = new Colormap("Inferno",
            0x000004FF, 0x1B0C41FF, 0x4A0C6BFF, 0x781C6DFF, 0xA52C60FF, 0xCF4446FF, 0xED6925FF, 0xFB9B06FF, 0xF7D13DFF, 0xFCFFA4FF);

        public static readonly Colormap[] All = { Holo, HoloDiverging, Viridis, Inferno };

        public static int DefaultIndexFor(FieldGrid g) => g.Diverging ? 1 : 0;
    }
}
