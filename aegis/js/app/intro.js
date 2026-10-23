/* ==========================================================================
   AEGIS · экран загрузки (v12).
   Ориентиры — экраны загрузки Arma Reforger, Squad, Escape from Tarkov,
   Hell Let Loose. Общее у них:
     • на весь экран — кадр из самой игры (не 3D-объект на чёрном фоне);
     • логотип небольшой, в углу, без «растянутой» разрядки;
     • совет по игре обычным регистром, крупно и контрастно (16 px, тёмная
       подложка-градиент под текстом) — его реально читают, пока ждут;
     • честный прогресс: этап сборки + процент, полоса во всю ширину внизу.
   Никакой 3D-сцены: заставка больше не отнимает видеокарту и главный поток
   у сборки полигона — на слабых ПК загрузка заметно короче. Анимации только
   transform/opacity (поток композитора), они не «замирают» во время сборки.
   API прежний: AEGIS_INTRO.{active, ready, closed, heavyOk, onClose,
   markReady, close}.
   ========================================================================== */
(function () {
  'use strict';
  const API = {
    active: false, ready: false, closed: false, T: 99,
    _heavy: Promise.resolve(), _onClose: [],
    heavyOk() { return this._heavy; },
    onClose(fn) { if (this.closed) fn(); else this._onClose.push(fn); },
    markReady() { this.ready = true; update(); },
    close() { close(); },
    redraw() { /* совместимость */ }
  };
  window.AEGIS_INTRO = API;

  const TIPS = [
    ['Вселение', 'Наведите камеру на генерала и удерживайте <kbd>F</kbd>. Повторное удержание — выйти из тела.'],
    ['Медицина', '<kbd>K</kbd> — жгут или перевязка себе или раненому рядом. Артериальное кровотечение без жгута убивает за десятки секунд.'],
    ['Прицелы', 'Колесо мыши переключает прицел: основной, боковой коллиматор под 45° или верхний.'],
    ['Укрытие', 'Лёжа (<kbd>Z</kbd>) силуэт прячется в траве. <kbd>Q</kbd> / <kbd>E</kbd> — выглянуть из-за ствола, не выходя из укрытия.'],
    ['Перезарядка', 'Магазин, расстрелянный досуха, меняется дольше: после него нужно ещё взвести затвор. Меняйте магазин заранее.'],
    ['Броня', 'Плиты держат пистолетную пулю и часть винтовочных. Таз, шея и руки плитами не закрыты.'],
    ['Патроны', '<kbd>N</kbd> — тип патрона. От него зависят пробитие брони и рикошеты.'],
    ['Полигон', '<kbd>H</kbd> — поднять мишени и вернуть бойцов на позиции.'],
    ['Хардкор', 'В настройках можно включить задержки: недосыл и перекос гильзы устраняются клавишей перезарядки.']
  ];
  const STAGE = {
    files: 'Загрузка ресурсов', map: 'Сборка карты', post: 'Постобработка', world: 'Лес и рельеф', impostors: 'Дальний лес',
    weather: 'Погода', soldier: 'Бойцы', preLoop: 'Снаряжение', preFinish: 'Снаряжение', preInv: 'Шейдеры', inv: 'Шейдеры'
  };

  const root = document.createElement('div');
  root.id = 'intro';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Загрузка AEGIS');
  root.innerHTML =
    '<div class="ld-art"></div><div class="ld-scrim"></div>' +
    '<div class="ld-main">' +
      '<div class="ld-brand"><div class="ld-logo">AEGIS</div><div class="ld-sub">Учебный полигон · Лесной рубеж</div></div>' +
      '<div class="ld-tip" aria-live="polite"><div class="ld-tip-h"></div><p class="ld-tip-t"></p></div>' +
    '</div>' +
    '<div class="ld-foot">' +
      '<div class="ld-row"><span class="ld-stage">Загрузка ресурсов</span><span class="ld-pct">0%</span></div>' +
      '<div class="ld-bar"><i></i></div>' +
    '</div>';
  document.body.appendChild(root);
  const $q = (s) => root.querySelector(s);
  const stageEl = $q('.ld-stage'), pctEl = $q('.ld-pct'), barEl = $q('.ld-bar i');
  const tipH = $q('.ld-tip-h'), tipT = $q('.ld-tip-t'), tipBox = $q('.ld-tip');
  API.active = true;
  document.body.classList.add('intro-on');

  /* кадр-фон грузим как обычную картинку (file:// это разрешает) и
     показываем только когда он декодирован — без «проявления» по строкам */
  const levelNames={angar_map:'Ангар',forest_map_camp:'Тихий бор',stroyka_zarechye_v2:'Заречье'};
  const level=levelNames[new URLSearchParams(location.search).get('map')];
  if(level)$q('.ld-sub').textContent='Боевая карта · '+level;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => { const a = $q('.ld-art'); a.style.backgroundImage = 'url("' + img.src + '")'; root.classList.add('art'); };
  img.src = 'assets/img/loading.jpg';

  /* советы: случайный старт, смена каждые 8 с с плавной сменой */
  let tipI = Math.floor(Math.random() * TIPS.length);
  function showTip() {
    const t = TIPS[tipI % TIPS.length];
    tipH.textContent = t[0]; tipT.innerHTML = t[1];
  }
  showTip();
  /* смена совета: текст меняется сразу, появление — CSS-анимацией на
     потоке композитора. Прежний вариант «скрыть → setTimeout → показать»
     на слабом ПК застревал скрытым: главный поток занят сборкой полигона,
     и таймер показа срабатывал через несколько секунд. */
  const tipTimer = setInterval(() => {
    tipI++; showTip();
    tipBox.classList.remove('swap'); void tipBox.offsetWidth; tipBox.classList.add('swap');
  }, 8000);

  /* прогресс: 0–70 % — скачивание и разбор файлов, 70–80 % — декодирование
     встроенных ассетов, 80–100 % — этапы сборки полигона (AEGIS_BOOT) */
  let shown = 0;
  function progress() {
    const lp = window.AEGIS_LOADP || { n: 0, k: 0 };
    let ga = 0;
    try { ga = window.GAssets && GAssets.progress ? GAssets.progress() : 0; } catch (e) { ga = 0; }
    const B = window.AEGIS_BOOT, bk = B && B.k ? Math.min(1, B.k) : 0;
    let stage = 'files';
    if (B && B.t && B.t.length) stage = String(B.t[B.t.length - 1][0]).split(' ')[0];
    const p = Math.min(0.99, (lp.k || 0) * 0.7 + ga * 0.1 + bk * 0.2);
    return { p, stage: B && B.t && B.t.length ? stage : (ga > 0 ? 'files' : 'files') };
  }
  function update() {
    if (API.closed) return;
    if (API.ready) {
      root.classList.add('ready');
      stageEl.textContent = 'Нажмите любую клавишу, чтобы продолжить';
      pctEl.textContent = '100%';
      barEl.style.transform = 'scaleX(1)';
      return;
    }
    const P = progress();
    /* полоса не откатывается назад и не прыгает рывками больше чем на 4 % */
    shown = Math.max(shown, Math.min(P.p, shown + 0.04));
    const pct = Math.round(shown * 100);
    barEl.style.transform = 'scaleX(' + shown.toFixed(3) + ')';
    pctEl.textContent = pct + '%';
    const s = STAGE[P.stage] || 'Сборка полигона';
    if (stageEl.textContent !== s + '…') stageEl.textContent = s + '…';
  }
  const upTimer = setInterval(update, 200);
  update();

  /* --------------------------------------------- управление и выход -- */
  function onInput(e) {
    if (API.closed) return;
    if (e.type === 'keydown' && (e.code === 'F12' || e.ctrlKey || e.metaKey)) return;
    try { window.AEGIS_UNLOCK_AUDIO && window.AEGIS_UNLOCK_AUDIO(); } catch (er) { /* */ }
    if (!API.ready) return;
    e.preventDefault(); e.stopImmediatePropagation();
    close();
  }
  const evs = ['keydown', 'pointerdown', 'wheel', 'contextmenu'];
  evs.forEach((t) => window.addEventListener(t, onInput, { capture: true, passive: false }));

  function close() {
    if (API.closed || !API.ready) return;
    API.closed = true; API.active = false;
    evs.forEach((t) => window.removeEventListener(t, onInput, { capture: true }));
    clearInterval(tipTimer); clearInterval(upTimer);
    root.classList.add('out');
    document.body.classList.remove('intro-on');
    setTimeout(() => root.remove(), 650);
    const cbs = API._onClose.splice(0); cbs.forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
  }
})();
