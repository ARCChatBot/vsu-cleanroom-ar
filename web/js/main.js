// =====================================================================================
//  main.js
//  MI-CHIPS (NSF #2606117): web AR lab data visualization.
//  • Desktop and phone: a three.js scene with orbit controls; the mouse or touch points
//    at panels and data, and the scroll wheel over a view scales it.
//  • AR (WebXR immersive-ar: HoloLens 2 Edge, Quest Browser, Android Chrome): views
//    float in the room. Hand rays or controllers point; air-tap / pinch / trigger selects.
//  • Every view can be moved, scaled, rotated (3D) and exploded into layers.
//  • AI analyst: voice or typed questions, local commands, Claude-powered analysis.
//  Colours: Operation SEMI / MI-CHIPS presentation color system (see render/chart.js).
// =====================================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { allSamples } from './data/samples.js';
import { parseCsv } from './data/csv.js';
import { VIEW_KINDS, snapshot } from './data/datasets.js';
import { PALETTE } from './render/chart.js';
import { COLORMAPS } from './render/colormap.js';
import { PlotView } from './views/plotView.js';
import { FieldView } from './views/fieldView.js';
import { ControlChartView } from './views/controlChartView.js';
import { SurfaceView } from './views/surfaceView.js';
import { WaferView } from './views/waferView.js';
import { Dashboard } from './views/dashboard.js';
import { CanvasPanel, easeInOut, makeDynamicLabel } from './render/panel.js';
import { FocusPanel } from './views/focusPanel.js';
import { AiPanel } from './views/aiPanel.js';
import { Analyst, loadSettings, saveSettings, aiConfigured } from './ai/analyst.js';
import { Voice, speak, stopSpeaking, voiceSupported } from './ai/voice.js';
import { requireSignIn, signOut, elapsedSeconds, formatDuration } from './auth.js';

// Canvas text needs Inter loaded before the first panel draws.
await Promise.race([
  Promise.all(['400 20px Inter', '600 20px Inter', '700 20px Inter', '800 20px Inter'].map((f) => document.fonts.load(f))),
  new Promise((r) => setTimeout(r, 2500)),
]).catch(() => {});

// Students sign in (VSU ID + name) before the app starts. Kept on this device only.
const user = await requireSignIn();
document.getElementById('user-name').textContent = `${user.first} ${user.last} · ${user.id}`;
document.getElementById('user-chip').hidden = false;
document.getElementById('signout-btn').addEventListener('click', () => {
  xapi('signed out', 'session', `total time ${formatDuration(elapsedSeconds(user))}`);
  signOut();
});
const sessionClock = () => formatDuration(elapsedSeconds(user));

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
const BG = new THREE.Color(PALETTE.deepSlate);
scene.background = BG;
scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2638, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(1, 3, 2);
scene.add(sun);

const floor = new THREE.GridHelper(12, 24, PALETTE.labelSlate, PALETTE.nightSlate);
floor.material.transparent = true;
floor.material.opacity = 0.7;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 30); // near/far also set the headset depth range
camera.position.set(0, 1.6, 1.25);

// ---------------------------------------------------------------------------------
//  App state + actions (shared by buttons, voice, typed questions and the AI)
// ---------------------------------------------------------------------------------

const settings = loadSettings();
let focusedView = null;

const app = {
  user,
  datasets: [],
  views: [],
  dashboard: null,
  aiPanel: null,
  isOpen: (d, kind) => app.views.some((v) => v.dataset === d && v.kind === kind),
  toggle: (d, kind) => (app.isOpen(d, kind) ? close(app.views.find((v) => v.dataset === d && v.kind === kind)) : open(d, kind)),
  arrange: () => arrange(),
  closeAll: () => [...app.views].forEach(close),
  focused: () => focusedView || app.views[app.views.length - 1] || null,
  anyExploded: () => app.views.some((v) => v.exploded),
  aiReady: () => aiConfigured(settings),
  listening: () => voice.listening,
  handsFree: () => voice.handsFree,
  toggleListening: () => { voice.toggle(); app.aiPanel.dirty = true; },
  toggleHandsFree: () => { voice.handsFree ? voice.stop() : voice.start(true); app.aiPanel.dirty = true; },
  stopSpeaking: () => stopSpeaking(),
  exitFocus: () => exitFocus(),
  focusedView: () => focus?.view || null,

  /** Refresh every view of a dataset after it was manipulated, and restart the AI context. */
  dataChanged(d) {
    for (const v of app.views) if (v.dataset === d) v.refresh?.();
    analyst.reset();
    if (focus) focus.panel.dirty = true;
    app.dashboard.dirty = true;
  },

  /** Executes an action object and returns a short sentence describing what happened. */
  execute(a) {
    const byId = (id) => app.datasets.find((d) => d.id === id);
    const viewsOf = (id) => app.views.filter((v) => v.dataset.id === id);
    switch (a.type) {
      case 'open': {
        const d = byId(a.datasetId);
        if (!d) return 'I could not find that dataset.';
        const kind = VIEW_KINDS[d.kind].includes(a.view) ? a.view : VIEW_KINDS[d.kind][0];
        open(d, kind);
        focusedView = app.views.find((v) => v.dataset === d && v.kind === kind) || focusedView;
        return `Opened ${d.title}${VIEW_KINDS[d.kind].length > 1 ? ` in ${kind}` : ''}.`;
      }
      case 'close': {
        const vs = viewsOf(a.datasetId);
        vs.forEach(close);
        return vs.length ? `Closed ${vs[0].dataset.title}.` : 'That view is not open.';
      }
      case 'closeAll': app.closeAll(); return 'Closed all views.';
      case 'explode': {
        let targets = a.target === 'all' ? app.views : viewsOf(a.target);
        if (!targets.length && a.target !== 'all' && a.exploded) {
          const d = byId(a.target);
          if (d) { open(d, VIEW_KINDS[d.kind][d.kind === 'field' ? 1 : 0]); targets = viewsOf(a.target); }
        }
        targets.forEach((v) => v.setExploded(a.exploded));
        app.dashboard.dirty = app.aiPanel.dirty = true;
        if (!targets.length) return 'There are no open views to explode.';
        const what = a.target === 'all' ? 'all views' : targets[0].dataset.title;
        return `${a.exploded ? 'Exploded' : 'Collapsed'} ${what}.`;
      }
      case 'arrange': arrange(); return 'Arranged the views around you.';
      case 'focus': {
        const d = byId(a.datasetId) || app.focused()?.dataset;
        if (!d) return 'Which chart should I focus on?';
        let v = viewsOf(d.id)[0];
        if (!v) { open(d, VIEW_KINDS[d.kind][0]); v = viewsOf(d.id)[0]; }
        enterFocus(v);
        return `Focused on ${d.title}. Use the toolbar under it to adjust the data, or say "done".`;
      }
      case 'unfocus': exitFocus(); return 'Back to all views.';
      case 'setSpec': {
        const d = byId(a.datasetId) || [focus?.view, app.focused()].map((v) => v?.dataset).find((x) => x && (x.kind === 'wafer' || x.kind === 'spc'));
        if (!d || !(d.kind === 'wafer' || d.kind === 'spc')) return 'Spec limits apply to the wafer map and the control chart. Focus one of them first.';
        snapshot(d, ['lsl', 'usl', 'baseline']);
        const other = a.which === 'lsl' ? d.usl : d.lsl;
        if (other != null && (a.which === 'lsl' ? a.value >= other : a.value <= other)) return `That would put the ${a.which.toUpperCase()} past the other limit (${other}).`;
        d[a.which] = a.value;
        app.dataChanged(d);
        const stat = d.kind === 'wafer' ? `${d.inSpecPct.toFixed(1)}% of dies are now in spec` : `Cpk is now ${d.cpk.toFixed(2)} and Ppk ${d.ppk.toFixed(2)}`;
        return `Set the ${a.which.toUpperCase()} of ${d.title} to ${a.value} ${d.unit}. ${stat}.`;
      }
      case 'scale': {
        const v = app.focused();
        if (!v) return 'Open a view first.';
        scaleRoot(v.root, a.factor);
        return a.factor > 1 ? `Made ${v.dataset.title} bigger.` : `Made ${v.dataset.title} smaller.`;
      }
      case 'rotate': {
        const v = app.focused();
        if (!v) return 'Open a view first.';
        if (v.rotate) v.rotate(a.degrees); else v.root.rotateY(THREE.MathUtils.degToRad(a.degrees));
        return `Rotated ${v.dataset.title}.`;
      }
      case 'colormap': {
        const idx = COLORMAPS.findIndex((c) => c.name.toLowerCase() === String(a.colormap).toLowerCase());
        const vs = viewsOf(a.datasetId).filter((v) => 'cmapIdx' in v);
        if (idx < 0 || !vs.length) return 'That view has no colormap to change.';
        for (const v of vs) {
          v.cmapIdx = idx;
          if (v.rebuild) v.rebuild(); else if (v.applyColormap) v.applyColormap(); else v.layout?.();
          v.dirty = true; if (v.panel) v.panel.dirty = true;
        }
        return `Switched ${vs[0].dataset.title} to the ${COLORMAPS[idx].name} colormap.`;
      }
      default: return '';
    }
  },
};

function scaleRoot(root, f) {
  const k = root.scale.x / (root.userData.userScale ?? 1); // current XR multiplier
  root.userData.userScale = THREE.MathUtils.clamp((root.userData.userScale ?? 1) * f, 0.35, 3.5);
  root.scale.setScalar(root.userData.userScale * k);
}

// ---------------------------------------------------------------------------------
//  Pointers: mouse/touch + XR controllers/hands share one code path
// ---------------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointers = new Map();
const getPointer = (id) => {
  if (!pointers.has(id)) pointers.set(id, { id, ray: new THREE.Ray(), active: false, pressed: false, released: false, hover: null, drag: null });
  return pointers.get(id);
};

function interactiveMeshes() {
  const list = [...app.aiPanel.interactables];
  if (app.dashboard.root.visible) list.push(...app.dashboard.interactables);
  if (focus) list.push(...focus.panel.interactables);
  for (const v of app.views) if (v.root.visible) list.push(...v.interactables); // raycasts ignore visibility, so filter here
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

function hitAt(ray) {
  raycaster.ray.copy(ray);
  return raycaster.intersectObjects(interactiveMeshes(), false)[0] || null;
}

// Registered before OrbitControls so a click on a panel can disable orbiting first.
renderer.domElement.addEventListener('pointerdown', (e) => {
  const p = mouseRay(e);
  controls.enabled = !hitAt(p.ray);
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
// Scroll over a view scales it; elsewhere the wheel zooms the camera.
renderer.domElement.addEventListener('wheel', (e) => {
  const hit = hitAt(mouseRay(e).ray);
  const v = hit?.object.userData.view;
  if (!v) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  scaleRoot(v.root, e.deltaY < 0 ? 1.08 : 1 / 1.08);
}, { passive: false, capture: true });

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.35, 0);
controls.enableDamping = true;
controls.update();

// XR controllers (on HoloLens 2 these are the articulated-hand target rays).
// Each gets a world-space ray line and a cursor ring drawn from the *smoothed* ray.
const tmpM = new THREE.Matrix4();
let selectsSeen = 0;
const xrControllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: PALETTE.iceBlue, transparent: true, opacity: 0.8, depthTest: false }));
  line.frustumCulled = false;
  line.renderOrder = 20;
  const cursor = new THREE.Mesh(new THREE.RingGeometry(0.007, 0.012, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.iceBlue, transparent: true, depthTest: false, side: THREE.DoubleSide }));
  cursor.renderOrder = 21;
  line.visible = cursor.visible = false;
  scene.add(line, cursor);
  c.userData = { line, cursor, connected: false };
  c.addEventListener('connected', (e) => {
    c.userData.connected = true;
    const src = e.data;
    logDiag(`input ${i}: ${src?.handedness || '?'} ${src?.targetRayMode || '?'} ${src?.profiles?.[0] || ''}${src?.hand ? ' (hand joints)' : ''}`);
  });
  c.addEventListener('disconnected', () => { c.userData.connected = false; line.visible = cursor.visible = false; getPointer('xr' + i).active = false; });
  c.addEventListener('selectstart', () => { getPointer('xr' + i).pressed = true; if (selectsSeen++ < 2) logDiag(`select received (input ${i})`); });
  c.addEventListener('selectend', () => { getPointer('xr' + i).released = true; });
  scene.add(c);
  return c;
});

const rawO = new THREE.Vector3(), rawD = new THREE.Vector3();
function updateXrPointers() {
  xrControllers.forEach((c, i) => {
    const p = getPointer('xr' + i);
    p.active = !!c.userData.connected && renderer.xr.isPresenting;
    if (!p.active) { p.history = []; return; }
    c.updateMatrixWorld(true);
    tmpM.identity().extractRotation(c.matrixWorld);
    rawO.setFromMatrixPosition(c.matrixWorld);
    rawD.set(0, 0, -1).applyMatrix4(tmpM).normalize();
    // Low-pass filter: hand rays jitter, which makes buttons hard to hit and drags shaky.
    if (!p.history?.length) { p.ray.origin.copy(rawO); p.ray.direction.copy(rawD); p.history = []; }
    else { p.ray.origin.lerp(rawO, 0.5); p.ray.direction.lerp(rawD, 0.3).normalize(); }
    // Keep ~100 ms of rays: a pinch pulls the hand, so presses use where you aimed just before.
    p.history.push(p.ray.clone());
    if (p.history.length > 7) p.history.shift();
  });
}

function processPointer(p) {
  if (!p.active && !p.drag) { if (p.hover) { p.hover.onLeave?.(); p.hover = null; } p.pressed = p.released = false; return null; }

  if (p.drag) {
    const point = p.ray.at(p.drag.dist, new THREE.Vector3());
    p.drag.root.position.copy(point.add(p.drag.offset));
    if (p.drag.face) faceViewer(p.drag.root, true);
    if (p.released) p.drag = null;
    p.pressed = p.released = false;
    return null;
  }

  const aimRay = p.pressed && p.history?.length > 5 ? p.history[0] : p.ray; // pre-pinch aim for presses
  const hit = hitAt(aimRay);
  const target = hit?.object.userData.target ?? null;
  if (p.hover && p.hover !== target) p.hover.onLeave?.();
  p.hover = target;
  if (target) target.onHover?.(hit);

  // Air-tap and HOLD (~0.8 s) on empty space: bring every view back in front of you.
  if (p.pressed && !target && p.id !== 'mouse') p.emptySince = performance.now();
  if (p.released && p.emptySince) {
    if (!target && performance.now() - p.emptySince > 800) arrange();
    p.emptySince = 0;
  }
  if (p.pressed && target) {
    p.emptySince = 0;
    const r = target.onDown?.(hit);
    if (hit.object.userData.view) setFocus(hit.object.userData.view);
    if (r?.dragRoot) p.drag = { root: r.dragRoot, face: r.face, dist: hit.distance, offset: r.dragRoot.position.clone().sub(hit.point) };
    if (r?.focus && hit.object.userData.view) enterFocus(hit.object.userData.view);
  }
  p.pressed = p.released = false;
  return hit;
}

/** Draws the ray line and cursor ring for an XR pointer. */
function drawPointer(i, hit) {
  const { line, cursor } = xrControllers[i].userData;
  const p = getPointer('xr' + i);
  if (!p.active) { line.visible = cursor.visible = false; return; }
  const end = hit ? hit.point : p.ray.at(1.5, new THREE.Vector3());
  line.geometry.setFromPoints([p.ray.origin, end]);
  line.visible = true;
  cursor.visible = !!hit;
  if (hit) {
    cursor.position.copy(hit.point);
    camera.getWorldPosition(camPos);
    cursor.lookAt(camPos);
    cursor.material.color.set(p.drag ? PALETTE.orange : PALETTE.iceBlue);
  }
}

// ---- Direct touch: poke panels with an index fingertip (needs hand tracking) ----
const hands = [0, 1].map((i) => { const h = renderer.xr.getHand(i); scene.add(h); return h; });
const tipW = new THREE.Vector3(), tipL = new THREE.Vector3();
function updatePokes() {
  hands.forEach((hand, i) => {
    const p = getPointer('poke' + i);
    const tip = hand.joints?.['index-finger-tip'];
    if (!renderer.xr.isPresenting || !tip || !tip.visible) { if (p.hover) { p.hover.onLeave?.(); p.hover = null; } p.touching = false; return; }
    tip.getWorldPosition(tipW);
    let best = null;
    for (const m of interactiveMeshes()) {
      const g = m.geometry?.parameters;
      if (!g || g.width == null || m.geometry.type !== 'PlaneGeometry') continue; // panels only
      tipL.copy(tipW); m.worldToLocal(tipL);
      if (Math.abs(tipL.x) > g.width / 2 || Math.abs(tipL.y) > g.height / 2 || tipL.z < -0.03 || tipL.z > 0.05) continue;
      if (!best || Math.abs(tipL.z) < Math.abs(best.z)) best = { m, z: tipL.z, uv: new THREE.Vector2(tipL.x / g.width + 0.5, tipL.y / g.height + 0.5), point: tipW.clone() };
    }
    const target = best?.m.userData.target ?? null;
    if (p.hover && p.hover !== target) p.hover.onLeave?.();
    p.hover = target;
    if (!best) { p.touching = false; return; }
    const hit = { object: best.m, uv: best.uv, point: best.point, distance: 0 };
    target.onHover?.(hit);
    // Press when the fingertip pushes through the surface; re-arm once it backs off (hysteresis).
    if (!p.touching && best.z < 0.004) {
      p.touching = true;
      const r = target.onDown?.(hit);
      if (best.m.userData.view) { setFocus(best.m.userData.view); if (r?.focus) enterFocus(best.m.userData.view); }
    }
    else if (p.touching && best.z > 0.015) p.touching = false;
  });
}

function setFocus(v) {
  if (focusedView === v) return;
  focusedView = v;
  app.aiPanel.set({ mode: `focus: ${v.dataset.title}` });
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

function faceViewer(root, steady = false) {
  camera.getWorldPosition(camPos);
  // While dragging, turn only around the vertical axis: tilting with every hand wobble looks glitchy.
  const target = root.userData.yawOnly || steady ? new THREE.Vector3(camPos.x, root.position.y, camPos.z) : camPos;
  root.lookAt(target); // Object3D.lookAt points +Z at the target; panels and 3D views face +Z
}

// Arc slots (degrees, + = viewer's right). Left side is reserved for the dashboard and AI panel.
const DASH_ANGLE = -36, AI_ANGLE = -72;
const SLOTS = [0, 34, 68, 102, 136, -110, -140, 170];
let nextSlot = 0;

function placeAt(root, angleDeg, dist, dy) {
  const { pos, fwd } = viewerPose();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const ang = THREE.MathUtils.degToRad(angleDeg);
  const dir = fwd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(right, Math.sin(ang));
  const p = pos.clone().addScaledVector(dir, dist);
  p.y = pos.y + dy;
  root.position.copy(p);
  faceViewer(root);
}

// In AR everything sits ~1.4–1.6 m away: HoloLens clips holograms closer than ~0.8 m, and
// 1.25–2 m is its comfortable viewing range. 2D panels get a little larger to stay readable.
const XR_PANEL_SCALE = 1.3;
function xrScale(root, is3D) {
  const want = renderer.xr.isPresenting && !is3D ? XR_PANEL_SCALE : 1;
  const base = root.userData.userScale ?? 1;
  root.scale.setScalar(base * want);
}

function place(view, slot) {
  const inXR = renderer.xr.isPresenting;
  const dist = (inXR ? (view.is3D ? 1.4 : 1.6) : (view.is3D ? 1.75 : 1.65)) + Math.floor(slot / SLOTS.length) * 0.3;
  placeAt(view.root, SLOTS[slot % SLOTS.length], dist, view.is3D ? (inXR ? -0.45 : -0.75) : -0.05);
  xrScale(view.root, view.is3D);
}

function placeSidePanels() {
  const inXR = renderer.xr.isPresenting;
  placeAt(app.dashboard.root, DASH_ANGLE, inXR ? 1.5 : 1.6, -0.06);
  placeAt(app.aiPanel.root, AI_ANGLE, inXR ? 1.5 : 1.6, -0.12);
  xrScale(app.dashboard.root, false);
  xrScale(app.aiPanel.root, false);
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
  const chrome = v.panel || v; // the panel that carries the title-bar controls
  chrome.onScale = (f) => scaleRoot(v.root, f);
  if (!v.panel) v.onExplode = () => { v.setExploded(!v.exploded); app.dashboard.dirty = app.aiPanel.dirty = true; };
  for (const m of v.interactables) m.userData.view = v;
  place(v, app.views.length); // next free slot, so views reopened after "close all" land in front
  scene.add(v.root);
  app.views.push(v);
  focusedView = v;
  app.dashboard.dirty = true;
  xapi('opened', d.id, kind);
}

function close(v) {
  if (!v) return;
  if (focus?.view === v) exitFocus();
  tweens.delete(v.root);
  for (const p of pointers.values()) {
    if (p.drag?.root === v.root) p.drag = null;
    if (p.hover && v.interactables.some((m) => m.userData.target === p.hover)) p.hover = null;
  }
  scene.remove(v.root);
  v.dispose();
  app.views = app.views.filter((x) => x !== v);
  if (focusedView === v) focusedView = null;
  app.dashboard.dirty = true;
}

// ---------------------------------------------------------------------------------
//  Focus mode: tap a chart to bring it front and centre with a data toolbar
// ---------------------------------------------------------------------------------

let focus = null; // { view, panel, saved: Map(root → {p, q, s}) }
const tweens = new Map();

function tweenTo(root, pos, quat, scale, dur = 0.55) {
  tweens.set(root, { p0: root.position.clone(), q0: root.quaternion.clone(), s0: root.scale.x, p1: pos.clone(), q1: quat.clone(), s1: scale, t: 0, dur });
}

function updateTweens(dt) {
  for (const [root, tw] of tweens) {
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const e = easeInOut(tw.t);
    root.position.lerpVectors(tw.p0, tw.p1, e);
    root.quaternion.slerpQuaternions(tw.q0, tw.q1, e);
    root.scale.setScalar(tw.s0 + (tw.s1 - tw.s0) * e);
    if (tw.t >= 1) tweens.delete(root);
  }
}

function enterFocus(v) {
  if (focus?.view === v) return;
  if (focus) exitFocus();
  const inXR = renderer.xr.isPresenting;
  const others = [...app.views.filter((x) => x !== v), app.dashboard];
  const saved = new Map([v, ...others].map((o) => [o.root, { p: o.root.position.clone(), q: o.root.quaternion.clone(), s: o.root.scale.x }]));

  // Target: centred in front, a little larger; 3D views sit lower so you look down onto them.
  const { pos, fwd } = viewerPose();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  // Centre along where you're actually looking (pitch limited to ±20°), not just at eye level.
  const look = new THREE.Vector3();
  camera.getWorldDirection(look);
  const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(look.y, -1, 1)), -0.35, 0.35);
  const dist = inXR ? (v.is3D ? 1.3 : 1.5) : (v.is3D ? 1.4 : 1.75);
  const target = pos.clone().addScaledVector(fwd, dist * Math.cos(pitch));
  target.y = pos.y + dist * Math.sin(pitch) + (v.is3D ? -0.3 : 0.16); // 2D: shifted up so chart + toolbar are centred together
  const facing = new THREE.Object3D();
  facing.position.copy(target);
  facing.userData.yawOnly = v.is3D;
  faceViewer(facing);
  const scale = (v.root.userData.userScale ?? 1) * (v.is3D ? 1.5 : inXR ? 1.3 : 1.0);
  tweenTo(v.root, target, facing.quaternion, scale);
  for (const o of others) o.root.visible = false; // step aside; the AI panel stays for voice

  // Data toolbar: under a 2D chart, to the right of a 3D model.
  const panel = new FocusPanel(v, app);
  const ps = inXR ? 1.15 : 1;
  const ph = panel.mesh.geometry.parameters.height * ps, pw = panel.mesh.geometry.parameters.width * ps;
  const pp = target.clone();
  if (v.is3D) { pp.addScaledVector(right, 0.33 * scale + pw / 2 + 0.06); pp.y = target.y + 0.18; }
  else { const vh = v.mesh.geometry.parameters.height * scale; pp.y = target.y - vh / 2 - ph / 2 - 0.03; pp.addScaledVector(fwd, -0.04); }
  panel.root.position.copy(pp);
  panel.root.scale.setScalar(ps);
  faceViewer(panel.root);
  scene.add(panel.root);
  focus = { view: v, panel, saved, since: Date.now() };
  setFocus(v);
  app.aiPanel.set({ mode: `focus: ${v.dataset.title}` });
  xapi('focused', v.dataset.id, v.kind);
}

function exitFocus() {
  if (!focus) return;
  const { view, panel, saved, since } = focus;
  focus = null;
  xapi('unfocused', view.dataset.id, `after ${formatDuration(Math.round((Date.now() - since) / 1000))}`);
  for (const [root, st] of saved) {
    root.visible = true;
    if (root === view.root) tweenTo(root, st.p, st.q, st.s);
  }
  scene.remove(panel.root);
  panel.dispose();
  for (const p of pointers.values()) if (p.hover === panel) p.hover = null;
  app.aiPanel.set({ mode: '' });
}

function arrange() {
  exitFocus();
  placeSidePanels();
  app.views.forEach((v, i) => place(v, i));
  nextSlot = app.views.length;
}

// Analytics hook: swap for an xAPI statement emitter (LRS) in the progression system.
let lastXapi = '';
function xapi(verb, id, detail) {
  // Actor = the signed-in student (xAPI account form: VSU ID on valdosta.edu); t+ = time since sign-in.
  const line = `[xAPI] [t+${sessionClock()}] ${user.first} ${user.last} (${user.id}) ${verb} ${id}: ${detail}`;
  if (line !== lastXapi) { console.info(line); lastXapi = line; }
}

// ---------------------------------------------------------------------------------
//  AI analyst + voice
// ---------------------------------------------------------------------------------

const analyst = new Analyst(app);
let busy = false;

async function ask(text) {
  if (!text || busy) return;
  busy = true;
  app.aiPanel.set({ heard: text, state: 'thinking', answer: '…' });
  xapi('asked', app.focused()?.dataset.id || 'none', text);
  try {
    const { text: answer } = await analyst.handle(text, settings, () => app.aiPanel.set({ state: 'thinking' }));
    app.aiPanel.set({ state: 'idle', answer });
    if (settings.speak !== false) speak(answer);
  } catch (e) {
    const msg = e?.status === 401 ? 'The AI connection was rejected. Check the API key in AI settings.'
      : e?.status === 429 ? 'The AI service is busy (rate limited). Try again in a moment.'
      : e?.status ? `AI error ${e.status}: ${e.message}` : `Could not reach the AI service: ${e?.message || e}`;
    app.aiPanel.set({ state: 'error', answer: msg });
  } finally {
    busy = false;
    app.dashboard.dirty = true;
  }
}

const micBtn = document.getElementById('mic-btn');
const voice = new Voice({
  onResult: (text) => ask(text),
  onState: (state, detail) => {
    if (state === 'listening') app.aiPanel.set({ state: 'listening', heard: detail || app.aiPanel.heard });
    else if (state === 'error') app.aiPanel.set({ state: 'error', answer: detail });
    else if (!busy) app.aiPanel.set({ state: 'idle' });
    micBtn.classList.toggle('live', voice.listening);
  },
});

// DOM: ask bar, mic, settings dialog
const askForm = document.getElementById('ask-form');
const askInput = document.getElementById('ask-input');
askForm.addEventListener('submit', (e) => { e.preventDefault(); const t = askInput.value.trim(); askInput.value = ''; ask(t); });
micBtn.addEventListener('click', () => app.toggleListening());
if (!voiceSupported) { micBtn.disabled = true; micBtn.title = 'Voice input is not supported in this browser'; }

const dlg = document.getElementById('ai-dialog');
const fld = { key: document.getElementById('ai-key'), proxy: document.getElementById('ai-proxy'), remember: document.getElementById('ai-remember'), speak: document.getElementById('ai-speak') };
document.getElementById('ai-btn').addEventListener('click', () => {
  fld.key.value = settings.apiKey || ''; fld.proxy.value = settings.proxyUrl || '';
  fld.remember.checked = !!settings.remember; fld.speak.checked = settings.speak !== false;
  dlg.showModal();
});
document.getElementById('ai-save').addEventListener('click', (e) => {
  e.preventDefault();
  Object.assign(settings, { apiKey: fld.key.value.trim(), proxyUrl: fld.proxy.value.trim(), remember: fld.remember.checked, speak: fld.speak.checked });
  saveSettings(settings);
  analyst.reset();
  app.aiPanel.dirty = true;
  dlg.close();
  toast(aiConfigured(settings) ? 'AI analyst connected. Ask a question.' : 'AI analyst disconnected; local voice commands still work.');
});
document.getElementById('ai-clear').addEventListener('click', (e) => { e.preventDefault(); fld.key.value = ''; });
document.getElementById('ai-cancel').addEventListener('click', (e) => { e.preventDefault(); dlg.close(); });

// ---------------------------------------------------------------------------------
//  Datasets: samples, bundled CSVs, imported CSVs
// ---------------------------------------------------------------------------------

function addDataset(d) {
  const existing = app.datasets.findIndex((x) => x.id === d.id);
  if (existing >= 0) {
    app.views.filter((v) => v.dataset === app.datasets[existing]).forEach(close);
    app.datasets[existing] = d;
  } else app.datasets.push(d);
  analyst.reset(); // the data context changed: start a fresh AI conversation
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
    try { const d = parseCsv(await file.text(), file.name); addDataset(d); loaded.push(d); }
    catch (e) { failed.push(`${file.name}: ${e.message}`); }
  }
  for (const d of loaded) open(d, VIEW_KINDS[d.kind][0]);
  toast([loaded.length ? `Loaded ${loaded.map((d) => d.title).join(', ')}` : '', ...failed].filter(Boolean).join(' · '));
}

let toastTimer;
function toast(msg, ms = 5000) {
  const el = document.getElementById('toast');
  if (!msg) return;
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

document.getElementById('csv-input').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
document.getElementById('arrange-btn').addEventListener('click', () => arrange());
const drop = document.getElementById('drop');
window.addEventListener('dragover', (e) => { e.preventDefault(); drop.hidden = false; });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.hidden = true; });
window.addEventListener('drop', (e) => { e.preventDefault(); drop.hidden = true; importFiles([...e.dataTransfer.files].filter((x) => /\.csv$/i.test(x.name))); });

// ---------------------------------------------------------------------------------
//  Enter AR / VR
// ---------------------------------------------------------------------------------

const xrBtn = document.getElementById('xr-btn');
let xrMode = null;
async function setupXrButton() {
  if (!navigator.xr) { xrBtn.textContent = 'AR needs HTTPS + WebXR'; return; }
  if (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)) xrMode = 'immersive-ar';
  else if (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)) xrMode = 'immersive-vr';
  if (!xrMode) { xrBtn.textContent = 'No AR device'; return; }
  xrBtn.textContent = xrMode === 'immersive-ar' ? 'Enter AR' : 'Enter VR';
  xrBtn.disabled = false;
}
const xrLabel = () => (xrMode === 'immersive-ar' ? 'Enter AR' : 'Enter VR');
let xrSession = null, xrStarting = false;

/**
 * Attempts, from richest to simplest. Headset browsers differ in which optional features
 * they accept (HoloLens 2 Edge rejects some), so each step drops more. The last step uses
 * immersive-vr, which on an additive display like HoloLens still renders as see-through AR.
 */
async function xrAttempts() {
  const list = SAFE_XR
    ? [{ mode: xrMode, init: { optionalFeatures: ['local-floor'] } }, { mode: xrMode, init: {} }]
    : [
      { mode: xrMode, init: { optionalFeatures: ['local-floor', 'hand-tracking', 'dom-overlay'], domOverlay: { root: document.body } } },
      { mode: xrMode, init: { optionalFeatures: ['local-floor', 'hand-tracking'] } },
      { mode: xrMode, init: {} },
    ];
  if (xrMode === 'immersive-ar' && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)) {
    list.push({ mode: 'immersive-vr', init: { optionalFeatures: SAFE_XR ? ['local-floor'] : ['local-floor', 'hand-tracking'] } });
  }
  return list;
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(what), { name: 'TimeoutError' })), ms); })])
    .finally(() => clearTimeout(t));
}

async function startXr() {
  const errors = [];
  const attempts = await xrAttempts();
  for (const [i, { mode, init }] of attempts.entries()) {
    xrBtn.textContent = `Starting… (${i + 1}/${attempts.length})`;
    let session = null;
    const request = navigator.xr.requestSession(mode, init);
    try {
      // A permission prompt can take a while; don't wait forever on a call that never settles.
      session = await withTimeout(request, 30000, 'the headset did not answer the AR request (look for an Allow prompt)');
      // Probe 'local-floor'; fall back to 'local' (origin at the starting head position).
      let space = 'local-floor';
      try { await withTimeout(session.requestReferenceSpace('local-floor'), 5000, 'floor tracking timed out'); } catch { space = 'local'; }
      renderer.xr.setReferenceSpaceType(space);
      floor.position.y = space === 'local' ? -1.6 : 0;
      session.addEventListener('end', () => { xrSession = null; });
      await withTimeout(renderer.xr.setSession(session), 15000, 'setting up the AR view timed out');
      console.info(`[XR] started ${mode} with ${JSON.stringify(init.optionalFeatures || [])}, space ${space}, blend ${session.environmentBlendMode}`);
      return session;
    } catch (e) {
      errors.push(`${mode}${init.optionalFeatures ? ' [' + init.optionalFeatures.join(', ') + ']' : ' [no options]'}: ${e.name}: ${e.message}`);
      console.warn('[XR] attempt failed', mode, init, e);
      try { await session?.end(); } catch { /* already ended */ }
      if (!session) request.then((late) => late.end()).catch(() => {}); // close a session that arrives after we gave up
      if (e.name === 'InvalidStateError' && !session) break; // another session is genuinely open
    }
  }
  throw Object.assign(new Error(errors.join('  |  ')), { attempts: errors });
}

xrBtn.addEventListener('click', async () => {
  if (xrSession) { xrSession.end().catch(() => {}); return; }
  if (xrStarting) return; // ignore double taps while a session is starting
  xrStarting = true;
  xrBtn.disabled = true;
  xrBtn.textContent = 'Starting…';
  try {
    xrSession = await startXr();
  } catch (e) {
    const open = /InvalidStateError/.test(e.message);
    toast(open
      ? 'Another AR session is still open. Close every Edge tab using AR (or restart Edge), then try again.'
      : `AR could not start. Details: ${e.message}`, 30000);
  } finally {
    xrStarting = false;
    xrBtn.disabled = false;
    if (!xrSession) xrBtn.textContent = xrLabel();
  }
});

// ---- AR safe mode: no hand tracking / finger poke. Use ?safe, or it turns on automatically
//      after an AR session that froze or crashed (?full turns it back off). ----
const SAFE_KEY = 'michips.xr.safe';
const params = new URLSearchParams(location.search);
if (params.has('full')) { try { localStorage.removeItem(SAFE_KEY); } catch { /* storage blocked */ } }
let SAFE_XR = params.has('safe') || (() => { try { return localStorage.getItem(SAFE_KEY) === '1'; } catch { return false; } })();

// ---- AR diagnostics: kept across reloads so a crash inside the headset can be reported ----
const DIAG_KEY = 'michips.xr.diag';
const diag = { lines: [], active: false };
function logDiag(msg) {
  const line = `${new Date().toLocaleTimeString()} ${msg}`;
  console.warn('[XR]', line);
  diag.lines = [...diag.lines, line].slice(-15);
  try { localStorage.setItem(DIAG_KEY, JSON.stringify({ active: diag.active, lines: diag.lines })); } catch { /* storage blocked */ }
}
/** Always close the session on trouble, so the headset never keeps a stuck immersive session. */
function endXrSafely(reason) {
  logDiag(`ending session: ${reason}`);
  try { xrSession?.end().catch(() => {}); } catch { /* already gone */ }
}
window.addEventListener('error', (e) => { if (diag.active) logDiag(`error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`); });
window.addEventListener('unhandledrejection', (e) => { if (diag.active) logDiag(`unhandled: ${e.reason?.message || e.reason}`); });
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  logDiag('graphics context lost (GPU memory)');
  endXrSafely('graphics context lost');
});
window.addEventListener('pagehide', () => { if (xrSession) endXrSafely('page closed'); });

// Views are placed only once the headset reports real head poses (HoloLens can take a moment),
// then once more after tracking settles.
let xrPoseFrames = -1;
let arSince = 0; // when the current AR session started (for its duration)
renderer.xr.addEventListener('sessionstart', () => {
  const blend = renderer.xr.getSession()?.environmentBlendMode || (xrMode === 'immersive-ar' ? 'alpha-blend' : 'opaque');
  const seeThrough = blend !== 'opaque'; // HoloLens = additive, phones/Quest AR = alpha-blend
  scene.background = seeThrough ? null : BG;
  floor.visible = !seeThrough;
  xrBtn.textContent = 'Exit';
  xrPoseFrames = 0; selectsSeen = 0; // start counting frames with a valid head pose
  diag.active = true; loopErrors = 0;
  const sess = renderer.xr.getSession();
  logDiag(`session started (blend ${blend}${SAFE_XR ? ', safe mode' : ''})`);
  arSince = Date.now();
  xapi('entered AR', 'session', `blend ${blend}`);
  sess?.addEventListener('visibilitychange', () => logDiag(`visibility: ${sess.visibilityState}`));
});
renderer.xr.addEventListener('sessionend', () => {
  if (arSince) xapi('exited AR', 'session', `after ${formatDuration(Math.round((Date.now() - arSince) / 1000))}`);
  arSince = 0;
  xrPoseFrames = -1;
  for (const v of app.views) xrScale(v.root, v.is3D);
  diag.active = false;
  logDiag('session ended');
  scene.background = BG;
  floor.visible = true;
  floor.position.y = 0;
  xrSession = null;
  xrBtn.textContent = xrLabel();
  camera.position.set(0, 1.6, 1.25);
  controls.target.set(0, 1.35, 0);
  controls.update();
  arrange();
});

// ---------------------------------------------------------------------------------
//  Boot + frame loop
// ---------------------------------------------------------------------------------

window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && focus && document.activeElement?.tagName !== 'INPUT') exitFocus(); });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

app.datasets = allSamples();
app.dashboard = new Dashboard(app);
app.aiPanel = new AiPanel(app);
scene.add(app.dashboard.root, app.aiPanel.root);
placeSidePanels();
open(app.datasets.find((d) => d.id === 'process-window'), '2D');
open(app.datasets.find((d) => d.id === 'thermal'), '3D');
loadBundledCsvs();
setupXrButton();
const clockTag = makeDynamicLabel({ height: 0.026, color: PALETTE.white, bg: 'rgba(0,53,142,0.95)', maxChars: 30 });
app.dashboard.root.add(clockTag);
function tickClock() {
  const t = sessionClock();
  document.getElementById('user-timer').textContent = t;
  clockTag.setText(`${user.first} ${user.last} · ${t}`);
  clockTag.position.set(0, app.dashboard.mesh.geometry.parameters.height / 2 + 0.03 + app.dashboard.mesh.position.y, 0.01);
}
tickClock();
setInterval(tickClock, 1000);
xapi('started', 'session', `session began ${user.sessionStart}`);

window.__michips = { app, scene, camera, ask }; // handy for debugging in the console

const clock = new THREE.Clock();
let loopErrors = 0;
const failed = new Set();
/** Runs one part of the frame; a failure is logged once and never stops the frame from rendering. */
function guard(name, fn) {
  try { return fn(); } catch (err) {
    loopErrors++;
    if (!failed.has(name)) {
      failed.add(name);
      logDiag(`${name} failed: ${err.message} ${(err.stack || '').split('\n')[1]?.trim() || ''}`);
    }
    return undefined;
  }
}

renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  guard('controls', () => { if (!renderer.xr.isPresenting) controls.update(); });
  guard('placement', () => {
    if (xrPoseFrames >= 0 && frame) {
      const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
      if (pose) xrPoseFrames += pose.emulatedPosition ? 0.2 : 1; // estimated-only poses still place views within ~1 s
      if (xrPoseFrames >= 10) { arrange(); xrPoseFrames = -1; } // first real poses: gather views in front (once)
    }
  });
  guard('pointers', () => {
    updateXrPointers();
    for (const p of pointers.values()) {
      if (p.id.startsWith('poke')) continue;
      const hit = processPointer(p);
      if (p.id.startsWith('xr')) drawPointer(+p.id.slice(2), hit);
    }
  });
  if (!SAFE_XR) guard('poke', updatePokes);
  CanvasPanel.redrawBudget = renderer.xr.isPresenting ? 1 : 99; // headset: at most one panel re-render per frame
  guard('tweens', () => updateTweens(dt));
  if (focus) guard('focus panel', () => focus.panel.update(dt));
  guard('dashboard', () => app.dashboard.update(dt));
  guard('ai panel', () => app.aiPanel.update(dt));
  for (const v of app.views) guard(`view ${v.dataset.id}:${v.kind}`, () => v.update(dt));
  // Always draw: a headset keeps showing its loading screen until the page submits frames.
  try { renderer.render(scene, camera); } catch (err) {
    if (!failed.has('render')) { failed.add('render'); logDiag(`render failed: ${err.message}`); }
    if (++loopErrors > 120 && xrSession) endXrSafely('rendering keeps failing');
  }
});

// Report a previous AR session that crashed or never ended cleanly.
try {
  const prev = JSON.parse(localStorage.getItem(DIAG_KEY) || 'null');
  const noSelect = prev?.lines.some((l) => /^.{0,12}input /.test(l) || / input \d:/.test(l)) && !prev.lines.some((l) => /select received/.test(l));
  if (prev && (prev.active || noSelect || prev.lines.some((l) => /error|lost|unhandled|repeated/.test(l)))) {
    if (prev.active && !SAFE_XR) { // froze or crashed: try the simpler AR setup next time
      SAFE_XR = true;
      try { localStorage.setItem(SAFE_KEY, '1'); } catch { /* storage blocked */ }
    }
    toast(`Last AR session had a problem${SAFE_XR ? ' (safe AR mode is now on)' : ''}. Send this to whoever maintains the app: ${prev.lines.slice(-6).join('  ·  ')}`, 45000);
  }
  localStorage.removeItem(DIAG_KEY);
} catch { /* storage blocked */ }
