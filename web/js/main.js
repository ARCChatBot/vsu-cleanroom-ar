// =====================================================================================
//  main.js
//  MI-CHIPS (NSF #2606117): web AR lab data visualization.
//  • Desktop and phone: a three.js 3D scene with orbit controls; the mouse or touch
//    points at panels and data.
//  • AR (WebXR immersive-ar: HoloLens 2 Edge, Quest Browser, Android Chrome): views
//    float in the room. Hand rays or controllers point; air-tap / pinch / trigger selects.
//  Datasets: built-in samples, CSVs listed in data/index.json, and CSVs the user imports
//  or drops onto the page.
// =====================================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { allSamples } from './data/samples.js';
import { parseCsv } from './data/csv.js';
import { PlotView } from './views/plotView.js';
import { FieldView } from './views/fieldView.js';
import { ControlChartView } from './views/controlChartView.js';
import { SurfaceView } from './views/surfaceView.js';
import { WaferView } from './views/waferView.js';
import { Dashboard } from './views/dashboard.js';

// ---------------------------------------------------------------------------------
//  Renderer, scene, camera
// ---------------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x0b1220);
scene.background = BG;
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(1, 3, 2);
scene.add(sun);

const floor = new THREE.GridHelper(12, 24, 0x2a3c55, 0x1a2638);
floor.material.transparent = true;
floor.material.opacity = 0.6;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.6, 1.25);

// ---------------------------------------------------------------------------------
//  Pointers: mouse/touch + XR controllers/hands share one code path
// ---------------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointers = new Map();
const getPointer = (id) => {
  if (!pointers.has(id)) pointers.set(id, { id, ray: new THREE.Ray(), active: false, pressed: false, released: false, hover: null, drag: null });
  return pointers.get(id);
};

const app = {
  datasets: [],
  views: [],
  dashboard: null,
  isOpen: (d, kind) => app.views.some((v) => v.dataset === d && v.kind === kind),
  toggle: (d, kind) => (app.isOpen(d, kind) ? close(app.views.find((v) => v.dataset === d && v.kind === kind)) : open(d, kind)),
  arrange: () => arrange(),
  closeAll: () => [...app.views].forEach(close),
};

function interactiveMeshes() {
  const list = [...app.dashboard.interactables];
  for (const v of app.views) list.push(...v.interactables);
  return list;
}

const ndc = new THREE.Vector2();
function mouseRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = getPointer('mouse');
  p.ray.copy(raycaster.ray);
  p.active = true;
  return p;
}

// Registered before OrbitControls so a click on a panel can disable orbiting first.
renderer.domElement.addEventListener('pointerdown', (e) => {
  const p = mouseRay(e);
  raycaster.ray.copy(p.ray);
  const hit = raycaster.intersectObjects(interactiveMeshes(), false)[0];
  controls.enabled = !hit;
  p.pressed = true;
  processPointer(p); // handle the press where it happened, not a frame later
});
renderer.domElement.addEventListener('pointermove', (e) => mouseRay(e));
window.addEventListener('pointerup', (e) => {
  const p = mouseRay(e);
  p.released = true;
  processPointer(p); // apply the final drag position, then release
  controls.enabled = true;
});
renderer.domElement.addEventListener('pointerleave', () => { getPointer('mouse').active = false; });

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.35, 0);
controls.enableDamping = true;
controls.update();

// XR controllers (on HoloLens 2 these are the articulated-hand target rays)
const tmpM = new THREE.Matrix4();
const xrControllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 }));
  line.visible = false;
  c.add(line);
  c.userData.line = line;
  c.addEventListener('connected', () => { c.userData.connected = true; line.visible = true; });
  c.addEventListener('disconnected', () => { c.userData.connected = false; line.visible = false; getPointer('xr' + i).active = false; });
  c.addEventListener('selectstart', () => { getPointer('xr' + i).pressed = true; });
  c.addEventListener('selectend', () => { getPointer('xr' + i).released = true; });
  scene.add(c);
  return c;
});

function updateXrPointers() {
  xrControllers.forEach((c, i) => {
    const p = getPointer('xr' + i);
    p.active = !!c.userData.connected;
    if (!p.active) return;
    tmpM.identity().extractRotation(c.matrixWorld);
    p.ray.origin.setFromMatrixPosition(c.matrixWorld);
    p.ray.direction.set(0, 0, -1).applyMatrix4(tmpM).normalize();
  });
}

function processPointer(p) {
  if (!p.active && !p.drag) { if (p.hover) { p.hover.onLeave?.(); p.hover = null; } p.pressed = p.released = false; return null; }
  raycaster.ray.copy(p.ray);

  if (p.drag) {
    const point = p.ray.at(p.drag.dist, new THREE.Vector3());
    p.drag.root.position.copy(point.add(p.drag.offset));
    if (p.drag.face) faceViewer(p.drag.root);
    if (p.released) p.drag = null;
    p.pressed = p.released = false;
    return null;
  }

  const hit = raycaster.intersectObjects(interactiveMeshes(), false)[0];
  const target = hit?.object.userData.target ?? null;
  if (p.hover && p.hover !== target) p.hover.onLeave?.();
  p.hover = target;
  if (target) target.onHover?.(hit);
  if (p.pressed && target) {
    const r = target.onDown?.(hit);
    if (r?.dragRoot) {
      p.drag = { root: r.dragRoot, face: r.face, dist: hit.distance, offset: r.dragRoot.position.clone().sub(hit.point) };
    }
  }
  p.pressed = p.released = false;
  return hit;
}

// ---------------------------------------------------------------------------------
//  Views: open / close / place
// ---------------------------------------------------------------------------------

const camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
function viewerPose() {
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camDir);
  camDir.y = 0;
  if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
  camDir.normalize();
  return { pos: camPos.clone(), fwd: camDir.clone() };
}

function faceViewer(root) {
  camera.getWorldPosition(camPos);
  const target = root.userData.yawOnly ? new THREE.Vector3(camPos.x, root.position.y, camPos.z) : camPos;
  root.lookAt(target); // Object3D.lookAt points +Z at the target; panels and 3D views face +Z
}

// Arc slots (degrees, + = viewer's right). −34° is reserved for the dashboard.
const DASH_ANGLE = -34;
const SLOTS = [0, 34, 68, -68, 102, -102, 136, -136];
let nextSlot = 0;

function place(view, slot) {
  const { pos, fwd } = viewerPose();
  const inXR = renderer.xr.isPresenting;
  const ang = THREE.MathUtils.degToRad(SLOTS[slot % SLOTS.length]);
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const dir = fwd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(right, Math.sin(ang));
  const dist = (view.is3D ? 1.0 : 0.95) * (inXR ? 1 : 1.75) + Math.floor(slot / SLOTS.length) * 0.25;
  const p = pos.clone().addScaledVector(dir, dist);
  p.y = pos.y + (view.is3D ? (inXR ? -0.5 : -0.75) : -0.05); // look down onto 3D views
  view.root.position.copy(p);
  faceViewer(view.root);
}

function placeDashboard() {
  const { pos, fwd } = viewerPose();
  const inXR = renderer.xr.isPresenting;
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const ang = THREE.MathUtils.degToRad(DASH_ANGLE);
  const dir = fwd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(right, Math.sin(ang));
  const p = pos.clone().addScaledVector(dir, inXR ? 0.85 : 1.6);
  p.y = pos.y - 0.08;
  app.dashboard.root.position.copy(p);
  faceViewer(app.dashboard.root);
}

function createView(d, kind) {
  switch (d.kind) {
    case 'field': return kind === '3D' ? new SurfaceView(d) : new FieldView(d);
    case 'plot': return new PlotView(d);
    case 'spc': return new ControlChartView(d);
    case 'wafer': return new WaferView(d);
    default: return null;
  }
}

function open(d, kind) {
  if (app.isOpen(d, kind)) return;
  const v = createView(d, kind);
  if (!v) return;
  v.onClose = () => close(v);
  v.onOpenField = (field, k) => open(field, k);
  v.onInspect = (text) => xapi('inspected', d.id, text);
  place(v, nextSlot++);
  scene.add(v.root);
  app.views.push(v);
  app.dashboard.dirty = true;
  xapi('opened', d.id, kind);
}

function close(v) {
  if (!v) return;
  for (const p of pointers.values()) {
    if (p.drag?.root === v.root) p.drag = null;
    if (p.hover && v.interactables.some((m) => m.userData.target === p.hover)) p.hover = null;
  }
  scene.remove(v.root);
  v.dispose();
  app.views = app.views.filter((x) => x !== v);
  app.dashboard.dirty = true;
}

function arrange() {
  placeDashboard();
  app.views.forEach((v, i) => place(v, i));
  nextSlot = app.views.length;
}

// Analytics hook: swap for an xAPI statement emitter (LRS) in the progression system.
let lastXapi = '';
function xapi(verb, id, detail) {
  const line = `[xAPI] ${verb} ${id}: ${detail}`;
  if (line !== lastXapi) { console.info(line); lastXapi = line; }
}

// ---------------------------------------------------------------------------------
//  Datasets: samples, bundled CSVs, imported CSVs
// ---------------------------------------------------------------------------------

function addDataset(d) {
  const existing = app.datasets.findIndex((x) => x.id === d.id);
  if (existing >= 0) {
    app.views.filter((v) => v.dataset === app.datasets[existing]).forEach(close);
    app.datasets[existing] = d;
  } else app.datasets.push(d);
  app.dashboard?.refresh();
}

async function loadBundledCsvs() {
  try {
    const list = await (await fetch('data/index.json')).json();
    for (const name of list) {
      try { addDataset(parseCsv(await (await fetch('data/' + name)).text(), name)); }
      catch (e) { console.warn(`[DataViz] ${name}: ${e.message}`); }
    }
  } catch { /* no bundled data */ }
}

async function importFiles(files) {
  const loaded = [], failed = [];
  for (const file of files) {
    try {
      const d = parseCsv(await file.text(), file.name);
      addDataset(d);
      loaded.push(d);
    } catch (e) { failed.push(`${file.name}: ${e.message}`); }
  }
  for (const d of loaded) open(d, ({ plot: 'Plot', field: '2D', wafer: '3D map', spc: 'Chart' })[d.kind]);
  toast([loaded.length ? `Loaded ${loaded.map((d) => d.title).join(', ')}` : '', ...failed].filter(Boolean).join(' · '));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!msg) return;
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

document.getElementById('csv-input').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
document.getElementById('arrange-btn').addEventListener('click', () => arrange());
const drop = document.getElementById('drop');
window.addEventListener('dragover', (e) => { e.preventDefault(); drop.hidden = false; });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.hidden = true; });
window.addEventListener('drop', (e) => { e.preventDefault(); drop.hidden = true; importFiles([...e.dataTransfer.files].filter((f) => /\.csv$/i.test(f.name))); });

// ---------------------------------------------------------------------------------
//  Enter AR / VR
// ---------------------------------------------------------------------------------

const xrBtn = document.getElementById('xr-btn');
let xrMode = null;
async function setupXrButton() {
  if (!navigator.xr) { xrBtn.textContent = 'AR needs HTTPS + a WebXR browser'; return; }
  if (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)) xrMode = 'immersive-ar';
  else if (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)) xrMode = 'immersive-vr';
  if (!xrMode) { xrBtn.textContent = 'AR not supported here'; return; }
  xrBtn.textContent = xrMode === 'immersive-ar' ? 'Enter AR' : 'Enter VR';
  xrBtn.disabled = false;
}
xrBtn.addEventListener('click', async () => {
  if (renderer.xr.isPresenting) { renderer.xr.getSession().end(); return; }
  try {
    const session = await navigator.xr.requestSession(xrMode, {
      optionalFeatures: ['local-floor', 'hand-tracking', 'dom-overlay'],
      domOverlay: { root: document.body },
    });
    await renderer.xr.setSession(session);
  } catch (e) { toast('Could not start XR: ' + e.message); }
});

let arrangeNextFrames = 0;
renderer.xr.addEventListener('sessionstart', () => {
  const ar = xrMode === 'immersive-ar';
  scene.background = ar ? null : BG;
  floor.visible = !ar;
  xrBtn.textContent = 'Exit';
  arrangeNextFrames = 3; // wait for a valid head pose, then gather views around the user
});
renderer.xr.addEventListener('sessionend', () => {
  scene.background = BG;
  floor.visible = true;
  xrBtn.textContent = xrMode === 'immersive-ar' ? 'Enter AR' : 'Enter VR';
  camera.position.set(0, 1.6, 1.25);
  controls.target.set(0, 1.35, 0);
  controls.update();
  arrange();
});

// ---------------------------------------------------------------------------------
//  Boot + frame loop
// ---------------------------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

app.datasets = allSamples();
app.dashboard = new Dashboard(app);
scene.add(app.dashboard.root);
placeDashboard();
open(app.datasets.find((d) => d.id === 'process-window'), '2D');
open(app.datasets.find((d) => d.id === 'thermal'), '3D');
loadBundledCsvs();
setupXrButton();
window.__michips = { app, scene, camera }; // handy for debugging in the console

renderer.setAnimationLoop(() => {
  if (!renderer.xr.isPresenting) controls.update();
  if (arrangeNextFrames > 0 && --arrangeNextFrames === 0) arrange();

  updateXrPointers();
  for (const p of pointers.values()) {
    const hit = processPointer(p);
    const line = p.id.startsWith('xr') ? xrControllers[+p.id.slice(2)].userData.line : null;
    if (line) line.scale.z = hit ? hit.distance : 1.5;
  }

  app.dashboard.update();
  for (const v of app.views) v.update();
  renderer.render(scene, camera);
});
