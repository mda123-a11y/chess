/* AEGIS teams: rosters, roles, lives/respawns, flags, win rules, bot grenades, LOD.
   Pure rules are exported for Node tests (tools/ai-tests/teams.cjs); the runtime part is
   attached from 29_game.js step() through GTeams.init(ctx) and only runs on battle maps. */
(function (root, factory) {
  const M = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  else root.GTeams = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const TEAMS = ['delta', 'alpha'];
  const other = (t) => (t === 'alpha' ? 'delta' : 'alpha');

  const CFG = {
    respawns: { soldier: 2, general: 3 },       // respawns after the first life
    respawnPoints: { soldier: 2, general: 3 },  // places per team
    protectSec: 4,                              // spawn protection, ends on first shot
    captureSec: 12, captureRadius: 4, captureDy: 3,
    grenade: { min: 12, max: 30, cooldown: 9, allyClear: 7, selfClear: 9, flashMax: 24 },
    maps: {
      angar_map: { perGeneral: 5 },
      forest_map_camp: { perGeneral: 15 },
      stroyka_zarechye_v2: { perGeneral: 15 }
    }
  };

  /* ------------------------------------------------------------ random -- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rr = (r, a, b) => a + (b - a) * r();

  /* ------------------------------------------------------------ roster -- */
  /* push / follow / guard thirds of every general's detachment; 15 per general -> 5/5/5,
     5 per general (Angar) -> 2/2/1 */
  function roleFor(i, n) {
    const push = Math.ceil(n / 3), follow = Math.ceil((n - push) / 2);
    return i < push ? 'push' : i < push + follow ? 'follow' : 'guard';
  }
  function rosterSpec(mapId) {
    const cfg = CFG.maps[mapId];
    if (!cfg) return null;
    const out = [];
    for (const team of TEAMS) {
      for (let g = 1; g <= 2; g++) {
        out.push({ key: team + '_' + g, team, general: true, role: 'lead', leader: null, lives: CFG.respawns.general, index: g - 1 });
      }
      for (let g = 1; g <= 2; g++) {
        for (let i = 0; i < cfg.perGeneral; i++) {
          const number = (g - 1) * cfg.perGeneral + i;
          out.push({
            key: team + '_soldier_' + number, preset: team + '_' + (number % 2 + 1), npc: true, team, general: false,
            role: roleFor(i, cfg.perGeneral), leader: team + '_' + g, lives: CFG.respawns.soldier, index: i, number,
            capturer: i % 2 === 0
          });
        }
      }
    }
    return out;
  }
  function countBy(spec) {
    const c = {};
    for (const s of spec) {
      const k = s.team + (s.general ? ':general' : ':' + s.role);
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }

  /* ------------------------------------------------------------- layout -- */
  /* env: { bounds, heightAt(x,z), ok(x,z,pad) } ; used: [{x,z,r}] */
  function freePoint(env, cx, cz, rMin, rMax, rand, used, sep) {
    for (let round = 0; round < 3; round++) {
      const hi = rMax * (1 + round * 0.7);
      for (let k = 0; k < 90; k++) {
        const r = rMin + (hi - rMin) * Math.sqrt(rand()), a = rand() * TAU;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (!env.ok(x, z, 0.5)) continue;
        let clash = false;
        for (let i = 0; i < used.length; i++) {
          const u = used[i];
          if (Math.hypot(x - u.x, z - u.z) < (u.r || sep)) { clash = true; break; }
        }
        if (!clash) return { x, z };
      }
    }
    return null;
  }
  const unit = (dx, dz) => { const L = Math.hypot(dx, dz) || 1; return { x: dx / L, z: dz / L }; };
  const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz)); // forward = (-sin, -cos)

  /* wall: long axis along local X; crate: cube */
  function coverFor(env, rp, d, flag, rand, used, rps) {
    const pieces = [];
    const add = (type, x, z, yaw, len, h, th) => {
      if (!env.ok(x, z, 0.9)) return;
      for (const q of rps) if (Math.hypot(x - q.x, z - q.z) < 2.7) return;
      if (flag && Math.hypot(x - flag.x, z - flag.z) < 3.2) return;
      pieces.push({ type, x, z, yaw, len, h, th });
      used.push({ x, z, r: len / 2 + 0.7 });
    };
    const arc = (ang, rad) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      return { x: d.x * c - d.z * s, z: d.x * s + d.z * c, rad };
    };
    for (const [ang, rad, len] of [[-0.95, 3.6, 2.6], [0, 3.9, 2.6], [0.95, 3.6, 2.6], [-0.42, 6.8, 3], [0.42, 6.8, 3]]) {
      const v = arc(ang, rad), x = rp.x + v.x * rad, z = rp.z + v.z * rad;
      add('wall', x, z, Math.atan2(-v.x, -v.z), len, 1.05, 0.7);
    }
    for (const ang of [-2.1, 2.1]) {
      const v = arc(ang, 3);
      add('crate', rp.x + v.x * 3, rp.z + v.z * 3, rand() * TAU, 1.1, 1.1, 1.1);
    }
    return pieces;
  }

  /* centre/flags/respawn points/cover for one map; deterministic for a given env */
  function layoutFor(env, bases, mapId, seed) {
    const b = env.bounds, rand = rng(hash(mapId || 'map') ^ (seed || 0));
    const centre = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
    const L = { centre, teams: {}, cover: [], used: [] };
    for (const team of TEAMS) {
      const base = bases[team], d = unit(centre.x - base.x, centre.z - base.z), perp = { x: -d.z, z: d.x };
      const at = (f, l) => ({ x: base.x + d.x * f + perp.x * l, z: base.z + d.z * f + perp.z * l });
      const T = { base: { x: base.x, z: base.z }, dir: d, flag: null, rp: { soldier: [], general: [] } };
      const used = L.used;
      const f0 = at(-3.5, 0);
      T.flag = freePoint(env, f0.x, f0.z, 0, 5, rand, used, 2) || { x: base.x, z: base.z };
      used.push({ x: T.flag.x, z: T.flag.z, r: 2.2 });
      const spots = {
        general: [at(0, -10), at(0, 10), at(4, 0)],
        soldier: [at(8, -6), at(8, 6)]
      };
      for (const kind of ['general', 'soldier']) {
        for (let i = 0; i < CFG.respawnPoints[kind]; i++) {
          const p = spots[kind][i], q = freePoint(env, p.x, p.z, 0, 4, rand, used, 5) || { x: p.x, z: p.z };
          used.push({ x: q.x, z: q.z, r: 3 });
          T.rp[kind].push(q);
        }
      }
      const rps = T.rp.general.concat(T.rp.soldier);
      for (const rp of rps) for (const c of coverFor(env, rp, d, T.flag, rand, used, rps)) L.cover.push(c);
      L.teams[team] = T;
    }
    return L;
  }

  /* initial positions of the whole roster (spec entries get x,z,y,yaw) */
  function placeRoster(env, spec, layout, mapId) {
    const rand = rng(hash('place' + mapId));
    const used = layout.used.map((u) => ({ x: u.x, z: u.z, r: u.r }));
    const spots = {};
    const out = [];
    for (const s of spec) {
      const T = layout.teams[s.team];
      let p = null;
      if (s.general) {
        const rp = T.rp.general[s.index] || T.rp.general[0];
        p = { x: rp.x, z: rp.z };
        used.push({ x: p.x, z: p.z, r: 1.4 });
      } else {
        let c;
        if (s.role === 'push') c = [T.base.x + T.dir.x * 11, T.base.z + T.dir.z * 11, 2, 13];
        else if (s.role === 'follow') { const g = spots[s.leader] || T.base; c = [g.x, g.z, 3, 9]; }
        else c = [T.flag.x, T.flag.z, 2, 7];
        p = freePoint(env, c[0], c[1], c[2], c[3], rand, used.filter((u) => !u.r || u.r < 3), 1.4);
        if (!p) p = freePoint(env, T.base.x, T.base.z, 2, 24, rand, used.filter((u) => !u.r || u.r < 3), 1.2) || { x: T.base.x, z: T.base.z };
        used.push({ x: p.x, z: p.z, r: 1.4 });
      }
      spots[s.key] = p;
      out.push(Object.assign({}, s, { x: p.x, z: p.z, y: env.heightAt(p.x, p.z), yaw: yawTo(p.x, p.z, layout.centre.x, layout.centre.z) }));
    }
    return out;
  }

  function envFromWorld(world) {
    const b = world.bounds || { x0: -50, x1: 50, z0: -50, z1: 50 };
    const hy = (x, z) => (world.heightAt ? world.heightAt(x, z) : 0);
    return {
      bounds: b, heightAt: hy,
      ok: (x, z, pad) => {
        if (x < b.x0 + 1 || x > b.x1 - 1 || z < b.z0 + 1 || z > b.z1 - 1) return false;
        const y = hy(x, z);
        if (world.waterY !== undefined && y < world.waterY - 0.2) return false;
        return !(world.blocked && world.blocked(x, z, y, pad || 0.5));
      }
    };
  }

  /* called from 29_game.js in place of world.spawns */
  function rosterFor(mapId, world) {
    const spec = rosterSpec(mapId);
    if (!spec || !world || !world.bases) return null;
    const env = envFromWorld(world);
    const layout = world.teamLayout || (world.teamLayout = layoutFor(env, world.bases, mapId, 0));
    const spawns = placeRoster(env, spec, layout, mapId);
    /* flags: reuse GFlags through world.flags (27_game_flags.js) */
    if (!world.flags || !world.flags.length) {
      world.flags = world.flags || [];
      for (const team of TEAMS) {
        const f = layout.teams[team].flag;
        world.flags.push({ name: team, kind: team, x: f.x, z: f.z, poleH: 4.6, drop: 0.06, w: 1.35, h: 0.9, team });
      }
    }
    return spawns;
  }

  function buildCover(THREE, scene, world, layout) {
    const list = layout.cover || [];
    if (!list.length) return;
    const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 128;
    const g = cvs.getContext('2d');
    g.fillStyle = '#8a7a55'; g.fillRect(0, 0, 256, 128);
    const rnd = rng(7);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      const x = col * 64 + (row % 2) * 16 - 8, y = row * 42 + 2;
      g.fillStyle = ['#9c8b63', '#a89869', '#8f7f58', '#b0a070'][Math.floor(rnd() * 4)];
      g.beginPath(); g.roundRect ? g.roundRect(x + 2, y + 2, 60, 38, 14) : g.rect(x + 2, y + 2, 60, 38); g.fill();
      g.strokeStyle = 'rgba(40,30,15,.55)'; g.lineWidth = 2.2; g.stroke();
    }
    const bag = new THREE.CanvasTexture(cvs); bag.colorSpace = THREE.SRGBColorSpace || bag.colorSpace; bag.anisotropy = 4;
    const walls = list.filter((c) => c.type === 'wall'), crates = list.filter((c) => c.type === 'crate');
    const parent = world.props || scene;
    const make = (arr, mat, w, h, d, name, surf) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, d), mat, arr.length);
      im.name = name; im.userData.mat = surf; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      arr.forEach((c, i) => {
        const y0 = world.heightAt(c.x, c.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw);
        p.set(c.x, y0 + c.h / 2 - 0.05, c.z);
        sc.set(c.len / w, c.h / h, c.th / d);
        m.compose(p, q, sc); im.setMatrixAt(i, m);
        pushCollider(world, c, y0);
      });
      im.instanceMatrix.needsUpdate = true;
      parent.add(im);
    };
    make(walls, new THREE.MeshStandardMaterial({ map: bag, roughness: 1, metalness: 0, color: 0xffffff }), 1, 1, 1, 'respawn_sandbags', 'sand');
    make(crates, new THREE.MeshStandardMaterial({ color: 0x5f4a30, roughness: 0.85, metalness: 0 }), 1, 1, 1, 'respawn_crates', 'wood');
    world.syncColliders && world.syncColliders();
  }
  function pushCollider(world, c, y0) {
    const list = world.native && world.native.native;
    if (!list) return;
    const hx = c.len / 2, hz = c.th / 2, hy = c.h / 2, cy = y0 + hy - 0.05;
    const co = Math.abs(Math.cos(c.yaw)), si = Math.abs(Math.sin(c.yaw));
    const ex = co * hx + si * hz, ez = si * hx + co * hz;
    list.push({
      cx: c.x, cy, cz: c.z, hx, hy, hz, q: [0, Math.sin(c.yaw / 2), 0, Math.cos(c.yaw / 2)], surf: c.type === 'wall' ? 'sand' : 'wood',
      x0: c.x - ex, x1: c.x + ex, z0: c.z - ez, z1: c.z + ez, y0: cy - hy, y1: cy + hy, idx: c.type === 'wall' ? -5 : -4
    });
  }
  function prepareWorld(THREE, scene, world) {
    if (world.teamCoverBuilt || !world.mapId || !CFG.maps[world.mapId] || !world.bases) return null;
    world.teamCoverBuilt = true;
    const layout = world.teamLayout || (world.teamLayout = layoutFor(envFromWorld(world), world.bases, world.mapId, 0));
    try { buildCover(THREE, scene, world, layout); } catch (e) { console.warn('teams cover', e && e.message); }
    return layout;
  }

  /* --------------------------------------------------- rules (pure) ----- */
  const isAlive = (a) => !a.dead && !a.finished && !(a.dmg && a.dmg.ph && a.dmg.ph.dead);
  /* still in the battle: breathing, or dead with respawns left */
  const fighting = (a) => isAlive(a) || (a.lives || 0) > 0;
  const teamActors = (actors, team) => actors.filter((a) => a.team === team);

  /* a dead actor asks to respawn: consumes a respawn; false when none left */
  function consumeLife(a) {
    if ((a.lives || 0) > 0) { a.lives--; a.out = false; return true; }
    a.out = true;
    return false;
  }
  function newZone() { return { progress: 0, state: 'idle' }; }
  function stepZone(z, dt, attackers, defenders, cfg) {
    cfg = cfg || CFG;
    if (attackers > 0 && defenders === 0) {
      z.progress = Math.min(1, z.progress + dt / cfg.captureSec * Math.min(2, 1 + (attackers - 1) * 0.25));
      z.state = 'capturing';
    } else if (attackers > 0) z.state = 'contested';
    else {
      z.progress = Math.max(0, z.progress - dt / (cfg.captureSec * 3));
      z.state = z.progress > 0 ? 'decaying' : 'idle';
    }
    return z;
  }
  /* zones[team] = progress of the enemy capturing THAT team's flag */
  function evaluate(actors, zones) {
    for (const team of TEAMS) {
      if (zones && zones[team] && zones[team].progress >= 1) return { over: true, winner: other(team), reason: 'flag' };
    }
    const a = teamActors(actors, 'alpha').filter(fighting).length, d = teamActors(actors, 'delta').filter(fighting).length;
    if (!a && !d) return { over: true, winner: 'draw', reason: 'elimination' };
    if (!a) return { over: true, winner: 'delta', reason: 'elimination' };
    if (!d) return { over: true, winner: 'alpha', reason: 'elimination' };
    return { over: false, winner: null, reason: null };
  }
  function summary(actors, zones) {
    const out = { alive: {}, lives: {}, total: {}, flags: {} };
    for (const team of TEAMS) {
      const list = teamActors(actors, team);
      out.alive[team] = list.filter(isAlive).length;
      out.lives[team] = list.reduce((n, a) => n + Math.max(0, a.lives || 0), 0);
      out.total[team] = list.length;
      out.flags[team] = zones && zones[team] ? { progress: zones[team].progress, state: zones[team].state } : null;
    }
    return out;
  }
  /* best respawn point: farthest from known enemies, with noise so groups do not stack */
  function pickRespawn(points, enemies, rand) {
    let best = null, bs = -1e9;
    for (const p of points) {
      let m = 60;
      for (const e of enemies) { const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < m) m = d; }
      const sc = m + rand() * 6;
      if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }

  /* ---------------------------------------------------- orders (pure) --- */
  /* env: { centre, flag(team), base(team), heightAt, phase(team), leader(s) -> {x,z,yaw}|null, spot(x,z,dx,dz) -> bool } */
  function pushPhase(st, team, pushers, centre, t) {
    const S = st[team] || (st[team] = { phase: 'centre', since: t });
    if (S.phase === 'centre' && pushers.length) {
      let near = 0;
      for (const p of pushers) if (Math.hypot(p.x - centre.x, p.z - centre.z) < 26) near++;
      if (near >= Math.ceil(pushers.length * 0.6) || t - S.since > 75) { S.phase = 'assault'; S.since = t; }
    }
    return S.phase;
  }
  function planOrder(env, s, t) {
    const tm = s.tm || (s.tm = {});
    const r = tm.rand || (tm.rand = rng(hash(s.key)));
    const pos = s.ctrl.pos, team = s.team, foe = other(team);
    const own = env.flag(team), enemyFlag = env.flag(foe), phase = env.phase(team);
    const mk = (mode, goal, extra) => Object.assign({ mode, goal: goal ? { x: goal.x, z: goal.z, y: env.heightAt(goal.x, goal.z) } : null, speed: 1, sprint: false, until: t + 2.2 }, extra);
    const polar = (c, rad, a) => ({ x: c.x + Math.cos(a) * rad, z: c.z + Math.sin(a) * rad });
    const idle = (face) => mk('hold', null, { face, speed: 0, leash: tm.leash || null });

    if (tm.pauseUntil > t) return idle(tm.face);

    if (s.role === 'lead') {
      if (tm.next === undefined || t > tm.next) {
        tm.next = t + rr(r, 10, 16); tm.ja = rr(r, 0, TAU); tm.jr = rr(r, 2, 8);
      }
      const base = env.base(team), c = env.centre;
      const k = phase === 'assault' ? 0.5 : 0.42;
      const from = phase === 'assault' ? c : base, to = phase === 'assault' ? enemyFlag : c;
      const p = { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k };
      const g = polar(p, tm.jr, tm.ja);
      return mk('command', g, { leash: null, speed: 0.9 });
    }

    if (s.role === 'push') {
      if (tm.next === undefined || t > tm.next) {
        tm.next = t + rr(r, 14, 26); tm.ja = rr(r, 0, TAU); tm.jr = rr(r, 3, 12);
      }
      if (phase === 'centre') {
        const g = polar(env.centre, tm.jr, tm.ja);
        if (Math.hypot(pos.x - g.x, pos.z - g.z) < 2.5) { tm.pauseUntil = t + rr(r, 1.5, 4); tm.face = yawTo(pos.x, pos.z, enemyFlag.x, enemyFlag.z) + rr(r, -0.6, 0.6); return idle(tm.face); }
        return mk('push-centre', g, { sprint: true, speed: rr(r, 0.9, 1) });
      }
      const g = s.capturer ? polar(enemyFlag, rr(r, 0.8, 2.8), tm.ja) : polar(enemyFlag, 7 + tm.jr * 0.6, tm.ja);
      if (Math.hypot(pos.x - g.x, pos.z - g.z) < 1.5) { tm.pauseUntil = t + rr(r, 1, 3); tm.face = yawTo(pos.x, pos.z, enemyFlag.x, enemyFlag.z) + rr(r, -0.9, 0.9); return idle(tm.face); }
      return mk('push-assault', g, { sprint: true });
    }

    if (s.role === 'follow') {
      const ld = env.leader(s);
      if (!ld) { /* no leader left: hold the flag */
        const g = polar(own, rr(r, 2, 7), rr(r, 0, TAU));
        return mk('guard', g, { leash: { x: own.x, z: own.z, r: 30 } });
      }
      if (tm.next === undefined || t > tm.next) {
        tm.next = t + rr(r, 8, 15); tm.speed = rr(r, 0.62, 1); tm.paused = false; tm.pauseOn = r() < 0.35;
        const rad = rr(r, 3, 9), ang = rr(r, 0, TAU);
        let off = { x: Math.cos(ang) * rad, z: Math.sin(ang) * rad };
        if (r() < 0.45) { /* prefer a spot with an obstacle between it and the outside */
          for (let k = 0; k < 6; k++) {
            const a2 = rr(r, 0, TAU), r2 = rr(r, 3, 9), o2 = { x: Math.cos(a2) * r2, z: Math.sin(a2) * r2 };
            if (env.spot(ld.x + o2.x, ld.z + o2.z, Math.cos(a2), Math.sin(a2))) { off = o2; break; }
          }
        }
        tm.off = off;
      }
      const leash = tm.leash = { x: ld.x, z: ld.z, r: 40 };
      const g = { x: ld.x + tm.off.x, z: ld.z + tm.off.z };
      const d = Math.hypot(pos.x - g.x, pos.z - g.z), far = Math.hypot(pos.x - ld.x, pos.z - ld.z);
      const face = Math.atan2(-tm.off.x, -tm.off.z); /* outward from the leader */
      if (d < 1.6) {
        if (tm.pauseOn && !tm.paused) { tm.paused = true; tm.pauseUntil = t + rr(r, 2, 5); tm.face = face; }
        return mk('follow-hold', null, { face, speed: 0, leash });
      }
      return mk('follow', g, { speed: far > 20 ? 1 : tm.speed, sprint: far > 25, leash });
    }

    /* guard */
    tm.leash = { x: own.x, z: own.z, r: 30 };
    const face = yawTo(own.x, own.z, pos.x, pos.z); /* outward from the flag */
    if (tm.next === undefined || t > tm.next) {
      tm.next = t + rr(r, 6, 14); tm.spot = polar(own, rr(r, 1.5, 7), rr(r, 0, TAU));
      if (r() < 0.5) { tm.pauseUntil = t + rr(r, 3, 8); tm.face = face; }
    }
    if (Math.hypot(pos.x - tm.spot.x, pos.z - tm.spot.z) < 1.2) return mk('guard-hold', null, { face, speed: 0, leash: { x: own.x, z: own.z, r: 30 } });
    return mk('guard', tm.spot, { speed: 0.7, leash: { x: own.x, z: own.z, r: 30 } });
  }

  /* ------------------------------------------------------ spatial hash --- */
  function SpatialHash(cell) {
    this.cell = cell || 8; this.m = new Map(); this.used = [];
  }
  SpatialHash.prototype.clear = function () { for (const v of this.used) v.length = 0; this.used.length = 0; };
  SpatialHash.prototype.add = function (o, x, z) {
    const k = Math.floor(x / this.cell) * 8192 + Math.floor(z / this.cell);
    let v = this.m.get(k);
    if (!v) this.m.set(k, (v = []));
    if (!v.length) this.used.push(v);
    v.push(o);
  };
  SpatialHash.prototype.query = function (x, z, r, out, pos) {
    const c = this.cell, x1 = Math.floor((x + r) / c), z1 = Math.floor((z + r) / c);
    out.length = 0;
    for (let i = Math.floor((x - r) / c); i <= x1; i++) for (let j = Math.floor((z - r) / c); j <= z1; j++) {
      const v = this.m.get(i * 8192 + j);
      if (!v) continue;
      for (const o of v) { const p = pos(o); if (Math.hypot(p.x - x, p.z - z) <= r) out.push(o); }
    }
    return out;
  };

  /* -------------------------------------------------- grenade ballistics */
  /* velocity (vx,vy,vz) to land at the target from the hand; null if out of reach */
  function lobVelocity(from, to, angle, g) {
    const dx = to.x - from.x, dz = to.z - from.z, R = Math.hypot(dx, dz), dy = to.y - from.y;
    const c = Math.cos(angle), t = Math.tan(angle);
    const den = 2 * c * c * (R * t - dy);
    if (R < 0.5 || den <= 0) return null;
    const v = Math.sqrt(g * R * R / den);
    if (!isFinite(v) || v > 32) return null;
    const T = R / (v * c);
    return { vx: dx / R * v * c, vy: v * Math.sin(angle), vz: dz / R * v * c, T, v };
  }

  /* ===================================================================== *
   *  Runtime (browser only)
   * ===================================================================== */
  let inst = null;

  function init(ctx) {
    if (inst || !ctx.world || !ctx.world.mapId || !CFG.maps[ctx.world.mapId]) return inst;
    const { THREE, scene, world, squad, camera } = ctx;
    const now = () => ctx.S.time;
    const layout = world.teamLayout || layoutFor(envFromWorld(world), world.bases, world.mapId, 0);
    const env0 = envFromWorld(world);
    const G = { over: false, winner: null, reason: null, t: 0, zones: { alpha: newZone(), delta: newZone() }, phase: {}, shieldAt: 0 };
    const hash8 = new SpatialHash(8);
    const tmpA = [], tmpB = [];
    const recent = [];
    const key2 = new Map();
    let rr_i = 0, gr_i = 0, accZ = 0, accW = 0, accH = 0;

    for (const s of squad) {
      key2.set(s.key, s);
      const sp = s.spawn || {};
      s.team = s.char.preset.faction || sp.team;
      s.general = !s.npc;
      s.lives = sp.lives !== undefined ? sp.lives : (s.npc ? CFG.respawns.soldier : CFG.respawns.general);
      s.role = sp.role || (s.npc ? 'guard' : 'lead');
      s.leaderKey = sp.leader || null;
      s.capturer = !!sp.capturer;
      s.out = false;
      s.tmShield = 0;
      s.tmGren = giveGrenades(s);
      s.tmGrenAt = now() + 6 + (hash(s.key) % 900) / 100;
    }
    const actors = squad;
    function giveGrenades(s) {
      const h = hash(s.key);
      return s.npc ? { m67: 1 + (h % 2), m84: (h >> 3) % 5 < 2 ? 1 : 0 } : { m67: 2, m84: 1 };
    }

    if (!world.teamCoverBuilt) prepareWorld(THREE, scene, world);

    /* --- spawn protection: bullets, fragments and blasts ignore a shielded actor --- */
    const DMG = ctx.F && ctx.F.DMG;
    if (DMG && !DMG._tmWrapped) {
      DMG._tmWrapped = true;
      const hit = DMG.hit, blast = DMG.blast, ray = DMG.raySoldier;
      DMG.hit = function (h) { if (h && h.s && h.s.tmShield > now()) return { died: false, dmg: 0, zone: 'shield' }; return hit.apply(this, arguments); };
      DMG.blast = function (s) { if (s && s.tmShield > now()) return { died: false, dmg: 0, zone: 'shield' }; return blast.apply(this, arguments); };
      DMG.raySoldier = function (s) { if (s && s.tmShield > now()) return null; return ray.apply(this, arguments); };
    }

    /* --- HUD + end overlay --- */
    const hud = document.createElement('div');
    hud.id = 'teamsHud';
    hud.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:30;pointer-events:none;font:600 13px/1.25 system-ui,Segoe UI,Arial,sans-serif;color:#e9ecef;text-shadow:0 1px 3px #000;text-align:center;letter-spacing:.03em';
    document.body.appendChild(hud);
    const endBox = document.createElement('div');
    endBox.id = 'teamsEnd';
    endBox.style.cssText = 'position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;flex-direction:column;gap:18px;background:rgba(6,8,10,.72);color:#fff;font-family:system-ui,Segoe UI,Arial,sans-serif;text-align:center';
    endBox.innerHTML = '<div id="teamsEndTitle" style="font:800 56px/1.1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.06em"></div><div id="teamsEndSub" style="font:500 20px/1.3 system-ui,Segoe UI,Arial,sans-serif;opacity:.88"></div><button id="teamsEndBtn" type="button" style="margin-top:12px;padding:12px 34px;font:700 18px system-ui,Segoe UI,Arial,sans-serif;color:#fff;background:#2b6a3a;border:1px solid #67b27a;border-radius:6px;cursor:pointer">В меню</button>';
    document.body.appendChild(endBox);
    endBox.querySelector('#teamsEndBtn').onclick = () => {
      try { if (root.AEGIS_GAME && root.AEGIS_GAME.travel) { root.AEGIS_GAME.travel(null); return; } } catch (e) { /* fall through */ }
      const u = new URL(location.href); u.searchParams.delete('map'); location.assign(u.href);
    };
    const NAME = { alpha: 'АЛЬФА', delta: 'ДЕЛЬТА' };
    function playerTeam() { const a = ctx.active && ctx.active(); return a ? a.team : (G.lastTeam || 'alpha'); }
    function showEnd() {
      const T = endBox.querySelector('#teamsEndTitle'), Sb = endBox.querySelector('#teamsEndSub');
      const w = G.winner, mine = playerTeam();
      T.textContent = w === 'draw' ? 'НИЧЬЯ' : 'ПОБЕДА ' + (w === 'alpha' ? 'АЛЬФЫ' : 'ДЕЛЬТЫ');
      T.style.color = w === 'draw' ? '#ddd' : w === mine ? '#8fe3a0' : '#f08a8a';
      Sb.textContent = (w === 'draw' ? 'Обе стороны уничтожены' : w === mine ? 'Ваша команда победила' : 'Ваша команда проиграла') +
        ' · ' + (G.reason === 'flag' ? 'флаг захвачен' : 'живая сила противника уничтожена');
      endBox.style.display = 'flex';
      try { document.exitPointerLock && document.exitPointerLock(); } catch (e) { /* ignore */ }
    }
    function drawHud() {
      const st = state();
      const row = (t) => '<b style="color:' + (t === 'alpha' ? '#9ad0ff' : '#ffb089') + '">' + NAME[t] + '</b> ' + st.alive[t] + ' <span style="opacity:.7">+' + st.lives[t] + '</span>';
      let html = row('alpha') + ' &nbsp;│&nbsp; ' + row('delta');
      for (const t of TEAMS) {
        const z = st.flags[t];
        if (z && z.progress > 0.01) html += '<br><span style="color:#ffd27a">Флаг ' + (t === 'alpha' ? 'Альфы' : 'Дельты') + ': захват ' + Math.round(z.progress * 100) + '%' + (z.state === 'contested' ? ' (бой)' : '') + '</span>';
      }
      if (hud._h !== html) { hud._h = html; hud.innerHTML = html; }
    }

    /* --- death / respawn gate --- */
    function onDeath(s) {
      if (G.over) return false;
      return consumeLife(s);
    }
    function beforeRespawn(s) {
      const pts = layout.teams[s.team].rp[s.general ? 'general' : 'soldier'];
      const enemies = [];
      for (const q of actors) if (q.team !== s.team && isAlive(q)) enemies.push(q.ctrl.pos);
      const rand = s.tm && s.tm.rand ? s.tm.rand : rng(hash(s.key) ^ (now() * 1000 | 0));
      const rp = pickRespawn(pts, enemies, rand) || pts[0];
      const t = now();
      for (let i = recent.length - 1; i >= 0; i--) if (t - recent[i].t > 5) recent.splice(i, 1);
      const p = freePoint(env0, rp.x, rp.z, 0, 2.6, rand, recent, 1.2) || rp;
      recent.push({ x: p.x, z: p.z, t });
      s.spawn = { x: p.x, z: p.z, yaw: yawTo(p.x, p.z, layout.centre.x, layout.centre.z), key: s.key, team: s.team };
      s.out = false;
      s.tmShield = t + CFG.protectSec;
      s.tmAmmo = undefined;
      s.tmGren = giveGrenades(s);
      s.tmGrenAt = t + 8;
      s.tmBusy = 0;
      s.order = null;
      if (s.tm) { s.tm.next = undefined; s.tm.pauseUntil = 0; }
    }
    /* next body for a player whose general ran out of respawns: other general, else nearest soldier */
    function nextBody(s) {
      let best = -1, bd = 1e9;
      for (let i = 0; i < squad.length; i++) {
        const q = squad[i];
        if (q === s || q.team !== s.team || !isAlive(q)) continue;
        const d = (q.general ? 0 : 1000) + Math.hypot(q.ctrl.pos.x - s.ctrl.pos.x, q.ctrl.pos.z - s.ctrl.pos.z);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    /* --- flag zones --- */
    function updateZones(dt) {
      for (const team of TEAMS) {
        const f = layout.teams[team].flag, fy = world.heightAt(f.x, f.z);
        let atk = 0, def = 0;
        hash8.query(f.x, f.z, CFG.captureRadius, tmpA, (q) => q.ctrl.pos).forEach((q) => {
          if (!isAlive(q) || Math.abs(q.ctrl.pos.y - fy) > CFG.captureDy) return;
          if (q.team === team) def++; else atk++;
        });
        stepZone(G.zones[team], dt, atk, def);
      }
    }
    function rebuildHash() {
      hash8.clear();
      for (const q of actors) if (isAlive(q)) hash8.add(q, q.ctrl.pos.x, q.ctrl.pos.z);
    }

    /* --- orders --- */
    const orderEnv = {
      centre: layout.centre,
      flag: (t) => layout.teams[t].flag,
      base: (t) => layout.teams[t].base,
      heightAt: (x, z) => world.heightAt(x, z),
      phase: (t) => (G.phase[t] ? G.phase[t].phase : 'centre'),
      leader: (s) => {
        const a = ctx.active && ctx.active();
        if (a && a.team === s.team && isAlive(a)) return a.ctrl.pos;
        const l = key2.get(s.leaderKey);
        if (l && isAlive(l)) return l.ctrl.pos;
        for (const q of actors) if (q.general && q.team === s.team && isAlive(q)) return q.ctrl.pos;
        return null;
      },
      spot: (x, z, dx, dz) => env0.ok(x, z, 0.5) && !!world.blocked && world.blocked(x + dx * 0.9, z + dz * 0.9, world.heightAt(x, z) + 0.35, 0.12)
    };
    function updatePhases(t) {
      for (const team of TEAMS) {
        const ps = [];
        for (const q of actors) if (q.team === team && q.role === 'push' && isAlive(q)) ps.push(q.ctrl.pos);
        pushPhase(G.phase, team, ps, layout.centre, t);
      }
    }
    function updateOrders(t, active) {
      const n = actors.length, per = Math.max(3, Math.ceil(n / 8));
      for (let k = 0; k < per; k++) {
        const s = actors[rr_i++ % n];
        if (s === active || !isAlive(s)) continue;
        if (s._lodI > 0.2 && (rr_i & 1)) continue;
        s.order = planOrder(orderEnv, s, t);
      }
    }

    /* --- bot grenades --- */
    const GRAV = 9.81;
    function enemyCluster(p, team) {
      let n = 0;
      hash8.query(p.x, p.z, 5, tmpB, (q) => q.ctrl.pos).forEach((q) => { if (q.team !== team && isAlive(q)) n++; });
      return n;
    }
    function alliesNear(p, team, r, self) {
      let n = 0;
      hash8.query(p.x, p.z, r, tmpB, (q) => q.ctrl.pos).forEach((q) => { if (q !== self && q.team === team && isAlive(q)) n++; });
      return n;
    }
    function handPos(s) {
      const c = s.ctrl, y = c.pos.y + 1.45 - 0.45 * (c.crouch || 0);
      return { x: c.pos.x - Math.sin(c.yaw) * 0.4, y, z: c.pos.z - Math.cos(c.yaw) * 0.4 };
    }
    function planThrow(s, t) {
      const b = s.battle;
      if (!b || !b.memory || !b.target || !isAlive(b.target)) return null;
      const G_ = CFG.grenade, c = s.ctrl;
      if (c.reload >= 0 || c.jam || c.treating || c.dragging || (s.thr && s.thr.mode) || c.prone > 0.3) return null;
      const m = b.memory, d = Math.hypot(m.x - c.pos.x, m.z - c.pos.z);
      const hidden = !b.los && t - b.seenAt < 5, cluster = enemyCluster(m, s.team) >= 2;
      if (!hidden && !cluster) return null;
      const kinds = [];
      if (s.tmGren.m67 > 0 && d >= G_.min && d <= G_.max) kinds.push('m67');
      if (s.tmGren.m84 > 0 && d >= 10 && d <= G_.flashMax && hidden) kinds.push('m84');
      if (!kinds.length) return null;
      const kind = kinds.length > 1 && (hash(s.key) + (t | 0)) % 3 === 0 ? 'm84' : kinds[0];
      const to = { x: m.x, y: m.y + 0.1, z: m.z };
      if (alliesNear(to, s.team, G_.allyClear, s) > 0) return null;
      if (kind === 'm67' && d < G_.selfClear) return null;
      const from = handPos(s);
      for (const ang of [0.62, 0.45, 0.3, 0.17]) {
        const v = lobVelocity(from, to, ang * (d < 18 ? 1.12 : 1), GRAV);
        if (!v) continue;
        const vis = ctx.visible;
        let ok = true, p0 = from;
        for (let i = 1; i <= 8 && ok; i++) {
          const tt = v.T * i / 8, p1 = { x: from.x + v.vx * tt, y: from.y + v.vy * tt - 0.5 * GRAV * tt * tt, z: from.z + v.vz * tt };
          if (i < 8 && !vis(new THREE.Vector3(p0.x, p0.y, p0.z), new THREE.Vector3(p1.x, p1.y, p1.z))) ok = false;
          p0 = p1;
        }
        if (ok) return { kind, to, T: v.T, ang: ang * (d < 18 ? 1.12 : 1) };
      }
      return null;
    }
    function updateGrenades(t, active) {
      const n = actors.length;
      for (let k = 0; k < 2; k++) {
        const s = actors[gr_i++ % n];
        if (s === active || !isAlive(s) || !s.battle || t < s.tmGrenAt || s.tmBusy > t) continue;
        if (!s.tmGren || (s.tmGren.m67 + s.tmGren.m84) <= 0) continue;
        const plan = planThrow(s, t);
        if (!plan) { s.tmGrenAt = t + 1.5; continue; }
        s.tmThrow = plan; s.tmBusy = t + 0.8; s.tmGrenAt = t + CFG.grenade.cooldown + Math.random() * 4;
        s.idleYaw = yawTo(s.ctrl.pos.x, s.ctrl.pos.z, plan.to.x, plan.to.z);
        s.ctrl.aiADS = false;
      }
      for (const s of actors) {
        if (!s.tmThrow || s.tmBusy > t + 0.05) continue;
        const plan = s.tmThrow; s.tmThrow = null;
        if (!isAlive(s) || !ctx.GSIM) continue;
        const from = handPos(s), v = lobVelocity(from, plan.to, plan.ang, GRAV);
        if (!v) continue;
        const vel = new THREE.Vector3(v.vx * 1.03, v.vy * 1.03, v.vz * 1.03);
        const fuse = plan.kind === 'm84' ? Math.max(1.3, v.T + 0.15) : Math.max(2.6, Math.min(4.6, v.T + 1.1));
        ctx.GSIM.add(plan.kind, new THREE.Vector3(from.x, from.y, from.z), vel, null, new THREE.Vector3((Math.random() - 0.5) * 6, 2, -10), fuse);
        s.tmGren[plan.kind]--;
        s.tmShield = 0; // throwing ends spawn protection like firing does
        try { if (ctx.audio && ctx.audio.grenade && ctx.F && ctx.F.spatialFrom) ctx.audio.grenade('spoon', ctx.F.spatialFrom(s.char.root.position), 0.9); } catch (e) { /* ignore */ }
        G.thrown = (G.thrown || 0) + 1;
      }
    }

    /* --- LOD: far/off-screen bots are not drawn, pose at a lower rate, no shadows --- */
    const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere(new THREE.Vector3(), 4);
    let lodStats = { hidden: 0, far: 0, near: 0 };
    function setShadow(s, on) {
      if (s._lodShadow === on) return;
      s._lodShadow = on;
      for (const k in s.char.meshes) {
        const m = s.char.meshes[k];
        if (m.userData._cs0 === undefined) m.userData._cs0 = m.castShadow;
        m.castShadow = on ? m.userData._cs0 : false;
      }
    }
    function lod() {
      camera.updateMatrixWorld();
      pm.multiplyMatrices(camera.projectionMatrix, pm.copy(camera.matrixWorld).invert());
      fr.setFromProjectionMatrix(pm);
      const cp = camera.position, act = ctx.active && ctx.active();
      let hidden = 0, far = 0, near = 0;
      for (let i = 0; i < squad.length; i++) {
        const s = squad[i];
        if (s === act || s.active || (ctx.S.death && ctx.S.death.i === i)) {
          s._lodI = 0;
          if (s._lodHid) {
            s._lodHid = false; s.char.root.visible = true;
            if (s.gun && s.gun.root && s._gunVis !== undefined) s.gun.root.visible = s._gunVis;
            s._gunVis = undefined;
          }
          continue;
        }
        const p = s.ctrl.pos, d = Math.hypot(p.x - cp.x, p.y - cp.y, p.z - cp.z);
        sph.center.set(p.x, p.y + 1, p.z);
        const vis = d < 22 || fr.intersectsSphere(sph);
        s._lodI = d < 35 && vis ? 0 : vis ? (d < 70 ? 0.05 : 0.1) : 0.2;
        setShadow(s, d < 55);
        const r = s.char.root;
        if (!vis) {
          hidden++;
          r.visible = false;
          if (!s._lodHid) {
            s._lodHid = true;
            if (s.gun && s.gun.root) { s._gunVis = s.gun.root.visible; s.gun.root.visible = false; }
          }
        } else {
          if (s._lodHid) {
            s._lodHid = false; r.visible = true; s._poseAccum = 1;
            if (s.gun && s.gun.root && s._gunVis !== undefined) s.gun.root.visible = s._gunVis;
            s._gunVis = undefined;
          }
          if (d > 70) far++; else near++;
        }
      }
      lodStats = { hidden, far, near };
    }

    /* --- state / win --- */
    function state() {
      const sm = summary(actors, G.zones);
      return Object.assign(sm, {
        over: G.over, winner: G.winner, reason: G.reason, time: G.t, phase: { alpha: orderEnv.phase('alpha'), delta: orderEnv.phase('delta') },
        thrown: G.thrown || 0, lod: lodStats
      });
    }
    function checkWin() {
      if (G.over) return G;
      const r = evaluate(actors, G.zones);
      if (r.over) {
        G.over = true; G.winner = r.winner; G.reason = r.reason;
        for (const s of squad) { s.order = null; s.ctrl.aiWish = null; s.combatAim = null; s.ctrl.aiADS = false; }
        showEnd();
      }
      return G;
    }

    function update(dt, t, active) {
      G.t = t;
      if (active) G.lastTeam = active.team;
      for (const s of squad) {
        if (s.tmShield > t) {
          const c = s.ctrl;
          if (s.tmAmmo === undefined) s.tmAmmo = c.ammo;
          else if (c.ammo < s.tmAmmo || c.triggerHeld) s.tmShield = 0;
          s.tmAmmo = c.ammo;
        }
      }
      if (!G.over) {
        accZ += dt;
        if (accZ >= 0.25) { rebuildHash(); updateZones(accZ); updatePhases(t); accZ = 0; }
        accW += dt;
        if (accW >= 0.5) { accW = 0; checkWin(); }
        if (!G.over) { updateOrders(t, active); updateGrenades(t, active); }
      }
      accH += dt;
      if (accH >= 0.25) { accH = 0; drawHud(); }
    }

    inst = { ctx, G, layout, update, lod, state, checkWin, onDeath, beforeRespawn, nextBody, isOver: () => G.over, lodStats: () => lodStats };
    drawHud();
    return inst;
  }

  /* delegating API (safe before init / on maps without teams) */
  return {
    CFG, TEAMS, hash, rng, roleFor, rosterSpec, countBy, freePoint, layoutFor, placeRoster, rosterFor, envFromWorld,
    isAlive, fighting, consumeLife, newZone, stepZone, evaluate, summary, pickRespawn, pushPhase, planOrder, SpatialHash, lobVelocity,
    init, prepareWorld,
    get inst() { return inst; },
    update: (dt, t, a) => (inst ? inst.update(dt, t, a) : undefined),
    lod: () => { if (inst) inst.lod(); },
    onDeath: (s) => (inst ? inst.onDeath(s) : true),
    beforeRespawn: (s) => { if (inst) inst.beforeRespawn(s); },
    nextBody: (s) => (inst ? inst.nextBody(s) : -1),
    isOver: () => !!(inst && inst.isOver()),
    state: () => (inst ? inst.state() : null),
    checkWin: () => (inst ? inst.checkWin() : null),
    reset: () => { inst = null; }
  };
});
