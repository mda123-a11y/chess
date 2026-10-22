/* ===== v10 · захват поддона одним нажатием E ===== */
const V3_10 = C;
V10.assist.reach = 9;
// Ближайший поддон: впереди важнее, но берётся любой в радиусе досягаемости.
V10.assist.target = function () {
  if (SIM.held) return null;
  const root = He.root, f = new V3_10(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y)), tip = root.position.clone().addScaledVector(f, 1.2);
  let best = null;
  for (const c of SIM.cargo) {
    const mid = c.obj.localToWorld(new V3_10(0, 0, c.d / 2)), dx = mid.x - tip.x, dz = mid.z - tip.z, d = Math.hypot(dx, dz);
    if (d > V10.assist.reach) continue;
    const score = d + (dx * f.x + dz * f.z < -.5 ? 4 : 0);
    if (!best || score < best.score) best = { c, d, score };
  }
  return best;
};
V10.assist.fitForks = function (c) {
  const x = ee.fork.x, limit = c.w / 2 - .143 - .06;
  if (x + .05 < c.w / 2 - .143 && x > .123) return;
  const want = Math.max(.15, Math.min(.4, Math.min(x, limit)));
  __v4.setSpacing(want * 2);
};
V10.assist.grab = function () {
  const n = V10.assist.target();
  if (!n) { qh('Поддонов рядом нет'); return false; }
  const c = n.c, m = He.parts.mast, root = He.root, from = root.position.clone(), yaw0 = root.rotation.y, h0 = m.state.h, t0v = m.state.tilt;
  SIM.speed = 0; De.clear?.();
  V10.assist.fitForks(c);
  // заезд с той стороны поддона, где стоит машина
  const lp = c.obj.worldToLocal(from.clone()), back = lp.z > c.d / 2;
  const yawTo = yaw0 + angDiff10(c.obj.rotation.y + (back ? Math.PI : 0), yaw0);
  const sideMax = Math.max(0, c.w / 2 - .143 - ee.fork.x - .06), mountW = () => { m.loadMount.updateWorldMatrix(true, false); return m.loadMount.getWorldPosition(new V3_10()); };
  let plan = null, blocked = null;
  // сначала по центру, затем со сдвигом по широкому поддону — вдруг мешает колонна или стеллаж
  for (const k of [0, .5, -.5, 1, -1]) {
    if (k && !sideMax) break;
    root.rotation.y = yawTo; m.snap(h0, 0); root.position.copy(from); root.updateMatrixWorld(true);
    const p = c.obj.worldToLocal(mountW()), off = k * sideMax, goalZ = back ? c.d + .02 : -.02;
    const to = from.clone().add(new V3_10(off - p.x, 0, goalZ - p.z).applyAxisAngle(new V3_10(0, 1, 0), c.obj.rotation.y));
    const hTo = h0 + (.1 - p.y);
    root.position.copy(to); m.snap(hTo, 0); root.updateMatrixWorld(true);
    blocked = collision();
    if (!blocked) { plan = { to, hTo, off }; break; }
  }
  root.position.copy(from); root.rotation.y = yaw0; m.snap(h0, t0v); root.updateMatrixWorld(true);
  if (!plan) { V10.assist.lastBlock = blocked; qh('Не получилось взять: мешает ' + blocked); return false; }
  const { to, hTo, off } = plan;
  V10.assist.busy = true;
  const t0 = performance.now(), dur = 420;
  const step = now => {
    const k = clamp10((now - t0) / dur, 0, 1), e = k * k * (3 - 2 * k);
    root.position.lerpVectors(from, to, e); root.rotation.y = lerp10(yaw0, yawTo, e);
    m.snap(lerp10(h0, hTo, e), lerp10(t0v, 0, e)); root.updateMatrixWorld(true);
    if (k < 1) return requestAnimationFrame(step);
    m.setTarget(hTo); m.setTiltTarget(0); He.updateTiltLinks?.();
    m.loadMount.attach(c.obj); SIM.held = c;
    const px = c.obj.position.x; c.obj.position.set(Math.abs(px) < .02 ? 0 : px, -.1, 0); c.obj.rotation.set(0, 0, 0); SIM.dirty = true; V10.assist.busy = false;
    qh('Поддон взят. R — поднять, V — опустить, E — поставить.');
  };
  requestAnimationFrame(step);
  return true;
};
// Поставить: вилы сами опустятся и выровняются.
V10.assist.release = function () {
  const m = He.parts.mast, c = SIM.held;
  m.snap(m.state.h, 0);
  for (let i = 0; i < 3; i++) {
    c.obj.updateWorldMatrix(true, false);
    const y = c.obj.getWorldPosition(new V3_10()).y;
    if (Math.abs(y - .008) < .003) break;
    m.snap(Math.max(0, m.state.h - y + .008), 0);
  }
  m.setTarget(m.state.h); m.setTiltTarget(0); He.updateTiltLinks?.();
  return V10.assist.prev();
};
V10.assist.prev = CargoEngine.interact.bind(CargoEngine);
CargoEngine.interact = function () {
  if (V10.assist.busy || SIM.mode !== 'cab') return false;
  // зажатая клавиша шлёт повторы: без паузы поддон взялся бы и сразу упал
  const now = performance.now(); if (now - (V10.assist.last || 0) < 900) return false; V10.assist.last = now;
  if (SIM.held) return V10.assist.release();
  return V10.assist.grab();
};
CargoEngine.hint = function () {
  if (SIM.held) return 'E — поставить · R / ↑ — поднять · V / ↓ — опустить';
  const n = V10.assist.target();
  return n ? 'E — взять поддон. Машина сама встанет ровно.' : 'Подъедьте к поддону. R/V — высота вил.';
};
