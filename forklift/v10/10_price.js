/* ===== v10 · цены: простой и прозрачный расчёт ===== */
V10.people = 5;
V10.tier = 'std';
/* std — обычные цены; eco — простые камеры, простые лампы, монтаж силами электрика цеха */
const TIER10 = {
  std: { tag: [13000, 17000], tagMid: 15000, cam: 7500, mon3: 4500, mon4: 7000, wire3: 2500, wire4: 3000, inst3: 4500, inst4: 10000, rx: 48000, ctl: 10000, lamp: 4600, pwr: 5000, linst: 12000 },
  eco: { tag: [5000, 9000], tagMid: 7000, cam: 3000, mon3: 4000, mon4: 5500, wire3: 1500, wire4: 2000, inst3: 3000, inst4: 6000, rx: 26000, ctl: 5000, lamp: 900, pwr: 2500, linst: 7000 }
};
const ECO_NOTE = {
  cams: 'простые AHD 720p, 2 500–4 000 ₽',
  rx: 'сборка на готовых UWB-модулях (оценка)',
  lamps: 'простые белые LED-маячки 12 В из пластика, 500–1 200 ₽',
  inst: 'силами электрика цеха',
  caminst: 'силами электрика цеха'
};
const camRows = n => {
  const t = TIER10[V10.tier], four = n === 4, eco = V10.tier === 'eco';
  return [
    { id: 'cams', name: 'Камеры × ' + n, qty: n, unit: t.cam, note: eco ? ECO_NOTE.cams : null },
    { id: 'monitor', name: four ? 'Экран на 4 картинки' : 'Экран водителя', qty: 1, unit: four ? t.mon4 : t.mon3, note: eco ? '7 дюймов, без защиты от пыли' : null },
    { id: 'camwire', name: 'Питание и провода для камер', qty: 1, unit: four ? t.wire4 : t.wire3 },
    { id: 'caminst', name: 'Монтаж и настройка камер', qty: 1, unit: four ? t.inst4 : t.inst3, note: eco ? ECO_NOTE.caminst : null }
  ];
};
const lightRows = () => {
  const t = TIER10[V10.tier], eco = V10.tier === 'eco';
  return [
    { id: 'uwb-kit', name: 'Приёмник радиометок с 4 антеннами', qty: 1, unit: t.rx, note: eco ? ECO_NOTE.rx : null },
    { id: 'compute', name: 'Блок управления фонарями', qty: 1, unit: t.ctl },
    { id: 'lamps', name: 'Белые фонари × 5', qty: 5, unit: t.lamp, note: eco ? ECO_NOTE.lamps : 'герметичные белые LED-маячки 12–24 В, металлический корпус' },
    { id: 'power', name: 'Питание, провода, предохранитель', qty: 1, unit: t.pwr },
    { id: 'inst', name: 'Монтаж и настройка света', qty: 1, unit: t.linst, note: eco ? ECO_NOTE.inst : null }
  ];
};
V10.price.rows = function (v) {
  const t = TIER10[V10.tier];
  const cams = v === 'k3' || v === 'l3' ? 3 : v === 'k4' || v === 'l4' ? 4 : 0, light = v[0] === 'l';
  let rows = [];
  if (light) rows.push(...lightRows());
  if (cams) rows.push(...camRows(cams).filter(r => !(light && r.id === 'camwire')));
  if (light) rows.push({ id: 'tags', name: 'Радиометки на каски × ' + V10.people, qty: V10.people, unit: t.tagMid, note: 'от ' + rub10(t.tag[0]) + ' до ' + rub10(t.tag[1]) + ' за штуку' });
  for (const r of rows) { r.state = 'price'; r.amount = r.qty * r.unit; r.p = [r.amount, r.amount]; r.model = null; }
  return rows;
};
V10.price.total = function (v, tier) {
  const old = V10.tier; V10.tier = tier;
  try { return V10.price.rows(v).reduce((s, r) => s + r.amount, 0); } finally { V10.tier = old; }
};
Budget.estimate = function (v) {
  const rows = V10.price.rows(v), amount = rows.reduce((s, r) => s + r.amount, 0);
  return { rows, sum: [amount, amount], total: [amount, amount], amount, unknown: [], complete: true, warnings: [], reserve: null, version: V10.version };
};

const LIMITS10 = {
  k3: ['Водитель видит больше, но сам должен смотреть на экран. Тревоги нет. Роботов и горячие предметы камера просто показывает — ложных сигналов не бывает.', 'Не заметит человека, если водитель не смотрит. Пар, пыль и жар портят картинку.'],
  k4: ['Видны все четыре угла. Тревоги нет, поэтому и ложных тревог нет.', 'Всё так же зависит от внимания водителя. Четвёртый угол стоит заметно дороже.'],
  l: ['Фонари реагируют только на радиометку. Робот и раскалённый металл метки не носят — их свет игнорирует.', 'Белый свет в ярко освещённом цехе заметнее ночью, чем днём; в тёмных защитных очках он слабее янтарного или красного. Человек без метки или с севшей меткой невидим. Металл отражает радиоволны — направление может сбиваться. Робот с меткой считался бы человеком.'],
  l3: ['Свет предупреждает, камеры показывают, что именно рядом. Самый полный вариант из недорогих.', 'Все ограничения света остаются. Водитель может отвлечься на экран.'],
  l4: ['То же, что свет и 3 камеры, плюс четвёртый угол.', 'Самый дорогой. Выигрыш — только четвёртый угол.']
};
const ECO_WORSE10 = {
  cams: 'Простые камеры хуже видят ночью, в паре и пыли, их картинка грубее. Живут меньше и без защиты от мойки и ударов. Экран маленький, на солнце бледнеет.',
  light: 'Приёмник собран на готовых модулях: меньше проверок, короче гарантия, настраивать сложнее. Простые лампы светят слабее: в яркий день и в защитных очках заметны хуже. Лампы и метки надо менять и заряжать чаще. Для горячего цеха проверьте, что всё выдерживает жар: у бытовых ламп рабочая температура обычно до +60 °C.'
};
V10.ui.tiersHTML = () => '<div class="v10Tiers" role="tablist">' +
  [['std', 'Стандарт'], ['eco', 'Бюджет']].map(([k, n]) => '<button role="tab" data-v10tier="' + k + '" aria-selected="' + (V10.tier === k) + '">' + n + '</button>').join('') + '</div>';
Price8.render = function () {
  const panel = $10('v8PriceBody'); if (!panel) return;
  const v = SIM.variant, q = Budget.estimate(v), lim = LIMITS10[v], light = v[0] === 'l';
  const equip = q.rows.filter(r => r.id !== 'tags').reduce((s, r) => s + r.amount, 0), tags = q.amount - equip;
  const eco = V10.tier === 'eco', saved = eco && v !== '0' ? V10.price.total(v, 'std') - q.amount : 0;
  panel.innerHTML =
    V10.ui.tiersHTML() +
    '<small>ПРИМЕРНАЯ СТОИМОСТЬ · ' + (eco ? 'БЮДЖЕТ · ' : '') + VARIANTS[v].name.toUpperCase() + '</small>' +
    '<div class="v8Total">' + rub10(q.amount) + '</div>' +
    (saved > 0 ? '<p>Дешевле стандарта на ' + rub10(saved) + '. Модель в игре та же, меняется то, что покупаем.</p>' : '') +
    (light ? '<p>Из них оборудование — ' + rub10(equip) + ', метки для ' + V10.people + ' человек — ' + rub10(tags) + '.</p>' +
      '<label class="v8Search">Сколько людей работают рядом: <b id="v10PeopleN">' + V10.people + '</b><input id="v10People" type="range" min="1" max="30" value="' + V10.people + '"></label>' : '') +
    (q.rows.length ? '<div class="v8Table"><table><thead><tr><th>Что покупаем</th><th>Расчёт</th></tr></thead><tbody>' +
      q.rows.map(r => '<tr><td>' + r.name + (r.note ? '<small>' + r.note + '</small>' : '') + '</td><td>' + r.qty + ' × ' + rub10(r.unit) + ' = <b>' + rub10(r.amount) + '</b></td></tr>').join('') + '</tbody></table></div>' : '<p>Ничего не покупаем. Водитель смотрит сам.</p>') +
    (lim ? '<h3>Что даёт</h3><p>' + lim[0] + '</p><h3>Чего не может</h3><p>' + lim[1] + '</p>' : '') +
    (eco && v !== '0' ? '<h3>Чем бюджет хуже стандарта</h3>' + (v.includes('3') || v.includes('4') ? '<p>' + ECO_WORSE10.cams + '</p>' : '') + (light ? '<p>' + ECO_WORSE10.light + '</p>' : '') : '') +
    '<h3>Выбрать вариант</h3><div class="v8VariantGrid">' + V10.ORDER.map(k => '<button data-v8variant="' + k + '" aria-pressed="' + (k === v) + '">' + VARIANTS[k].name + '<small>' + (k === '0' ? '0 ₽' : rub10(Budget.estimate(k).amount) + (k[0] === 'l' ? ' с метками' : '')) + '</small></button>').join('') + '</div>' +
    '<p class="notice">' + (eco ? 'Бюджет — нижняя часть открытых прайсов: простые камеры и мониторы, белые LED-маячки от 500 ₽, модули для радиометок без фирменной поддержки; монтаж силами вашего электрика. Для приёмника и меток точных прайсов нет — это оценка. ' : 'Цены — средние по открытым прайсам на октябрь 2026. ') + 'Разбивка по строкам приблизительная. Это не коммерческое предложение. НДС и доставка не учтены.</p>' +
    '<details open><summary>Честно об ограничениях</summary>' +
    '<p><b>Ни один вариант не гарантирует, что тревогу вызывают только люди.</b> Для горячего цеха это можно доказать только испытанием на месте: 1–2 недели с записью ложных и пропущенных срабатываний.</p>' +
    '<p>Метки надо выдать каждому, заряжать и следить, чтобы их носили. Без этого свет не работает.</p>' +
    '<p><b>Звук убран.</b> Сам по себе стоил бы около 15 000 ₽, но в шумном цехе звук трудно услышать и невозможно понять, с какой он стороны. Как добавка к свету — возможен, как основное — нет.</p>' +
    '<p><b>Камеры с распознаванием людей убраны.</b> Они дороже, и отличить человека от робота или раскалённой заготовки они должны уметь на конкретном участке — это надо проверять.</p></details>';
  this.bind(panel);
  const s = $10('v10People');
  if (s) { s.oninput = e => { $10('v10PeopleN').textContent = e.target.value; }; s.onchange = e => { V10.people = +e.target.value; V10.ui.refresh(); }; }
};
