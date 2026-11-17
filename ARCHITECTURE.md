# MI-CHIPS — AR Holographic Photolithography Trainer (HoloLens 2)

Technical blueprint for the Unity / OpenXR / MRTK3 build. Scripts live in `Scripts/`.

---

## 1. Target stack

| Layer | Package / setting | Notes |
|---|---|---|
| Engine | Unity 2022.3 LTS | UWP build target, ARM64, Release / Master config for perf testing |
| XR runtime | OpenXR Plugin + **Mixed Reality OpenXR Plugin** (1.10+) | Installed via the Mixed Reality Feature Tool. Supplies `ARMarkerManager` (QR codes) and `XRAnchorStore` (persistent anchors) |
| Trackables | AR Foundation 5.1 | `ARSession`, `ARAnchorManager`, `ARAnchor` |
| Interaction | MRTK3 (Core, Input, UX Core, UX Components, Spatial Manipulation) | `StatefulInteractable`, `PressableButton`, hand rays and poke/pinch |
| UI | TextMeshPro, world-space Canvas | MRTK3 Canvas backplate and buttons |
| Rendering | URP + MRTK Graphics Tools shaders | Single-pass instanced, 16-bit depth buffer sharing |

**OpenXR feature group (UWP tab):** Microsoft HoloLens, Hand Tracking, Hand Interaction, Eye Gaze Interaction.

**Package.appxmanifest capabilities (required):**
- `WebCam`: QR detection uses the PV camera. Without it, `ARMarkerManager` never reports markers.
- `SpatialPerception`: needed for spatial anchors and the anchor store.
- `GazeInput`: needed for eye gaze, if you use it.

---

## 2. Scene hierarchy

```
Scene
├── AR Session                         (ARSession)
├── MRTK XR Rig                        (XROrigin, ARAnchorManager, ARMarkerManager)  ← managers MUST sit on the XR Origin
│   ├── Camera Offset / Main Camera
│   └── MRTK Left/Right Hand Controllers (rays, poke, grab)
├── PhotolithographySim                (PhotolithographyARController)
│   └── ScanPrompt                     (optional "look at the QR code" tooltip, hidden after anchoring)
└── LithoMachine_Root                  (machineRoot, starts disabled, pivot = floor-level machine origin)
    ├── Chassis                        (chassisRoot: outer skins/doors, gets ghosted on explode)
    └── Assemblies                     (all sub-assembly roots are direct children; explode vectors use this space)
        ├── Z1_WaferHandlingRobot      base, link1, link2, end effector, pre-aligner
        ├── Z2_ProjectionOptics        UV source/illuminator, fold mirror assembly, reticle stage, projection lens
        ├── Z3_WaferStage              XY stage, wafer chuck, interferometer mirrors
        └── Z4_FluidElectricalRacks    chiller/TCU, vacuum, power distribution, controller rack
```

**Rules for the model**
- Every selectable leaf (for example `FoldMirror_Assembly` or `WaferChuck`) gets one `PhotolithographyPartData` asset and one collider. **Don't nest selectable parts**: an XRI interactable claims every collider under it, so a selectable parent would capture its children's colliders.
- Put each sub-assembly's pivot at its mounting point so it explodes cleanly along its own vector.
- Name objects by zone prefix (`Z1_`…`Z4_`). This keeps hierarchy, data assets and analytics IDs aligned.

---

## 3. Component breakdown

| Script | Type | Responsibility |
|---|---|---|
| `PhotolithographyARController` | MonoBehaviour (one per scene) | State machine, restoring a persisted anchor, QR detection and stability gating, creating and persisting the anchor, exploded-view coroutine, chassis ghosting, wiring part selection, spawning the card, analytics events |
| `PhotolithographyPartData` | ScriptableObject (one per part) | Part ID and name, zone, work-instruction steps (with safety flags), telemetry channel definitions. Curriculum authors edit these assets without touching the scene |
| `ITelemetrySource` / `SimulatedTelemetrySource` | Interface / class | Produces telemetry values. The default uses Perlin noise around a nominal value. Swap in an MQTT/OPC UA bridge later and leave the UI as is |
| `WorkInstructionCard` | MonoBehaviour on the card prefab | VSU-branded floating panel: header, step pager, live telemetry with out-of-range highlighting, yaw-billboarding, close |

### State machine

```
Idle ──► ScanningForMarker ──(QR payload match, stable ≥ 1 s)──► Locking ──(ARAnchor tracked, persisted)──► Anchored
  │                                                                                                         │  ▲
  └──(persisted anchor found & tracked at startup)──────────────────────────────────────────────────────────┘  │
                                                                                Anchored ⇄ Exploding ⇄ Exploded ⇄ Collapsing
ResetAndRescan() from any state ──► ScanningForMarker
```

### Runtime data flow

```
ARMarkerManager.markersChanged ─► payload filter ─► pose stability window ─► ARAnchor ─► XRAnchorStore.TryPersistAnchor
                                                                                    └─► machineRoot parented & scaled
Hand ray / pinch ─► StatefulInteractable.OnClicked ─► OnPartSelected(part)
                                                         ├─► WorkInstructionCard.Show(data, telemetrySource)
                                                         └─► onPartSelected(partId) UnityEvent ─► xAPI/LRS logger (progression)
Hand menu / voice / button ─► ToggleExploded() ─► coroutine: staggered Lerp + AnimationCurve, chassis alpha fade
```

---

## 4. Default exploded-view vectors

These are in `Assemblies` local space. Adjust them once the real CAD is in.

| Zone | Direction | Distance (m) | Stagger (s) |
|---|---|---|---|
| Z1 Wafer handling robot | (-1, 0, 0.3) | 0.45 | 0.00 |
| Z2 Projection / UV optics | (0, 1, 0) | 0.50 | 0.08 |
| Z3 Wafer stage chuck | (0, 0, 1) | 0.40 | 0.16 |
| Z4 Fluid / electrical racks | (1, 0, -0.2) | 0.45 | 0.24 |

Collapse plays the stagger in reverse, so the last part out is the first part back.

---

## 5. Sample part content

**These are placeholders.** Have a cleanroom equipment SME check every step against the OEM maintenance manual and your site's EHS/LOTO procedures before students use them.

| Part ID | Name | Example steps | Telemetry (nominal ± noise) |
|---|---|---|---|
| LITHO-Z1-ROB | Wafer handling robot | Verify the FOUP is seated → home the robot → teach-position check → end-effector vacuum check | End-effector vacuum −80 ± 2 kPa; axis-2 motor temp 34 ± 1.5 °C |
| LITHO-Z2-SRC | UV illumination source | **[SAFETY]** Confirm the laser interlock and that the shutter is closed → check the lamp/laser hour meter → measure the dose at the reticle plane | Wavelength 193.368 ± 0.0005 nm (ArF) or 365.0 nm (i-line); pulse energy 10 ± 0.3 mJ |
| LITHO-Z2-MIR | Fold mirror assembly | **[SAFETY]** Source off and locked out → inspect for contamination with a UV-safe lamp → N₂ purge flow check → no touching optical surfaces | Purge flow 5 ± 0.2 L/min; mirror temp 22.0 ± 0.05 °C |
| LITHO-Z2-LNS | Projection lens | Check lens pressure/temperature control → review the focus/aberration calibration log | Lens temp 22.00 ± 0.01 °C; pressure 101.3 ± 0.05 kPa |
| LITHO-Z3-STG | Wafer stage chuck | Clean the chuck with an approved wipe → vacuum leak-up test → run the interferometer calibration | Stage temp 22.00 ± 0.01 °C; chuck vacuum −85 ± 1 kPa; position error 0 ± 3 nm |
| LITHO-Z4-RCK | Fluid / electrical racks | **[SAFETY]** LOTO on main disconnect → verify zero energy → check chiller level and flow → inspect for leaks | Chiller supply 21.5 ± 0.1 °C; flow 12 ± 0.4 L/min; 208 VAC ± 2 |

---

## 6. HoloLens 2 constraints

- **Performance budget:** hold 60 fps with ≤ ~100k visible triangles and ≤ ~100 draw calls. Decimate the CAD (Pixyz or Blender), bake small fasteners into normal maps, and merge static meshes within each zone.
- **Ghosting cost:** the chassis switches to a transparent material only while exploded. Transparent overdraw is expensive on HL2, so keep the chassis low-poly.
- **Additive display:** dark colours render as see-through. Trojan Blue `#002B49` will look like a translucent dark-tinted plate, which is fine for a backplate. All body text must be white or near-white. Trojan Orange `#FF6600` on Trojan Blue measures about a 5:1 contrast ratio, so it's acceptable for headers and warnings.
- **UI comfort:** the card spawns 0.45–1.0 m from the user, so its buttons are reachable by direct poke as well as by far-ray pinch. Use text of at least 12 pt-equivalent at 0.5 m.
- **QR markers:** print 10–15 cm codes on matte stock with a 4-module quiet zone, and keep the payload short (for example `MICHIPS-LITHO-01`). Mount the code rigidly on the tool and measure the offset from marker to machine origin with a tape. That offset goes into `markerToMachinePositionOffset` / `EulerOffset`.
- **Marker axes:** confirm the marker axis convention for your plugin version. Enable the `ARMarkerManager` marker prefab with an axis gizmo once and check which local axis is the QR normal, then set `markerNormalAxis` to match.
- **Re-anchoring:** after the first successful lock, later sessions restore the persisted anchor with no scan. If the tool or marker moves, call `ResetAndRescan()` (from a hand-menu "Recalibrate" button).

---

## 7. Analytics and progression hooks

`PhotolithographyARController` exposes `onAnchored`, `onExplodedChanged(bool)`, `onPartSelected(string partId)` and `onSelectionBlocked`. Bind them in the inspector to an xAPI statement emitter, for example "student *inspected* LITHO-Z2-MIR". The card can raise step-completion events the same way through `WorkInstructionCard.StepChanged`.
