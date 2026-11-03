/* =========================================================
   bridge-gen.js — ตัวสร้างสะพาน (ใช้ร่วมกันทั้งหน้าออกแบบและหน้าแผนที่)
   หน่วยเป็นเมตร | แกน x = ตามแนวสะพาน, แกน y = ขึ้น, แกน z = ขวางสะพาน
   จุด origin (0,0,0) = โคนตอม่อตัวแรก (กึ่งกลางเสา ระดับพื้นดิน)
   =========================================================
 *
 * ── v2 (ใช้ไฟล์เดียวกันทั้ง Map_demo_001 และ bpnp-map3d) ──
 *   ไฟล์นี้เป็นสคริปต์ปกติ (ไม่ใช่ ES module) — โหลดด้วย <script src> แล้วเรียก
 *     const G = BridgeGen.create(THREE);            // Map_demo_001 (THREE จาก import)
 *     const G = BPNP.bridgeGen.create(THREE);       // bpnp-map3d (คัดลอกไฟล์นี้เป็น js/layers/structure/bridge_gen.js)
 *   ค่าตั้งสะพานเก็บแยกในแต่ละระบบ (demo: localStorage/ไฟล์ .json · bpnp-map3d: data/json/bridge_3d.json)
 *   ทดสอบบน demo แล้วคัดลอกไฟล์นี้ไปใช้กับ bpnp-map3d ได้ทันที
 */
(function (root) {
  'use strict';
  function create(THREE) {

const GENERATOR_ID = 'bpnp-bridge-gen@2';

const DEFAULTS = Object.freeze({
  version: 2,
  name: 'สะพาน 1',
  pierType: 'A',        // A = เสาเดี่ยวผายบน, B = เสาคู่, C = พอร์ทัล (คร่อมถนน/ทางด้านล่าง), D = ผนังทึบ
  deckType: 'concrete', // concrete = พื้นคอนกรีต (box girder), truss = โครงเหล็ก
  deckLevel: 12,        // ระดับผิวพื้นสะพานจากพื้นดิน (ม.)
  deckWidth: 10,        // ความกว้างพื้นสะพาน (ม.)
  spanLength: 30,       // ความยาวช่วงสะพาน (ม.)
  spanCount: 3,         // จำนวนช่วง
  girderDepth: 0,       // ความลึกคาน (ม.) 0 = คำนวณให้อัตโนมัติ
  portalSpan: 16,       // ระยะห่างศูนย์กลางเสา Type C (ม.)
  aTopMode: 'direct',   // Type A: direct = เสาผายรับคานโดยตรง, cap = เสาผาย + คานหัวเสา
  aBaseWidth: 0,        // Type A: ขนาดเสาโคน ขวางสะพาน (ม.) 0 = คำนวณให้
  aThick: 0,            // Type A: ความหนาเสา ตามแนวสะพาน (ม.) 0 = เท่าขนาดโคน
  aTopWidth: 0,         // Type A: ขนาดเสาด้านบน ขวางสะพาน (ม.) 0 = คำนวณให้
  aFlareDepth: 1.2,     // Type A: ความลึกช่วงผายจากยอดเสา (ม.)
  dThick: 1.2,          // Type D: ความหนาผนัง ตามแนวสะพาน (ม.)
  dRadius: 0.6,         // Type D: รัศมีขอบโค้งริมผนัง (ม.)
  tracks: 2,            // จำนวนทางรถไฟบนสะพาน 0 / 1 / 2
  gauge: 1.0,           // ขนาดราง 1.000 หรือ 1.435 ม.
  // ── v2 (ตรงกับ bpnp-map3d) ──
  trackSpacing: 5.0,    // ระยะศูนย์กลางทางคู่ (ม.)
  spanText: '',         // ช่วงแบบข้อความ "3x40", "100+75", "2x30+45" — ว่าง = spanLength × spanCount
  piers: {},            // ชนิดตอม่อรายต้น { "2": "B" } นับจากต้นแรก = 1 (ตอม่อริมเป็น D เมื่อ abutmentD)
  abutmentD: true,      // ตอม่อริม (ต้นแรก/ต้นสุดท้าย) เป็นผนังทึบ Type D
  wingWall: 2.5,        // ความยาวกำแพงปีกที่ตอม่อริม (ม.) 0 = ไม่มี (มีเฉพาะเมื่อตอม่อริมเป็น D)
  skew: 0               // มุมเฉียงของตอม่อ (องศา) ความหมายเดียวกับช่อง Skew ใน KML · โครงเหล็กไม่รับ
});

const LIMITS = Object.freeze({
  deckLevel: [4, 40],
  deckWidth: [4, 20],
  spanLength: [10, 120],   // v2: เดิม 80 — โครงการมีช่วง 100 ม.
  spanCount: [1, 30],
  girderDepth: [0, 6],
  portalSpan: [6, 40],
  aBaseWidth: [0, 4],
  aThick: [0, 4],
  aTopWidth: [0, 16],
  aFlareDepth: [0.5, 3],
  dThick: [1, 1.5],
  dRadius: [0.5, 0.75],
  trackSpacing: [3.5, 6.5],
  wingWall: [0, 12],
  skew: [-60, 60]
});

const PRESETS = Object.freeze({
  spanLength: [20, 25, 30, 40],
  deckWidth: [6, 8, 10, 12],
  portalSpan: [12, 16, 20, 25]
});

const SPAN_GAP = 0.1;      // ช่องว่างรอยต่อระหว่างช่วง (ม.)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- พารามิเตอร์ ---------- */
function normalizeParams(input = {}) {
  const p = { ...DEFAULTS, ...input };
  p.pierType = ['A', 'B', 'C', 'D'].includes(p.pierType) ? p.pierType : 'A';
  p.aTopMode = p.aTopMode === 'cap' ? 'cap' : 'direct';
  for (const key of ['aBaseWidth', 'aThick', 'aTopWidth']) {
    if (p[key] > 0 && p[key] < 1) p[key] = 1; // ค่าเล็กกว่า 1 ม. ที่ไม่ใช่ 0 (อัตโนมัติ) ปัดเป็น 1 ม.
  }
  p.deckType = p.deckType === 'truss' ? 'truss' : 'concrete';
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const n = Number(p[key]);
    p[key] = Number.isFinite(n) ? clamp(n, lo, hi) : DEFAULTS[key];
  }
  p.spanCount = Math.round(p.spanCount);
  if (p.girderDepth > 0 && p.girderDepth < 0.8) p.girderDepth = 0.8;
  p.tracks = [0, 1, 2].includes(Number(p.tracks)) ? Number(p.tracks) : DEFAULTS.tracks;
  p.gauge = Number(p.gauge) === 1.435 ? 1.435 : 1.0;
  p.name = String(p.name || DEFAULTS.name).trim().slice(0, 60) || DEFAULTS.name;
  // v2
  p.spanText = String(p.spanText || '').replace(/\s+/g, '').replace(/[×X*]/g, 'x');
  p.piers = normalizePiers(p.piers);
  const ab = input.abutmentD;
  p.abutmentD = ab === undefined ? Number(input.version) !== 1          // ไฟล์ v1 เดิม: ตอม่อทุกต้นชนิดเดียวกัน
    : (ab === true || ab === 'true' || ab === 'on' || ab === 1 || ab === '1');
  p.version = 2;
  return p;
}

// ชนิดตอม่อรายต้น: รับ { "2": "B" } หรือข้อความ "2:B, 3:C" → { "2": "B", "3": "C" }
function normalizePiers(v) {
  const out = {};
  const put = (k, t) => {
    const i = parseInt(k, 10), s = String(t || '').trim().toUpperCase();
    if (i >= 1 && ['A', 'B', 'C', 'D'].includes(s)) out[String(i)] = s;
  };
  if (typeof v === 'string') v.split(/[,;\s]+/).forEach((part) => { const m = part.match(/^(\d+)\s*[:=]\s*([A-Da-d])$/); if (m) put(m[1], m[2]); });
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, t]) => put(k, t));
  return out;
}

// "3x40" → [40,40,40] · "100+75" → [100,75] · "2x30+45" → [30,30,45] · รูปแบบผิด → null
function parseSpans(text) {
  const out = [];
  for (const part of String(text || '').split('+')) {
    const t = part.trim(); if (!t) continue;
    const m = t.match(/^(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)$/);
    if (m) { for (let i = 0; i < +m[1]; i++) out.push(+m[2]); }
    else if (/^\d+(\.\d+)?$/.test(t)) out.push(+t);
    else return null;
  }
  return out.length ? out : null;
}

/* ---------- คำนวณขนาดชิ้นส่วนจากพารามิเตอร์ ---------- */
function deriveDims(input) {
  const p = normalizeParams(input);
  const W = p.deckWidth;
  const errors = [];
  const warnings = [];
  // ช่วง: spanText (ถ้ามี) หรือ spanLength × spanCount · ขนาดชิ้นส่วนส่วนบนคิดจากช่วงที่ยาวที่สุด
  let spans = null;
  if (p.spanText) {
    spans = parseSpans(p.spanText);
    if (!spans) errors.push(`รูปแบบช่วง "${p.spanText}" ไม่ถูกต้อง ใช้แบบ 3x40 หรือ 100+75`);
    else if (spans.some((s) => s < LIMITS.spanLength[0] || s > LIMITS.spanLength[1])) {
      spans = spans.map((s) => clamp(s, LIMITS.spanLength[0], LIMITS.spanLength[1]));
      warnings.push(`ความยาวช่วงต้องอยู่ระหว่าง ${LIMITS.spanLength[0]}–${LIMITS.spanLength[1]} ม. ปรับให้อยู่ในช่วงแล้ว`);
    }
  }
  if (!spans) spans = Array.from({ length: p.spanCount }, () => p.spanLength);
  const L = Math.max(...spans);
  const truss = p.deckType === 'truss';
  // มุมเฉียง: โครงเหล็กไม่มีตอม่อเฉียง
  let skew = p.skew;
  if (truss && skew) { warnings.push(`โครงเหล็กไม่มีตอม่อเฉียง — ไม่ใช้มุมเฉียง ${skew}° (ตรวจข้อมูล)`); skew = 0; }

  // ความลึกโครงสร้างส่วนบน: คอนกรีต ≈ span/18, โครงเหล็ก = ระบบพื้น 1.6 ม.
  const superDepth = truss ? 1.6 : (p.girderDepth > 0 ? p.girderDepth : r1(clamp(L / 18, 1.2, 4)));
  const bearing = 0.15; // แผ่นรองคาน
  const capTopY = p.deckLevel - superDepth - bearing;
  const trussZ = W / 2 + 0.35; // แนวโครงถักสองข้าง

  // แผ่นรองคาน: ใต้คานกล่องคอนกรีต หรือใต้แนวโครงถัก
  const padHalf = truss ? trussZ : W * 0.21 * 0.7;
  const padZ = [-padHalf, padHalf];
  const padNeed = r1(padHalf * 2 + 0.9); // ความกว้างหัวเสาขั้นต่ำที่วางแผ่นรองได้

  let colD, capDepth = 0, capLen, capThick, colSpacing = 0, haunch = 0, hasCap = true;
  let aBase = 0, aThick = 0, aTop = 0, flareDepth = 0, flareLip = 0;
  let wallWidth = 0, wallRadius = 0;

  if (p.pierType === 'A') {
    // Type A: เสาเหลี่ยมมุมมน ขนาดคงที่จากโคน แล้วผายออกด้านขวางสะพานในช่วงบนสุด
    hasCap = p.aTopMode === 'cap';
    aBase = p.aBaseWidth > 0 ? p.aBaseWidth : r1(clamp(W * 0.2, 1.4, 3));
    aThick = p.aThick > 0 ? p.aThick : aBase;
    const autoTop = hasCap ? aBase + 1.0 : Math.max(aBase + 1.0, truss ? padNeed : r1(W * 0.42));
    aTop = p.aTopWidth > 0 ? p.aTopWidth : autoTop;
    if (aTop < aBase) {
      warnings.push(`ขนาดเสาด้านบน ${aTop} ม. เล็กกว่าขนาดโคน ${aBase} ม. ปรับให้เท่าขนาดโคนแล้ว`);
      aTop = aBase;
    }
    flareDepth = p.aFlareDepth;
    flareLip = flareDepth > 0.6 ? 0.2 : 0; // ขอบตั้งตรงสั้น ๆ ที่ยอด กันขอบบางเป็นคมมีด
    colD = aBase;
    if (hasCap) {
      capDepth = r1(clamp(W * 0.18, 1.5, 3));
      capLen = Math.max(W - 1, aTop + 1.0);
      capThick = r1(aThick + 0.8);
    } else {
      capLen = aTop;
      capThick = aThick;
      if (aTop < padNeed) warnings.push(`หัวเสากว้าง ${aTop} ม. ไม่พอวางแผ่นรองคาน ควรกว้างอย่างน้อย ${padNeed} ม.`);
      if (!truss && aTop > W) warnings.push(`หัวเสากว้าง ${aTop} ม. เกินความกว้างพื้นสะพาน ${W} ม.`);
      if (truss && aTop > W) warnings.push(`พื้นโครงเหล็กต้องให้หัวเสากว้างถึงแนวโครงถัก (${aTop} ม. กว้างกว่าพื้น) แนะนำแบบมีคานหัวเสา`);
    }
  } else if (p.pierType === 'B') {
    colD = r1(clamp(W * 0.1, 1.0, 1.8));
    capDepth = 1.4;
    colSpacing = r1(Math.max(W * 0.6, 3));
    capLen = colSpacing + colD + 1.0;
    capThick = r1(colD + 0.6);
  } else if (p.pierType === 'C') {
    // Type C พอร์ทัล: เสาเหลี่ยมสองต้นห่างกันตามช่องลอดที่ต้องการ คานขวางลึกตามระยะห่างเสา
    colSpacing = p.portalSpan;
    colD = r1(clamp(W * 0.12, 1.2, 2.0));
    capDepth = r1(clamp(colSpacing / 10, 1.6, 3.5));
    capLen = colSpacing + colD + 0.6;
    capThick = r1(colD + 0.4);
    haunch = r1(Math.min(1.5, colSpacing * 0.1));
  } else {
    // Type D ผนังทึบ: กว้างริมถึงริมแคบกว่าพื้นข้างละ 0.5 ม. ขอบริมโค้ง
    hasCap = false;
    wallWidth = r1(Math.max(W - 1.0, 2));
    wallRadius = p.dRadius;
    if (wallRadius > p.dThick / 2) {
      wallRadius = p.dThick / 2;
      warnings.push(`รัศมีขอบ ${p.dRadius} ม. เกินครึ่งความหนาผนัง ใช้ ${wallRadius} ม. แทน (ปลายผนังโค้งครึ่งวงกลม)`);
    }
    colD = p.dThick;
    capLen = wallWidth;
    capThick = p.dThick;
    if (truss && padHalf + 0.45 > wallWidth / 2) {
      warnings.push(`โครงถักอยู่นอกแนวผนัง แผ่นรองคานยื่นพ้นขอบผนังข้างละ ${r1(padHalf + 0.45 - wallWidth / 2)} ม.`);
    }
  }
  if (truss && hasCap) capLen = Math.max(capLen, trussZ * 2 + 0.9);

  const columnHeight = capTopY - capDepth;
  const trussHeight = truss ? r1(Math.max(8, L / 6)) : 0;
  const trussBottomY = p.deckLevel - superDepth + 0.35;

  const minCol = p.pierType === 'A' ? flareDepth + 0.5 : 1;
  if (columnHeight < minCol) {
    const need = r1(superDepth + bearing + capDepth + minCol);
    const parts = [`คาน ${superDepth} ม.`];
    if (capDepth > 0) parts.push(`คานหัวเสา ${capDepth} ม.`);
    if (p.pierType === 'A') parts.push(`ช่วงผาย ${flareDepth} ม.`);
    errors.push(`ระดับพื้นสะพาน ${p.deckLevel} ม. ต่ำเกินไป ต้องสูงอย่างน้อย ${need} ม. เพื่อให้มีที่สำหรับ${parts.join(' ')}`);
  }
  const needW = p.tracks === 2 ? 8 : p.tracks === 1 ? 4 : 0;
  if (W < needW) warnings.push(`พื้นกว้าง ${W} ม. แคบเกินไปสำหรับ ${p.tracks} ทาง ควรกว้างอย่างน้อย ${needW} ม.`);
  if (p.pierType === 'A' && hasCap && W > 14) warnings.push('พื้นกว้างเกิน 14 ม. คานหัวเสาแบบเสาเดี่ยวจะยื่นยาวมาก แนะนำ Type B');
  if (p.pierType === 'C' && colSpacing < W) warnings.push(`ระยะห่างเสา ${colSpacing} ม. แคบกว่าพื้นสะพาน ถ้าไม่ต้องคร่อมถนนหรือทางด้านล่าง Type B จะเหมาะกว่า`);
  if (p.pierType === 'C' && colSpacing > 30) warnings.push('ระยะห่างเสาเกิน 30 ม. คานขวางคอนกรีตจะลึกมาก ในงานจริงมักใช้คานเหล็กหรือคานอัดแรง');
  if (!truss && L > 45 && p.girderDepth === 0) warnings.push('span ยาวเกิน 45 ม. สำหรับคานคอนกรีต ลองพิจารณาโครงเหล็ก');

  return {
    params: p, W, L, truss,
    superDepth, bearing, capTopY, padZ, padNeed,
    colD, capDepth, capLen, capThick, colSpacing, haunch, hasCap,
    aBase, aThick, aTop, flareDepth, flareLip,
    wallWidth, wallRadius,
    clearWidth: p.pierType === 'C' ? colSpacing - colD : 0,
    columnHeight, trussHeight, trussZ, trussBottomY,
    spans, skew, skewRad: skew * Math.PI / 180,
    totalLength: spans.reduce((a, b) => a + b, 0),
    pierCount: spans.length + 1,
    trackCenters: p.tracks === 2 ? [-p.trackSpacing / 2, p.trackSpacing / 2] : p.tracks === 1 ? [0] : [],
    errors, warnings
  };
}

/* ---------- รูปด้านหน้าเสา Type A: [{ y, a }] a = ครึ่งความกว้างขวางสะพาน ---------- */
function pierProfileA(d, steps = 12) {
  const H = d.columnHeight;
  const a0 = d.aBase / 2;
  const a1 = d.aTop / 2;
  const y0 = H - d.flareDepth;
  const curve = d.flareDepth - d.flareLip;
  const levels = [{ y: 0, a: a0 }, { y: y0, a: a0 }];
  if (a1 > a0 + 1e-6) {
    // เสี้ยววงรี: เริ่มตั้งฉากต่อจากผิวเสา แล้วโค้งผายออกจนกว้างเท่าขนาดด้านบน
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * (Math.PI / 2);
      levels.push({ y: y0 + curve * Math.sin(t), a: a1 - (a1 - a0) * Math.cos(t) });
    }
  }
  levels.push({ y: H, a: a1 });
  return levels;
}

/* ---------- วัสดุ (ใช้ร่วมกัน ไม่ dispose) ---------- */
const MATERIALS = {
  deck:    new THREE.MeshStandardMaterial({ name: 'concrete-deck', color: 0xcac6bd, roughness: 0.92 }),
  pier:    new THREE.MeshStandardMaterial({ name: 'concrete-pier', color: 0xb5afa4, roughness: 0.95 }),
  steel:   new THREE.MeshStandardMaterial({ name: 'steel', color: 0x6d8294, roughness: 0.55, metalness: 0.35 }),
  rail:    new THREE.MeshStandardMaterial({ name: 'rail', color: 0x4a4e55, roughness: 0.4, metalness: 0.6 }),
  ballast: new THREE.MeshStandardMaterial({ name: 'ballast', color: 0x8e867b, roughness: 1 }),
  pad:     new THREE.MeshStandardMaterial({ name: 'bearing', color: 0x3b3d40, roughness: 0.8 })
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX.userData.shared = true;
const X_AXIS = new THREE.Vector3(1, 0, 0);

function box(sx, sy, sz, mat, name) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(sx, sy, sz);
  if (name) m.name = name;
  return m;
}

// ชิ้นส่วนเหลี่ยมระหว่างจุด a กับ b (สำหรับโครงถัก)
function member(a, b, size, mat, name) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = box(len, size, size, mat, name);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(X_AXIS, dir.normalize());
  return m;
}

/* ---------- ทรงตันหน้าตัดสี่เหลี่ยมมุมมน ที่ความกว้างเปลี่ยนตามความสูงได้ ----------
   levels = [{ y, a }]  a = ครึ่งความกว้างขวางสะพาน (แกน z)
   b = ครึ่งความหนาตามแนวสะพาน (แกน x), r = รัศมีมุม (ต้องไม่เกิน a และ b) */
function roundedRectRing(a, b, r, seg) {
  const pts = [];
  const corners = [[b - r, a - r], [-(b - r), a - r], [-(b - r), -(a - r)], [b - r, -(a - r)]];
  corners.forEach(([cx, cz], k) => {
    for (let i = 0; i <= seg; i++) {
      const t = (k + i / seg) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(t), cz + r * Math.sin(t)]);
    }
  });
  return pts;
}

function loftRoundedRect(levels, b, r, seg = 8) {
  const pos = [];
  const idx = [];
  const n = 4 * (seg + 1);
  for (const { y, a } of levels) {
    for (const [x, z] of roundedRectRing(a, b, Math.min(r, a, b), seg)) pos.push(x, y, z);
  }
  for (let k = 0; k < levels.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const v0 = k * n + i;
      const v1 = k * n + ((i + 1) % n);
      const v2 = v0 + n;
      const v3 = v1 + n;
      idx.push(v0, v2, v1, v1, v2, v3);
    }
  }
  // ฝาบนและฝาล่าง (จุดแยกเพื่อให้ผิวเรียบแบน)
  for (const [lv, up] of [[levels[levels.length - 1], true], [levels[0], false]]) {
    const base = pos.length / 3;
    pos.push(0, lv.y, 0);
    for (const [x, z] of roundedRectRing(lv.a, b, Math.min(r, lv.a, b), seg)) pos.push(x, lv.y, z);
    for (let i = 0; i < n; i++) {
      const c = base;
      const p0 = base + 1 + i;
      const p1 = base + 1 + ((i + 1) % n);
      if (up) idx.push(c, p1, p0); else idx.push(c, p0, p1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------- ชิ้นส่วนที่ใช้ซ้ำในสะพานเดียว ---------- */
function makeKit(d) {
  const kit = {};
  const type = d.params.pierType;
  if (type === 'A') {
    kit.colGeo = loftRoundedRect(pierProfileA(d), d.aThick / 2, Math.min(0.3, d.aThick / 4, d.aBase / 4));
  } else if (type === 'B') {
    kit.colGeo = new THREE.CylinderGeometry(d.colD / 2, (d.colD / 2) * 1.06, d.columnHeight, 28);
  } else if (type === 'D') {
    const a = d.wallWidth / 2;
    kit.colGeo = loftRoundedRect([{ y: 0, a }, { y: d.columnHeight, a }], d.params.dThick / 2, d.wallRadius, 12);
  }

  if (d.params.pierType === 'C' && d.haunch > 0) {
    // ครีบเสริมมุม (haunch) ใต้คานขวางทั้งสองข้าง
    const zi = d.colSpacing / 2 - d.colD / 2;
    const h = d.haunch;
    const tri = (sign) => {
      const t = new THREE.Shape();
      t.moveTo(sign * zi, 0);
      t.lineTo(sign * (zi - h), 0);
      t.lineTo(sign * zi, -h);
      t.closePath();
      return t;
    };
    kit.haunchGeo = new THREE.ExtrudeGeometry([tri(1), tri(-1)], { depth: d.capThick, bevelEnabled: false });
    kit.haunchGeo.translate(0, 0, -d.capThick / 2);
    kit.haunchGeo.rotateY(Math.PI / 2);
  }

  if (type === 'A' && d.hasCap) {
    // คานหัวเสาทรงค้อน (hammerhead): ด้านล่างสอบเข้าหาหัวเสาผาย
    const top = d.capLen / 2;
    const bot = Math.min(d.aTop / 2, top);
    const s = new THREE.Shape();
    s.moveTo(-bot, 0);
    s.lineTo(bot, 0);
    s.lineTo(top, d.capDepth * 0.45);
    s.lineTo(top, d.capDepth);
    s.lineTo(-top, d.capDepth);
    s.lineTo(-top, d.capDepth * 0.45);
    s.closePath();
    kit.capGeo = new THREE.ExtrudeGeometry(s, { depth: d.capThick, bevelEnabled: false });
    kit.capGeo.translate(0, 0, -d.capThick / 2);
    kit.capGeo.rotateY(Math.PI / 2);
  }

  if (!d.truss) {
    // หน้าตัดคานกล่อง (box girder) พร้อมปีกยื่นสองข้าง
    const W = d.W;
    const dep = d.superDepth;
    const bt = (W * 0.55) / 2;
    const bb = (W * 0.42) / 2;
    const s = new THREE.Shape();
    s.moveTo(-W / 2, 0);
    s.lineTo(W / 2, 0);
    s.lineTo(W / 2, -0.25);
    s.lineTo(bt, -0.45);
    s.lineTo(bb, -dep);
    s.lineTo(-bb, -dep);
    s.lineTo(-bt, -0.45);
    s.lineTo(-W / 2, -0.25);
    s.closePath();
    kit.girderGeo = new THREE.ExtrudeGeometry(s, { depth: d.L - SPAN_GAP, bevelEnabled: false });
    kit.girderGeo.rotateY(Math.PI / 2);
  }
  kit.padZ = d.padZ;
  return kit;
}

/* ---------- ตอม่อ ---------- */
function buildPier(d, kit) {
  const g = new THREE.Group();
  const H = d.columnHeight;

  if (d.params.pierType === 'A') {
    const col = new THREE.Mesh(kit.colGeo, MATERIALS.pier);
    col.name = 'flared-column';
    g.add(col);
    if (d.hasCap) {
      const cap = new THREE.Mesh(kit.capGeo, MATERIALS.pier);
      cap.name = 'pier-cap';
      cap.position.y = H;
      g.add(cap);
    }
  } else if (d.params.pierType === 'D') {
    const wall = new THREE.Mesh(kit.colGeo, MATERIALS.pier);
    wall.name = 'wall-pier';
    g.add(wall);
  } else if (d.params.pierType === 'C') {
    for (const z of [-d.colSpacing / 2, d.colSpacing / 2]) {
      const col = box(d.colD, H, d.colD, MATERIALS.pier, z < 0 ? 'column-left' : 'column-right');
      col.position.set(0, H / 2, z);
      g.add(col);
    }
    const beam = box(d.capThick, d.capDepth, d.capLen, MATERIALS.pier, 'portal-beam');
    beam.position.y = H + d.capDepth / 2;
    g.add(beam);
    if (kit.haunchGeo) {
      const hn = new THREE.Mesh(kit.haunchGeo, MATERIALS.pier);
      hn.name = 'haunch';
      hn.position.y = H;
      g.add(hn);
    }
  } else {
    for (const z of [-d.colSpacing / 2, d.colSpacing / 2]) {
      const col = new THREE.Mesh(kit.colGeo, MATERIALS.pier);
      col.name = z < 0 ? 'column-left' : 'column-right';
      col.position.set(0, H / 2, z);
      g.add(col);
    }
    const cap = box(d.capThick, d.capDepth, d.capLen, MATERIALS.pier, 'cross-beam');
    cap.position.y = H + d.capDepth / 2;
    g.add(cap);
  }

  for (const z of kit.padZ) {
    const pad = box(0.9, d.bearing, 0.9, MATERIALS.pad, 'bearing');
    pad.position.set(0, d.capTopY + d.bearing / 2, z);
    g.add(pad);
  }
  return g;
}

/* ---------- ทางรถไฟบนพื้นสะพาน ---------- */
function addTracks(g, d, x0, len) {
  const y = d.params.deckLevel;
  const half = d.params.gauge / 2 + 0.035;
  for (const zc of d.trackCenters) {
    const ballast = box(len, 0.3, 3.0, MATERIALS.ballast, 'ballast');
    ballast.position.set(x0 + len / 2, y + 0.15, zc);
    g.add(ballast);
    for (const side of [-half, half]) {
      const rail = box(len, 0.16, 0.07, MATERIALS.rail, 'rail');
      rail.position.set(x0 + len / 2, y + 0.38, zc + side);
      g.add(rail);
    }
  }
}

/* ---------- ช่วงสะพานคอนกรีต ---------- */
function buildConcreteSpan(d, kit) {
  const g = new THREE.Group();
  const x0 = SPAN_GAP / 2;
  const len = d.L - SPAN_GAP;
  const y = d.params.deckLevel;

  const girder = new THREE.Mesh(kit.girderGeo, MATERIALS.deck);
  girder.name = 'box-girder';
  girder.position.set(x0, y, 0);
  g.add(girder);

  for (const z of [-(d.W / 2 - 0.1), d.W / 2 - 0.1]) {
    const wall = box(len, 1.0, 0.2, MATERIALS.deck, 'parapet');
    wall.position.set(x0 + len / 2, y + 0.5, z);
    g.add(wall);
  }
  addTracks(g, d, x0, len);
  return g;
}

/* ---------- ช่วงสะพานโครงเหล็ก (Warren truss แบบทางรถวิ่งด้านล่าง) ---------- */
function buildTrussSpan(d) {
  const g = new THREE.Group();
  const x0 = SPAN_GAP / 2;
  const len = d.L - SPAN_GAP;
  const y = d.params.deckLevel;
  const yb = d.trussBottomY;
  const yt = yb + d.trussHeight;
  const zt = d.trussZ;
  const n = Math.max(2, Math.round(len / 5.5));
  const p = len / n;
  const V = (x, yy, z) => new THREE.Vector3(x, yy, z);

  const slab = box(len, 0.35, zt * 2, MATERIALS.deck, 'deck-slab');
  slab.position.set(x0 + len / 2, y - 0.175, 0);
  g.add(slab);

  const fbH = (y - 0.35) - (yb - 0.35);
  for (let i = 0; i <= n; i++) {
    const fb = box(0.4, fbH, zt * 2, MATERIALS.steel, 'floor-beam');
    fb.position.set(x0 + i * p, (y - 0.35 + yb - 0.35) / 2, 0);
    g.add(fb);
  }

  for (const z of [-zt, zt]) {
    const side = z < 0 ? 'L' : 'R';
    g.add(member(V(x0, yb, z), V(x0 + len, yb, z), 0.7, MATERIALS.steel, `bottom-chord-${side}`));
    g.add(member(V(x0 + 0.5 * p, yt, z), V(x0 + len - 0.5 * p, yt, z), 0.7, MATERIALS.steel, `top-chord-${side}`));
    for (let i = 0; i < n; i++) {
      const xb0 = x0 + i * p;
      const xt = x0 + (i + 0.5) * p;
      const xb1 = x0 + (i + 1) * p;
      g.add(member(V(xb0, yb, z), V(xt, yt, z), 0.45, MATERIALS.steel, 'diagonal'));
      g.add(member(V(xt, yt, z), V(xb1, yb, z), 0.45, MATERIALS.steel, 'diagonal'));
      g.add(member(V(xt, yb, z), V(xt, yt, z), 0.3, MATERIALS.steel, 'vertical'));
    }
  }

  // คานขวางด้านบนและค้ำยันทแยง
  for (let i = 0; i < n; i++) {
    const xt = x0 + (i + 0.5) * p;
    g.add(member(V(xt, yt, -zt), V(xt, yt, zt), 0.35, MATERIALS.steel, 'top-strut'));
    if (i < n - 1) {
      const xn = xt + p;
      g.add(member(V(xt, yt, -zt), V(xn, yt, zt), 0.2, MATERIALS.steel, 'top-bracing'));
      g.add(member(V(xt, yt, zt), V(xn, yt, -zt), 0.2, MATERIALS.steel, 'top-bracing'));
    }
  }

  addTracks(g, d, x0, len);
  return g;
}

/* ---------- ชิ้นส่วนที่ใช้ร่วมกับ bpnp-map3d (v2) ----------
   ทั้งสองระบบใช้ฟังก์ชันชุดนี้วางตอม่อ/ช่วงทีละชิ้น — demo วางเป็นเส้นตรงใน buildBridge()
   bpnp-map3d วางตาม กม. บนแนวราง (js/layers/structure/bridge_3d.js) */

// ชนิดตอม่อต้นที่ i (0 = ต้นแรก, n = ต้นสุดท้าย เมื่อมี n ช่วง)
function pierTypeAt(p, i, n) {
  if (p.abutmentD && (i === 0 || i === n)) return 'D';
  const t = String((p.piers || {})[String(i + 1)] || p.pierType || 'A').toUpperCase();
  return ['A', 'B', 'C', 'D'].includes(t) ? t : 'A';
}

// พารามิเตอร์ของตอม่อต้นที่ i: ชนิด · ช่วงที่ยาวกว่าระหว่างสองข้าง (กำหนดความลึกคาน)
// สะพานเฉียง: ความกว้างตามแนวตอม่อ = ความกว้างพื้น ÷ cos(skew) ให้รับพื้นได้เต็มความกว้าง (สูงสุด 20 ม.)
function pierParams(p, spans, i, skewRad = 0) {
  const n = spans.length;
  return Object.assign({}, p, {
    pierType: pierTypeAt(p, i, n),
    spanLength: Math.max(spans[i - 1] || 0, spans[i] || 0),
    spanCount: 1, spanText: '', skew: 0,   // การเฉียงจัดการตอนวาง (หมุนตอม่อ/เฉือนช่วง) — ไม่เตือนซ้ำรายต้น
    deckWidth: skewRad ? Math.min(20, Math.round(p.deckWidth / Math.cos(skewRad) * 100) / 100) : p.deckWidth
  });
}

// พารามิเตอร์ของช่วงยาว L
function spanParams(p, L) { return Object.assign({}, p, { spanLength: L, spanCount: 1, spanText: '', skew: 0 }); }

// ระดับพื้นเดียวทั้งสะพาน: ยกทีละ 0.25 ม. จนตอม่อทุกต้นสร้างได้ → { deckLevel, raised }
function fitDeckLevel(p, spans, skewRad = 0) {
  const ok = (dl) => spans.concat([0]).every((_, i) => deriveDims(Object.assign(pierParams(p, spans, i, skewRad), { deckLevel: dl })).errors.length === 0);
  let dl = p.deckLevel, guard = 0;
  while (!ok(dl) && guard++ < 140) dl = Math.round((dl + 0.25) * 100) / 100;
  return { deckLevel: dl, raised: dl !== p.deckLevel };
}

// ช่วงสะพาน (คอนกรีต / โครงเหล็ก) x จาก 0 ถึง L
function buildSpan(d, kit) { return d.truss ? buildTrussSpan(d) : buildConcreteSpan(d, kit); }

// สะพานเฉียง: เฉือนช่วงทั้งก้อน x' = x + tan(skew)·z → ปลายช่วงขนานแนวตอม่อ (แนวกึ่งกลาง z = 0 ไม่เปลี่ยน)
function skewSpan(span, skewRad) {
  if (!skewRad) return span;
  span.updateMatrix();
  span.matrixAutoUpdate = false;
  span.matrix.multiply(new THREE.Matrix4().makeShear(0, 0, 0, 0, Math.tan(skewRad), 0));
  return span;
}

/* กำแพงปีกที่ตอม่อริม (ตอม่อ Type D)
   dir = +1 ยื่นไปทาง +x (หลังตอม่อริมท้าย) · −1 ยื่นไปทาง −x (หน้าตอม่อริมหัว) · ext = ความยาว (ม.)
   สูงจากพื้นถึงใต้พื้นสะพาน · เริ่มที่ผิวผนังตรงปลายผนังสองข้าง
   skewRad = มุมเฉียงของตอม่อ (ตอม่อหมุน +skew) → กำแพงปีกหมุนกลับ −skew ให้ขนานแนวสะพาน/แนวทางรถไฟ */
function buildWingWalls(d, dir, ext, skewRad = 0) {
  const g = new THREE.Group();
  g.name = 'wing-walls';
  const h = Math.max(1, d.params.deckLevel - 0.3);
  const t = 0.4;
  const zEdge = Math.max(1, (d.wallWidth || (d.W - 1)) / 2 - t / 2);
  const ca = Math.cos(skewRad), sa = Math.sin(skewRad);   // แนวสะพานในกรอบของตอม่อ = (cos, 0, sin)
  for (const z of [-zEdge, zEdge]) {
    const w = box(ext, h, t, MATERIALS.pier, 'wing-wall');
    w.position.set(dir * d.params.dThick / 2 + dir * ca * ext / 2, h / 2, z + dir * sa * ext / 2);
    w.rotation.y = -skewRad;
    g.add(w);
  }
  return g;
}

/* ---------- สร้างสะพานทั้งชุด (demo: แนวตรงตามแกน x) ----------
   origin = โคนตอม่อต้นแรก · ช่วงไม่เท่ากัน (spanText) · ชนิดตอม่อรายต้น · ตอม่อริม D + กำแพงปีก · มุมเฉียง */
function buildBridge(input) {
  const d0 = deriveDims(input);
  const p0 = d0.params;
  const root = new THREE.Group();
  root.name = p0.name;
  root.userData = {
    generator: GENERATOR_ID,
    bridgeParams: { ...p0 },
    totalLength: d0.totalLength,
    axes: 'x=along bridge, y=up, z=across; origin=base of first pier; unit=m'
  };
  if (d0.errors.length) {
    root.userData.errors = d0.errors;
    return root;
  }
  const spans = d0.spans, n = spans.length, skewRad = d0.skewRad;
  const fit = fitDeckLevel(p0, spans, skewRad);
  const p = Object.assign({}, p0, { deckLevel: fit.deckLevel });
  const notes = [];
  if (fit.raised) notes.push(`ระดับพื้น ${p0.deckLevel} ม. ต่ำเกินไปสำหรับตอม่อบางต้น ใช้ ${fit.deckLevel} ม.`);

  const xs = [0];
  spans.forEach((L) => xs.push(xs[xs.length - 1] + L));

  const piers = new THREE.Group();
  piers.name = 'piers';
  for (let i = 0; i <= n; i++) {
    const d = deriveDims(pierParams(p, spans, i, skewRad));
    d.warnings.forEach((w) => notes.push(`ตอม่อ ${i + 1}: ${w}`));
    const pier = buildPier(d, makeKit(d));
    pier.name = `pier-${i + 1}`;
    if (p.abutmentD && (i === 0 || i === n) && p.wingWall > 0.3) pier.add(buildWingWalls(d, i === 0 ? -1 : 1, p.wingWall, skewRad));
    pier.position.x = xs[i];
    pier.rotation.y = skewRad;
    piers.add(pier);
  }

  const spanGroup = new THREE.Group();
  spanGroup.name = 'spans';
  spans.forEach((L, i) => {
    const d = deriveDims(spanParams(p, L));
    const span = buildSpan(d, makeKit(d));
    span.name = `span-${i + 1}`;
    span.position.x = xs[i];
    skewSpan(span, skewRad);
    spanGroup.add(span);
  });

  root.add(piers, spanGroup);
  root.userData.notes = [...new Set(notes)];
  root.userData.deckLevel = fit.deckLevel;
  return root;
}

// คืนหน่วยความจำ GPU ของสะพานที่สร้างจาก buildBridge (ไม่ยุ่งกับชิ้นที่ใช้ร่วม)
function disposeBridge(obj) {
  if (!obj) return;
  const seen = new Set();
  obj.traverse((o) => {
    if (o.isMesh && o.geometry && !o.geometry.userData.shared && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
  });
}

// หาพารามิเตอร์ที่ฝังไว้ในโมเดล (เช่นจากไฟล์ .glb ที่ export จากหน้าออกแบบ)
function findBridgeParams(obj) {
  let found = null;
  obj.traverse((o) => {
    if (!found && o.userData && o.userData.bridgeParams) found = o.userData.bridgeParams;
  });
  return found ? normalizeParams(found) : null;
}

  return {
    GENERATOR_ID, DEFAULTS, LIMITS, PRESETS, MATERIALS,
    normalizeParams, parseSpans, deriveDims, pierProfileA, makeKit,
    buildPier, buildSpan, buildWingWalls, skewSpan, pierTypeAt, pierParams, spanParams, fitDeckLevel,
    buildBridge, disposeBridge, findBridgeParams
  };
}

  root.BridgeGen = { create, GENERATOR_ID: 'bpnp-bridge-gen@2' };
  if (root.BPNP) root.BPNP.bridgeGen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
