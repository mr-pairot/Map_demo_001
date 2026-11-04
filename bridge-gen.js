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
 *
 * ── v3.5 ──
 *   สะพานเหล็กตามแบบ (sb25 – sb100): ตอม่อริมแบบที่นั่งคาน + กำแพงหลัง + corbel (เหมือนคอนกรีต)
 *   กำแพงหลังสูงถึงหลัง stringer (คานขวาง 0.94 + แผ่นยาง 0.15) — corbel ตัดจบที่ระดับที่นั่ง ไม่เตือน
 *
 * ── v3.5.1 = v3.4.1 + v3.5 ──
 *   v3.4.1 รอยต่อระหว่างช่วงสะพานเหล็ก: trussGap / railGap · รางต่อเนื่อง · ราวเต็มช่วง · แผ่นยางที่ tp.off + 0.10
 *   ปลายคอร์ดล่างไม่ฝังกำแพงหลังตับแบบที่นั่งคานอีก (ผิวเหล็กห่างผิวกำแพงหลัง trussGap/2)
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
  maxGrade: 6,          // ความชันสูงสุดที่ยอมรับ (%) เกินแล้วเตือน
  // ── v3.1: สะพานคอนกรีตตามแบบโครงการ (JVBP Slab span 15/20/25/30 ม.) ──
  preset: 'none',       // แบบมาตรฐาน: none | auto (เลือกตามความยาวแต่ละช่วง) | cb15 | cb20 | cb25 | cb30
  girderList: '',       // ตำแหน่งคาน I จากศูนย์กลาง (ม.) เช่น "±1.3, ±3.7" — ว่าง = ใช้จำนวนคาน
  webThick: 0,          // หน้าตัดคาน I ละเอียด (ม.) 0 = คำนวณให้: ความหนาเอว
  topFlangeT: 0,        //   ความหนาปีกบน
  topTaper: 0,          //   ส่วนผายใต้ปีกบน
  botFlangeT: 0,        //   ความหนาปีกล่าง
  botTaper: 0,          //   ส่วนผายเหนือปีกล่าง
  bottomWidth: 0,       //   ความกว้างปีกล่าง
  diaphragmList: '',    // คานขวางกลางช่วงแบบกำหนดตำแหน่ง (ม. จากปลายคาน ตามแนวศูนย์กลาง) ใช้เมื่อ diaphragm = list
  diaphragmThick: 0,    // ความหนาคานขวางกลางช่วง (ม.) 0 = คอนกรีต 0.25 / เหล็ก 0.05
  endDiaphragm: false,  // คานขวางปลายเต็มความลึก (เฉียงตามแนวตอม่อ)
  endDiaphragmThick: 0.6,
  endGap: 0.05,         // ระยะปลายคานถึงแนวศูนย์กลางตอม่อ (ม.)
  deckSection: 'simple',// simple = แผ่นพื้นเรียบ + ราว · trough = พื้นลาด + กันหินโรยทาง + รางสายเคเบิลข้าง + ราวท่อ
  slabEdge: 0.20,       // trough: ความหนาแผ่นพื้นที่ขอบ (ม.)
  crossfall: 2,         // trough: ผิวพื้นลาดจากกึ่งกลางออกสองข้าง (%)
  retOffset: 1.40,      // trough: ผิวกันหินด้านรางห่างศูนย์กลางราง (ม.)
  retThick: 0.20,       // trough: ความหนากันหิน (ม.)
  retHeightA: 0.67,     // trough: ความสูงกันหิน A (ระหว่างทาง) (ม.)
  retHeightB: 0.745,    // trough: ความสูงกันหิน B (ข้างรางเคเบิล) (ม.)
  troughWidth: 1.13,    // trough: ความกว้างภายในรางสาย (ม.)
  troughDepth: 0.27,    // trough: ความลึกรางสาย (ม.)
  coverThick: 0.08,     // trough: ความหนาฝาคอนกรีต (ม.)
  ballastDepth: 0.50,   // trough: ความหนาหินโรยทางใต้ศูนย์กลางราง (ม.)
  handrail: false,      // trough: ราวท่อเหล็กบนขอบนอก
  handrailHeight: 1.0,  // ความสูงราวจากยอดขอบนอก (ม.)
  postSpacing: 1.215,   // ระยะเสาราว S1 (ม.)
  postEnd: 0.40,        // ระยะแนวตอม่อถึงเสาแรก a (ม.)
  panelBays: 4,         // จำนวนช่องต่อแผงราว (รอยต่อแผง = เสาคู่ห่าง 0.30 ม.)
  // ── v3.2 ──
  endBlock: 0,          // ปลายคาน I ทึบ (ม.) 0 = ไม่มี · แบบโครงการ 2.95
  endTaper: 0,          // ช่วงสอบจากปลายทึบเป็นรูป I (ม.) · แบบโครงการ 1.00
  bearingDetail: false, // แผ่นยางรองคานบนแท่นคอนกรีต แถวละช่วง (ตำแหน่งตามปลายคาน)
  restrainBlocks: false,// บล็อกกันเลื่อนระหว่างคานบนตอม่อ
  ballastSleepers: false,// หมอนคอนกรีตบนหินโรยทาง (ใช้ระยะ/ขนาดหมอนชุดเดียวกับพื้นโครงเหล็ก)
  // ── v3.3: ตับริม ──
  abutmentStyle: 'wall',// wall = ผนังทึบ Type D (เดิม) · seat = ที่นั่งคาน + กำแพงหลัง + corbel รับ approach slab
  seatFront: 0.90,      // seat: ผิวหน้าตับห่างแนวตับ (ด้านช่วงสะพาน) (ม.)
  backwallThick: 0.30,  // seat: ความหนากำแพงหลัง (ม.) · ตัวตับหนา = seatFront + backwallThick
  corbelWidth: 0.25,    // seat: corbel ยื่นจากกำแพงหลัง (ม.)
  corbelDrop: 0.50,     // seat: ผิวบน corbel ต่ำกว่ายอดกำแพงหลัง (ม.)
  corbelVert: 0.40,     // seat: ผิว corbel ตั้งตรง (ม.)
  corbelTaper: 0.40,    // seat: ส่วนลาดกลับเข้ากำแพง (ม.)
  // ── v3.4: โครงถักตามแบบโครงการ (สะพานเหล็ก) ──
  trussStyle: 'legacy', // legacy = โครงถักเดิม (สูง ≈ ช่วง/6) · project = ตามแบบโครงการ (ค่าด้านล่าง)
  panel: 5.0,           // ระยะช่องโครงถัก (ม.)
  endPanel: 5.0,        // ช่องปลาย (ม.) · 75/100 ม. = 4.60
  trussSpacing: 11.0,   // ระยะศูนย์กลางโครงถัก (ม.)
  trussHeight: 9.0,     // ความสูงโครงถักที่ปลาย ศูนย์กลางคอร์ดถึงศูนย์กลางคอร์ด (ม.)
  trussHeightMax: 9.0,  // ความสูงสูงสุดช่วงกลาง (คอร์ดบนหลายระดับ) (ม.)
  riseNodes: 0,         // จำนวนช่องที่คอร์ดบนลาดขึ้นจากจุดบนแรก (0 = คอร์ดบนตรง)
  diagonals: 'warren',  // warren | pratt · ช่องกลางไขว้ X อัตโนมัติเมื่อจำนวนช่องเป็นเลขคี่
  upperBracing: 'x1',   // none | x1 (X ทุกช่อง) | x2 (X ครอบ 2 ช่อง)
  swayV: true,          // ค้ำโยก V คว่ำจากกลาง strut ลงยึดท่อนตั้ง
  topKnee: false,       // ค้ำมุมบนระหว่างท่อนตั้งกับ strut
  sidewalk: true,       // ทางเดินข้างนอกโครงถัก
  sidewalkWidth: 1.0,   // ความกว้างทางเดินข้าง (ม.)
  floorBeamDepth: 0.94, // คานขวาง (IFB) ลึก (ม.)
  stringerDepth: 0.50,  // stringer ลึก (ม.)
  // ขนาดชิ้นส่วน (ม.) สูง × กว้าง · shape: box | H
  tcH: 0.45, tcB: 0.50, bcH: 0.92, bcB: 0.50,
  vmH: 0.388, vmB: 0.402, vmShape: 'H',
  dmH: 0.428, dmB: 0.407, dmShape: 'H',
  // ── v3.4.1: รอยต่อระหว่างช่วง ──
  trussGap: 0.07,       // ช่องว่างระหว่างผิวเหล็กนอกสุดของโครงถักสองช่วง (ม.) · 0 = ใช้ช่องปลาย endPanel แบบเดิม
  railGap: 0.10         // ช่องว่างราวทางเดินข้าง/พื้นทางเดินระหว่างช่วง (ม.)
});

/* แบบมาตรฐานสะพานเหล็กโครงถักของโครงการ (ช่องละ 5.00 ม. · เสาปลายเอียง 1 ช่อง · ท่อนตั้งทุกจุด · ค้ำล่าง X ทุกช่อง
   ระบบพื้นเหล็กเปิด: คานขวางทุกจุด · stringer คู่ใต้ราง · หมอนเหล็ก · ทางเดินข้างข้างละ 1.00 ม.) */
const SB_COMMON = Object.freeze({
  bridgeKind: 'steel', girderType: 'truss', trussStyle: 'project', floorType: 'open', tracks: 2, trackSpacing: 5,
  panel: 5.0, endPanel: 5.0, sidewalk: true, sidewalkWidth: 1.0, walkway: false, railings: '0',
  sleeperSpacing: 0.5, sleeperLength: 2.0, sleeperWidth: 0.25, sleeperHeight: 0.15,
  floorBeamDepth: 0.94, stringerDepth: 0.5,
  abutmentStyle: 'seat',   // v3.5 ตอม่อริมแบบที่นั่งคาน + corbel
  handrailHeight: 1.0, postSpacing: 1.25, postEnd: 0.4, panelBays: 4,
  tcH: 0.45, tcB: 0.50, bcH: 0.92, bcB: 0.50, vmH: 0.388, vmB: 0.402, vmShape: 'H', dmH: 0.428, dmB: 0.407, dmShape: 'H',
  riseNodes: 0, upperBracing: 'none', swayV: false, topKnee: false, diagonals: 'warren'
});
const SB_PRESETS = Object.freeze({
  sb25: { span: 25, label: 'โครงถัก 25 ม. (Pratt · 5 ช่อง)', trussSpacing: 9.2, trussHeight: 6.3, trussHeightMax: 6.3, diagonals: 'pratt' },
  sb30: { span: 30, label: 'โครงถัก 30 ม. (Warren · 6 ช่อง)', trussSpacing: 9.7, trussHeight: 6.8, trussHeightMax: 6.8 },
  sb40: { span: 40, label: 'โครงถัก 40 ม. (Warren · 8 ช่อง)', trussSpacing: 11, trussHeight: 9, trussHeightMax: 9, upperBracing: 'x1', swayV: true },
  sb50: { span: 50, label: 'โครงถัก 50 ม. (Warren · 10 ช่อง)', trussSpacing: 11, trussHeight: 9, trussHeightMax: 9, upperBracing: 'x1', swayV: true, topKnee: true },
  sb60: { span: 60, label: 'โครงถัก 60 ม. (DWG 0149 · 12 ช่อง)', trussSpacing: 11, trussHeight: 9, trussHeightMax: 9, upperBracing: 'x2', swayV: true },
  sb75: { span: 75, label: 'โครงถัก 75 ม. (DWG 0151 · 15 ช่อง)', trussSpacing: 11, trussHeight: 9, trussHeightMax: 12, riseNodes: 4, endPanel: 4.6, upperBracing: 'x1', swayV: true },
  sb100: { span: 100, label: 'โครงถัก 100 ม. (DWG 0153 · 20 ช่อง)', trussSpacing: 11, trussHeight: 9, trussHeightMax: 15, riseNodes: 6, endPanel: 4.6, upperBracing: 'x1', swayV: true,
    tcH: 0.5, tcB: 0.5, vmH: 0.428, vmB: 0.428, vmShape: 'box', dmH: 0.428, dmB: 0.428, dmShape: 'box' }
});

/* แบบมาตรฐานสะพานคอนกรีตของโครงการ (JVBP/CSBN1/SC1/CB)
   ส่วนที่เหมือนกันทุกช่วง: พื้น 11.00 ม. · คาน I ปีก 0.60 เอว 0.20 · กันหิน A 0.67 / B 0.745 · รางสาย 1.13 × 0.27 ฝา 0.08 · ราวท่อสูง 1.00 */
const CB_COMMON = Object.freeze({
  bridgeKind: 'concrete', girderType: 'igirder', deckSection: 'trough', deckWidth: 11, tracks: 2, trackSpacing: 5,
  girderWidth: 0.6, bottomWidth: 0.6, webThick: 0.2, topFlangeT: 0.15, topTaper: 0.15, botFlangeT: 0.25, botTaper: 0.15,
  diaphragm: 'list', diaphragmThick: 0.2, endDiaphragm: true, endDiaphragmThick: 0.6, endGap: 0.04,
  slabEdge: 0.2, crossfall: 2, retOffset: 1.4, retThick: 0.2, retHeightA: 0.67, retHeightB: 0.745,
  troughWidth: 1.13, troughDepth: 0.27, coverThick: 0.08, ballastDepth: 0.5,
  railings: '0', handrail: true, handrailHeight: 1.0, postEnd: 0.4, panelBays: 4,
  endBlock: 2.95, endTaper: 1.0, bearingDetail: true, restrainBlocks: true,
  abutmentD: true, abutmentStyle: 'seat',
  ballastSleepers: true, sleeperSpacing: 0.6, sleeperLength: 2.0, sleeperWidth: 0.26, sleeperHeight: 0.21
});
const CB_PRESETS = Object.freeze({
  cb15: { span: 15, label: 'Slab span 15 ม. (DWG 0066)', girderList: '±1.3, ±3.7', girderDepth: 1.5, diaphragmList: '4, 7.5, 11', postSpacing: 1.2417 },
  cb20: { span: 20, label: 'Slab span 20 ม. (DWG 006)', girderList: '±1.3, ±2.5, ±3.7', girderDepth: 1.5, diaphragmList: '5.135, 9.96, 14.785', postSpacing: 1.225 },
  cb25: { span: 25, label: 'Slab span 25 ม. (DWG 0093)', girderList: '±0.899, ±1.966, ±3.033, ±4.1', girderDepth: 1.5, diaphragmList: '4.96, 9.96, 14.96, 19.96', postSpacing: 1.215 },
  cb30: { span: 30, label: 'Slab span 30 ม. (DWG 0029)', girderList: '±0.899, ±1.966, ±3.033, ±4.1', girderDepth: 1.7, diaphragmList: '4.95, 9.95, 14.95, 19.95, 24.95', postSpacing: 1.465 }
});

// แบบมาตรฐานของช่วงยาว L: preset ชื่อแบบ หรือ auto = แบบที่ช่วงใกล้ที่สุด (ต่างไม่เกิน 1.5 ม.) → ชื่อแบบ | null
const presetTable = (kind) => (kind === 'steel' ? SB_PRESETS : kind === 'concrete' ? CB_PRESETS : {});
const presetCommon = (name) => (SB_PRESETS[name] ? SB_COMMON : CB_COMMON);
const PRESET_ANY = (name) => CB_PRESETS[name] || SB_PRESETS[name];
function presetFor(p, L) {
  const table = presetTable(p.bridgeKind);
  if (table[p.preset]) return p.preset;
  if (p.preset !== 'auto') return null;
  let best = null, dist = 1.5;
  for (const [k, v] of Object.entries(table)) if (Math.abs(v.span - L) <= dist) { best = k; dist = Math.abs(v.span - L); }
  return best;
}

// ค่าของแบบมาตรฐาน (ไม่รวม span/label) — หน้าออกแบบใช้กรอกฟอร์ม
function presetParams(name) {
  const v = PRESET_ANY(name);
  if (!v) return null;
  const { span, label, ...rest } = v;
  return { ...presetCommon(name), ...rest, spanLength: span };
}

// ใช้แบบมาตรฐานกับพารามิเตอร์ของช่วงยาว L (ค่าแบบทับค่าที่กรอก)
function applyPreset(p, L) {
  const name = presetFor(p, L);
  if (!name) return p;
  const { span, label, ...rest } = PRESET_ANY(name);
  return Object.assign({}, p, presetCommon(name), rest, { preset: p.preset, presetUsed: name });
}

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
  maxGrade: [1, 15],
  webThick: [0, 1], topFlangeT: [0, 0.6], topTaper: [0, 0.6], botFlangeT: [0, 0.8], botTaper: [0, 0.6], bottomWidth: [0, 2.5],
  diaphragmThick: [0, 1], endDiaphragmThick: [0.2, 1.5], endGap: [0, 0.5],
  slabEdge: [0.15, 0.5], crossfall: [0, 5], retOffset: [0.8, 2.5], retThick: [0.1, 0.5], retHeightA: [0.2, 1.5], retHeightB: [0.2, 1.5],
  troughWidth: [0.3, 2.5], troughDepth: [0.1, 1], coverThick: [0.04, 0.2], ballastDepth: [0.2, 1],
  handrailHeight: [0.6, 2], postSpacing: [0.8, 3], postEnd: [0, 1.5], panelBays: [1, 10],
  endBlock: [0, 6], endTaper: [0, 3],
  seatFront: [0.4, 2], backwallThick: [0.2, 0.8], corbelWidth: [0, 0.8], corbelDrop: [0.2, 1.5], corbelVert: [0, 1], corbelTaper: [0, 1],
  panel: [2, 15], endPanel: [2, 15], trussSpacing: [5, 16], trussHeight: [3, 25], trussHeightMax: [3, 30], riseNodes: [0, 20],
  sidewalkWidth: [0.5, 2.5], trussGap: [0, 1], railGap: [0, 1], floorBeamDepth: [0.4, 2], stringerDepth: [0.2, 1.5],
  tcH: [0.2, 1.5], tcB: [0.2, 1.5], bcH: [0.2, 1.5], bcB: [0.2, 1.5], vmH: [0.15, 1], vmB: [0.15, 1], dmH: [0.15, 1], dmB: [0.15, 1]
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
  p.diaphragm = ['none', 'ends', 'mid', 'third', 'spacing', 'list'].includes(p.diaphragm) ? p.diaphragm : 'mid';
  p.floorType = kind === 'steel' && p.floorType === 'open' ? 'open' : 'concrete';
  p.walkway = input.walkway === undefined ? DEFAULTS.walkway : truthy(input.walkway);
  p.levels = kind === 'overpass' ? normalizeLevels(p.levels) : {};
  // v3.1
  p.preset = (presetTable(kind)[p.preset] || (p.preset === 'auto' && kind !== 'overpass')) ? p.preset : 'none';
  p.trussStyle = p.trussStyle === 'project' ? 'project' : 'legacy';
  p.riseNodes = Math.round(p.riseNodes);
  p.diagonals = p.diagonals === 'pratt' ? 'pratt' : 'warren';
  p.upperBracing = ['none', 'x1', 'x2'].includes(p.upperBracing) ? p.upperBracing : 'x1';
  for (const k of ['swayV', 'topKnee', 'sidewalk']) p[k] = input[k] === undefined ? DEFAULTS[k] : truthy(input[k]);
  for (const k of ['vmShape', 'dmShape']) p[k] = p[k] === 'box' ? 'box' : 'H';
  p.girderList = String(p.girderList || '').trim().slice(0, 120);
  p.diaphragmList = String(p.diaphragmList || '').trim().slice(0, 120);
  p.endDiaphragm = input.endDiaphragm === undefined ? DEFAULTS.endDiaphragm : truthy(input.endDiaphragm);
  p.handrail = input.handrail === undefined ? DEFAULTS.handrail : truthy(input.handrail);
  p.deckSection = p.deckSection === 'trough' && p.girderType === 'igirder' && kind !== 'overpass' ? 'trough' : 'simple';
  p.panelBays = Math.round(p.panelBays);
  for (const k of ['bearingDetail', 'restrainBlocks', 'ballastSleepers']) p[k] = input[k] === undefined ? DEFAULTS[k] : truthy(input[k]);
  p.abutmentStyle = p.abutmentStyle === 'seat' ? 'seat' : 'wall';
  p.abutDir = [-1, 1].includes(Number(input.abutDir)) ? Number(input.abutDir) : 0;
  delete p.presetUsed;
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
  // ค่าละเอียดที่กรอก (> 0) ทับค่าคำนวณ · รวมความหนาปีก+ส่วนผายต้องเหลือเอวอย่างน้อย 0.1 ม.
  const pick = (v, auto) => (v > 0 ? v : auto);
  const sec = {
    h, bf,
    bb: r2(pick(p.bottomWidth, Math.max(0.5, bf * 0.75))),
    tw: r2(pick(p.webThick, clamp(bf * 0.2, 0.16, 0.25))),
    tf: r2(pick(p.topFlangeT, clamp(h * 0.1, 0.12, 0.2))),
    ta: r2(pick(p.topTaper, clamp(h * 0.06, 0.05, 0.15))),
    bt: r2(pick(p.botFlangeT, clamp(h * 0.14, 0.15, 0.3))),
    tb: r2(pick(p.botTaper, clamp(h * 0.1, 0.1, 0.25))),
    steel: false
  };
  const over = sec.tf + sec.ta + sec.bt + sec.tb - (h - 0.1);
  if (over > 0) { const k = (h - 0.1) / (sec.tf + sec.ta + sec.bt + sec.tb); for (const key of ['tf', 'ta', 'bt', 'tb']) sec[key] = r2(sec[key] * k); }
  sec.tw = Math.min(sec.tw, sec.bf, sec.bb);
  return sec;
}

// "±1.3, ±3.7" / "-3.7, -1.3, 1.3, 3.7" → [-3.7, -1.3, 1.3, 3.7]
function parseOffsets(text) {
  const out = [];
  for (const part of String(text || '').split(/[,;\s]+/)) {
    const m = part.match(/^(±|\+-|\+\/-)?(-?\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const v = Number(m[2]);
    if (m[1]) out.push(-Math.abs(v), Math.abs(v)); else out.push(v);
  }
  return [...new Set(out.map(r2))].sort((a, b) => a - b);
}

/* หน้าตัดพื้นแบบมีกันหินโรยทาง + รางสายเคเบิล (deckSection = trough)
   คืนรายการรูปหลายเหลี่ยม { part, pts:[[z, y]] } y อ้างอิงผิวพื้นที่กึ่งกลางสะพาน = 0 (ใช้ทั้ง 3D และภาพหน้าตัด)
   + ค่าประกอบ: ใต้แผ่นพื้น ระดับหลังหิน ตำแหน่งราว ฝาราง */
function troughSection(p, W, trackCenters) {
  const h = W / 2;
  const s = p.crossfall / 100;
  const t = p.retThick;
  const outerZ = trackCenters.length ? Math.max(...trackCenters.map(Math.abs)) : 0;
  const zs = trackCenters.length ? outerZ + p.retOffset + t : Math.max(0.5, h - p.troughWidth - 0.3);   // ผิวนอกกันหิน B
  const yf = -s * zs;                         // ระดับผิวพื้นช่วงราบ (ใต้รางสาย)
  const yb = yf - p.slabEdge;                 // ใต้แผ่นพื้น
  const top = (z) => -s * Math.min(Math.abs(z), zs);
  const parts = [];
  parts.push({ part: 'slab', pts: [[-h, yb], [h, yb], [h, yf], [zs, yf], [0, 0], [-zs, yf], [-h, yf]] });
  const wall = (z0, z1, hgt, part) => {
    const yt = top(Math.abs(z0) < Math.abs(z1) ? z0 : z1) + hgt;
    parts.push({ part, pts: [[z0, top(z0)], [z1, top(z1)], [z1, yt], [z0, yt]] });
  };
  const ballast = [];
  for (const zc of trackCenters) {
    const zi = zc - p.retOffset, zo = zc + p.retOffset;     // ผิวกันหินด้านราง
    for (const [face, dir] of [[zi, -1], [zo, 1]]) {
      const outer = Math.abs(face) > Math.abs(zc);           // ด้านนอก = ข้างรางสาย (B)
      const zA = face, zB = face + dir * t;
      const isB = outer || trackCenters.length === 1;
      wall(Math.min(zA, zB), Math.max(zA, zB), isB ? p.retHeightB : p.retHeightA, isB ? 'retainer-b' : 'retainer-a');
    }
    const yTop = top(zc) + p.ballastDepth;
    ballast.push({ zc, yTop });
    parts.push({ part: 'ballast', pts: [[zi, top(zi)], ...(Math.sign(zi) !== Math.sign(zo) ? [[0, 0]] : []), [zo, top(zo)], [zo, yTop], [zi, yTop]] });
  }
  // รางสาย: พื้นราง = ผิวพื้นช่วงราบ · ผนังนอก (footpath curb) ถึงขอบพื้น · ฝาวางเสมอยอดขอบนอก
  const zt1 = zs + p.troughWidth;
  const curbTop = yf + p.troughDepth + p.coverThick;
  const curbW = h - zt1;
  for (const sg of [-1, 1]) {
    if (curbW > 0.02) parts.push({ part: 'curb', pts: [[sg * zt1, yf], [sg * h, yf], [sg * h, curbTop - 0.03], [sg * (h - 0.03), curbTop], [sg * zt1, curbTop]].map(([z, y]) => [z, y]) });
  }
  return {
    parts, yb, yf, zs, zt1, curbTop, curbW,
    coverY: curbTop - p.coverThick / 2,
    ballast,
    handrailZ: curbW > 0.02 ? h - Math.min(0.12, curbW / 2) : h - 0.05
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

/* v3.4: ผังโครงถักตามแบบโครงการ (กรอบช่วง: x = 0 ที่แนวตอม่อ, ยาว L)
   จุดล่าง 0..n · จุดบน 1..n-1 (เหนือจุดล่าง) · เสาปลายเอียง 0→1 และ n→n-1
   ช่องปลายยาว endPanel ช่องในยาว panel · แผ่นยางห่างแนวตอม่อ off = (L − ความยาวโครงถัก) / 2
   ความสูงจุดบน i: เพิ่มเชิงเส้นจาก trussHeight ถึง trussHeightMax ใน riseNodes ช่องแรก/สุดท้าย
   ท่อนทแยง: Warren = ยอดสลับเริ่มที่จุดบนแรก สมมาตรกลางช่วง · Pratt = ลาดลงเข้าหากลางช่วง · ช่องกลาง (n คี่) ไขว้ X */
function trussLayout(p, L) {
  const pn = p.panel;
  let ep, n, T, off;
  if (p.trussGap > 0) {
    // v3.4.1: ผิวเหล็กนอกสุดห่างแนวตอม่อ trussGap/2 · จุดล่างแรกถอยเข้าเท่าส่วนยื่นตามแนวนอนของเสาปลาย
    //   ส่วนยื่น = ครึ่งความหนาเสาปลาย × sin(มุมเสาปลาย) (อย่างน้อยครึ่งความกว้างคานขวางปลาย 0.15)
    //   ช่องในยาว panel · ช่องปลายสองข้างรับส่วนที่เหลือ
    n = Math.max(3, Math.round(L / pn));
    let e = 0.3;
    for (let k = 0; k < 3; k++) {
      ep = (L - p.trussGap - 2 * e - (n - 2) * pn) / 2;
      const th = Math.atan2(p.trussHeight, Math.max(0.5, ep));
      e = Math.max(0.15, (p.tcH / 2) * Math.sin(th));
    }
    off = r2(p.trussGap / 2 + e);
    T = L - 2 * off;
    ep = (T - (n - 2) * pn) / 2;
  } else {
    ep = Math.min(p.endPanel, pn * 1.5);
    n = Math.max(3, Math.round((L - 2 * ep) / pn) + 2);
    T = 2 * ep + (n - 2) * pn;
    off = r2((L - T) / 2);
  }
  const xs = [off];
  for (let i = 1; i <= n; i++) xs.push(i === n ? r2(L - off) : r2(xs[i - 1] + (i === 1 ? ep : pn)));
  const h0 = p.trussHeight, hm = Math.max(h0, p.trussHeightMax), r = p.riseNodes;
  const heights = xs.map((_, i) => {
    if (i === 0 || i === n) return 0;
    const k = Math.min(i - 1, n - 1 - i);
    return r > 0 ? r2(h0 + (hm - h0) * Math.min(k, r) / r) : h0;
  });
  // ท่อนทแยงในช่องภายใน (ซ้าย i → ขวา i+1) : [จุดบน, จุดล่าง] เป็นดัชนี
  const diags = [];
  for (let i = 1; i <= n - 2; i++) {
    const j = n - 1 - i;                        // ช่องสมมาตร
    if (i === j) { diags.push([i, i + 1], [i + 1, i]); continue; }   // ช่องกลาง: X
    if (p.diagonals === 'pratt') diags.push(i < j ? [i, i + 1] : [i + 1, i]);
    else {
      const k = i < j ? i : j;
      const downRight = k % 2 === 1;            // ช่อง k (ซีกซ้าย) ลงขวา เมื่อ k คี่
      // [จุดบน, จุดล่าง]: ซีกซ้าย ลงขวา = บน i → ล่าง i+1 · ซีกขวาใช้ภาพสะท้อนของช่อง j
      diags.push(i < j ? (downRight ? [i, i + 1] : [i + 1, i]) : (downRight ? [i + 1, i] : [i, i + 1]));
    }
  }
  return { n, xs, heights, off, T, ep: r2(ep), diags, s: p.trussSpacing, hMax: Math.max(...heights) };
}

/* ---------- คำนวณขนาดชิ้นส่วนจากพารามิเตอร์ ---------- */
function deriveDims(input) {
  let p = normalizeParams(input);
  const sp = spansOf(p);
  const errors = sp.errors;
  const warnings = sp.warnings;
  const spans = sp.spans;
  const L = Math.max(...spans);
  // แบบมาตรฐาน (สะพานคอนกรีต): ค่าตามแบบของช่วงยาว L ทับค่าที่กรอก
  p = applyPreset(p, L);
  // โครงถักตามแบบ: ความกว้างพื้น (ใช้กับตอม่อ) = ระยะโครงถัก + ทางเดินข้าง
  if (p.bridgeKind === 'steel' && p.girderType === 'truss' && p.trussStyle === 'project') {
    p = Object.assign({}, p, { deckWidth: r2(p.trussSpacing + 2 * (p.sidewalk ? p.sidewalkWidth + 0.3 : 0.5)) });
  }
  if (p.preset === 'auto' && !p.presetUsed) warnings.push(`ช่วง ${r1(L)} ม. ไม่มีแบบมาตรฐาน (มี 15 / 20 / 25 / 30 ม.) ใช้ค่าที่กรอก`);
  const W = p.deckWidth;
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
    const listed = parseOffsets(p.girderList).filter((z) => Math.abs(z) <= W / 2 - 0.2);
    if (p.girderList && !listed.length) warnings.push(`ตำแหน่งคาน "${p.girderList}" อ่านไม่ได้ ใช้แบบ ±1.3, ±3.7 หรือ -3.7, -1.3, 1.3, 3.7`);
    if (listed.length) {
      girderZ = listed;
      for (let k = 1; k < listed.length; k++) {
        if (listed[k] - listed[k - 1] < Math.max(iSec.bf, iSec.bb) + 0.05) { warnings.push(`คานที่ ${r2(listed[k - 1])} กับ ${r2(listed[k])} ม. ชิดกันเกินไป`); break; }
      }
    } else if (pairUnderTracks) {
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
  const trackCenters = p.tracks === 2 ? [-p.trackSpacing / 2, p.trackSpacing / 2] : p.tracks === 1 ? [0] : [];
  const trough = ig && p.deckSection === 'trough' ? troughSection(p, W, trackCenters) : null;
  if (trough && trough.curbW < 0.15) warnings.push(`พื้นกว้าง ${W} ม. ไม่พอสำหรับรางสาย ${p.troughWidth} ม. (ขอบนอกเหลือ ${r2(trough.curbW)} ม.)`);
  const slabT = trough ? -trough.yb : p.slabThick;    // ผิวพื้นที่กึ่งกลางถึงใต้แผ่นพื้น
  // v3.4 โครงถักตามแบบ: ผังจุดต่อ · ความลึกใต้หลัง stringer = คานขวาง
  const tp = truss && p.trussStyle === 'project' ? trussLayout(p, L) : null;
  const superDepth = tp ? p.floorBeamDepth : truss ? 1.6
    : ig ? r2(girderH + (open ? 0 : slabT))
    : (p.girderDepth > 0 ? p.girderDepth : r1(clamp(L / 18, 1.2, 4)));
  const bearing = 0.15; // แผ่นรองคาน
  const capTopY = DL - superDepth - bearing;
  const trussZ = tp ? tp.s / 2 : W / 2 + 0.35; // แนวโครงถักสองข้าง

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
  } else if (p.abutmentStyle === 'seat' && p.abutDir) {
    // v3.3 ตับริมแบบที่นั่งคาน: ตัวตับหนา seatFront + backwallThick กว้างเท่าพื้นสะพาน มุมเหลี่ยม
    //   กำแพงหลังจากที่นั่งถึงผิวพื้น · corbel ด้านหลังรับ approach slab
    hasCap = false;
    wallWidth = W;
    colD = r2(p.seatFront + p.backwallThick);
    capLen = W;
    capThick = colD;
    // โครงถัก: กำแพงหลังเตี้ยกว่า corbel ตามแบบ — corbel ตัดจบที่ระดับที่นั่ง (makeKit) ไม่ต้องเตือน
    if (!truss && p.corbelDrop + p.corbelVert + p.corbelTaper > superDepth + bearing + 0.01) {
      warnings.push(`corbel ลึก ${r2(p.corbelDrop + p.corbelVert + p.corbelTaper)} ม. เกินความสูงกำแพงหลัง ${r2(superDepth + bearing)} ม.`);
    }
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
  const trussHeight = tp ? tp.hMax : truss ? r1(Math.max(8, L / 6)) : 0;
  const trussBottomY = DL - superDepth + 0.35;

  const minCol = p.pierType === 'A' ? flareDepth + 0.5 : 1;
  if (columnHeight < minCol) {
    const need = r1(superDepth + bearing + capDepth + minCol);
    const parts = [`คาน ${superDepth} ม.`];
    if (capDepth > 0) parts.push(`คานหัวเสา ${capDepth} ม.`);
    if (p.pierType === 'A') parts.push(`ช่วงผาย ${flareDepth} ม.`);
    errors.push(`ระดับพื้นสะพาน ${DL} ม. ต่ำเกินไป ต้องสูงอย่างน้อย ${need} ม. เพื่อให้มีที่สำหรับ${parts.join(' ')}`);
  }
  if (tp && tp.ep < p.panel * 0.6) warnings.push(`ช่องปลายสั้น ${tp.ep} ม. (ช่วง ${r1(L)} ม. ไม่ลงตัวกับช่อง ${p.panel} ม.)`);
  if (tp && tp.off < -0.01) warnings.push(`โครงถัก ${tp.n} ช่องยาว ${r2(tp.T)} ม. เกินช่วง ${r1(L)} ม. — ปรับระยะช่องหรือช่องปลาย`);
  if (tp && p.trussHeightMax < p.trussHeight) warnings.push('ความสูงสูงสุดต่ำกว่าความสูงที่ปลาย ใช้ความสูงที่ปลายแทน');
  if (tp && p.tracks === 2 && tp.s / 2 - p.trackSpacing / 2 < 2.0) warnings.push(`โครงถักห่าง ${tp.s} ม. แคบเกินไปสำหรับทางคู่ห่าง ${p.trackSpacing} ม.`);
  const needW = p.tracks === 2 ? 8 : p.tracks === 1 ? 4 : 0;
  if (W < needW) warnings.push(`พื้นกว้าง ${W} ม. แคบเกินไปสำหรับ ${p.tracks} ทาง ควรกว้างอย่างน้อย ${needW} ม.`);
  if (p.pierType === 'A' && hasCap && W > 14) warnings.push('พื้นกว้างเกิน 14 ม. คานหัวเสาแบบเสาเดี่ยวจะยื่นยาวมาก แนะนำ Type B');
  if (p.pierType === 'C' && colSpacing < W) warnings.push(`ระยะห่างเสา ${colSpacing} ม. แคบกว่าพื้นสะพาน ถ้าไม่ต้องคร่อมถนนหรือทางด้านล่าง Type B จะเหมาะกว่า`);
  if (p.pierType === 'C' && colSpacing > 30) warnings.push('ระยะห่างเสาเกิน 30 ม. คานขวางคอนกรีตจะลึกมาก ในงานจริงมักใช้คานเหล็กหรือคานอัดแรง');
  if (!truss && !steel && L > 45 && p.girderDepth === 0) warnings.push('span ยาวเกิน 45 ม. สำหรับคานคอนกรีต ลองพิจารณาสะพานเหล็ก');
  if (steel && ig && L > 60) warnings.push(`คานเหล็ก I ช่วง ${r1(L)} ม. ยาวมาก ช่วงยาวกว่า 60 ม. มักใช้โครงถัก`);

  const sleeperLength = p.sleeperLength;

  // ราวสะพาน: ตำแหน่ง z ของแต่ละแนว (ศูนย์กลางราว)
  const rimIn = p.railingStyle === 'wall' ? 0.1 : 0.05;
  const edge = W / 2 - rimIn;
  let railZ = [];
  if (trough) railZ = [];                             // พื้นแบบรางสาย: ราวท่อบนขอบนอกแทน
  else if (p.railings === '2') railZ = [-edge, edge];
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
    seat: p.pierType === 'D' && p.abutmentStyle === 'seat' && p.abutDir ? { f: -p.abutDir } : null,
    columnHeight, trussHeight, trussZ, trussBottomY,
    iSec, girderZ, girderH, trough, slabT, presetUsed: p.presetUsed || null, tp,
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
function mergedBoxes(items, mat, name) { return mergedScaled(UNIT_BOX, items, mat, name); }

// ท่อกลม (ราวท่อเหล็ก): items = [{ x, y, z, r, len, axis: 'x' | 'y' }]
const UNIT_CYL_Y = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
const UNIT_CYL_X = new THREE.CylinderGeometry(1, 1, 1, 10, 1).rotateZ(Math.PI / 2);
UNIT_CYL_Y.userData.shared = UNIT_CYL_X.userData.shared = true;
function mergedPipes(items, mat, name) {
  const ys = items.filter((t) => t.axis !== 'x').map((t) => ({ x: t.x, y: t.y, z: t.z, sx: t.r, sy: t.len, sz: t.r }));
  const xs = items.filter((t) => t.axis === 'x').map((t) => ({ x: t.x, y: t.y, z: t.z, sx: t.len, sy: t.r, sz: t.r }));
  const g = new THREE.Group();
  g.name = name;
  const a = mergedScaled(UNIT_CYL_Y, ys, mat, `${name}-post`);
  const b = mergedScaled(UNIT_CYL_X, xs, mat, `${name}-rail`);
  if (a) g.add(a);
  if (b) g.add(b);
  return g;
}

function mergedScaled(base, items, mat, name) {
  if (!items.length) return null;
  const bp = base.attributes.position.array;
  const bn = base.attributes.normal.array;
  const bi = base.index.array;
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

/* v3.2: คาน I ที่ปลายทึบ — หน้าตัดทึบ (เอวกว้างเท่าปีก) ยาว eb จากปลาย แล้วสอบเป็นรูป I ในระยะ et
   ใช้จุดหน้าตัดชุดเดียวกัน (I กับ ทึบ มีจำนวนจุดเท่ากัน) ต่อเป็นผิวตามความยาว ตั้งแต่ x = 0 ถึง len */
function girderLoft(sec, solidSide, len, eb, et) {
  const iPts = iGirderPoints(sec, solidSide);
  const ext = Math.max(sec.bf, sec.bb) / 2;
  const sPts = iPts.map(([z, y]) => [Math.sign(z) * ext, y]);
  const k = Math.min(1, (len / 2 - 0.1) / Math.max(0.01, eb + et));
  const a = eb * k, b = (eb + et) * k;
  const stations = [[0, sPts], [a, sPts], [b, iPts], [len - b, iPts], [len - a, sPts], [len, sPts]];
  const n = iPts.length;
  const pos = [];
  const V = (x, [z, y]) => pos.push(x, y, z);
  for (let st = 0; st < stations.length - 1; st++) {
    const [x0, P0] = stations[st], [x1, P1] = stations[st + 1];
    if (x1 - x0 < 1e-6) continue;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // จุดหน้าตัดเรียงตามเข็มนาฬิกา (z ขวา y ขึ้น) → สลับลำดับให้ผิวหันออกด้านนอก
      V(x0, P0[i]); V(x1, P1[j]); V(x1, P1[i]);
      V(x0, P0[i]); V(x0, P0[j]); V(x1, P1[j]);
    }
  }
  // ฝาปลายสองข้าง (หน้าตัดทึบ)
  const contour = sPts.map(([z, y]) => new THREE.Vector2(z, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const cw = THREE.ShapeUtils.isClockWise(contour);
  for (const [i, j, l] of tris) {
    const t = cw ? [i, j, l] : [i, l, j];
    V(0, sPts[t[0]]); V(0, sPts[t[1]]); V(0, sPts[t[2]]);
    V(len, sPts[t[0]]); V(len, sPts[t[2]]); V(len, sPts[t[1]]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
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
  } else if (type === 'D' && d.seat) {
    // หน้าตัดตับ (x ตามแนวสะพาน, y ขึ้น) ดึงตามความกว้าง · f = +1 ช่วงสะพานอยู่ด้าน +x
    const p = d.params, f = d.seat.f;
    const DL = d.capTopY + d.bearing + d.superDepth;
    const xb = -f * p.backwallThick, xc = xb - f * p.corbelWidth;
    const y1 = DL - p.corbelDrop, y2 = y1 - p.corbelVert, y3 = Math.max(d.capTopY, y2 - p.corbelTaper);
    const pts = [[f * p.seatFront, 0], [f * p.seatFront, d.capTopY], [0, d.capTopY], [0, DL], [xb, DL]];
    if (p.corbelWidth > 0.01) pts.push([xb, y1], [xc, y1], [xc, y2], [xb, y3]);
    pts.push([xb, 0]);
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    kit.colGeo = new THREE.ExtrudeGeometry(sh, { depth: d.wallWidth, bevelEnabled: false });
    kit.colGeo.translate(0, 0, -d.wallWidth / 2);
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
    kit.girderGeo = new THREE.ExtrudeGeometry(s, { depth: d.L - 2 * d.params.endGap, bevelEnabled: false });
    kit.girderGeo.rotateY(Math.PI / 2);
  }
  if (d.ig) {
    // คาน I: ตัวกลางเว้าเอวสองด้าน · คานริมด้านนอกทึบได้ (edgeGirder = solid)
    const len = d.L - 2 * d.params.endGap;
    const eb = d.steel ? 0 : d.params.endBlock, et = d.steel ? 0 : d.params.endTaper;
    const mk = (side) => (eb + et > 0 ? girderLoft(d.iSec, side, len, eb, et) : extrudeAlongX(iGirderPoints(d.iSec, side), len));
    kit.iGeo = mk(0);
    if (d.params.edgeGirder === 'solid') {
      kit.iGeoL = mk(-1);
      kit.iGeoR = mk(1);
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
    wall.name = d.seat ? 'abutment' : 'wall-pier';
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

  if (kit.pads) {
    // v3.2: แท่นคอนกรีต + แผ่นยางรองคาน ใต้ปลายคานแต่ละตัว (ตำแหน่งในกรอบตอม่อ)
    const ped = [], rub = [];
    const tp = 0.06, hp = d.bearing - tp;
    for (const { x, z } of kit.pads) {
      ped.push({ x, y: d.capTopY + hp / 2, z, sx: 0.7, sy: hp, sz: 0.8 });
      rub.push({ x, y: d.capTopY + hp + tp / 2, z, sx: 0.4, sy: tp, sz: 0.5 });
    }
    const pm = mergedBoxes(ped, MATERIALS.pier, 'bearing-pedestal');
    if (pm) g.add(pm);
    const rm = mergedBoxes(rub, MATERIALS.pad, 'bearing');
    if (rm) g.add(rm);
  } else {
    // ตับแบบที่นั่งคาน: แผ่นรองอยู่บนที่นั่ง หน้ากำแพงหลัง
    const px = d.seat ? d.seat.f * Math.min(0.5, d.params.seatFront / 2 + 0.02) : 0;
    for (const z of kit.padZ) {
      const pad = box(d.seat ? Math.min(0.9, d.params.seatFront - 0.1) : 0.9, d.bearing, d.padSize || 0.9, MATERIALS.pad, 'bearing');
      pad.position.set(px, d.capTopY + d.bearing / 2, z);
      g.add(pad);
    }
  }
  if (kit.blocks && kit.blocks.length) {
    // บล็อกกันเลื่อนระหว่างคาน: จากหัวตอม่อขึ้นไปเหนือท้องคาน 0.6 ม.
    const hb = d.bearing + 0.6;
    // ตับ: บนที่นั่งระหว่างคานขวางปลายกับขอบหน้าตับ (หนา 0.20)
    const bxk = d.seat ? d.seat.f * (d.params.seatFront - 0.12) : 0, bsx = d.seat ? 0.2 : 0.3;
    g.add(mergedBoxes(kit.blocks.map((z) => ({ x: bxk, y: d.capTopY + hb / 2, z, sx: bsx, sy: hb, sz: 0.25 })), MATERIALS.pier, 'restrain-block'));
  }
  return g;
}

/* ---------- ทางรถไฟบนพื้นสะพาน ----------
   หินโรยทาง: หิน 0.3 ม. + ราง · พื้นโครงเหล็ก: หมอนเหล็กตามระยะที่กำหนด + ราง + ทางเดินตรวจสภาพ */
function addTracks(g, d, x0, len, rx0 = x0, rlen = len) {   // v3.4.1: rx0/rlen = ช่วงของราง (ต่อเนื่องข้ามรอยต่อ)
  const p = d.params;
  const y = p.deckLevel;
  const half = p.gauge / 2 + 0.035;
  if (d.trough || (p.ballastSleepers && !d.open)) {
    // หินโรยทาง: เป็นส่วนหนึ่งของหน้าตัดพื้น (trough) หรือกล่องหนา 0.3 ม. (พื้นเรียบ)
    // หมอนคอนกรีต (ballastSleepers): ฝังในหินให้โผล่ 5 ซม. รางวางบนหมอน · ไม่มีหมอน: รางวางบนหลังหิน
    const tops = d.trough ? d.trough.ballast.map((b) => ({ zc: b.zc, yTop: b.yTop }))
      : d.trackCenters.map((zc) => ({ zc, yTop: 0.3 }));
    if (!d.trough) for (const t of tops) {
      const ballast = box(len, 0.3, 3.0, MATERIALS.ballast, 'ballast');
      ballast.position.set(x0 + len / 2, y + 0.15, t.zc);
      g.add(ballast);
    }
    const rails = [], sleepers = [];
    const sh = p.sleeperHeight, sw = p.sleeperWidth, sl = p.sleeperLength;
    const n = Math.max(1, Math.floor((len - sw) / p.sleeperSpacing) + 1);
    const x1 = x0 + (len - (n - 1) * p.sleeperSpacing) / 2;
    for (const t of tops) {
      let railY = y + t.yTop + 0.08;
      if (p.ballastSleepers) {
        const sTop = y + t.yTop + 0.05;
        for (let i = 0; i < n; i++) sleepers.push({ x: x1 + i * p.sleeperSpacing, y: sTop - sh / 2, z: t.zc, sx: sw, sy: sh, sz: sl });
        railY = sTop + 0.08;
      }
      for (const side of [-half, half]) rails.push({ x: x0 + len / 2, y: railY, z: t.zc + side, sx: len, sy: 0.16, sz: 0.07 });
    }
    const sm = mergedBoxes(sleepers, MATERIALS.deck, 'concrete-sleepers');
    if (sm) g.add(sm);
    const rm = mergedBoxes(rails, MATERIALS.rail, 'rail');
    if (rm) g.add(rm);
    return;
  }
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
    for (const side of [-half, half]) rails.push({ x: rx0 + rlen / 2, y: y + sh + 0.08, z: zc + side, sx: rlen, sy: 0.16, sz: 0.07 });
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
    case 'list': return parseOffsets(p.diaphragmList).filter((x) => x > 0.2 && x < len - 0.2);
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
  const x0 = p.endGap;
  const len = d.L - 2 * p.endGap;
  const y = p.deckLevel;
  // ชิ้นที่ตั้งฉากกับคานแม้สะพานเฉียง (คานขวางกลางช่วง) — bakeSpan ไม่เฉือนตามมุมเฉียง
  const straight = new THREE.Group();
  straight.name = 'perpendicular';
  straight.userData.noShear = true;

  if (!d.ig) {
    const girder = new THREE.Mesh(kit.girderGeo, MATERIALS.deck);
    girder.name = 'box-girder';
    girder.position.set(x0, y, 0);
    g.add(girder);
  } else {
    const gMat = d.steel ? MATERIALS.steel : MATERIALS.deck;
    const gTop = d.open ? y : y - d.slabT;
    if (d.trough) {
      // พื้นตามแบบ: แผ่นพื้นลาด กันหิน A/B ผนังขอบนอก หินโรยทาง (หน้าตัดเดียวกับภาพหน้าตัด)
      const mats = { slab: MATERIALS.deck, 'retainer-a': MATERIALS.deck, 'retainer-b': MATERIALS.deck, curb: MATERIALS.deck, ballast: MATERIALS.ballast };
      for (const part of d.trough.parts) {
        const m = new THREE.Mesh(extrudeAlongX(part.pts.map(([z, yy]) => [z, yy + y]), len), mats[part.part]);
        m.name = part.part === 'slab' ? 'deck-slab' : part.part;
        m.position.x = x0;
        g.add(m);
      }
      // ฝารางสาย: แผ่นยาว 1 ม. เว้นร่อง 1 ซม.
      const t = d.trough, covers = [];
      const n = Math.max(1, Math.round(len));
      const pl = len / n;
      for (const sg of [-1, 1]) {
        for (let i = 0; i < n; i++) covers.push({ x: x0 + pl * (i + 0.5), y: y + t.coverY, z: sg * (t.zs + t.zt1) / 2, sx: pl - 0.01, sy: p.coverThick, sz: t.zt1 - t.zs - 0.01 });
      }
      g.add(mergedBoxes(covers, MATERIALS.deck, 'trough-cover'));
      if (p.handrail) g.add(buildHandrail(d));
    } else if (!d.open) {
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
    if (zs.length > 1) {
      const s = d.iSec;
      const zc = (zs[0] + zs[zs.length - 1]) / 2;
      const zw = zs[zs.length - 1] - zs[0];
      // คานขวางกลางช่วงสิ้นสุดที่ผิวเอวด้านในของคานริม (ไม่โผล่ทะลุออกนอกคานริม)
      const zwIn = Math.max(0.1, zw - s.tw);
      // คานขวางกลางช่วง: คอนกรีตจากใต้แผ่นพื้นถึงเหนือปีกล่าง / เหล็กแผ่น · ตั้งฉากกับคาน
      const th = p.diaphragmThick > 0 ? p.diaphragmThick : (d.steel ? 0.05 : 0.25);
      const yTop = d.steel ? gTop - s.tf - 0.05 : gTop - (d.trough ? 0 : s.tf + 0.08);
      const yBot = d.steel ? yTop - s.h * 0.6 : gTop - s.h + s.bt + s.tb;
      const xs = diaphragmXs(p, len);
      const isEnd = (x) => p.diaphragm !== 'list' && (x < 0.31 || x > len - 0.31);
      const mid = xs.filter((x) => !isEnd(x)).map((x) => ({ x: x0 + x, y: (yTop + yBot) / 2, z: zc, sx: th, sy: yTop - yBot, sz: zwIn }));
      const ends = xs.filter(isEnd).map((x) => ({ x: x0 + x, y: (yTop + yBot) / 2, z: zc, sx: th, sy: yTop - yBot, sz: zwIn }));
      const dm = mergedBoxes(mid, gMat, 'diaphragm');
      if (dm) straight.add(dm);
      const de = mergedBoxes(ends, gMat, 'diaphragm');
      if (de) g.add(de);
      // คานขวางปลายเต็มความลึก (เฉียงตามแนวตอม่อ) · ศูนย์กลางห่างปลายคาน 0.325 ม. สำหรับหนา 0.60
      if (p.endDiaphragm) {
        const et = p.endDiaphragmThick;
        const half = Math.max(s.bf, s.bb) / 2;
        const ew = zw + 2 * half;
        const items = [x0 + 0.025 + et / 2, x0 + len - 0.025 - et / 2].map((x) => ({ x, y: gTop - s.h / 2, z: zc, sx: et, sy: s.h, sz: ew }));
        g.add(mergedBoxes(items, gMat, 'end-diaphragm'));
      }
    }
  }

  if (d.overpass) addRoad(g, d, x0, len);
  addRailings(g, d, x0, len);
  addTracks(g, d, x0, len);
  if (straight.children.length) g.add(straight);
  return g;
}

/* ---------- ราวท่อเหล็กบนขอบนอก (แบบ Section A-A) ----------
   เสาและราวบน Ø60.5 · ราวล่าง/กลาง Ø48.6 ที่ 0.34 / 0.64 ม. · ราวบนที่ความสูงราว
   แผงละ panelBays ช่อง ระยะเสา postSpacing (S1) · รอยต่อแผงเป็นเสาคู่ห่าง 0.30 ม. · เสาแรกห่างแนวตอม่อ postEnd (a)
   ถ้า S1 ตามตารางยาวเกินช่วง จะลดระยะเสาให้พอดี */
function handrailLayout(p, L) {
  const a = p.postEnd, S1 = p.postSpacing, nb = p.panelBays, J = 0.3;
  const avail = Math.max(1, L - 2 * a);
  // fillRail: ปัดจำนวนแผงขึ้น ระยะเสาลดให้แผงเต็มช่วงพอดี (ราวเว้นช่องคงที่ระหว่างช่วง)
  const n = Math.max(1, (p.fillRail ? Math.ceil : Math.round)((avail + J) / (nb * S1 + J) - (p.fillRail ? 1e-6 : 0)));
  const bay = Math.min(S1, (avail - J * (n - 1)) / (nb * n));
  const total = n * nb * bay + J * (n - 1);
  const start = (L - total) / 2;
  const panels = [];
  for (let k = 0; k < n; k++) {
    const x = start + k * (nb * bay + J);
    panels.push([x, x + nb * bay]);
  }
  return { panels, bay, n };
}

function buildHandrail(d) {
  const p = d.params, t = d.trough;
  const lay = handrailLayout(p, d.L);
  const yb = p.deckLevel + t.curbTop;
  const H = p.handrailHeight;
  const rP = 0.03025, rR = 0.0243;
  const items = [];
  for (const sg of [-1, 1]) {
    const z = sg * t.handrailZ;
    for (const [xa, xb] of lay.panels) {
      for (let i = 0; i <= p.panelBays; i++) items.push({ x: xa + ((xb - xa) * i) / p.panelBays, y: yb + H / 2, z, r: rP, len: H, axis: 'y' });
      const len = xb - xa;
      items.push({ x: (xa + xb) / 2, y: yb + H, z, r: rP, len: len + 0.1, axis: 'x' });
      for (const hh of [0.34, 0.64].filter((v) => v < H - 0.1)) items.push({ x: (xa + xb) / 2, y: yb + hh, z, r: rR, len, axis: 'x' });
    }
  }
  return mergedPipes(items, MATERIALS.steel, 'handrail');
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
  const L = Math.max(spans[i - 1] || 0, spans[i] || 0);
  p = Object.assign(applyPreset(p, L), { preset: 'none' });   // ใช้แบบมาตรฐานก่อน แล้วจึงขยายความกว้างตามมุมเฉียง
  return Object.assign({}, p, {
    pierType: pierTypeAt(p, i, n),
    abutDir: i === 0 ? -1 : i === n ? 1 : 0,                 // ตับริม: ด้านหลังสะพาน (−1 ต้นแรก, +1 ต้นสุดท้าย)
    spanLength: L,
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
/* v3.4: ชิ้นส่วนเหล็กจากจุดถึงจุด รวมเป็นชิ้นเดียวตามชนิด
   items = [{ a, b, h, w, shape: 'box' | 'H', yRef }] · a, b = Vector3 ศูนย์กลางปลาย · h = ความลึกตามแกน yRef · w = กว้างตั้งฉาก
   รูป H: ปีกสองแผ่นตั้งฉากแกน z ของชิ้น (ปีกขนานระนาบโครงถักเมื่อ yRef อยู่ในระนาบ) เอวตรงกลาง */
const UNIT_H = (() => {
  const tf = 0.1, tw = 0.07;                       // สัดส่วนต่อความกว้าง/ความสูงหน้าตัด
  const pts = [[-0.5, 0.5], [-0.5 + tf, 0.5], [-0.5 + tf, tw / 2], [0.5 - tf, tw / 2], [0.5 - tf, 0.5], [0.5, 0.5],
    [0.5, -0.5], [0.5 - tf, -0.5], [0.5 - tf, -tw / 2], [-0.5 + tf, -tw / 2], [-0.5 + tf, -0.5], [-0.5, -0.5]];
  // จุด [z, y] → ดึงตามแกน x ยาว 1 จาก −0.5 ถึง 0.5
  const g = extrudeAlongX(pts, 1);
  g.translate(-0.5, 0, 0);
  g.userData.shared = true;
  return g;
})();
// รูป I: ปีกบน/ล่างตั้งฉากแกน y ของชิ้น (เอวตั้ง) — คานขวาง stringer strut แขนยื่น
const UNIT_I = (() => { const g = UNIT_H.clone().rotateX(Math.PI / 2); g.userData.shared = true; return g; })();
function mergeMembers(items, mat, name) {
  if (!items.length) return null;
  const parts = [];
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
  for (const it of items) {
    X.subVectors(it.b, it.a);
    const len = X.length();
    if (len < 1e-3) continue;
    X.normalize();
    Z.crossVectors(X, it.yRef).normalize();
    Y.crossVectors(Z, X);
    M.makeBasis(X.clone().multiplyScalar(len), Y.clone().multiplyScalar(it.h), Z.clone().multiplyScalar(it.w));
    M.setPosition(new THREE.Vector3().addVectors(it.a, it.b).multiplyScalar(0.5));
    parts.push({ base: it.shape === 'H' ? UNIT_H : it.shape === 'I' ? UNIT_I : UNIT_BOX, m: M.clone() });
  }
  const pos = [], nor = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { base, m } of parts) {
    const geo = base.index ? base.toNonIndexed() : base;
    const pa = geo.attributes.position, na = geo.attributes.normal;
    nm.getNormalMatrix(m);
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
    }
    if (geo !== base) geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = name;
  return mesh;
}

/* v3.4: โครงถักตามแบบโครงการ (Through truss ทางคู่)
   ระดับ: deckLevel = หลัง stringer / ใต้หมอน · คอร์ดล่างและคานขวางผิวบนเสมอ deckLevel
   คอร์ดบน/ล่าง/เสาปลาย = กล่อง · ท่อนตั้ง/ทแยง = กล่องหรือ H · ค้ำ = H */
function buildProjectTruss(d) {
  const g = new THREE.Group();
  const p = d.params, tp = d.tp;
  const y = p.deckLevel;
  const yb = y - p.bcH / 2;                     // ศูนย์กลางคอร์ดล่าง
  const zt = tp.s / 2;
  const V = (x, yy, z) => new THREE.Vector3(x, yy, z);
  const inPlane = (a, b) => new THREE.Vector3(0, 0, 1).cross(new THREE.Vector3().subVectors(b, a).normalize());
  const UP = new THREE.Vector3(0, 1, 0), ALONG = new THREE.Vector3(1, 0, 0);
  const B = (i) => tp.xs[i];
  const top = (i, z) => V(B(i), yb + tp.heights[i], z);
  const bot = (i, z) => V(B(i), yb, z);
  const chords = [], webs = [], diag = [], brace = [], heavy = [];
  const mem = (list, a, b, h, w, shape, yRef) => list.push({ a, b, h, w, shape, yRef: yRef || inPlane(a, b) });

  for (const z of [-zt, zt]) {
    for (let i = 0; i < tp.n; i++) mem(chords, bot(i, z), bot(i + 1, z), p.bcH, p.bcB, 'box');
    for (let i = 1; i < tp.n - 1; i++) mem(chords, top(i, z), top(i + 1, z), p.tcH, p.tcB, 'box');
    mem(chords, bot(0, z), top(1, z), p.tcH, p.tcB, 'box');                    // เสาปลาย
    mem(chords, bot(tp.n, z), top(tp.n - 1, z), p.tcH, p.tcB, 'box');
    for (let i = 1; i < tp.n; i++) mem(webs, bot(i, z), top(i, z), p.vmH, p.vmB, p.vmShape);
    for (const [ti, bi] of tp.diags) mem(diag, top(ti, z), bot(bi, z), p.dmH, p.dmB, p.dmShape);
  }
  // ค้ำบน: strut ทุกจุดบน · X ทุกช่อง (x1) หรือครอบ 2 ช่อง (x2) · V คว่ำ · ค้ำมุม
  const yTopC = (i) => yb + tp.heights[i];
  for (let i = 1; i < tp.n; i++) mem(heavy, top(i, -zt), top(i, zt), 0.388, 0.402, 'I', UP);
  const lat = (i, k) => { mem(brace, top(i, -zt), top(k, zt), 0.2, 0.2, 'H', UP); mem(brace, top(i, zt), top(k, -zt), 0.2, 0.2, 'H', UP); };
  if (p.upperBracing === 'x1') for (let i = 1; i < tp.n - 1; i++) lat(i, i + 1);
  if (p.upperBracing === 'x2') for (let i = 1; i + 2 <= tp.n - 1; i += 2) lat(i, i + 2);
  for (let i = 1; i < tp.n; i++) {
    const yt = yTopC(i), ys = yt - Math.min(1.7, tp.heights[i] * 0.2);
    if (p.swayV) for (const sg of [-1, 1]) mem(brace, V(B(i), ys, sg * zt), V(B(i), yt - 0.25, 0), 0.2, 0.2, 'H', ALONG);
    if (p.topKnee) for (const sg of [-1, 1]) mem(brace, V(B(i), yt - 1.3, sg * zt), V(B(i), yt, sg * (zt - 1.3)), 0.2, 0.2, 'H', ALONG);
  }
  // ระบบพื้น: คานขวางทุกจุดล่าง (ผิวบน = deckLevel) · stringer คู่ใต้ราง · knee brace มุมล่าง · ค้ำล่าง X ทุกช่อง
  const fb = [], st = [];
  const yfb = y - p.floorBeamDepth / 2;
  for (let i = 0; i <= tp.n; i++) fb.push({ a: V(B(i), yfb, -zt), b: V(B(i), yfb, zt), h: p.floorBeamDepth, w: i === 0 || i === tp.n ? 0.3 : 0.5, shape: 'I', yRef: UP });
  for (const zc of d.trackCenters) for (const sg of [-0.5, 0.5]) {
    st.push({ a: V(B(0), y - p.stringerDepth / 2, zc + sg), b: V(B(tp.n), y - p.stringerDepth / 2, zc + sg), h: p.stringerDepth, w: 0.2, shape: 'I', yRef: UP });
  }
  const ylb = y - p.floorBeamDepth + 0.1;
  for (let i = 0; i < tp.n; i++) {
    mem(brace, V(B(i), ylb, -zt), V(B(i + 1), ylb, zt), 0.2, 0.2, 'H', UP);
    mem(brace, V(B(i), ylb, zt), V(B(i + 1), ylb, -zt), 0.2, 0.2, 'H', UP);
  }
  for (let i = 1; i < tp.n; i++) for (const sg of [-1, 1]) {
    mem(brace, V(B(i), y + 1.0, sg * zt), V(B(i), y - 0.1, sg * (zt - 0.9)), 0.2, 0.2, 'H', ALONG);
  }
  const add = (m) => { if (m) g.add(m); };
  add(mergeMembers(chords, MATERIALS.steel, 'truss-chord'));
  add(mergeMembers(webs, MATERIALS.steel, 'truss-vertical'));
  add(mergeMembers(diag, MATERIALS.steel, 'truss-diagonal'));
  add(mergeMembers(heavy, MATERIALS.steel, 'top-strut'));
  add(mergeMembers(brace, MATERIALS.steel, 'bracing'));
  add(mergeMembers(fb, MATERIALS.steel, 'floor-beam'));
  add(mergeMembers(st, MATERIALS.steel, 'stringer'));

  // ทางเดินข้าง: แขนยื่นทุกจุด · พื้นแผ่นตาหมากรุก · ราวท่อที่ขอบนอก
  if (p.sidewalk) {
    const sw = p.sidewalkWidth, z0 = zt + 0.3, z1 = z0 + sw, yw = y + 0.15;
    const arms = [], plates = [];
    for (const sg of [-1, 1]) {
      for (let i = 0; i <= tp.n; i++) arms.push({ a: V(B(i), yw - 0.2, sg * (zt + 0.25)), b: V(B(i), yw - 0.2, sg * z1), h: 0.3, w: 0.15, shape: 'I', yRef: UP });
      // พื้นทางเดินเว้นช่อง railGap ระหว่างช่วง
      plates.push({ x: d.L / 2, y: yw - 0.02, z: sg * (z0 + z1) / 2, sx: d.L - p.railGap, sy: 0.04, sz: sw });
    }
    add(mergeMembers(arms, MATERIALS.steel, 'sidewalk-bracket'));
    add(mergedBoxes(plates, MATERIALS.grating, 'sidewalk'));
    // ราว: ผิวเสาปลายแผงห่างแนวตอม่อ railGap/2 → ช่องว่างราวระหว่างช่วง = railGap
    const lay = handrailLayout(Object.assign({}, p, { postEnd: p.railGap / 2 + 0.03025, fillRail: true }), d.L);
    const items = [], H = p.handrailHeight;
    for (const sg of [-1, 1]) {
      const z = sg * (z1 - 0.05);
      for (const [xa, xb] of lay.panels) {
        for (let k = 0; k <= p.panelBays; k++) items.push({ x: xa + ((xb - xa) * k) / p.panelBays, y: yw + H / 2, z, r: 0.03025, len: H, axis: 'y' });
        items.push({ x: (xa + xb) / 2, y: yw + H, z, r: 0.03025, len: xb - xa, axis: 'x' });
        for (const hh of [0.34, 0.64]) items.push({ x: (xa + xb) / 2, y: yw + hh, z, r: 0.0243, len: xb - xa, axis: 'x' });
      }
    }
    g.add(mergedPipes(items, MATERIALS.steel, 'handrail'));
  }
  addTracks(g, d, B(0), B(tp.n) - B(0), 0, d.L);   // หมอนในช่วงโครงถัก · รางต่อเนื่องเต็มช่วงตอม่อ
  return g;
}

function buildSpan(d, kit) { return d.tp ? buildProjectTruss(d) : d.truss ? buildTrussSpan(d) : buildConcreteSpan(d, kit); }

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
  const S2 = new THREE.Matrix4().makeShear(slope, 0, 0, 0, 0, 0);   // ชิ้นตั้งฉาก: ลาดอย่างเดียว ไม่เฉือนตามมุมเฉียง
  const M = new THREE.Matrix4();
  span.traverse((o) => {
    if (!o.isMesh) return;
    let straight = false;
    for (let q = o.parent; q && q !== span; q = q.parent) if (q.userData && q.userData.noShear) straight = true;
    const g = o.geometry.clone();
    g.userData = {};
    g.applyMatrix4(M.multiplyMatrices(straight ? S2 : S, o.matrixWorld));
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
  // ตับแบบที่นั่งคาน: ปีกเริ่มที่ผิวหลังกำแพงหลัง สูงถึงผิวพื้น
  const h = d.seat ? d.capTopY + d.bearing + d.superDepth : Math.max(1, d.params.deckLevel - 0.3);
  const t = 0.4;
  const zEdge = Math.max(1, (d.wallWidth || (d.W - 1)) / 2 - t / 2);
  const x0w = d.seat ? d.params.backwallThick : d.params.dThick / 2;
  const ca = Math.cos(skewRad), sa = Math.sin(skewRad);   // แนวสะพานในกรอบของตอม่อ = (cos, 0, sin)
  for (const z of [-zEdge, zEdge]) {
    const w = box(ext, h, t, MATERIALS.pier, 'wing-wall');
    w.position.set(dir * x0w + dir * ca * ext / 2, h / 2, z + dir * sa * ext / 2);
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
      // แผ่นรองใต้คานทุกตัวของช่วงที่อยู่สองข้างตอม่อ (ตอม่อเฉียง: ระยะตามแนวตอม่อ = z ÷ cos)
      const c = Math.cos(skewRad);
      const zs = new Set([spanDims[i - 1], spanDims[i]].filter(Boolean).flatMap((sd) => sd.girderZ.map((z) => r2(z / c))));
      kit.padZ = [...zs].sort((a, b) => a - b);
      if (p.bearingDetail) {
        // แผ่นรองใต้ปลายคาน: ห่างแนวตอม่อตามแนวคาน bx = endGap + 0.35 · แปลงเป็นกรอบตอม่อที่หมุนตามมุมเฉียง
        const bx = p.endGap + 0.35, sn = Math.sin(skewRad);
        kit.pads = [];
        [[spanDims[i - 1], -1], [spanDims[i], 1]].forEach(([sd, sg]) => {
          if (sd) sd.girderZ.forEach((z) => kit.pads.push({ x: sg * bx * c, z: z / c + sg * bx * sn }));
        });
      }
      if (p.restrainBlocks) {
        // ช่องระหว่างคาน (ยกเว้นช่องกลางสะพาน): ช่องแคบ = กึ่งกลาง · ช่องกว้างกว่า 1.5 ม. = ห่างคาน 0.6 ม. สองข้าง
        const gz = (spanDims[i] || spanDims[i - 1]).girderZ;
        kit.blocks = [];
        for (let k = 1; k < gz.length; k++) {
          const a = gz[k - 1], b = gz[k];
          if (a < 0 && b > 0) continue;
          if (b - a <= 1.5) kit.blocks.push((a + b) / 2); else kit.blocks.push(a + 0.6, b - 0.6);
        }
        kit.blocks = kit.blocks.map((z) => r2(z / c));
      }
    }
    if (d.truss) {
      // โครงถักตามแบบ: แผ่นรองใต้ปลายคอร์ดล่าง ห่างแนวตอม่อ off ตามแนวสะพาน
      const sides = [[spanDims[i - 1], -1], [spanDims[i], 1]].filter(([sd]) => sd && sd.tp);
      if (sides.length) {
        kit.pads = [];
        sides.forEach(([sd, sg]) => [-sd.trussZ, sd.trussZ].forEach((z) => kit.pads.push({ x: sg * (sd.tp.off + 0.1), z })));
      }
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
    deckLevels, fitLevels, bakeSpan, iGirderSection, iGirderPoints, normalizeLevels,
    // v3.1
    CB_PRESETS, SB_PRESETS, presetFor, presetParams, applyPreset, parseOffsets, troughSection, handrailLayout,
    // v3.4
    trussLayout, mergeMembers,
    // v3.2
    girderLoft
  };
}

  root.BridgeGen = { create, GENERATOR_ID: 'bpnp-bridge-gen@3' };
  if (root.BPNP) root.BPNP.bridgeGen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
