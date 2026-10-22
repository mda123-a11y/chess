
/* ==========================================================================
   МОДУЛЬ: game/flags.js
   ========================================================================== */
/* Флаги: ткань — сетка частиц Верле (Jakobsen, «Advanced Character
   Physics»): связи по нитям основы и утка, диагонали (сдвиг) и связи
   через узел (изгиб — слабые, ткань мягкая). Кромка у древка надета на
   фал и вращается вокруг древка, как на кольцах. Силы: тяжесть
   (полиэстер ~0,17 кг/м²) и аэродинамика по треугольникам — нормальная
   сила пластины 0,5·ρ·Cn·(v⊥)|v⊥|·A и трение вдоль ткани, от
   относительной скорости ветра и ткани. Ветер общий: направление
   медленно гуляет, порывы — сумма гармоник, плюс вихревая турбулентность,
   сносимая потоком: она и раскачивает полотнище волной от древка к
   свободному краю. Древко — препятствие: ткань его не проходит. */
(function (root, factory) {
  const M = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  else root.GFlags = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RHO = 1.2, SIGMA = 0.17, CN = 1.15, CT = 0.035, H = 1 / 120, H0 = H;

  /* эмблемы на холсте 3:2 */
  function emblem(kind) {
    const W = 1024, Hh = 683, c = document.createElement('canvas');
    c.width = W; c.height = Hh;
    const g = c.getContext('2d', { willReadFrequently: true });
    let seed = kind === 'alpha' ? 7 : 13;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    if (kind === 'delta') {
      /* лесной камуфляж: оливковое поле и пятна трёх тонов */
      g.fillStyle = '#4b5a37'; g.fillRect(0, 0, W, Hh);
      for (const [col, n, sz] of [['#3a4a2b', 26, 120], ['#5e6b44', 22, 95], ['#2c3622', 16, 80], ['#6b6646', 10, 70]]) {
        g.fillStyle = col;
        for (let i = 0; i < n; i++) {
          const x = rnd() * W, y = rnd() * Hh, r = sz * (0.5 + rnd());
          g.beginPath();
          for (let k = 0; k <= 12; k++) {
            const a = k / 12 * Math.PI * 2, rr = r * (0.6 + 0.4 * Math.sin(a * 3 + rnd() * 6) * rnd() + 0.3 * rnd());
            const px = x + Math.cos(a) * rr * 1.4, py = y + Math.sin(a) * rr * 0.8;
            k ? g.lineTo(px, py) : g.moveTo(px, py);
          }
          g.closePath(); g.fill();
        }
      }
      /* пирамида Δ: две грани — освещённая и теневая */
      const cx = W * 0.5, top = Hh * 0.12, base = Hh * 0.66, hw = Hh * 0.34, mid = cx + hw * 0.18;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.moveTo(cx + 8, top + 10); g.lineTo(cx + hw + 8, base + 10); g.lineTo(cx - hw + 8, base + 10); g.closePath(); g.fill();
      g.fillStyle = '#c9ab70';
      g.beginPath(); g.moveTo(cx, top); g.lineTo(mid, base); g.lineTo(cx - hw, base); g.closePath(); g.fill();
      g.fillStyle = '#8a7044';
      g.beginPath(); g.moveTo(cx, top); g.lineTo(cx + hw, base); g.lineTo(mid, base); g.closePath(); g.fill();
      g.strokeStyle = '#1d2216'; g.lineWidth = 7; g.lineJoin = 'miter';
      g.beginPath(); g.moveTo(cx, top); g.lineTo(cx + hw, base); g.lineTo(cx - hw, base); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(cx, top); g.lineTo(mid, base); g.stroke();
      g.fillStyle = '#d8bf86';
      g.font = '900 118px "Arial Black", Impact, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (g.letterSpacing !== undefined) g.letterSpacing = '22px';
      g.fillText('DELTA', cx + 11, Hh * 0.83);
    } else {
      /* чёрное поле, тонкая белая рамка, стилизованная «А» — шеврон с
         перекладиной */
      g.fillStyle = '#121212'; g.fillRect(0, 0, W, Hh);
      g.strokeStyle = '#e9e9e4'; g.lineWidth = 6; g.strokeRect(34, 34, W - 68, Hh - 68);
      const cx = W * 0.5, top = Hh * 0.13, base = Hh * 0.66, hw = Hh * 0.3, t = 46;
      g.fillStyle = '#efefea';
      g.beginPath();
      g.moveTo(cx, top); g.lineTo(cx + hw, base); g.lineTo(cx + hw - t * 1.3, base); g.lineTo(cx, top + t * 2.2);
      g.lineTo(cx - hw + t * 1.3, base); g.lineTo(cx - hw, base); g.closePath(); g.fill();
      const yb = Hh * 0.5;
      const xl = cx - (hw * (yb - top) / (base - top)) + t * 0.6, xr = cx + (hw * (yb - top) / (base - top)) - t * 0.6;
      g.fillRect(xl, yb - t * 0.36, xr - xl, t * 0.72);
      g.fillStyle = '#efefea';
      g.font = '900 112px "Arial Black", Impact, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (g.letterSpacing !== undefined) g.letterSpacing = '22px';
      g.fillText('ALPHA', cx + 11, Hh * 0.83);
    }
    /* фактура ткани: нити и лёгкая неравномерность краски */
    const id = g.getImageData(0, 0, W, Hh), d = id.data;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, w = ((x & 3) === 0 ? -9 : 0) + ((y & 3) === 0 ? -7 : 0) + (rnd() - 0.5) * 10;
      d[i] += w; d[i + 1] += w; d[i + 2] += w;
    }
    g.putImageData(id, 0, 0);
    return c;
  }

  function create(THREE, opt) {
    const o = opt || {};
    const scene = o.scene, groundAt = o.groundAt || (() => 0);
    const FL = { list: [], t: 0, wind: new THREE.Vector3(), base: o.windDir || Math.atan2(0.18, 0.35), U0: o.windSpeed || 4.2 };
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9a9c9b, roughness: 0.42, metalness: 0.75 });
    const knobMat = new THREE.MeshStandardMaterial({ color: 0xb59a52, roughness: 0.35, metalness: 0.85 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c6, roughness: 0.9 });

    /* ветер в момент t в точке (x, y, z): средний поток + порыв +
       вихри, переносимые потоком */
    function windAt(out, x, y, z, t) {
      if(globalThis.AEGIS_WIND){const w=globalThis.AEGIS_WIND(x,y,z,t);return out.set(w.x,w.y,w.z);}
      const U = FL.U, dx = FL.dir.x, dz = FL.dir.z;
      const s = x * dx + z * dz - U * t;          /* координата вдоль потока в подвижной системе */
      const q = -x * dz + z * dx;
      const n1 = Math.sin(s * 2.1 + q * 0.7 + y * 1.3) * 0.6 + Math.sin(s * 4.7 - y * 2.9 + 1.7) * 0.4;
      const n2 = Math.sin(s * 1.7 - q * 1.1 + 2.3) * 0.6 + Math.sin(s * 5.3 + y * 3.7) * 0.4;
      const n3 = Math.sin(s * 2.9 + y * 2.3 + 4.1) * 0.5 + Math.sin(s * 6.1 + q * 1.9) * 0.5;
      const k = 0.32 * U;
      out.set(dx * U + (-dz) * n1 * k + dx * n3 * k * 0.5, n2 * k * 0.55, dz * U + dx * n1 * k + dz * n3 * k * 0.5);
      return out;
    }

    function add(spec) {
      const lite = ['low','ultra'].includes(globalThis.AEGIS_QTIER||o.quality);
      const nx = spec.nx || (lite?14:20), ny = spec.ny || (lite?10:14), w = spec.w, h = spec.h;
      const x0 = spec.x, z0 = spec.z, gy = spec.y0 !== undefined ? spec.y0 : groundAt(x0, z0);
      const top = gy + spec.poleH;
      const grp = new THREE.Group(); grp.name = 'flag_' + (spec.name || FL.list.length);
      if (spec.pole !== false) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.045, spec.poleH + 0.25, 12), poleMat);
        pole.position.set(x0, gy + (spec.poleH + 0.25) / 2 - 0.25 + 0.06, z0);
        pole.castShadow = pole.receiveShadow = true;
        grp.add(pole);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), knobMat);
        knob.position.set(x0, top + 0.1, z0); knob.castShadow = true; grp.add(knob);
        /* бетонный стакан у основания */
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 14), new THREE.MeshStandardMaterial({ color: 0x8b8984, roughness: 0.95 }));
        foot.position.set(x0, gy + 0.06, z0); foot.receiveShadow = foot.castShadow = true; grp.add(foot);
        /* фал: от нижнего угла полотнища к утке на древке */
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, spec.poleH - h - 1.1, 4), ropeMat);
        rope.position.set(x0 + 0.035, gy + 1.1 + (spec.poleH - h - 1.1) / 2, z0); grp.add(rope);
        if (o.colliders) o.colliders.push({ type: 'cyl', x: x0, z: z0, r: 0.08, h: spec.poleH });
      }
      const N = nx * ny;
      const p = new Float32Array(N * 3), pp = new Float32Array(N * 3), f = new Float32Array(N * 3), m = new Float32Array(N);
      const dx = w / (nx - 1), dy = h / (ny - 1);
      /* старт — полотнище по ветру, иначе первый же кадр — рывок */
      const a0 = FL.base;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        p[k * 3] = x0 + Math.cos(a0) * i * dx; p[k * 3 + 1] = top - spec.drop - j * dy; p[k * 3 + 2] = z0 + Math.sin(a0) * i * dx;
        m[k] = SIGMA * dx * dy * ((i === 0 || i === nx - 1) ? 0.5 : 1) * ((j === 0 || j === ny - 1) ? 0.5 : 1);
      }
      pp.set(p);
      const C = [];
      const L = (a, b, st) => C.push(a, b, Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]), st);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (i < nx - 1) L(k, k + 1, 1);
        if (j < ny - 1) L(k, k + nx, 1);
        if (i < nx - 1 && j < ny - 1) { L(k, k + nx + 1, 0.7); L(k + 1, k + nx, 0.7); }
        if (i < nx - 2) L(k, k + 2, 0.12);
        if (j < ny - 2) L(k, k + 2 * nx, 0.12);
      }
      const geo = new THREE.PlaneGeometry(w, h, nx - 1, ny - 1);
      let mat;
      if (spec.kind) {
        const tex = new THREE.CanvasTexture(emblem(spec.kind));
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
        mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
      } else mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().fromArray(spec.color || [0.3, 0.03, 0.025]), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.raycast = () => {};
      grp.add(mesh);
      scene.add(grp);
      const F = { spec, nx, ny, N, p, pp, f, m, C: new Float32Array(C), mesh, geo, x0, z0, top, drop: spec.drop, dy, acc: 0, poleR: spec.poleR || 0.04 };
      FL.list.push(F);
      return F;
    }

    const _w = new THREE.Vector3();
    /* v10: ветер считается один раз на узел (а не на каждый треугольник —
       их вдвое больше), силы по треугольникам — без временных массивов:
       раньше [[k,k+1,k+nx],…] и [a,b,c] создавались ~1000 раз за шаг, и
       сборщик мусора дёргал кадр. Физика та же (Jakobsen + аэродинамика
       пластины), ветер треугольника — среднее его трёх узлов. */
    function triForce(F, a, b, c) {
      const p = F.p, pp = F.pp, f = F.f, Wv = F.wv;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nxv = uy * vz - uz * vy, nyv = uz * vx - ux * vz, nzv = ux * vy - uy * vx;
      const nl = Math.sqrt(nxv * nxv + nyv * nyv + nzv * nzv) || 1e-9, A = nl * 0.5;
      nxv /= nl; nyv /= nl; nzv /= nl;
      const i3 = 1 / (3 * (F.hc || H));
      const tvx = ((p[a] - pp[a]) + (p[b] - pp[b]) + (p[c] - pp[c])) * i3;
      const tvy = ((p[a + 1] - pp[a + 1]) + (p[b + 1] - pp[b + 1]) + (p[c + 1] - pp[c + 1])) * i3;
      const tvz = ((p[a + 2] - pp[a + 2]) + (p[b + 2] - pp[b + 2]) + (p[c + 2] - pp[c + 2])) * i3;
      const rx = (Wv[a] + Wv[b] + Wv[c]) / 3 - tvx, ry = (Wv[a + 1] + Wv[b + 1] + Wv[c + 1]) / 3 - tvy, rz = (Wv[a + 2] + Wv[b + 2] + Wv[c + 2]) / 3 - tvz;
      const vn = rx * nxv + ry * nyv + rz * nzv;
      const fn = 0.5 * RHO * CN * vn * Math.abs(vn) * A;
      const tx = rx - vn * nxv, ty = ry - vn * nyv, tz = rz - vn * nzv;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz), ft = 0.5 * RHO * CT * tl * A;
      const Fx = (fn * nxv + ft * tx) / 3, Fy = (fn * nyv + ft * ty) / 3, Fz = (fn * nzv + ft * tz) / 3;
      f[a] += Fx; f[a + 1] += Fy; f[a + 2] += Fz;
      f[b] += Fx; f[b + 1] += Fy; f[b + 2] += Fz;
      f[c] += Fx; f[c + 1] += Fy; f[c + 2] += Fz;
    }
    function step(F, t, iters, hS) {
      const H = hS || H0; F.hc = H;
      const { p, pp, f, m, N, nx, ny, C } = F;
      f.fill(0);
      const Wv = F.wv || (F.wv = new Float32Array(N * 3));
      // Sample the slowly varying shared wind at cloth corners, not at all 280 nodes.
      // Bilinear interpolation keeps a spatial gradient and removes repeated canopy queries.
      const sample=F.windCorners||(F.windCorners=new Float32Array(12));
      const corners=F.windCornerIds||(F.windCornerIds=[0,nx-1,(ny-1)*nx,N-1]);
      for(let i=0;i<4;i++){const q=corners[i]*3;windAt(_w,p[q],p[q+1],p[q+2],t);sample[i*3]=_w.x;sample[i*3+1]=_w.y;sample[i*3+2]=_w.z;}
      for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
        const u=i/(nx-1),v=j/(ny-1),q=(j*nx+i)*3;
        for(let a=0;a<3;a++){const lo=sample[a]+(sample[3+a]-sample[a])*u,hi=sample[6+a]+(sample[9+a]-sample[6+a])*u;Wv[q+a]=lo+(hi-lo)*v;}
      }
      /* аэродинамика по треугольникам */
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i;
        triForce(F, k * 3, (k + 1) * 3, (k + nx) * 3);
        triForce(F, (k + 1) * 3, (k + nx + 1) * 3, (k + nx) * 3);
      }
      /* Верле */
      const hh = H * H;
      for (let k = 0; k < N; k++) {
        const q = k * 3, im = 1 / m[k];
        const x = p[q], y = p[q + 1], z = p[q + 2];
        p[q] += (x - pp[q]) * 0.996 + f[q] * im * hh;
        p[q + 1] += (y - pp[q + 1]) * 0.996 + (f[q + 1] * im - 9.81) * hh;
        p[q + 2] += (z - pp[q + 2]) * 0.996 + f[q + 2] * im * hh;
        pp[q] = x; pp[q + 1] = y; pp[q + 2] = z;
      }
      const gy = F.gy !== undefined ? F.gy : (F.gy = groundAt(F.x0, F.z0) + 0.03), R = F.poleR;
      for (let it = 0; it < iters; it++) {
        for (let c = 0; c < C.length; c += 4) {
          const a = C[c] * 3, b = C[c + 1] * 3, L = C[c + 2], st = C[c + 3];
          const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          /* ткань почти не тянется, но сжимается свободно (сминается) у изгибных связей */
          if (st < 0.5 && d < L) continue;
          const k = (d - L) / d * 0.5 * st;
          p[a] += dx * k; p[a + 1] += dy * k; p[a + 2] += dz * k;
          p[b] -= dx * k; p[b + 1] -= dy * k; p[b + 2] -= dz * k;
        }
        /* кромка на фале: на оси древка */
        for (let j = 0; j < ny; j++) {
          const q = j * nx * 3;
          p[q] = F.x0; p[q + 1] = F.top - F.drop - j * F.dy; p[q + 2] = F.z0;
        }
        /* древко и грунт */
        for (let k = 0; k < N; k++) {
          if (k % nx === 0) continue;
          const q = k * 3;
          const ex = p[q] - F.x0, ez = p[q + 2] - F.z0, e = Math.sqrt(ex * ex + ez * ez);
          if (e < R && p[q + 1] < F.top + 0.1) {
            const s = e > 1e-6 ? R / e : 0;
            if (s) { p[q] = F.x0 + ex * s; p[q + 2] = F.z0 + ez * s; } else p[q] += R;
          }
          if (p[q + 1] < gy) p[q + 1] = gy;
        }
      }
    }

    let _fr = null, _frF = -1;
    const _pm = new THREE.Matrix4();
    FL.frameN = 0;
    FL.update = function (dt, cam) {
      FL.frameN++;
      dt = Math.min(dt || 0, 0.05);
      FL.t += dt;
      const t = FL.t;
      /* направление и сила ветра: медленные блуждания и порывы */
      const ang = FL.base + 0.32 * Math.sin(t * 0.047) + 0.14 * Math.sin(t * 0.13 + 1.1) + 0.05 * Math.sin(t * 0.61 + 2.3);
      const gust = 0.42 * Math.sin(t * 0.29) + 0.26 * Math.sin(t * 0.71 + 2.0) + 0.16 * Math.sin(t * 1.63 + 4.0) + 0.1 * Math.sin(t * 3.1 + 0.4);
      FL.U = FL.U0 * Math.max(0.25, 1 + 0.4 * gust);
      FL.dir = FL.wind.set(Math.cos(ang), 0, Math.sin(ang));
      for (const F of FL.list) {
        /* v10: LOD ткани, как у cloth в UE/Unity: вне кадра полотнище
           «спит» (форма остаётся, симуляции нет), далеко — меньше итераций
           связей. В кадре вблизи — полные 10 итераций. */
        let iters = 10;
        if (cam) {
          const c = F.ctr || (F.ctr = new THREE.Vector3(F.x0, F.top - F.drop - F.dy * (F.ny - 1) * 0.5, F.z0));
          const d = cam.position.distanceTo(c);
          if (!F.sph) F.sph = new THREE.Sphere(c, Math.hypot(F.spec.w, F.spec.h) + 0.3);
          if (!_fr || _frF !== FL.frameN) {
            _frF = FL.frameN;
            _pm.copy(cam.matrixWorld).invert().premultiply(cam.projectionMatrix);
            (_fr || (_fr = new THREE.Frustum())).setFromProjectionMatrix(_pm);
          }
          if (!_fr.intersectsSphere(F.sph) || d > 90) { F.acc = 0; F.sleep = true; continue; }
          F.sleep = false;
          /* v14: дальше 20 м — шаг 1/60 вместо 1/120 и меньше итераций
             (на экране полотнище — десяток пикселей); на «Низком» качестве —
             не больше 6 итераций. Вдвое-вчетверо дешевле, вид тот же. */
          const lowQ = ['low','ultra'].includes(globalThis.AEGIS_QTIER||o.quality);
          iters = d < 20 ? (lowQ ? 6 : 9) : d < 45 ? 5 : 3;
          F.h = d < 20 && !lowQ ? H : H * 2;
        } else F.h = H;
        const hS = F.h || H;
        F.acc += dt;
        let n = 0;
        /* не больше 3 подшагов за кадр: на слабом ПК при просадке кадра
           ткань не должна съедать ещё больше времени («спираль смерти») */
        while (F.acc >= hS && n < 3) { F.acc -= hS; step(F, t - F.acc, iters, hS); n++; }
        if (n === 3) F.acc = 0;
        if (n === 0) continue;
        /* вершины сетки -> геометрия (порядок PlaneGeometry совпадает) */
        const pos = F.geo.attributes.position, arr = pos.array, p = F.p;
        for (let k = 0; k < F.N; k++) { arr[k * 3] = p[k * 3]; arr[k * 3 + 1] = p[k * 3 + 1]; arr[k * 3 + 2] = p[k * 3 + 2]; }
        pos.needsUpdate = true;
        if(!['low','ultra'].includes(globalThis.AEGIS_QTIER||o.quality)||FL.frameN%2===0)F.geo.computeVertexNormals();
      }
    };
    FL.dir = FL.wind.set(Math.cos(FL.base), 0, Math.sin(FL.base));
    FL.U = FL.U0;
    FL.add = add;
    FL.windAt = windAt;
    return FL;
  }
  return { create, emblem };
});
