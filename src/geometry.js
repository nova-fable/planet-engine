/**
 * geometry.js — 程序化几何工厂（行星发动机）
 *
 * 全部几何体均在运行时程序化生成，不依赖任何外部模型/贴图文件。
 * 所有几何体统一构造参数，方便在 Node 下做三角形预算与包围盒测试。
 *
 * 尺度约定：世界单位为"米"，整机高约 11000，+Y 向上，喷口向下。
 */

import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/addons/BufferGeometryUtils.js';

/* ═══════════════ 全局段数（性能预算） ═══════════════ */

export const SEG = {
  huge: 40,     // 主壳体等超大回转体
  big: 28,
  mid: 18,
  small: 12,
  tiny: 6,
};

/** 三角形计数工具 */
export function triangleCount(geometry) {
  if (!geometry) return 0;
  const g = geometry.index ? geometry : null;
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  const count = geometry.index ? geometry.index.count : pos.count;
  return Math.floor(count / 3);
}

/* ═══════════════ 基础工具 ═══════════════ */

/** 安全创建 Mesh（几何体为空时返回 null） */
export function mesh(geometry, material, name) {
  if (!geometry) return null;
  const m = new THREE.Mesh(geometry, material);
  if (name) m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * 生成"径向肋/齿"轮廓并挤出，得到一个柱状几何体（用于肋条、格栅、散热片）。
 * @param {number} rInner 内半径
 * @param {number} rOuter 外半径
 * @param {number} height 高度（沿 Y）
 * @param {number} depth 挤出深度（沿 Z）
 */
export function makeRadialExtrude(rInner, rOuter, height, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(rInner, -height / 2);
  shape.lineTo(rOuter, -height / 2);
  shape.lineTo(rOuter, height / 2);
  shape.lineTo(rInner, height / 2);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 2 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/** 单位立方体（可缩放），带 UV 的 BoxGeometry 简化封装 */
export function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d, 1, 1, 1);
}

/** 生成一个沿 Y 轴的圆柱/圆台 */
export function tubeY(rTop, rBottom, height, segments = SEG.mid, openEnded = false) {
  return new THREE.CylinderGeometry(rTop, rBottom, height, segments, 1, openEnded);
}

/* ═══════════════ 螺栓（六角头） ═══════════════ */

/** 六角头螺栓几何体（头在上，螺杆朝下，单位高度≈1） */
export function makeBoltGeo(scale = 1) {
  const headR = 0.62 * scale;
  const headH = 0.42 * scale;
  const shankR = 0.3 * scale;
  const shankH = 0.72 * scale;

  const head = new THREE.CylinderGeometry(headR, headR, headH, 6, 1, false);
  head.translate(0, headH / 2, 0);
  const shank = new THREE.CylinderGeometry(shankR, shankR * 0.92, shankH, 6, 1, false);
  shank.translate(0, -shankH / 2, 0);

  const g = mergeGeometries([head, shank], false);
  head.dispose();
  shank.dispose();
  if (!g) return head;
  g.computeVertexNormals();
  return g;
}

/**
 * 实例化螺栓阵列。
 * @param {object} opts
 * @param {Array<{x,y,z,nx?,ny?,nz?}|THREE.Vector3>} [opts.positions] 绝对位置
 * @param {Function} [opts.placement] (i, count, out:{pos:Vector3,quat:Quaternion,scale:Vector3}) => void
 * @param {number} [opts.count] placement 模式下的数量
 * @param {number} [opts.radius=1] 螺栓头半径基准
 * @param {number} [opts.height=1] 螺栓总高
 * @param {THREE.Material} opts.material
 * @param {string} [opts.partId] 写入 userData.partId
 * @returns {THREE.InstancedMesh}
 */
export function makeInstancedBolts({
  positions = null,
  placement = null,
  count = 0,
  radius = 1,
  height = 2,
  material = null,
  partId = null,
  name = 'bolts',
} = {}) {
  const scale = Math.max(radius * 1.6, height);
  const geo = makeBoltGeo(scale);
  const n = positions ? positions.length : count;
  const mat = material || new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.45, metalness: 0.95 });
  const inst = new THREE.InstancedMesh(geo, mat, Math.max(n, 1));
  inst.count = n;
  inst.name = name;
  inst.castShadow = true;
  inst.receiveShadow = true;
  if (partId) inst.userData.partId = partId;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const nrm = new THREE.Vector3();

  if (positions) {
    for (let i = 0; i < n; i++) {
      const p = positions[i];
      pos.set(p.x, p.y, p.z);
      if (p.nx !== undefined || p.ny !== undefined || p.nz !== undefined) {
        nrm.set(p.nx || 0, p.ny || 0, p.nz || 0);
        if (nrm.lengthSq() > 1e-9) {
          nrm.normalize();
          q.setFromUnitVectors(up, nrm);
        } else q.identity();
      } else {
        q.identity();
      }
      scl.set(1, 1, 1);
      m4.compose(pos, q, scl);
      inst.setMatrixAt(i, m4);
    }
  } else if (placement) {
    const out = { pos, quat: q, scale: scl };
    for (let i = 0; i < n; i++) {
      pos.set(0, 0, 0); q.identity(); scl.set(1, 1, 1);
      placement(i, n, out);
      m4.compose(pos, q, scl);
      inst.setMatrixAt(i, m4);
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  return inst;
}

/**
 * 一圈螺栓（水平圆环，螺母朝上）。
 * @returns {THREE.InstancedMesh}
 */
export function makeBoltRing(radius, y, count, boltScale = 1, materials = null) {
  const mat = materials ? (materials.bolt || materials.get?.('bolt')) : null;
  const inst = makeInstancedBolts({
    count,
    radius: boltScale,
    height: boltScale * 1.7,
    material: mat,
    name: `bolt-ring-${count}`,
    placement: (i, n, out) => {
      const a = (i / n) * Math.PI * 2;
      out.pos.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
      out.quat.identity();
    },
  });
  return inst;
}

/* ═══════════════ 肋条阵列 ═══════════════ */

/**
 * 竖向加劲肋阵列（InstancedMesh）。
 * @param {object} o
 * @param {number} o.count 数量
 * @param {(i:number)=>number} o.radiusFn 第 i 道肋的安装半径
 * @param {(i:number)=>number} o.heightFn 第 i 道肋的高度
 * @param {(i:number)=>number} [o.yFn] 第 i 道肋的中心高度
 * @param {[number,number]} o.ribSize [厚度, 外伸长度]
 */
export function makeRibArray({ count, radiusFn, heightFn, yFn = null, ribSize = [4, 8], material = null, partId = null, name = 'ribs' }) {
  const [thick, depth] = ribSize;
  const geo = new THREE.BoxGeometry(thick, 1, depth); // Y 由实例缩放控制
  const mat = material || new THREE.MeshStandardMaterial({ color: 0x6a7480, roughness: 0.6, metalness: 0.8 });
  const inst = new THREE.InstancedMesh(geo, mat, Math.max(count, 1));
  inst.count = count;
  inst.name = name;
  inst.castShadow = true;
  inst.receiveShadow = true;
  if (partId) inst.userData.partId = partId;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const e = new THREE.Euler();

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = typeof radiusFn === 'function' ? radiusFn(i, a) : radiusFn;
    const h = typeof heightFn === 'function' ? heightFn(i, a) : heightFn;
    const y = yFn ? yFn(i, a) : 0;
    pos.set(Math.cos(a) * (r + depth * 0.5), y, Math.sin(a) * (r + depth * 0.5));
    e.set(0, -a, 0);
    q.setFromEuler(e);
    scl.set(1, h, 1);
    m4.compose(pos, q, scl);
    inst.setMatrixAt(i, m4);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  return inst;
}

/* ═══════════════ 法兰 ═══════════════ */

/**
 * 法兰组：环体 + 外圈螺栓。
 * @returns {THREE.Group}
 */
export function makeFlange(radius, thickness, boltCount = 12, materials = null, opts = {}) {
  const g = new THREE.Group();
  g.name = opts.name || 'flange';
  const mat = opts.material || (materials && (materials.steelDark || materials.get?.('steelDark'))) || null;
  const boltMat = opts.boltMaterial || (materials && (materials.bolt || materials.get?.('bolt'))) || null;

  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, thickness, SEG.small, 1, false),
    mat,
  );
  ring.castShadow = true;
  ring.receiveShadow = true;
  g.add(ring);

  // 内外倒角环
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.94, thickness * 0.55, 3, Math.max(6, Math.min(SEG.small, 10))),
    mat,
  );
  lip.rotation.x = Math.PI / 2;
  g.add(lip);

  if (boltCount > 0) {
    const boltScale = Math.max(thickness * 0.9, radius * 0.09);
    const bolts = makeBoltRing(radius * 0.78, thickness * 0.62, boltCount, boltScale, materials);
    bolts.name = 'flange-bolts';
    g.add(bolts);
  }
  return g;
}

/* ═══════════════ 管道 ═══════════════ */

/**
 * 管路：沿 CatmullRomCurve3 的 TubeGeometry，可选法兰与管道支架。
 * @param {Array<THREE.Vector3|[number,number,number]>} points
 * @param {number} radius
 * @param {THREE.Material} material
 * @param {number} segments 径向段数
 * @param {object} [opts] { tubular, flanges, flangeEvery, materials, parent }
 * @returns {THREE.Group|THREE.Mesh} 有法兰时返回 Group
 */
export function makePipeRun(points, radius, material, segments = 10, opts = {}) {
  const vecs = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
  if (vecs.length < 2) return null;
  // 去重相邻点，避免 NaN 切线
  const clean = [vecs[0]];
  for (let i = 1; i < vecs.length; i++) {
    if (vecs[i].distanceToSquared(clean[clean.length - 1]) > 1e-6) clean.push(vecs[i]);
  }
  if (clean.length < 2) clean.push(clean[0].clone().add(new THREE.Vector3(1, 0, 0)));

  const curve = new THREE.CatmullRomCurve3(clean, false, 'catmullrom', 0.5);
  const tubular = opts.tubular || Math.max(12, Math.min(64, clean.length * 8));
  const geo = new THREE.TubeGeometry(curve, tubular, radius, segments, false);

  const requireFlange = !!(opts.flangeEvery || opts.flanges);
  if (!requireFlange) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = opts.name || 'pipe';
    return m;
  }

  const group = new THREE.Group();
  group.name = opts.name || 'pipe-run';
  const body = new THREE.Mesh(geo, material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const mats = opts.materials || null;
  const every = opts.flangeEvery || 0.25;
  const count = opts.flangeCount || Math.max(2, Math.round(1 / every) + 1);
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const tc = Math.min(0.995, Math.max(0.005, t));
    const p = curve.getPointAt(tc);
    const tan = curve.getTangentAt(tc).normalize();
    q.setFromUnitVectors(up, tan);
    const f = makeFlange(radius * 1.75, radius * 0.5, opts.flangeBolts ?? 10, mats, {
      material: opts.flangeMaterial,
      boltMaterial: opts.flangeBoltMaterial,
      name: 'pipe-flange',
    });
    f.position.copy(p);
    f.quaternion.copy(q);
    group.add(f);
  }
  return group;
}

/* ═══════════════ 格构桅杆 / 桁架 ═══════════════ */

/**
 * 格构式桅杆（空间桁架柱）。
 * @param {object} o
 * @param {number} o.height 总高
 * @param {number} o.radius 弦杆分布半径
 * @param {number} [o.legs=4] 弦杆数
 * @param {number} [o.bays] 节间数
 * @param {number} [o.chordRadius] 弦杆半径
 * @param {number} [o.braceRadius] 腹杆半径
 */
export function makeLatticeMast({
  height = 100,
  radius = 10,
  legs = 4,
  bays = 8,
  chordRadius = 1.2,
  braceRadius = 0.6,
  material = null,
  name = 'lattice-mast',
} = {}) {
  const group = new THREE.Group();
  group.name = name;
  const parts = [];
  const legPos = [];
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2 + Math.PI / 4;
    legPos.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }

  // 弦杆
  for (const p of legPos) {
    const g = new THREE.CylinderGeometry(chordRadius, chordRadius, height, 6, 1, false);
    g.translate(p.x, height / 2, p.z);
    parts.push(g);
  }

  // 腹杆（每节间一圈斜撑 + 一道水平横撑）
  const bayH = height / bays;
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let b = 0; b < bays; b++) {
    const y0 = b * bayH;
    const y1 = (b + 1) * bayH;
    for (let i = 0; i < legs; i++) {
      const p0 = legPos[i];
      const p1 = legPos[(i + 1) % legs];
      const a = new THREE.Vector3(p0.x, y0, p0.z);
      const c = new THREE.Vector3(p1.x, y1, p1.z);
      dir.subVectors(c, a);
      const len = dir.length();
      if (len < 1e-6) continue;
      const g = new THREE.CylinderGeometry(braceRadius, braceRadius, len, 4, 1, false);
      mid.copy(a).addScaledVector(dir, 0.5);
      q.set(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(q, dir.clone().normalize());
      const m4 = new THREE.Matrix4().compose(mid.clone(), quat, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m4);
      parts.push(g);
    }
    // 横撑
    for (let i = 0; i < legs; i++) {
      const p0 = legPos[i];
      const p1 = legPos[(i + 1) % legs];
      const a = new THREE.Vector3(p0.x, y1, p0.z);
      const c = new THREE.Vector3(p1.x, y1, p1.z);
      dir.subVectors(c, a);
      const len = dir.length();
      if (len < 1e-6) continue;
      const g = new THREE.CylinderGeometry(braceRadius * 0.85, braceRadius * 0.85, len, 4, 1, false);
      mid.copy(a).addScaledVector(dir, 0.5);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(mid.clone(), quat, new THREE.Vector3(1, 1, 1)));
      parts.push(g);
    }
  }

  const merged = parts.length ? mergeGeometries(parts, false) : null;
  for (const p of parts) p.dispose();
  if (merged) {
    merged.computeVertexNormals();
    const m = new THREE.Mesh(merged, material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

/* ═══════════════ 盖板 / 格栅面板 ═══════════════ */

/**
 * 机械细节面板（greeble）：底板 + 若干凸起块 + 通风栅。
 */
export function makeGreeblePanel({
  width = 40,
  height = 30,
  depth = 4,
  blocks = 6,
  material = null,
  accentMaterial = null,
  seed = 1,
  name = 'greeble',
} = {}) {
  const group = new THREE.Group();
  group.name = name;
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  const base = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  base.position.z = depth / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const geos = [];
  for (let i = 0; i < blocks; i++) {
    const w = width * (0.08 + rnd() * 0.3);
    const h = height * (0.08 + rnd() * 0.34);
    const d = depth * (0.4 + rnd() * 1.6);
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(
      (rnd() - 0.5) * (width - w) * 0.9,
      (rnd() - 0.5) * (height - h) * 0.9,
      depth + d / 2,
    );
    geos.push(g);
  }
  // 一组通风栅条
  const slats = 5;
  for (let i = 0; i < slats; i++) {
    const g = new THREE.BoxGeometry(width * 0.5, height * 0.035, depth * 0.9);
    g.translate(
      (rnd() - 0.5) * width * 0.3,
      -height * 0.36 + i * height * 0.06,
      depth * 1.3,
    );
    geos.push(g);
  }
  if (geos.length) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) {
      merged.computeVertexNormals();
      const m = new THREE.Mesh(merged, accentMaterial || material);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }
  return group;
}

/* ═══════════════ 警示条带 ═══════════════ */

/**
 * 黄黑警示条带（沿 X 方向的贴片，可旋转）；带程序化斜纹贴图。
 */
export function makeWarningStripe({ width = 100, height = 12, material = null, name = 'warning-stripe' } = {}) {
  const g = new THREE.PlaneGeometry(width, height, 1, 1);
  const m = new THREE.Mesh(g, material);
  m.name = name;
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/* ═══════════════ 散热鳍片 ═══════════════ */

/**
 * 单片散热鳍：带加强筋的薄板。
 */
export function makeRadiatorFin({ width = 60, height = 140, thickness = 6, ribs = 3, material = null, name = 'fin' } = {}) {
  const geos = [];
  const plate = new THREE.BoxGeometry(width, height, thickness);
  geos.push(plate);
  for (let i = 0; i < ribs; i++) {
    const t = (i + 1) / (ribs + 1);
    const g = new THREE.BoxGeometry(width * 0.96, height * 0.04, thickness * 2.2);
    g.translate(0, -height / 2 + height * t, 0);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  merged.computeVertexNormals();
  const m = new THREE.Mesh(merged, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * 环形散热鳍阵列（多层、每层若干片，径向布置）。
 * @returns {THREE.InstancedMesh}
 */
export function makeRadiatorRing({
  count = 32,
  radiusFn = () => 500,
  width = 60,
  height = 140,
  thickness = 6,
  yFn = () => 0,
  tilt = 0,
  material = null,
  partId = null,
  name = 'radiator-ring',
}) {
  const geo = new THREE.BoxGeometry(width, height, thickness);
  // 加两道水平加强筋，合并进同一几何体
  const ribA = new THREE.BoxGeometry(width * 0.96, height * 0.045, thickness * 2.4);
  ribA.translate(0, -height * 0.3, 0);
  const ribB = new THREE.BoxGeometry(width * 0.96, height * 0.045, thickness * 2.4);
  ribB.translate(0, height * 0.3, 0);
  const merged = mergeGeometries([geo, ribA, ribB], false) || geo;
  geo.dispose(); ribA.dispose(); ribB.dispose();
  merged.computeVertexNormals();

  const mat = material || new THREE.MeshStandardMaterial({ color: 0xd3dae2, roughness: 0.3, metalness: 0.78 });
  const inst = new THREE.InstancedMesh(merged, mat, Math.max(count, 1));
  inst.count = count;
  inst.name = name;
  inst.castShadow = true;
  inst.receiveShadow = true;
  if (partId) inst.userData.partId = partId;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = typeof radiusFn === 'function' ? radiusFn(i, a) : radiusFn;
    const y = typeof yFn === 'function' ? yFn(i, a) : yFn;
    pos.set(Math.cos(a) * r, y, Math.sin(a) * r);
    e.set(0, -a + Math.PI / 2, tilt);
    q.setFromEuler(e);
    m4.compose(pos, q, scl);
    inst.setMatrixAt(i, m4);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  return inst;
}

/* ═══════════════ 桁架环 / 环梁 ═══════════════ */

/**
 * 环梁 / 桁架环（箱型截面圆环 + 加劲 + 螺栓环）。
 * @param {object} o
 * @param {number} o.radius 环半径
 * @param {number} o.y 高度
 * @param {number} [o.beam] 梁截面尺寸（方形边长）
 * @param {number} [o.tubular=SEG.huge]
 * @param {number} [o.boltCount=0]
 */
export function makeTrussRing({
  radius = 100,
  y = 0,
  beam = 8,
  material = null,
  tubular = SEG.huge,
  boltCount = 0,
  boltScale = 1,
  materials = null,
  depth = null,
  stiffeners = 0,
  name = 'truss-ring',
} = {}) {
  const group = new THREE.Group();
  group.name = name;
  group.position.y = y;

  const section = new THREE.BoxGeometry(beam * 0.7, beam, depth ?? beam * 1.5);
  const ringGeo = new THREE.TorusGeometry(radius, beam * 0.5, 4, tubular);
  ringGeo.rotateX(Math.PI / 2);
  // 用方形截面更接近箱型梁：TorusGeometry 截面是圆，这里用 InstancedMesh 拼近似
  const count = tubular;
  const inst = new THREE.InstancedMesh(section, material, count);
  inst.count = count;
  inst.castShadow = true;
  inst.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const segLen = (2 * Math.PI * radius) / count * 1.12;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pos.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    e.set(0, -a, 0);
    q.setFromEuler(e);
    scl.set(segLen / (beam * 0.7), 1, 1);
    m4.compose(pos, q, scl);
    inst.setMatrixAt(i, m4);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  group.add(inst);
  ringGeo.dispose();

  if (stiffeners > 0) {
    const sg = new THREE.BoxGeometry(beam * 1.6, beam * 1.5, beam * 0.5);
    const sInst = new THREE.InstancedMesh(sg, material, stiffeners);
    for (let i = 0; i < stiffeners; i++) {
      const a = (i / stiffeners) * Math.PI * 2;
      pos.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      e.set(0, -a, 0);
      q.setFromEuler(e);
      scl.set(1, 1, 1);
      m4.compose(pos, q, scl);
      sInst.setMatrixAt(i, m4);
    }
    sInst.instanceMatrix.needsUpdate = true;
    sInst.frustumCulled = false;
    sInst.castShadow = true;
    group.add(sInst);
  }

  if (boltCount > 0) {
    group.add(makeBoltRing(radius, beam * 0.6, boltCount, boltScale, materials));
  }
  return group;
}

/* ═══════════════ 检修平台 ═══════════════ */

/**
 * 环形检修平台：格栅面 + 内外护栏 + 立柱。
 */
export function makePlatform({
  radius = 100,
  width = 12,
  y = 0,
  railHeight = 6,
  material = null,
  railMaterial = null,
  segments = SEG.huge,
  name = 'platform',
} = {}) {
  const group = new THREE.Group();
  group.name = name;
  group.position.y = y;

  // 平台面（环）
  const deck = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + width, segments, 1),
    material,
  );
  deck.rotation.x = -Math.PI / 2;
  deck.material = material;
  deck.receiveShadow = true;
  group.add(deck);

  // 格栅纹（细条实例）
  const bars = Math.max(8, Math.floor(segments / 2));
  const barGeo = new THREE.BoxGeometry(width * 0.98, 0.6, 1.2);
  const barInst = new THREE.InstancedMesh(barGeo, material, bars);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2;
    pos.set(Math.cos(a) * (radius + width * 0.5), 0.4, Math.sin(a) * (radius + width * 0.5));
    e.set(0, -a, 0);
    q.setFromEuler(e);
    scl.set(1, 1, width * 0.9);
    m4.compose(pos, q, scl);
    barInst.setMatrixAt(i, m4);
  }
  barInst.instanceMatrix.needsUpdate = true;
  barInst.frustumCulled = false;
  group.add(barInst);

  // 护栏：内外各一圈圆环 + 立柱
  const railMat = railMaterial || material;
  const railGeo = new THREE.TorusGeometry(radius + width, railHeight * 0.09, 3, Math.max(12, Math.floor(segments / 2)));
  railGeo.rotateX(Math.PI / 2);
  const railTop = new THREE.Mesh(railGeo, railMat);
  railTop.position.y = railHeight;
  group.add(railTop);
  const railMid = new THREE.Mesh(railGeo.clone(), railMat);
  railMid.position.y = railHeight * 0.5;
  group.add(railMid);

  const posts = Math.max(8, Math.floor(segments / 3));
  const postGeo = new THREE.CylinderGeometry(0.5, 0.5, railHeight, 4);
  postGeo.translate(0, railHeight / 2, 0);
  const postInst = new THREE.InstancedMesh(postGeo, railMat, posts);
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    pos.set(Math.cos(a) * (radius + width), 0, Math.sin(a) * (radius + width));
    q.identity();
    scl.set(1, 1, 1);
    m4.compose(pos, q, scl);
    postInst.setMatrixAt(i, m4);
  }
  postInst.instanceMatrix.needsUpdate = true;
  postInst.frustumCulled = false;
  group.add(postInst);

  return group;
}

/* ═══════════════ 门式吊机 ═══════════════ */

/**
 * 塔顶门式吊机：两根立柱 + 横梁 + 小车 + 吊钩。
 */
export function makeGantryCrane({
  span = 400,
  height = 120,
  material = null,
  cableMaterial = null,
  name = 'gantry-crane',
} = {}) {
  const group = new THREE.Group();
  group.name = name;
  const legR = span * 0.035;
  const geos = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.BoxGeometry(legR, height, legR);
    g.translate(sx * span * 0.5, height / 2, 0);
    geos.push(g);
    // 斜撑
    for (let i = 0; i < 4; i++) {
      const y0 = height * (0.15 + i * 0.2);
      const b = new THREE.BoxGeometry(legR * 0.35, legR * 4.2, legR * 0.35);
      b.rotateZ(sx * 0.6);
      b.translate(sx * span * 0.5 + sx * legR * 1.1, y0, 0);
      geos.push(b);
    }
  }
  // 主梁（桁架感：上下弦 + 腹杆）
  const girder = new THREE.BoxGeometry(span * 1.1, legR * 1.3, legR * 1.6);
  girder.translate(0, height, 0);
  geos.push(girder);
  const girder2 = new THREE.BoxGeometry(span * 1.1, legR * 0.5, legR * 0.5);
  girder2.translate(0, height * 1.18, 0);
  geos.push(girder2);
  for (let i = 0; i < 16; i++) {
    const t = i / 15 - 0.5;
    const v = new THREE.BoxGeometry(legR * 0.4, height * 0.18, legR * 0.4);
    v.rotateZ(0.5 * (i % 2 ? 1 : -1));
    v.translate(t * span * 1.05, height * 1.09, 0);
    geos.push(v);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (merged) {
    merged.computeVertexNormals();
    const m = new THREE.Mesh(merged, material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // 小车 + 吊钩
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(span * 0.1, legR * 2, legR * 3), material);
  trolley.position.set(span * 0.16, height - legR, 0);
  trolley.castShadow = true;
  group.add(trolley);
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(legR * 0.12, legR * 0.12, height * 0.7, 4),
    cableMaterial || material,
  );
  cable.position.set(span * 0.16, height - height * 0.35, 0);
  group.add(cable);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(legR * 2.4, legR * 1.4, legR * 1.4), material);
  hook.position.set(span * 0.16, height - height * 0.7, 0);
  hook.castShadow = true;
  group.add(hook);

  return group;
}

/* ═══════════════ 舱段 / 方箱 ═══════════════ */

/**
 * 模块化舱段：方箱 + 表面细节 + 检修门 + 状态灯。
 */
export function makeEquipmentBox({
  w = 100,
  h = 60,
  d = 40,
  material = null,
  detailMaterial = null,
  seed = 3,
  name = 'equipment-box',
} = {}) {
  const group = new THREE.Group();
  group.name = name;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  let s = seed * 7919 + 104729;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const geos = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const bw = w * (0.1 + rnd() * 0.24);
    const bh = h * (0.1 + rnd() * 0.3);
    const bd = d * (0.05 + rnd() * 0.14);
    const g = new THREE.BoxGeometry(bw, bh, bd);
    g.translate(
      (rnd() - 0.5) * (w - bw) * 0.8,
      (rnd() - 0.5) * (h - bh) * 0.8,
      d / 2 + bd / 2,
    );
    geos.push(g);
  }
  // 百叶
  for (let i = 0; i < 4; i++) {
    const g = new THREE.BoxGeometry(w * 0.42, h * 0.04, d * 0.06);
    g.translate(-w * 0.2, -h * 0.3 + i * h * 0.08, d / 2 + d * 0.03);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (merged) {
    merged.computeVertexNormals();
    const m = new THREE.Mesh(merged, detailMaterial || material);
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

/* ═══════════════ 拉瓦尔喷管 ═══════════════ */

/**
 * 拉瓦尔喷管轮廓（沿 Y 轴，喉部在 yThroat，出口在下）。
 * 采用分段拼接：收敛段 + 喉部 + 扩张段，避免轮廓自交产生 NaN。
 * @returns {THREE.BufferGeometry} 开放外表面（前端开口）
 */
export function makeLavalNozzleProfile({
  rInlet = 420,
  rThroat = 130,
  rExit = 390,
  convergH = 260,
  throatH = 90,
  divergH = 420,
  segments = SEG.huge,
  openEnded = true,
} = {}) {
  const geos = [];

  // 收敛段：rInlet -> rThroat
  const conv = new THREE.CylinderGeometry(rThroat, rInlet, convergH, segments, 3, openEnded);
  conv.translate(0, convergH / 2, 0);
  geos.push(conv);

  // 喉部直段
  const th = new THREE.CylinderGeometry(rThroat, rThroat, throatH, segments, 1, openEnded);
  th.translate(0, -throatH / 2, 0);
  geos.push(th);

  // 扩张段：分 3 段递增半径，近似钟形
  const steps = 3;
  let y = -throatH;
  let rPrev = rThroat;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const rNext = rThroat + (rExit - rThroat) * Math.pow(t, 0.62);
    const segH = (divergH / steps) * (1 + t * 0.25);
    const g = new THREE.CylinderGeometry(rNext, rPrev, segH, segments, 2, openEnded);
    g.translate(0, y - segH / 2, 0);
    geos.push(g);
    y -= segH;
    rPrev = rNext;
  }

  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (merged) merged.computeVertexNormals();
  return merged;
}

/* ═══════════════ 统计 ═══════════════ */

/** 统计一个 Object3D 子树的三角形总数 */
export function countTriangles(root) {
  let tris = 0;
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const g = o.geometry;
    if (!g) return;
    const t = triangleCount(g);
    tris += o.isInstancedMesh ? t * (o.count || 1) : t;
  });
  return tris;
}

/** 统计一个 Object3D 子树的网格数量 */
export function countMeshes(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh) n++; });
  return n;
}

export default {
  SEG, makeBoltGeo, makeInstancedBolts, makeBoltRing, makeRibArray, makeFlange,
  makePipeRun, makeLatticeMast, makeGreeblePanel, makeWarningStripe, makeRadiatorFin,
  makeRadiatorRing, makeTrussRing, makePlatform, makeGantryCrane, makeEquipmentBox,
  makeLavalNozzleProfile, countTriangles, countMeshes, triangleCount,
};
