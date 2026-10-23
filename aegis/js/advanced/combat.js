"use strict";
/** Reactive BT, bounded incremental A*, immutable expiring squad reports. */
var AegisCombat;
(function (AegisCombat) {
    let Status;
    (function (Status) {
        Status[Status["Failure"] = 0] = "Failure";
        Status[Status["Success"] = 1] = "Success";
        Status[Status["Running"] = 2] = "Running";
    })(Status = AegisCombat.Status || (AegisCombat.Status = {}));
    class Action {
        constructor(fn) {
            this.fn = fn;
        }
        tick(c) {
            return this.fn(c);
        }
    }
    AegisCombat.Action = Action;
    class Sequence {
        constructor(nodes) {
            this.nodes = nodes;
        }
        tick(c) {
            for (const n of this.nodes) {
                const x = n.tick(c);
                if (x !== Status.Success)
                    return x;
            }
            return Status.Success;
        }
    }
    AegisCombat.Sequence = Sequence;
    class Selector {
        constructor(nodes) {
            this.nodes = nodes;
        }
        tick(c) {
            for (const n of this.nodes) {
                const x = n.tick(c);
                if (x !== Status.Failure)
                    return x;
            }
            return Status.Failure;
        }
    }
    AegisCombat.Selector = Selector;
    const cond = (fn) => new Action((c) => (fn(c) ? Status.Success : Status.Failure)), act = (fn) => new Action((c) => {
        fn(c);
        return Status.Success;
    });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z), copy = (p) => ({ x: p.x, y: p.y, z: p.z });
    const team = (s) => s.char.preset.faction, alive = (s) => !s.dead && !s.finished && !s.dmg?.ph?.dead;
    class Heap {
        constructor() {
            this.a = [];
        }
        push(n) {
            const a = this.a;
            a.push(n);
            let i = a.length - 1;
            while (i) {
                const p = (i - 1) >> 1;
                if (a[p].f <= n.f)
                    break;
                a[i] = a[p];
                i = p;
            }
            a[i] = n;
        }
        pop() {
            const a = this.a, top = a[0], last = a.pop();
            if (a.length && last) {
                let i = 0;
                while (i * 2 + 1 < a.length) {
                    let k = i * 2 + 1;
                    if (k + 1 < a.length && a[k + 1].f < a[k].f)
                        k++;
                    if (a[k].f >= last.f)
                        break;
                    a[i] = a[k];
                    i = k;
                }
                a[i] = last;
            }
            return top;
        }
    }
    class Navigation {
        constructor(world) {
            this.world = world;
            this.cell = 1.1;
            this.cache = new Map();
            this.edgeCache = new Map();
            this.jobs = [];
            this.expanded = 0;
            this.completed = 0;
            this.bounds = world.bounds || { x0: -30, x1: 30, z0: -35, z1: 35 };
            this.nx = Math.ceil((this.bounds.x1 - this.bounds.x0) / this.cell) + 1;
            this.nz = Math.ceil((this.bounds.z1 - this.bounds.z0) / this.cell) + 1;
        }
        grid(p) {
            return {
                x: Math.max(0, Math.min(this.nx - 1, Math.round((p.x - this.bounds.x0) / this.cell))),
                z: Math.max(0, Math.min(this.nz - 1, Math.round((p.z - this.bounds.z0) / this.cell))),
            };
        }
        point(x, z) {
            const px = this.bounds.x0 + x * this.cell, pz = this.bounds.z0 + z * this.cell;
            return { x: px, z: pz, y: this.world.heightAt(px, pz) };
        }
        id(x, z) {
            return z * this.nx + x;
        }
        walk(x, z, t) {
            if (x < 0 || z < 0 || x >= this.nx || z >= this.nz)
                return false;
            const i = this.id(x, z), old = this.cache.get(i);
            if (old && t - old.t < 2)
                return old.ok;
            const p = this.point(x, z), ok = !(this.world.waterY !== undefined && p.y < this.world.waterY - 0.35) && !this.world.blocked?.(p.x, p.z, p.y, 0.34);
            if (this.cache.size > 45000)
                this.cache.clear();
            this.cache.set(i, { ok, t });
            return ok;
        }
        clearLine(a, b, t) {
            const surface = globalThis.GNavigation?.get(this.world);
            if (surface?.query)
                return surface.clear(a, b);
            const d = dist(a, b), n = Math.ceil(d / 0.45);
            let prev = a.y;
            for (let i = 0; i <= n; i++) {
                const u = n ? i / n : 0, x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u, y = this.world.heightAt(x, z);
                if (Math.abs(y - prev) > 0.35 || this.world.blocked?.(x, z, y, 0.34))
                    return false;
                prev = y;
            }
            return true;
        }
        edge(ax, az, bx, bz, t) {
            const ia = this.id(ax, az), ib = this.id(bx, bz), key = ia < ib ? ia + ":" + ib : ib + ":" + ia, old = this.edgeCache.get(key);
            if (old && t - old.t < 2)
                return old.ok;
            const ok = this.clearLine(this.point(ax, az), this.point(bx, bz), t);
            if (this.edgeCache.size > 90000)
                this.edgeCache.clear();
            this.edgeCache.set(key, { ok, t });
            return ok;
        }
        request(s, goal, t) {
            this.jobs = this.jobs.filter((j) => j.s !== s);
            const surface = globalThis.GNavigation?.get(this.world);
            if (surface?.query) {
                s.battle.pending = true;
                this.jobs.push({ recast: true, s, goal: copy(goal), battle: s.battle });
                return;
            }
            if (this.clearLine(s.ctrl.pos, goal, t)) {
                s.battle.path = [copy(goal)];
                s.battle.pending = false;
                s.battle.pathState = "complete";
                s.battle.pathGoal = copy(goal);
                this.completed++;
                return;
            }
            const resolve = (at) => {
                const base = this.grid(at), candidates = [];
                for (let dz = -3; dz <= 3; dz++)
                    for (let dx = -3; dx <= 3; dx++) {
                        const x = base.x + dx, z = base.z + dz;
                        if (x < 0 || z < 0 || x >= this.nx || z >= this.nz)
                            continue;
                        candidates.push({ x, z, d: dist(this.point(x, z), at) });
                    }
                candidates.sort((a, b) => a.d - b.d);
                return candidates.find((q) => this.walk(q.x, q.z, t) &&
                    this.clearLine(at, this.point(q.x, q.z), t));
            };
            const from = resolve(s.ctrl.pos), to = resolve(goal);
            if (!from || !to) {
                s.battle.path = [];
                s.battle.pending = false;
                s.battle.pathState = "unreachable";
                return;
            }
            const start = this.id(from.x, from.z), open = new Heap();
            open.push({ ...from, g: 0, f: 0 });
            this.jobs.push({
                s,
                to,
                goal: copy(goal),
                fromPoint: this.point(from.x, from.z),
                start,
                open,
                cost: new Map([[start, 0]]),
                prev: new Map(),
                closed: new Set(),
                best: from,
                bestH: Infinity,
                total: 0,
            });
            s.battle.pending = true;
        }
        process(t, budget = 320) {
            const surface = globalThis.GNavigation?.get(this.world);
            surface?.tick(t);
            let queries = 0;
            while (budget > 0 && this.jobs.length) {
                if (this.jobs[0].recast) {
                    if (queries++ >= 4)
                        break;
                    const j = this.jobs.shift();
                    budget -= 40;
                    if (!alive(j.s) || j.battle !== j.s.battle)
                        continue;
                    const result = surface.plan(j.s.ctrl.pos, j.goal);
                    Object.assign(j.s.battle, {
                        path: result.path,
                        pathState: result.state,
                        pathGoal: j.goal,
                        pathEndpoint: result.endpoint,
                        pathGeneration: result.generation,
                        pathReason: result.reason,
                        pending: false,
                    });
                    this.completed++;
                    continue;
                }
                const j = this.jobs[0];
                if (!alive(j.s)) {
                    j.s.battle.pending = false;
                    this.jobs.shift();
                    continue;
                }
                let done = false;
                const batch = Math.min(40, budget);
                for (let k = 0; k < batch; k++) {
                    const n = j.open.pop();
                    budget--;
                    if (!n) {
                        done = true;
                        break;
                    }
                    const ni = this.id(n.x, n.z);
                    if (j.closed.has(ni))
                        continue;
                    j.closed.add(ni);
                    this.expanded++;
                    j.total++;
                    const dx = Math.abs(n.x - j.to.x), dz = Math.abs(n.z - j.to.z), h = Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
                    if (h < j.bestH) {
                        j.best = n;
                        j.bestH = h;
                    }
                    if (h < 1 || j.total >= 2200) {
                        done = true;
                        break;
                    }
                    const p = this.point(n.x, n.z);
                    for (const [ox, oz] of [
                        [1, 0],
                        [-1, 0],
                        [0, 1],
                        [0, -1],
                        [1, 1],
                        [1, -1],
                        [-1, 1],
                        [-1, -1],
                    ]) {
                        const x = n.x + ox, z = n.z + oz;
                        if (!this.walk(x, z, t))
                            continue;
                        if (ox &&
                            oz &&
                            (!this.walk(n.x + ox, n.z, t) || !this.walk(n.x, n.z + oz, t)))
                            continue;
                        if (!this.edge(n.x, n.z, x, z, t))
                            continue;
                        const q = this.point(x, z), dy = q.y - p.y;
                        if (Math.abs(dy) > 0.55)
                            continue;
                        const key = this.id(x, z), g = n.g + (ox && oz ? 1.414 : 1) + Math.abs(dy) * 1.7;
                        if (g >= (j.cost.get(key) ?? Infinity))
                            continue;
                        j.cost.set(key, g);
                        j.prev.set(key, ni);
                        const hx = Math.abs(x - j.to.x), hz = Math.abs(z - j.to.z);
                        j.open.push({
                            x,
                            z,
                            g,
                            f: g + Math.max(hx, hz) + 0.414 * Math.min(hx, hz),
                        });
                    }
                }
                if (done) {
                    const path = [];
                    let k = this.id(j.best.x, j.best.z);
                    while (k !== j.start && j.prev.has(k) && path.length < 600) {
                        path.push(this.point(k % this.nx, Math.floor(k / this.nx)));
                        k = j.prev.get(k);
                    }
                    path.reverse();
                    if (dist(j.s.ctrl.pos, j.fromPoint) > 0.15)
                        path.unshift(j.fromPoint);
                    const endpoint = path[path.length - 1] || this.point(j.best.x, j.best.z);
                    const reached = dist(endpoint, j.goal) < this.cell * 1.6 &&
                        this.clearLine(endpoint, j.goal, t);
                    if (reached && this.clearLine(j.s.ctrl.pos, path[0] || j.goal, t)) {
                        if (dist(endpoint, j.goal) > 0.08 || !path.length)
                            path.push(copy(j.goal));
                    }
                    j.s.battle.pathState = reached
                        ? "complete"
                        : path.length
                            ? "partial"
                            : "unreachable";
                    j.s.battle.pathGoal = copy(j.goal);
                    j.s.battle.path = path;
                    j.s.battle.pending = false;
                    this.completed++;
                    this.jobs.shift();
                }
                else
                    this.jobs.push(this.jobs.shift());
            }
        }
    }
    AegisCombat.Navigation = Navigation;
    function create({ THREE: T, world, squad, visible }) {
        const nav = new Navigation(world), boards = new Map(), stats = {
            checks: 0,
            shots: 0,
            decisions: 0,
            friendlyBlocks: 0,
            hearing: 0,
            coverTests: 0,
        };
        let tokens = 0, clock = -1, active = null;
        const origin = new T.Vector3(), target = new T.Vector3();
        // Cached roster per team and a coarse bucket grid for local queries (separation, neighbours).
        const lists = {}, grid = new Map(), GC = 8, tmp = [];
        let gridAt = -1;
        const ix = (s) => s._ix === undefined ? (s._ix = squad.indexOf(s)) : s._ix, teamOf = (k) => lists[k] || (lists[k] = squad.filter((a) => team(a) === k)), foe = (k) => (k === "delta" ? "alpha" : "delta"), over = () => !!globalThis.GTeams?.isOver?.();
        function rebuild(t) {
            if (t - gridAt < 0.2)
                return;
            gridAt = t;
            for (const v of grid.values())
                v.length = 0;
            for (const a of squad) {
                if (!alive(a))
                    continue;
                const p = a.ctrl.pos, key = Math.floor(p.x / GC) * 4096 + Math.floor(p.z / GC);
                let v = grid.get(key);
                if (!v)
                    grid.set(key, (v = []));
                v.push(a);
            }
        }
        function nearby(p, r) {
            tmp.length = 0;
            const x1 = Math.floor((p.x + r) / GC), z1 = Math.floor((p.z + r) / GC);
            for (let x = Math.floor((p.x - r) / GC); x <= x1; x++)
                for (let z = Math.floor((p.z - r) / GC); z <= z1; z++) {
                    const v = grid.get(x * 4096 + z);
                    if (v)
                        for (const a of v)
                            tmp.push(a);
                }
            return tmp;
        }
        const board = (s) => {
            const k = team(s);
            if (!boards.has(k))
                boards.set(k, { contacts: new Map(), claims: new Map() });
            return boards.get(k);
        };
        function state(s, t) {
            return (s.battle ||
                (s.battle = {
                    next: t + (ix(s) % 6) * 0.045,
                    path: [],
                    pathAt: 0,
                    shotAt: 0,
                    target: null,
                    los: false,
                    seenAt: -100,
                    memory: null,
                    pending: false,
                    mode: "idle",
                    goal: null,
                    cover: null,
                    coverAt: 0,
                    suppression: 0,
                    burst: 0,
                    role: Math.max(0, teamOf(team(s)).indexOf(s)) % 3,
                    prevPos: copy(s.ctrl.pos),
                    stuck: 0,
                    acquired: 0,
                    searchAt: t,
                    wish: new T.Vector2(),
                }));
        }
        const eyeHeight = (s) => Math.max(0.3, (s.char.metrics?.eyeY || 1.62) -
            0.5 * (s.ctrl.crouch || 0) -
            1.15 * (s.ctrl.prone || 0));
        const torsoHeight = (s) => Math.max(0.22, 1.25 - 0.5 * (s.ctrl.crouch || 0) - 0.95 * (s.ctrl.prone || 0));
        function los(a, b, ah = 1.45, bh = 1.25) {
            if (tokens <= 0)
                return null;
            tokens--;
            stats.checks++;
            origin.set(a.x, a.y + ah, a.z);
            target.set(b.x, b.y + bh, b.z);
            return visible(origin, target);
        }
        function perception(s, b, t) {
            const p = s.ctrl.pos, candidates = [];
            for (const q of teamOf(foe(team(s)))) {
                if (q === s || !alive(q))
                    continue;
                const d = dist(p, q.ctrl.pos);
                if (d > 120)
                    continue;
                const dx = q.ctrl.pos.x - p.x, dz = q.ctrl.pos.z - p.z, facing = (-Math.sin(s.ctrl.yaw) * dx - Math.cos(s.ctrl.yaw) * dz) /
                    Math.max(0.1, d);
                if (d > 9 && facing < 0.26)
                    continue;
                candidates.push({ q, score: 130 - d + (q === b.target ? 20 : 0) });
            }
            candidates.sort((a, b) => b.score - a.score);
            b.los = false;
            for (const { q } of candidates.slice(0, 3)) {
                const seen = los(p, q.ctrl.pos, eyeHeight(s), torsoHeight(q));
                if (seen) {
                    if (b.target !== q)
                        b.acquired = t;
                    b.target = q;
                    b.los = true;
                    b.seenAt = t;
                    b.memory = copy(q.ctrl.pos);
                    b.aimHeight = torsoHeight(q);
                    board(s).contacts.set(q, {
                        p: copy(q.ctrl.pos),
                        height: b.aimHeight,
                        at: t,
                        source: s,
                    });
                    break;
                }
                if (seen === null)
                    break;
            }
            if (b.target && !alive(b.target)) {
                b.target = null;
                b.los = false;
            }
            if (!b.los) {
                let report = null;
                for (const [q, c] of board(s).contacts) {
                    if (t - c.at > 9 || !alive(q)) {
                        board(s).contacts.delete(q);
                        continue;
                    }
                    if (c.source !== s && (!report || c.at > report.at))
                        report = c;
                }
                if (report && report.at > b.seenAt) {
                    b.memory = copy(report.p);
                    b.aimHeight = report.height || 1.25;
                    b.seenAt = report.at;
                }
            }
            if (t - b.seenAt > 10) {
                b.memory = null;
                b.target = null;
                b.cover = null;
            }
            b.suppression = Math.max(0, b.suppression - 0.12);
            if (s.tac && t < s.tac.until)
                b.suppression = Math.min(1, b.suppression + 0.35);
        }
        function cover(s, b, t) {
            if (t < b.coverAt)
                return b.cover;
            b.coverAt = t + 2.4;
            const enemy = b.memory;
            if (!enemy)
                return null;
            let best = null, score = -Infinity;
            const p = s.ctrl.pos, bb = board(s);
            for (let k = 0; k < 16; k++) {
                const a = (k * Math.PI) / 8 + (b.role - 1) * 0.4, r = k % 2 ? 4 : 7, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, y = world.heightAt(x, z), candidate = { x, y, z }, g = nav.grid(candidate);
                const surface = globalThis.GNavigation?.get(world);
                if (surface?.query) {
                    const q = surface.nearest({ x, y: p.y, z }, 0.25, 0.5);
                    if (!q)
                        continue;
                    candidate.y = q.point.y;
                }
                else if (!nav.walk(g.x, g.z, t))
                    continue;
                const key = g.x + "," + g.z + "," + Math.round(candidate.y * 2), claim = bb.claims.get(key);
                if (claim && claim.s !== s && claim.until > t)
                    continue;
                const dx = enemy.x - x, dz = enemy.z - z, L = Math.hypot(dx, dz) || 1;
                let shield = false;
                for (const d of [0.65, 1.05, 1.6]) {
                    stats.coverTests++;
                    if (world.blocked?.(x + (dx / L) * d, z + (dz / L) * d, candidate.y + 0.35, 0.12)) {
                        shield = true;
                        break;
                    }
                }
                if (!shield)
                    continue;
                const val = 15 -
                    dist(p, candidate) -
                    Math.abs(dist(candidate, enemy) - 30) * 0.06;
                if (val > score) {
                    best = { ...candidate, key };
                    score = val;
                }
            }
            if (best) {
                bb.claims.set(best.key, { s, until: t + 4 });
                b.cover = best;
            }
            return best;
        }
        // Guards and followers do not chase contacts beyond their leash (set by GTeams orders).
        const leashed = (s, m) => {
            const L = s.order?.leash;
            return !!L && Math.hypot(m.x - L.x, m.z - L.z) > L.r;
        };
        const tree = new Selector([
            new Sequence([
                cond((c) => !!(c.s.ctrl.treating ||
                    c.s.ctrl.dragging ||
                    c.s.thr?.mode ||
                    (c.s.tac && !["idle", "advance"].includes(c.s.tac.mode)))),
                act((c) => {
                    c.b.mode = "medical-or-threat";
                    c.s.combatAim = null;
                }),
            ]),
            new Sequence([
                cond((c) => !!c.s.ctrl.jam),
                act((c) => {
                    c.b.mode = "clear-jam";
                    c.b.goal = c.b.memory ? cover(c.s, c.b, c.t) : null;
                    if (c.s.ctrl.reload < 0)
                        c.s.ctrl.startClear?.();
                    c.s.combatAim = null;
                }),
            ]),
            new Sequence([
                cond((c) => c.s.ctrl.ammo <= 0),
                act((c) => {
                    const ctrl = c.s.ctrl;
                    c.b.mode = ctrl.reserve > 0 ? "reload" : "no-ammo";
                    if (ctrl.reserve > 0 && ctrl.reload < 0)
                        ctrl.startReload();
                    c.b.goal = c.b.memory ? cover(c.s, c.b, c.t) : null;
                    ctrl.aiCrouch = true;
                    c.s.combatAim = null;
                }),
            ]),
            new Sequence([
                cond((c) => !!c.b.memory &&
                    (c.b.suppression > 0.35 || (c.s.ctrl.shockK || 0) > 0.45)),
                act((c) => {
                    c.b.mode = "take-cover";
                    c.b.goal = cover(c.s, c.b, c.t);
                    c.s.ctrl.aiCrouch = !c.b.goal || dist(c.s.ctrl.pos, c.b.goal) < 1.2;
                    c.s.ctrl.aiProne = c.b.suppression > 0.8 && !c.b.goal;
                }),
            ]),
            new Sequence([
                cond((c) => c.b.los),
                act((c) => {
                    const b = c.b, p = c.s.ctrl.pos, e = b.memory, d = dist(p, e), overwatch = teamOf(team(c.s)).some((a) => a !== c.s &&
                        alive(a) &&
                        a.battle?.los &&
                        (a.battle.role === 0 || a.battle.mode === "overwatch"));
                    if (d < 13) {
                        const dx = (p.x - e.x) / Math.max(1, d), dz = (p.z - e.z) / Math.max(1, d);
                        b.mode = "disengage";
                        b.goal = { x: p.x + dx * 5, z: p.z + dz * 5, y: p.y };
                    }
                    else if (b.role === 0 || !overwatch || d < 28) {
                        b.mode = "overwatch";
                        b.goal = null;
                        c.s.ctrl.aiCrouch = true;
                    }
                    else {
                        b.mode = b.role === 1 ? "flank" : "bound";
                        const dx = p.x - e.x, dz = p.z - e.z, L = Math.hypot(dx, dz) || 1, sign = b.role === 1 ? 1 : -1;
                        b.goal = {
                            x: e.x + (dx / L) * 24 - (dz / L) * 12 * sign,
                            z: e.z + (dz / L) * 24 + (dx / L) * 12 * sign,
                            y: e.y,
                        };
                        if (Math.floor(c.t / 4) % 2 !== b.role % 2) {
                            b.mode = "overwatch";
                            b.goal = null;
                        }
                    }
                }),
            ]),
            new Sequence([
                cond((c) => !!c.b.memory && !leashed(c.s, c.b.memory)),
                act((c) => {
                    c.b.mode = "investigate";
                    c.b.goal = copy(c.b.memory);
                    if (dist(c.s.ctrl.pos, c.b.memory) < 2 &&
                        Math.abs(c.s.ctrl.pos.y - c.b.memory.y) < 0.6) {
                        c.b.goal = null;
                        c.b.mode = "search";
                        c.s.idleYaw += (c.t - c.b.searchAt) * 0.3;
                        c.b.searchAt = c.t;
                        if (c.t - c.b.seenAt > 7)
                            c.b.memory = null;
                    }
                }),
            ]),
            act((c) => {
                c.b.mode = "regroup";
                const o = c.s.order;
                if (o && c.t < o.until) {
                    const b = c.b;
                    b.mode = o.mode;
                    b.goal = o.goal;
                    b.speed = o.speed || 1;
                    b.sprint = !!o.sprint;
                    if (o.face !== undefined && (!o.goal || dist(c.s.ctrl.pos, o.goal) < 1.2))
                        c.s.idleYaw = o.face;
                    return;
                }
                const leader = c.active && alive(c.active) && team(c.active) === team(c.s)
                    ? c.active
                    : squad.find((a) => alive(a) && team(a) === team(c.s));
                c.b.goal = null;
                if (leader && leader !== c.s) {
                    const i = squad.filter((a) => team(a) === team(c.s)).indexOf(c.s), side = i % 2 ? 1 : -1, back = 3 + Math.floor(i / 2) * 1.7, p = leader.ctrl.pos, yaw = leader.ctrl.yaw, p2 = {
                        x: p.x + Math.cos(yaw) * side * 2.2 + Math.sin(yaw) * back,
                        z: p.z - Math.sin(yaw) * side * 2.2 + Math.cos(yaw) * back,
                        y: p.y,
                    };
                    if (dist(c.s.ctrl.pos, p2) > 2 ||
                        Math.abs(c.s.ctrl.pos.y - p2.y) > 0.5)
                        c.b.goal = p2;
                }
                else if (world.mapId) {
                    const enemyBase = world.bases?.[team(c.s) === "delta" ? "alpha" : "delta"];
                    const bounds = nav.bounds;
                    const objective = enemyBase
                        ? {
                            x: enemyBase.x,
                            z: enemyBase.z,
                            y: world.heightAt(enemyBase.x, enemyBase.z),
                        }
                        : {
                            x: (bounds.x0 + bounds.x1) / 2,
                            z: (bounds.z0 + bounds.z1) / 2,
                            y: 0,
                        };
                    c.b.mode = "advance-objective";
                    c.b.goal = objective;
                    if (dist(c.s.ctrl.pos, objective) < 5) {
                        const phase = Math.floor(c.t / 9) % 4, angle = (phase * Math.PI) / 2;
                        c.b.mode = "patrol";
                        c.b.goal = {
                            x: objective.x + Math.cos(angle) * 7,
                            z: objective.z + Math.sin(angle) * 7,
                            y: objective.y,
                        };
                    }
                }
                else {
                    c.b.mode = "scan";
                    c.s.idleYaw = Math.sin(c.t * 0.13) * 1.1 + (c.s.formYaw || 0);
                }
            }),
        ]);
        function update(t, a) {
            if (clock === t)
                return;
            clock = t;
            active = a;
            tokens = 8 + Math.ceil(squad.length / 10);
            rebuild(t);
            nav.process(t, 320);
            for (const bb of boards.values())
                for (const [key, claim] of bb.claims)
                    if (claim.until < t || !alive(claim.s))
                        bb.claims.delete(key);
        }
        function steer(s, b, dt, t) {
            const c = s.ctrl;
            if (!b.goal) {
                c.aiWish = null;
                b.path = [];
                return;
            }
            const surface = globalThis.GNavigation?.get(world);
            const near = (p, r = 0.4) => dist(c.pos, p) < r && Math.abs(c.pos.y - p.y) < 0.3;
            const sameGoal = b.pathGoal &&
                dist(b.pathGoal, b.goal) < 0.25 &&
                Math.abs(b.pathGoal.y - b.goal.y) < 0.25;
            const projectedEnd = surface &&
                sameGoal &&
                b.pathEndpoint &&
                b.pathGeneration === surface.generation &&
                ["projected", "partial"].includes(b.pathState) &&
                near(b.pathEndpoint);
            if ((dist(c.pos, b.goal) < 0.65 && Math.abs(c.pos.y - b.goal.y) < 0.35) ||
                projectedEnd) {
                c.aiWish = null;
                b.path = [];
                return;
            }
            if (t >= b.pathAt && !b.pending) {
                b.pathAt = t + 1.5 + (ix(s) % 4) * 0.13;
                nav.request(s, b.goal, t);
            }
            while (b.path.length && near(b.path[0], surface?.query ? 0.22 : 0.65))
                b.path.shift();
            let p = b.path[0];
            if (!p) {
                if (!nav.clearLine(c.pos, b.goal, t)) {
                    c.aiWish = null;
                    return;
                }
                p = b.goal;
            }
            if (b.path.length > 1 &&
                dist(c.pos, b.path[1]) < 2.4 &&
                nav.clearLine(c.pos, b.path[1], t))
                p = b.path[1];
            let mx = p.x - c.pos.x, mz = p.z - c.pos.z;
            const L = Math.hypot(mx, mz) || 1;
            mx /= L;
            mz /= L;
            for (const q of nearby(c.pos, 1.2)) {
                if (q === s || !alive(q))
                    continue;
                const dx = c.pos.x - q.ctrl.pos.x, dz = c.pos.z - q.ctrl.pos.z, d = Math.hypot(dx, dz);
                if (d < 1.2 && d > 0.01 && Math.abs(c.pos.y - q.ctrl.pos.y) < 0.9) {
                    const w = (1.2 - d) * 0.9;
                    mx += (dx / d) * w;
                    mz += (dz / d) * w;
                    // Deterministic passing side breaks symmetric head-on deadlocks.
                    if (d < 0.95 && team(q) === team(s)) {
                        const side = ix(s) < ix(q) ? 1 : -1;
                        mx += (-dz / d) * w * 0.65 * side;
                        mz += (dx / d) * w * 0.65 * side;
                    }
                }
            }
            const len = Math.max(1, Math.hypot(mx, mz));
            mx /= len;
            mz /= len;
            // Brake before tight corners rather than overshooting a portal at full speed.
            const speed = (surface ? Math.max(0.22, Math.min(1, L / 1.0)) : 1) * (b.speed || 1);
            b.wish.set((mx * Math.cos(c.yaw) - mz * Math.sin(c.yaw)) * speed, (mx * Math.sin(c.yaw) + mz * Math.cos(c.yaw)) * speed);
            c.aiWish = b.wish;
            c.aiSprint =
                (b.mode === "regroup" || b.sprint) && dist(c.pos, b.goal) > 13;
            if (b.mode !== "take-cover")
                c.aiCrouch = false;
            if (!b.los)
                s.idleYaw = Math.atan2(-mx, -mz);
            if (dist(c.pos, b.prevPos) < 0.025)
                b.stuck += dt;
            else
                b.stuck = 0;
            Object.assign(b.prevPos, c.pos);
            if (b.stuck > 1.3) {
                b.pathAt = 0;
                b.path = [];
                b.stuck = 0;
                nav.cache.clear();
                nav.edgeCache.clear();
            }
        }
        function drive(s, dt, t, a) {
            update(t, a);
            if (s === a || !alive(s)) {
                if (s === a)
                    s.combatAim = null;
                return;
            }
            const c = s.ctrl, b = state(s, t);
            if (over()) {
                c.aiWish = null;
                c.aiADS = false;
                s.combatAim = null;
                return;
            }
            if (t >= b.next && tokens > 0) {
                // Off-screen or distant bots think at a lower rate.
                b.next =
                    t + (s._lodI > 0.2 ? 0.55 : 0.23) + (ix(s) % 3) * 0.017;
                b.speed = 1;
                b.sprint = false;
                perception(s, b, t);
                c.aiWish = null;
                c.aiSprint = false;
                c.aiProne = false;
                c.aiCrouch = false;
                tree.tick({ s, b, t, active: a });
                stats.decisions++;
            }
            c.aiADS = !!(b.los &&
                b.memory &&
                !c.jam &&
                c.reload < 0 &&
                !["medical-or-threat", "take-cover", "disengage"].includes(b.mode));
            if (b.mode === "medical-or-threat" || s.tmBusy > t) {
                c.aiADS = false;
                if (s.tmBusy > t)
                    c.aiWish = null;
                return;
            }
            if (s.thr?.mode ||
                c.treating ||
                c.dragging ||
                (s.tac && t < s.tac.until)) {
                s.combatAim = null;
                return;
            }
            c.aiReady = b.memory ? 1 : 0.6;
            steer(s, b, dt, t);
            if (b.memory && b.target && b.los) {
                const d = dist(c.pos, b.memory), dx = b.memory.x - c.pos.x, dz = b.memory.z - c.pos.z;
                s.idleYaw = Math.atan2(-dx, -dz);
                s.combatAim = {
                    pitch: Math.atan2(b.memory.y + (b.aimHeight || 1.25) - c.pos.y - eyeHeight(s), Math.max(0.1, d)),
                    target: b.target,
                    // Keep the observed point immutable; do not track hidden target motion.
                    point: {
                        x: b.memory.x,
                        y: b.memory.y + (b.aimHeight || 1.25),
                        z: b.memory.z,
                    },
                };
            }
            else
                s.combatAim = null;
        }
        let fireStart = 0;
        function fire(t) {
            if (over())
                return;
            let shots = 0;
            const n = squad.length;
            fireStart = (fireStart + 1) % n;
            for (let k = 0; k < n; k++) {
                const s = squad[(k + fireStart) % n];
                if (shots >= 6)
                    break; // cap simultaneous bot shots (FX/audio load) per frame
                const b = s.battle, c = s.ctrl;
                if (s === active ||
                    !alive(s) ||
                    !b?.los ||
                    !s.combatAim ||
                    t - b.seenAt > 0.35 ||
                    t < b.shotAt ||
                    t - b.acquired < 0.3 + b.suppression * 0.5 ||
                    !s.gun ||
                    c.treating ||
                    c.reload >= 0 ||
                    s.tmBusy > t ||
                    s.thr?.mode)
                    continue;
                const q = b.target;
                if (!q || !alive(q))
                    continue;
                const dx = b.memory.x - c.pos.x, dz = b.memory.z - c.pos.z, L2 = dx * dx + dz * dz;
                if (L2 < 0.1)
                    continue;
                const yaw = Math.atan2(-dx, -dz), error = Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw));
                if (Math.abs(error) > 0.055 + b.suppression * 0.025)
                    continue;
                let blocked = false;
                for (const a of teamOf(team(s))) {
                    if (a === s || !alive(a))
                        continue;
                    const ax = a.ctrl.pos.x - c.pos.x, az = a.ctrl.pos.z - c.pos.z, u = (ax * dx + az * dz) / L2;
                    const lineY = c.pos.y +
                        eyeHeight(s) +
                        u * (b.memory.y + (b.aimHeight || 1.25) - c.pos.y - eyeHeight(s));
                    if (u > 0 &&
                        u < 1 &&
                        Math.hypot(ax - u * dx, az - u * dz) < 0.85 &&
                        lineY > a.ctrl.pos.y - 0.1 &&
                        lineY < a.ctrl.pos.y + eyeHeight(a) + 0.2) {
                        blocked = true;
                        break;
                    }
                }
                if (blocked) {
                    stats.friendlyBlocks++;
                    continue;
                }
                const seen = los(c.pos, q.ctrl.pos, eyeHeight(s), torsoHeight(q));
                if (seen !== true) {
                    if (seen === false)
                        b.los = false;
                    continue;
                }
                if (s.gun.gun && typeof c.ads === "number") {
                    const range = Math.sqrt(L2);
                    // Close hip fire is allowed, but never fire a lowered retreating gun.
                    if ((range > 6 && (!c.aiADS || c.ads < 0.8)) || (c.ready ?? 0) < 0.85)
                        continue;
                }
                if (c.canFire()) {
                    c.fire(t);
                    stats.shots++;
                    shots++;
                    b.burst++;
                    b.shotAt =
                        t +
                            (b.burst >= 3
                                ? 0.65 + b.suppression * 0.7
                                : 0.14 + (ix(s) % 3) * 0.025);
                    if (b.burst >= 3)
                        b.burst = 0;
                    hear(c.pos, s, t, 65);
                }
                else if (c.ammo <= 0 && c.reserve > 0)
                    c.startReload();
            }
        }
        function hear(p, source, t, radius = 55) {
            for (const s of teamOf(foe(team(source)))) {
                if (s === source || !alive(s) || dist(s.ctrl.pos, p) > radius)
                    continue;
                const b = state(s, t);
                if (t - b.seenAt < 1)
                    continue;
                const seed = ix(s) * 2.399;
                b.memory = {
                    x: p.x + Math.cos(seed) * 3,
                    y: p.y,
                    z: p.z + Math.sin(seed) * 3,
                };
                b.seenAt = t - 2;
                s.idleYaw = Math.atan2(-(p.x - s.ctrl.pos.x), -(p.z - s.ctrl.pos.z));
                stats.hearing++;
            }
        }
        return {
            drive,
            fire,
            update,
            hear,
            stats: () => ({
                ...stats,
                paths: nav.completed,
                expanded: nav.expanded,
                queued: nav.jobs.length,
                cachedNav: nav.cache.size,
                navigation: globalThis.GNavigation?.get(world)?.stats() || {
                    backend: "grid-fallback",
                },
                modes: squad.map((s) => ({
                    key: s.key,
                    mode: s.battle?.mode,
                    role: s.battle?.role,
                })),
            }),
            debug: { nav, tree },
        };
    }
    AegisCombat.create = create;
    AegisCombat.test = { Heap, Status, Sequence, Selector, Action, Navigation };
})(AegisCombat || (AegisCombat = {}));
globalThis.GCombat = AegisCombat;
