/* ===== v10 · ядро: варианты, простые названия, фонари ===== */
const V10 = { version: '10.0.0', ui: {}, price: {}, assist: {}, foundry: {}, fx: {} };
window.__v10 = V10;
const clamp10 = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp10 = (a, b, t) => a + (b - a) * t;
const rub10 = n => Math.round(n).toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ') + ' ₽';
const $10 = id => document.getElementById(id);
const angDiff10 = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/* ---------- варианты: только то, что осталось ---------- */
const CAMS3 = ['k1', 'k2', 'k3'], CAMS4 = ['k1', 'k2', 'k3', 'k4'];
const BASE_LIGHT = ['power', 'wire', 'compute', 'uwb', 'tags', 'ledF', 'ledL', 'ledR', 'ledBL', 'ledBR'];
const NEW_VARIANTS = {
  '0': { name: 'Без оборудования', ids: [], note: 'Водитель смотрит только сам.' },
  k3: { name: '3 камеры', ids: [...CAMS3, 'power', 'wire', 'monitor'], camLayout: '3cam-center', note: 'Две камеры спереди и одна сзади. Водитель смотрит на экран сам.' },
  k4: { name: '4 камеры', ids: [...CAMS4, 'power', 'wire', 'monitor'], camLayout: '4cam-corners', note: 'Камеры во всех четырёх углах. Водитель смотрит на экран сам.' },
  l: { name: 'Свет', ids: [...BASE_LIGHT], note: 'Пять фонарей показывают, с какой стороны человек с радиометкой.' },
  l3: { name: 'Свет и 3 камеры', ids: [...BASE_LIGHT, ...CAMS3, 'monitor'], camLayout: '3cam-center', note: 'Фонари предупреждают, камеры показывают, что именно рядом.' },
  l4: { name: 'Свет и 4 камеры', ids: [...BASE_LIGHT, ...CAMS4, 'monitor'], camLayout: '4cam-corners', note: 'Фонари предупреждают, четыре камеры показывают всё вокруг.' }
};
V10.ORDER = ['0', 'k3', 'k4', 'l', 'l3', 'l4'];
for (const k of Object.keys(VARIANTS)) delete VARIANTS[k];
Object.assign(VARIANTS, NEW_VARIANTS);

/* возможности: людей находят только радиометки; камеры — для глаз водителя */
capsFromIds = function (ids, def = {}) {
  const a = [...new Set(ids)], has = id => a.includes(id);
  const cams = a.filter(x => /^k[1-4]$/.test(x));
  const leds = a.filter(x => /^led(L|R|F|B|BL|BR)$/.test(x));
  const hasUWB = has('uwb') && has('tags'), hasAudio = has('audio');
  return {
    ids: a, cams, leds, hasCompute: has('compute'), hasExternal: false, hasAI: false, hasUWB,
    hasLED: leds.length > 0, hasAudio, detects: hasUWB, videoOnly: cams.length > 0 && !hasUWB,
    camLayout: def.camLayout || (cams.length === 3 ? '3cam-center' : cams.length ? '4cam-corners' : null),
    sectors: def.sectors ?? (leds.length > 0 || hasAudio)
  };
};
capsStatus8 = function () {
  const c = capsNow();
  return c.hasUWB ? 'Радиометки · видят только людей' : c.videoOnly ? 'Камеры · водитель смотрит сам' : 'Нет помощников';
};

/* ---------- простые названия и описания деталей ---------- */
const PLAIN = {
  k1: ['Камера спереди слева', 'Смотрит вперёд и влево. Показывает картинку на экране.'],
  k2: ['Камера спереди справа', 'Смотрит вперёд и вправо. Показывает картинку на экране.'],
  k3: ['Камера сзади слева', 'Смотрит назад и влево. Показывает картинку на экране.'],
  k4: ['Камера сзади справа', 'Смотрит назад и вправо. Показывает картинку на экране.'],
  power: ['Преобразователь питания', 'Берёт ток погрузчика и даёт безопасные 12 вольт для камер и фонарей. Стоит за предохранителем.'],
  wire: ['Провода в защитной гофре', 'Идут внутри стоек защитной рамы, не выступают за габарит.'],
  monitor: ['Экран водителя', 'Показывает картинку со всех камер. Заменяет часть зеркал.'],
  compute: ['Блок управления фонарями', 'Получает данные от радиометок и включает нужные фонари. Камеры ему не нужны.'],
  ledF: ['Фонарь над водителем', 'Над глазами водителя, в верхней перекладине. Горит, если человек впереди.'],
  ledL: ['Фонарь спереди слева', 'На левой передней стойке. Горит, если человек слева.'],
  ledR: ['Фонарь спереди справа', 'На правой передней стойке. Горит, если человек справа.'],
  ledBL: ['Фонарь сзади слева', 'На левой задней стойке. Горит, если человек сзади слева. Его видно и пешеходу.'],
  ledBR: ['Фонарь сзади справа', 'На правой задней стойке. Горит, если человек сзади справа. Его видно и пешеходу.'],
  uwb: ['Приёмник радиометок', 'Четыре антенны по углам крыши. Определяют, где находится человек с меткой. Роботы и горячий металл меток не носят — поэтому их не замечает.'],
  tags: ['Радиометка на каске', 'Маленький значок у каждого человека. Без метки система человека не видит.']
};
CAT.ledBL = { id: 'ledBL', name: PLAIN.ledBL[0], pos: [.48, 1.46, -1.245], dim: [.06, .26, .05], info: PLAIN.ledBL[1], power: '12 вольт', connection: 'Блок управления → фонарь', price: null, external: false };
CAT.ledBR = { id: 'ledBR', name: PLAIN.ledBR[0], pos: [-.48, 1.46, -1.245], dim: [.06, .26, .05], info: PLAIN.ledBR[1], power: '12 вольт', connection: 'Блок управления → фонарь', price: null, external: false };
for (const [id, [name, info]] of Object.entries(PLAIN)) {
  if (!CAT[id]) continue;
  CAT[id].name = name; CAT[id].info = info; CAT[id].power = id === 'tags' ? 'Батарейка в метке' : '12 вольт'; CAT[id].price = null;
  PlainHelp[id] = [name, info];
}
CAT.ledF.pos = [0, 1.9, .045]; CAT.ledF.dim = [.30, .04, .045];
CAT.ledL.dim = [.03, .30, .03]; CAT.ledR.dim = [.03, .30, .03];
V10.lampAz = { ledF: 0, ledL: 70, ledR: -70, ledBL: 145, ledBR: -145 };

/* ---------- устройство фонарей ---------- */
function buildLamp10(g, id) {
  const c = CAT[id], [w, h, d] = c.dim;
  const hous = new ze({ color: 0x4a525a, roughness: .45, metalness: .6 });
  const rear = id === 'ledBL' || id === 'ledBR';
  const lensMat = () => new ze({ color: rear ? 0x4a1410 : 0x5a3c12, emissive: 0x000000, emissiveIntensity: 0, roughness: .25, metalness: .05 });
  const lenses = [];
  const add = (geo, mat, x, y, z) => { const m = new Yt(geo, mat); m.position.set(x, y, z); m.userData.component = id; g.add(m); return m; };
  const lens = (lw, lh, ld, x, y, z, k = 1) => {
    const m = add(new Se(lw, lh, ld), lensMat(), x, y, z); m.userData.lens = true; m.userData.k = k; lenses.push(m);
  };
  add(new Se(w, h, d), hous, 0, 0, 0);
  if (id === 'ledF') {
    lens(w - .03, h - .018, .006, 0, 0, d / 2 + .002);          // наружу
    lens(w - .03, h - .018, .006, 0, 0, -d / 2 - .002, .3);     // к водителю, тусклее
  } else if (id === 'ledL' || id === 'ledR') {
    const s = id === 'ledL' ? -1 : 1;                           // внутрь кабины
    lens(.006, h - .04, d - .008, s * (w / 2 + .002), 0, 0, .3);
    lens(w - .008, h - .04, .006, 0, 0, d / 2 + .002);
  } else {
    const s = id === 'ledBL' ? 1 : -1;                          // наружу и назад
    lens(w - .014, h - .05, .008, 0, 0, -d / 2 - .003);
    lens(.008, h - .05, d - .014, s * (w / 2 + .003), 0, 0);
    add(new Se(w + .012, .018, d + .012), hous, 0, h / 2 + .006, 0);
    add(new Se(w * .6, h * .4, .03), hous, 0, 0, d / 2 + .012);   // кронштейн к стойке
  }
  g.userData.lenses = lenses; g.userData.level = 0; g.userData.hold = 0;
}
const buildPartPrev10 = buildPart;
buildPart = function (id) {
  if (!/^led/.test(id)) return buildPartPrev10(id);
  const g = new Wt(); g.name = 'equipment:' + id; g.userData.component = id;
  buildLamp10(g, id);
  g.position.fromArray(CAT[id].pos); g.userData.base = g.position.clone();
  He.chassis.add(g); return g;
};

const _v = new C();
const LAMP_ON = { front: 0xff9a1f, rear: 0xff2a14 }, LAMP_GAIN = .9;
V10.lampState = {};
function updateLamps10(dt) {
  const caps = capsNow(), targets = [], range = SIM.v6?.range || 8;
  if (caps.sectors && !SIM.v6?.sensorFault) {
    for (const t of SIM.detections) {
      if (SIM.clock - t.lastT > .45) continue;
      _v.copy(t.pos); He.root.worldToLocal(_v);
      const dx = Math.max(0, Math.abs(_v.x) - .58), dz = Math.max(0, _v.z - 1.1, -1.4 - _v.z);
      if (Math.hypot(dx, dz) <= range) targets.push(Math.atan2(_v.x, _v.z));
    }
  }
  for (const [id, azDeg] of Object.entries(V10.lampAz)) {
    const g = SIM.parts[id], u = g?.userData; if (!u?.lenses) continue;
    let w = 0;
    for (const az of targets) w = Math.max(w, Math.pow(Math.max(0, Math.cos(angDiff10(az, azDeg * be))), 1.6));
    // порог включения выше порога выключения, чтобы лампа не дребезжала на границе сектора
    const on = w > (u.on ? .12 : .25);
    u.hold = on ? .3 : Math.max(0, u.hold - dt);
    u.on = on || u.hold > 0;
    u.level += ((u.on ? 1 : 0) - u.level) * Math.min(1, dt * 14);
    if (Math.abs(u.level - (u.on ? 1 : 0)) < .01) u.level = u.on ? 1 : 0;
    const col = id === 'ledBL' || id === 'ledBR' ? LAMP_ON.rear : LAMP_ON.front;
    for (const m of u.lenses) {
      m.material.emissive.setHex(u.level > 0 ? col : 0);
      m.material.emissiveIntensity = u.level * LAMP_GAIN * m.userData.k;
    }
    V10.lampState[id] = { level: u.level, stage: 0 };
  }
}
const simAfterPrev10 = simAfter;
simAfter = function (dt) { simAfterPrev10(dt); updateLamps10(dt); };
