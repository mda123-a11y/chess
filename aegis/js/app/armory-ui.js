/* ==========================================================================
   AEGIS · оболочка оружейной (armory.html внутри главной страницы).
   Получает от главной страницы снаряжение генерала (hello → init), строит
   верхнюю полосу (назад, 6 слотов, генерал) и список оружия слева, затем
   запускает движок оружейной (wkit) для выбранного образца. Изменения
   модулей и слотов сразу отправляются наверх; сохранение — по «назад».
   ========================================================================== */
(function () {
  'use strict';
  const AE = window.AEGIS;
  const q = new URLSearchParams(location.hash.slice(1));
  let W = AE.WEAPONS[q.get('w')] ? q.get('w') : 'akm';
  let G = AE.GEN[q.get('g')] ? q.get('g') : AE.GENERALS[0].key;
  const embedded = window.parent && window.parent !== window;
  let L = null;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const up = (m) => { if (embedded) try { window.parent.postMessage(m, '*'); } catch (e) { /* */ } };

  /* ------------------------------------------------------ запуск --- */
  /* Таймеры оболочки — «сырые»: движок оружейной гасит таймеры старого образца при смене. */
  const RAW_ST = window.setTimeout.bind(window), RAW_CT = window.clearTimeout.bind(window);
  let started = false, booting = false, queued = null, booted = false;
  const shotLoaded = {};
  function loadShot(id) {
    if (shotLoaded[id]) return shotLoaded[id];
    return (shotLoaded[id] = new Promise((done) => {
      const s = document.createElement('script');
      s.src = 'assets/snd/shot_' + id + '.js';
      s.onload = s.onerror = () => done();
      document.head.appendChild(s);
    }));
  }
  function applyInit(init) {
    L = AE.normLoadout(init && init.L ? init.L : AE.loadLoadouts()[G]);
    if (init && init.L && init.L.cfg) L.cfg = init.L.cfg;
    window.__AEGIS_SENS = init && init.sens ? init.sens : AE.loadSettings().sens;
    WXK = (init && init.weather) || AE.loadSettings().weather || 'overcast';
    window.__AEGIS_LS = 'aegis.gs.' + G + '.';
  }
  /* загрузка образца: первый раз — полный запуск, дальше — смена на месте, без перезагрузки */
  function bootWeapon(id) {
    if (booting) { queued = id; return; }
    booting = true;
    W = id;
    if (listEl) renderList();
    window.__AEGIS_CFG_INIT = L.cfg && L.cfg[id] ? L.cfg[id] : null;
    document.body.classList.add('aeg-switching');
    const WK = window.AEGIS_WK;
    loadShot(id)
      .then(() => (booted ? WK.switchArmory(id) : WK.bootArmory(id)))
      .then(() => { booted = true; watchAds(); })
      .catch((e) => {
        console.error(e);
        const b = document.getElementById('boot-t');
        if (b) b.textContent = 'Ошибка: ' + e.message;
      })
      .finally(() => {
        booting = false;
        document.body.classList.remove('aeg-switching');
        if (queued && queued !== W) { const q2 = queued; queued = null; bootWeapon(q2); } else queued = null;
      });
    /* соседние образцы — звук заранее, в простое */
    (window.requestIdleCallback || RAW_ST)(() => { for (const x of (WK.WEAPON_ORDER || [])) loadShot(x); });
  }
  window.__AEGIS_ONCFG = (id, cfg) => { if (L) { L.cfg = L.cfg || {}; L.cfg[id] = cfg; } };
  function start(init) {
    if (started) return;
    started = true;
    applyInit(init);
    buildChrome();
    bootWeapon(W);
    setTimeout(() => coach(false), 1100);
  }

  /* ---------------------------------- подсказки первого входа --- */
  /* Пошаговая подсветка частей экрана: где выбрать образец, где модули,
     как положить в слот. Показывается один раз, повтор: кнопка «?». */
  let coachEl = null, coachI = 0;
  const COACH = [
    { el: () => listEl, side: 'right', t: 'Выберите оружие', b: 'Слева список образцов. Щёлкните по названию, модель появится в центре экрана. Мышью её можно вращать, колесом приближать.' },
    { el: () => document.querySelector('.mods'), side: 'left', t: 'Настройте модули', b: 'Справа модули по местам установки: прицел, цевьё, рукоятка, дульное устройство, фонарь. Щёлкните по модулю, чтобы поставить его. С передней рукояткой левая рука держит именно её.' },
    { el: () => listEl.querySelector('.wl-add'), side: 'right', t: 'Возьмите в снаряжение', b: 'Эта кнопка кладёт выбранный образец в свободный слот. Правило: одно основное оружие и один пистолет. Чтобы сменить образец, положите новый в тот же слот.' },
    { el: () => slotsEl, side: 'bottom', t: 'Шесть слотов', b: 'Щелчок по слоту открывает выбор: оружие, патроны, гранаты. Патроны нужны к оружию в снаряжении. Правый щелчок очищает слот. В бою слоты выбираются клавишами 1-6.' },
    { el: () => topEl.querySelector('.aeg-back'), side: 'bottom', t: 'Сохранение', b: 'Всё сохраняется сразу. «Назад» или Esc возвращают на полигон, генерал получит новое снаряжение.' }
  ];
  function coach(force) {
    if (!force && AE.LS.get('aegis.armoryCoach', false)) return;
    coachI = 0;
    if (!coachEl) {
      coachEl = el('div', 'coach');
      coachEl.innerHTML = '<div class="co-ring"></div><div class="co-card" role="dialog" aria-live="polite"><div class="co-n"></div><b class="co-t"></b><p class="co-b"></p>' +
        '<div class="co-x"><button class="co-skip" type="button">Пропустить</button><button class="co-next" type="button">Далее</button></div></div>';
      document.body.appendChild(coachEl);
      coachEl.querySelector('.co-skip').onclick = () => coachEnd();
      coachEl.querySelector('.co-next').onclick = () => { if (coachI < COACH.length - 1) { coachI++; coachDraw(); } else coachEnd(); };
      window.addEventListener('keydown', (e) => {
        if (!coachEl.classList.contains('on')) return;
        if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); coachEnd(); }
        else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); coachEl.querySelector('.co-next').click(); }
      }, true);
      const redraw = () => coachEl.classList.contains('on') && requestAnimationFrame(coachDraw);
      window.addEventListener('resize', redraw);
      document.addEventListener('scroll', redraw, true);
    }
    coachEl.classList.add('on');
    coachDraw();
  }
  function coachDraw() {
    const s = COACH[coachI], tgt = s.el();
    const ring = coachEl.querySelector('.co-ring'), card = coachEl.querySelector('.co-card');
    coachEl.querySelector('.co-n').textContent = 'Подсказка ' + (coachI + 1) + ' из ' + COACH.length;
    coachEl.querySelector('.co-t').textContent = s.t;
    coachEl.querySelector('.co-b').textContent = s.b;
    coachEl.querySelector('.co-next').textContent = coachI === COACH.length - 1 ? 'Понятно' : 'Далее';
    /* цель может быть внутри прокручиваемой панели: сперва докручиваем её,
       затем обрезаем рамку видимой частью всех прокручиваемых предков */
    if (tgt && tgt.scrollIntoView) tgt.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    let r = tgt && tgt.getBoundingClientRect ? tgt.getBoundingClientRect() : null;
    if (!r || r.width < 2 || r.height < 2) r = { left: innerWidth / 2 - 100, top: innerHeight / 2 - 40, width: 200, height: 80 };
    let L = r.left, T = r.top, R = r.left + r.width, B = r.top + r.height;
    for (let p = tgt && tgt.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX) || (p.scrollHeight <= p.clientHeight + 1 && p.scrollWidth <= p.clientWidth + 1)) continue;
      const q = p.getBoundingClientRect();
      L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
    }
    L = Math.max(L, 0); T = Math.max(T, 0); R = Math.min(R, innerWidth); B = Math.min(B, innerHeight);
    if (R - L < 4 || B - T < 4) { L = r.left; T = r.top; R = r.left + r.width; B = r.top + r.height; }
    const pad = 6;
    L -= pad; T -= pad; R += pad; B += pad;
    Object.assign(ring.style, { left: L + 'px', top: T + 'px', width: (R - L) + 'px', height: (B - T) + 'px' });
    const cw = Math.min(320, innerWidth - 24), g = 14;
    card.style.width = cw + 'px';
    const ch = card.offsetHeight || 170, midY = (T + B) / 2, midX = (L + R) / 2;
    let x, y, side = s.side;
    /* если сбоку не помещается, переносим карточку на противоположную сторону или вниз */
    if (side === 'right' && R + g + cw > innerWidth - 12) side = L - g - cw >= 12 ? 'left' : 'bottom';
    if (side === 'left' && L - g - cw < 12) side = R + g + cw <= innerWidth - 12 ? 'right' : 'bottom';
    if (side === 'bottom' && B + g + ch > innerHeight - 12) side = 'top';
    if (side === 'right') { x = R + g; y = midY - ch / 2; }
    else if (side === 'left') { x = L - cw - g; y = midY - ch / 2; }
    else if (side === 'top') { x = midX - cw / 2; y = T - g - ch; }
    else { x = midX - cw / 2; y = B + g; }
    x = Math.max(12, Math.min(innerWidth - cw - 12, x));
    y = Math.max(12, Math.min(innerHeight - ch - 12, y));
    card.dataset.side = side;
    /* стрелка карточки указывает на центр рамки */
    card.style.setProperty('--ax', Math.max(18, Math.min(cw - 18, midX - x)) + 'px');
    card.style.setProperty('--ay', Math.max(18, Math.min(ch - 18, midY - y)) + 'px');
    Object.assign(card.style, { left: x + 'px', top: y + 'px' });
    coachEl.querySelector('.co-next').focus({ preventScroll: true });
  }
  function coachEnd() { AE.LS.set('aegis.armoryCoach', true); coachEl.classList.remove('on'); }
  /* повторное открытие оружейной из игры: окно не пересоздаётся, только данные */
  function reinit(m) {
    if (AE.GEN[m.g]) G = m.g;
    applyInit(m);
    const want = m.w && AE.WEAPONS[m.w] ? m.w : W;
    renderGen(); renderSlots(); renderList();
    closePick();
    if (want !== W || m.g !== reinit.g) bootWeapon(want);
    reinit.g = G;
  }
  if (embedded) {
    addEventListener('message', (e) => {
      const m = e.data;
      if (m && m.aegis === 'init') {
        if (!started) { if (AE.GEN[m.g]) G = m.g; reinit.g = G; start(m); }
        else reinit(m);
      }
      if (m && m.aegis === 'pause') window.__pause = !!m.on;
    });
    up({ aegis: 'hello', w: W, g: G });
    RAW_ST(() => start(null), 2500);              // главная страница не ответила
  } else RAW_ST(() => start(null), 0);

  /* модули: wkit сохраняет конфигурацию — держим её и в снаряжении */
  addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.aegis === 'cfg' && m.id && L) { L.cfg = L.cfg || {}; L.cfg[m.id] = m.cfg; }
  });
  /* без главной страницы (armory.html открыт напрямую) — пишем сами */
  function saveLocal() {
    if (embedded) return;
    const all = AE.loadLoadouts();
    all[G] = L;
    AE.saveLoadouts(all);
  }
  function commit(note) {
    up({ aegis: 'loadout', L });
    saveLocal();
    renderSlots();
    renderList();
    if (note) toast(note);
  }

  /* ------------------------------------------------- оболочка --- */
  let topEl, slotsEl, listEl, pickEl, toastEl, gensEl, genBtn, wxBtn, wxEl;
  /* v6: погода на полигоне — выбирается и здесь, перед выходом */
  let WXK = 'overcast';
  const WXN = { overcast: 'Пасмурно', morning: 'Утро', rain: 'Дождь', fog: 'Туман', dusk: 'Сумерки', night: 'Ночь' };
  function renderWx() {
    wxBtn.innerHTML = 'Погода<svg viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><b>' + esc(WXN[WXK] || WXN.overcast) + '</b>';
    wxEl.innerHTML = '';
    for (const k of Object.keys(WXN)) {
      const b = el('button', k === WXK ? 'on' : '', esc(WXN[k]));
      b.onclick = () => {
        wxEl.classList.remove('on');
        WXK = k; renderWx();
        if (embedded) up({ aegis: 'weather', w: k });
        else { const st = AE.loadSettings(); st.weather = k; AE.saveSettings(st); }
        toast('Погода: ' + WXN[k]);
      };
      wxEl.appendChild(b);
    }
  }
  function buildChrome() {
    topEl = el('div', '', '');
    topEl.id = 'aeg-top';
    const back = el('button', 'aeg-back', '<i>←</i> Назад');
    back.title = 'Сохранить и вернуться (Esc)';
    back.onclick = goBack;
    slotsEl = el('div', 'aeg-slots panel');
    genBtn = el('button', 'aeg-gen-n');
    genBtn.onclick = () => gensEl.classList.toggle('on');
    gensEl = el('div', 'aeg-gens panel');
    const help = el('button', 'aeg-help', '?');
    help.title = 'Подсказки по оружейной';
    help.setAttribute('aria-label', 'Показать подсказки по оружейной');
    help.onclick = () => coach(true);
    wxBtn = el('button', 'aeg-gen-n aeg-wx');
    wxBtn.title = 'Погода на полигоне';
    wxBtn.onclick = () => { wxEl.classList.toggle('on'); gensEl.classList.remove('on'); };
    wxEl = el('div', 'aeg-gens panel aeg-wxl');
    topEl.append(back, slotsEl, wxBtn, genBtn, help, gensEl, wxEl);
    listEl = el('div', 'panel');
    listEl.id = 'aeg-left';
    pickEl = el('div', 'panel');
    pickEl.id = 'aeg-pick';
    toastEl = el('div', 'aeg-toast'); toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
    document.body.append(topEl, listEl, pickEl, toastEl);
    renderGen();
    renderWx();
    renderSlots();
    renderList();
    document.addEventListener('pointerdown', (e) => {
      if (pickEl.classList.contains('on') && !pickEl.contains(e.target) && !slotsEl.contains(e.target)) closePick();
      if (gensEl.classList.contains('on') && !gensEl.contains(e.target) && e.target !== genBtn && !genBtn.contains(e.target)) gensEl.classList.remove('on');
      if (wxEl.classList.contains('on') && !wxEl.contains(e.target) && e.target !== wxBtn && !wxBtn.contains(e.target)) wxEl.classList.remove('on');
    }, true);
  }
  function goBack() { if (embedded) up({ aegis: 'back' }); else toast('Сохранено'); saveLocal(); }
  function renderGen() {
    const g = AE.GEN[G];
    genBtn.innerHTML = 'Снаряжение · ' + esc(g.teamName) + '<svg viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><b>' + esc(g.short) + '</b>';
    gensEl.innerHTML = '';
    for (const x of AE.GENERALS) {
      const b = el('button', x.team + (x.key === G ? ' on' : ''), esc(x.short) + ' · ' + esc(x.teamName));
      b.onclick = () => {
        gensEl.classList.remove('on');
        if (x.key === G) return;
        if (embedded) up({ aegis: 'general', g: x.key });
        else { location.hash = 'w=' + W + '&g=' + x.key; location.reload(); }
      };
      gensEl.appendChild(b);
    }
  }
  let openSlot = -1;
  function renderSlots() {
    slotsEl.innerHTML = '';
    for (let i = 0; i < AE.SLOTS; i++) {
      const it = L.slots[i];
      const d = AE.describe(it, L);
      const b = el('button', 'aeg-slot' + (it ? '' : ' empty') + (it && it.t === 'ammo' ? ' is-ammo' : '') + (i === openSlot ? ' open' : ''),
        '<b>' + (i + 1) + '</b><span>' + esc(it ? d.title : 'Пусто') + '</span>' + (it && d.sub ? '<small>' + esc(d.sub.split(' · ')[0]) + '</small>' : ''));
      b.title = it ? d.title + (d.sub ? ': ' + d.sub : '') : 'Пустой слот: щёлкните, чтобы положить предмет';
      b.onclick = () => (openSlot === i ? closePick() : showPick(i));
      b.oncontextmenu = (e) => { e.preventDefault(); if (L.slots[i]) { const r = AE.clear(L, i); L = r.L; commit(r.note); } };
      slotsEl.appendChild(b);
    }
  }
  function slotIndexOf(id) { return L.slots.findIndex((s) => s && s.t === 'gun' && s.id === id); }
  function renderList() {
    listEl.innerHTML = '<div class="wl-t">Оружие</div>';
    const order = window.AEGIS_WK.WEAPON_ORDER || AE.PRIMARY.concat(AE.PISTOLS);
    for (const id of order) {
      const w = AE.WEAPONS[id];
      if (!w) continue;
      const si = slotIndexOf(id);
      const b = el('button', 'wl-i' + (id === W ? ' on' : ''), '<b>' + esc(w.name) + '</b><span>' + esc(w.calName) + '</span>' + (si >= 0 ? '<em>слот ' + (si + 1) + '</em>' : ''));
      b.title = w.full + ' · ' + w.cls;
      b.onclick = () => switchWeapon(id);
      listEl.appendChild(b);
    }
    const si = slotIndexOf(W);
    const add = el('button', 'btn wl-add' + (si >= 0 ? ' on' : ''), si >= 0 ? 'В снаряжении · слот ' + (si + 1) : 'Взять ' + esc(AE.WEAPONS[W].name) + ' в снаряжение');
    add.onclick = () => {
      if (slotIndexOf(W) >= 0) { toast(AE.WEAPONS[W].name + ' уже в слоте ' + (slotIndexOf(W) + 1)); return; }
      const r = AE.put(L, -1, { t: 'gun', id: W });
      if (!r.ok) { toast(r.error, true); return; }
      L = r.L;
      commit(r.note || AE.WEAPONS[W].name + ' в слоте ' + (slotIndexOf(W) + 1));
      flashSlot(slotIndexOf(W));
    };
    listEl.appendChild(add);
  }
  function switchWeapon(id) {
    if (id === (queued || W)) return;
    L.view = id;
    up({ aegis: 'loadout', L });
    if (embedded) up({ aegis: 'view', id });
    else { saveLocal(); history.replaceState(null, '', '#w=' + id + '&g=' + G); }
    bootWeapon(id);
    renderList();
  }
  /* --- выбор предмета в слот --- */
  function showPick(i) {
    openSlot = i;
    renderSlots();
    const cur = L.slots[i];
    /* занятость класса оружия в ДРУГОМ слоте: такие варианты недоступны */
    const busy = (item) => {
      if (item.t !== 'gun') return -1;
      const k = AE.kindOf(item.id);
      const j = L.slots.findIndex((s) => s && s.t === 'gun' && AE.kindOf(s.id) === k);
      return j >= 0 && j !== i ? j : -1;
    };
    const opt = (item, title, sub, on) => {
      const j = busy(item);
      if (j >= 0) return '<button class="pk-o off" disabled aria-disabled="true" title="' + (AE.kindOf(item.id) === 'pistol' ? 'Пистолет' : 'Основное оружие') + ' уже в слоте ' + (j + 1) + '"><b>' + esc(title) + '</b><span>Занято: слот ' + (j + 1) + '</span></button>';
      return '<button class="pk-o' + (on ? ' on' : '') + '" data-item=\'' + JSON.stringify(item) + '\'><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></button>';
    };
    const same = (a, b) => a && b && JSON.stringify(a) === JSON.stringify(b);
    const pw = AE.weaponOf(L, 'primary'), hw = AE.weaponOf(L, 'pistol');
    let h = '<div class="pk-h"><b>Слот ' + (i + 1) + '</b><button class="btn sm ghost" data-close>Закрыть</button></div>';
    const pj = busy({ t: 'gun', id: AE.PRIMARY[0] }), hj = busy({ t: 'gun', id: AE.PISTOLS[0] });
    h += '<div class="pk-g' + (pj >= 0 ? ' locked' : '') + '"><div class="pk-t">Основное оружие' + (pj >= 0 ? '<i>уже в слоте ' + (pj + 1) + '</i>' : '') + '</div><div class="pk-l">' +
      AE.PRIMARY.map((id) => opt({ t: 'gun', id }, AE.WEAPONS[id].name, AE.WEAPONS[id].cls, same(cur, { t: 'gun', id }))).join('') + '</div></div>';
    h += '<div class="pk-g' + (hj >= 0 ? ' locked' : '') + '"><div class="pk-t">Пистолет' + (hj >= 0 ? '<i>уже в слоте ' + (hj + 1) + '</i>' : '') + '</div><div class="pk-l">' +
      AE.PISTOLS.map((id) => opt({ t: 'gun', id }, AE.WEAPONS[id].name, AE.WEAPONS[id].cls, same(cur, { t: 'gun', id }))).join('') + '</div></div>';
    h += '<div class="pk-g"><div class="pk-t">Патроны</div><div class="pk-l">' +
      opt({ t: 'ammo', w: 'primary' }, pw ? AE.WEAPONS[pw].calName : 'К основному', pw ? AE.WEAPONS[pw].ammoSlot + ' шт. · ' + AE.WEAPONS[pw].name : 'нет основного оружия', same(cur, { t: 'ammo', w: 'primary' })) +
      opt({ t: 'ammo', w: 'pistol' }, hw ? AE.WEAPONS[hw].calName : 'К пистолету', hw ? AE.WEAPONS[hw].ammoSlot + ' шт. · ' + AE.WEAPONS[hw].name : 'нет пистолета', same(cur, { t: 'ammo', w: 'pistol' })) + '</div></div>';
    h += '<div class="pk-g"><div class="pk-t">Гранаты</div><div class="pk-l">' +
      Object.values(AE.GRENADES).map((g) => opt({ t: 'grenade', g: g.id }, g.name, g.full.replace(' граната ' + g.name, '') + ' · ' + g.fuse, same(cur, { t: 'grenade', g: g.id }))).join('') + '</div></div>';
    h += '<div class="pk-x"><div class="pk-err" id="pkErr"></div>' + (cur ? '<button class="btn sm" data-clear>Очистить слот</button>' : '') + '</div>';
    pickEl.innerHTML = h;
    pickEl.classList.add('on');
    pickEl.querySelector('[data-close]').onclick = closePick;
    const cl = pickEl.querySelector('[data-clear]');
    if (cl) cl.onclick = () => { const r = AE.clear(L, i); L = r.L; closePick(); commit(r.note || 'Слот ' + (i + 1) + ' очищен'); };
    for (const b of pickEl.querySelectorAll('.pk-o:not(.off)')) {
      b.onclick = () => {
        const item = JSON.parse(b.dataset.item);
        if (same(cur, item)) { closePick(); return; }
        let base = L;
        /* занятый слот — сначала освобождаем (замена предмета) */
        if (cur) {
          if (cur.t === 'gun' && item.t === 'gun' && AE.kindOf(cur.id) === AE.kindOf(item.id)) base = L;
          else base = AE.clear(L, i).L;
        }
        const r = AE.put(base, i, item);
        if (!r.ok) {
          pickEl.querySelector('#pkErr').textContent = r.error;
          const s = slotsEl.children[i]; if (s) { s.classList.remove('err'); void s.offsetWidth; s.classList.add('err'); }
          return;
        }
        L = r.L;
        closePick();
        commit(r.note);
        flashSlot(i);
      };
    }
  }
  function closePick() { openSlot = -1; pickEl.classList.remove('on'); renderSlots(); }
  function flashSlot(i) { const s = slotsEl.children[i]; if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } }
  let tT = 0;
  function toast(t, bad) {
    toastEl.textContent = t;
    toastEl.classList.toggle('bad', !!bad);
    toastEl.classList.add('on');
    RAW_CT(tT);
    tT = RAW_ST(() => toastEl.classList.remove('on'), 2200);
  }
  /* в прицеле прячем оболочку */
  let adsObs = null;
  function watchAds() {
    const ui = document.querySelector('.ui');
    if (adsObs) adsObs.disconnect();
    document.body.classList.remove('ads-on');
    if (!ui) return;
    (adsObs = new MutationObserver(() => document.body.classList.toggle('ads-on', ui.classList.contains('ads')))).observe(ui, { attributes: true, attributeFilter: ['class'] });
  }
  /* Esc вне прицела — назад (wkit шлёт aegis:'esc' наверх сам) */
  if (!embedded) addEventListener('keydown', (e) => { if (e.code === 'Escape' && pickEl && pickEl.classList.contains('on')) closePick(); });
})();
