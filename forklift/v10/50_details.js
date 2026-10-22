/* ===== v10 · детали: узлы погрузчика, швы пола, следы шин ===== */
(function buildDetails10() {
  const rubber = Ut('v10:rubber', { color: 0x16181a, roughness: .92, metalness: 0 });
  const steel = Ut('v10:steel', { color: 0x8c969d, roughness: .38, metalness: .8 });
  const plate = Ut('v10:plate', { color: 0x30363c, roughness: .55, metalness: .5 });
  const red = Ut('v10:tape-red', { color: 0xc4251b, roughness: .35, metalness: .1 });
  const white = Ut('v10:tape-white', { color: 0xe9ecee, roughness: .35, metalness: .1 });
  const b = new xe();
  // ступени для входа с обеих сторон: площадка, рёбра против скольжения, кронштейн
  for (const s of [-1, 1]) {
    b.box(plate, .17, .028, .3, s * .53, .205, -.46);
    for (let i = 0; i < 5; i++) b.box(steel, .15, .008, .018, s * .53, .223, -.58 + i * .06);
    b.box(plate, .03, .1, .22, s * .45, .15, -.46);
    b.box(rubber, .17, .02, .012, s * .53, .205, -.607);
  }
  // задний бампер: резиновые накладки, буксирная плита и палец
  for (const s of [-1, 1]) b.box(rubber, .13, .15, .03, s * .4, .33, -1.385);
  b.box(plate, .24, .13, .02, 0, .3, -1.38);
  b.cyl(steel, .028, .028, .06, 0, .3, -1.41, 'z', 14);
  b.cyl(steel, .04, .04, .012, 0, .3, -1.445, 'z', 14);
  // световозвращающая лента на боках противовеса
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) b.box(i % 2 ? white : red, .006, .05, .055, s * .503, .56, -1.04 - i * .055);
  He.chassis.add(b.build('v10:details'));

  // швы пола раз в 6 м
  const j = new xe(), joint = Ut('v10:joint', { color: 0x585e63, roughness: .95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const len = xi.zMax - xi.zMin, cz = (xi.zMax + xi.zMin) / 2;
  for (let x = -xi.halfX + 6; x < xi.halfX; x += 6) j.box(joint, .014, .002, len, x, .003, cz);
  for (let z = xi.zMin + 6; z < xi.zMax; z += 6) j.box(joint, xi.halfX * 2, .002, .014, 0, .003, z);
  const jm = j.build('v10:floor-joints'); En.add(jm);
})();

/* следы шин: кольцевой буфер полос на полу */
const Marks10 = (() => {
  const N = 320, pos = new Float32Array(N * 12), idx = [];
  for (let i = 0; i < N; i++) { const o = i * 4; idx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3); }
  const geo = new ge(); geo.setAttribute('position', new te(pos, 3)); geo.setIndex(idx);
  const mat = new on({ color: 0x15181a, transparent: true, opacity: .34, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const mesh = new Yt(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 2; En.add(mesh);
  const wheels = [[-.465, 0, .075], [.465, 0, .075], [-.37, -1.25, .06], [.37, -1.25, .06]];
  const prev = wheels.map(() => null), p = new C();
  let head = 0;
  const api = {
    clear() { pos.fill(0); geo.attributes.position.needsUpdate = true; prev.fill(null); head = 0; },
    step() {
      const slip = V10.phys.slip;
      if (slip < .08 || Math.abs(SIM.speed) < .5) { prev.fill(null); return; }
      let dirty = false;
      wheels.forEach(([x, z, hw], i) => {
        He.root.localToWorld(p.set(x, .008, z));
        const q = prev[i];
        if (!q) { prev[i] = p.clone(); return; }
        const dx = p.x - q.x, dz = p.z - q.z, l = Math.hypot(dx, dz);
        if (l < .1) return;
        const nx = -dz / l * hw, nz = dx / l * hw, o = head * 12;
        pos.set([q.x + nx, .008, q.z + nz, q.x - nx, .008, q.z - nz, p.x + nx, .008, p.z + nz, p.x - nx, .008, p.z - nz], o);
        head = (head + 1) % N; prev[i].copy(p); dirty = true;
      });
      if (dirty) geo.attributes.position.needsUpdate = true;
    }
  };
  return api;
})();
const simAfterPrev10c = simAfter;
simAfter = function (dt) { simAfterPrev10c(dt); Marks10.step(); };
const resetScenePrev10 = resetScene;
resetScene = function () { resetScenePrev10(); Marks10.clear(); V10.phys.aCmd = 0; };
