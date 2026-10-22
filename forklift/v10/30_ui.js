/* ===== v10 · интерфейс: простые тексты ===== */
function tidyUI10() {
  document.title = 'Погрузчик · безопасность в цехе';
  const brand = document.querySelector('#v7Toolbar .brand');
  if (brand) { brand.querySelector('span').textContent = 'ПОГРУЗЧИК'; brand.querySelector('small').textContent = 'Как не задеть человека · версия 10'; }
  for (const b of document.querySelectorAll('#v7Toolbar nav button')) {
    const t = b.textContent.trim();
    if (t === 'Звук') b.hidden = true;
    if (t === 'Цена') b.textContent = 'Цена и ограничения';
  }
  const w = $10('v5Welcome')?.querySelector('article');
  if (w && !w.dataset.v10) {
    w.dataset.v10 = '1';
    w.querySelector('small').textContent = 'ПОГРУЗЧИК · ВЕРСИЯ 10';
    w.querySelector('h1').innerHTML = 'Погрузчик, который<br>предупреждает о людях';
    w.querySelector('ol').innerHTML =
      '<li><b>Кабина.</b> Поезжайте и возьмите поддон. Клавиша E — вилы сами встанут ровно.</li>' +
      '<li><b>Варианты.</b> Без оборудования, камеры или свет. Сравните и посмотрите сзади: там два белых фонаря на стойках.</li>' +
      '<li><b>Цена и ограничения.</b> Сколько стоит каждый вариант — обычный и бюджетный — и чего он не может.</li>';
    const n = w.querySelector('.notice');
    if (n) n.textContent = 'Это учебная модель. Она не заменяет испытаний в вашем цехе. Особенно важно проверить работу рядом с роботами и раскалённым металлом.';
  }
}
tidyUI10();
setTimeout(tidyUI10, 600); setTimeout(tidyUI10, 2500);
const choosePrev10b = chooseVariant;
chooseVariant = function (v, i) { const ok = choosePrev10b(v, i); tidyUI10(); return ok; };
{
  const st = document.createElement('style');
  st.textContent = '.v10Tiers{display:flex;gap:8px;margin:4px 0 14px}.v10Tiers button{flex:1;min-height:44px;border:1px solid #526171;border-radius:8px;background:rgba(255,255,255,.05);color:#e8edf1;font:600 15px/1.2 system-ui;text-align:center!important;cursor:pointer}.v10Tiers button[aria-selected=true],#v8PricePanel .v10Tiers button[aria-selected=true]{background:#244b66;border-color:#a4d6f6;color:#fff}#v8PricePanel .v10Tiers button{text-align:center;min-height:44px}';
  document.head.appendChild(st);
  const grid = document.querySelector('#simConfig .simVariantsGrid');
  if (grid) {
    const tabs = document.createElement('div'); tabs.id = 'v10TiersCfg'; grid.before(tabs);
    V10.ui.renderGrid = () => {
      tabs.innerHTML = V10.ui.tiersHTML();
      grid.innerHTML = V10.ORDER.map(v => '<button data-variant="' + v + '">' + VARIANTS[v].name + '<small>' + (v === '0' ? '0 ₽ · без оборудования' : rub10(Budget.estimate(v).amount) + (v[0] === 'l' ? ' · с метками для ' + V10.people : '')) + '</small></button>').join('');
      for (const b of grid.querySelectorAll('button')) b.onclick = () => { if (Pilot.demo) Pilot.stop(); chooseVariant(b.dataset.variant, true); };
    };
    V10.ui.renderGrid();
  }
  V10.ui.refresh = () => { V10.ui.renderGrid?.(); if ($10('v8PriceBody')) Price8.render(); };
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-v10tier]'); if (!b || b.dataset.v10tier === V10.tier) return;
    V10.tier = b.dataset.v10tier; V10.ui.refresh();
  });
  for (const h of document.querySelectorAll('#simConfig h3')) if (/решени|Дополнительные/.test(h.textContent)) h.remove();
  const ph = document.querySelector('#v8PricePanel .panelHead');
  if (ph) { ph.querySelector('small').textContent = 'СКОЛЬКО СТОИТ'; ph.querySelector('h2').textContent = 'Цена и ограничения'; }
}
