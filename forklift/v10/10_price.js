/* ===== v10 · цены: простой и прозрачный расчёт ===== */
V10.people = 5;
const TAG_PRICE = [13000, 17000], TAG_MID = 15000;
const camRows = n => [
  { id: 'cams', name: 'Камеры × ' + n, qty: n, unit: 7500 },
  { id: 'monitor', name: n === 4 ? 'Экран на 4 картинки' : 'Экран водителя', qty: 1, unit: n === 4 ? 7000 : 4500 },
  { id: 'camwire', name: 'Питание и провода для камер', qty: 1, unit: n === 4 ? 3000 : 2500 },
  { id: 'caminst', name: 'Монтаж и настройка камер', qty: 1, unit: n === 4 ? 10000 : 4500 }
];
const lightRows = () => [
  { id: 'uwb-kit', name: 'Приёмник радиометок с 4 антеннами', qty: 1, unit: 48000 },
  { id: 'compute', name: 'Блок управления фонарями', qty: 1, unit: 10000 },
  { id: 'lamps', name: 'Фонари × 5', qty: 5, unit: 2400 },
  { id: 'power', name: 'Питание, провода, предохранитель', qty: 1, unit: 5000 },
  { id: 'inst', name: 'Монтаж и настройка света', qty: 1, unit: 12000 }
];
V10.price.rows = function (v) {
  const cams = v === 'k3' || v === 'l3' ? 3 : v === 'k4' || v === 'l4' ? 4 : 0, light = v[0] === 'l';
  let rows = [];
  if (light) rows.push(...lightRows());
  if (cams) rows.push(...camRows(cams).filter(r => !(light && r.id === 'camwire')));
  if (light) rows.push({ id: 'tags', name: 'Радиометки на каски × ' + V10.people, qty: V10.people, unit: TAG_MID, note: 'от ' + rub10(TAG_PRICE[0]) + ' до ' + rub10(TAG_PRICE[1]) + ' за штуку' });
  for (const r of rows) { r.state = 'price'; r.amount = r.qty * r.unit; r.p = [r.amount, r.amount]; r.model = null; }
  return rows;
};
Budget.estimate = function (v) {
  const rows = V10.price.rows(v), amount = rows.reduce((s, r) => s + r.amount, 0);
  return { rows, sum: [amount, amount], total: [amount, amount], amount, unknown: [], complete: true, warnings: [], reserve: null, version: V10.version };
};

const LIMITS10 = {
  k3: ['Водитель видит больше, но сам должен смотреть на экран. Тревоги нет. Роботов и горячие предметы камера просто показывает — ложных сигналов не бывает.', 'Не заметит человека, если водитель не смотрит. Пар, пыль и жар портят картинку.'],
  k4: ['Видны все четыре угла. Тревоги нет, поэтому и ложных тревог нет.', 'Всё так же зависит от внимания водителя. Дороже на 16 000 ₽ ради четвёртого угла.'],
  l: ['Фонари реагируют только на радиометку. Робот и раскалённый металл метки не носят — их свет игнорирует.', 'Человек без метки или с севшей меткой невидим. Металл отражает радиоволны — направление может сбиваться. Робот с меткой считался бы человеком.'],
  l3: ['Свет предупреждает, камеры показывают, что именно рядом. Самый полный вариант из недорогих.', 'Все ограничения света остаются. Водитель может отвлечься на экран.'],
  l4: ['То же, что свет и 3 камеры, плюс четвёртый угол.', 'Самый дорогой. Выигрыш — только четвёртый угол.']
};
Price8.render = function () {
  const panel = $10('v8PriceBody'); if (!panel) return;
  const v = SIM.variant, q = Budget.estimate(v), lim = LIMITS10[v], light = v[0] === 'l';
  const equip = q.rows.filter(r => r.id !== 'tags').reduce((s, r) => s + r.amount, 0), tags = q.amount - equip;
  panel.innerHTML =
    '<small>ПРИМЕРНАЯ СТОИМОСТЬ · ' + VARIANTS[v].name.toUpperCase() + '</small>' +
    '<div class="v8Total">' + rub10(q.amount) + '</div>' +
    (light ? '<p>Из них оборудование — ' + rub10(equip) + ', метки для ' + V10.people + ' человек — ' + rub10(tags) + '.</p>' +
      '<label class="v8Search">Сколько людей работают рядом: <b id="v10PeopleN">' + V10.people + '</b><input id="v10People" type="range" min="1" max="30" value="' + V10.people + '"></label>' : '') +
    (q.rows.length ? '<div class="v8Table"><table><thead><tr><th>Что покупаем</th><th>Расчёт</th></tr></thead><tbody>' +
      q.rows.map(r => '<tr><td>' + r.name + (r.note ? '<small>' + r.note + '</small>' : '') + '</td><td>' + r.qty + ' × ' + rub10(r.unit) + ' = <b>' + rub10(r.amount) + '</b></td></tr>').join('') + '</tbody></table></div>' : '<p>Ничего не покупаем. Водитель смотрит сам.</p>') +
    (lim ? '<h3>Что даёт</h3><p>' + lim[0] + '</p><h3>Чего не может</h3><p>' + lim[1] + '</p>' : '') +
    '<h3>Выбрать вариант</h3><div class="v8VariantGrid">' + V10.ORDER.map(k => '<button data-v8variant="' + k + '" aria-pressed="' + (k === v) + '">' + VARIANTS[k].name + '<small>' + (k === '0' ? '0 ₽' : rub10(Budget.estimate(k).amount)) + '</small></button>').join('') + '</div>' +
    '<p class="notice">Цены — средние по открытым прайсам на октябрь 2026, разбивка по строкам приблизительная. Это не коммерческое предложение. НДС и доставка не учтены.</p>' +
    '<details open><summary>Честно об ограничениях</summary>' +
    '<p><b>Ни один вариант не гарантирует, что тревогу вызывают только люди.</b> Для горячего цеха это можно доказать только испытанием на месте: 1–2 недели с записью ложных и пропущенных срабатываний.</p>' +
    '<p>Метки надо выдать каждому, заряжать и следить, чтобы их носили. Без этого свет не работает.</p>' +
    '<p><b>Звук убран.</b> Сам по себе стоил бы около 15 000 ₽, но в шумном цехе звук трудно услышать и невозможно понять, с какой он стороны. Как добавка к свету — возможен, как основное — нет.</p>' +
    '<p><b>Камеры с распознаванием людей убраны.</b> Они дороже, и отличить человека от робота или раскалённой заготовки они должны уметь на конкретном участке — это надо проверять.</p></details>';
  this.bind(panel);
  const s = $10('v10People');
  if (s) s.oninput = e => { V10.people = +e.target.value; this.render(); $10('v10People')?.focus(); };
};
