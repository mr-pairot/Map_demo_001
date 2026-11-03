/* =========================================================
   bridge-builder.js — หน้าออกแบบสะพาน: รับค่า แสดงตัวอย่าง 3D และ export
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// ตัวสร้างสะพาน (ไฟล์เดียวกับ bpnp-map3d) โหลดเป็นสคริปต์ปกติใน bridge-builder.html
const { PRESETS, CB_PRESETS, normalizeParams, deriveDims, buildBridge, disposeBridge, pierProfileA, iGirderPoints, presetParams, handrailLayout } = window.BridgeGen.create(THREE);

export const PARAMS_KEY = 'bpnp.bridge.params';   // แบบที่ใช้งานอยู่ (หน้าวางสะพานอ่านค่านี้)
const TABS_KEY = 'bpnp.bridge.tabs';              // v3: ค่าของแต่ละแท็บ { active, byKind }
const KIND_TH = { concrete: 'สะพานคอนกรีต', steel: 'สะพานเหล็ก', overpass: 'Overpass' };

const $ = (id) => document.getElementById(id);
const form = $('bridge-form');
const panel = document.querySelector('.panel');
const sectionEl = $('section-svg');
const profileEl = $('profile-svg');
const tabButtons = [...document.querySelectorAll('.kind-tabs [role="tab"]')];
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
  const raw = Object.fromEntries(new FormData(form));
  raw.abutmentD = form.elements.abutmentD.checked;   // checkbox ที่ไม่ติ๊กไม่อยู่ใน FormData
  raw.walkway = form.elements.walkway.checked;
  raw.endDiaphragm = form.elements.endDiaphragm.checked;
  raw.handrail = form.elements.handrail.checked;
  for (const k of ['bearingDetail', 'restrainBlocks', 'ballastSleepers']) raw[k] = form.elements[k].checked;
  return normalizeParams(raw);
}

// ชนิดตอม่อรายต้น { "2": "B" } → "2:B, 3:C" · ระดับรายต้น { "1": 5 } → "1:5"
const pairsText = (o) => Object.entries(o || {}).map(([k, v]) => `${k}:${v}`).join(', ');

function writeForm(p) {
  for (const [key, value] of Object.entries(p)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el.type === 'checkbox') { el.checked = !!value; continue; }
    if (key === 'piers' || key === 'levels') { el.value = pairsText(value); continue; }
    if (el instanceof RadioNodeList) el.value = String(value);
    else el.value = key === 'gauge' ? String(Number(value)) : value;
  }
}

/* ---------- แท็บประเภทสะพาน: แต่ละแท็บจำค่าของตัวเอง ---------- */
const tabs = { active: 'concrete', byKind: {} };

function saveTabs(p) {
  tabs.active = p.bridgeKind;
  tabs.byKind[p.bridgeKind] = p;
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(p));
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch (_) { /* ไม่มีที่เก็บก็ทำงานต่อได้ */ }
}

function syncTabs(kind) {
  tabButtons.forEach((b) => {
    const on = b.dataset.kind === kind;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  form.setAttribute('aria-labelledby', `tab-${kind}`);
}

function switchKind(kind) {
  const cur = readForm();
  if (kind === cur.bridgeKind) return;
  tabs.byKind[cur.bridgeKind] = cur;
  writeForm(tabs.byKind[kind] || normalizeParams({ bridgeKind: kind }));
  update({ fit: true });
}

tabButtons.forEach((b, i) => {
  b.addEventListener('click', () => switchKind(b.dataset.kind));
  b.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabButtons[(i + step + tabButtons.length) % tabButtons.length];
    next.focus();
    switchKind(next.dataset.kind);
  });
});

// แสดงเฉพาะช่องที่เกี่ยวกับแท็บ/ตัวเลือกปัจจุบัน
function syncFields(p) {
  const kind = p.bridgeKind;
  document.querySelectorAll('#bridge-form [data-kinds]').forEach((el) => { el.hidden = !el.dataset.kinds.split(' ').includes(kind); });
  const ig = p.girderType === 'igirder';
  const open = kind === 'steel' && p.floorType === 'open';
  $('portal-field').hidden = p.pierType !== 'C';
  $('a-fields').hidden = p.pierType !== 'A';
  $('d-fields').hidden = p.pierType !== 'D';
  $('ig-fields').hidden = !ig;
  $('dspacing-field').hidden = p.diaphragm !== 'spacing';
  const trough = ig && kind !== 'overpass' && p.deckSection === 'trough';
  $('slab-field').hidden = open || trough;
  $('decksec-group').hidden = !ig || kind === 'overpass';
  $('trough-fields').hidden = !trough;
  $('handrail-fields').hidden = !p.handrail;
  $('railing-group').hidden = trough;
  $('dlist-field').hidden = p.diaphragm !== 'list';
  const ballastSl = !open && kind !== 'overpass' && p.tracks > 0;
  $('bsleeper-field').hidden = !ballastSl;
  $('open-fields').hidden = !(open || (ballastSl && p.ballastSleepers));
  $('walkway-field').hidden = !open;
  $('endblock-fields').hidden = kind === 'steel';
  $('depth-field').hidden = p.girderType === 'truss';
  $('rinset-field').hidden = p.railings !== '4';
  $('rlist-field').hidden = p.railings !== 'custom';
  $('profile-view').hidden = kind !== 'overpass';
  $('ig-label').textContent = kind === 'steel' ? 'คานเหล็ก I' : 'คาน I';
  $('depth-label').textContent = ig ? 'ความสูงคาน I (ม.)' : 'ความลึกคาน (ม.)';
  $('deck-level-label').textContent = kind === 'overpass' ? 'ระดับพื้นตั้งต้น (ม.)' : 'ระดับพื้นสะพาน (ม.)';
  $('hint-gcount').textContent = open ? '0 = คานคู่ใต้รางแต่ละทาง' : '0 = คำนวณให้ (ห่าง ~2 ม.)';
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
  const halfW = Math.max(d.capLen / 2, d.truss ? d.trussZ + 0.35 : d.W / 2, ...(d.girderZ || []).map((z) => Math.abs(z) + 0.6));
  const topY = d.truss ? d.trussBottomY + d.trussHeight + 0.35
    : d.trough ? d.deckLevel + d.trough.curbTop + (p.handrail ? p.handrailHeight + 0.1 : 0.6)
    : d.railBaseY + Math.max(1, d.railZ.length ? p.railingHeight : 0.5);
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
    // รูปด้านหน้าเสาผาย
    const prof = pierProfileA(d);
    out.push(poly([...prof.map((l) => [l.a, l.y]), ...prof.slice().reverse().map((l) => [-l.a, l.y])], 's-concrete'));
    if (d.hasCap) {
      const top = d.capLen / 2, bot = Math.min(d.aTop / 2, top);
      out.push(poly([[-bot, H], [bot, H], [top, H + cd * 0.45], [top, H + cd], [-top, H + cd], [-top, H + cd * 0.45]], 's-concrete'));
    }
    // แนวเริ่มผาย
    const yf = Number(Y(H - d.flareDepth));
    out.push(`<line class="s-edge" x1="${X(-d.aBase / 2 - 0.6)}" y1="${yf}" x2="${X(d.aBase / 2 + 0.6)}" y2="${yf}"/>`);
  } else if (p.pierType === 'D') {
    const a = d.wallWidth / 2;
    out.push(rect(-a, 0, a, H, 's-concrete'));
    // เส้นบอกแนวขอบโค้งที่ริมผนัง
    for (const z of [-(a - d.wallRadius), a - d.wallRadius]) {
      out.push(`<line class="s-edge" x1="${X(z)}" y1="${Y(0)}" x2="${X(z)}" y2="${Y(H)}"/>`);
    }
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

  // แผ่นรองคาน (v3.2: แท่นคอนกรีต + แผ่นยาง)
  const ps = d.padSize || 0.9;
  if (d.ig && p.bearingDetail) {
    for (const z of d.padZ) {
      out.push(rect(z - 0.4, d.capTopY, z + 0.4, d.capTopY + d.bearing - 0.06, 's-concrete'));
      out.push(rect(z - 0.25, d.capTopY + d.bearing - 0.06, z + 0.25, d.capTopY + d.bearing, 's-pad'));
    }
  } else for (const z of d.padZ) out.push(rect(z - ps / 2, d.capTopY, z + ps / 2, d.capTopY + d.bearing, 's-pad'));

  // โครงสร้างส่วนบน
  const y = d.deckLevel;
  if (d.truss) {
    const zt = d.trussZ, yb = d.trussBottomY, yt = yb + d.trussHeight;
    if (d.open) {
      out.push(rect(-zt, yb - 0.35, zt, y - 0.8, 's-steel'));
      const ss = p.gauge > 1.2 ? 2.0 : 1.8;
      for (const zc of d.trackCenters) for (const s of [-1, 1]) {
        out.push(poly(iGirderPoints({ h: 0.8, bf: 0.3, bb: 0.3, tw: 0.03, tf: 0.04, ta: 0, bt: 0.04, tb: 0 }).map(([z, yy]) => [z + zc + (s * ss) / 2, yy + y]), 's-steel'));
      }
    } else {
      out.push(rect(-zt, y - 0.35, zt, y, 's-concrete'));
      out.push(rect(-zt, yb - 0.35, zt, y - 0.35, 's-steel'));
    }
    for (const z of [-zt, zt]) out.push(rect(z - 0.35, yb - 0.35, z + 0.35, yt + 0.35, 's-steel'));
    out.push(rect(-zt, yt - 0.18, zt, yt + 0.18, 's-steel'));
  } else if (d.ig) {
    const gTop = d.open ? y : y - d.slabT;
    const cls = d.steel ? 's-steel' : 's-concrete';
    const zs = d.girderZ;
    zs.forEach((z, k) => {
      const solid = p.edgeGirder === 'solid' && zs.length > 1 ? (k === 0 ? -1 : k === zs.length - 1 ? 1 : 0) : 0;
      out.push(poly(iGirderPoints(d.iSec, solid).map(([zz, yy]) => [zz + z, yy + gTop]), cls));
    });
    if (d.trough) {
      // พื้นตามแบบ: แผ่นพื้นลาด กันหิน ขอบนอก หินโรยทาง ฝาราง ราวท่อ
      const t = d.trough;
      for (const part of t.parts) out.push(poly(part.pts.map(([z, yy]) => [z, yy + y]), part.part === 'ballast' ? 's-ballast' : 's-concrete'));
      for (const sg of [-1, 1]) {
        const za = sg * t.zs, zb = sg * t.zt1;
        out.push(rect(Math.min(za, zb), y + t.curbTop - p.coverThick, Math.max(za, zb), y + t.curbTop, 's-cover'));
        if (p.handrail) {
          const z = sg * t.handrailZ, yb = y + t.curbTop, H = p.handrailHeight;
          out.push(rect(z - 0.03, yb, z + 0.03, yb + H, 's-steel'));
          for (const hh of [0.34, 0.64, H]) out.push(rect(z - 0.05, yb + hh - 0.03, z + 0.05, yb + hh + 0.03, 's-steel'));
        }
      }
    } else if (!d.open) out.push(rect(-d.W / 2, y - p.slabThick, d.W / 2, y, 's-concrete'));
  } else {
    const W = d.W, dep = d.superDepth, bt = W * 0.275, bb = W * 0.21;
    out.push(poly([[-W / 2, y], [W / 2, y], [W / 2, y - 0.25], [bt, y - 0.45], [bb, y - dep], [-bb, y - dep], [-bt, y - 0.45], [-W / 2, y - 0.25]], 's-concrete'));
  }

  // ผิวถนน (Overpass)
  if (d.overpass) out.push(rect(-d.W / 2 + 0.2, y, d.W / 2 - 0.2, y + 0.08, 's-asphalt'));

  // ราวสะพาน
  const rh = p.railingHeight, rb = d.railBaseY;
  for (const z of d.railZ) {
    if (p.railingStyle === 'wall') out.push(rect(z - 0.1, rb, z + 0.1, rb + rh, 's-concrete'));
    else {
      out.push(rect(z - 0.05, rb, z + 0.05, rb + rh, 's-steel'));
      out.push(rect(z - 0.12, rb + rh - 0.08, z + 0.12, rb + rh, 's-steel'));
    }
  }

  // ราง: หินโรยทาง หรือ หมอนเหล็ก + ทางเดิน
  const half = p.gauge / 2 + 0.035;
  if (d.open) {
    const sh = p.sleeperHeight, sl = p.sleeperLength;
    if (p.walkway) {
      const lim = d.truss ? d.trussZ - 0.4 : d.W / 2;
      out.push(rect(-lim, y + sh - 0.05, lim, y + sh, 's-grating'));
    }
    for (const zc of d.trackCenters) {
      out.push(rect(zc - sl / 2, y, zc + sl / 2, y + sh, 's-sleeper'));
      for (const s of [-half, half]) out.push(rect(zc + s - 0.08, y + sh, zc + s + 0.08, y + sh + 0.16, 's-rail'));
    }
  } else if (d.trough || p.ballastSleepers) {
    const tops = d.trough ? d.trough.ballast : d.trackCenters.map((zc) => ({ zc, yTop: 0.3 }));
    for (const b of tops) {
      if (!d.trough) out.push(rect(b.zc - 1.5, y, b.zc + 1.5, y + 0.3, 's-ballast'));
      let ry = y + b.yTop;
      if (p.ballastSleepers) {
        const st = ry + 0.05, sl = p.sleeperLength;
        out.push(rect(b.zc - sl / 2, st - p.sleeperHeight, b.zc + sl / 2, st, 's-concrete'));
        ry = st;
      }
      for (const s of [-half, half]) out.push(rect(b.zc + s - 0.08, ry, b.zc + s + 0.08, ry + 0.16, 's-rail'));
    }
  } else {
    for (const zc of d.trackCenters) {
      out.push(rect(zc - 1.5, y, zc + 1.5, y + 0.3, 's-ballast'));
      for (const s of [-half, half]) out.push(rect(zc + s - 0.08, y + 0.3, zc + s + 0.08, y + 0.46, 's-rail'));
    }
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
    out.push(`<text class="s-label" x="${Number(X(d.aBase / 2)) + 6}" y="${colLabelY}">เสา ${f1(H)} ม.</text>`);
  } else if (p.pierType === 'D') {
    out.push(`<text class="s-label" x="${cx}" y="${colLabelY}" text-anchor="middle">ผนัง ${f1(H)} ม.</text>`);
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

  const girderTh = d.truss ? 'โครงถัก' : d.ig ? `คาน I ${d.girderZ.length} ตัว` : 'คานกล่อง';
  const label = `หน้าตัด${KIND_TH[p.bridgeKind]} ตอม่อ Type ${p.pierType} ${girderTh} กว้าง ${f1(d.W)} เมตร ระดับพื้นสะพาน ${f1(y)} เมตร`;
  return wrapSvg(out, VBW, VBH, label);
}

function wrapSvg(parts, w, h, label) {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${parts.join('')}</svg>`;
}

/* ---------- รูปตัดตามยาว (Overpass) ---------- */
function profileSvg(d, levels) {
  const VBW = 320, VBH = 130, mL = 30, mR = 14, mT = 22, mB = 26;
  const xs = [0];
  d.spans.forEach((L) => xs.push(xs[xs.length - 1] + L));
  const total = xs[xs.length - 1];
  const top = Math.max(...levels) + 1;
  const kx = (VBW - mL - mR) / total;
  const ky = (VBH - mT - mB) / top;
  const gy = VBH - mB;
  const X = (x) => (mL + x * kx).toFixed(1);
  const Y = (y) => (gy - y * ky).toFixed(1);
  const out = [];
  out.push(`<line class="s-ground" x1="${mL - 10}" y1="${gy}" x2="${VBW - 4}" y2="${gy}"/>`);
  levels.forEach((lv, i) => {
    out.push(`<line class="s-pierline" x1="${X(xs[i])}" y1="${gy}" x2="${X(xs[i])}" y2="${Y(lv - d.superDepth)}"/>`);
    out.push(`<text class="s-label" x="${X(xs[i])}" y="${Number(Y(lv)) - 6}" text-anchor="middle">${f1(lv)}</text>`);
    out.push(`<text class="s-label s-small" x="${X(xs[i])}" y="${gy + 13}" text-anchor="middle">${i + 1}</text>`);
  });
  out.push(`<polyline class="s-deck" points="${levels.map((lv, i) => `${X(xs[i])},${Y(lv)}`).join(' ')}"/>`);
  d.spans.forEach((L, i) => {
    const g = ((levels[i + 1] - levels[i]) / L) * 100;
    if (Math.abs(g) < 0.05) return;
    const xm = (xs[i] + xs[i + 1]) / 2, ym = (levels[i] + levels[i + 1]) / 2;
    const over = Math.abs(g) > d.params.maxGrade;
    out.push(`<text class="s-label s-small${over ? ' s-over' : ''}" x="${X(xm)}" y="${Number(Y(ym)) + 13}" text-anchor="middle">${g > 0 ? '+' : '−'}${f1(Math.abs(g))}%</text>`);
  });
  return wrapSvg(out, VBW, VBH, `รูปตัดตามยาว ระดับพื้นรายตอม่อ ${levels.map(f1).join(', ')} เมตร`);
}

/* ---------- สรุปขนาด / ข้อความ ---------- */
function renderSummary(d) {
  const p = d.params;
  const spanDesc = p.spanText && !d.errors.length ? d.spans.map(f1).join(' + ') + ' ม.' : `${p.spanCount} × ${f1(d.L)} ม.`;
  const types = d.spans.concat([0]).map((_, i) => (p.abutmentD && (i === 0 || i === d.spans.length)) ? 'D' : ((p.piers || {})[String(i + 1)] || p.pierType));
  const rows = [
    ['ความยาวรวม', `${f1(d.totalLength)} ม. (${spanDesc})`],
    ['ตอม่อ', `${d.pierCount} ต้น · ${types.join(' ')}`]
  ];
  if (d.skew) rows.push(['มุมเฉียง', `${f1(d.skew)}° · ตอม่อยาว ${f1(Math.min(20, p.deckWidth / Math.cos(d.skewRad)))} ม. ตามแนวเฉียง`]);
  if (!d.errors.length) {
    rows.push(['ความสูงเสา', `${f1(d.columnHeight)} ม.`]);
    if (p.pierType === 'A') {
      rows.push(['เสาโคน', `${f1(d.aBase)} × ${f1(d.aThick)} ม.`]);
      rows.push(['หัวเสาผาย', `กว้าง ${f1(d.aTop)} ม. ลึก ${f1(d.flareDepth)} ม.`]);
    } else if (p.pierType === 'D') {
      rows.push(['ผนัง', `กว้าง ${f1(d.wallWidth)} หนา ${f1(p.dThick)} ม.`]);
      rows.push(['ขอบโค้ง', `R ${d.wallRadius.toFixed(2)} ม.`]);
    }
    else if (p.pierType === 'B') rows.push(['เสาคู่', `Ø ${f1(d.colD)} ม. ห่าง ${f1(d.colSpacing)} ม.`]);
    else {
      rows.push(['เสาพอร์ทัล', `${f1(d.colD)} × ${f1(d.colD)} ม. ห่าง ${f1(d.colSpacing)} ม.`]);
      rows.push(['ช่องลอดใต้', `กว้าง ${f1(d.clearWidth)} สูง ${f1(d.columnHeight - d.haunch)} ม.`]);
    }
    if (d.hasCap) rows.push([p.pierType === 'C' ? 'คานพอร์ทัล' : 'คานหัวเสา', `ยาว ${f1(d.capLen)} ลึก ${f1(d.capDepth)} ม.`]);
    if (d.truss) rows.push(['โครงถัก', `สูง ${f1(d.trussHeight)} ม.`]);
    else if (d.ig) {
      rows.push([d.steel ? 'คานเหล็ก I' : 'คาน I', `${d.girderZ.length} ตัว · สูง ${f1(d.girderH)} ปีก ${f1(d.iSec.bf)} ม.${p.girderDepth > 0 ? '' : ' (สูงคำนวณให้)'}`]);
      const gaps = [...new Set(d.girderZ.slice(1).map((z, k) => f1(z - d.girderZ[k])))];
      const gap = gaps.length ? gaps.join(' / ') : 0;
      const dp = d.params;
      const dTh = { none: 'ไม่มี', ends: 'ที่ปลาย', mid: 'ปลาย + กลาง', third: 'ปลาย + 1/3', spacing: `ทุก ${f1(dp.diaphragmSpacing)} ม.`, list: `${dp.diaphragmList.split(/[,;\s]+/).filter(Boolean).length} ตัวตามตำแหน่ง` }[dp.diaphragm] + (dp.endDiaphragm ? ' + ปลายเต็มลึก' : '');
      rows.push(['ระยะคาน / คานขวาง', `${gap ? `${gap} ม.` : '—'} · ${dTh}`]);
      const eg = 2 * dp.endGap;
      rows.push(['ยาวคาน', d.spans.length > 1 && p.spanText ? `ตามช่วง ${[...new Set(d.spans.map((s) => f1(s - eg)))].join(' / ')} ม.` : `${(d.L - eg).toFixed(2)} ม. (ตามช่วง)`]);
      const sc = d.iSec;
      rows.push(['หน้าตัดคาน', `ปีก ${sc.bf.toFixed(2)}/${sc.bb.toFixed(2)} เอว ${sc.tw.toFixed(2)} ม.`]);
      if (!d.steel && dp.endBlock + dp.endTaper > 0) rows.push(['ปลายคาน', `ทึบ ${dp.endBlock.toFixed(2)} + สอบ ${dp.endTaper.toFixed(2)} ม.`]);
      const extra = [dp.bearingDetail && 'แผ่นยาง + แท่น', dp.restrainBlocks && 'บล็อกกันเลื่อน'].filter(Boolean);
      if (extra.length) rows.push(['ที่ตอม่อ', extra.join(' · ')]);
    } else rows.push(['ความลึกคาน', `${f1(d.superDepth)} ม.${p.girderDepth > 0 ? '' : ' (คำนวณให้)'}`]);
    if (!d.open && d.params.ballastSleepers && d.trackCenters.length) rows.push(['หมอนคอนกรีต', `@ ${d.params.sleeperSpacing.toFixed(2)} ม. · ${d.params.sleeperLength.toFixed(2)} × ${d.params.sleeperWidth.toFixed(2)} × ${d.params.sleeperHeight.toFixed(2)} ม.`]);
    if (d.open) {
      const nSl = Math.floor((d.L - 0.1 - p.sleeperWidth) / p.sleeperSpacing) + 1;
      rows.push(['หมอนเหล็ก', `@ ${p.sleeperSpacing.toFixed(2)} ม. · ${nSl} ตัว/ราง/ช่วง ${f1(d.L)} ม.`]);
    }
    if (d.presetUsed) rows.unshift(['แบบมาตรฐาน', CB_PRESETS[d.presetUsed].label]);
    if (d.trough) {
      const t = d.trough, dp = d.params;
      rows.push(['พื้น', `หนา ${dp.slabEdge.toFixed(2)}–${(-t.yb).toFixed(3)} ม. ลาด ${f1(dp.crossfall)}%`]);
      rows.push(['รางสาย', `${dp.troughWidth.toFixed(2)} × ${dp.troughDepth.toFixed(2)} ฝา ${dp.coverThick.toFixed(2)} ม. · ขอบนอก ${t.curbW.toFixed(2)} ม.`]);
      if (dp.handrail) {
        const lay = handrailLayout(dp, d.L);
        rows.push(['ราวท่อ', `สูง ${f1(dp.handrailHeight)} ม. · ${lay.n} แผง × ${dp.panelBays} ช่อง @ ${lay.bay.toFixed(3)} ม.`]);
      }
    } else rows.push(['ราว', d.railZ.length ? `${d.railZ.length} แนว · ${p.railingStyle === 'wall' ? 'กำแพงคอนกรีต' : 'ราวเหล็ก'} สูง ${f1(p.railingHeight)} ม.` : 'ไม่มี']);
    if (d.overpass) {
      rows.push(['ระดับพื้นรายต้น', d.levels.map(f1).join(' / ') + ' ม.']);
      rows.push(['ความชัน', d.grades.map((g) => `${g > 0 ? '+' : ''}${f1(g)}%`).join(' / ')]);
    }
  }
  summaryEl.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function renderMessages(d, extra = '') {
  const html = [
    ...d.errors.map((m) => `<p class="msg error">${m}</p>`),
    ...d.warnings.map((m) => `<p class="msg warn">${m}</p>`)
  ];
  ((model && model.userData && model.userData.notes) || []).forEach((m) => html.push(`<p class="msg warn">${m}</p>`));
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
  if (d.overpass) profileEl.innerHTML = profileSvg(d, (model.userData && model.userData.levels) || d.levels);
  renderSummary(d);
  renderMessages(d, note);
  syncChips(p);
  syncFields(p);
  syncTabs(p.bridgeKind);

  const ok = d.errors.length === 0;
  btnGlb.disabled = !ok;
  btnPlace.disabled = !ok;

  saveTabs(p);

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
form.addEventListener('change', (e) => {
  // เลือกแบบมาตรฐานของช่วงใด = กรอกค่าตามแบบลงฟอร์ม แล้วกลับเป็น "ไม่ใช้" ให้แก้ต่อได้
  if (e.target.name === 'preset' && CB_PRESETS[e.target.value]) {
    const name = e.target.value;
    writeForm(normalizeParams({ ...readForm(), ...presetParams(name), preset: 'none' }));
    update({ fit: true, note: `กรอกค่าตามแบบ ${CB_PRESETS[name].label} แล้ว` });
    return;
  }
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
  const spans = p.spanText ? p.spanText.replace(/\+/g, '-') : `${p.spanLength}m-x${p.spanCount}`;
  const deck = p.girderType + (p.bridgeKind === 'steel' && p.floorType === 'open' ? '-open' : '');
  return `${safe}_${p.bridgeKind}_type${p.pierType}_${deck}_${spans}${p.skew && p.bridgeKind !== 'steel' ? `_skew${p.skew}` : ''}`;
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
  const data = { type: 'bpnp-bridge', version: 3, params: p };
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
    const cur = readForm();
    tabs.byKind[cur.bridgeKind] = cur;
    const p = normalizeParams(raw);
    writeForm(p);
    update({ fit: true, note: `เปิด ${file.name} แล้ว (${KIND_TH[p.bridgeKind]})` });
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
    const t = JSON.parse(localStorage.getItem(TABS_KEY) || 'null');
    if (t && t.byKind && t.byKind[t.active]) {
      for (const [k, v] of Object.entries(t.byKind)) tabs.byKind[k] = normalizeParams(v);
      return tabs.byKind[t.active];
    }
    const raw = localStorage.getItem(PARAMS_KEY);   // ค่าที่เก็บจากเวอร์ชันก่อน (ไม่มีแท็บ)
    return raw ? normalizeParams(JSON.parse(raw)) : normalizeParams({ bridgeKind: 'concrete' });
  } catch (_) {
    return normalizeParams({ bridgeKind: 'concrete' });
  }
}

buildChips();
writeForm(loadSaved());
resize();
update({ fit: true });
requestAnimationFrame(loop);
