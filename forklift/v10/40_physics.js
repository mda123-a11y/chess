/* ===== v10 · физика: разгон, торможение, занос, крен кузова ===== */
const PH = V10.phys = { aCmd: 0, aLong: 0, aLat: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, slip: 0, brake: false, bump: 0, warned: 0 };
braking = () => 2.4 / (1 + heldMass10() / 6000);
const WB10 = de.wheelbase, VFULL10 = 18 / 3.6;
const approach10 = (x, t, d) => x < t ? Math.min(x + d, t) : Math.max(x - d, t);
const heldMass10 = () => SIM.held ? SIM.held.mass : 0;
const liftH10 = () => He.parts.mast?.state.h ?? 0;
const tiltNode10 = () => He.chassis.parent;

function speedLimit10(throttle) {
  let kmh = throttle < 0 ? 8 : SIM.held ? 9 : 18;
  if (SIM.held) kmh *= 1 - .65 * clamp10((liftH10() - .4) / 2, 0, 1);
  if (SIM.low) kmh = Math.min(kmh, 1.8);
  if (Math.abs(He.root.position.z - xi.crossing.z) < 3) kmh = Math.min(kmh, 6);
  return kmh / 3.6;
}
// Поперечное ускорение ограничено устойчивостью: выше поднят груз и тяжелее он — меньше.
function lateralLimit10() {
  return 3.2 * (1 - .5 * clamp10((liftH10() - .3) / 2.6, 0, 1)) / (1 + heldMass10() / 9000);
}

driveStep = function (dt) {
  if (SIM.mode === 'config' || SIM.mode === 'inspect' || SIM.mode === 'lab' || Dt.mode !== 'cab') { SIM.speed = 0; PH.aCmd = 0; return; }
  const left = De.has('KeyA') || De.has('ArrowLeft'), right = De.has('KeyD') || De.has('ArrowRight'), steering = (right ? 1 : 0) - (left ? 1 : 0);
  const rate = steering ? 5 : 7;
  SIM.steer = ls(SIM.steer, steering * 60 * be, rate, dt); He.setSteerInput(-SIM.steer / (60 * be));
  const throttle = (De.has('KeyW') ? 1 : 0) - (De.has('KeyS') ? 1 : 0), brake = De.has('Space');
  PH.brake = brake;
  if (!throttle && !brake && Math.abs(SIM.speed) < 1e-6) { SIM.speed = 0; PH.aCmd = 0; PH.slip = 0; return; }
  const vlim = speedLimit10(throttle), bk = 1 / (1 + heldMass10() / 6000);
  const old = He.root.position.clone(), yaw = He.root.rotation.y;
  let remaining = dt, slip = 0;
  while (remaining > 1e-6) {
    const step = Math.min(remaining, 1 / 60); remaining -= step;
    const v = SIM.speed;
    let goal, accel;
    if (brake) { goal = 0; accel = 3.2 * bk; }
    else if (throttle) {
      goal = throttle * vlim;
      if (v * throttle < -.02) { goal = 0; accel = 2.6 * bk; }
      else if (Math.abs(v) > vlim + .02) accel = 1.8;
      else accel = 1.9 * bk * (1 - .5 * Math.abs(v) / VFULL10);
    } else { goal = 0; accel = Math.abs(v) < .3 ? 1.2 : .6 + .12 * Math.abs(v); }
    const dir = Math.sign(goal - v), eased = accel * clamp10(Math.abs(goal - v) / .4, .25, 1);
    const target = dir * eased, speeding = !brake && dir === Math.sign(goal) && dir !== 0;
    PH.aCmd = approach10(PH.aCmd, target, (speeding ? 5 : 12) * step);
    let vn = v + PH.aCmd * step;
    if (dir === 0 || (v - goal) * (vn - goal) < 0) { vn = goal; PH.aCmd = 0; }
    SIM.speed = vn;

    const t = Math.abs(Math.tan(SIM.steer)), av = Math.abs(SIM.speed);
    const tmax = av > .05 ? lateralLimit10() * WB10 / (av * av) : Infinity;
    const eff = Math.sign(SIM.steer) * Math.atan(Math.min(t, tmax));
    if (t > tmax) slip = Math.max(slip, 1 - tmax / t);
    if (brake && av > 1.2) slip = Math.max(slip, .6);

    const oldp = He.root.position.clone(), oldy = He.root.rotation.y;
    He.root.rotation.y = integratePose(He.root.position, oldy, SIM.speed, eff, step);
    He.root.updateMatrixWorld(true);
    const hit = collision();
    if (hit) {
      He.root.position.copy(oldp); He.root.rotation.y = oldy;
      const impact = Math.abs(SIM.speed);
      PH.bump = Math.sign(SIM.speed) * impact;
      SIM.speed = -.12 * SIM.speed; PH.aCmd = 0;
      if (SIM.contactT <= 0) { logSim(hit); qh(hit); sound(.15, 120, 0); SIM.contactT = 1; }
      break;
    }
  }
  PH.slip = slip;
  const dy = He.root.rotation.y - yaw; Dt.yaw -= dy;
  for (const w of He.wheels.all || []) w.rollBy(SIM.speed * dt);
  PH.yawRate = dy / dt;
  if (old.distanceToSquared(He.root.position) > 1e-7 || Math.abs(dy) > .0001) SIM.dirty = true;
  if (SIM.held && liftH10() > 1.2 && Math.abs(SIM.speed) > .3 && SIM.clock - PH.warned > 6) { PH.warned = SIM.clock; qh('Груз высоко — скорость ограничена. Опустите вилы для езды.'); }
  if (SIM.options.rule && Math.abs(He.root.position.z - xi.crossing.z) < 3 && Math.abs(SIM.speed) > .7 && !SIM.ruleNoted) { logSim('Учебное правило: подъезд к переходу без остановки'); SIM.ruleNoted = true; }
};

/* кузов качается на шинах: пружина с лёгким демпфированием */
const contactPrev10 = PhysicsEngine.contact.bind(PhysicsEngine);
PhysicsEngine.contact = function () {
  const n = tiltNode10();
  if (Math.abs(PH.pitch) + Math.abs(PH.roll) < 1e-4) return contactPrev10();
  const rx = n.rotation.x, rz = n.rotation.z;
  n.rotation.x = He.phys.pitch; n.rotation.z = 0; n.updateMatrixWorld(true);
  const r = contactPrev10();
  n.rotation.x = rx; n.rotation.z = rz; n.updateMatrixWorld(true);
  return r;
};
let prevV10 = 0;
function bodyDynamics10(dt) {
  const n = tiltNode10(); if (!n) return;
  const a = (SIM.speed - prevV10) / dt; prevV10 = SIM.speed;
  PH.aLong += (clamp10(a, -4, 4) - PH.aLong) * Math.min(1, dt * 10);
  const lat = (PH.yawRate || 0) * SIM.speed; PH.yawRate = 0;
  PH.aLat += (clamp10(lat, -4, 4) - PH.aLat) * Math.min(1, dt * 10);
  const tp = clamp10(-PH.aLong * .006, -.018, .018), tr = clamp10(PH.aLat * .0065, -.02, .02);
  if (PH.bump) { PH.pitchV += PH.bump * .06; PH.rollV += (Math.random() - .5) * Math.abs(PH.bump) * .02; PH.bump = 0; }
  const w = 9, z = .45;
  PH.pitchV += (w * w * (tp - PH.pitch) - 2 * z * w * PH.pitchV) * dt; PH.pitch += PH.pitchV * dt;
  PH.rollV += (w * w * (tr - PH.roll) - 2 * z * w * PH.rollV) * dt; PH.roll += PH.rollV * dt;
  if (Math.abs(PH.pitch) + Math.abs(PH.roll) + Math.abs(PH.pitchV) + Math.abs(PH.rollV) < 1e-5) PH.pitch = PH.roll = PH.pitchV = PH.rollV = 0;
  n.rotation.x = He.phys.pitch + PH.pitch; n.rotation.z = PH.roll;
}
const simAfterPrev10b = simAfter;
simAfter = function (dt) { simAfterPrev10b(dt); bodyDynamics10(dt); };
