/* =========================================================
   bridge-builder.js — หน้าออกแบบสะพาน: รับค่า แสดงตัวอย่าง 3D และ export
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  DEFAULTS, PRESETS, normalizeParams, deriveDims, buildBridge, disposeBridge
} from './bridge-gen.js';

export const PARAMS_KEY = 'bpnp.bridge.params';

const $ = (id) => document.getElementById(id);
const form = $('bridge-form');
const panel = document.querySelector('.panel');
const sectionEl = $('section-svg');
const summaryEl = $('summary');
const messagesEl = $('messages');
const btnGlb = $('btn-glb');
const btnJson = $('btn-json');
const btnPlace = $('btn-place');

/* ---------- ฉาก 3D ---------- */
const canvas = $('preview');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-60, 120, 80);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

let grid = null;
let model = null;
let lastLength = null;

function makeGrid(size) {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  grid = new THREE.GridHelper(size, Math.round(size / 5), 0x8894a6, 0x8894a6);
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  scene.add(grid);
}

// เลื่อนจุดกึ่งกลางภาพให้พ้นแผงควบคุม
function applyViewOffset() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const r = panel.getBoundingClientRect();
  const bottomSheet = w <= 640;
  const offX = bottomSheet ? 0 : -r.right / 2;
  const offY = bottomSheet ? (h - r.top) / 2 : 0;
  camera.setViewOffset(w, h, offX, offY, w, h);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  applyViewOffset();
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function fitCamera() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y * 2, s.z * 3, 24);
  // ระยะกล้องให้สะพานพอดีพื้นที่ที่มองเห็น (ไม่นับส่วนที่แผงบังอยู่)
  const pr = panel.getBoundingClientRect();
  const h = window.innerHeight;
  const sheet = window.innerWidth <= 640;
  const vw = sheet ? window.innerWidth : window.innerWidth - pr.right;
  const vh = sheet ? pr.top : h;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const dist = Math.max(r / (2 * t * (vw / h)), (s.y * 1.6) / (2 * t * (vh / h))) * 1.05;
  const dir = new THREE.Vector3(-0.45, 0.38, 0.9).normalize();
  camera.position.copy(c).addScaledVector(dir, dist);
  controls.target.copy(c);
  controls.update();
  makeGrid(Math.ceil((s.x + 80) / 10) * 10);
  grid.position.set(c.x, 0, 0);
}

function loop() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* ---------- ฟอร์ม ---------- */
function readForm() {
  return normalizeParams(Object.fromEntries(new FormData(form)));
}

function writeForm(p) {
  for (const [key, value] of Object.entries(p)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el instanceof RadioNodeList) el.value = String(value);
    else el.value = key === 'gauge' ? String(Number(value)) : value;
  }
}

function buildChips() {
  document.querySelectorAll('.chips[data-for]').forEach((wrap) => {
    const key = wrap.dataset.for;
    wrap.innerHTML = PRESETS[key]
      .map((v) => `<button type="button" class="chip" data-value="${v}" aria-pressed="false">${v} ม.</button>`)
      .join('');
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      form.elements[key].value = btn.dataset.value;
      update();
    });
  });
}

function syncChips(p) {
  document.querySelectorAll('.chips[data-for]').forEach((wrap) => {
    const v = Number(p[wrap.dataset.for]);
    wrap.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.value) === v)));
  });
}

/* ---------- ภาพหน้าตัด (SVG) ---------- */
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('th-TH');

function sectionSvg(d) {
  const p = d.params;
  const VBW = 320, VBH = 220, mL = 46, mR = 14, mT = 28, mB = 22;
  const halfW = Math.max(d.capLen / 2, d.truss ? d.trussZ + 0.35 : d.W / 2);
  const topY = d.truss ? d.trussBottomY + d.trussHeight + 0.35 : p.deckLevel + 1;
  const k = Math.min((VBW - mL - mR) / (2 * halfW), (VBH - mT - mB) / topY);
  const cx = mL + (VBW - mL - mR) / 2;
  const gy = VBH - mB;
  const X = (z) => (cx + z * k).toFixed(1);
  const Y = (y) => (gy - y * k).toFixed(1);
  const poly = (pts, cls) => `<polygon class="${cls}" points="${pts.map(([z, y]) => `${X(z)},${Y(y)}`).join(' ')}"/>`;
  const rect = (z0, y0, z1, y1, cls) => poly([[z0, y0], [z1, y0], [z1, y1], [z0, y1]], cls);
  const out = [];

  out.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="s-hatch"/></pattern></defs>`);
  out.push(`<rect x="${mL - 30}" y="${gy}" width="${VBW - mL + 26}" height="9" fill="url(#hatch)"/>`);
  out.push(`<line class="s-ground" x1="${mL - 30}" y1="${gy}" x2="${VBW - 4}" y2="${gy}"/>`);

  if (d.errors.length) {
    out.push(`<text class="s-label" x="${VBW / 2}" y="${VBH / 2}" text-anchor="middle">ปรับค่าเพื่อแสดงหน้าตัด</text>`);
    return wrapSvg(out, VBW, VBH, 'ยังแสดงหน้าตัดไม่ได้');
  }

  const H = d.columnHeight;
  const cd = d.capDepth;

  // เสาและคานหัวเสา
  if (p.pierType === 'A') {
    out.push(rect(-d.colD / 2, 0, d.colD / 2, H, 's-concrete'));
    const top = d.capLen / 2, bot = d.colD / 2 + 0.3;
    out.push(poly([[-bot, H], [bot, H], [top, H + cd * 0.45], [top, H + cd], [-top, H + cd], [-top, H + cd * 0.45]], 's-concrete'));
  } else {
    for (const z of [-d.colSpacing / 2, d.colSpacing / 2]) {
      out.push(rect(z - d.colD / 2, 0, z + d.colD / 2, H, 's-concrete'));
    }
    out.push(rect(-d.capLen / 2, H, d.capLen / 2, H + cd, 's-concrete'));
    if (p.pierType === 'C' && d.haunch > 0) {
      const zi = d.colSpacing / 2 - d.colD / 2;
      for (const s of [-1, 1]) out.push(poly([[s * zi, H], [s * (zi - d.haunch), H], [s * zi, H - d.haunch]], 's-concrete'));
    }
  }

  // แผ่นรองคาน
  const padZ = d.truss ? [-d.trussZ, d.trussZ] : [-(d.W * 0.21) * 0.7, (d.W * 0.21) * 0.7];
  for (const z of padZ) out.push(rect(z - 0.45, d.capTopY, z + 0.45, d.capTopY + d.bearing, 's-pad'));

  // โครงสร้างส่วนบน
  const y = p.deckLevel;
  if (!d.truss) {
    const W = d.W, dep = d.superDepth, bt = W * 0.275, bb = W * 0.21;
    out.push(poly([[-W / 2, y], [W / 2, y], [W / 2, y - 0.25], [bt, y - 0.45], [bb, y - dep], [-bb, y - dep], [-bt, y - 0.45], [-W / 2, y - 0.25]], 's-concrete'));
    for (const z of [-(W / 2 - 0.1), W / 2 - 0.1]) out.push(rect(z - 0.1, y, z + 0.1, y + 1, 's-concrete'));
  } else {
    const zt = d.trussZ, yb = d.trussBottomY, yt = yb + d.trussHeight;
    out.push(rect(-zt, y - 0.35, zt, y, 's-concrete'));
    out.push(rect(-zt, yb - 0.35, zt, y - 0.35, 's-steel'));
    for (const z of [-zt, zt]) out.push(rect(z - 0.35, yb - 0.35, z + 0.35, yt + 0.35, 's-steel'));
    out.push(rect(-zt, yt - 0.18, zt, yt + 0.18, 's-steel'));
  }

  // ราง
  for (const zc of d.trackCenters) {
    out.push(rect(zc - 1.5, y, zc + 1.5, y + 0.3, 's-ballast'));
    const half = p.gauge / 2 + 0.035;
    for (const s of [-half, half]) out.push(rect(zc + s - 0.08, y + 0.3, zc + s + 0.08, y + 0.46, 's-rail'));
  }

  // เส้นบอกขนาด: ความกว้าง
  const dimTop = Math.min(Number(Y(topY)) - 10, mT - 6);
  out.push(`<line class="s-dim" x1="${X(-d.W / 2)}" y1="${dimTop}" x2="${X(d.W / 2)}" y2="${dimTop}"/>`);
  for (const z of [-d.W / 2, d.W / 2]) out.push(`<line class="s-dim" x1="${X(z)}" y1="${dimTop - 4}" x2="${X(z)}" y2="${dimTop + 4}"/>`);
  out.push(`<text class="s-label" x="${cx}" y="${dimTop - 6}" text-anchor="middle">กว้าง ${f1(d.W)} ม.</text>`);

  // เส้นบอกขนาด: ระดับพื้นสะพาน
  const dx = mL - 16;
  out.push(`<line class="s-dim" x1="${dx}" y1="${gy}" x2="${dx}" y2="${Y(y)}"/>`);
  for (const yy of [gy, Number(Y(y))]) out.push(`<line class="s-dim" x1="${dx - 4}" y1="${yy}" x2="${dx + 4}" y2="${yy}"/>`);
  const midY = (gy + Number(Y(y))) / 2;
  out.push(`<text class="s-label" x="${dx - 6}" y="${midY}" text-anchor="middle" transform="rotate(-90 ${dx - 6} ${midY})">สูง ${f1(y)} ม.</text>`);

  // ความสูงเสา
  const colLabelY = Number(Y(H / 2)) + 4;
  if (p.pierType === 'A') {
    out.push(`<text class="s-label" x="${Number(X(d.colD / 2)) + 6}" y="${colLabelY}">เสา ${f1(H)} ม.</text>`);
  } else if (p.pierType === 'C') {
    // ช่องลอดใต้คานพอร์ทัล
    const zi = d.clearWidth / 2;
    const yy = Number(Y(H * 0.3));
    out.push(`<line class="s-dim" x1="${X(-zi)}" y1="${yy}" x2="${X(zi)}" y2="${yy}"/>`);
    for (const z of [-zi, zi]) out.push(`<line class="s-dim" x1="${X(z)}" y1="${yy - 4}" x2="${X(z)}" y2="${yy + 4}"/>`);
    out.push(`<text class="s-label" x="${cx}" y="${yy - 6}" text-anchor="middle">ช่องลอด ${f1(d.clearWidth)} ม.</text>`);
    out.push(`<text class="s-label" x="${cx}" y="${colLabelY - 14}" text-anchor="middle">เสา ${f1(H)} ม.</text>`);
  } else {
    out.push(`<text class="s-label" x="${cx}" y="${colLabelY}" text-anchor="middle">เสา ${f1(H)} ม.</text>`);
  }

  const label = `หน้าตัดตอม่อ Type ${p.pierType} พื้น${d.truss ? 'โครงเหล็ก' : 'คอนกรีต'} กว้าง ${f1(d.W)} เมตร ระดับพื้นสะพาน ${f1(y)} เมตร`;
  return wrapSvg(out, VBW, VBH, label);
}

function wrapSvg(parts, w, h, label) {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${parts.join('')}</svg>`;
}

/* ---------- สรุปขนาด / ข้อความ ---------- */
function renderSummary(d) {
  const p = d.params;
  const rows = [
    ['ความยาวรวม', `${f1(d.totalLength)} ม. (${p.spanCount} × ${f1(d.L)} ม.)`],
    ['ตอม่อ', `${d.pierCount} ต้น`]
  ];
  if (!d.errors.length) {
    rows.push(['ความสูงเสา', `${f1(d.columnHeight)} ม.`]);
    if (p.pierType === 'A') rows.push(['เสา', `Ø ${f1(d.colD)} ม.`]);
    else if (p.pierType === 'B') rows.push(['เสาคู่', `Ø ${f1(d.colD)} ม. ห่าง ${f1(d.colSpacing)} ม.`]);
    else {
      rows.push(['เสาพอร์ทัล', `${f1(d.colD)} × ${f1(d.colD)} ม. ห่าง ${f1(d.colSpacing)} ม.`]);
      rows.push(['ช่องลอดใต้', `กว้าง ${f1(d.clearWidth)} สูง ${f1(d.columnHeight - d.haunch)} ม.`]);
    }
    rows.push([p.pierType === 'C' ? 'คานพอร์ทัล' : 'คานหัวเสา', `ยาว ${f1(d.capLen)} ลึก ${f1(d.capDepth)} ม.`]);
    rows.push(d.truss
      ? ['โครงถัก', `สูง ${f1(d.trussHeight)} ม.`]
      : ['ความลึกคาน', `${f1(d.superDepth)} ม.${p.girderDepth > 0 ? '' : ' (คำนวณให้)'}`]);
  }
  summaryEl.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function renderMessages(d, extra = '') {
  const html = [
    ...d.errors.map((m) => `<p class="msg error">${m}</p>`),
    ...d.warnings.map((m) => `<p class="msg warn">${m}</p>`)
  ];
  if (extra) html.push(`<p class="msg">${extra}</p>`);
  messagesEl.innerHTML = html.join('');
}

/* ---------- อัปเดตทั้งหมด ---------- */
function update({ fit = false, note = '' } = {}) {
  const p = readForm();
  const d = deriveDims(p);

  if (model) { scene.remove(model); disposeBridge(model); }
  model = buildBridge(p);
  scene.add(model);

  sectionEl.innerHTML = sectionSvg(d);
  renderSummary(d);
  renderMessages(d, note);
  syncChips(p);
  $('portal-field').hidden = p.pierType !== 'C';

  const ok = d.errors.length === 0;
  btnGlb.disabled = !ok;
  btnPlace.disabled = !ok;

  try { localStorage.setItem(PARAMS_KEY, JSON.stringify(p)); } catch (_) { /* ไม่มีที่เก็บก็ทำงานต่อได้ */ }

  if (ok && (fit || lastLength !== d.totalLength)) {
    fitCamera();
    lastLength = d.totalLength;
  }
  applyViewOffset();
  camera.updateProjectionMatrix();
}

let timer = 0;
form.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(update, 120);
});
// ออกจากช่องกรอกแล้วแสดงค่าที่ถูกปรับให้อยู่ในช่วงที่รับได้
form.addEventListener('change', () => {
  writeForm(readForm());
  update();
});

/* ---------- ไฟล์ ---------- */
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

function fileBase(p) {
  const safe = p.name.replace(/[\\/:*?"<>|\s]+/g, '_');
  return `${safe}_type${p.pierType}_${p.deckType}_${p.spanLength}m-x${p.spanCount}`;
}

btnGlb.addEventListener('click', async () => {
  const p = readForm();
  btnGlb.disabled = true;
  try {
    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(model, { binary: true });
    download(new Blob([glb], { type: 'model/gltf-binary' }), `${fileBase(p)}.glb`);
    renderMessages(deriveDims(p), `ดาวน์โหลด ${fileBase(p)}.glb แล้ว`);
  } catch (err) {
    console.error(err);
    renderMessages(deriveDims(p), 'สร้างไฟล์ .glb ไม่สำเร็จ ลองรีเฟรชหน้าแล้วดาวน์โหลดใหม่');
  } finally {
    btnGlb.disabled = false;
  }
});

btnJson.addEventListener('click', () => {
  const p = readForm();
  const data = { type: 'bpnp-bridge', version: 1, params: p };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${fileBase(p)}.json`);
  renderMessages(deriveDims(p), `ดาวน์โหลด ${fileBase(p)}.json แล้ว`);
});

$('btn-open').addEventListener('click', () => $('file-json').click());
$('file-json').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    const raw = obj.params || (obj.properties && obj.properties.params) || obj;
    if (!raw || (raw.pierType === undefined && raw.spanLength === undefined)) throw new Error('no params');
    writeForm(normalizeParams(raw));
    update({ fit: true, note: `เปิด ${file.name} แล้ว` });
  } catch (_) {
    update({ note: `${file.name} ไม่ใช่ไฟล์แบบสะพาน ต้องเป็นไฟล์ .json ที่ดาวน์โหลดจากหน้านี้` });
  }
});

btnPlace.addEventListener('click', () => {
  update();
  window.location.href = 'bridge-map.html?from=builder';
});

$('btn-fit').addEventListener('click', fitCamera);

/* ---------- เริ่มต้น ---------- */
function loadSaved() {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    return raw ? normalizeParams(JSON.parse(raw)) : { ...DEFAULTS };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

buildChips();
writeForm(loadSaved());
resize();
update({ fit: true });
requestAnimationFrame(loop);
