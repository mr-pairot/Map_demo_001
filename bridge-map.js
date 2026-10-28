/* =========================================================
   bridge-map.js — วางสะพานลงบนแผนที่ MapLibre ตามพิกัด lat/lng
   สะพานแต่ละตัวมีจุดอ้างอิงของตัวเอง จึงวางได้ทุกที่โดยไม่เพี้ยน
   ========================================================= */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  DEFAULTS, normalizeParams, deriveDims, buildBridge, disposeBridge, findBridgeParams
} from './bridge-gen.js';

const maplibregl = window.maplibregl;
const PARAMS_KEY = 'bpnp.bridge.params';
const PLACED_KEY = 'bpnp.bridge.placements';
const ORIGIN = [100.5405, 13.8040];

const $ = (id) => document.getElementById(id);
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('th-TH');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rad = THREE.MathUtils.degToRad;
const deg = THREE.MathUtils.radToDeg;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- เรขาคณิตบนแผนที่ ---------- */
function destination(start, bearingDeg, dist) {
  const mc = maplibregl.MercatorCoordinate.fromLngLat(start, 0);
  const S = mc.meterInMercatorCoordinateUnits();
  const b = rad(bearingDeg);
  return new maplibregl.MercatorCoordinate(
    mc.x + Math.sin(b) * dist * S,
    mc.y - Math.cos(b) * dist * S,
    0
  ).toLngLat().toArray();
}

function measure(a, b) {
  const ma = maplibregl.MercatorCoordinate.fromLngLat(a, 0);
  const mb = maplibregl.MercatorCoordinate.fromLngLat(b, 0);
  const S = ma.meterInMercatorCoordinateUnits();
  const east = (mb.x - ma.x) / S;
  const north = (ma.y - mb.y) / S;
  return { dist: Math.hypot(east, north), bearing: (deg(Math.atan2(east, north)) + 360) % 360 };
}

/* ---------- ฉาก Three.js ของสะพานแต่ละตัว ---------- */
function makeItem(object3d, start, bearingDeg) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-120, 300, 160);
  scene.add(sun);

  // แกน x ของโมเดล = แนวสะพาน → หมุนให้ชี้ไปตาม bearing (0° = เหนือ, ตามเข็มนาฬิกา)
  object3d.rotation.y = rad(90 - bearingDeg);
  scene.add(object3d);

  const mc = maplibregl.MercatorCoordinate.fromLngLat(start, 0);
  const S = mc.meterInMercatorCoordinateUnits();
  const transform = new THREE.Matrix4()
    .makeTranslation(mc.x, mc.y, mc.z)
    .scale(new THREE.Vector3(S, -S, S))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return { scene, object3d, transform };
}

function disposeItem(rec) {
  if (rec && rec.item && rec.kind === 'params') disposeBridge(rec.item.object3d);
}

const bridgeLayer = {
  id: 'bridges-3d',
  type: 'custom',
  renderingMode: '3d',
  onAdd(map, gl) {
    this.camera = new THREE.Camera();
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  },
  render(gl, matrix) {
    const m = new THREE.Matrix4().fromArray(matrix);
    const list = state.placed.map((r) => r.item);
    if (state.draft && state.draft.item) list.push(state.draft.item);
    for (const it of list) {
      if (!it) continue;
      this.camera.projectionMatrix.copy(m).multiply(it.transform);
      this.renderer.resetState();
      this.renderer.render(it.scene, this.camera);
    }
  }
};

/* ---------- สถานะ ---------- */
function loadBuilderParams() {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    return raw ? normalizeParams(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
}

const state = {
  model: { kind: 'params', params: loadBuilderParams() || normalizeParams(DEFAULTS), template: null, glbName: '', glbLength: 0 },
  mode: 'point',
  start: [...ORIGIN],
  end: null,
  bearing: 150,
  fit: 'count',
  pick: null,     // 'start' | 'end' | null
  draft: null,    // สะพานตัวอย่างที่ยังไม่วาง
  placed: []
};
state.end = destination(state.start, state.bearing, deriveDims(state.model.params).totalLength);

/* ---------- แผนที่ ---------- */
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/bright',
  center: ORIGIN,
  zoom: 16.4,
  pitch: 60,
  bearing: -30,
  maxPitch: 80,
  antialias: true
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

function pin(cls, label) {
  const el = document.createElement('div');
  el.className = `pin ${cls}`;
  el.setAttribute('aria-label', label);
  return el;
}
const startMarker = new maplibregl.Marker({ element: pin('pin-start', 'จุดเริ่มสะพาน'), draggable: true });
const endMarker = new maplibregl.Marker({ element: pin('pin-end', 'จุดปลายสะพาน'), draggable: true });

startMarker.on('dragend', () => { state.start = startMarker.getLngLat().toArray(); syncInputs(); refreshDraft(); });
endMarker.on('dragend', () => { state.end = endMarker.getLngLat().toArray(); syncInputs(); refreshDraft(); });

map.on('load', () => {
  const labelLayerId = map.getStyle().layers.find(
    (l) => l.type === 'symbol' && l.layout && l.layout['text-field']
  )?.id;

  map.addSource('openfreemap', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  map.addLayer({
    id: '3d-buildings',
    type: 'fill-extrusion',
    source: 'openfreemap',
    'source-layer': 'building',
    minzoom: 14,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'render_height'], 0, '#e1e4ea', 40, '#bcc4d1', 120, '#7f8ca2'],
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['get', 'render_height']],
      'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['get', 'render_min_height']],
      'fill-extrusion-opacity': 0.85
    }
  }, labelLayerId);

  map.addSource('draft-line', { type: 'geojson', data: lineFeature(null) });
  map.addLayer({
    id: 'draft-line',
    type: 'line',
    source: 'draft-line',
    paint: { 'line-color': '#c8312b', 'line-width': 3, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 }
  }, labelLayerId);

  map.addLayer(bridgeLayer);

  restorePlacements();
  refreshDraft();
  const target = state.placed.length && !location.search.includes('from=builder')
    ? state.placed[state.placed.length - 1].start
    : state.start;
  map.jumpTo({ center: target });
});

map.on('error', (e) => console.warn('Map error:', e && e.error));

map.on('click', (e) => {
  if (!state.pick) return;
  const ll = [e.lngLat.lng, e.lngLat.lat];
  if (state.pick === 'start') {
    state.start = ll;
    state.pick = state.mode === 'line' ? 'end' : null;
  } else {
    state.end = ll;
    state.pick = null;
  }
  syncPick();
  syncInputs();
  refreshDraft();
});

function lineFeature(coords) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords || [] }
  };
}

/* ---------- สร้างสะพานตัวอย่างตามค่าปัจจุบัน ---------- */
const draftInfo = $('draft-info');
const btnPlace = $('btn-place');

function computeDraft() {
  const mode = state.mode;
  let bearing = state.bearing;
  let dist = 0;
  if (mode === 'line') {
    const m = measure(state.start, state.end);
    bearing = m.bearing;
    dist = m.dist;
  }

  if (state.model.kind === 'glb') {
    const obj = state.model.template.clone(true);
    const length = state.model.glbLength;
    return {
      kind: 'glb', obj, params: null, bearing, length, dist,
      name: state.model.glbName.replace(/\.glb$/i, ''),
      text: mode === 'line'
        ? `ระยะ ${f1(dist)} ม., โมเดลยาว ${f1(length)} ม., ทิศ ${f1(bearing)}°`
        : `โมเดลยาว ${f1(length)} ม., ทิศ ${f1(bearing)}°`
    };
  }

  const params = { ...state.model.params };
  if (mode === 'line' && dist > 1) {
    if (state.fit === 'count') params.spanCount = clamp(Math.round(dist / params.spanLength), 1, 30);
    else params.spanLength = clamp(Math.round((dist / params.spanCount) * 10) / 10, 10, 80);
  }
  const d = deriveDims(params);
  if (d.errors.length) return { error: d.errors[0] };

  const spans = `${d.params.spanCount} ช่วง × ${f1(d.L)} ม.`;
  return {
    kind: 'params', obj: buildBridge(d.params), params: d.params, bearing, length: d.totalLength, dist,
    name: d.params.name,
    text: mode === 'line'
      ? `ระยะ ${f1(dist)} ม. ได้ ${spans} ยาว ${f1(d.totalLength)} ม., ทิศ ${f1(bearing)}°`
      : `${spans} ยาว ${f1(d.totalLength)} ม., ทิศ ${f1(bearing)}°`
  };
}

function clearDraft() {
  if (state.draft) disposeItem(state.draft);
  state.draft = null;
}

function refreshDraft() {
  clearDraft();
  const r = computeDraft();
  if (r.error) {
    draftInfo.textContent = r.error;
    btnPlace.disabled = true;
    setDraftLine(null);
  } else {
    const item = makeItem(r.obj, state.start, r.bearing);
    state.draft = {
      kind: r.kind, params: r.params, name: r.name,
      glbName: r.kind === 'glb' ? state.model.glbName : '',
      start: [...state.start],
      end: destination(state.start, r.bearing, r.length),
      bearing: r.bearing, length: r.length, item
    };
    draftInfo.textContent = `ตัวอย่าง: ${r.text}`;
    btnPlace.disabled = false;
    setDraftLine([state.draft.start, state.draft.end]);
  }

  startMarker.setLngLat(state.start).addTo(map);
  if (state.mode === 'line') endMarker.setLngLat(state.end).addTo(map);
  else endMarker.remove();
  map.triggerRepaint();
}

function setDraftLine(coords) {
  const src = map.getSource('draft-line');
  if (src) src.setData(lineFeature(coords));
}

/* ---------- ช่องกรอกตำแหน่ง ---------- */
const inStartLat = $('start-lat');
const inStartLng = $('start-lng');
const inEndLat = $('end-lat');
const inEndLng = $('end-lng');
const inBearing = $('bearing');
const inBearingRange = $('bearing-range');
const fix = (v) => Number(v).toFixed(6);

function syncInputs() {
  inStartLat.value = fix(state.start[1]);
  inStartLng.value = fix(state.start[0]);
  inEndLat.value = fix(state.end[1]);
  inEndLng.value = fix(state.end[0]);
  inBearing.value = String(Math.round(state.bearing * 10) / 10);
  inBearingRange.value = String(Math.round(state.bearing) % 360);
}

function readLngLat(latEl, lngEl, fallback) {
  const lat = Number(latEl.value);
  const lng = Number(lngEl.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fallback;
  return [lng, lat];
}

[inStartLat, inStartLng].forEach((el) => el.addEventListener('change', () => {
  state.start = readLngLat(inStartLat, inStartLng, state.start);
  syncInputs();
  refreshDraft();
}));
[inEndLat, inEndLng].forEach((el) => el.addEventListener('change', () => {
  state.end = readLngLat(inEndLat, inEndLng, state.end);
  syncInputs();
  refreshDraft();
}));

function setBearing(v) {
  if (!Number.isFinite(v)) return;
  state.bearing = ((v % 360) + 360) % 360;
  syncInputs();
  refreshDraft();
}
inBearingRange.addEventListener('input', () => setBearing(Number(inBearingRange.value)));
inBearing.addEventListener('change', () => setBearing(Number(inBearing.value)));

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((el) => { el.hidden = el.dataset.mode !== mode; });
  if (mode === 'line') {
    // เริ่มจุดปลายตามทิศและความยาวเดิม
    const len = state.draft ? state.draft.length : deriveDims(state.model.params).totalLength;
    state.end = destination(state.start, state.bearing, len);
  } else {
    state.bearing = measure(state.start, state.end).bearing;
  }
  state.pick = null;
  syncPick();
  syncInputs();
  refreshDraft();
}
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => setMode(r.value)));
$('fit-mode').addEventListener('change', (e) => { state.fit = e.target.value; refreshDraft(); });

/* ---------- เลือกจุดจากแผนที่ ---------- */
const btnPick = $('btn-pick');
function syncPick() {
  const on = Boolean(state.pick);
  btnPick.setAttribute('aria-pressed', String(on));
  btnPick.textContent = !on ? 'เลือกจุดบนแผนที่'
    : state.pick === 'start' ? 'แตะแผนที่ที่จุดเริ่ม (กดอีกครั้งเพื่อยกเลิก)'
    : 'แตะแผนที่ที่จุดปลาย (กดอีกครั้งเพื่อยกเลิก)';
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
}
btnPick.addEventListener('click', () => {
  state.pick = state.pick ? null : 'start';
  syncPick();
});

/* ---------- แบบสะพาน ---------- */
const modelInfo = $('model-info');
const DECK_TH = { concrete: 'พื้นคอนกรีต', truss: 'โครงเหล็ก' };

function describeParams(p) {
  return `Type ${p.pierType} ${DECK_TH[p.deckType]}, กว้าง ${f1(p.deckWidth)} ม., span ${f1(p.spanLength)} ม. × ${p.spanCount}, สูง ${f1(p.deckLevel)} ม.`;
}

function renderModelInfo(note = '') {
  const m = state.model;
  let html;
  if (m.kind === 'glb') {
    const p = findBridgeParams(m.template);
    html = `<b>${m.glbName}</b> โมเดลยาว ${f1(m.glbLength)} ม.${p ? `<br>${describeParams(p)}` : ''}`;
  } else {
    html = `<b>${m.params.name}</b><br>${describeParams(m.params)}`;
  }
  modelInfo.innerHTML = html + (note ? `<br><span class="note">${note}</span>` : '');
}

function setParamsModel(params, note) {
  state.model = { kind: 'params', params: normalizeParams(params), template: null, glbName: '', glbLength: 0 };
  renderModelInfo(note);
  refreshDraft();
}

$('btn-from-builder').addEventListener('click', () => {
  const p = loadBuilderParams();
  if (p) setParamsModel(p, 'ใช้แบบล่าสุดจากหน้าออกแบบแล้ว');
  else renderModelInfo('ยังไม่มีแบบจากหน้าออกแบบ เปิดหน้าออกแบบสะพานเพื่อสร้างแบบก่อน');
});

$('btn-open-model').addEventListener('click', () => $('file-model').click());
$('file-model').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (/\.glb$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
      const template = gltf.scene;
      // ใช้ความยาวที่ฝังไว้ในไฟล์ (ถ้ามี) ไม่เช่นนั้นวัดจากขอบเขตโมเดลตามแกน x
      let glbLength = 0;
      template.traverse((o) => { if (!glbLength && o.userData && o.userData.totalLength) glbLength = Number(o.userData.totalLength); });
      if (!glbLength) glbLength = Math.max(0, new THREE.Box3().setFromObject(template).max.x);
      state.model = { kind: 'glb', params: null, template, glbName: file.name, glbLength };
      renderModelInfo('แกน x ของโมเดลจะชี้ไปตามทิศสะพาน');
      refreshDraft();
    } else {
      const obj = JSON.parse(await file.text());
      const raw = obj.params || obj;
      if (raw.pierType === undefined && raw.spanLength === undefined) throw new Error('no params');
      setParamsModel(raw, `เปิด ${file.name} แล้ว`);
    }
  } catch (err) {
    console.error(err);
    renderModelInfo(`เปิด ${file.name} ไม่ได้ ต้องเป็น .json จากหน้าออกแบบ หรือโมเดล .glb`);
  }
});

/* ---------- วางสะพาน / รายการ ---------- */
const listEl = $('placed-list');

btnPlace.addEventListener('click', () => {
  if (!state.draft) return;
  const rec = { id: `b${Date.now().toString(36)}`, ...state.draft };
  state.placed.push(rec);
  state.draft = null; // ย้ายตัวอย่างไปเป็นสะพานจริง ไม่ต้อง dispose
  setDraftLine(null);
  draftInfo.textContent = `วาง ${rec.name} แล้ว ย้ายจุดเริ่มเพื่อวางสะพานตัวถัดไป`;
  btnPlace.disabled = true;
  renderList();
  savePlacements();
  map.triggerRepaint();
});

function renderList() {
  if (!state.placed.length) {
    listEl.innerHTML = '<li class="empty">ยังไม่มีสะพาน ตั้งตำแหน่งแล้วกด "วางสะพาน"</li>';
    return;
  }
  listEl.innerHTML = state.placed.map((r, i) => `
    <li>
      <div class="placed-text">
        <b>${i + 1}. ${r.name}</b>
        <span>${r.kind === 'params' ? `Type ${r.params.pierType}, ${r.params.spanCount} × ${f1(r.params.spanLength)} ม.` : r.glbName}, ทิศ ${f1(r.bearing)}°</span>
      </div>
      <button class="btn small" type="button" data-act="fly" data-id="${r.id}">ดู</button>
      <button class="btn small" type="button" data-act="del" data-id="${r.id}" aria-label="ลบ ${r.name}">ลบ</button>
    </li>`).join('');
}

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const idx = state.placed.findIndex((r) => r.id === btn.dataset.id);
  if (idx < 0) return;
  const rec = state.placed[idx];
  if (btn.dataset.act === 'fly') {
    const mid = [(rec.start[0] + rec.end[0]) / 2, (rec.start[1] + rec.end[1]) / 2];
    const view = { center: mid, zoom: 17.2, pitch: 62, bearing: rec.bearing - 90 };
    if (reduceMotion) map.jumpTo(view); else map.flyTo({ ...view, duration: 1400, essential: true });
  } else {
    disposeItem(rec);
    state.placed.splice(idx, 1);
    renderList();
    savePlacements();
    map.triggerRepaint();
  }
});

/* ---------- เก็บ / ส่งออก / นำเข้า ---------- */
function toFeature(r) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [r.start, r.end] },
    properties: {
      name: r.name,
      model: r.kind,
      bearing: Math.round(r.bearing * 100) / 100,
      length: Math.round(r.length * 100) / 100,
      ...(r.kind === 'params' ? { params: r.params } : { glbFile: r.glbName })
    }
  };
}

function savePlacements() {
  try {
    localStorage.setItem(PLACED_KEY, JSON.stringify(state.placed.map(toFeature)));
  } catch (_) { /* ไม่มีที่เก็บก็ทำงานต่อได้ */ }
}

function placeFeature(f) {
  const g = f && f.geometry;
  const props = (f && f.properties) || {};
  if (!g) return false;
  const coords = g.type === 'LineString' ? g.coordinates : g.type === 'Point' ? [g.coordinates] : null;
  if (!coords || !coords.length) return false;
  const start = coords[0];
  const bearing = Number.isFinite(Number(props.bearing))
    ? Number(props.bearing)
    : coords.length > 1 ? measure(start, coords[coords.length - 1]).bearing : 0;

  let rec;
  if (props.params) {
    const d = deriveDims(props.params);
    if (d.errors.length) return false;
    rec = { kind: 'params', params: d.params, name: props.name || d.params.name, glbName: '', length: d.totalLength,
      item: makeItem(buildBridge(d.params), start, bearing) };
  } else if (props.glbFile && state.model.kind === 'glb' && state.model.glbName === props.glbFile) {
    rec = { kind: 'glb', params: null, name: props.name || props.glbFile, glbName: props.glbFile, length: state.model.glbLength,
      item: makeItem(state.model.template.clone(true), start, bearing) };
  } else {
    return false;
  }
  rec.id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  rec.start = start;
  rec.bearing = bearing;
  rec.end = destination(start, bearing, rec.length);
  state.placed.push(rec);
  return true;
}

function restorePlacements() {
  try {
    const list = JSON.parse(localStorage.getItem(PLACED_KEY) || '[]');
    list.forEach(placeFeature);
  } catch (_) { /* ข้อมูลเสียก็ข้ามไป */ }
  renderList();
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('btn-export').addEventListener('click', () => {
  if (!state.placed.length) {
    draftInfo.textContent = 'ยังไม่มีสะพานให้ดาวน์โหลด วางสะพานอย่างน้อยหนึ่งตัวก่อน';
    return;
  }
  const fc = { type: 'FeatureCollection', name: 'bridge-placements', features: state.placed.map(toFeature) };
  download(new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' }), 'bridge-placements.geojson');
});

$('btn-import').addEventListener('click', () => $('file-geojson').click());
$('file-geojson').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const feats = data.type === 'FeatureCollection' ? data.features : [data];
    let ok = 0;
    feats.forEach((f) => { if (placeFeature(f)) ok++; });
    const skipped = feats.length - ok;
    draftInfo.textContent = `เปิด ${file.name} แล้ว วางได้ ${ok} ตัว` +
      (skipped ? `, ข้าม ${skipped} ตัวที่ไม่มีพารามิเตอร์หรือยังไม่ได้เปิดไฟล์ .glb ที่ตรงกัน` : '');
    renderList();
    savePlacements();
    if (ok) {
      const last = state.placed[state.placed.length - 1];
      map.flyTo({ center: last.start, zoom: 16.5, duration: reduceMotion ? 0 : 1200 });
    }
    map.triggerRepaint();
  } catch (err) {
    console.error(err);
    draftInfo.textContent = `${file.name} ไม่ใช่ GeoJSON ที่อ่านได้`;
  }
});

$('chk-buildings').addEventListener('change', (e) => {
  if (map.getLayer('3d-buildings')) {
    map.setLayoutProperty('3d-buildings', 'visibility', e.target.checked ? 'visible' : 'none');
  }
});

/* ---------- เริ่มต้น ---------- */
syncInputs();
renderModelInfo(location.search.includes('from=builder') ? 'รับแบบจากหน้าออกแบบแล้ว' : '');
renderList();
