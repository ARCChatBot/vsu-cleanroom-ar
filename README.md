# VSU Cleanroom AR

Operation SEMI / MI-CHIPS (Mixed Immersion Cleanroom & Hardware Intelligence & Progression System), NSF Award #2606117.

**Immersive, web-based AR lab data visualization** for microelectronics. Measurement data, simulation fields and quality-control metrics appear as 2D plots, heatmaps, contour plots and 3D renderings that you can move, scale, rotate and **explode** into layers, and you can ask an **AI analyst** about them by voice. It runs in any modern browser, and **Enter AR** places the views in your room on HoloLens 2 (Edge), Meta Quest (Browser) or Android (Chrome). There is no app to install.

**Live site:** https://arcchatbot.github.io/vsu-cleanroom-ar/ (redeploys on every push to `main` that touches `web/`)

The web app is in [`web/`](web), and the optional AI proxy is in [`proxy/`](proxy). The earlier native StereoKit/C# version is still in `src/` and `app/` ([details below](#legacy-stereokit-c-version)).

## Run it locally

```bash
python3 web/serve.py
```

Then open http://localhost:5173. `serve.py` is a tiny static server with caching turned off, so edits show up on reload.

**On a headset or phone:** WebXR only runs over **HTTPS** (localhost is the one exception), so use the live site or any HTTPS static host. Open the URL in Edge on HoloLens 2 (or Quest Browser, or Android Chrome) and tap **Enter AR**. The views gather around you. Point with your hand ray (HoloLens), controller (Quest) or finger (phone), then air-tap, pull the trigger or tap to select. Set up **AI settings** *before* entering AR, because the page controls aren't reachable inside a headset session.

## What's in it

| Category | Dataset (built-in sample) | Views | Explode separates |
|---|---|---|---|
| Measurement | NMOS output curves (I_D–V_DS, 5 gate voltages) | 2D plot | each curve onto its own layer |
| Measurement | 300 mm sheet-resistance wafer map (512 dies) | 3D bar map with stats | dies spread apart; out-of-spec dies lift up |
| Measurement | MOS capacitor C–V (from `web/data/mos_cv.csv`) | 2D plot | each curve |
| Simulation | MOSFET cross-section potential (Laplace solve) | heatmap + contours, 3D surface | heatmap / iso-lines; surface tiers |
| Simulation | MOSFET electric field \|E\| (peaks at the drain edge) | heatmap + contours, 3D surface | heatmap / iso-lines; surface tiers |
| Simulation | Die thermal map (4 CPU cores + GPU, 85 °C threshold) | heatmap + contours, 3D surface | heatmap / iso-lines / threshold; surface tiers |
| Quality | Litho process window (CD vs focus × dose, 43/47 nm spec) | contour map, 3D surface | heatmap / iso-lines / spec limits |
| Quality | Gate-CD SPC chart (60 lots, baseline limits, excursion + drift) | control chart, WE rules 1–4, Cp / Cpk / Ppk | control limits / spec limits / data / violations |

**Moving and reading the data (same with a mouse, hand ray, controller or finger)**
- **Move:** drag a panel by its title bar, or a 3D view by its base plate. It turns to face you.
- **Scale:** the **−** and **+** buttons in each title bar. On desktop, you can also scroll over a view.
- **Rotate:** the ⟲ ⟳ buttons on 3D surfaces and the wafer map.
- **Explode:** the **Explode** button on any view, **Explode all** on the dashboard or AI panel, or say "explode the wafer map". The layers animate apart into a labelled 3D stack and back.
- **Read values:** point at a plot, heatmap, surface or die to read the value under the pointer.
- **Dashboard:** a button per view type, plus **Arrange around me**, which gathers every open view on an arc in front of you.
- **Desktop only:** drag empty space to orbit, scroll elsewhere to zoom.

## AI analyst (voice)

Talk with the **mic** button in the ask bar, or with **Talk** / **Hands-free** on the in-room **AI Analyst** panel (works in AR). You can also type in the ask bar. Answers appear on the panel and are read aloud.

- **Commands work with no setup and offline**, for example "explode all", "collapse the control chart", "open the thermal map in 3D", "close the wafer map", "arrange", "make it bigger", "rotate left". "It" or "this" means the view you last touched.
- **Questions need Claude** (`claude-opus-5-5`), for example "Where is the hottest spot on the die?", "Is the gate CD process capable?", "Which wafer region is out of spec?" or "Compare the high-frequency and quasi-static C–V curves". Claude answers from compact summaries of every dataset, and can also open, explode, recolour and arrange views itself.
- **Connecting Claude:** open **AI settings** and either:
  - paste **your own Anthropic API key**. It is stored only in that browser (optionally remembered) and sent only to Anthropic. Fine for your own device; don't do it on shared computers; or
  - paste a **proxy URL**. This is recommended for classes: the key stays on a server you control, so students need nothing. Deploy it from [`proxy/`](proxy) in about 5 minutes.
- **Browser support for voice:** Chrome and Edge (desktop, Android, and Edge on HoloLens 2) support speech recognition. Firefox doesn't, but typing works everywhere.
- **Code:** the analyst lives in `web/js/ai/`. `analyst.js` holds the local command parser, the Claude tool loop and an offline fallback; `summaries.js` holds the data context; `voice.js` handles speech in and out.

## Colours and type

The UI follows the **Operation SEMI / MI-CHIPS presentation color system** (C01–C12), defined as `PALETTE` in `web/js/render/chart.js`.

- **Surfaces:** Deep Academic Slate surfaces with Night Slate title bars.
- **Text:** white headlines, Body Silver body text, Advisor Blue Gray eyebrow labels and Caption Frost captions.
- **Accents:** Trojan Blue for primary actions and value tags, Technology Ice Blue for live highlights and pointer rays. Precision Orange appears only as a small accent: title rules, active-state dots, spec limits and out-of-spec markers.
- **Type:** Inter throughout.

**Data colours:** **MI-CHIPS Ice** (Trojan Blue → Ice Blue → Caption Frost) for sequential data, and **MI-CHIPS Diverging** (Trojan Blue → Frost → Orange) for data around a midpoint. **Holo** maps (higher minimum brightness, good in bright rooms on HoloLens' additive display), Viridis and Inferno are one click away.

**Analytics:** opening views, inspecting values and asking questions log `[xAPI] …` lines to the console. The hook is the `xapi()` function in `web/js/main.js`; point it at your LRS.

**Sample data:** the built-in datasets are deterministic, teaching-grade models. They are not calibrated TCAD or metrology results.

## Bring your own data (CSV)

Click **Import CSV**, or drop `.csv` files anywhere on the page. To ship datasets with the app, put them in `web/data/` and list them in `web/data/index.json`. Each file starts with `#` metadata; `type` is required.

| `# type:` | Body | Useful keys |
|---|---|---|
| `series` | header row `x,<name1>,<name2>,...` then rows | `x`, `y` axis labels |
| `field` | numeric matrix; first row = `ymin`, columns run `xmin → xmax` | `xmin xmax ymin ymax`, `x`, `y`, `quantity`, `unit`, `highlight: 43, 47`, `diverging: true` |
| `wafer` | `x_mm,y_mm,value` rows | `quantity`, `unit`, `lsl`, `usl`, `diameter: 300`, `die: 10 x 12` |
| `spc` | one value per row | `quantity`, `unit`, `target`, `lsl`, `usl`, `baseline: 20` |

Common keys: `title`, `description`, `source`, `category` (measurement | simulation | quality). See `web/data/mos_cv.csv`. Exports from probe stations, 4-point probes, ellipsometers, COMSOL or Sentaurus can be reshaped into these formats.

## Code layout

```
web/
  index.html, css/style.css     page shell: header, ask bar + mic, AI settings dialog
  serve.py                      no-cache local dev server
  data/                         bundled CSVs + index.json
  js/main.js                    scene, pointer input (mouse + XR hands/controllers), placement, scale/explode actions, CSV import, WebXR
  js/data/                      dataset models + SPC/wafer stats, built-in samples, CSV parser
  js/render/                    MI-CHIPS palette + chart frame, colormaps, contours, CanvasPanel (layers + explode), labels
  js/views/                     dashboard, AI panel, plot, field (2D), control chart, surface (3D), wafer map (3D)
  js/ai/                        analyst (commands + Claude tools), dataset summaries, voice in/out
proxy/                          Cloudflare Worker that holds the Anthropic key for classroom use
```

three.js 0.160.0 and (on first AI question) the Anthropic SDK 1.3.0 load from the jsDelivr CDN, and Inter from Google Fonts. There is no build step. For offline lab use, download `three.module.js` and the `examples/jsm` folder into `web/vendor/` and point the import map there.

---

## Legacy StereoKit (C#) version

The native HoloLens 2 build that came before the web app is kept for reference. It isn't needed for the web app.

### Lab data visualization (StereoKit)

| Category | Dataset (built-in sample) | Views |
|---|---|---|
| Measurement | NMOS output curves (I_D–V_DS, 5 gate voltages) | 2D plot with nearest-point readout |
| Measurement | 300 mm sheet-resistance wafer map (512 dies) | 3D bar wafer map, out-of-spec caps, mean/σ/CV/uniformity/in-spec % |
| Measurement | MOS capacitor C–V (example **CSV** in `Assets/Data`) | 2D plot |
| Simulation | MOSFET cross-section potential (Laplace solve) | heatmap + contours, 3D surface |
| Simulation | MOSFET electric field \|E\| (peaks at the drain edge) | heatmap + contours, 3D surface |
| Simulation | Die thermal map (4 CPU cores + GPU, 85 °C throttle contour) | heatmap + contours, 3D surface |
| Quality | Litho process window (CD vs focus × dose, 43/47 nm spec contours) | contour map, 3D surface |
| Quality | Gate-CD SPC chart (60 lots, baseline limits, excursion + drift) | control chart, Western Electric rules 1–4, Cp/Cpk/Ppk |

**Interaction**
- **Dashboard:** open any dataset as **2D**, **3D**, **Plot**, **Chart** or **3D map**. Use **Arrange around me** to re-place every open view on an arc.
- **Moving views:** grab any window by its title bar, or a 3D view by its base plate.
- **Reading values:** point a hand ray at a chart, heatmap, surface or die to read the value under it. Surfaces use ray-marching, so the readout lands on the actual height.
- **2D field controls:** heatmap and contour toggles, a contour-level slider, colormap cycling, and **Open as 3D surface**.
- **3D surface controls:** height scale, contours on the surface and/or projected on the floor, and a colourbar the same height as the surface (a colour sits at the same height as that value on the surface).
- **Analytics:** `DataVizHost.ViewOpened` and `Inspected` events, logged as `[xAPI]` lines.

**HoloLens colour note:** the display is additive, so black renders as transparent. The default colormaps (**Holo**, **Holo Diverging**) keep a lifted minimum brightness. Viridis and Inferno are available for screenshots, but their dark ends fade out in the headset.

**Sample data:** the built-in datasets are deterministic, teaching-grade models (square-law MOSFET, SOR Laplace solve, diffusion thermal solve). They are not calibrated TCAD or metrology results.

### Bring your own data (CSV)

Drop `.csv` files into `app/VsuCleanroomAR.Desktop/Assets/Data/` (or the HoloLens head's `Assets/Data/`). They appear on the dashboard at startup. Each file starts with `#` metadata; `type` is required.

| `# type:` | Body | Useful keys |
|---|---|---|
| `series` | header row `x,<name1>,<name2>,...` then rows | `x`, `y` axis labels |
| `field` | numeric matrix; first row = `ymin`, columns run `xmin → xmax` | `xmin xmax ymin ymax`, `x`, `y`, `quantity`, `unit`, `highlight: 43, 47`, `diverging: true` |
| `wafer` | `x_mm,y_mm,value` rows | `quantity`, `unit`, `lsl`, `usl`, `diameter: 300`, `die: 10 x 12` |
| `spc` | one value per row | `quantity`, `unit`, `target`, `lsl`, `usl`, `baseline: 20` |

Common keys: `title`, `description`, `source`, `category` (measurement | simulation | quality). See `Assets/Data/mos_cv.csv` for a working example. Exports from probe stations, ellipsometers, 4-point probes, COMSOL or Sentaurus can be reshaped into these four formats.

### Layout (data visualization)

```
src/MiChips.Cleanroom/DataViz/
  DataVizHost.cs                 dashboard, view placement, analytics events
  Data/Datasets.cs               PlotData, FieldGrid, WaferMap, ControlChart (+ SPC rules, Cp/Cpk/Ppk)
  Data/SampleData.cs             built-in sample datasets
  Data/CsvLoader.cs              Assets/Data/*.csv import
  Render/Colormap.cs             Holo-safe and classic colormaps
  Render/GridMesh.cs             vertex-coloured heatmap / surface / colourbar meshes
  Render/Contours.cs             marching-squares iso-lines
  Render/VizDraw.cs              PlotFrame (axes, ticks, ray readout), text styles, line helpers
  Views/PlotView.cs, ControlChartView.cs, FieldView.cs, SurfaceView.cs, WaferMapView.cs
```

### Equipment trainer mode

Run with `AppBootstrap.Run(markers, AppMode.EquipmentTrainer)` to get the QR-anchored equipment trainers: a picker, exploded views and work-instruction cards.

### Layout

```
src/MiChips.Cleanroom/                 shared library (netstandard2.0, StereoKit 0.3.9)
  Core/
    TrainerHost.cs                     top-level stepper: equipment picker, QR auto-detect, runs one tool at a time
    EquipmentARController.cs           per-tool state machine: anchor restore → QR scan → lock → explode → select
    EquipmentDefinition.cs             what a tool module provides (id, name, QR payload, marker offset, model builder)
    MachineModel.cs                    zones/parts scene graph, explode animation, chassis ghosting, ray hit-test, path overlay
    WorkInstructionCard.cs             branded card UI + Brand theme
    PartData.cs                        part/step/telemetry types, ITelemetrySource + simulator
    Shapes.cs                          primitive + telemetry helpers for building placeholder models
    Markers.cs, AnchorService.cs       IMarkerSource + simulator; create/persist/restore StereoKit Anchors
    AppBootstrap.cs                    startup, equipment list, analytics hooks
  Lithography/LithoToolFactory.cs      photolithography tool model + part catalogue
  Packaging/PackagingCellFactory.cs    advanced packaging bonder model + 3D-stack exhibit + catalogue
app/VsuCleanroomAR.Desktop/            net8 head: flatscreen simulator (Windows/Linux)
app/VsuCleanroomAR.HoloLens/           files for the UWP head: QR source, Program.cs, manifest capabilities
```

### How it works

```
Picker ─(QR seen / button)─► EquipmentARController
   saved anchor? ──yes──► wait until tracked ──► Anchored
        │ no / timeout
        ▼
   QR scan ─► pose stable ≥ 1 s ─► Anchor.FromPose ─► persist ─► Anchored
   Anchored ⇄ Exploding ⇄ Exploded ⇄ Collapsing     ("Recalibrate" → QR scan, "Switch equipment" → Picker)
   Exploded + hand-ray pinch on a part ─► WorkInstructionCard
```

- **Placement:** the tool pose is gravity-aligned, taking only yaw from the QR code. Each tool's `MarkerToMachineOffset` is the measured offset from the QR centre to the machine origin (floor centre). The axes are +X right, +Y up, +Z toward the trainee.
- **Exploded view:** each zone moves along its own vector with a stagger and an ease-out-back curve, and collapse plays the stagger in reverse. The chassis fades to 15% alpha, and a path overlay appears: the UV beam for litho (purple), the die-transfer path for packaging (cyan).
- **Analytics:** each controller raises `Anchored`, `ExplodedChanged`, `PartSelected`, `StepChanged` and `SelectionBlocked`. `TrainerHost.ControllerStarted` hands you each new controller. `AppBootstrap` logs `[xAPI]` lines; swap in a real LRS emitter.
- **Live data:** implement `ITelemetrySource` (for example over MQTT or OPC UA) and call `SetTelemetrySource()`.

### Advanced packaging module

A die-to-wafer bonder of the kind used to build **multichip modules (2.5D, on an interposer)** and **3D die stacks** (HBM-style).

| Part ID | Part | Telemetry (simulated) |
|---|---|---|
| PKG-Z1-EJT | Die ejector & tape-frame stage | ejector vacuum, needle rise, stage temp |
| PKG-Z2-BH | Bond head (TCB ~300 °C, force-controlled) | head temp, bond force, parallelism |
| PKG-Z2-VIS | Dual vision alignment (up- and down-looking cameras) | X/Y offset (µm), rotation, illumination |
| PKG-Z3-STG | Bond stage & heated chuck | chuck temp, vacuum, position error |
| PKG-Z4-PLS | Plasma activation chamber (hybrid bonding prep) | RF power, pressure, N₂ flow |
| PKG-Z4-DSP | Underfill / NCF dispenser | pressure, needle temp, shot weight |

**Die-transfer path (cyan overlay):** the ejector pushes the die up from the tape, the flipper flips it, the bond head picks it, it aligns over the up-looking camera, then it's bonded to the target site on the chuck.

**3D-stack exhibit** (floats to the left of the tool, not to scale): organic substrate with BGA balls, then a silicon interposer with C4 bumps and TSVs, then a logic die on microbumps next to an HBM stack (a base die plus 4 DRAM core dies with TSVs). On explode, every layer fans upward. Pinch a layer to get its learning card (the pager shows **POINT** items, with no telemetry).

### Adding another tool

1. Create `src/MiChips.Cleanroom/<Area>/<Tool>Factory.cs` with a static `EquipmentDefinition Definition` and a `Build(string modelsFolder)` that returns a `MachineModel`. Use the `Shapes` helpers.
2. Add it to `AppBootstrap.AllEquipment`.
3. Print its QR code and measure the marker offset.

### Running

### Desktop simulator (Windows or Linux)

```bash
dotnet run --project app/VsuCleanroomAR.Desktop
```

The dashboard opens with a process-window contour map and a 3D thermal surface. Use the simulated hand (mouse) to point at data, and grab windows or base plates to move them. In equipment mode: choose a tool, click **Simulate marker** (or press **M**), press **E** to explode, then pinch a part.

> StereoKit doesn't ship macOS binaries. On a Mac, the library compiles but the simulator won't launch.

### HoloLens 2 (Windows, Visual Studio 2022)

1. Install the UWP workload, the Windows 10/11 SDK and the StereoKit Visual Studio templates.
2. Create a **StereoKit UWP** project at `app/VsuCleanroomAR.HoloLens/` (keep the files already there).
3. Add a project reference to `src/MiChips.Cleanroom`, and the NuGet package `Microsoft.MixedReality.QR`.
4. Replace the template's `Program.cs` with the one in this folder, and include `QrCodeMarkerSource.cs`.
5. Merge `Package.appxmanifest.capabilities.xml` into `Package.appxmanifest`. **`webcam` (QR) and `spatialPerception` (anchors) are required.**
6. Build Release | ARM64 and deploy to the device.

### On-device calibration checklist (per tool)

- [ ] Print the tool's QR code at 10–15 cm on matte stock with a 4-module quiet zone, and mount it rigidly on the tool.
- [ ] During the scan, an axis gizmo is drawn on the code. Its blue axis (Z) should point **into** the panel. If it doesn't, set `QrCodeMarkerSource.FlipNormal`.
- [ ] Measure the offset from the QR centre to the machine origin and set it in the tool's `Definition`.
- [ ] After the first lock, relaunch the app. The picker should show "(saved position)" and the tool should restore without scanning.

### Real CAD

The built-in geometry is a placeholder. For each part, export a GLB to `Assets/Models/<PartId>.glb` (for example `PKG-Z2-BH.glb`) and it replaces that part's primitives automatically. On HoloLens 2, aim for about 100k visible triangles in total.

### Content warning

All maintenance steps, telemetry ranges and process numbers in the factory files are **placeholders or typical industry ranges**. Have an equipment SME validate them against the OEM manual and the site's EHS/LOTO procedures before students use them.
