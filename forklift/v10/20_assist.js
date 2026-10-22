/* ===== v10 · простой захват поддона ===== */
V10.assist.range = { x: 0.7, z: [-2.2, 0.4], angle: 20 * be };
V10.assist.target = function () {
  const n = CargoEngine.nearest();
  if (!n || SIM.held || !n.a.spacingOK) return null;
  const a = n.a, r = V10.assist.range;
  return Math.abs(a.x) < r.x && a.z > r.z[0] && a.z < r.z[1] && a.angle < r.angle ? n : null;
};
V10.assist.run = function (n) {
  const m = He.parts.mast, c = n.c, root = He.root, from = root.position.clone(), yaw0 = root.rotation.y, h0 = PhysicsEngine.snapshot();
  const yawTo = yaw0 + angDiff10(c.obj.rotation.y, yaw0);
  root.rotation.y = yawTo; root.updateMatrixWorld(true);
  const a = CargoEngine.alignment(c), shift = new C(-a.x, 0, -(a.z + 0.02)).applyAxisAngle(new C(0, 1, 0), c.obj.rotation.y);
  const to = from.clone().add(shift);
  root.position.copy(to); root.updateMatrixWorld(true);
  const blocked = collision();
  root.position.copy(from); root.rotation.y = yaw0; root.updateMatrixWorld(true);
  if (blocked) { qh('Рядом препятствие. Подъедьте ровнее.'); return false; }
  V10.assist.busy = true; SIM.speed = 0;
  const t0 = performance.now(), dur = 450;
  const step = now => {
    const k = clamp10((now - t0) / dur, 0, 1), e = k * k * (3 - 2 * k);
    root.position.lerpVectors(from, to, e);
    root.rotation.y = lerp10(yaw0, yawTo, e);
    root.updateMatrixWorld(true);
    if (k < 1) return requestAnimationFrame(step);
    V10.assist.busy = false;
    m.snap(h0.h + (0.08 - n.a.y), h0.tilt);
    root.updateMatrixWorld(true);
    V10.assist.prev();
  };
  requestAnimationFrame(step);
  return true;
};
V10.assist.prev = CargoEngine.interact.bind(CargoEngine);
CargoEngine.interact = function () {
  if (V10.assist.busy) return false;
  if (SIM.held || SIM.mode !== 'cab' || Math.abs(SIM.speed) > 0.06) return V10.assist.prev();
  const n = V10.assist.target();
  if (n && !n.a.ready) return V10.assist.run(n);
  return V10.assist.prev();
};
const hintPrev10 = CargoEngine.hint.bind(CargoEngine);
CargoEngine.hint = function (n = this.nearest()) {
  if (!SIM.held && V10.assist.target()) return 'E — вилы сами встанут ровно и подхватят поддон';
  return hintPrev10(n);
};
