/** Rapier owns character collision and articulated rigid-body dynamics.
 * Existing skeleton/skin and analytic weapon IK are presentation, not a second solver. */
namespace AegisPhysics {
  const root: any = globalThis,
    R: any = root.RAPIER;
  export const ready: Promise<void> = R.init();
  type V = { x: number; y: number; z: number };
  const v = (x = 0, y = 0, z = 0): V => ({ x, y, z }),
    sub = (a: V, b: V) => v(a.x - b.x, a.y - b.y, a.z - b.z);
  const sessions = new WeakMap<object, Session>();
  let latest: Session | null = null;
  const GROUP_STATIC = 0x0001fffe,
    GROUP_ACTOR = 0x0002000f,
    GROUP_RAGDOLL = 0x0004000f;
  export function get(world: any): Session {
    let s = sessions.get(world);
    if (!s) {
      s = new Session(world);
      sessions.set(world, s);
    }
    latest = s;
    return s;
  }
  export function stats() {
    return latest?.stats();
  }
  export function translate(s: any, dx: number, dy: number, dz: number) {
    if (s.ctrl?._physicsWorld)
      get(s.ctrl._physicsWorld).translate(s, dx, dy, dz);
  }
  class Session {
    sim: any;
    terrain: any;
    acc = 0;
    alpha = 0;
    steps = 0;
    dropped = 0;
    actors = new Map<any, any>();
    ragdolls = new Map<any, any>();
    poseMotors = new Map<any, any>();
    objects = new Map<any, any>();
    poseSteps = 0;
    statics: any[] = [];
    navRevision = 0;
    constructor(public world: any) {
      this.sim = new R.World(v(0, -9.81, 0));
      this.sim.timestep = 1 / 60;
      this.sim.numSolverIterations = 8;
      this.sim.numInternalPgsIterations = 2;
      const b = world.bounds || { x0: -60, x1: 60, z0: -65, z1: 65 };
      // Winding faces upward. Finite terrain, no infinite floor above pits.
      const nx = Math.min(256, Math.max(2, Math.ceil(b.x1 - b.x0))),
        nz = Math.min(256, Math.max(2, Math.ceil(b.z1 - b.z0)));
      const verts = new Float32Array((nx + 1) * (nz + 1) * 3),
        indices = new Uint32Array(nx * nz * 6);
      for (let z = 0; z <= nz; z++)
        for (let x = 0; x <= nx; x++) {
          const i = (z * (nx + 1) + x) * 3,
            px = b.x0 + ((b.x1 - b.x0) * x) / nx,
            pz = b.z0 + ((b.z1 - b.z0) * z) / nz;
          verts[i] = px;
          verts[i + 1] = world.heightAt(px, pz);
          verts[i + 2] = pz;
        }
      for (let z = 0, k = 0; z < nz; z++)
        for (let x = 0; x < nx; x++) {
          const a = z * (nx + 1) + x,
            c = a + nx + 1;
          indices.set([a, c, a + 1, a + 1, c, c + 1], k);
          k += 6;
        }
      this.terrain = this.sim.createCollider(
        R.ColliderDesc.trimesh(verts, indices, R.TriMeshFlags.FIX_INTERNAL_EDGES)
          .setFriction(0.85)
          .setCollisionGroups(GROUP_STATIC),
      );
      for (const c of world.colliders || []) {
        if (c.source?.dead) continue;
        let desc: any;
        const x = c.type === "box" ? (c.x0 + c.x1) / 2 : c.x,
          z = c.type === "box" ? (c.z0 + c.z1) / 2 : c.z;
        const lo = c.y0 ?? world.heightAt(x, z),
          hi = c._top ?? (c.step ? c.h : world.heightAt(x, z) + (c.h || 2)),
          h = hi - lo;
        if (!Number.isFinite(h) || h < 0.015) continue;
        if (c.type === "box") {
          const o = c.obb;
          desc = R.ColliderDesc.cuboid(
            Math.max(0.01, o ? o.hw : (c.x1 - c.x0) / 2),
            h / 2,
            Math.max(0.01, o ? o.hd : (c.z1 - c.z0) / 2),
          );
          desc.setTranslation(o ? o.x : x, lo + h / 2, o ? o.z : z);
          if (o) {
            const a = Math.atan2(o.s, o.c);
            desc.setRotation({
              x: 0,
              y: Math.sin(a / 2),
              z: 0,
              w: Math.cos(a / 2),
            });
          }
        } else if (c.type === "cyl")
          desc = R.ColliderDesc.cylinder(
            h / 2,
            Math.max(0.015, c.r),
          ).setTranslation(x, lo + h / 2, z);
        else continue;
        this.statics.push({
          source: c.source,
          col: this.sim.createCollider(
            desc.setFriction(0.8).setCollisionGroups(GROUP_STATIC),
          ),
        });
      }
    }
    /** Export fixed collider surfaces, not visual LOD meshes. Winding is outward. */
    navigationGeometry() {
      const positions: number[] = [],
        indices: number[] = [];
      const add = (col: any, vs: ArrayLike<number>, ts: ArrayLike<number>) => {
        const offset = positions.length / 3,
          q = col.rotation(),
          p = col.translation();
        for (let i = 0; i < vs.length; i += 3) {
          const x = vs[i],
            y = vs[i + 1],
            z = vs[i + 2];
          const tx = 2 * (q.y * z - q.z * y),
            ty = 2 * (q.z * x - q.x * z),
            tz = 2 * (q.x * y - q.y * x);
          positions.push(
            p.x + x + q.w * tx + q.y * tz - q.z * ty,
            p.y + y + q.w * ty + q.z * tx - q.x * tz,
            p.z + z + q.w * tz + q.x * ty - q.y * tx,
          );
        }
        for (let i = 0; i < ts.length; i += 3) {
          if (
            col.handle === this.terrain.handle &&
            this.world.waterY !== undefined &&
            [ts[i], ts[i + 1], ts[i + 2]].some(
              (j) => positions[(offset + j) * 3 + 1] < this.world.waterY - 0.25,
            )
          )
            continue;
          indices.push(offset + ts[i], offset + ts[i + 1], offset + ts[i + 2]);
        }
      };
      this.sim.forEachCollider((col: any) => {
        if (!((col.collisionGroups() >>> 16) & 1) || col.isSensor()) return;
        const shape = col.shape;
        if (shape.type === R.ShapeType.TriMesh) {
          add(col, shape.vertices, shape.indices);
          return;
        }
        if (shape.type === R.ShapeType.Cuboid) {
          const h = shape.halfExtents,
            x = h.x,
            y = h.y,
            z = h.z;
          add(
            col,
            [
              -x,
              -y,
              -z,
              x,
              -y,
              -z,
              x,
              y,
              -z,
              -x,
              y,
              -z,
              -x,
              -y,
              z,
              x,
              -y,
              z,
              x,
              y,
              z,
              -x,
              y,
              z,
            ],
            [
              0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1,
              6, 5, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
            ],
          );
          return;
        }
        if (shape.type === R.ShapeType.Cylinder) {
          const vs: number[] = [],
            ts: number[] = [],
            n = 16;
          // Circumscribed polygon: navigation may be conservative, never cut a physical cylinder.
          const r = shape.radius / Math.cos(Math.PI / n),
            h = shape.halfHeight;
          for (let j = 0; j < 2; j++)
            for (let k = 0; k < n; k++)
              vs.push(
                Math.cos((k * Math.PI * 2) / n) * r,
                j ? h : -h,
                Math.sin((k * Math.PI * 2) / n) * r,
              );
          for (let k = 0; k < n; k++) {
            const a = k,
              b = (k + 1) % n;
            ts.push(a, a + n, b, b, a + n, b + n);
            if (k > 0 && k < n - 1) {
              ts.push(0, k, k + 1, n, n + k + 1, n + k);
            }
          }
          add(col, vs, ts);
        }
      });
      return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        triangles: indices.length / 3,
      };
    }
    ray(origin: V, dir: V, length: number, noGround = false) {
      return this.sim.castRayAndGetNormal(
        new R.Ray(origin, dir),
        length,
        true,
        R.QueryFilterFlags.EXCLUDE_SENSORS,
        0x00020001,
        undefined,
        undefined,
        noGround ? (col: any) => col.handle !== this.terrain.handle : undefined,
      );
    }
    support(x: number, z: number, y: number, range = 2) {
      const hit = this.ray(v(x, y, z), v(0, -1, 0), range);
      return hit
        ? {
            y: y - hit.timeOfImpact,
            normal: hit.normal,
            collider: hit.collider,
          }
        : null;
    }
    fits(c: any, feet: V, height = 1.72, radius = 0.29) {
      const a = this.actors.get(c);
      return !this.sim.intersectionWithShape(
        v(feet.x, feet.y + height / 2 + 0.02, feet.z),
        { x: 0, y: 0, z: 0, w: 1 },
        new R.Capsule(Math.max(0.01, height / 2 - radius), radius),
        R.QueryFilterFlags.EXCLUDE_SENSORS,
        0x00020001,
        a?.col,
        a?.body,
      );
    }
    displace(c: any, delta: V, dt: number) {
      const old = v(c.vel.x, c.vel.y, c.vel.z),
        a = this.actor(c);
      a.kcc.disableSnapToGround();
      c.vel.set(delta.x / dt, delta.y / dt, delta.z / dt);
      c.grounded = false;
      this.move(c, dt, 0);
      a.kcc.enableSnapToGround(0.24);
      return old;
    }
    servoPose(s: any, names: string[]): void {
      if (s.ctrl?._activeBody || root.GContacts?.has(s)) return;
      const T = root.THREE;
      let rig = this.poseMotors.get(s);
      if (!rig) {
        rig = { char: s.char, bones: new Map(), last: this.steps };
        this.poseMotors.set(s, rig);
      }
      if (rig.char !== s.char) {
        this.dropPose(s);
        return this.servoPose(s, names);
      }
      rig.last = this.steps;
      for (const name of names) {
        const bone = s.char.bone(name);
        if (!bone) continue;
        let m = rig.bones.get(name);
        if (!m) {
          const b = this.sim.createRigidBody(
            R.RigidBodyDesc.dynamic()
              .setGravityScale(0)
              .setAdditionalMassProperties(1, v(), v(1, 1, 1), {
                x: 0,
                y: 0,
                z: 0,
                w: 1,
              })
              .setRotation(bone.quaternion)
              .setCanSleep(true),
          );
          m = {
            body: b,
            target: bone.quaternion.clone(),
            prev: bone.quaternion.clone(),
            curr: bone.quaternion.clone(),
            out: new T.Quaternion(),
          };
          rig.bones.set(name, m);
        }
        const angle = m.target.angleTo(bone.quaternion);
        m.target.copy(bone.quaternion);
        if (angle > 1e-4) m.body.wakeUp();
        if (m.curr.angleTo(m.target) > 1.2) {
          m.body.setRotation(m.target, true);
          m.body.setAngvel(v(), true);
          m.curr.copy(m.target);
          m.prev.copy(m.target);
        }
        bone.quaternion.copy(m.out.copy(m.prev).slerp(m.curr, this.alpha));
      }
    }
    dropPose(s: any) {
      const rig = this.poseMotors.get(s);
      if (!rig) return;
      for (const m of rig.bones.values()) this.sim.removeRigidBody(m.body);
      this.poseMotors.delete(s);
    }
    drivePose(h: number) {
      const T = root.THREE,
        err = new T.Quaternion(),
        inverse = new T.Quaternion();
      for (const [s, rig] of this.poseMotors) {
        if (s.dead || s.finished || s.char !== rig.char) {
          this.dropPose(s);
          continue;
        }
        for (const m of rig.bones.values()) {
          m.prev.copy(m.curr);
          if (m.body.isSleeping() && m.curr.angleTo(m.target) < 1e-4) continue;
          err.copy(m.target).multiply(inverse.copy(m.curr).invert());
          if (err.w < 0) err.set(-err.x, -err.y, -err.z, -err.w);
          const len = Math.hypot(err.x, err.y, err.z),
            angle = 2 * Math.atan2(len, Math.max(0, err.w)),
            scale = len > 1e-8 ? angle / len : 0,
            omega = m.body.angvel();
          if (angle < 0.0003 && Math.hypot(omega.x, omega.y, omega.z) < 0.003) {
            m.body.resetTorques(false);
            m.body.setRotation(m.target, false);
            m.body.setAngvel(v(), false);
            m.body.sleep();
            m.curr.copy(m.target);
            m.prev.copy(m.target);
            continue;
          }
          const stiffness = 300,
            damping = 34;
          const torque = v(
            stiffness * err.x * scale - damping * omega.x,
            stiffness * err.y * scale - damping * omega.y,
            stiffness * err.z * scale - damping * omega.z,
          );
          const L = Math.hypot(torque.x, torque.y, torque.z),
            cap = L > 500 ? 500 / L : 1;
          m.body.resetTorques(false);
          m.body.addTorque(
            v(torque.x * cap, torque.y * cap, torque.z * cap),
            true,
          );
          this.poseSteps++;
        }
      }
    }
    dynamicObject(key: any, opt: any) {
      let object = this.objects.get(key);
      if (object) return object;
      const b = this.sim.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(opt.pos.x, opt.pos.y, opt.pos.z)
          .setRotation(opt.q || { x: 0, y: 0, z: 0, w: 1 })
          .setLinvel(opt.vel.x, opt.vel.y, opt.vel.z)
          .setAngvel(opt.spin || v())
          .setLinearDamping(opt.drag ?? 0.1)
          .setAngularDamping(opt.angularDamping ?? 0.3)
          .setCcdEnabled(true),
      );
      if (opt.softCcdPrediction) b.setSoftCcdPrediction(opt.softCcdPrediction);
      const desc = opt.halfExtents
        ? R.ColliderDesc.cuboid(
            opt.halfExtents.x,
            opt.halfExtents.y,
            opt.halfExtents.z,
          )
        : opt.capsule
          ? R.ColliderDesc.capsule(opt.capsule, opt.radius)
          : R.ColliderDesc.ball(opt.radius);
      if (opt.colliderRotation) desc.setRotation(opt.colliderRotation);
      const col = this.sim.createCollider(
        desc
          .setMass(opt.mass)
          .setFriction(opt.friction ?? 0.7)
          .setRestitution(opt.restitution ?? 0.25)
          .setCollisionGroups(opt.collisionGroups ?? 0x0008000f),
        b,
      );
      object = {
        body: b,
        col,
        kind: opt.kind || "object",
        reportContacts: !!opt.reportContacts,
        airAngularDamping: opt.angularDamping ?? 0.3,
        contactAngularDamping: opt.contactAngularDamping,
        settleRadius: opt.settleRadius || 0,
        settleFrames: 0,
        touching: false,
        impacts: 0,
        impactSpeed: 0,
        prev: new root.THREE.Vector3().copy(opt.pos),
        curr: new root.THREE.Vector3().copy(opt.pos),
        prevQ: new root.THREE.Quaternion().copy(
          opt.q || { x: 0, y: 0, z: 0, w: 1 },
        ),
        currQ: new root.THREE.Quaternion().copy(
          opt.q || { x: 0, y: 0, z: 0, w: 1 },
        ),
        speed: 0,
      };
      this.objects.set(key, object);
      return object;
    }
    /** Reuse a fixed-shape FX body; no body/collider allocation after pool warm-up. */
    resetObject(key: any, opt: any) {
      let o = this.objects.get(key);
      if (!o) return this.dynamicObject(key, opt);
      const q = opt.q || { x: 0, y: 0, z: 0, w: 1 };
      o.body.setEnabled(true);
      o.body.resetForces(false);
      o.body.resetTorques(false);
      o.body.setTranslation(opt.pos, true);
      o.body.setRotation(q, true);
      o.body.setLinvel(opt.vel, true);
      o.body.setAngvel(opt.spin || v(), true);
      o.prev.copy(opt.pos);
      o.curr.copy(opt.pos);
      o.prevQ.copy(q);
      o.currQ.copy(q);
      o.touching = false;
      o.impacts = 0;
      o.impactSpeed = 0;
      o.settleFrames = 0;
      return o;
    }
    disableObject(key: any) {
      const o = this.objects.get(key);
      if (o) o.body.setEnabled(false);
    }
    removeObject(key: any) {
      const o = this.objects.get(key);
      if (o) {
        this.sim.removeRigidBody(o.body);
        this.objects.delete(key);
      }
    }
    readObject(key: any, pos: any, q: any, vel?: any) {
      const o = this.objects.get(key);
      if (!o) return null;
      pos.copy(o.prev).lerp(o.curr, this.alpha);
      q.copy(o.prevQ).slerp(o.currQ, this.alpha);
      if (vel) vel.copy(o.body.linvel());
      return o;
    }
    actor(c: any) {
      if (c._activeBody) throw new Error('KCC cannot own an active-body character');
      let a = this.actors.get(c);
      if (a) return a;
      const radius = 0.3,
        half = 0.56,
        center = half + radius;
      const body = this.sim.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(
          c.pos.x,
          c.pos.y + center,
          c.pos.z,
        ),
      );
      const col = this.sim.createCollider(
        R.ColliderDesc.capsule(half, radius)
          .setCollisionGroups(GROUP_ACTOR)
          .setFriction(0),
        body,
      );
      const kcc = this.sim.createCharacterController(0.015);
      kcc.enableAutostep(0.32, 0.22, true);
      kcc.enableSnapToGround(0.24);
      kcc.setMaxSlopeClimbAngle(Math.PI * 0.26);
      kcc.setMinSlopeSlideAngle(Math.PI * 0.32);
      kcc.setApplyImpulsesToDynamicBodies(true);
      kcc.setCharacterMass(82);
      a = {
        body,
        col,
        kcc,
        center,
        half,
        lastQuery: -99,
        last: v(c.pos.x, c.pos.y, c.pos.z),
      };
      this.actors.set(c, a);
      return a;
    }
    move(c: any, dt: number, gravity: number) {
      if (root.GActiveBody?.request(this, c, dt)) return;
      const a = this.actor(c),
        r = 0.3;
      const height = Math.max(
          0.62,
          c._traversalHeight ??
            1.72 - 0.58 * (c.crouch || 0) - 1.05 * (c.prone || 0),
        ),
        half = Math.max(0.01, height / 2 - r),
        center = half + r;
      // Change actual capsule, not just the rendered posture. Standing up is overlap tested.
      if (Math.abs(half - a.half) > 0.012) {
        const shape = new R.Capsule(half, r),
          at = v(c.pos.x, c.pos.y + center, c.pos.z);
        const hit =
          half > a.half &&
          this.sim.intersectionWithShape(
            at,
            { x: 0, y: 0, z: 0, w: 1 },
            shape,
            R.QueryFilterFlags.EXCLUDE_SENSORS,
            GROUP_ACTOR,
            a.col,
            a.body,
          );
        if (!hit) {
          a.col.setShape(shape);
          a.half = half;
          a.center = center;
        }
      }
      const oldY = c.pos.y,
        was = c.grounded,
        vy = c.vel.y;
      const external =
        Math.hypot(c.pos.x - a.last.x, c.pos.y - a.last.y, c.pos.z - a.last.z) >
        0.35;
      if (external) {
        c._motorVX = c.vel.x;
        c._motorVZ = c.vel.z;
      }
      if (
        !external &&
        c.grounded &&
        Math.hypot(c.vel.x, c.vel.z) < 0.005 &&
        c.vel.y <= 0 &&
        Math.abs(half - a.half) < 0.012 &&
        this.steps - a.lastQuery < 6
      ) {
        c.speed = 0;
        return;
      }
      a.lastQuery = this.steps;
      a.body.setTranslation(v(c.pos.x, c.pos.y + a.center, c.pos.z), true);
      this.sim.propagateModifiedBodyPositionsToColliders();
      c.vel.y = was && c.vel.y <= 0 ? -0.35 : c.vel.y + gravity * dt;
      a.kcc.computeColliderMovement(
        a.col,
        v(c.vel.x * dt, c.vel.y * dt, c.vel.z * dt),
        R.QueryFilterFlags.EXCLUDE_SENSORS,
        GROUP_ACTOR,
      );
      const d = a.kcc.computedMovement();
      c.pos.x += d.x;
      c.pos.y += d.y;
      c.pos.z += d.z;
      const bounds = this.world.bounds;
      if (bounds) {
        c.pos.x = Math.max(
          bounds.x0 + 0.32,
          Math.min(bounds.x1 - 0.32, c.pos.x),
        );
        c.pos.z = Math.max(
          bounds.z0 + 0.32,
          Math.min(bounds.z1 - 0.32, c.pos.z),
        );
      }
      c.grounded = a.kcc.computedGrounded();
      if (c.grounded && c.vel.y < 0) c.vel.y = 0;
      if (dt > 0 && !external) {
        c.vel.x = d.x / dt;
        c.vel.z = d.z / dt;
      }
      c.speed = Math.hypot(c.vel.x, c.vel.z);
      if (!was && c.grounded) {
        const impact = Math.abs(vy);
        c.landK = Math.min(1, (c.landK || 0) + impact / 4.4);
        c.landV = (c.landV || 0) - impact * 0.9;
        c._air = null;
      }
      a.body.setTranslation(v(c.pos.x, c.pos.y + a.center, c.pos.z), true);
      a.body.setNextKinematicTranslation(
        v(c.pos.x, c.pos.y + a.center, c.pos.z),
      );
      Object.assign(a.last, c.pos);
    }
    removeActor(c: any) {
      const a = this.actors.get(c);
      if (!a) return;
      this.sim.removeCharacterController(a.kcc);
      this.sim.removeRigidBody(a.body);
      this.actors.delete(c);
    }
    begin(dt: number) {
      const start = performance.now();
      for (let i = this.statics.length - 1; i >= 0; i--)
        if (this.statics[i].source?.dead) {
          this.sim.removeCollider(this.statics[i].col, true);
          this.statics.splice(i, 1);
          this.navRevision++;
        }
      for (const [s, r] of this.ragdolls) {
        if (s.rd !== r.rd) {
          for (const b of r.bodies) this.sim.removeRigidBody(b);
          this.ragdolls.delete(s);
          continue;
        }
        this.syncExternal(r);
      }
      this.acc += Math.max(0, Math.min(dt, 0.1));
      let n = 0;
      while (this.acc >= 1 / 60 && n < 5) {
        root.GActiveBody?.beforeStep(this, 1 / 60);
        this.drivePose(1 / 60);
        root.GContacts?.beforeStep(this, 1 / 60);
        for (const o of this.objects.values()) {
          if (!o.body.isEnabled()) continue;
          o.prev.copy(o.curr);
          o.prevQ.copy(o.currQ);
          o.speed = Math.hypot(
            o.body.linvel().x,
            o.body.linvel().y,
            o.body.linvel().z,
          );
        }
        for (const r of this.ragdolls.values()) this.capture(r, true);
        this.sim.step(undefined,root.GActiveBody?.hooks(this));
        root.GActiveBody?.afterStep(this);
        root.GContacts?.afterStep(this);
        for (const rig of this.poseMotors.values())
          for (const m of rig.bones.values()) m.curr.copy(m.body.rotation());
        for (const o of this.objects.values()) {
          if (!o.body.isEnabled()) continue;
          if (o.reportContacts) {
            let touching = false;
            this.sim.contactPairsWith(o.col, (other: any) => {
              this.sim.contactPair(o.col, other, (m: any) => {
                if (m.numSolverContacts() > 0) touching = true;
              });
            });
            if (touching && !o.touching) {
              o.impacts++;
              const velocity = o.body.linvel();
              o.impactSpeed = Math.max(
                0,
                o.speed - Math.hypot(velocity.x, velocity.y, velocity.z),
              );
            }
            if (o.contactAngularDamping !== undefined)
              o.body.setAngularDamping(
                touching ? o.contactAngularDamping : o.airAngularDamping,
              );
            // Centimetre-scale visual debris can retain solver jitter below the
            // world's contact tolerance. Sleep only after 0.5s of real support
            // and low translational + rim speed; never freeze airborne brass.
            if (o.settleRadius && !o.body.isSleeping()) {
              const lv = o.body.linvel(),
                av = o.body.angvel();
              const stable =
                touching &&
                Math.hypot(lv.x, lv.y, lv.z) < 0.025 &&
                Math.hypot(av.x, av.y, av.z) * o.settleRadius < 0.035;
              o.settleFrames = stable ? o.settleFrames + 1 : 0;
              if (o.settleFrames >= 30) o.body.sleep();
            }
            o.touching = touching;
          }
          o.curr.copy(o.body.translation());
          o.currQ.copy(o.body.rotation());
        }
        for (const r of this.ragdolls.values()) this.capture(r, false);
        this.acc -= 1 / 60;
        n++;
        this.steps++;
      }
      if (this.acc >= 1 / 60) {
        this.dropped += this.acc;
        this.acc %= 1 / 60;
      }
      this.alpha = this.acc * 60;
      root.GPerf?.record("rapier", performance.now() - start);
    }
    dragVelocity(s: any, vx: number, vz: number, dt: number) {
      const r = this.ragdolls.get(s);
      if (!r || dt <= 0) return;
      const speed = Math.hypot(vx, vz),
        scale = speed > 0.65 ? 0.65 / speed : 1,
        k = 1 - Math.exp(-dt * 8);
      for (const g of r.groups) {
        const velocity = g.body.linvel();
        g.body.setLinvel(
          v(
            velocity.x + (vx * scale - velocity.x) * k,
            velocity.y,
            velocity.z + (vz * scale - velocity.z) * k,
          ),
          true,
        );
      }
      r.rd.sleep = 0;
      r.rd.sleepT = 0;
    }
    pullCasualty(s: any, targets: any, dt: number, PI: any) {
      const r = this.ragdolls.get(s),
        T = root.THREE;
      if (!r || dt <= 0) return null;
      const chest = r.groups.find((g: any) => g.name === "chest");
      if (!chest) return null;
      let maxError = 0;
      const impulses: any[] = [];
      for (const side of ["R", "L"]) {
        const index = chest.ids.indexOf(PI["shoulder" + side]);
        if (index < 0 || !targets[side]) return null;
        const at = chest.locals[index]
            .clone()
            .applyQuaternion(chest.currQ)
            .add(chest.curr),
          target = new T.Vector3().copy(targets[side]),
          error = target.sub(at),
          distance = error.length(),
          velocity = chest.body.velocityAtPoint(at);
        maxError = Math.max(maxError, distance);
        if (distance > 1.15) return { held: false, maxError };
        // Bounded spring impulses through physical shoulder anchors. No all-body velocity overwrite.
        const force = error
          .multiplyScalar(550)
          .addScaledVector(new T.Vector3().copy(velocity), -38)
          .clampLength(0, 350);
        impulses.push({
          at,
          impulse: force.multiplyScalar(Math.min(dt, 0.05)),
        });
      }
      for (const q of impulses)
        chest.body.applyImpulseAtPoint(q.impulse, q.at, true);
      r.rd.sleep = 0;
      r.rd.sleepT = 0;
      return { held: true, maxError, forceLimit: 700 };
    }
    translate(s: any, dx: number, dy: number, dz: number) {
      const r = this.ragdolls.get(s);
      if (!r) return;
      const d = new root.THREE.Vector3(dx, dy, dz);
      for (const g of r.groups) {
        g.body.setTranslation(g.curr.clone().add(d), true);
        g.curr.add(d);
        g.prev.add(d);
      }
      for (const arr of [r.rendered, r.lastPP])
        if (arr)
          for (let i = 0; i < arr.length; i += 3) {
            arr[i] += dx;
            arr[i + 1] += dy;
            arr[i + 2] += dz;
          }
    }
    capture(r: any, prev: boolean) {
      for (const g of r.groups) {
        if (prev) {
          g.prev.copy(g.curr);
          g.prevQ.copy(g.currQ);
        } else {
          g.curr.copy(g.body.translation());
          g.currQ.copy(g.body.rotation());
        }
      }
    }
    syncExternal(r: any) {
      const p = r.rd.p,
        T = root.THREE,
        first = r.groups[0],
        local = first.locals[0],
        at = local.clone().applyQuaternion(first.currQ).add(first.curr),
        i = first.ids[0] * 3;
      const delta = r.rendered
        ? new T.Vector3(
            p[i] - r.rendered[i],
            p[i + 1] - r.rendered[i + 1],
            p[i + 2] - r.rendered[i + 2],
          )
        : new T.Vector3();
      // Medical dragging/repositioning is an explicit external transform; translate all bodies together.
      if (delta.length() > 0.25) {
        for (const g of r.groups) {
          g.body.setTranslation(g.curr.clone().add(delta), true);
          g.curr.add(delta);
          g.prev.add(delta);
        }
        r.rd.sleep = 0;
      }
      // Projectiles modify previous particle positions: convert only new impulse deltas to Rapier velocities.
      if (r.lastPP)
        for (const g of r.groups) {
          const impulse = new T.Vector3();
          for (const id of g.ids) {
            const j = id * 3;
            impulse.x += (r.lastPP[j] - r.rd.pp[j]) * 180;
            impulse.y += (r.lastPP[j + 1] - r.rd.pp[j + 1]) * 180;
            impulse.z += (r.lastPP[j + 2] - r.rd.pp[j + 2]) * 180;
          }
          impulse.multiplyScalar(1 / g.ids.length);
          if (impulse.lengthSq() > 0.05) {
            impulse.clampLength(0, 8);
            const vel = g.body.linvel();
            g.body.setLinvel(
              v(vel.x + impulse.x, vel.y + impulse.y, vel.z + impulse.z),
              true,
            );
          }
        }
    }
    makeRagdoll(s: any, PI: any) {
      this.removeActor(s.ctrl);
      root.GContacts?.drop(this, s);
      this.dropPose(s);
      const T = root.THREE,
        rd = s.rd,
        p = rd.p,
        groups: any[] = [],
        bodies: any[] = [],
        owner = new Map<number, any>();
      const P = (id: number) =>
        new T.Vector3(p[id * 3], p[id * 3 + 1], p[id * 3 + 2]);
      const defs: any[] = [
        ["pelvis", ["pelvis", "spine", "hipR", "hipL"], 12],
        [
          "chest",
          [
            "chest",
            "chestR",
            "chestL",
            "chestF",
            "neck",
            "shoulderR",
            "shoulderL",
          ],
          25,
        ],
        ["head", ["head", "headTop", "nose"], 5],
      ];
      for (const side of ["R", "L"])
        defs.push(
          [
            "upperArm" + side,
            ["elbow" + side],
            3.0,
            "shoulder" + side,
            "elbow" + side,
          ],
          [
            "forearm" + side,
            ["wrist" + side, "hand" + side],
            2,
            "elbow" + side,
            "wrist" + side,
          ],
          ["thigh" + side, ["knee" + side], 8, "hip" + side, "knee" + side],
          [
            "shin" + side,
            ["ankle" + side, "toe" + side],
            4,
            "knee" + side,
            "ankle" + side,
          ],
        );
      for (const [name, names, mass, from, to] of defs) {
        const ids = names.map((n: string) => PI[n]),
          pos = new T.Vector3();
        ids.forEach((i: number) => pos.add(P(i)));
        pos.multiplyScalar(1 / ids.length);
        if (from) pos.copy(P(PI[from])).add(P(PI[to])).multiplyScalar(0.5);
        const body = this.sim.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y, pos.z)
            .setLinearDamping(0.65)
            .setAngularDamping(2.3)
            .setCcdEnabled(true)
            .setCanSleep(true),
        );
        bodies.push(body);
        let shape: any;
        if (from) {
          const a = P(PI[from]),
            b = P(PI[to]),
            d = b.clone().sub(a),
            len = d.length(),
            rad = name.startsWith("thigh")
              ? 0.082
              : name.startsWith("shin")
                ? 0.058
                : 0.045;
          shape = R.ColliderDesc.capsule(Math.max(0.01, len / 2 - rad), rad);
          const q = new T.Quaternion().setFromUnitVectors(
            new T.Vector3(0, 1, 0),
            d.normalize(),
          );
          shape.setRotation(q);
        } else if (name === "head") shape = R.ColliderDesc.ball(0.105);
        else {
          shape = R.ColliderDesc.cuboid(
            name === "chest" ? 0.17 : 0.14,
            name === "chest" ? 0.2 : 0.105,
            0.11,
          );
          shape.setRotation({
            x: 0,
            y: Math.sin(s.ctrl.yaw / 2),
            z: 0,
            w: Math.cos(s.ctrl.yaw / 2),
          });
        }
        this.sim.createCollider(
          shape
            .setMass(mass)
            .setFriction(0.85)
            .setRestitution(0)
            .setCollisionGroups(GROUP_RAGDOLL),
          body,
        );
        const g = {
          name,
          ids,
          body,
          locals: ids.map((i: number) => P(i).sub(pos)),
          curr: pos.clone(),
          prev: pos.clone(),
          currQ: new T.Quaternion(),
          prevQ: new T.Quaternion(),
        };
        groups.push(g);
        for (const i of ids) owner.set(i, g);
        const vel = new T.Vector3();
        ids.forEach((i: number) =>
          vel.add(
            new T.Vector3(
              (p[i * 3] - rd.pp[i * 3]) * 180,
              (p[i * 3 + 1] - rd.pp[i * 3 + 1]) * 180,
              (p[i * 3 + 2] - rd.pp[i * 3 + 2]) * 180,
            ),
          ),
        );
        vel.multiplyScalar(1 / ids.length).clampLength(0, 10);
        body.setLinvel(vel, true);
      }
      const limits: any[] = [];
      const named = (n: string) => groups.find((g) => g.name === n);
      const connect = (a: any, b: any, point: any, hinge: any = false) => {
        const aa = point.clone().sub(a.curr),
          bb = point.clone().sub(b.curr);
        const data = hinge
          ? R.JointData.revolute(
              aa,
              bb,
              hinge.axis || v(Math.cos(s.ctrl.yaw), 0, -Math.sin(s.ctrl.yaw)),
            )
          : R.JointData.spherical(aa, bb);
        const j = this.sim.createImpulseJoint(data, a.body, b.body, true);
        j.setContactsEnabled(false);
        if (hinge) {
          j.setLimits(hinge.min ?? -0.08, hinge.max ?? 2.45);
          j.configureMotorVelocity(0, 1.5);
          limits.push({
            a: a.body,
            b: b.body,
            axis: new T.Vector3().copy(
              hinge.axis || v(Math.cos(s.ctrl.yaw), 0, -Math.sin(s.ctrl.yaw)),
            ),
            min: hinge.min ?? -0.08,
            max: hinge.max ?? 2.45,
          });
        }
        return j;
      };
      const right = new T.Vector3(
        Math.cos(s.ctrl.yaw),
        0,
        -Math.sin(s.ctrl.yaw),
      );
      connect(named("pelvis"), named("chest"), P(PI.spine), {
        axis: right,
        min: -0.45,
        max: 0.65,
      });
      connect(named("chest"), named("head"), P(PI.neck), {
        axis: right,
        min: -0.5,
        max: 0.65,
      });
      const limbLimit = (a: string, b: string, c: string, fallback: any) => {
        const u = P(PI[b]).sub(P(PI[a])).normalize(),
          f = P(PI[c]).sub(P(PI[b])).normalize(),
          axis = new T.Vector3().crossVectors(u, f),
          bend = Math.acos(Math.max(-1, Math.min(1, u.dot(f))));
        if (axis.lengthSq() < 0.0025) axis.copy(fallback);
        else axis.normalize();
        return { axis, min: -bend + 0.03, max: Math.max(0.03, 2.65 - bend) };
      };
      for (const side of ["R", "L"]) {
        connect(
          named("chest"),
          named("upperArm" + side),
          P(PI["shoulder" + side]),
        );
        connect(
          named("upperArm" + side),
          named("forearm" + side),
          P(PI["elbow" + side]),
          limbLimit(
            "shoulder" + side,
            "elbow" + side,
            "wrist" + side,
            new T.Vector3(0, side === "R" ? 1 : -1, 0),
          ),
        );
        connect(named("pelvis"), named("thigh" + side), P(PI["hip" + side]));
        connect(
          named("thigh" + side),
          named("shin" + side),
          P(PI["knee" + side]),
          limbLimit(
            "hip" + side,
            "knee" + side,
            "ankle" + side,
            right.clone().negate(),
          ),
        );
      }
      // Secondary rope limits prevent shoulders/hips/neck folding through the torso.
      const rope = (
        a: string,
        b: string,
        ia: string,
        ib: string,
        k: number,
      ) => {
        const ga = named(a),
          gb = named(b),
          pa = P(PI[ia]),
          pb = P(PI[ib]);
        this.sim.createImpulseJoint(
          R.JointData.rope(
            pa.distanceTo(pb) * k,
            pa.sub(ga.curr),
            pb.sub(gb.curr),
          ),
          ga.body,
          gb.body,
          true,
        );
      };
      rope("pelvis", "head", "pelvis", "headTop", 1.15);
      for (const side of ["R", "L"]) {
        rope("chest", "thigh" + side, "chest", "knee" + side, 1.18);
        rope("chest", "forearm" + side, "chest", "hand" + side, 1.2);
      }
      if (rd.gun) {
        const gp = rd.gun.p,
          pos = new T.Vector3(gp[0], gp[1], gp[2]);
        const body = this.sim.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y, pos.z)
            .setLinearDamping(0.8)
            .setAngularDamping(1.5)
            .setCcdEnabled(true),
        );
        bodies.push(body);
        const locals = [];
        for (let i = 0; i < gp.length; i += 3) {
          locals.push(
            new T.Vector3(gp[i] - pos.x, gp[i + 1] - pos.y, gp[i + 2] - pos.z),
          );
          this.sim.createCollider(
            R.ColliderDesc.ball(0.035)
              .setTranslation(locals.at(-1).x, locals.at(-1).y, locals.at(-1).z)
              .setMass(0.85)
              .setCollisionGroups(GROUP_RAGDOLL)
              .setFriction(0.9),
            body,
          );
        }
        groups.push({
          name: "gun",
          ids: [],
          body,
          locals,
          curr: pos.clone(),
          prev: pos.clone(),
          currQ: new T.Quaternion(),
          prevQ: new T.Quaternion(),
        });
        const chest = named("chest");
        this.sim
          .createImpulseJoint(
            R.JointData.rope(Math.max(rd.gun.rope, 0.6), v(), v()),
            chest.body,
            body,
            true,
          )
          .setContactsEnabled(false);
      }
      const result = {
        rd,
        groups,
        bodies,
        limits,
        lastPP: null,
        rendered: p.slice(),
      };
      this.ragdolls.set(s, result);
      return result;
    }
    ragdoll(s: any, dt: number, PI: any) {
      let r = this.ragdolls.get(s);
      if (!r || r.rd !== s.rd) {
        if (r) for (const b of r.bodies) this.sim.removeRigidBody(b);
        r = this.makeRagdoll(s, PI);
      }
      const rd = s.rd;
      rd.te += dt;
      let sleeping = true;
      for (const g of r.groups) {
        sleeping &&= g.body.isSleeping();
        const pos = g.prev.clone().lerp(g.curr, this.alpha),
          q = g.prevQ.clone().slerp(g.currQ, this.alpha),
          out = g.name === "gun" ? rd.gun.p : rd.p;
        for (let n = 0; n < g.locals.length; n++) {
          const pt = g.locals[n].clone().applyQuaternion(q).add(pos),
            i = g.name === "gun" ? n * 3 : g.ids[n] * 3;
          out[i] = pt.x;
          out[i + 1] = pt.y;
          out[i + 2] = pt.z;
        }
      }
      r.rendered.set(rd.p);
      rd.pp.set(rd.p);
      r.lastPP = rd.pp.slice();
      if (rd.gun) rd.gun.pp.set(rd.gun.p);
      rd.sleep = sleeping ? rd.sleep + dt : 0;
      rd.landed = sleeping;
    }
    stats() {
      return {
        backend: "Rapier 0.19.3 WASM",
        steps: this.steps,
        actors: this.actors.size,
        liveMotorRigs: this.poseMotors.size,
        liveAngularMotors: Array.from(this.poseMotors.values()).reduce(
          (n, r) => n + r.bones.size,
          0,
        ),
        servoSubsteps: this.poseSteps,
        dynamicObjects: this.objects.size,
        brassPool: {
          allocated: Array.from(this.objects.values()).filter(
            (o) => o.kind === "brass",
          ).length,
          active: Array.from(this.objects.values()).filter(
            (o) => o.kind === "brass" && o.body.isEnabled(),
          ).length,
        },
        livingContacts: root.GContacts?.stats(this) || { rigs: 0, segments: 0 },
        ragdolls: this.ragdolls.size,
        colliders: this.sim.colliders.len(),
        bodies: this.sim.bodies.len(),
        droppedSeconds: this.dropped,
        terrainMaxResolution: 256,
      };
    }
  }
}
(globalThis as any).GPhysics = AegisPhysics;
