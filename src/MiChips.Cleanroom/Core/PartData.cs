// =====================================================================================
//  PartData.cs
//  MI-CHIPS (NSF #2606117): part metadata, work-instruction steps and telemetry
//  channels shared by every MI-CHIPS equipment module.
// =====================================================================================

using System;
using System.Collections.Generic;

namespace MiChips.Cleanroom
{
    public sealed class WorkStep
    {
        public string Title;
        public string Body;
        /// <summary>Shows a [SAFETY] banner in Trojan Orange (LOTO, UV/laser exposure, chemical, pinch points).</summary>
        public bool SafetyCritical;

        public WorkStep(string title, string body, bool safetyCritical = false)
        {
            Title = title; Body = body; SafetyCritical = safetyCritical;
        }
    }

    public sealed class TelemetryChannel
    {
        public string Label;
        public string Unit;
        public float Nominal;
        /// <summary>Peak deviation of the simulated signal from nominal.</summary>
        public float NoiseAmplitude;
        /// <summary>How fast the simulated signal wanders (Hz-ish).</summary>
        public float NoiseSpeed = 0.4f;
        /// <summary>Values outside [WarnLow, WarnHigh] are highlighted. Leave both at 0 to disable.</summary>
        public float WarnLow, WarnHigh;
        public int Decimals = 2;

        public bool HasLimits => WarnHigh > WarnLow;
        public bool IsOutOfRange(float v) => HasLimits && (v < WarnLow || v > WarnHigh);
        public string Format(float v) => v.ToString("F" + Decimals) + " " + Unit;
    }

    /// <summary>Everything the work-instruction card needs to know about one selectable part.</summary>
    public sealed class PartData
    {
        public string PartId;
        public string PartName;
        /// <summary>Zone id within the equipment, e.g. "Z2".</summary>
        public string Zone;
        public string Summary;
        /// <summary>Card pager label: "STEP" for procedures, "POINT" for learning exhibits.</summary>
        public string StepLabel = "STEP";
        /// <summary>PLACEHOLDER CONTENT: validate against the OEM manual and site EHS/LOTO procedures.</summary>
        public List<WorkStep> Steps = new List<WorkStep>();
        public List<TelemetryChannel> Telemetry = new List<TelemetryChannel>();
    }

    // ---------------------------------------------------------------------------------
    //  Telemetry abstraction: the UI reads from an ITelemetrySource, so a live bridge
    //  (MQTT / OPC UA / REST from the real tool or a digital twin) can replace the simulation.
    // ---------------------------------------------------------------------------------

    public interface ITelemetrySource
    {
        float Read(PartData part, TelemetryChannel channel, float timeSeconds);
    }

    /// <summary>Smooth, believable signals: nominal plus a few incommensurate sine waves per channel.</summary>
    public sealed class SimulatedTelemetrySource : ITelemetrySource
    {
        public float Read(PartData part, TelemetryChannel ch, float t)
        {
            // Per-channel phase so channels wander independently (stable within a run).
            int hash = (part?.PartId ?? "").GetHashCode() ^ (ch.Label ?? "").GetHashCode();
            float phase = (hash & 0xFFFF) * 0.0137f;
            float s = ch.NoiseSpeed;

            // Sum of three sines at irrational ratios ≈ smooth noise in −1..1.
            double n = 0.55 * Math.Sin(t * s * 1.000 + phase)
                     + 0.30 * Math.Sin(t * s * 2.371 + phase * 1.7)
                     + 0.15 * Math.Sin(t * s * 5.113 + phase * 3.1);
            return ch.Nominal + (float)n * ch.NoiseAmplitude;
        }
    }
}
