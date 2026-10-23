/* AEGIS · стационарные пулемёты (гнёзда M2HB) на картах Лес и Заречье.
   Гнёзда строит оригинальный buildMG из карты (world.mg.nests: станок, мешки, модель; уровни детализации).
   Здесь — только игровая часть: занять/покинуть место (короткое F), сектор обстрела ±75°, угол возвышения,
   темп 520 выстр/мин, лента 100 + запас 300, выстрел через баллистику AEGIS (C.fireMG). */
(function (root) {
  'use strict';
  const ARC = 1.3, RPM = 520, BELT = 100, SEAT_BACK = 0.95, MOUNT_R = 1.7, PITCH_MIN = -0.3, PITCH_MAX = 0.55;
  const st = { mounted: null, by: null, lodT: 0, lastShot: -9 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  const nests = (world) => (world && world.mg && world.mg.nests) || [];
  const seatOf = (N) => ({ x: N.gx - Math.sin(N.face) * SEAT_BACK, z: N.gz - Math.cos(N.face) * SEAT_BACK, y: N.gy });

  function nearest(world, p) {
    let best = null, bd = MOUNT_R;
    for (const N of nests(world)) {
      if (N.dead || Math.abs(p.y - N.gy) > 1.6) continue;
      const s = seatOf(N), d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) { bd = d; best = N; }
    }
    return best;
  }
  const isMounted = (a) => !!(a && st.by === a && st.mounted);

  function mount(a, N) {
    if (!a || !N || st.mounted) return false;
    const c = a.ctrl, s = seatOf(N);
    st.mounted = N; st.by = a; c.mounted = N;
    c.pos.set(s.x, N.gy, s.z);
    c.vel.set(0, 0, 0);
    c.yaw = N.face + Math.PI; c.lagYaw = c.yaw; c.pitch = 0;
    return true;
  }
  function dismount(a) {
    const N = st.mounted;
    if (!N) return;
    const c = (st.by || a).ctrl;
    c.mounted = null;
    const s = seatOf(N);
    c.pos.set(s.x - Math.sin(N.face) * 0.5, N.gy, s.z - Math.cos(N.face) * 0.5);
    st.mounted = null; st.by = null;
  }

  function poseGun(N) {
    N.yawG.rotation.y = N.yaw - N.face;
    N.gunG.rotation.z = N.pitch + N.kick * 0.6;
    N.gunG.position.x = -N.kick * 0.25;
  }

  /* ctx: { C, world, camera, THREE, active } — вызывается каждый кадр боя */
  function update(dt, ctx) {
    const world = ctx.world, list = nests(world);
    if (!list.length) return;
    const cp = ctx.camera.position;
    if ((st.lodT += dt) > 0.3) {
      st.lodT = 0;
      for (const N of list) {
        const d2 = (N.gx - cp.x) ** 2 + (N.gz - cp.z) ** 2;
        const lod = N === st.mounted ? 2 : d2 > 55 * 55 && !N.dead ? 1 : 0;
        if (lod !== N.lod) {
          N.lod = lod;
          for (let li = 0; li < 3; li++) for (const m of N.lodMeshes[li]) m.visible = lod === li;
          if (world.native.mgFarSet) world.native.mgFarSet(N, lod === 1);
        }
      }
    }
    for (const N of list) {
      if (N.kick > 1e-4) { N.kick *= Math.exp(-dt * 18); if (N !== st.mounted) poseGun(N); }
      if (N.flashT > 0) { N.flashT -= dt; if (N.flash) N.flash.visible = N.flashT > 0; }
    }
    const N = st.mounted, a = st.by;
    if (!N) return;
    const c = a.ctrl;
    if ((a.hp !== undefined && a.hp <= 0) || a.dead || ctx.active() !== a) { dismount(a); return; }
    const s = seatOf(N);
    c.pos.set(s.x, N.gy, s.z); c.vel.set(0, 0, 0);
    const rel = clamp(angDiff(c.yaw + Math.PI, N.face), -ARC, ARC);
    c.yaw = N.face + rel - Math.PI;
    c.pitch = clamp(c.pitch, PITCH_MIN, PITCH_MAX);
    N.yaw = N.face + rel; N.pitch = c.pitch;
    poseGun(N);
    const now = performance.now() / 1000;
    if (N.reload > 0) {
      N.reload -= dt;
      if (N.reload <= 0) { const take = Math.min(BELT, N.reserve); N.reserve -= take; N.ammo = take; }
    } else if (c.triggerHeld && now - st.lastShot >= 60 / RPM) {
      if (N.ammo > 0) fire(N, a, ctx, now);
      else if (N.reserve > 0) N.reload = 5;
    }
  }

  function fire(N, a, ctx, now) {
    const T = ctx.THREE;
    st.lastShot = now; N.ammo--; N.kick = 1; N.heat = Math.min(1, (N.heat || 0) + 0.012);
    N.root.updateMatrixWorld(true);
    const from = N.gunG.localToWorld(new T.Vector3(1.3, 0.155, 0));
    const dir = new T.Vector3(); ctx.camera.getWorldDirection(dir);
    const spread = 0.0016 + N.heat * 0.004;
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    if (N.flash) { N.flash.visible = true; N.flashT = 0.05; }
    ctx.C.fireMG(from, dir, a);
  }

  root.GMG = { nearest, mount, dismount, isMounted, update, seatOf, CFG: { ARC, RPM, BELT } };
})(typeof self !== 'undefined' ? self : this);
