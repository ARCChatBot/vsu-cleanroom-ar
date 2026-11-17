// =====================================================================================
//  AnchorService.cs
//  MI-CHIPS (NSF #2606117): creates, persists and restores the OpenXR spatial anchor
//  that holds the holographic machine on the real tool.
//
//  StereoKit's Anchor wraps XR_MSFT_spatial_anchor (+ _persistence on HoloLens 2).
//  The runtime names persisted anchors itself, so we save the chosen anchor's Name to
//  a small file in the app's local data folder and look it up again on the next launch.
// =====================================================================================

using System;
using System.IO;
using System.Linq;
using StereoKit;

namespace MiChips.Cleanroom
{
    public sealed class AnchorService
    {
        private readonly string storePath;

        public AnchorService(string fileName = "litho_anchor.txt")
        {
            // On UWP this resolves to the package's LocalState folder.
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MiChips");
            storePath = Path.Combine(dir, fileName);
        }

        public bool CanPersist => (Anchor.Capabilities & AnchorCaps.Storable) != 0;
        public bool HasSavedAnchor => !string.IsNullOrEmpty(ReadSavedName());

        /// <summary>Creates an anchor at the pose. Returns null where anchors aren't supported (simulator).</summary>
        public Anchor Create(Pose pose)
        {
            try { return Anchor.FromPose(pose); }
            catch (Exception e) { Log.Warn($"[MI-CHIPS] Anchor.FromPose failed: {e.Message}"); return null; }
        }

        /// <summary>Marks the anchor persistent and remembers its system-assigned name.</summary>
        public bool Persist(Anchor anchor)
        {
            if (anchor == null || !CanPersist) return false;
            if (!anchor.TrySetPersistent(true)) return false;
            WriteSavedName(anchor.Name);
            return true;
        }

        /// <summary>Finds the previously persisted anchor (may take a few frames to appear after launch).</summary>
        public Anchor FindSaved()
        {
            string name = ReadSavedName();
            if (string.IsNullOrEmpty(name)) return null;
            return Anchor.Anchors.FirstOrDefault(a => a.Name == name);
        }

        /// <summary>Forget the persisted anchor, e.g. when the tool or marker has been moved.</summary>
        public void Forget(Anchor anchor)
        {
            Anchor saved = anchor ?? FindSaved();
            if (saved != null && saved.Persistent) saved.TrySetPersistent(false);
            try { if (File.Exists(storePath)) File.Delete(storePath); } catch (Exception e) { Log.Warn(e.Message); }
        }

        private string ReadSavedName()
        {
            try { return File.Exists(storePath) ? File.ReadAllText(storePath).Trim() : null; }
            catch (Exception e) { Log.Warn($"[MI-CHIPS] Could not read anchor store: {e.Message}"); return null; }
        }

        private void WriteSavedName(string name)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(storePath));
                File.WriteAllText(storePath, name);
            }
            catch (Exception e) { Log.Warn($"[MI-CHIPS] Could not write anchor store: {e.Message}"); }
        }
    }
}
