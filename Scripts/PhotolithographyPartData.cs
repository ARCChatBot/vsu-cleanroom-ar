// =====================================================================================
//  PhotolithographyPartData.cs
//  MI-CHIPS (NSF #2606117): authorable part metadata for the AR photolithography trainer.
//  Create assets via: Assets > Create > MI-CHIPS > Photolithography Part Data
// =====================================================================================

using System;
using System.Collections.Generic;
using UnityEngine;

namespace MICHIPS.Lithography
{
    /// <summary>Functional zones from the tool cutaway schematic.</summary>
    public enum LithoZone
    {
        WaferHandlingRobot,     // Z1
        ProjectionOptics,       // Z2: UV source, beam path, mirrors, reticle, projection lens
        WaferStageChuck,        // Z3
        FluidElectricalRacks,   // Z4
        Chassis
    }

    [Serializable]
    public class WorkStep
    {
        public string title;
        [TextArea(2, 6)] public string body;

        [Tooltip("Shows a [SAFETY] banner in Trojan Orange (LOTO, UV/laser exposure, chemical, pinch points).")]
        public bool safetyCritical;
    }

    [Serializable]
    public class TelemetryChannel
    {
        public string label = "Stage Temperature";
        public string unit = "°C";
        public float nominal = 22f;

        [Tooltip("Peak deviation of the simulated signal from nominal.")]
        public float noiseAmplitude = 0.01f;

        [Tooltip("How fast the simulated signal wanders (Perlin noise frequency).")]
        public float noiseSpeed = 0.4f;

        [Tooltip("Values outside [warnLow, warnHigh] are highlighted. Leave both at 0 to disable.")]
        public float warnLow;
        public float warnHigh;

        [Range(0, 6)] public int decimals = 2;

        public bool HasLimits => warnHigh > warnLow;
        public bool IsOutOfRange(float v) => HasLimits && (v < warnLow || v > warnHigh);
        public string Format(float v) => v.ToString("F" + decimals) + " " + unit;
    }

    [CreateAssetMenu(menuName = "MI-CHIPS/Photolithography Part Data", fileName = "LITHO-Part")]
    public class PhotolithographyPartData : ScriptableObject
    {
        [Header("Identity")]
        public string partId = "LITHO-Z2-MIR";
        public string partName = "Fold Mirror Assembly";
        public LithoZone zone = LithoZone.ProjectionOptics;
        [TextArea(2, 4)] public string summary;

        [Header("Digital Work Instructions")]
        [Tooltip("PLACEHOLDER CONTENT: validate against the OEM manual and site EHS/LOTO procedures.")]
        public List<WorkStep> steps = new List<WorkStep>();

        [Header("Telemetry")]
        public List<TelemetryChannel> telemetry = new List<TelemetryChannel>();
    }

    // ---------------------------------------------------------------------------------
    //  Telemetry abstraction: the UI reads from an ITelemetrySource, so a live bridge
    //  (MQTT / OPC UA / REST from the real tool or a digital twin) can replace the simulation.
    // ---------------------------------------------------------------------------------

    public interface ITelemetrySource
    {
        float Read(PhotolithographyPartData part, TelemetryChannel channel, float time);
    }

    /// <summary>Smooth, believable signals: nominal plus Perlin noise, plus an occasional brief excursion for training.</summary>
    public sealed class SimulatedTelemetrySource : ITelemetrySource
    {
        /// <summary>Chance per second of a short out-of-tolerance excursion (teaches students to spot alarms).</summary>
        public float excursionChancePerSecond = 0.0f;

        public float Read(PhotolithographyPartData part, TelemetryChannel ch, float time)
        {
            // Stable per-channel seed so each channel wanders independently.
            int hash = (part != null ? part.partId : "").GetHashCode() ^ (ch.label ?? "").GetHashCode();
            float seed = (hash & 0xFFFF) * 0.0137f;

            float n = Mathf.PerlinNoise(time * ch.noiseSpeed, seed) * 2f - 1f; // −1..1
            float value = ch.nominal + n * ch.noiseAmplitude;

            if (excursionChancePerSecond > 0f && ch.HasLimits)
            {
                // A deterministic 2-second window per 10-second slot, gated by the chance.
                int slot = Mathf.FloorToInt(time / 10f);
                float roll = Mathf.PerlinNoise(slot * 0.731f, seed + 11.3f);
                if (roll < excursionChancePerSecond * 10f && (time % 10f) < 2f)
                    value = ch.warnHigh + (ch.warnHigh - ch.warnLow) * 0.1f;
            }
            return value;
        }
    }
}
