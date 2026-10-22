
/* ==========================================================================
   МОДУЛЬ: player.js
   ========================================================================== */
/* ============================================================================
   Контроллер бойца: движение с весом, стрельба, управление оружием.

   Ключевая идея «тяжести». Скорость не переключается мгновенно: и разгон, и
   торможение идут через ускорение, ограниченное массой (боец + броня + БК ≈
   105 кг). Дополнительно:
     * подъём и опускание оружия занимает время (вскидка 0,22–0,34 с);
     * ствол отстаёт от поворота взгляда (инерция 3,5 кг железа);
     * каждый шаг отдаёт в оружие вертикальным толчком;
     * выносливость ограничивает бег, после бега дыхание сбивает прицел.

   Модель отдачи: импульс назад по оси ствола + подброс + случайный увод,
   всё гасится критически задемпфированными пружинами.
   ========================================================================== */
(function (root, factory) {
  const P = factory(root.GUtil, root.GRig, root.GLoco);
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  else root.GPlayer = P;
})(typeof self !== 'undefined' ? self : this, function (U, RIG, LOCO) {
  'use strict';

  /* Физические параметры бойца в снаряжении. */
  const PHYS0 = {
    walk: 2.55,            // м/с — размеренный шаг под грузом
    sprint: 4.55,          // м/с — бег, недолго
    crouchWalk: 1.25,
    proneWalk: 0.62,       // м/с — переползание по-пластунски
    proneTime: 0.95,       // с — лечь / встать
    aimWalk: 1.55,         // с прицеливанием шаг короче
    accel: 11.0,           // м/с² разгон
    decel: 15.0,           // торможение
    airAccel: 1.6,
    eyeHeight: 1.655,      // высота глаз стоя
    crouchEye: 1.135,
    /* ширина плеч взрослого мужчины ~0,46 м, с бронёй и подсумками ~0,52 м:
       радиус 0,27 — прежние 0,33 не пускали в проходы, куда человек
       проходит боком */
    radius: 0.27,
    gravity: -9.81,        // реальная g (было 19,6 — тело «падало» вдвое быстрее)
    /* Прыжок с места без груза у мужчины ~0,40–0,45 м, с 20–30 кг
       (бронежилет, шлем, БК) высота падает на 30–40 %: ~0,25–0,28 м.
       v = √(2gh) ≈ 2,3 м/с. */
    jump: 2.3,
    stepUp: 0.46,          // перешагнуть/взойти: ~высота колена под грузом
    vaultMax: 1.25,        // выше — перелезть нельзя (опора на руки до уровня груди)
    staminaMax: 7.2,       // с бега
    staminaRegen: 4.2,     // с восстановления до полной
    mass: 105
  };

  /* Характеристики оружия (АК-74). Часть перекрывается системой модулей. */
  const WPN0 = {
    rpm: 650,
    magDefault: 30,
    reserve: 180,
    reloadTime: 2.45,
    reloadEmpty: 3.05,     // с досыланием затвора
    adsTime: 0.26,
    muzzleVel: 880,        // м/с
    /* Отдача. Импульс 5,45×39 — около 4,5 Н·с; при массе оружия 3,3 кг и
       плече от плеча до оси ствола ствол уводит примерно на 0,6–0,9° за
       выстрел. Отсюда значения ниже: они в разы больше прежних, потому что
       раньше отдача была неощутимой. */
    recoilUp: 0.0145,      // рад за выстрел — подброс оружия
    recoilSide: 0.0075,    // рад — случайный увод
    recoilBack: 0.035,     // м — отход назад
    /* Часть отдачи уходит в угол взгляда: именно это уводит прицел вверх
       при удержании спуска и требует «тянуть вниз». */
    kickPitch: 0.0090,     // рад за выстрел
    kickYaw: 0.0034,
    /* Восстановление: ствол сам опускается обратно, но не до конца — как
       в жизни, очередь всё равно ползёт вверх. */
    recover: 0.70,         // v10: стрелок отыгрывает 70 % увода (очередь при этом ползёт выше — см. rate)
    spreadHip: 0.042,      // рад — от бедра попасть трудно
    spreadAds: 0.0013,
    spreadMove: 0.026,
    spreadRecover: 4.5
  };

  function create(THREE, opts) {
    /* у каждого бойца — свои характеристики оружия (P.setWeapon) */
    const WPN = Object.assign({}, WPN0);
    /* особенность генерала (AEGIS.GENERALS[].trait): множители выносливости, бега и т.д. */
    const TR = opts.trait || {};
    const PHYS = Object.assign({}, PHYS0, {
      staminaMax: PHYS0.staminaMax * (TR.stamina || 1),
      sprint: PHYS0.sprint * (TR.sprint || 1),
      staminaRegen: PHYS0.staminaRegen / (TR.regen || 1)
    });
    const world = opts.world;
    const audio = opts.audio;
    const fx = opts.fx;

    const P = {
      /* положение — точка на земле под ногами */
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      grounded: true,
      crouch: 0,            // 0..1 сглаженный присед
      crouchWant: false,
      crouchMove: 0,        // 0..1 доля хода в приседе (колено -> гусиный шаг)
      crouchV: 0,           // скорость пружины приседа
      prone: 0,             // 0..1 лёжа (G)
      proneWant: false,
      lean: 0, leanWant: 0,
      sprint: 0, sprintWant: false,
      stamina: PHYS.staminaMax,
      exhausted: false,
      ads: 0, adsWant: false,
      speed: 0,
      moveDir: new THREE.Vector2(),
      /* оружие */
      ammo: 0, magCap: WPN.magDefault, reserve: 0,
      /* патроны: mag — в магазине (у помпы — в трубке), chamber — в патроннике */
      mag: 0, chamber: 0, armed: false, wid: null, weapon: null, tube: false,
      boltOpen: false, pump: -1, pumpEv: 0, reloadPlan: null, reloadStop: false,
      fireMode: 'auto', fireModes: ['safe', 'auto', 'semi'],
      cool: 0, triggerHeld: false, semiLatch: false,
      reload: -1, reloadWasEmpty: false, reloadCues: 0,
      inspect: -1,
      /* динамика */
      recoil: { x: 0, v: 0 },            // подброс (pitch)
      recoilYaw: { x: 0, v: 0 },
      recoilBack: { x: 0, v: 0 },
      jolt: { x: 0, v: 0 },              // толчки шага/приземления (видимые, не от выстрела)
      /* накопленный сбив наводки, который стрелок отыгрывает обратно */
      kickBack: { p: 0, y: 0 },
      bobPhase: 0, stepPhase: 0, lastStepSide: 1,
      sway: { x: 0, y: 0, vx: 0, vy: 0 },
      lagYaw: 0, lagPitch: 0,
      breathT: Math.random() * 100,
      spread: WPN.spreadHip,
      shotsInBurst: 0,
      lastShot: -99,
      /* учёт статистики */
      shots: 0, hits: 0,
      /* v7: видимая отдача (GRecoil, 05e): оружие, тело, камера, механика.
         Старые пружины recoil/recoilYaw/recoilBack остаются «баллистической
         тенью» — по ним считается направление ствола в момент выстрела,
         поэтому баланс оружия не меняется. */
      vr: null
    };

    P._physicsWorld=world;
    /* -------------------------------------------------------- коллизии */
    /* Скольжение вдоль препятствий: проверяем боксы и цилиндры, толкаем
       игрока наружу по минимальной оси проникновения. */
    /* Верх препятствия в мировых координатах. У «ступенек» (помост,
       грядки) h уже абсолютная, у остальных — от грунта под центром. */
    /* v10: широкая фаза — равномерная сетка 2 × 2 м по коллайдерам (spatial
       hash, как broadphase в PhysX/Bullet). Раньше каждая проверка опоры
       стопы, скольжения и перелезания обходила все ~570 коллайдеров: ноги
       4 бойцов × 3 точки подошвы × 2 прохода IK — десятки тысяч проверок за
       кадр. Сетка общая для всех бойцов (живёт на world) и пересобирается,
       если список коллайдеров вырос (флаги, зоны добавляют позже). */
    const CG_CELL = 2;
    function colGrid() {
      const cols = world.colliders || [];
      let G = world._colGrid;
      if (G && G.n === cols.length) return G;
      G = world._colGrid = { n: cols.length, map: new Map(), steps: [], q: 0, out: [] };
      for (const c of cols) {
        if (c.type === 'box' && c.step) G.steps.push(c);
        let x0, x1, z0, z1;
        if (c.type === 'box') { x0 = c.x0; x1 = c.x1; z0 = c.z0; z1 = c.z1; }
        else if (c.type === 'cyl') { x0 = c.x - c.r; x1 = c.x + c.r; z0 = c.z - c.r; z1 = c.z + c.r; }
        else continue;
        const i0 = Math.floor(x0 / CG_CELL), i1 = Math.floor(x1 / CG_CELL), j0 = Math.floor(z0 / CG_CELL), j1 = Math.floor(z1 / CG_CELL);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const k = i * 65536 + j;
          let l = G.map.get(k); if (!l) G.map.set(k, l = []);
          l.push(c);
        }
      }
      return G;
    }
    /* коллайдеры, чей след пересекает квадрат (x ± r, z ± r); массив переиспользуется */
    function nearCols(x, z, r) {
      const G = colGrid(), out = G.out;
      out.length = 0;
      const q = ++G.q;
      const i0 = Math.floor((x - r) / CG_CELL), i1 = Math.floor((x + r) / CG_CELL), j0 = Math.floor((z - r) / CG_CELL), j1 = Math.floor((z + r) / CG_CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const l = G.map.get(i * 65536 + j);
        if (!l) continue;
        for (let n = 0; n < l.length; n++) { const c = l[n]; if (c._cq !== q) { c._cq = q; out.push(c); } }
      }
      return out;
    }
    function topOf(c) {
      if (c._top !== undefined) return c._top;
      if (c.step) return (c._top = c.h);
      const cx = c.type === 'box' ? (c.x0 + c.x1) / 2 : c.x, cz = c.type === 'box' ? (c.z0 + c.z1) / 2 : c.z;
      const b = world.heightAt ? world.heightAt(cx, cz) : 0;
      return (c._top = b + (c.h || 2));
    }
    P.topOf = topOf;
    P.nearCols = nearCols;   // v16: лучи столкновения оружия от первого лица (game.js: fpRay)
    /* Скольжение вдоль препятствий: проверяем боксы и цилиндры, толкаем
       игрока наружу по минимальной оси проникновения. feetY — высота стоп:
       препятствие ниже стоп + stepUp не мешает, на него наступают
       (мешки, ящик, бревно), а над ним человек проходит в прыжке/перелезая. */
    function resolve(pos, r, feetY, ignore) {
      const fy = feetY === undefined ? pos.y : feetY;
      const near = nearCols(pos.x, pos.z, r + 0.35);
      for (let ci = 0; ci < near.length; ci++) {
        const c = near[ci];
        if (c === ignore) continue;
        const top = topOf(c);
        if (c.source && c.source.dead) continue;
        if (c.y0 !== undefined && c.y0 > fy + (1.72-0.6*(P.crouch||0)-1.05*(P.prone||0))) continue;
        if (top - fy <= PHYS.stepUp + 0.001) continue;
        if(c.type==='box' && c.obb){
          const o=c.obb,dx=pos.x-o.x,dz=pos.z-o.z,lx=dx*o.c-dz*o.s,lz=dx*o.s+dz*o.c;
          const qx=U.clamp(lx,-o.hw,o.hw),qz=U.clamp(lz,-o.hd,o.hd);let ax=lx-qx,az=lz-qz,d=Math.hypot(ax,az);
          if(d>=r)continue;if(d>1e-8){ax*=((r-d)/d);az*=((r-d)/d);}else{const px=o.hw-Math.abs(lx),pz=o.hd-Math.abs(lz);if(px<pz){ax=(Math.sign(lx)||1)*(px+r);az=0}else{ax=0;az=(Math.sign(lz)||1)*(pz+r)}}
          pos.x+=ax*o.c+az*o.s;pos.z+=-ax*o.s+az*o.c;
        } else if (c.type === 'box') {
          const cx = U.clamp(pos.x, c.x0, c.x1);
          const cz = U.clamp(pos.z, c.z0, c.z1);
          const dx = pos.x - cx, dz = pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > r * r) continue;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            pos.x = cx + (dx / d) * r;
            pos.z = cz + (dz / d) * r;
          } else {
            /* центр внутри бокса — выталкиваем по ближайшей грани */
            const toL = pos.x - c.x0, toR = c.x1 - pos.x;
            const toB = pos.z - c.z0, toF = c.z1 - pos.z;
            const m = Math.min(toL, toR, toB, toF);
            if (m === toL) pos.x = c.x0 - r;
            else if (m === toR) pos.x = c.x1 + r;
            else if (m === toB) pos.z = c.z0 - r;
            else pos.z = c.z1 + r;
          }
        } else if (c.type === 'cyl') {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const d = Math.hypot(dx, dz);
          const rr = r + c.r;
          if (d < rr && d > 1e-6) {
            pos.x = c.x + (dx / d) * rr;
            pos.z = c.z + (dz / d) * rr;
          }
        }
      }
      /* границы участка: за ограждением — минное поле, дальше хода нет
         (game/world: buildMinefield, полоса depth м за ограждением) */
      const MFb = world.minefield;
      const LX = MFb ? MFb.XF + MFb.depth + 0.3 : 28, LZ = MFb ? MFb.ZF + MFb.depth + 0.3 : 33;
      pos.x = U.clamp(pos.x, world.bounds?world.bounds.x0:-LX, world.bounds?world.bounds.x1:LX);
      pos.z = U.clamp(pos.z, world.bounds?world.bounds.z0:-LZ, world.bounds?world.bounds.z1:LZ);
    }
    /* попадает ли точка (с запасом m) в след препятствия */
    function inside(c, x, z, m) {
      if(c.obb){const o=c.obb,dx=x-o.x,dz=z-o.z;return Math.abs(dx*o.c-dz*o.s)<o.hw+m&&Math.abs(dx*o.s+dz*o.c)<o.hd+m;}
      if (c.type === 'box') return x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m;
      if (c.type === 'cyl') return Math.hypot(x - c.x, z - c.z) < c.r + m;
      return false;
    }

    /* Высота опоры под игроком: рельеф плюс низкие «ступеньки». С feetY —
       ещё и верх любых препятствий, до которых стопа достаёт (стоит на
       ящике, на мешках, приземлился на бревно). Без feetY — как раньше:
       рэгдолл и кровь видят только рельеф и помост. */
    function groundAt(x, z, feetY) {
      let y = world.heightAt ? world.heightAt(x, z) : 0;
      const G = colGrid();
      for (let ci = 0; ci < G.steps.length; ci++) {
        const c = G.steps[ci];
        if (x > c.x0 - 0.1 && x < c.x1 + 0.1 && z > c.z0 - 0.1 && z < c.z1 + 0.1) y = Math.max(y, c.h);
      }
      if (feetY === undefined) return y;
      const near = nearCols(x, z, 0.1);
      for (let ci = 0; ci < near.length; ci++) {
        const c = near[ci];
        if (c.type === 'box' && c.step) continue;
        if(c.source&&c.source.dead)continue;
        const top = topOf(c);
        if (top <= y || top - feetY > PHYS.stepUp + 0.001) continue;
        /* стопа опирается, если центр над препятствием (у цилиндра —
           над его «плечом», округлые мешки и брёвна скатывают ногу с края) */
        if (inside(c, x, z, c.type === 'cyl' ? -c.r * 0.25 : 0.04)) y = top;
      }
      return y;
    }
    P.groundAt = groundAt;

    /* ============================================== перелезание ===== */
    /* Реальная техника: подход, опора на руки о верх препятствия,
       перенос ног сбоку («упор-перемах», speed/lazy vault). С грузом
       25–30 кг препятствие 0,5–0,8 м проходится за ~0,7–0,9 с, по грудь
       (1–1,2 м) — за 1,1–1,4 с, с отталкиванием и закидыванием ноги.
       Толстое препятствие (ящик, помост) — сначала залезть наверх
       (mantle), дальше идти по нему. Корпус при этом сгибается: глаза
       проходят примерно на 0,9–1,0 м над верхом. */
      /* Лестница (вышки, крыши): вперёд к лестнице — взяться; W/S — вверх/вниз; пробел — спрыгнуть */
      function ladderStep(dt, active, wish, sinY, cosY, input) {
        const alive = (L) => !(L.dead || (L.panel && L.panel.dead));
        if (!active) { P.ladder = null; return; }
        if (!P.ladder) {
          if (wish.y > -0.3 || P.vault) return;
          let best = null, bd = 1e9;
          for (const L of world.ladders) {
            if (!alive(L) || P.pos.y < L.y0 - 0.4 || P.pos.y > L.y1 + 0.3) continue;
            const dx = P.pos.x - L.x, dz = P.pos.z - L.z, front = dx * L.nx + dz * L.nz, along = dx * L.nz - dz * L.nx;
            if (front < -0.15 || front > 0.8 || Math.abs(along) > L.w / 2 + 0.25) continue;
            if (-sinY * -L.nx + -cosY * -L.nz < 0.35) continue;
            const d = Math.abs(front - 0.4) + Math.abs(along);
            if (d < bd) { bd = d; best = L; }
          }
          if (best) { P.ladder = best; P.vel.set(0, 0, 0); P._motorVX = 0; P._motorVZ = 0; P.grounded = false; }
          return;
        }
        const L = P.ladder;
        if (!alive(L)) { P.ladder = null; return; }
        const up = -wish.y, sp = P.sprint > 0.5 ? 3.1 : 2.2;
        if ((input.jump || 0) !== (P._ladJ === undefined ? (input.jump || 0) : P._ladJ) && (input.jump || 0)) {
          P.ladder = null; P.vel.set(L.nx * 2.6, 2.2, L.nz * 2.6); return;
        }
        P._ladJ = input.jump || 0;
        P.pos.y += up * sp * dt;
        const dx = P.pos.x - L.x, dz = P.pos.z - L.z, along = Math.max(-L.w / 2, Math.min(L.w / 2, dx * L.nz - dz * L.nx));
        const k = Math.min(1, dt * 12);
        P.pos.x += (L.x + L.nx * 0.42 + L.nz * along - P.pos.x) * k;
        P.pos.z += (L.z + L.nz * 0.42 - L.nx * along - P.pos.z) * k;
        P.vel.set(0, 0, 0); P._motorVX = 0; P._motorVZ = 0; P.speed = 0; P.grounded = false;
        if (P.pos.y >= L.y1 - 0.05 && up > 0) { P.pos.set(L.exit[0], L.exit[1], L.exit[2]); P.ladder = null; P.grounded = true; }
        else if (P.pos.y <= L.y0 && up < 0) { P.pos.y = L.y0; P.ladder = null; }
      }

    function tryVault() { return globalThis.GTraversal.tryStart(P, world, PHYS); }
    P.tryVault = tryVault;
    function updateVault(dt, active) { globalThis.GTraversal.update(P, world, dt); }

    /* ======================================================= движение == */
    P.updateMove = function (dt, input, active) {
      const moveStartX=P.pos.x,moveStartZ=P.pos.z;
      P._distancePhase=true;
      /* Неуправляемый боец стоит: только дыхание и лёгкие колебания. */
      const wish = new THREE.Vector2(0, 0);
      if (active) {
        if (input.fwd) wish.y -= 1;
        if (input.back) wish.y += 1;
        if (input.left) wish.x -= 1;
        if (input.right) wish.x += 1;
        if (wish.lengthSq() > 0) wish.normalize();
      } else if (P.aiWish) {
        /* v6: неуправляемый боец может двигаться сам (уход от гранаты, возврат в строй) */
        wish.copy(P.aiWish);
        if (wish.lengthSq() > 1) wish.normalize();
      }
      P.moveDir.copy(wish);

      /* присед */
      /* лёжа: G — лечь/встать, Shift или присед — подняться. Ложится через
         колено: сначала присед, потом корпус вперёд на руки (~1 с) */
      if (active) {
        if (P._pt === undefined) P._pt = input.proneTog || 0;
        if ((input.proneTog || 0) !== P._pt) { P._pt = input.proneTog || 0; P.proneWant = !P.proneWant; }
        if (P.proneWant && P.prone > 0.9 && ((input.sprint && wish.y < -0.3) || (input.crouch && !P._crouchHeld))) P.proneWant = false;
        P._crouchHeld = !!input.crouch;
      } else { P._pt = undefined; if (P.aiProne !== undefined) P.proneWant = !!P.aiProne; }
      /* v13: перелом бедра/таза/голени или паралич ног — на ногу не встать:
         боец валится и дальше только ползком (стрелять может) */
      if (P.legDown) { P.proneWant = true; P._legDownT = (P._legDownT || 0) + dt; }
      const proneDir = P.proneWant ? 1 : -1;
      if (!P.proneWant || P.crouch > 0.55 || P.legDown) P.prone = U.clamp01(P.prone + proneDir * dt / (PHYS.proneTime * (P.legDown && P.prone < 0.9 ? 0.45 : 1)));
      P.crouchWant = (active && !!input.crouch) || (!active && !!P.aiCrouch) || P.proneWant || P.prone > 0.02;
      /* присед — критически демпфированная пружина: мягкий старт и
         дотягивание без рывка (прежний экспоненциальный damp дёргал
         камеру в первый кадр) */
      {
        const w = P.crouchWant ? 13 : 11, x0 = P.crouch;
        const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
        for (let i = 0; i < n; i++) {
          P.crouchV += (w * w * ((P.crouchWant ? 1 : 0) - P.crouch) - 2 * w * P.crouchV) * h;
          P.crouch += P.crouchV * h;
        }
        if (P.crouch < 0) { P.crouch = 0; P.crouchV = 0; }
        if (P.crouch > 1) { P.crouch = 1; P.crouchV = 0; }
        if (!isFinite(P.crouch)) { P.crouch = x0; P.crouchV = 0; }
      }
      /* доля хода в приседе: стоит — на колене, пошёл — встаёт в «гусиный
         шаг» (anim/locomotion.js, crouchProfile); подъём с колена ~0,3 с */
      P.crouchMove = U.damp(P.crouchMove || 0, U.clamp01((Math.hypot(P.vel.x, P.vel.z) - 0.12) / 0.7), 6.5, dt);

      /* прицеливание */
      P.adsWant = (active ? !!input.ads : !!P.aiADS) && P.armed && P.reload < 0 && P.inspect < 0 && !P.treating;
      const adsRate = 1 / Math.max(0.08, WPN.adsTime * (P.adsWant ? 1 : 0.8));
      P.ads = U.clamp01(P.ads + (P.adsWant ? adsRate : -adsRate * 1.25) * dt);

      /* бег: только вперёд, не в прицеле, при наличии выносливости */
      const canSprint = (active ? input.sprint : P.aiSprint) && wish.y < -0.3 && Math.abs(wish.x) < 0.75
        && P.ads < 0.35 && !P.exhausted && P.crouch < 0.4 && P.reload < 0 && P.prone < 0.05 && !P.injLeg && !P.treating;
      P.sprintWant = !!canSprint;
      P.sprint = U.damp(P.sprint, canSprint ? 1 : 0, canSprint ? 5.5 : 8, dt);

      if (canSprint) {
        P.stamina -= dt;
        if (P.stamina <= 0) { P.stamina = 0; P.exhausted = true; }
      } else {
        P.stamina = Math.min(PHYS.staminaMax * (P.breathK === undefined ? 1 : 0.4 + 0.6 * P.breathK), P.stamina + dt * (PHYS.staminaMax / PHYS.staminaRegen) * (P.breathK === undefined ? 1 : P.breathK));
        if (P.exhausted && P.stamina > PHYS.staminaMax * 0.42) P.exhausted = false;
      }

      /* целевая скорость с учётом режима */
      let target = PHYS.walk;
      target = U.lerp(target, PHYS.sprint, P.sprint);
      target = U.lerp(target, PHYS.aimWalk, P.ads * (1 - P.sprint));
      target = U.lerp(target, PHYS.crouchWalk, P.crouch);
      target = U.lerp(target, PHYS.proneWalk, U.clamp01(P.prone * 1.3));
      /* пока ложится или встаёт — почти на месте */
      if (P.prone > 0.04 && P.prone < 0.96) target *= 0.15;
      /* перелом ноги: хромает, не бегает */
      /* v13: хромота (ранение мышц/кости ноги) и шок от кровопотери */
      if (P.limp) target *= 1 - 0.5 * Math.min(1, P.limp) * (TR.fract || 1);
      if (P.legDown) target *= 0.55;
      if (P.shockK) target *= 1 - 0.35 * P.shockK;
      if (P.treating) target = Math.min(target, 0.9);   // руки заняты перевязкой — только шагом
      /* назад и вбок медленнее — так ходит человек с грузом */
      if (wish.y > 0.1) target *= 0.72;
      if (Math.abs(wish.x) > 0.7) target *= 0.84;
      if (P.reload >= 0) target *= 0.88;

      /* Мировое направление желаемой скорости.
         Камера с rotation.y = yaw смотрит вдоль forward = (-sin yaw, -cos yaw),
         вправо — right = (cos yaw, -sin yaw). Здесь wish.y = -1 означает «вперёд»,
         wish.x = +1 — «вправо», поэтому раскладываем по этим двум осям.
         Прежняя формула поворачивала вектор на -yaw и на боковых курсах
         уводила бойца зеркально: W шёл назад, D — влево. */
      const sinY = Math.sin(P.yaw), cosY = Math.cos(P.yaw);
      const wx = wish.x * cosY + wish.y * sinY;
      const wz = -wish.x * sinY + wish.y * cosY;
      const want = new THREE.Vector3(wx * target, 0, wz * target);

      /* разгон/торможение с ограничением по ускорению: инерция массы;
         в воздухе ноги не толкают — курс почти не меняется */
      // Accelerate the locomotion motor, not last frame's collision-clipped
      // displacement. Feeding the latter back stalls slow capsules at stair risers.
      // Rapier still owns ALL actual displacement, velocity and animation speed.
      const cur = new THREE.Vector3(P._motorVX ?? P.vel.x, 0, P._motorVZ ?? P.vel.z);
      const diff = want.clone().sub(cur);
      const maxA = (P.grounded ? (want.lengthSq() > cur.lengthSq() ? PHYS.accel : PHYS.decel) : PHYS.airAccel * 0.4) * dt;
      if (diff.length() > maxA) diff.setLength(maxA);
      cur.add(diff);
      P.vel.x = cur.x; P.vel.z = cur.z;
      P._motorVX=cur.x; P._motorVZ=cur.z;
      P.speed = cur.length();

      /* ПРОБЕЛ: у препятствия по пояс-грудь — перелезть, иначе — прыжок */
      if (active) {
        if (P._jp === undefined) P._jp = input.jump || 0;
        if ((input.jump || 0) !== P._jp) {
          P._jp = input.jump || 0;
          if (!P.vault && P.grounded && P.prone < 0.05 && P.reload < 0) {
            if (!tryVault()) {
              /* прыжок: из приседа ниже, уставший — ниже, с переломом — нет */
              if (!P.injLeg && P.stamina > 0.4) {
                const k = (1 - P.crouch * 0.35) * (P.exhausted ? 0.7 : 1);
                P.vel.y = PHYS.jump * k;
                P.grounded = false;
                P.stamina = Math.max(0, P.stamina - 0.55);
                P._air = { t: 0, y0: P.pos.y };
                if (audio && audio.step) audio.step(true, 0.7, 0.4, P.lastStepSide);
              }
            }
          }
        }
      } else P._jp = undefined;

      if (world.ladders && world.ladders.length) ladderStep(dt, active, wish, sinY, cosY, input);
      if (P.vault) {
        updateVault(dt, active);
      } else if (P.ladder) {
        /* лестница: позицию ведёт ladderStep, физика тела не нужна */
      } else if (globalThis.GPhysics) {
        globalThis.GPhysics.get(world).move(P, dt, PHYS.gravity);
      } else {
        const nx = P.pos.x + P.vel.x * dt;
        const nz = P.pos.z + P.vel.z * dt;
        const tmp = new THREE.Vector3(nx, P.pos.y, nz);
        resolve(tmp, PHYS.radius, P.pos.y);
        /* если коллизия отбросила — гасим скорость по этой оси */
        if (Math.abs(tmp.x - nx) > 1e-6) P.vel.x *= 0.1;
        if (Math.abs(tmp.z - nz) > 1e-6) P.vel.z *= 0.1;
        P.pos.x = tmp.x; P.pos.z = tmp.z;
        const gy = groundAt(P.pos.x, P.pos.z, P.pos.y);
        const wasAir = !P.grounded, vy0 = P.vel.y;
        if (!P.grounded || P.vel.y > 0) {
          /* полёт: прыжок или сход с уступа выше шага */
          P.vel.y += PHYS.gravity * dt;
          P.pos.y += P.vel.y * dt;
          if (P.pos.y <= gy && P.vel.y <= 0) { P.pos.y = gy; P.vel.y = 0; P.grounded = true; }
        } else if (gy > P.pos.y) {
          /* шаг вверх (мешок, ящик, бревно): тело поднимается за ~0,15 с,
             а не телепортируется */
          P.pos.y = Math.min(gy, P.pos.y + Math.max(dt * 1.2, (gy - P.pos.y) * (1 - Math.exp(-16 * dt))));
          P.vel.y = 0;
        } else if (P.pos.y - gy < PHYS.stepUp) {
          /* шаг вниз — опускается за ногой */
          P.pos.y = Math.max(gy, P.pos.y - Math.max(dt * 1.2, (P.pos.y - gy) * (1 - Math.exp(-14 * dt))));
          P.vel.y = 0;
        } else {
          /* уступ выше шага — падаем */
          P.grounded = false;
          P.vel.y += PHYS.gravity * dt;
          P.pos.y += P.vel.y * dt;
        }
        /* приземление: удар гасится коленями — камера проседает тем
           сильнее, чем выше падение; с 1 м и выше — тяжёлый, шумный удар */
        if (wasAir && P.grounded) {
          const v = Math.abs(vy0);
          P.landK = Math.min(1, (P.landK || 0) + v / 4.4);
          P.landV = (P.landV || 0) - v * 0.9;
          P.recoil.v += v * 0.35; P.jolt.v += v * 0.35;
          if (audio && audio.step && v > 0.8) audio.step(true, U.clamp(v / 3, 0.6, 1.4), 1, P.lastStepSide);
          if (fx && fx.onStep && v > 1.2) fx.onStep(P.pos, P.lastStepSide);
          if (v > 4.2 && active) P.stamina = Math.max(0, P.stamina - 1.5);
          P._air = null;
        }
      }
      /* пружина приседа при приземлении/перелезании (метры просадки таза) */
      {
        const w = 15;
        P.landV = (P.landV || 0) + (-w * w * (P.landDip || 0) - 2 * 0.75 * w * (P.landV || 0)) * dt;
        P.landDip = U.clamp((P.landDip || 0) + P.landV * dt, -0.22, 0.05);
        P.landK = Math.max(0, (P.landK || 0) - dt * 2.5);
      }

      /* наклон корпуса Q/E */
      P.leanWant = active ? ((input.leanL ? -1 : 0) + (input.leanR ? 1 : 0)) : 0;
      P.lean = U.damp(P.lean, P.leanWant * (1 - P.sprint * 0.8), 8, dt);

      /* ------------------------------------------------ шаги и покачивание */
      const moving = P.speed > 0.35 && P.grounded;
      if (moving) {
        /* частота шага растёт со скоростью, но не линейно: под грузом шаг
           длиннее, а не чаще */
        /* каденс из модуля походки: ~2,4 шага/с шагом, ~2,8 — бегом */
        const prev=P.stepPhase;
        if(!P._wasStepping)P.stepPhase=Math.floor(P.stepPhase)+.2;
        const travelled=Math.hypot(P.pos.x-moveStartX,P.pos.z-moveStartZ);
        if(travelled<1.1)P.stepPhase+=travelled/LOCO.strideLength(P);
        P._wasStepping=true;
        P.bobPhase = P.stepPhase * Math.PI * 2;
        /* каждое пересечение половины фазы — касание стопы */
        if (Math.floor(prev * 2) !== Math.floor(P.stepPhase * 2)) {
          const hard = false;
          const vol = U.lerp(0.55, 1.15, U.clamp01(P.speed / PHYS.sprint)) * (1 - P.crouch * 0.45);
          const run = U.clamp01((P.speed - PHYS.walk) / (PHYS.sprint - PHYS.walk));
          /* звук — только у управляемого бойца: камера и шаги на одной фазе;
             касание при stepPhase ≈ 0 — правая нога, ≈ 0,5 — левая */
          const foot = Math.floor(P.stepPhase * 2) % 2 === 0 ? 1 : -1;
          if (!active && P.onAiStep) P.onAiStep(vol, run, foot);
          if (audio && active) { if (P.sfx && P.sfx.B) P.sfx.footstep(run > 0.5, vol); else audio.step(hard, vol, run, foot); }
          /* на бегу дыхание ложится на шаги: вдох на два шага, выдох на два */
          if (audio && active && run > 0.5 && !(P.sfx && P.sfx.B)) {
            P._stepN = (P._stepN || 0) + 1;
            if (P._stepN % 2 === 0) {
              P._inhale = !P._inhale;
              audio.breath(U.lerp(0.45, 1, 1 - P.stamina / PHYS.staminaMax), P._inhale);
              P._breathAcc = 0;
            }
          }
          /* толчок в оружие от шага — то самое ощущение веса */
          { const jv = U.lerp(0.10, 0.34, U.clamp01(P.speed / PHYS.sprint)) * (1 - P.ads * 0.55); P.recoil.v += jv; P.jolt.v += jv; }
          P.lastStepSide *= -1;
          if (fx) fx.onStep && fx.onStep(P.pos, P.lastStepSide);
        }
      } else {
        P.bobPhase = U.damp(P.bobPhase % (Math.PI * 2), 0, 3, dt);
        P._wasStepping=false;
      }

      /* дыхание: после бега — тяжёлое */
      P.breathT += dt * U.lerp(1.0, 2.4, 1 - P.stamina / PHYS.staminaMax);
      if (audio && active && !(P.sfx && P.sfx.B)) {
        /* вне бега — по таймеру: спокойно и тихо, после бега — часто и
           громко, пока не восстановится выносливость; вдох и выдох чередуются */
        const fat = 1 - P.stamina / PHYS.staminaMax;
        const running = moving && P.speed > PHYS.walk + 0.5 * (PHYS.sprint - PHYS.walk);
        P._breathAcc = (P._breathAcc || 0) + dt;
        const half = fat > 0.15 ? U.lerp(1.2, 0.5, fat) : 1.9;
        if (!running && P._breathAcc > half) {
          P._breathAcc = 0;
          P._inhale = !P._inhale;
          audio.breath(fat > 0.15 ? U.lerp(0.3, 1, fat) : 0.14, P._inhale);
        }
        if (audio.motion) audio.motion(P.grounded ? P.speed / PHYS.sprint : 0);
      }
    };

    /* ======================================================= прицел ==== */
    /* Взгляд: мышь двигает yaw/pitch, а оружие следует с запаздыванием. */
    P.look = function (dx, dy, sens) {
      const k = sens * (1 - P.ads * 0.55);       // в прицеле чувствительность ниже
      P.yaw -= dx * k;
      P.pitch = U.clamp(P.pitch - dy * k, -1.35, 1.32);
      /* инерция оружия: резкий поворот «уводит» ствол в сторону */
      P.sway.vx += dx * k * 22 * (TR.sway || 1);
      P.sway.vy += dy * k * 18 * (TR.sway || 1);
    };

    /* ====================================================== стрельба === */
    P.canFire = function () {
      return P.armed && !P.vault && !P.dragging && !P.treating && P.fireMode !== 'safe' && P.reload < 0 && P.inspect < 0 && P.cool <= 0
        && P.chamber > 0 && P.pump < 0 && P.sprint < 0.55 && !P.jam;
    };
    const ev = (name) => { if (P.onEvent) P.onEvent(name); };
    const syncAmmo = () => { P.ammo = P.mag + P.chamber; };
    P.syncAmmo = syncAmmo;

    /* Оружие в руках (GGuns) или null — без оружия. st — сохранённое
       состояние этого экземпляра: { mag, chamber, reserve, fireMode }. */
    P.setWeapon = function (w, st) {
      P.reload = -1; P.reloadPlan = null; P.reloadStop = false; P.pump = -1;
      P.triggerHeld = false; P.semiLatch = false; P.inspect = -1;
      P.weapon = w || null;
      P.armed = !!w;
      if (P.vr) { P.vr.reset(); if (w) P.vr.setProfile(w); }
      P.jam = null;
      /* v8: передняя рукоятка / упор — опорная рука жёстче держит цевьё */
      P.gripK = 0;
      try { const fg = w && w.asm && w.asm.installed && w.asm.installed.get('under'); if (fg) P.gripK = /handstop|afg|kag/i.test(String(fg.id || fg.def && fg.def.id || '')) ? 0.45 : 0.7; } catch (e) { /* */ }
      if (!w) { P.wid = null; P.mag = 0; P.chamber = 0; P.reserve = 0; P.boltOpen = false; syncAmmo(); return; }
      const s = w.stats, wp = w.wp || {};
      P.wid = w.id;
      P.tube = s.feed === 'tube';
      P.magCap = s.magCap;
      P.boltHold = !!s.boltHold;
      const kV = (wp.recoil || 1) * (s.recoilV || 100) / 100, kH = (wp.recoil || 1) * (s.recoilH || 100) / 100;
      const pistol = w.fam === 'pistol';
      const GG = (typeof self !== 'undefined' ? self : globalThis).GGuns;
      const RPF = (GG && GG.RECOIL_PROFILE && GG.RECOIL_PROFILE[w.id]) || {};
      Object.assign(WPN, {
        rpm: s.rpm, magDefault: s.magCap,
        adsTime: U.clamp((s.adsTime || 0.3) * 0.9, 0.16, 0.55) * (TR.ads || 1),
        muzzleVel: s.v0,
        recoilUp: WPN0.recoilUp * kV, recoilSide: WPN0.recoilSide * kH, recoilBack: WPN0.recoilBack * Math.min(1.8, 0.6 + 0.4 * kV),
        /* v11: винтовки ×1,18 — очередь заметнее уводит прицел (просьба игроков: «отдача слабо чувствуется») */
        kickPitch: WPN0.kickPitch * kV * (pistol ? 2.3 : 1.18), kickYaw: WPN0.kickYaw * kH * (pistol ? 1.3 : 1),
        recover: pistol ? 0.86 : WPN0.recover,
        /* характер образца (GGuns.RECOIL_PROFILE): увод в сторону, рост очереди, скорость возврата */
        yawBias: RPF.climbYawBias || 0, burstGrow: RPF.burstGrow ?? 0.45, recoverRate: RPF.rateM || 1,
        patSeed: [...String(w.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 997, 7) * 0.013,
        spreadHip: pistol ? 0.030 : (w.fam === 'pump' ? 0.034 : (w.id === 'mp5a3' ? 0.034 : WPN0.spreadHip)),
        spreadAds: (0.0006 + (s.moa || 2) * 0.00029) * (pistol ? 1.8 : 1),
        reloadTime: (w.spec && w.spec.reloadTime && w.spec.reloadTime[0]) || 2.45,
        reloadEmpty: (w.spec && w.spec.reloadTime && w.spec.reloadTime[1]) || 3.05
      });
      P.fireModes = s.modes.slice();
      const first = P.fireModes.find((m) => m !== 'safe') || P.fireModes[0];
      P.fireMode = st && P.fireModes.includes(st.fireMode) ? st.fireMode : first;
      P.mag = st ? st.mag : 0;
      P.chamber = st ? st.chamber : 0;
      P.reserve = st ? st.reserve : 0;
      P.boltOpen = !!(st && st.boltOpen);
      syncAmmo();
    };
    P.weaponState = function () {
      return { mag: P.mag, chamber: P.chamber, reserve: P.reserve, fireMode: P.fireMode, boltOpen: P.boltOpen };
    };

    P.pullTrigger = function (down) {
      P.triggerHeld = down;
      if (!down) P.semiLatch = false;
    };

    P.cycleFireMode = function () {
      if (!P.armed || P.fireModes.length < 2) return P.fireMode;
      const i = P.fireModes.indexOf(P.fireMode);
      P.fireMode = P.fireModes[(i + 1) % P.fireModes.length];
      if (P.onEvent) ev('selector'); else if (audio) audio.selector();
      return P.fireMode;
    };

    /* Перезарядка. Коробчатый магазин: смена целиком (с патроном в
       патроннике — быстрее, с пустым — с досыланием). Помпа: патроны по
       одному в трубку, при пустом патроннике в конце — передёргивание;
       нажатие спуска прерывает после текущего патрона. Дорожку (время и
       события) даёт спека рига: P.trackFor(kind, n, pumpAfter). */
    P.startReload = function () {
      /* v8: задержка — R устраняет её (недосыл/«труба» — «хлопнул-передёрнул»,
         двойная подача — магазин вон, передёрнуть, магазин на место) */
      if (P.jam && P.reload < 0) return P.startClear();
      if (!P.armed || P.reload >= 0 || P.reserve <= 0 || P.pump >= 0) return false;
      if (P.tube) {
        const room = P.magCap - P.mag;
        if (room <= 0) return false;
        const n = Math.min(room, P.reserve), pumpAfter = !P.chamber;
        const tr = P.trackFor ? P.trackFor('tube', n, pumpAfter) : null;
        P.reloadPlan = { tube: true, n, pumpAfter, track: tr, dur: tr ? tr.duration : 0.6 * n + 0.6, speed: 1, ei: 0, loaded: 0 };
      } else {
        if (P.mag >= P.magCap && P.chamber) return false;
        const empty = !P.chamber;
        const dur = empty ? WPN.reloadEmpty : WPN.reloadTime;
        const tr = P.trackFor ? P.trackFor(empty ? 'empty' : 'tactical') : null;
        P.reloadPlan = { tube: false, track: tr, dur, speed: tr ? tr.duration / dur : 1, ei: 0 };
      }
      P.reloadWasEmpty = !P.chamber;
      P.reloadStop = false;
      P.reload = 0;
      P.reloadCues = 0;
      P.ads = Math.min(P.ads, 0.2);
      return true;
    };
    /* события дорожки перезарядки -> патроны */
    function reloadStep(dt) {
      const R = P.reloadPlan;
      const t0 = P.reload * R.speed;
      P.reload += dt * (TR.reload || 1) / (1 + 0.6 * Math.min(1.5, P.armK || 0) + 0.3 * (P.shockK || 0));
      const t1 = P.reload * R.speed;
      const evs = (R.track && R.track.events) || [];
      for (const [t, e] of evs) {
        if (!(t > t0 && t <= t1)) continue;
        if (R.tube && e === 'shellIn') {
          if (P.reserve > 0 && P.mag < P.magCap) { P.mag++; P.reserve--; R.loaded++; }
          /* спуск во время снаряжения — остановиться после этого патрона */
          if (P.reloadStop && R.loaded < R.n && P.trackFor) {
            const tr = P.trackFor('tube', R.loaded, R.pumpAfter);
            R.track = tr; R.n = R.loaded; R.dur = tr.duration;
            P.reloadTrackChanged = (P.reloadTrackChanged || 0) + 1;
            break;
          }
        }
        if (e === 'pumpFwd' && !P.chamber && P.mag > 0) { P.mag--; P.chamber = 1; }
      }
      if (P.reload >= R.dur) {
        if (R.clear) finishClear();
        else if (!R.tube) {
          P.reserve += P.mag;                       // остаток старого магазина — в подсумок
          const take = Math.min(P.magCap, P.reserve);
          P.mag = take; P.reserve -= take;
          if (!P.chamber && P.mag > 0) { P.mag--; P.chamber = 1; }
          P.boltOpen = false;
          if (P.vr && P.vr.unlock) P.vr.unlock();
        }
        P.reload = -1; P.reloadPlan = null; P.reloadStop = false;
      }
      syncAmmo();
    }

    /* ---------------------------------------- v8: задержки (хардкор) ---
       Включаются настройкой P.hardcore. Типы:
         ftf — недосыл/осечка: курок щёлкнул, выстрела нет;
         stovepipe — «печная труба»: гильза зажата затвором в окне, рама
           не дошла — следующего выстрела нет;
         double — двойная подача: два патрона уткнулись в патронник.
       Устранение (R): «хлопнул-передёрнул» ~1,3 с (патрон из патронника
       летит на землю), двойная подача — магазин вон, 2–3 раза передёрнуть,
       магазин на место, дослать (~4 с). */
    P.hardcore = false;
    P.jam = null;
    P.startClear = function () {
      if (!P.jam || P.reload >= 0) return false;
      const dbl = P.jam.type === 'double';
      const tr = P.trackFor ? P.trackFor(dbl ? 'clear_double' : 'clear') : null;
      const dur = (dbl ? (WPN.reloadEmpty || 3.05) + 0.6 : 1.35);
      P.reloadPlan = { tube: false, clear: true, track: tr, dur, speed: tr ? tr.duration / dur : 1, ei: 0 };
      P.reloadWasEmpty = false; P.reloadStop = false;
      P.reload = 0; P.reloadCues = 0;
      P.ads = Math.min(P.ads, 0.2);
      ev('clearStart');
      return true;
    };
    function finishClear() {
      const J = P.jam;
      /* осечный патрон и лишний при двойной подаче — на землю; при
         «трубе» гильза вылетает, а патрон досылается */
      if (J && (J.type === 'ftf' || J.type === 'double')) P.chamber = 0;
      if (!P.chamber && P.mag > 0) { P.mag--; P.chamber = 1; }
      P.jam = null;
      ev('clearEnd');
    }
    function rollJam(when) {
      if (!P.hardcore || !P.vr || !P.vr.jamChance) return null;
      /* полевые условия хардкора: россыпь патронов, нечищеное оружие —
         настрел на задержку в ~2,5 раза ниже паспортного */
      const p = P.vr.jamChance({ wet: P.wet || 0, mud: P.mud || 0 }) * 2.5;
      if (Math.random() >= p) return null;
      const type = P.vr.jamType(Math.random());
      /* недосыл — до выстрела, «труба» и двойная подача — после */
      if ((type === 'ftf') !== (when === 'pre')) return null;
      return { type, t: 0, racked: false };
    }
    P.sightSwap = function () { P.ads = Math.min(P.ads, 0.5); };
    P.startInspect = function () {
      if (P.reload >= 0 || P.inspect >= 0) return false;
      P.inspect = 0;
      return true;
    };

    /* Текущий разброс: от бедра большой, в прицеле малый, движение и
       очередь добавляют. */
    P.currentSpread = function () {
      const base = U.lerp(WPN.spreadHip, WPN.spreadAds, U.smoothstep(P.ads));
      const move = WPN.spreadMove * U.clamp01(P.speed / PHYS.sprint) * (1 - P.ads * 0.5);
      /* лёжа разброс меньше ещё на треть; ранение руки — больше */
      const crouchK = (1 - P.crouch * 0.28) * (1 - (P.prone || 0) * 0.35) * (1 + (P.armK || 0) * 0.9 * (TR.fract || 1) + (P.stun || 0) * 0.4 + (P.shockK || 0) * 0.5);
      const burst = P.shotsInBurst * 0.0018 * (1 - P.ads * 0.45);
      const tired = (1 - P.stamina / PHYS.staminaMax) * 0.006;
      /* v7: подавление (пули рядом) — руки «гуляют» */
      const sup = (P.sup || 0) * 0.012 * (1 - P.ads * 0.4);
      /* v8: перегретый ствол «разносит» — кучность падает выше ~200 °C */
      const heat = P.vr && P.vr.heatSpread ? P.vr.heatSpread() : 1;
      return (base * heat + move + burst + tired + sup) * crouchK;
    };

    P.update = function (dt, input, active, now) {
      P.updateMove(dt, input, active);

      /* --- таймеры --- */
      if (P.cool > 0) P.cool -= dt;
      if (now - P.lastShot > 0.30) P.shotsInBurst = U.damp(P.shotsInBurst, 0, 5, dt);

      /* --- перезарядка (звуки — по событиям рига рук) --- */
      if (P.reload >= 0 && P.reloadPlan) reloadStep(dt);
      else if (P.reload >= 0) P.reload = -1;

      /* --- помпа: после выстрела цевьё назад-вперёд, досылание из трубки --- */
      if (P.pump >= 0) {
        P.pump += dt;
        const T = WPN.pumpT || [0.16, 0.30, 0.46];
        if (P.pumpEv === 0 && P.pump >= T[0]) { P.pumpEv = 1; ev('pumpBack'); }
        if (P.pumpEv === 1 && P.pump >= T[1]) {
          P.pumpEv = 2; ev('pumpFwd');
          if (!P.chamber && P.mag > 0) { P.mag--; P.chamber = 1; }
          syncAmmo();
        }
        if (P.pump >= T[2]) { P.pump = -1; P.pumpEv = 0; }
      }

      if (P.inspect >= 0) {
        P.inspect += dt;
        if (P.inspect > 2.3) P.inspect = -1;
      }
      /* v8: усталость — для тремора и раскачки при отдаче */
      if (P.vr) {
        P.vr.fatigue = U.clamp01((1 - P.stamina / PHYS.staminaMax) * 1.15 + (P.exhausted ? 0.25 : 0));
        /* самовоспламенение патрона в перегретом патроннике (хардкор) */
        if (P.hardcore && P.chamber > 0 && !P.triggerHeld && !P.tube && P.vr.cookRate && P.reload < 0 && !P.jam) {
          const rr = P.vr.cookRate();
          if (rr > 0 && now - P.lastShot > 3 && Math.random() < rr * dt) { P.cookOff = (P.cookOff || 0) + 1; ev('cookOff'); P.fire(now); }
        }
      }

      /* --- автоматический огонь --- */
      if (active && P.triggerHeld && P.armed) {
        /* помпа: спуск во время снаряжения трубки — остановить после патрона */
        if (P.reload >= 0 && P.reloadPlan && P.reloadPlan.tube && !P.semiLatch) { P.reloadStop = true; P.semiLatch = true; }
        if (P.fireMode === 'auto' || ((P.fireMode === 'semi' || P.fireMode === 'pump') && !P.semiLatch)) {
          if (P.canFire()) {
            P.semiLatch = true;
            const J = rollJam('pre');
            if (J) {
              /* осечка/недосыл: удар курка — и тишина */
              P.jam = J; P.cool = 0.25;
              ev('dryFire'); ev('jam');
            } else P.fire(now);
          } else if (P.jam && !P.semiLatch) {
            P.semiLatch = true;
            ev('dryFire');
          } else if (!P.chamber && P.cool <= 0 && P.reload < 0 && P.pump < 0 && !P.semiLatch) {
            P.semiLatch = true;
            if (P.onEvent) ev('dryFire'); else if (audio) audio.dryFire();
            P.cool = 0.22;
          }
        } else if (P.fireMode === 'safe' && !P.semiLatch) {
          P.semiLatch = true;
          if (P.onEvent) ev('dryFire'); else if (audio) audio.dryFire();
        }
      }

      /* --- затухание динамики --- */
      /* Пружины: отдача возвращается к нулю, но не мгновенно. */
      U.spring(P.recoil, 0, 21, dt, 0.62);
      U.spring(P.jolt, 0, 21, dt, 0.62);
      if (P.vr) P.vr.update(dt);
      U.spring(P.recoilYaw, 0, 19, dt, 0.7);
      U.spring(P.recoilBack, 0, 24, dt, 0.8);

      /* Возврат наводки после очереди: как только стрелок отпустил спуск
         (или между выстрелами), ствол сам опускается к исходной точке.
         Возвращается не весь уведённый угол — остаток и есть «уход» очереди. */
      if (P.kickPend && (P.kickPend.p !== 0 || P.kickPend.y !== 0)) {
        const kq = 1 - Math.exp(-dt / 0.022);
        const pp = P.kickPend.p * kq, py = P.kickPend.y * kq;
        P.pitch = U.clamp(P.pitch + pp, -1.35, 1.32); P.yaw += py;
        P.kickPend.p -= pp; P.kickPend.y -= py;
        if (Math.abs(P.kickPend.p) < 1e-6 && Math.abs(P.kickPend.y) < 1e-6) P.kickPend.p = P.kickPend.y = 0;
      }
      if (P.kickBack.p !== 0 || P.kickBack.y !== 0) {
        /* v8: стрелок начинает «давить» вскид не сразу — задержка реакции
           ~0,15–0,2 с от начала очереди, дальше мышцы «садятся» на оружие:
           первые 3–4 выстрела уходят выше, затем очередь ровнее */
        const since = now - (P.burstT0 !== undefined ? P.burstT0 : now);
        const react = P.triggerHeld ? U.lerp(0.35, 1.3, U.smoothstep(U.clamp01((since - 0.16) / 0.3))) : 1;
        /* v10: при зажатом спуске стрелок «тянет вниз» медленнее (3,0 → 2,0/с):
           очередь заметно ползёт вверх, её надо компенсировать мышью */
        const rate = (P.triggerHeld ? 2.0 : 9.0) * react * (WPN.recoverRate || 1) * (1 - 0.25 * (P.vr ? P.vr.fatigue || 0 : 0));
        const k = 1 - Math.exp(-rate * dt);
        const dp = P.kickBack.p * k, dy = P.kickBack.y * k;
        P.pitch = U.clamp(P.pitch - dp, -1.35, 1.32);
        P.yaw -= dy;
        P.kickBack.p -= dp;
        P.kickBack.y -= dy;
        if (Math.abs(P.kickBack.p) < 1e-5) P.kickBack.p = 0;
        if (Math.abs(P.kickBack.y) < 1e-5) P.kickBack.y = 0;
      }
      /* инерция наводки */
      /* v13: раненая рука, боль и кровопотеря — оружие дрожит и «плавает» */
      {
        const tr = (P.armK || 0) * 0.55 + (P.shockK || 0) * 0.6 + (P.stun || 0) * 0.25 + Math.min(1, P.painK || 0) * 0.15;
        if (tr > 0.01) {
          P._trT = (P._trT || 0) + dt;
          const t = P._trT;
          P.sway.vx += (Math.sin(t * 7.3) + Math.sin(t * 12.9 + 1.7) * 0.6 + (Math.random() - 0.5) * 0.8) * tr * 0.9 * dt * 60 * 0.01;
          P.sway.vy += (Math.sin(t * 5.1 + 0.4) + Math.sin(t * 15.7) * 0.5 + (Math.random() - 0.5) * 0.8) * tr * 0.7 * dt * 60 * 0.01;
        }
      }
      P.sway.vx += -P.sway.x * 130 * dt - P.sway.vx * 14 * dt;
      P.sway.vy += -P.sway.y * 130 * dt - P.sway.vy * 14 * dt;
      P.sway.x += P.sway.vx * dt;
      P.sway.y += P.sway.vy * dt;
      P.sway.x = U.clamp(P.sway.x, -0.12, 0.12);
      P.sway.y = U.clamp(P.sway.y, -0.10, 0.10);

      P.spread = P.currentSpread();
    };

    /* Выстрел: расход патрона, отдача, эффекты и трассировка пули. */
    P.fire = function (now) {
      /* патрон из патронника; следующий досылается из магазина (у помпы —
         передёргиванием); последний — затвор на задержку (если она есть) */
      P.chamber = 0;
      if (P.tube) { P.pump = 0; P.pumpEv = 0; }
      else if (P.mag > 0) { P.mag--; P.chamber = 1; }
      else P.boltOpen = !!P.boltHold;
      syncAmmo();
      /* v8: темп «живой» — ±3 % от выстрела к выстрелу (трение, нагар, патроны) */
      P.cool = 60 / WPN.rpm * (1 + (Math.random() - 0.5) * 0.06);
      if (now - P.lastShot > 0.3) P.burstT0 = now;
      P.lastShot = now;
      P.shots++;
      P.shotsInBurst = Math.min(12, P.shotsInBurst + 1);
      /* номер выстрела в очереди (целый): по нему идёт ФИКСИРОВАННЫЙ рисунок отдачи */
      P.burstIdx = (now - (P._prevShot || -9) > 0.3) ? 0 : Math.min(40, (P.burstIdx || 0) + 1);
      P._prevShot = now;

      /* Импульс отдачи: слабее с упором в плечо (прицел) и в приседе,
         сильнее к концу очереди — ствол «разносит». */
      const stab = (1 - P.ads * 0.26) * (1 - P.crouch * 0.14) * (1 - (P.prone || 0) * 0.3)
        * (1 + 0.18 * (P.vr ? P.vr.fatigue || 0 : 0)) * (1 - 0.06 * (P.gripK || 0));
      const burst = U.lerp(1, 1 + (WPN.burstGrow ?? 0.45), U.clamp01(P.shotsInBurst / 9)) * ((P.trait && P.trait.recoil) || 1);
      P.recoil.v += WPN.recoilUp * 68 * stab * burst;
      /* видимый увод оружия — по тому же рисунку, без «броуновского» дрожания */
      {
        const n = P.burstIdx || 0, RS = WPN.patSeed || 0;
        P.recoilYaw.v += (Math.sin(n * 0.62 + RS + 0.6) * 0.8 + (Math.random() - 0.5) * 0.15) * 0.5 * WPN.recoilSide * 95 * stab * burst;
      }
      P.recoilBack.v += WPN.recoilBack * 32 * stab;
      /* v7: видимая отдача — по физике образца (импульс, масса, ось канала,
         дульное устройство) и фазам выстрела; на баллистику не влияет */
      if (P.vr) P.vr.fire({
        burstIdx: P.burstIdx || 0, ads: P.ads, crouch: P.crouch, prone: P.prone || 0,
        moving: U.clamp01((P.speed - 0.4) / (PHYS.walk || 2.5)), bipod: !!P.bipod,
        trait: (P.trait && P.trait.recoil) || 1,
        /* v8: последний патрон (рама встаёт на задержку), хват, усталость */
        last: !P.tube && P.chamber === 0, grip: P.gripK || 0, fatigue: P.vr.fatigue || 0,
        auto: P.fireMode === 'auto' || P.fireMode === 'burst'
      });

      /* Сбив наводки. Копим уведённый угол отдельно, чтобы потом частично
         вернуть его назад: стрелок компенсирует отдачу, но не полностью —
         очередь всё равно ползёт вверх. */
      /* Рисунок отдачи ПОСТОЯННЫЙ для образца (как «спрей» в CS или
         паттерн в Tarkov/Insurgency): первые выстрелы — почти вертикально,
         дальше ствол плавно гуляет влево-вправо вокруг своего увода
         (yawBias). Случайная добавка — ±8 %, её даёт разброс (spread), а не
         сам рисунок, — поэтому очередь можно выучить и компенсировать мышью. */
      const n = P.burstIdx || 0;
      const RS = WPN.patSeed || 0;
      const pv = 1.0 + 0.35 * Math.exp(-n * 0.9) - 0.12 * U.clamp01((n - 6) / 8);    // первый «вскид» сильнее
      const kp = WPN.kickPitch * stab * burst * pv * (1 + (Math.random() - 0.5) * 0.08);
      const yb = WPN.yawBias || 0;
      const sway = U.clamp01((n - 1) / 4) * (Math.sin(n * 0.62 + RS) * 0.75 + Math.sin(n * 1.37 + RS * 2.3) * 0.25);
      const ky = U.clamp(yb * U.clamp01(n / 3) + sway * (1 - Math.abs(yb) * 0.5), -1.4, 1.4) * WPN.kickYaw * stab * burst
        * (1 + (Math.random() - 0.5) * 0.08);
      /* v9: сбив наводки вносится не скачком за один кадр, а за ~25–40 мс
         (как идёт сам импульс отдачи): раньше прицел и марка «прыгали» на
         каждый выстрел, а камера догоняла их пружиной. Сумма угла прежняя. */
      P.kickPend = P.kickPend || { p: 0, y: 0 };
      P.kickPend.p += kp; P.kickPend.y += ky;
      P.kickBack.p += kp * WPN.recover;
      P.kickBack.y += ky * WPN.recover;

      if (P.onFire) P.onFire();
      /* v8: «печная труба» / двойная подача — после выстрела рама не дошла */
      if (!P.tube) {
        const J = rollJam('post');
        if (J) { P.jam = J; ev('jam'); }
      }
    };

    {
      const GR = (typeof self !== 'undefined' ? self : globalThis).GRecoil;
      if (GR) P.vr = GR.create();
    }
    P.PHYS = PHYS;
    P.trait = TR;
    P.WPN = WPN;
    return P;
  }

  return { create, PHYS: PHYS0, WPN: WPN0 };
});