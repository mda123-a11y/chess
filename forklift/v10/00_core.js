/* ===== v10 · ядро: варианты, простые названия, фонари ===== */
const V10 = { version: '10.0.0', ui: {}, price: {}, assist: {}, foundry: {}, fx: {} };
window.__v10 = V10; V10.Dt = Dt;
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
  ledF: ['Фонарь над водителем', 'Над глазами водителя, в верхней перекладине. Белый. Мерцает тем чаще, чем ближе человек впереди; совсем рядом горит ровно.'],
  ledL: ['Фонарь спереди слева', 'На левой передней стойке. Белый. Мерцает тем чаще, чем ближе человек слева; совсем рядом горит ровно.'],
  ledR: ['Фонарь спереди справа', 'На правой передней стойке. Белый. Мерцает тем чаще, чем ближе человек справа; совсем рядом горит ровно.'],
  ledBL: ['Фонарь сзади слева', 'На левой задней стойке. Белый. Мерцает тем чаще, чем ближе человек сзади слева; совсем рядом горит ровно. Его видно и пешеходу.'],
  ledBR: ['Фонарь сзади справа', 'На правой задней стойке. Белый. Мерцает тем чаще, чем ближе человек сзади справа; совсем рядом горит ровно. Его видно и пешеходу.'],
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
const tierEco10 = () => V10.tier === 'eco';
function buildLamp10(g, id) {
  const c = CAT[id], [w, h, d] = c.dim, eco = tierEco10();
  // стандарт: металлический корпус с крышками и рёбрами; бюджет: простой чёрный пластик с мелкой линзой
  const hous = eco ? new ze({ color: 0x1d2023, roughness: .85, metalness: 0 }) : new ze({ color: 0x59626a, roughness: .35, metalness: .85 });
  const steel = new ze({ color: 0xaeb8bf, roughness: .3, metalness: .9 });
  const rear = id === 'ledBL' || id === 'ledBR';
  const f = eco ? .74 : 1;
  const lensMat = () => new ze({ color: eco ? 0x4a5157 : 0x5d666e, emissive: 0x000000, emissiveIntensity: 0, roughness: .25, metalness: .05, toneMapped: false });
  const lenses = [];
  const add = (geo, mat, x, y, z) => { const m = new Yt(geo, mat); m.position.set(x, y, z); m.userData.component = id; g.add(m); return m; };
  const lens = (lw, lh, ld, x, y, z, k = 1) => {
    const m = add(new Se(lw * f, lh * f, ld), lensMat(), x, y, z); m.userData.lens = true; m.userData.k = k; lenses.push(m);
  };
  add(new Se(w, h, d), hous, 0, 0, 0);
  if (id === 'ledF') {
    lens(w - .03, h - .018, .006, 0, 0, d / 2 + .002);
    lens(w - .03, h - .018, .006, 0, 0, -d / 2 - .002, .5);
    if (!eco) for (const s of [-1, 1]) add(new Se(.012, h + .01, d + .008), steel, s * (w / 2 - .004), 0, 0);
  } else if (id === 'ledL' || id === 'ledR') {
    const s = id === 'ledL' ? -1 : 1;
    lens(.006, h - .04, d - .008, s * (w / 2 + .002), 0, 0, .5);
    lens(w - .008, h - .04, .006, 0, 0, d / 2 + .002);
    if (!eco) { add(new Se(w + .01, .014, d + .01), steel, 0, h / 2, 0); add(new Se(w + .01, .014, d + .01), steel, 0, -h / 2, 0); }
  } else {
    const s = id === 'ledBL' ? 1 : -1;
    lens(w - .014, h - .05, .008, 0, 0, -d / 2 - .003);
    lens(.008, h - .05, d - .014, s * (w / 2 + .003), 0, 0);
    add(new Se(w + .012, .018, d + .012), eco ? hous : steel, 0, h / 2 + .006, 0);
    add(new Se(w * .6, h * .4, .03), hous, 0, 0, d / 2 + .012);
    if (!eco) {
      add(new Se(w + .012, .018, d + .012), steel, 0, -h / 2 - .006, 0);
      for (let i = -1; i <= 1; i++) add(new Se(w + .004, .008, .014), steel, 0, i * h * .22, -d / 2 - .012);
    }
  }
  g.userData.lenses = lenses; g.userData.level = 0; g.userData.hold = 0;
}
const buildPartPrev10 = buildPart;
buildPart = function (id) {
  if (!/^led/.test(id)) { const p = buildPartPrev10(id); decorate10(id, p); return p; }
  const g = new Wt(); g.name = 'equipment:' + id; g.userData.component = id;
  buildLamp10(g, id);
  g.position.fromArray(CAT[id].pos); g.userData.base = g.position.clone();
  He.chassis.add(g); return g;
};
/* камеры и экран: стандарт — металл, козырёк, рамка; бюджет — простой пластик */
function decorate10(id, g) {
  const eco = tierEco10();
  if (/^k[1-4]$/.test(id)) {
    const host = g.userData.cameraHead || g;
    const steel = new ze({ color: 0xaeb8bf, roughness: .3, metalness: .9 });
    for (const o of [...host.children]) {
      if (!o.geometry?.parameters) continue;
      const q = o.geometry.parameters;
      if (q.height === .018 && q.width === .15) { if (eco) o.removeFromParent(); }
      else if (q.radiusTop === .025 && eco) { o.scale.setScalar(.7); }
      else if (q.width && o.material?.color && !o.userData.lensPart) {
        o.material = o.material.clone();
        o.material.color.setHex(eco ? 0x2a2d31 : 0x3b444c); o.material.roughness = eco ? .9 : .45; o.material.metalness = eco ? 0 : .5;
      }
    }
    if (!eco) {
      const ring = new Yt(new Oe(.036, .036, .014, 20), steel); ring.rotation.x = Math.PI / 2; ring.position.z = .072; host.add(ring);
      const hood = new Yt(new Se(.11, .008, .07), steel); hood.position.set(0, .05, .1); host.add(hood);
      for (const sx of [-1, 1]) { const arm = new Yt(new Se(.008, .05, .05), steel); arm.position.set(sx * .052, .028, .02); host.add(arm); }
    }
  }
  if (id === 'monitor' && !eco) {
    const steel = new ze({ color: 0xaeb8bf, roughness: .3, metalness: .9 });
    const [mw, mh] = [.31, .182];
    for (const [w, h, x, y] of [[mw + .02, .016, 0, mh / 2 + .004], [mw + .02, .016, 0, -mh / 2 - .004], [.016, mh + .02, mw / 2 + .004, 0], [.016, mh + .02, -mw / 2 - .004, 0]]) {
      const m = new Yt(new Se(w, h, .03), steel); m.position.set(x, y, -.005); g.add(m);
    }
    const hood = new Yt(new Se(mw + .02, .06, .05), new ze({ color: 0x1a1d20, roughness: .8 })); hood.position.set(0, mh / 2 + .045, -.03); g.add(hood);
  }
}

const _v = new C();
/* белый свет: пока людей нет — лампа погашена; дальше мерцание учащается и удлиняется, вблизи — ровный неяркий свет */
const LAMP10 = { steady: .8, peak: 1, minHz: .8, maxHz: 3, minDuty: .22, maxDuty: .85, steadyAt: 1.4, color: 0xffffff, gain: { std: 2.4, eco: 1.7 } };
V10.lampState = {}; V10.mannequins = Wn;
function updateLamps10(dt) {
  const caps = capsNow(), targets = [], range = SIM.v6?.range || 8;
  if (caps.sectors && !SIM.v6?.sensorFault) {
    for (const t of SIM.detections) {
      if (SIM.clock - t.lastT > .45) continue;
      _v.copy(t.pos); He.root.worldToLocal(_v);
      const dx = Math.max(0, Math.abs(_v.x) - .58), dz = Math.max(0, _v.z - 1.1, -1.4 - _v.z), d = Math.hypot(dx, dz);
      if (d <= range) targets.push({ az: Math.atan2(_v.x, _v.z), d });
    }
  }
  for (const [id, azDeg] of Object.entries(V10.lampAz)) {
    const g = SIM.parts[id], u = g?.userData; if (!u?.lenses) continue;
    let best = null;
    for (const t of targets) {
      const w = Math.pow(Math.max(0, Math.cos(angDiff10(t.az, azDeg * be))), 1.6);
      if (w > (u.on ? .12 : .25) && (!best || t.d < best.d)) best = t;
    }
    // короткая память: потеря трека на пару кадров не гасит лампу
    if (best) { u.last = best.d; u.hold = .3; } else u.hold = Math.max(0, u.hold - dt);
    u.on = !!best || u.hold > 0;
    let want = 0;
    if (u.on) {
      const d = u.last, k = clamp10((range - d) / (range - LAMP10.steadyAt), 0, 1);
      if (d <= LAMP10.steadyAt) want = LAMP10.steady;
      else {
        u.phase = ((u.phase || 0) + lerp10(LAMP10.minHz, LAMP10.maxHz, k) * dt) % 1;
        want = u.phase < lerp10(LAMP10.minDuty, LAMP10.maxDuty, k) ? lerp10(LAMP10.peak, LAMP10.steady, k * k) : 0;
      }
    } else u.phase = 0;
    // лёгкое нарастание и спад, как у настоящего светодиода с драйвером
    const rate = want > u.level ? 45 : 28;
    u.level += (want - u.level) * Math.min(1, dt * rate);
    if (Math.abs(u.level - want) < .004) u.level = want;
    // базовый слой v6 подсвечивает весь корпус — сбрасываем всё, кроме линз
    g.traverse(o => { const m = o.material; if (m?.emissive && !o.userData.lens && (m.emissiveIntensity || m.emissive.getHex())) { m.emissive.setHex(0); m.emissiveIntensity = 0; } });
    for (const m of u.lenses) {
      m.material.emissive.setHex(u.level > 0 ? LAMP10.color : 0);
      m.material.emissiveIntensity = u.level * m.userData.k * (tierEco10() ? LAMP10.gain.eco : LAMP10.gain.std);
    }
    V10.lampState[id] = { level: u.level, steady: u.on && u.last <= LAMP10.steadyAt };
  }
}
const simAfterPrev10 = simAfter;
simAfter = function (dt) { simAfterPrev10(dt); updateLamps10(dt); };
