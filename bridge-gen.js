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
 *
 * ── v3 ──
 *   bridgeKind: concrete | steel | overpass (แท็บในหน้าออกแบบ)
 *   girderType: box (คานเดิม) | igirder (คาน I แยกตัว + แผ่นพื้น + คานขวาง) | truss (สะพานเหล็ก)
 *   floorType (สะพานเหล็ก): concrete | open (พื้นโครงเหล็ก + หมอนเหล็ก + ทางเดิน)
 *   railings: 0/2/3/4/custom · railingStyle: wall | steel
 *   Overpass: levels = ระดับพื้นรายต้น ช่วงลาดจากต้นหนึ่งถึงอีกต้น
 *   ค่าเดิม (ไม่มี bridgeKind) ได้รูปเหมือน v2 ทุกอย่าง → bpnp-map3d ไม่ต้องแก้ bridge_3d.json
 */
(function (root) {
  'use strict';
  function create(THREE) {

const GENERATOR_ID = 'bpnp-bridge-gen@3';

const KINDS = ['concrete', 'steel', 'overpass'];
const GIRDER_TYPES = { concrete: ['box', 'igirder'], steel: ['truss', 'igirder'], overpass: ['box', 'igirder'] };

const DEFAULTS = Object.freeze({
  version: 3,
  name: 'สะพาน 1',
  bridgeKind: 'concrete', // v3: concrete = สะพานคอนกรีต, steel = สะพานเหล็ก, overpass = สะพานถนนข้าม
  girderType: 'box',    // v3: box = คานเดิม (คานกล่อง), igirder = คาน I แยกตัว, truss = โครงถัก (เฉพาะสะพานเหล็ก)
  pierType: 'A',        // A = เสาเดี่ยวผายบน, B = เสาคู่, C = พอร์ทัล (คร่อมถนน/ทางด้านล่าง), D = ผนังทึบ
  deckType: 'concrete', // (v1/v2) concrete | truss — คำนวณจาก girderType ให้ระบบเดิมใช้ต่อได้
  deckLevel: 12,        // ระดับผิวพื้นสะพานจากพื้นดิน (ม.)
  deckWidth: 10,        // ความกว้างพื้นสะพาน (ม.)
  spanLength: 30,       // ความยาวช่วงสะพาน (ม.)
  spanCount: 3,         // จำนวนช่วง
  girderDepth: 0,       // ความลึกคาน / ความสูงคาน I (ม.) 0 = คำนวณให้อัตโนมัติ
  portalSpan: 16,       // ระยะห่างศูนย์กลางเสา Type C (ม.)
  aTopMode: 'direct',   // Type A: direct = เสาผายรับคานโดยตรง, cap = เสาผาย + คานหัวเสา
  aBaseWidth: 0,        // Type A: ขนาดเสาโคน ขวางสะพาน (ม.) 0 = คำนวณให้
  aThick: 0,            // Type A: ความหนาเสา ตามแนวสะพาน (ม.) 0 = เท่าขนาดโคน
  aTopWidth: 0,         // Type A: ขนาดเสาด้านบน ขวางสะพาน (ม.) 0 = คำนวณให้
  aFlareDepth: 1.2,     // Type A: ความลึกช่วงผายจากยอดเสา (ม.)
  dThick: 1.2,          // Type D: ความหนาผนัง ตามแนวสะพาน (ม.)
  dRadius: 0.6,         // Type D: รัศมีขอบโค้งริมผนัง (ม.)
  tracks: 2,            // จำนวนทางรถไฟบนสะพาน 0 / 1 / 2 (Overpass = 0 เสมอ)
  gauge: 1.0,           // ขนาดราง 1.000 หรือ 1.435 ม.
  // ── v2 (ตรงกับ bpnp-map3d) ──
  trackSpacing: 5.0,    // ระยะศูนย์กลางทางคู่ (ม.)
  spanText: '',         // ช่วงแบบข้อความ "3x40", "100+75", "2x30+45" — ว่าง = spanLength × spanCount
  piers: {},            // ชนิดตอม่อรายต้น { "2": "B" } นับจากต้นแรก = 1 (ตอม่อริมเป็น D เมื่อ abutmentD)
  abutmentD: true,      // ตอม่อริม (ต้นแรก/ต้นสุดท้าย) เป็นผนังทึบ Type D
  wingWall: 2.5,        // ความยาวกำแพงปีกที่ตอม่อริม (ม.) 0 = ไม่มี (มีเฉพาะเมื่อตอม่อริมเป็น D)
  skew: 0,              // มุมเฉียงของตอม่อ (องศา) ความหมายเดียวกับช่อง Skew ใน KML · สะพานเหล็กไม่รับ
  // ── v3: พื้นและราว ──
  slabThick: 0.25,      // ความหนาแผ่นพื้นบนคาน I (ม.)
  railings: '2',        // ราวสะพาน '0' | '2' | '3' | '4' | 'custom'
  railingInset: 1.0,    // ราว 4 แนว: ระยะราวด้านในจากขอบพื้น (ม.)
  railingList: '',      // ราวแบบกำหนดเอง: ระยะจากศูนย์กลางสะพาน ม. ลบ = ซ้าย เช่น "-6.4, -5.2, 5.2, 6.4"
  railingStyle: 'wall', // wall = กำแพงคอนกรีต, steel = ราวเหล็ก
  railingHeight: 1.0,   // ความสูงราว (ม.)
  // ── v3: คาน I ──
  girderCount: 0,       // จำนวนคาน 0 = คำนวณให้
  girderWidth: 0,       // ความกว้างปีกคาน (ม.) 0 = คำนวณให้ (คอนกรีต 1.0 / เหล็ก 0.6)
  edgeGirder: 'i',      // คานริม: i = เว้าเอวทั้งสองด้าน, solid = ด้านนอกทึบเรียบ
  diaphragm: 'mid',     // คานขวาง: none | ends | mid (ปลาย+กลาง) | third (ปลาย+1/3) | spacing (ทุกระยะ)
  diaphragmSpacing: 10, // ระยะคานขวาง เมื่อ diaphragm = spacing (ม.)
  // ── v3: พื้นสะพานเหล็ก ──
  floorType: 'concrete',// concrete = พื้นคอนกรีต + หินโรยทาง, open = พื้นโครงเหล็ก + หมอนเหล็ก
  sleeperSpacing: 0.6,  // ระยะห่างหมอน (ม.)
  sleeperLength: 2.2,   // ความยาวหมอน (ม.)
  sleeperWidth: 0.25,   // ความกว้างหมอน (ม.)
  sleeperHeight: 0.15,  // ความสูงหมอน (ม.)
  walkway: true,        // ทางเดินตรวจสภาพบนพื้นโครงเหล็ก
  // ── v3: Overpass ──
  levels: {},           // ระดับพื้นรายต้น { "1": 4.5, "3": 7.2 } ต้นที่ไม่ระบุประมาณค่าเชิงเส้น
  lanes: 2,             // จำนวนช่องจราจร (เส้นแบ่งช่อง)
  maxGrade: 6           // ความชันสูงสุดที่ยอมรับ (%) เกินแล้วเตือน
});

// ค่าตั้งต้นของแต่ละแท็บ (ใช้เมื่อเริ่มแท็บใหม่ — ค่าที่ส่งมาทับค่านี้)
const KIND_DEFAULTS = Object.freeze({
  concrete: { girderType: 'box', railingStyle: 'wall', railings: '2', name: 'สะพานคอนกรีต 1' },
  steel: { girderType: 'truss', floorType: 'concrete', railingStyle: 'steel', railings: '2', spanLength: 50, spanCount: 1, deckLevel: 10, aTopMode: 'cap', name: 'สะพานเหล็ก 1' },
  overpass: { girderType: 'box', railingStyle: 'wall', railings: '2', tracks: 0, deckLevel: 7, deckWidth: 10.5,
    spanLength: 30, spanCount: 3, levels: { 1: 5, 2: 6.5, 3: 6.5, 4: 5 }, name: 'Overpass 1' }
});

const LIMITS = Object.freeze({
  deckLevel: [2, 40],      // v3: เดิม 4 — Overpass ตอม่อริมต่ำกว่า 4 ม. ได้
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
  skew: [-60, 60],
  slabThick: [0.15, 0.5],
  railingInset: [0.3, 3],
  railingHeight: [0.6, 2],
  girderCount: [0, 16],
  girderWidth: [0, 2.5],
  diaphragmSpacing: [3, 30],
  sleeperSpacing: [0.4, 1.2],
  sleeperLength: [1.6, 3.2],
  sleeperWidth: [0.15, 0.4],
  sleeperHeight: [0.1, 0.3],
  lanes: [0, 6],
  maxGrade: [1, 15]
});

const PRESETS = Object.freeze({
  spanLength: [20, 25, 30, 40],
  deckWidth: [6, 8, 10, 12],
  portalSpan: [12, 16, 20, 25],
  sleeperSpacing: [0.5, 0.6, 0.7]
});

const SPAN_GAP = 0.1;      // ช่องว่างรอยต่อระหว่างช่วง (ม.)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const truthy = (v) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';

/* ---------- พารามิเตอร์ ---------- */
function normalizeParams(input = {}) {
  input = input || {};
  // แท็บ: ไฟล์ v1/v2 ไม่มี bridgeKind → ดูจาก deckType (truss = สะพานเหล็ก)
  const legacy = !KINDS.includes(input.bridgeKind);
  const kind = legacy ? (input.deckType === 'truss' || input.girderType === 'truss' ? 'steel' : 'concrete') : input.bridgeKind;
  // ไฟล์เดิมใช้ค่าตั้งต้นที่ให้รูปเหมือนเดิม (โครงถักเดิมไม่มีราว) · แท็บใหม่ใช้ KIND_DEFAULTS
  const base = legacy
    ? (kind === 'steel' ? { girderType: 'truss', floorType: 'concrete', railings: '0', railingStyle: 'steel' } : {})
    : KIND_DEFAULTS[kind];
  const p = { ...DEFAULTS, ...base, ...input };
  p.bridgeKind = kind;
  if (!GIRDER_TYPES[kind].includes(p.girderType)) p.girderType = GIRDER_TYPES[kind][0];
  p.deckType = p.girderType === 'truss' ? 'truss' : 'concrete';
  p.pierType = ['A', 'B', 'C', 'D'].includes(p.pierType) ? p.pierType : 'A';
  p.aTopMode = p.aTopMode === 'cap' ? 'cap' : 'direct';
  for (const key of ['aBaseWidth', 'aThick', 'aTopWidth']) {
    if (p[key] > 0 && p[key] < 1) p[key] = 1; // ค่าเล็กกว่า 1 ม. ที่ไม่ใช่ 0 (อัตโนมัติ) ปัดเป็น 1 ม.
  }
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const n = Number(p[key]);
    p[key] = Number.isFinite(n) ? clamp(n, lo, hi) : DEFAULTS[key];
  }
  p.spanCount = Math.round(p.spanCount);
  p.girderCount = Math.round(p.girderCount);
  p.lanes = Math.round(p.lanes);
  if (p.girderDepth > 0 && p.girderDepth < 0.8) p.girderDepth = 0.8;
  if (p.girderWidth > 0 && p.girderWidth < 0.3) p.girderWidth = 0.3;
  p.tracks = [0, 1, 2].includes(Number(p.tracks)) ? Number(p.tracks) : DEFAULTS.tracks;
  if (kind === 'overpass') p.tracks = 0;
  p.gauge = Number(p.gauge) === 1.435 ? 1.435 : 1.0;
  p.name = String(p.name || DEFAULTS.name).trim().slice(0, 60) || DEFAULTS.name;
  // v2
  p.spanText = String(p.spanText || '').replace(/\s+/g, '').replace(/[×X*]/g, 'x');
  p.piers = normalizePiers(p.piers);
  const ab = input.abutmentD;
  p.abutmentD = ab === undefined ? Number(input.version) !== 1          // ไฟล์ v1 เดิม: ตอม่อทุกต้นชนิดเดียวกัน
    : truthy(ab);
  // v3
  p.railings = ['0', '2', '3', '4', 'custom'].includes(String(p.railings)) ? String(p.railings) : '2';
  p.railingList = String(p.railingList || '').trim().slice(0, 120);
  p.railingStyle = p.railingStyle === 'steel' ? 'steel' : 'wall';
  p.edgeGirder = p.edgeGirder === 'solid' ? 'solid' : 'i';
  p.diaphragm = ['none', 'ends', 'mid', 'third', 'spacing'].includes(p.diaphragm) ? p.diaphragm : 'mid';
  p.floorType = kind === 'steel' && p.floorType === 'open' ? 'open' : 'concrete';
  p.walkway = input.walkway === undefined ? DEFAULTS.walkway : truthy(input.walkway);
  p.levels = kind === 'overpass' ? normalizeLevels(p.levels) : {};
  p.version = 3;
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

// ระดับพื้นรายต้น (Overpass): { "1": 4.5 } หรือข้อความ "1:4.5, 2:7.2" → { "1": 4.5, "2": 7.2 }
function normalizeLevels(v) {
  const out = {};
  const put = (k, t) => {
    const i = parseInt(k, 10), n = Number(t);
    if (i >= 1 && i <= 31 && Number.isFinite(n)) out[String(i)] = r2(clamp(n, LIMITS.deckLevel[0], LIMITS.deckLevel[1]));
  };
  if (typeof v === 'string') v.split(/[,;\s]+/).forEach((part) => { const m = part.match(/^(\d+)\s*[:=]\s*(-?\d+(?:\.\d+)?)$/); if (m) put(m[1], m[2]); });
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

// ช่วงของสะพาน → { spans, errors, warnings }
function spansOf(p) {
  const errors = [], warnings = [];
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
  return { spans, errors, warnings };
}

/* ระดับพื้นรายต้น (Overpass) — ต้นที่ระบุใช้ค่านั้น ต้นระหว่างกลางประมาณค่าเชิงเส้นตามระยะ
   ก่อนต้นแรกที่ระบุ/หลังต้นสุดท้ายที่ระบุใช้ค่าต้นที่ใกล้ที่สุด · ไม่ระบุเลย = deckLevel ทุกต้น */
function deckLevels(p, spans) {
  const n = spans.length;
  const xs = [0];
  spans.forEach((L) => xs.push(xs[xs.length - 1] + L));
  const known = Object.entries(p.levels || {})
    .map(([k, v]) => [parseInt(k, 10) - 1, Number(v)])
    .filter(([i, v]) => i >= 0 && i <= n && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  if (p.bridgeKind !== 'overpass' || !known.length) return xs.map(() => p.deckLevel);
  return xs.map((x, i) => {
    const exact = known.find(([k]) => k === i);
    if (exact) return exact[1];
    const prev = known.filter(([k]) => k < i).pop();
    const next = known.find(([k]) => k > i);
    if (!prev) return next[1];
    if (!next) return prev[1];
    const t = (x - xs[prev[0]]) / (xs[next[0]] - xs[prev[0]]);
    return r2(prev[1] + (next[1] - prev[1]) * t);
  });
}

/* ---------- รูปหน้าตัดคาน I ----------
   sec = { h, bf, bb, tw, tf, ta, bt, tb } · ยอดคาน y = 0 ลงไป −h
   solidSide = 0 เว้าเอวทั้งสองด้าน, +1 / −1 = ด้านนั้นทึบเรียบ (ด้านนอกของคานริม) · พิกัด [z, y] */
function iGirderSection(p, h, steel) {
  const bf = p.girderWidth > 0 ? p.girderWidth : (steel ? 0.6 : 1.0);
  if (steel) {
    const tf = r2(clamp(h * 0.03, 0.04, 0.08));
    return { h, bf, bb: bf, tw: 0.04, tf, ta: 0, bt: tf, tb: 0, steel: true };
  }
  return {
    h, bf,
    bb: r2(Math.max(0.5, bf * 0.75)),
    tw: r2(clamp(bf * 0.2, 0.16, 0.25)),
    tf: r2(clamp(h * 0.1, 0.12, 0.2)),
    ta: r2(clamp(h * 0.06, 0.05, 0.15)),
    bt: r2(clamp(h * 0.14, 0.15, 0.3)),
    tb: r2(clamp(h * 0.1, 0.1, 0.25)),
    steel: false
  };
}

function iGirderPoints(sec, solidSide = 0) {
  const { h, bf, bb, tw, tf, ta, bt, tb } = sec;
  const ext = Math.max(bf, bb) / 2;
  const half = (s) => (solidSide === s
    ? [[s * ext, 0], [s * ext, -h]]
    : [[s * bf / 2, 0], [s * bf / 2, -tf], [s * tw / 2, -tf - ta], [s * tw / 2, -h + bt + tb], [s * bb / 2, -h + bt], [s * bb / 2, -h]]);
  return [...half(1), ...half(-1).reverse()];
}

/* ---------- คำนวณขนาดชิ้นส่วนจากพารามิเตอร์ ---------- */
function deriveDims(input) {
  const p = normalizeParams(input);
  const W = p.deckWidth;
  const sp = spansOf(p);
  const errors = sp.errors;
  const warnings = sp.warnings;
  const spans = sp.spans;
  const L = Math.max(...spans);
  const kind = p.bridgeKind;
  const steel = kind === 'steel';
  const overpass = kind === 'overpass';
  const truss = p.girderType === 'truss';
  const ig = p.girderType === 'igirder';
  const open = steel && p.floorType === 'open';     // พื้นโครงเหล็ก + หมอนเหล็ก
  const ballast = !open && !overpass;               // หินโรยทาง

  // Overpass: ระดับพื้นรายต้น · ตรวจและแสดงหน้าตัดที่ต้นสูงสุด
  const levels = deckLevels(p, spans);
  const DL = overpass ? Math.max(...levels) : p.deckLevel;
  const grades = overpass ? spans.map((s, i) => r2((levels[i + 1] - levels[i]) / s * 100)) : [];

  // มุมเฉียง: สะพานเหล็กไม่มีตอม่อเฉียง
  let skew = p.skew;
  if (steel && skew) { warnings.push(`สะพานเหล็กไม่มีตอม่อเฉียง — ไม่ใช้มุมเฉียง ${skew}° (ตรวจข้อมูล)`); skew = 0; }

  // คาน I: หน้าตัดและตำแหน่งคาน
  let iSec = null, girderZ = [], girderH = 0;
  if (ig) {
    girderH = p.girderDepth > 0 ? p.girderDepth : r1(steel ? clamp(L / 15, 0.8, 3.5) : clamp(L / 17, 0.9, 2.4));
    iSec = iGirderSection(p, girderH, steel);
    const pairUnderTracks = open && p.girderCount === 0 && p.tracks > 0;
    if (pairUnderTracks) {
      // พื้นโครงเหล็กบนคาน I: คานคู่ใต้รางแต่ละทาง หมอนวางบนคานโดยตรง
      const s = p.gauge > 1.2 ? 2.0 : 1.8;
      const centers = p.tracks === 2 ? [-p.trackSpacing / 2, p.trackSpacing / 2] : [0];
      centers.forEach((zc) => girderZ.push(r2(zc - s / 2), r2(zc + s / 2)));
    } else {
      const n = p.girderCount > 0 ? p.girderCount
        : Math.max(2, Math.round((W - 2.1) / (steel ? 2.6 : 2.0)) + 1);
      const edge = W / 2 - Math.max(1.05, iSec.bf / 2 + 0.5);
      girderZ = n === 1 ? [0] : Array.from({ length: n }, (_, k) => r2(-edge + (2 * edge * k) / (n - 1)));
      if (n > 1 && (2 * edge) / (n - 1) < Math.max(iSec.bf, iSec.bb) + 0.05) {
        warnings.push(`คาน ${n} ตัวชิดกันเกินไป (ห่าง ${r2((2 * edge) / (n - 1))} ม. ปีกคานกว้าง ${iSec.bf} ม.) ลดจำนวนคานหรือความกว้างปีก`);
      }
    }
  }

  // ความลึกโครงสร้างส่วนบน: คานกล่อง ≈ span/18 · คาน I + แผ่นพื้น · โครงเหล็ก = ระบบพื้น 1.6 ม.
  const superDepth = truss ? 1.6
    : ig ? r2(girderH + (open ? 0 : p.slabThick))
    : (p.girderDepth > 0 ? p.girderDepth : r1(clamp(L / 18, 1.2, 4)));
  const bearing = 0.15; // แผ่นรองคาน
  const capTopY = DL - superDepth - bearing;
  const trussZ = W / 2 + 0.35; // แนวโครงถักสองข้าง

  // แผ่นรองคาน: ใต้คานกล่อง · ใต้แนวโครงถัก · ใต้คาน I ทุกตัว
  const padSize = ig ? r2(Math.min(0.9, Math.max(iSec.bf, iSec.bb) + 0.1)) : 0.9;
  const padZ = truss ? [-trussZ, trussZ] : ig ? girderZ.slice() : [-W * 0.21 * 0.7, W * 0.21 * 0.7];
  const padHalf = Math.max(...padZ.map(Math.abs));
  const padNeed = r1(padHalf * 2 + padSize); // ความกว้างหัวเสาขั้นต่ำที่วางแผ่นรองได้
  const wide = truss || ig;                   // แผ่นรองกระจายเต็มความกว้าง

  let colD, capDepth = 0, capLen, capThick, colSpacing = 0, haunch = 0, hasCap = true;
  let aBase = 0, aThick = 0, aTop = 0, flareDepth = 0, flareLip = 0;
  let wallWidth = 0, wallRadius = 0;

  if (p.pierType === 'A') {
    // Type A: เสาเหลี่ยมมุมมน ขนาดคงที่จากโคน แล้วผายออกด้านขวางสะพานในช่วงบนสุด
    hasCap = p.aTopMode === 'cap';
    aBase = p.aBaseWidth > 0 ? p.aBaseWidth : r1(clamp(W * 0.2, 1.4, 3));
    aThick = p.aThick > 0 ? p.aThick : aBase;
    const autoTop = hasCap ? aBase + 1.0 : Math.max(aBase + 1.0, wide ? padNeed : r1(W * 0.42));
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
      if (ig && girderZ.length > 2 && aTop > W * 0.6) warnings.push('คาน I หลายตัวกับเสาผายรับคานโดยตรง หัวเสาจะผายกว้างมาก แนะนำแบบมีคานหัวเสา');
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
    if (wide && padHalf + padSize / 2 > wallWidth / 2) {
      warnings.push(`${truss ? 'โครงถัก' : 'คานริม'}อยู่นอกแนวผนัง แผ่นรองคานยื่นพ้นขอบผนังข้างละ ${r1(padHalf + padSize / 2 - wallWidth / 2)} ม.`);
    }
  }
  if (wide && hasCap) capLen = Math.max(capLen, padNeed);

  const columnHeight = capTopY - capDepth;
  const trussHeight = truss ? r1(Math.max(8, L / 6)) : 0;
  const trussBottomY = DL - superDepth + 0.35;

  const minCol = p.pierType === 'A' ? flareDepth + 0.5 : 1;
  if (columnHeight < minCol) {
    const need = r1(superDepth + bearing + capDepth + minCol);
    const parts = [`คาน ${superDepth} ม.`];
    if (capDepth > 0) parts.push(`คานหัวเสา ${capDepth} ม.`);
    if (p.pierType === 'A') parts.push(`ช่วงผาย ${flareDepth} ม.`);
    errors.push(`ระดับพื้นสะพาน ${DL} ม. ต่ำเกินไป ต้องสูงอย่างน้อย ${need} ม. เพื่อให้มีที่สำหรับ${parts.join(' ')}`);
  }
  const needW = p.tracks === 2 ? 8 : p.tracks === 1 ? 4 : 0;
  if (W < needW) warnings.push(`พื้นกว้าง ${W} ม. แคบเกินไปสำหรับ ${p.tracks} ทาง ควรกว้างอย่างน้อย ${needW} ม.`);
  if (p.pierType === 'A' && hasCap && W > 14) warnings.push('พื้นกว้างเกิน 14 ม. คานหัวเสาแบบเสาเดี่ยวจะยื่นยาวมาก แนะนำ Type B');
  if (p.pierType === 'C' && colSpacing < W) warnings.push(`ระยะห่างเสา ${colSpacing} ม. แคบกว่าพื้นสะพาน ถ้าไม่ต้องคร่อมถนนหรือทางด้านล่าง Type B จะเหมาะกว่า`);
  if (p.pierType === 'C' && colSpacing > 30) warnings.push('ระยะห่างเสาเกิน 30 ม. คานขวางคอนกรีตจะลึกมาก ในงานจริงมักใช้คานเหล็กหรือคานอัดแรง');
  if (!truss && !steel && L > 45 && p.girderDepth === 0) warnings.push('span ยาวเกิน 45 ม. สำหรับคานคอนกรีต ลองพิจารณาสะพานเหล็ก');
  if (steel && ig && L > 60) warnings.push(`คานเหล็ก I ช่วง ${r1(L)} ม. ยาวมาก ช่วงยาวกว่า 60 ม. มักใช้โครงถัก`);

  const trackCenters = p.tracks === 2 ? [-p.trackSpacing / 2, p.trackSpacing / 2] : p.tracks === 1 ? [0] : [];
  const sleeperLength = p.sleeperLength;

  // ราวสะพาน: ตำแหน่ง z ของแต่ละแนว (ศูนย์กลางราว)
  const rimIn = p.railingStyle === 'wall' ? 0.1 : 0.05;
  const edge = W / 2 - rimIn;
  let railZ = [];
  if (p.railings === '2') railZ = [-edge, edge];
  else if (p.railings === '3') railZ = [-edge, 0, edge];
  else if (p.railings === '4') {
    const zi = Math.max(0.2, W / 2 - p.railingInset);
    railZ = [-edge, -zi, zi, edge];
  } else if (p.railings === 'custom') {
    const vals = p.railingList.split(/[,;\s]+/).map(Number).filter(Number.isFinite);
    if (p.railingList && !vals.length) warnings.push(`ระยะราว "${p.railingList}" อ่านไม่ได้ ใช้ตัวเลขคั่นด้วย , เช่น -6.4, -5.2, 5.2, 6.4`);
    railZ = [...new Set(vals.map((z) => r2(clamp(z, -edge, edge))))].sort((a, b) => a - b);
  }
  railZ = railZ.map(r2);
  // ราวทับแนวทาง?
  const trackHalf = open ? sleeperLength / 2 + 0.05 : 1.5;
  railZ.forEach((z) => {
    if (trackCenters.some((zc) => Math.abs(z - zc) < trackHalf)) warnings.push(`ราวที่ระยะ ${r2(z)} ม. จากศูนย์กลางทับแนวทางรถไฟ`);
  });

  // พื้นโครงเหล็ก
  if (open && p.tracks > 0 && sleeperLength < p.gauge + 0.6) warnings.push(`หมอนยาว ${sleeperLength} ม. สั้นเกินไปสำหรับราง ${p.gauge} ม.`);
  if (open && p.sleeperSpacing - p.sleeperWidth < 0.15) warnings.push(`ระยะห่างหมอน ${p.sleeperSpacing} ม. ชิดเกินไปสำหรับหมอนกว้าง ${p.sleeperWidth} ม.`);

  // Overpass: ความชันแต่ละช่วง
  if (overpass) grades.forEach((g, i) => {
    if (Math.abs(g) > p.maxGrade) warnings.push(`ช่วง ${i + 1} ชัน ${Math.abs(g)}% เกินกำหนด ${p.maxGrade}%`);
  });

  return {
    params: p, W, L, truss, ig, steel, overpass, open, ballast, kind,
    deckLevel: DL, levels, grades,
    superDepth, bearing, capTopY, padZ, padNeed, padSize,
    colD, capDepth, capLen, capThick, colSpacing, haunch, hasCap,
    aBase, aThick, aTop, flareDepth, flareLip,
    wallWidth, wallRadius,
    clearWidth: p.pierType === 'C' ? colSpacing - colD : 0,
    columnHeight, trussHeight, trussZ, trussBottomY,
    iSec, girderZ, girderH,
    railZ, railBaseY: DL + (open ? p.sleeperHeight : overpass ? 0.05 : 0),
    trackCenters,
    spans, skew, skewRad: skew * Math.PI / 180,
    totalLength: spans.reduce((a, b) => a + b, 0),
    pierCount: spans.length + 1,
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
  pad:     new THREE.MeshStandardMaterial({ name: 'bearing', color: 0x3b3d40, roughness: 0.8 }),
  // v3
  grating: new THREE.MeshStandardMaterial({ name: 'steel-grating', color: 0x59636d, roughness: 0.7, metalness: 0.3 }),
  sleeper: new THREE.MeshStandardMaterial({ name: 'steel-sleeper', color: 0x4f5862, roughness: 0.6, metalness: 0.4 }),
  asphalt: new THREE.MeshStandardMaterial({ name: 'asphalt', color: 0x3e4044, roughness: 0.95 }),
  marking: new THREE.MeshStandardMaterial({ name: 'road-marking', color: 0xf2f0e8, roughness: 0.8 })
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

/* กล่องจำนวนมากรวมเป็นชิ้นเดียว (หมอน ราวเหล็ก คานขวาง เส้นจราจร) — ประหยัด draw call ส่งออก .glb ได้ตรง
   items = [{ x, y, z, sx, sy, sz }] กึ่งกลางกล่องและขนาด แกนตรง */
function mergedBoxes(items, mat, name) {
  if (!items.length) return null;
  const bp = UNIT_BOX.attributes.position.array;
  const bn = UNIT_BOX.attributes.normal.array;
  const bi = UNIT_BOX.index.array;
  const nv = bp.length / 3;
  const pos = new Float32Array(items.length * nv * 3);
  const nor = new Float32Array(items.length * nv * 3);
  const idx = new Uint32Array(items.length * bi.length);
  items.forEach((b, k) => {
    const o = k * nv * 3;
    for (let i = 0; i < nv; i++) {
      pos[o + i * 3] = bp[i * 3] * b.sx + b.x;
      pos[o + i * 3 + 1] = bp[i * 3 + 1] * b.sy + b.y;
      pos[o + i * 3 + 2] = bp[i * 3 + 2] * b.sz + b.z;
      nor[o + i * 3] = bn[i * 3]; nor[o + i * 3 + 1] = bn[i * 3 + 1]; nor[o + i * 3 + 2] = bn[i * 3 + 2];
    }
    for (let i = 0; i < bi.length; i++) idx[k * bi.length + i] = bi[i] + k * nv;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.Mesh(g, mat);
  if (name) m.name = name;
  return m;
}

// หน้าตัด (จุด [z, y]) → ExtrudeGeometry ยาว len ตามแกน +x เริ่มที่ x = 0
function extrudeAlongX(pts, len) {
  // หลัง rotateY(90°) แกน x ของ Shape กลายเป็น −z จึงกลับด้าน z ก่อน
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  return geo;
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

  if (!d.truss && !d.ig) {
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
  if (d.ig) {
    // คาน I: ตัวกลางเว้าเอวสองด้าน · คานริมด้านนอกทึบได้ (edgeGirder = solid)
    const len = d.L - SPAN_GAP;
    kit.iGeo = extrudeAlongX(iGirderPoints(d.iSec, 0), len);
    if (d.params.edgeGirder === 'solid') {
      kit.iGeoL = extrudeAlongX(iGirderPoints(d.iSec, -1), len);
      kit.iGeoR = extrudeAlongX(iGirderPoints(d.iSec, 1), len);
    }
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
    const pad = box(0.9, d.bearing, d.padSize || 0.9, MATERIALS.pad, 'bearing');
    pad.position.set(0, d.capTopY + d.bearing / 2, z);
    g.add(pad);
  }
  return g;
}

/* ---------- ทางรถไฟบนพื้นสะพาน ----------
   หินโรยทาง: หิน 0.3 ม. + ราง · พื้นโครงเหล็ก: หมอนเหล็กตามระยะที่กำหนด + ราง + ทางเดินตรวจสภาพ */
function addTracks(g, d, x0, len) {
  const p = d.params;
  const y = p.deckLevel;
  const half = p.gauge / 2 + 0.035;
  if (!d.open) {
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
    return;
  }
  // พื้นโครงเหล็ก: หมอนวางบนคานตามยาว (stringer) หรือบนคาน I โดยตรง
  const sh = p.sleeperHeight, sl = p.sleeperLength, sw = p.sleeperWidth;
  const n = Math.max(1, Math.floor((len - sw) / p.sleeperSpacing) + 1);
  const x1 = x0 + (len - (n - 1) * p.sleeperSpacing) / 2;
  const sleepers = [], rails = [];
  for (const zc of d.trackCenters) {
    for (let i = 0; i < n; i++) sleepers.push({ x: x1 + i * p.sleeperSpacing, y: y + sh / 2, z: zc, sx: sw, sy: sh, sz: sl });
    for (const side of [-half, half]) rails.push({ x: x0 + len / 2, y: y + sh + 0.08, z: zc + side, sx: len, sy: 0.16, sz: 0.07 });
  }
  const sm = mergedBoxes(sleepers, MATERIALS.sleeper, 'steel-sleepers');
  if (sm) g.add(sm);
  const rm = mergedBoxes(rails, MATERIALS.rail, 'rail');
  if (rm) g.add(rm);

  if (p.walkway) {
    // ทางเดินตะแกรงเหล็กระดับเดียวกับหลังหมอน เต็มส่วนที่ไม่ใช่แนวหมอน
    const halfW = d.truss ? d.trussZ - 0.4 : d.W / 2;
    const busy = d.trackCenters.map((zc) => [zc - sl / 2 - 0.15, zc + sl / 2 + 0.15]).sort((a, b) => a[0] - b[0]);
    const free = [];
    let z = -halfW;
    busy.forEach(([a, b]) => { if (a - z > 0.3) free.push([z, a]); z = Math.max(z, b); });
    if (halfW - z > 0.3) free.push([z, halfW]);
    const plates = free.map(([a, b]) => ({ x: x0 + len / 2, y: y + sh - 0.025, z: (a + b) / 2, sx: len, sy: 0.05, sz: b - a }));
    const wm = mergedBoxes(plates, MATERIALS.grating, 'walkway');
    if (wm) g.add(wm);
    // คานรับทางเดิน (ใต้ตะแกรง) ทุก 2.5 ม.
    const nb = Math.max(2, Math.round(len / 2.5) + 1);
    const brackets = [];
    free.forEach(([a, b]) => { for (let i = 0; i < nb; i++) brackets.push({ x: x0 + 0.1 + (len - 0.2) * i / (nb - 1), y: y + sh - 0.1, z: (a + b) / 2, sx: 0.1, sy: 0.1, sz: b - a }); });
    const bm = mergedBoxes(brackets, MATERIALS.steel, 'walkway-bracket');
    if (bm) g.add(bm);
  }
}

/* ---------- ราวสะพาน ----------
   wall = กำแพงคอนกรีตหนา 0.2 ม. · steel = เสาราวทุก 2 ม. + ราวบน + ราวกลาง */
function addRailings(g, d, x0, len) {
  const p = d.params;
  if (!d.railZ.length) return;
  const h = p.railingHeight;
  const yb = d.railBaseY;
  if (p.railingStyle === 'wall') {
    for (const z of d.railZ) {
      const wall = box(len, h, 0.2, MATERIALS.deck, 'parapet');
      wall.position.set(x0 + len / 2, yb + h / 2, z);
      g.add(wall);
    }
    return;
  }
  const items = [];
  const np = Math.max(2, Math.round(len / 2) + 1);
  for (const z of d.railZ) {
    for (let i = 0; i < np; i++) items.push({ x: x0 + 0.05 + (len - 0.1) * i / (np - 1), y: yb + h / 2, z, sx: 0.08, sy: h, sz: 0.08 });
    items.push({ x: x0 + len / 2, y: yb + h - 0.03, z, sx: len, sy: 0.06, sz: 0.07 });
    items.push({ x: x0 + len / 2, y: yb + h * 0.5, z, sx: len, sy: 0.05, sz: 0.05 });
  }
  g.add(mergedBoxes(items, MATERIALS.steel, 'handrail'));
}

/* ---------- ผิวถนนบน Overpass: ยางมะตอย 5 ซม. + เส้นขอบทาง + เส้นแบ่งช่องจราจรแบบประ ---------- */
function addRoad(g, d, x0, len) {
  const p = d.params;
  const y = p.deckLevel;
  // ผิวถนนกว้างถึงผิวด้านในของราวแนวในสุด (ไม่มีราว = เต็มพื้น)
  const inner = d.railZ.length ? Math.min(...d.railZ.map((z) => d.W / 2 - Math.abs(z))) : 0;
  const halfRoad = d.W / 2 - inner - (d.railZ.length ? (p.railingStyle === 'wall' ? 0.1 : 0.04) : 0);
  const asphalt = box(len, 0.05, halfRoad * 2, MATERIALS.asphalt, 'asphalt');
  asphalt.position.set(x0 + len / 2, y + 0.025, 0);
  g.add(asphalt);
  const items = [];
  const ym = y + 0.055;
  const edgeZ = halfRoad - 0.4;
  for (const s of [-1, 1]) items.push({ x: x0 + len / 2, y: ym, z: s * edgeZ, sx: len, sy: 0.01, sz: 0.12 });
  const lanes = Math.max(1, p.lanes);
  for (let k = 1; k < lanes; k++) {
    const z = -edgeZ + (2 * edgeZ * k) / lanes;
    for (let x = 1; x + 3 <= len; x += 9) items.push({ x: x0 + x + 1.5, y: ym, z, sx: 3, sy: 0.01, sz: 0.12 });
  }
  if (p.lanes > 0) g.add(mergedBoxes(items, MATERIALS.marking, 'road-marking'));
}

/* ---------- ช่วงสะพานพื้น/คาน (คานกล่อง หรือ คาน I) ---------- */
function diaphragmXs(p, len) {
  const e = 0.3;
  switch (p.diaphragm) {
    case 'none': return [];
    case 'ends': return [e, len - e];
    case 'third': return [e, len / 3, (2 * len) / 3, len - e];
    case 'spacing': {
      const n = Math.max(1, Math.round((len - 2 * e) / p.diaphragmSpacing));
      return Array.from({ length: n + 1 }, (_, i) => e + ((len - 2 * e) * i) / n);
    }
    default: return [e, len / 2, len - e];
  }
}

function buildConcreteSpan(d, kit) {
  const g = new THREE.Group();
  const p = d.params;
  const x0 = SPAN_GAP / 2;
  const len = d.L - SPAN_GAP;
  const y = p.deckLevel;

  if (!d.ig) {
    const girder = new THREE.Mesh(kit.girderGeo, MATERIALS.deck);
    girder.name = 'box-girder';
    girder.position.set(x0, y, 0);
    g.add(girder);
  } else {
    const gMat = d.steel ? MATERIALS.steel : MATERIALS.deck;
    const gTop = d.open ? y : y - p.slabThick;
    if (!d.open) {
      const slab = box(len, p.slabThick, d.W, MATERIALS.deck, 'deck-slab');
      slab.position.set(x0 + len / 2, y - p.slabThick / 2, 0);
      g.add(slab);
    }
    const zs = d.girderZ;
    zs.forEach((z, k) => {
      let geo = kit.iGeo;
      if (kit.iGeoL && zs.length > 1 && k === 0) geo = kit.iGeoL;
      if (kit.iGeoR && zs.length > 1 && k === zs.length - 1) geo = kit.iGeoR;
      const gm = new THREE.Mesh(geo, gMat);
      gm.name = 'i-girder';
      gm.position.set(x0, gTop, z);
      g.add(gm);
    });
    // คานขวาง: คอนกรีตหนา 0.25 ม. / เหล็กแผ่น 0.05 ม. ต่อเนื่องจากคานริมถึงคานริม
    if (zs.length > 1) {
      const s = d.iSec;
      const dd = d.steel ? s.h * 0.6 : (s.h - s.tf) * 0.75;
      const yc = gTop - s.tf - (d.steel ? 0.05 : 0.08) - dd / 2;
      const zc = (zs[0] + zs[zs.length - 1]) / 2;
      const zw = zs[zs.length - 1] - zs[0];
      const items = diaphragmXs(p, len).map((x) => ({ x: x0 + x, y: yc, z: zc, sx: d.steel ? 0.05 : 0.25, sy: dd, sz: zw }));
      const dm = mergedBoxes(items, gMat, 'diaphragm');
      if (dm) g.add(dm);
    }
  }

  if (d.overpass) addRoad(g, d, x0, len);
  addRailings(g, d, x0, len);
  addTracks(g, d, x0, len);
  return g;
}

/* ---------- ช่วงสะพานโครงเหล็ก (Warren truss แบบทางรถวิ่งด้านล่าง) ----------
   พื้นคอนกรีต: แผ่นพื้น 0.35 ม. บนคานขวาง (เดิม) · พื้นโครงเหล็ก: คานขวาง + คานตามยาวใต้ราง + หมอนเหล็ก */
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

  const stringerH = 0.8;
  const fbTop = d.open ? y - stringerH : y - 0.35;
  if (!d.open) {
    const slab = box(len, 0.35, zt * 2, MATERIALS.deck, 'deck-slab');
    slab.position.set(x0 + len / 2, y - 0.175, 0);
    g.add(slab);
  }

  const fbH = fbTop - (yb - 0.35);
  for (let i = 0; i <= n; i++) {
    const fb = box(0.4, fbH, zt * 2, MATERIALS.steel, 'floor-beam');
    fb.position.set(x0 + i * p, (fbTop + yb - 0.35) / 2, 0);
    g.add(fb);
  }

  if (d.open) {
    // คานตามยาว (stringer) คู่ใต้รางแต่ละทาง วางบนคานขวาง
    const ss = d.params.gauge > 1.2 ? 2.0 : 1.8;
    const sec = { h: stringerH, bf: 0.3, bb: 0.3, tw: 0.03, tf: 0.04, ta: 0, bt: 0.04, tb: 0 };
    const geo = extrudeAlongX(iGirderPoints(sec, 0), len);
    for (const zc of d.trackCenters) {
      for (const s of [-1, 1]) {
        const st = new THREE.Mesh(geo, MATERIALS.steel);
        st.name = 'stringer';
        st.position.set(x0, y, zc + (s * ss) / 2);
        g.add(st);
      }
    }
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

  addRailings(g, d, x0, len);
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
    spanCount: 1, spanText: '', skew: 0, levels: {},   // การเฉียงจัดการตอนวาง (หมุนตอม่อ/เฉือนช่วง) — ไม่เตือนซ้ำรายต้น
    deckWidth: skewRad ? Math.min(20, Math.round(p.deckWidth / Math.cos(skewRad) * 100) / 100) : p.deckWidth
  });
}

// พารามิเตอร์ของช่วงยาว L
function spanParams(p, L) { return Object.assign({}, p, { spanLength: L, spanCount: 1, spanText: '', skew: 0, levels: {} }); }

// ระดับพื้นเดียวทั้งสะพาน: ยกทีละ 0.25 ม. จนตอม่อทุกต้นสร้างได้ → { deckLevel, raised }
function fitDeckLevel(p, spans, skewRad = 0) {
  const ok = (dl) => spans.concat([0]).every((_, i) => deriveDims(Object.assign(pierParams(p, spans, i, skewRad), { deckLevel: dl })).errors.length === 0);
  let dl = p.deckLevel, guard = 0;
  while (!ok(dl) && guard++ < 140) dl = Math.round((dl + 0.25) * 100) / 100;
  return { deckLevel: dl, raised: dl !== p.deckLevel };
}

/* Overpass: ระดับพื้นรายต้น ยกเฉพาะต้นที่ต่ำเกินกว่าตอม่อจะสร้างได้ → { levels, raised: [ลำดับต้น] } */
function fitLevels(p, spans, skewRad = 0) {
  const want = deckLevels(p, spans);
  const raised = [];
  const levels = want.map((lv, i) => {
    const base = pierParams(p, spans, i, skewRad);
    let dl = lv, guard = 0;
    while (deriveDims(Object.assign({}, base, { deckLevel: dl })).errors.length && guard++ < 160) dl = r2(dl + 0.25);
    if (dl !== lv) raised.push(i);
    return dl;
  });
  return { levels, raised };
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

/* v3: เฉือนช่วงลงในรูปทรงโดยตรง (ไม่ฝากไว้ใน matrix) → ไฟล์ .glb ได้รูปเฉียง/ลาดถูกต้อง
   skewRad: x' = x + tan(skew)·z (ปลายช่วงขนานแนวตอม่อ) · slope: y' = y + slope·x (Overpass ลาดตามระดับรายต้น)
   ส่วนตั้ง (ราว คานขวาง) ยังตั้งตรง · คืน Group ใหม่ — ต้องใช้ค่าที่คืนแทน span เดิม */
function bakeSpan(span, skewRad = 0, slope = 0) {
  if (!skewRad && !slope) return span;
  const S = new THREE.Matrix4().makeShear(slope, 0, 0, 0, Math.tan(skewRad), 0);
  span.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = span.name;
  out.userData = span.userData;
  const M = new THREE.Matrix4();
  span.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.userData = {};
    g.applyMatrix4(M.multiplyMatrices(S, o.matrixWorld));
    const m = new THREE.Mesh(g, o.material);
    m.name = o.name;
    out.add(m);
  });
  disposeBridge(span);
  return out;
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
   origin = โคนตอม่อต้นแรก · ช่วงไม่เท่ากัน (spanText) · ชนิดตอม่อรายต้น · ตอม่อริม D + กำแพงปีก · มุมเฉียง
   v3: คาน I · พื้นโครงเหล็ก + หมอน · ราว · Overpass ระดับพื้นรายต้น (ช่วงลาดจากต้นหนึ่งถึงอีกต้น) */
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
  const notes = [];
  let levels;
  if (d0.overpass) {
    const fit = fitLevels(p0, spans, skewRad);
    levels = fit.levels;
    fit.raised.forEach((i) => notes.push(`ตอม่อ ${i + 1}: ระดับพื้น ${d0.levels[i]} ม. ต่ำเกินไป ใช้ ${levels[i]} ม.`));
  } else {
    const fit = fitDeckLevel(p0, spans, skewRad);
    levels = spans.concat([0]).map(() => fit.deckLevel);
    if (fit.raised) notes.push(`ระดับพื้น ${p0.deckLevel} ม. ต่ำเกินไปสำหรับตอม่อบางต้น ใช้ ${fit.deckLevel} ม.`);
  }
  const p = Object.assign({}, p0, { deckLevel: Math.max(...levels) });

  const xs = [0];
  spans.forEach((L) => xs.push(xs[xs.length - 1] + L));

  // ช่วงก่อน: ตำแหน่งคาน I ของช่วงใช้วางแผ่นรองบนตอม่อ (ตอม่อเฉียง: ระยะตามแนวตอม่อ = z ÷ cos)
  const spanDims = spans.map((L, i) => deriveDims(Object.assign(spanParams(p, L), { deckLevel: levels[i] })));

  const piers = new THREE.Group();
  piers.name = 'piers';
  for (let i = 0; i <= n; i++) {
    const d = deriveDims(Object.assign(pierParams(p, spans, i, skewRad), { deckLevel: levels[i] }));
    d.warnings.forEach((w) => notes.push(`ตอม่อ ${i + 1}: ${w}`));
    const kit = makeKit(d);
    if (d.ig) {
      const sd = spanDims[Math.min(i, n - 1)];
      const c = Math.cos(skewRad);
      kit.padZ = sd.girderZ.map((z) => z / c);
    }
    const pier = buildPier(d, kit);
    pier.name = `pier-${i + 1}`;
    if (p.abutmentD && (i === 0 || i === n) && p.wingWall > 0.3) pier.add(buildWingWalls(d, i === 0 ? -1 : 1, p.wingWall, skewRad));
    pier.position.x = xs[i];
    pier.rotation.y = skewRad;
    piers.add(pier);
  }

  const spanGroup = new THREE.Group();
  spanGroup.name = 'spans';
  spans.forEach((L, i) => {
    const d = spanDims[i];
    const slope = (levels[i + 1] - levels[i]) / L;
    let span = buildSpan(d, makeKit(d));
    span.name = `span-${i + 1}`;
    span = bakeSpan(span, skewRad, slope);
    span.position.x = xs[i];
    spanGroup.add(span);
  });

  root.add(piers, spanGroup);
  root.userData.notes = [...new Set(notes)];
  root.userData.deckLevel = Math.max(...levels);
  root.userData.levels = levels;
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
    GENERATOR_ID, DEFAULTS, KIND_DEFAULTS, GIRDER_TYPES, LIMITS, PRESETS, MATERIALS,
    normalizeParams, parseSpans, deriveDims, pierProfileA, makeKit,
    buildPier, buildSpan, buildWingWalls, skewSpan, pierTypeAt, pierParams, spanParams, fitDeckLevel,
    buildBridge, disposeBridge, findBridgeParams,
    // v3
    deckLevels, fitLevels, bakeSpan, iGirderSection, iGirderPoints, normalizeLevels
  };
}

  root.BridgeGen = { create, GENERATOR_ID: 'bpnp-bridge-gen@3' };
  if (root.BPNP) root.BPNP.bridgeGen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
