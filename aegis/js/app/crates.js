/* AEGIS · ящики с боеприпасами и двери на картах боя.
   Короткое нажатие F (< 0.25 с, см. doAction 'use' в 29_game.js) рядом с дверью переключает её,
   рядом с ящиком — открывает ту же оружейную, что и в паузе (ui.js: AEGIS_UI.openCrate).
   Удержание F остаётся «вселиться / выйти из тела». Дверь приоритетнее ящика. */
(function (root) {
  'use strict';
  const DOOR_R = 2.0, DY = 2.6, SCAN = 0.1, TAP_MS = 300;
  const st = { t: SCAN, near: null, out: null };
  const OUT_DOOR = { lbl: 'ДВЕРЬ', sub: 'коротко нажмите F' };
  const OUT_MG = { lbl: 'ПУЛЕМЁТ M2HB', sub: 'коротко нажмите F — занять место' };
  const OUT_MG_OFF = { lbl: 'ПУЛЕМЁТ M2HB', sub: 'F — оставить, ЛКМ — огонь' };
  const OUT_CRATE = { lbl: 'ЯЩИК: ВООРУЖЕНИЕ', sub: 'коротко нажмите F' };

  function scan(world, p) {
    const mgN = root.GMG && root.GMG.nearest(world, p);
    if (mgN) return { kind: 'mg', N: mgN };
    const nat = world.native;
    if (nat && nat.doorNear) {
      const L = nat.doorNear(p.x, p.y, p.z, DOOR_R);
      if (L) return { kind: 'door', L };
    }
    let best = null, bd = Infinity;
    for (const c of world.crates || []) {
      if (c.kind !== 'ammo' || Math.abs(c.y - p.y) > DY) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d <= (c.r || 2) && d < bd) { bd = d; best = c; }
    }
    return best ? { kind: 'crate', c: best } : null;
  }

  /* вызывается из updateUse; a — управляемый боец (или null); возвращает подсказку или null */
  function update(dt, S, world, a) {
    if (!a || !a.ctrl || !world || !world.mapId) { st.near = null; S.fTap = 0; return null; }
    if (root.GMG && root.GMG.isMounted(a)) {
      const tapped = S.fTap && performance.now() - S.fTap < TAP_MS;
      S.fTap = 0;
      if (tapped) { root.GMG.dismount(a); return null; }
      return OUT_MG_OFF;
    }
    if ((st.t += dt) >= SCAN) { st.t = 0; st.near = scan(world, a.ctrl.pos); }
    const near = st.near;
    if (S.fTap) {
      const fresh = performance.now() - S.fTap < TAP_MS;
      S.fTap = 0;
      if (fresh && near) {
        if (near.kind === 'mg') {
          root.GMG.mount(a, near.N); st.near = null; return OUT_MG_OFF;
        }
        if (near.kind === 'door') {
          try { world.native.toggleDoor(near.L, a.ctrl.pos); } catch (e) { console.warn('door', e && e.message); }
        } else if (root.AEGIS_UI && root.AEGIS_UI.openCrate) {
          root.AEGIS_UI.openCrate();
          st.near = null;
          return null;
        }
      }
    }
    return near ? (near.kind === 'mg' ? OUT_MG : near.kind === 'door' ? OUT_DOOR : OUT_CRATE) : null;
  }

  root.GCrates = { update, scan };
})(typeof self !== 'undefined' ? self : this);
