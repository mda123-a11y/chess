"use strict";
/** Collision-verified climbing: perception and movement both use the Rapier scene. */
var AegisTraversal;
(function (AegisTraversal) {
    const root = globalThis, T = () => root.THREE;
    const smooth = (x) => {
        x = Math.max(0, Math.min(1, x));
        return x * x * (3 - 2 * x);
    };
    function tryStart(c, world, phys) {
        if (c.vault ||
            c.treating ||
            c.dragging ||
            c.reload >= 0 ||
            c.injLeg ||
            c.injArm ||
            c.stamina < 0.9 ||
            !c.grounded)
            return false;
        const physics = root.GPhysics.get(world), dx = -Math.sin(c.yaw), dz = -Math.cos(c.yaw), start = c.pos.clone();
        // Update query broadphase before the very first probe.
        physics.sim.propagateModifiedBodyPositionsToColliders();
        const wall = physics.ray({ x: start.x, y: start.y + 0.43, z: start.z }, { x: dx, y: 0, z: dz }, 1.06);
        if (!wall || wall.normal.y > 0.6)
            return false;
        const near = wall.timeOfImpact + 0.16, x = start.x + dx * near, z = start.z + dz * near;
        const topHit = physics.support(x, z, start.y + phys.vaultMax + 0.15, phys.vaultMax + 0.5);
        if (!topHit)
            return false;
        const top = topHit.y, h = top - start.y;
        if (h <= phys.stepUp || h > phys.vaultMax)
            return false;
        let exit = near;
        while (exit < near + 2.7) {
            const p = physics.support(start.x + dx * exit, start.z + dz * exit, top + 0.13, h + 0.7);
            if (!p || p.y < top - 0.28)
                break;
            exit += 0.13;
        }
        const thin = exit - near < 0.95;
        let kind = thin ? "over" : "mantle", distance = thin ? exit + 0.48 : near + 0.35;
        let landing = physics.support(start.x + dx * distance, start.z + dz * distance, top + 0.15, h + 2);
        if (!landing || top - landing.y > 1.65)
            return false;
        const end = new (T().Vector3)(start.x + dx * distance, landing.y + 0.015, start.z + dz * distance);
        const apex = Math.max(top + 0.06, end.y), height = 0.94;
        if (!physics.fits(c, { x: start.x, y: apex, z: start.z }, height) ||
            !physics.fits(c, { x: end.x, y: apex, z: end.z }, height))
            return false;
        if (!physics.fits(c, end, 1.15)) {
            kind = "mantle";
            distance = near + 0.28;
            landing = physics.support(start.x + dx * distance, start.z + dz * distance, top + 0.15, 0.3);
            if (!landing)
                return false;
            end.set(start.x + dx * distance, landing.y + 0.015, start.z + dz * distance);
            if (!physics.fits(c, end, height))
                return false;
        }
        // Check the entire swept corridor, not just start and landing capsules.
        for (let i = 0; i <= 12; i++) {
            const q = start.clone().lerp(end, i / 12);
            q.y = apex;
            if (!physics.fits(c, q, height))
                return false;
        }
        const hands = {};
        for (const side of ["R", "L"]) {
            const sg = side === "R" ? 1 : -1, hx = x + Math.cos(c.yaw) * sg * 0.17, hz = z - Math.sin(c.yaw) * sg * 0.17;
            const support = physics.support(hx, hz, top + 0.15, 0.3);
            if (!support ||
                Math.abs(support.y - top) > 0.08 ||
                support.normal.y < 0.7)
                return false;
            hands[side] = { x: hx, y: support.y + 0.045, z: hz };
        }
        c.vault = {
            t: 0,
            dur: 0.95 + h * 0.4,
            kind,
            h,
            top,
            p0: start,
            p1: end,
            apex,
            dx,
            dz,
            v0: Math.hypot(c.vel.x, c.vel.z),
            blockedT: 0,
            rapier: true,
            hands,
            supportCollider: topHit.collider,
        };
        c.stamina = Math.max(0, c.stamina - 0.7 - h * 0.9);
        c.vel.set(0, 0, 0);
        c._motorVX = 0;
        c._motorVZ = 0;
        c.ads = 0;
        c._traversalHeight = height;
        return true;
    }
    AegisTraversal.tryStart = tryStart;
    function update(c, world, dt) {
        const a = c.vault;
        if (!a || dt <= 0)
            return;
        if (a.supportCollider && !a.supportCollider.isValid()) {
            c.vault = null;
            c._traversalHeight = undefined;
            c._vaultHands = null;
            c.vaultTuck = 0;
            c.vaultRoll = 0;
            c.grounded = false;
            c._vaultResult = "support-lost";
            return;
        }
        const p = root.GPhysics.get(world), old = c.pos.clone();
        a.t = Math.min(a.dur, a.t + dt);
        const u = a.t / a.dur;
        // Lift clear BEFORE moving across: no authored teleport through the obstacle.
        const x = smooth((u - 0.48) / 0.34), up = smooth((u - 0.2) / 0.28), down = smooth((u - 0.82) / 0.18);
        const desired = a.p0.clone().lerp(a.p1, x);
        desired.y =
            u < 0.48
                ? a.p0.y + (a.apex - a.p0.y) * up
                : u < 0.82
                    ? a.apex
                    : a.apex + (a.p1.y - a.apex) * down;
        p.displace(c, desired.clone().sub(old), dt);
        const error = c.pos.distanceTo(desired);
        a.blockedT = error > 0.055 ? a.blockedT + dt : 0;
        c.vaultTuck = Math.sin(Math.PI * u) * 0.45;
        c.vaultRoll = Math.sin(Math.PI * u) * 0.06;
        c.speed = 0;
        c.vel.set(0, 0, 0);
        if (a.blockedT > 0.12 || u >= 1) {
            const success = a.blockedT <= 0.12 && c.pos.distanceTo(a.p1) < 0.14;
            c.vault = null;
            c._vaultHands = null;
            c._traversalHeight = undefined;
            c.vaultTuck = 0;
            c.vaultRoll = 0;
            c.grounded = false;
            c.landV = (c.landV || 0) - (success ? 0.65 : 0);
            c._motorVX = 0;
            c._motorVZ = 0;
            c._vaultResult = success ? "landed" : "blocked";
        }
    }
    AegisTraversal.update = update;
})(AegisTraversal || (AegisTraversal = {}));
globalThis.GTraversal = AegisTraversal;
