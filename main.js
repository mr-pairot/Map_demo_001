'use strict';

/* =========================================================
   1) ตั้งค่าเส้นทางและขนาดวัตถุ (หน่วยเป็นเมตร)
   ========================================================= */
// เส้นทางสมมุติ [lng, lat] — แก้เป็นพิกัดโครงการจริงได้
const ROUTE = [
  [100.5338, 13.8132],
  [100.5372, 13.8090],
  [100.5398, 13.8052],
  [100.5421, 13.8014],
  [100.5447, 13.7972],
  [100.5468, 13.7930]
];
const ORIGIN = [100.5405, 13.8040]; // จุดอ้างอิงของฉาก 3D (ควรอยู่กลางเส้นทาง)
const DECK_Y = 12;                  // ความสูงทางยกระดับ
const TRACK_OFFSET = 2.2;           // ระยะจากแนวกลางถึงกลางรางแต่ละฝั่ง
const CAR_LEN = 20;
const CAR_GAP = 1.2;
const CAR_COUNT = 4;
const TRAIN_LEN = CAR_COUNT * (CAR_LEN + CAR_GAP);
const STATION_U = 0.5;              // ตำแหน่งสถานี (0 = ต้นทาง, 1 = ปลายทาง)

/* =========================================================
   2) แปลงพิกัด lng/lat <-> ระบบเมตรของฉาก Three.js
      แกน x = ตะวันออก, แกน y = ขึ้น, แกน z = ใต้
   ========================================================= */
const originMC = maplibregl.MercatorCoordinate.fromLngLat(ORIGIN, 0);
const S = originMC.meterInMercatorCoordinateUnits();

function toLocal([lng, lat]) {
  const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
  return new THREE.Vector3((mc.x - originMC.x) / S, 0, (mc.y - originMC.y) / S);
}

function toLngLat(v) {
  return new maplibregl.MercatorCoordinate(
    originMC.x + v.x * S,
    originMC.y + v.z * S,
    0
  ).toLngLat();
}

const curve = new THREE.CatmullRomCurve3(ROUTE.map(toLocal), false, 'centripetal');
const LENGTH = curve.getLength();

function headingAt(u) {
  const t = curve.getTangentAt(u);
  return Math.atan2(-t.z, t.x);
}

/* =========================================================
   3) สร้างฉาก Three.js
   ========================================================= */
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(-120, 300, 160);
scene.add(sun);

const mat = {
  deck:   new THREE.MeshLambertMaterial({ color: 0xcdc9c0 }),
  pier:   new THREE.MeshLambertMaterial({ color: 0xb2ada3 }),
  rail:   new THREE.MeshLambertMaterial({ color: 0x5b5f66 }),
  body:   new THREE.MeshLambertMaterial({ color: 0xf4f5f7 }),
  stripe: new THREE.MeshLambertMaterial({ color: 0xc8312b }),
  glass:  new THREE.MeshLambertMaterial({ color: 0x1f2a36 }),
  roof:   new THREE.MeshLambertMaterial({ color: 0x8fa3b8 }),
  floor:  new THREE.MeshLambertMaterial({ color: 0xe6e1d6 })
};

// --- ทางยกระดับ: แบ่งเป็นท่อนละ 10 ม. ---
const SEG = 10;
const deckGeo = new THREE.BoxGeometry(SEG + 0.6, 1.4, 10);
const railGeo = new THREE.BoxGeometry(SEG + 0.6, 0.25, 0.18);

for (let d = 0; d < LENGTH; d += SEG) {
  const len = Math.min(SEG, LENGTH - d);
  const u = (d + len / 2) / LENGTH;
  const p = curve.getPointAt(u);

  const seg = new THREE.Group();
  seg.position.set(p.x, DECK_Y, p.z);
  seg.rotation.y = headingAt(u);
  seg.scale.x = (len + 0.6) / (SEG + 0.6);

  seg.add(new THREE.Mesh(deckGeo, mat.deck));
  for (const side of [-TRACK_OFFSET, TRACK_OFFSET]) {
    for (const r of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(railGeo, mat.rail);
      rail.position.set(0, 0.82, side + r);
      seg.add(rail);
    }
  }
  scene.add(seg);
}

// --- ตอม่อ ทุก 30 ม. ---
const pierH = DECK_Y - 0.7;
const pierGeo = new THREE.CylinderGeometry(1.1, 1.3, pierH, 16);
const capGeo = new THREE.BoxGeometry(2.2, 1.2, 8.5);

for (let d = 15; d < LENGTH; d += 30) {
  const u = d / LENGTH;
  const p = curve.getPointAt(u);

  const pier = new THREE.Mesh(pierGeo, mat.pier);
  pier.position.set(p.x, pierH / 2, p.z);
  scene.add(pier);

  const cap = new THREE.Mesh(capGeo, mat.pier);
  cap.position.set(p.x, DECK_Y - 1.2, p.z);
  cap.rotation.y = headingAt(u);
  scene.add(cap);
}

// --- สถานี ---
(function buildStation() {
  const p = curve.getPointAt(STATION_U);
  const st = new THREE.Group();
  st.position.set(p.x, DECK_Y, p.z);
  st.rotation.y = headingAt(STATION_U);

  // ชานชาลาข้าง 2 ฝั่ง
  for (const z of [-6.6, 6.6]) {
    const platform = new THREE.Mesh(new THREE.BoxGeometry(140, 1.2, 4), mat.floor);
    platform.position.set(0, 0.3, z);
    st.add(platform);
  }

  // เสาหลังคา
  const colGeo = new THREE.CylinderGeometry(0.35, 0.35, 9, 10);
  for (let x = -60; x <= 60; x += 20) {
    for (const z of [-8, 8]) {
      const col = new THREE.Mesh(colGeo, mat.pier);
      col.position.set(x, 5, z);
      st.add(col);
    }
  }

  // หลังคาโค้ง (ครึ่งทรงกระบอกแบน)
  const roofGeo = new THREE.CylinderGeometry(10, 10, 150, 32, 1, true, -Math.PI / 2, Math.PI);
  const roof = new THREE.Mesh(roofGeo, mat.roof);
  roof.material.side = THREE.DoubleSide;
  roof.rotation.z = Math.PI / 2;
  roof.scale.set(1, 1, 0.35);
  roof.position.set(0, 9.5, 0);
  st.add(roof);

  // ชั้นจำหน่ายตั๋วใต้ราง
  const concourse = new THREE.Mesh(new THREE.BoxGeometry(70, 5, 26), mat.floor);
  concourse.position.set(0, -6.5, 0);
  st.add(concourse);

  scene.add(st);
})();

// --- ขบวนรถ ---
function makeCar(isHead) {
  const car = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN, 3.4, 3.1), mat.body);
  body.position.y = 1.9;
  car.add(body);

  const windows = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN - 1.6, 0.9, 3.14), mat.glass);
  windows.position.y = 2.6;
  car.add(windows);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(CAR_LEN - 0.2, 0.35, 3.16), mat.stripe);
  stripe.position.y = 1.5;
  car.add(stripe);

  if (isHead) {
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 2.7), mat.glass);
    nose.position.set(CAR_LEN / 2, 2.5, 0);
    car.add(nose);
  }
  return car;
}

function makeTrain(dir, track, phase) {
  const cars = [];
  for (let i = 0; i < CAR_COUNT; i++) {
    const car = makeCar(i === 0);
    scene.add(car);
    cars.push(car);
  }
  return { cars, dir, track, phase };
}

// ขบวน A วิ่งไปทางใต้, ขบวน B วิ่งสวนทางบนอีกราง
const trains = [
  makeTrain(1, -TRACK_OFFSET, 0),
  makeTrain(-1, TRACK_OFFSET, (LENGTH + TRAIN_LEN) * 0.45)
];

function placeTrain(train, d) {
  train.cars.forEach((car, i) => {
    let di = d - i * (CAR_LEN + CAR_GAP) - CAR_LEN / 2;
    if (di < 0 || di > LENGTH) { car.visible = false; return; }
    car.visible = true;
    if (train.dir < 0) di = LENGTH - di;

    const u = di / LENGTH;
    const p = curve.getPointAt(u);
    const h = headingAt(u);

    // เลื่อนออกด้านข้างตามรางที่วิ่ง
    car.position.set(
      p.x + Math.sin(h) * train.track,
      DECK_Y + 0.7,
      p.z + Math.cos(h) * train.track
    );
    car.rotation.y = h + (train.dir < 0 ? Math.PI : 0);
  });
}

/* =========================================================
   4) Custom layer: ให้ MapLibre วาดฉาก Three.js ร่วมกับแผนที่
   ========================================================= */
const railLayer = {
  id: 'rail-3d',
  type: 'custom',
  renderingMode: '3d',

  onAdd(map, gl) {
    this.camera = new THREE.Camera();
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true
    });
    this.renderer.autoClear = false;
    this.transform = new THREE.Matrix4()
      .makeTranslation(originMC.x, originMC.y, originMC.z)
      .scale(new THREE.Vector3(S, -S, S))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  },

  render(gl, matrix) {
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(this.transform);
    this.renderer.resetState();
    this.renderer.render(scene, this.camera);
  }
};

/* =========================================================
   5) แผนที่ MapLibre + อาคาร 3D
   ========================================================= */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/bright',
  center: ORIGIN,
  zoom: 15.4,
  pitch: 62,
  bearing: -28,
  maxPitch: 80,
  antialias: true
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

map.on('load', () => {
  // หาชั้นป้ายชื่อแรก เพื่อวางอาคารไว้ใต้ป้าย
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
      'fill-extrusion-color': [
        'interpolate', ['linear'], ['get', 'render_height'],
        0, '#e1e4ea',
        40, '#bcc4d1',
        120, '#7f8ca2'
      ],
      'fill-extrusion-height': [
        'interpolate', ['linear'], ['zoom'],
        14, 0,
        15.5, ['get', 'render_height']
      ],
      'fill-extrusion-base': [
        'interpolate', ['linear'], ['zoom'],
        14, 0,
        15.5, ['get', 'render_min_height']
      ],
      'fill-extrusion-opacity': 0.9
    }
  }, labelLayerId);

  // เงาแนวเส้นทางบนพื้น (ใช้จุดจากเส้นโค้งเดียวกับฉาก 3D)
  const groundLine = curve.getSpacedPoints(200).map((v) => toLngLat(v).toArray());
  map.addSource('route', {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: groundLine } }
  });
  map.addLayer({
    id: 'route-ground',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#c8312b',
      'line-opacity': 0.3,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 14]
    }
  }, labelLayerId);

  map.addLayer(railLayer);

  updateTrains();
  requestAnimationFrame(tick);
});

map.on('error', (e) => console.warn('Map error:', e && e.error));

/* =========================================================
   6) แอนิเมชันและการควบคุม
   ========================================================= */
const state = {
  playing: !reduceMotion,
  speedKmh: 80,
  follow: false,
  traveled: 0
};

const $ = (id) => document.getElementById(id);
const btnPlay = $('btn-play');
const speedInput = $('speed');
const speedOut = $('speed-out');
const chkBuildings = $('chk-buildings');
const chkFollow = $('chk-follow');
const statusEl = $('status');
const stripTrain = $('strip-train');

function leadDistance(train) {
  const cycle = LENGTH + TRAIN_LEN;
  return (state.traveled + train.phase) % cycle;
}

function updateTrains() {
  trains.forEach((t) => placeTrain(t, leadDistance(t)));
}

let lastStatus = 0;
function updateStatus(now) {
  if (now - lastStatus < 200) return;
  lastStatus = now;
  const d = Math.min(Math.max(leadDistance(trains[0]), 0), LENGTH);
  stripTrain.style.left = (d / LENGTH * 100).toFixed(2) + '%';
  statusEl.textContent =
    `ขบวนนำอยู่ที่ ${(d / 1000).toFixed(2)} จาก ${(LENGTH / 1000).toFixed(2)} กม.`;
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state.playing) {
    state.traveled += (state.speedKmh / 3.6) * dt;
    updateTrains();

    const lead = trains[0].cars[0];
    if (state.follow && lead.visible) {
      map.jumpTo({ center: toLngLat(lead.position) });
    }
    map.triggerRepaint();
  }
  updateStatus(now);
  requestAnimationFrame(tick);
}

function setPlaying(on) {
  state.playing = on;
  btnPlay.setAttribute('aria-pressed', String(on));
  btnPlay.textContent = on ? 'หยุดขบวน' : 'เดินขบวน';
}
setPlaying(state.playing);

btnPlay.addEventListener('click', () => setPlaying(!state.playing));

speedInput.addEventListener('input', () => {
  state.speedKmh = Number(speedInput.value);
  speedOut.textContent = speedInput.value;
});

chkBuildings.addEventListener('change', () => {
  if (map.getLayer('3d-buildings')) {
    map.setLayoutProperty('3d-buildings', 'visibility', chkBuildings.checked ? 'visible' : 'none');
  }
});

chkFollow.addEventListener('change', () => {
  state.follow = chkFollow.checked;
  if (state.follow) map.easeTo({ zoom: 17.3, pitch: 68, duration: reduceMotion ? 0 : 800 });
});

// ผู้ใช้ลากแผนที่เอง = เลิกติดตามขบวน
map.on('dragstart', () => {
  if (state.follow) { state.follow = false; chkFollow.checked = false; }
});

const VIEWS = {
  overview: { center: ORIGIN, zoom: 15.4, pitch: 62, bearing: -28 },
  station:  { center: toLngLat(curve.getPointAt(STATION_U)).toArray(), zoom: 17.6, pitch: 72, bearing: 35 },
  top:      { center: ORIGIN, zoom: 15, pitch: 0, bearing: 0 }
};

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.follow = false;
    chkFollow.checked = false;
    const view = VIEWS[btn.dataset.view];
    if (reduceMotion) map.jumpTo(view);
    else map.flyTo({ ...view, duration: 1800, essential: true });
  });
});
