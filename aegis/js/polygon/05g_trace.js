/* Cached static broadphase; exact mesh/proxy narrowphase. No scenery changes. */
(function (root) {
  "use strict";
  root.GTrace = {
    create(THREE, objects, targets) {
      const grid = new Map(),
        boxes = new Map(),
        custom = [],
        dynamic = [],
        CELL = 16,
        seen = new Set(),
        buf = [];
      let tests = 0,
        rays = 0;
      const put = (o, b) => {
        boxes.set(o, b);
        for (
          let x = Math.floor(b.min.x / CELL);
          x <= Math.floor(b.max.x / CELL);
          x++
        )
          for (
            let z = Math.floor(b.min.z / CELL);
            z <= Math.floor(b.max.z / CELL);
            z++
          ) {
            const k = x + "," + z;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(o);
          }
      };
      for (const obj of objects) {
        obj.updateMatrixWorld(true);
        const walk = (o) => {
          if (o.isSprite) return; // light/label billboards are visual, not ballistic surfaces
          if (
            o.raycast &&
            o.raycast !== THREE.Object3D.prototype.raycast &&
            !o.isMesh &&
            o.raycast !== THREE.Group.prototype.raycast
          ) {
            custom.push(o);
            return;
          }
          if (o.isMesh) {
            let moving = targets.includes(o);
            for (let p = o.parent; p; p = p.parent)
              if (targets.some((t) => t.parent === p)) moving = true;
            if (moving) {
              dynamic.push(o);
              return;
            }
            root.GGeometry?.prepare(o);
            o.geometry.computeBoundingBox();
            const b = o.geometry.boundingBox
              .clone()
              .applyMatrix4(o.matrixWorld);
            if (o.isInstancedMesh) {
              b.makeEmpty();
              const m = new THREE.Matrix4();
              for (let i = 0; i < o.count; i++) {
                o.getMatrixAt(i, m);
                m.premultiply(o.matrixWorld);
                b.union(o.geometry.boundingBox.clone().applyMatrix4(m));
              }
            }
            put(o, b.expandByScalar(0.15));
          }
          for (const ch of o.children) walk(ch);
        };
        walk(obj);
      }
      return {
        nearest(ray, ignore) {
          rays++;
          buf.length = 0;
          seen.clear();
          const a = ray.ray.origin,
            b = ray.ray.at(ray.far, new THREE.Vector3());
          const x0 = Math.floor(Math.min(a.x, b.x) / CELL),
            x1 = Math.floor(Math.max(a.x, b.x) / CELL),
            z0 = Math.floor(Math.min(a.z, b.z) / CELL),
            z1 = Math.floor(Math.max(a.z, b.z) / CELL);
          for (let x = x0; x <= x1; x++)
            for (let z = z0; z <= z1; z++)
              for (const o of grid.get(x + "," + z) || []) {
                if (seen.has(o) || o === ignore) continue;
                seen.add(o);
                if (!ray.ray.intersectsBox(boxes.get(o))) continue;
                tests++;
                o.raycast(ray, buf);
              }
          for (const o of custom) {
            tests++;
            o.raycast(ray, buf);
          }
          for (const o of dynamic) {
            tests++;
            o.raycast(ray, buf);
          }
          buf.sort((a, b) => a.distance - b.distance);
          return buf.find((h) => h.object !== ignore) || null;
        },
        stats: () => ({
          rays,
          tests,
          meshes: boxes.size,
          custom: custom.length,
          dynamic: dynamic.length,
          bvh: root.GGeometry?.stats(),
        }),
        invalidate() {
          grid.clear();
        },
      };
    },
  };
})(window);
