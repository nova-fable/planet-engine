/**
 * assembly.js — 行星发动机整机装配
 *
 * 依据 src/data/parts.js 里的 PARTS 逐项建三维实体，并通过 registry.register 注册。
 * 关键约定（依据 MOREVFX 官方视效解析修正）：
 *   · 世界单位 = 米，整机高 ≈ ENGINE_META.totalHeight = 11000
 *   · +Y 向上，坝体底部位于 y ≈ 0，整机在 X/Z 上居中
 *   · **喷口朝上**：收扩喷管阵列位于塔顶，等离子体垂直向上排入天空
 *     官方原话："行星发动机高达8000米，且发动机喷口在云层之上"
 *   · 基座为**环形坝体（坝体）**：环绕塔脚、坝顶可通行、内含通往地下城的升降竖井
 *   · 塔身由**七条主支撑腿**（base-buttress）自坝顶环梁斜撑收分至塔身
 *   · **无地面导流槽** —— 射流朝上，不会冲击地面
 *   · 每个 PARTS 键恰好注册一次，explodeDir/explodeDist/order 均为可视化拆解服务
 *
 * 竖向分区（自下而上）：
 *   -100     – 400    环形坝体（坝体，外径 4000 / 环宽 300）+ 坝顶道路 + 升降井口
 *   360      – 4300   七条主支撑腿（斜撑，自坝顶环梁收分至下段塔身）
 *   400      – 3800   下段塔身壳体（喇叭口外张段：1500 → 947）
 *   3800     – 6300   中段塔身壳体（947 → 597）
 *   6300     – 9700   上段塔身壳体（597 → 375）
 *   6100     – 8100   中央承重柱 / 重聚变燃烧室（塔身内，喷口正下方）
 *   6420              点火核心（燃烧室底部，点火闸门上方）
 *   8100     – 8400   燃料喷注环
 *   8150     – 9800   磁约束线圈组（燃烧室上方）
 *   9700     – 10420  塔帽收头（过渡段）
 *   10560             喷管喉部（塔顶）
 *   10560    – 11000  喷管收扩阵列（出口 = 模型最高点，排气朝 +Y）
 *   10440    – 10900  喷口转向臂 + 屏障壁（环绕喷口阵列）
 *   10300             塔尖信标
 */

import * as THREE from '../vendor/three.module.js';
import { registry, PartRecord } from './registry.js';
import { PARTS, ENGINE_META } from './data/parts.js';
import * as G from './geometry.js';
import { mergeGeometries } from '../vendor/addons/BufferGeometryUtils.js';

/* ═══════════════ 主尺度常量 ═══════════════ */

const H = ENGINE_META.totalHeight;   // 11000

export const DIMS = {
  H,
  /* ── 基础：环形坝体（官方"坝体内外"）──
   * 巨型环形防洪堤，环绕塔脚：外径 3800、环宽 460、坝高约 500。
   * 坝顶可通行并布置控制中心/道路，坝体内设通往地下城的升降竖井。
   * 坝脚略低于 y=0（-100），全模型仅坝体可低于 -100。
   * 关键：baseInner 要选得让**内坡坝顶刚好抵住塔脚**（内坡顶半径 Ri*1.04 ≈ lowerR0），
   *      否则塔身与坝体内缘之间会露出一圈环形缝。 */
  baseOuter: 1900,              // 坝体外缘半径（外径 3800）
  baseInner: 1440,              // 坝体内缘半径（内坡顶 1498 ≈ 塔脚 1500，环宽 460）
  baseY0: -100,                 // 坝脚（模型最低处）
  baseY1: 400,                  // 坝顶（可通行）——约 500 m 坝高量级
  baseRingY: 150,
  damRoadR: 1670,               // 坝顶道路中心线半径


  /* ── 主支撑腿：官方"七条主支撑腿" ── */
  buttressCount: 7,             // 官方设定：七条主支撑腿（360/7 ≈ 51.43° 均布）
  legFootY: 360,                // 腿脚坐落于坝顶
  legFootR: 1580,               // 腿脚所在坝顶半径（含腿截面后仍落在坝顶面内）
  legTopY: 4300,                // 腿上端与塔身相接高度
  legTopR: 1150,                // 腿上端所在半径（贴合收分后的塔身）

  /* ── 塔身（自下而上收分）──
   * 关键：整机要读作"大胆外张的喇叭/火山口"，而不是直筒烟囱。
   * 各段首尾相接；段内用幂曲线 r(t) = rTop + (rBottom - rTop)·(1-t)^pow
   * （t=0 在段底、1 在段顶）做出**凹形**母线：下三分之一掉得急、上三分之二掉得缓。
   *
   * 剖面锚点（半径 @ 高度）：
   *   1500 @ 600（喇叭口最宽）→ 1215 @ 1800 → 980 @ 3200
   *    947 @ 3800 → 775 @ 4800 → 597 @ 6300
   *    597 @ 6300 → 490 @ 7700 → 375 @ 9700 → 320 @ 10400
   * 塔身底/顶半径比 = 1500 / 320 ≈ 4.7 : 1 */
  lowerR0: 1500,
  lowerR1: 947,
  lowerY0: 400,
  lowerY1: 3800,
  lowerPow: 1.5,                // 下段：喇叭口，收得最急

  midR0: 947,
  midR1: 597,
  midY0: 3800,
  midY1: 6300,
  midPow: 1.6,                  // 中段：继续明显收分

  upR0: 597,
  upR1: 375,
  upY0: 6300,
  upY1: 9700,
  upPow: 1.8,                   // 上段：近塔顶趋缓，形成细长的颈

  /* ── 塔帽收头：上段壳体之上的过渡，位于喷管喉部之下 ── */
  capY0: 9700,
  capY1: 10100,
  capTip: 10420,
  capTopR: 320,                 // 塔帽顶端半径（= 整机塔身顶部半径）

  /* ── 中央承重柱 / 燃烧室（喷口正下方，官方"中央承重柱/燃烧室"）──
   * 位于上段塔身内部，顶端接塔帽收头、底端接燃料喷注环。
   * 官方："喷口正下方的巨型柱体结构……柱体内含重聚变反应堆与点火核心"。 */
  reactorR: 340,
  reactorY0: 6800,
  reactorY1: 9100,

  /* ── 点火核心：燃烧室底部，点火闸门上方 ── */
  ignitionCoreY: 7100,

  /* ── 喷口阵列：塔顶，云层之上，排气朝上（官方"喷口在云层之上"）── */
  throatR: 130,
  throatY: 10560,               // 喉部：位于塔帽收头（capTip）之上
  nozzleExitR: 390,
  nozzleTopY: 11000,            // 喷口出口 = 模型最高处 = totalHeight

  coilCount: 18,
  coilY0: 9200,
  coilY1: 10250,                // 线圈组位于燃烧室上方、喉部之下

  finLayers: [4300, 4850, 5400, 5950, 6500, 7050],
  finPerLayer: 32,
  finBaseR: 560,

  /* ── 塔尖信标：安装于喷口阵列外侧，高度低于喷口出口 ── */
  beaconTip: 10300,
};

/* ── 喇叭形母线：分段幂曲线 ─────────────────────────────
 * shellRadiusAt(y) 是"塔身几何半径"的**唯一真源**：壳体、环梁、肋条、
 * 管缆、平台、竖井、桥架、传感/信标等全部由它推导，改动这里即全局贴合。 */

/** 单段幂曲线插值：t=0 → rBottom，t=1 → rTop；pow > 1 时呈凹形喇叭 */
function taperLerp(rBottom, rTop, t, pow) {
  const tt = THREE.MathUtils.clamp(t, 0, 1);
  return rTop + (rBottom - rTop) * Math.pow(1 - tt, pow);
}

/** 各高度处的塔身半径（凹形喇叭母线，供肋条/管路/平台使用） */
export function shellRadiusAt(y) {
  const D = DIMS;
  if (y <= D.lowerY0) return D.lowerR0;
  if (y < D.lowerY1) {
    return taperLerp(D.lowerR0, D.lowerR1, (y - D.lowerY0) / (D.lowerY1 - D.lowerY0), D.lowerPow);
  }
  if (y < D.midY1) {
    return taperLerp(D.midR0, D.midR1, (y - D.midY0) / (D.midY1 - D.midY0), D.midPow);
  }
  if (y < D.upY1) {
    return taperLerp(D.upR0, D.upR1, (y - D.upY0) / (D.upY1 - D.upY0), D.upPow);
  }
  return taperLerp(D.upR1, D.capTopR, (y - D.upY1) / Math.max(1, D.capTip - D.upY1), 1.15);
}

/** 母线在高度 y 处的斜率 dr/dy（供竖向构件跟随锥面内倾） */
export function shellSlopeAt(y, eps = 30) {
  return (shellRadiusAt(y + eps) - shellRadiusAt(y - eps)) / (2 * eps);
}

/** 一段凹形喇叭壳体几何（沿母线分段拼接，保证凹面轮廓正确） */
export function flaredShellGeometry(rBottom, rTop, y0, y1, pow, segments, radialSteps = 10) {
  const geos = [];
  let rPrev = rBottom;
  let yPrev = y0;
  for (let i = 1; i <= radialSteps; i++) {
    const t = i / radialSteps;
    const rNext = taperLerp(rBottom, rTop, t, pow);
    const yNext = THREE.MathUtils.lerp(y0, y1, t);
    const g = new THREE.CylinderGeometry(rNext, rPrev, Math.max(1, yNext - yPrev), segments, 1, true);
    g.translate(0, (yPrev + yNext) / 2, 0);
    geos.push(g);
    rPrev = rNext;
    yPrev = yNext;
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  merged.computeVertexNormals();
  return merged;
}

/** 环梁高度（14 道） */
export const GIRDER_LEVELS = (() => {
  const n = 14;
  const out = [];
  for (let i = 0; i < n; i++) out.push(DIMS.lowerY0 + 420 + i * ((DIMS.upY1 - DIMS.lowerY0 - 700) / (n - 1)));
  return out;
})();

/* ═══════════════ 构建上下文 ═══════════════ */

/** explodeMode 缺省推断 */
function modeFor(group) {
  switch (group) {
    case 'structure': return 'rise';
    case 'nozzle': return 'linear';
    case 'base': return 'static';
    default: return 'radial';
  }
}

class Ctx {
  constructor(materials) {
    this.mats = materials;
    this.root = new THREE.Group();
    this.root.name = 'planetary-engine';
    this.registered = new Set();
  }

  /** 取材质（未知键回退中性材质） */
  m(key) {
    const mats = this.mats;
    if (!mats) return null;
    if (mats[key]) return mats[key];
    return typeof mats.get === 'function' ? mats.get(key) : null;
  }

  /**
   * 注册一个部件。
   * @param {string} id PARTS 的键
   * @param {THREE.Object3D} object3D
   * @param {object} [opts] { explodeDir, explodeDist, order, explodeMode, material, pickable }
   */
  add(id, object3D, opts = {}) {
    const meta = PARTS[id];
    if (!meta) throw new Error(`[assembly] 未知部件 id: ${id}`);
    if (!object3D) throw new Error(`[assembly] 部件 ${id} 的 object3D 为空`);
    if (this.registered.has(id)) throw new Error(`[assembly] 部件重复注册: ${id}`);

    const group = meta.group;
    const mode = opts.explodeMode || modeFor(group);

    object3D.name = object3D.name && object3D.name !== '' ? object3D.name : id;
    object3D.userData.partId = id;
    // 让整个子树都能被 registry 的 partOf 追溯到（meshToPart 优先，userData 兜底）
    object3D.traverse?.((o) => {
      if (o.userData.partId === undefined) o.userData.partId = id;
    });

    this.root.add(object3D);

    const rec = new PartRecord({
      id,
      label: meta.label,
      labelEn: meta.labelEn,
      group,
      object3D,
      explodeDir: opts.explodeDir || new THREE.Vector3(0, 1, 0),
      explodeDist: opts.explodeDist ?? 0,
      order: opts.order ?? 10,
      detail: {
        desc: meta.desc,
        fn: meta.fn,
        material: meta.material,
        specs: meta.specs,
        category: meta.category,
        source: meta.source,
        sourceNote: meta.sourceNote,
      },
      material: opts.material || null,
      pickable: opts.pickable !== false,
      explodeMode: mode,
    });
    registry.register(rec);
    this.registered.add(id);
    return rec;
  }

  /** 便捷：只给方向，距离自动 = |dir| */
  dir(x, y, z) {
    return new THREE.Vector3(x, y, z);
  }
}

/* ═══════════════ 通用零件辅助 ═══════════════ */

/** 由一堆 Mesh 合并成单个 Mesh（减少 draw call） */
function mergeMeshes(children, material, name) {
  const geos = [];
  const inv = new THREE.Matrix4();
  for (const c of children) {
    if (!c || !c.isMesh || !c.geometry) continue;
    c.updateMatrix();
    const g = c.geometry.clone();
    g.applyMatrix4(c.matrix);
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  merged.computeVertexNormals();
  const m = new THREE.Mesh(merged, material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = name;
  return m;
}

/* ═══════════════ 各部件构建函数 ═══════════════ */

/* ── 1. 环形坝体（坝体 — 官方六大设计部分之"坝体内外"）──
 * 官方设定：发动机底部是环绕塔脚的巨型环形防洪堤（坝体），
 * 坝顶可通行车辆并布置控制中心，坝体内含通往地下城的升降竖井。
 * 本函数构建坝体本体 + 坝顶道路/护栏 + 升降井口。 */
function buildBaseRing(ctx) {
  const group = new THREE.Group();
  const { baseOuter: Ro, baseInner: Ri, baseY0, baseY1, damRoadR } = DIMS;
  const concrete = ctx.m('concrete');
  const steel = ctx.m('steelDark');
  const H = baseY1 - baseY0;

  /* ── 坝体主体：外坡 + 内坡 + 坝顶（收分台体）── */
  // 外侧坡面：堤脚略外扩（1.06），向上收至坝顶外缘
  const outerWall = new THREE.CylinderGeometry(Ro, Ro * 1.06, H, G.SEG.huge, 3, true);
  outerWall.translate(0, (baseY0 + baseY1) / 2, 0);
  group.add(G.mesh(outerWall, concrete, 'dam-outer-slope'));

  // 内侧坡面：向塔身一侧收分（内径向上略放大 = 内坡）
  const innerWall = new THREE.CylinderGeometry(Ri * 1.04, Ri * 0.94, H, G.SEG.huge, 3, true);
  innerWall.translate(0, (baseY0 + baseY1) / 2, 0);
  const innerMesh = G.mesh(innerWall, concrete, 'dam-inner-slope');
  innerMesh.material = concrete;
  group.add(innerMesh);

  /* ── 坝顶：可通行平台（环形）── */
  const top = new THREE.RingGeometry(Ri, Ro, G.SEG.huge, 1);
  top.rotateX(-Math.PI / 2);
  top.translate(0, baseY1, 0);
  group.add(G.mesh(top, concrete, 'dam-crest'));

  // 坝顶道路：环向路面 + 中心分道线 + 路缘
  const road = new THREE.RingGeometry(damRoadR - 110, damRoadR + 110, G.SEG.huge, 1);
  road.rotateX(-Math.PI / 2);
  road.translate(0, baseY1 + 6, 0);
  const roadMesh = G.mesh(road, ctx.m('warningDark'), 'dam-road');
  roadMesh.castShadow = false;
  group.add(roadMesh);

  const centreLine = new THREE.TorusGeometry(damRoadR, 5, 3, G.SEG.huge);
  centreLine.rotateX(Math.PI / 2);
  centreLine.translate(0, baseY1 + 12, 0);
  const clMesh = G.mesh(centreLine, ctx.m('warningYellow'), 'dam-road-centreline');
  clMesh.castShadow = false;
  group.add(clMesh);

  // 坝顶内/外路缘（钢包边）
  for (const [rr, nm] of [[Ro - 26, 'dam-kerb-outer'], [Ri + 26, 'dam-kerb-inner']]) {
    const kerb = new THREE.TorusGeometry(rr, 22, 5, G.SEG.huge);
    kerb.rotateX(Math.PI / 2);
    kerb.translate(0, baseY1 + 10, 0);
    group.add(G.mesh(kerb, steel, nm));
  }

  // 坝顶外侧护栏（立柱 + 横杆，实例化）
  {
    const posts = 96;
    const postGeo = new THREE.CylinderGeometry(7, 7, 70, 5);
    postGeo.translate(0, 35, 0);
    const inst = new THREE.InstancedMesh(postGeo, ctx.m('steel'), posts);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      pos.set(Math.cos(a) * (Ro - 26), baseY1 + 10, Math.sin(a) * (Ro - 26));
      q.setFromEuler(new THREE.Euler(0, -a, 0));
      m4.compose(pos, q, scl);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    group.add(inst);
    for (const yy of [baseY1 + 44, baseY1 + 74]) {
      const rail = new THREE.TorusGeometry(Ro - 26, 6, 4, G.SEG.huge);
      rail.rotateX(Math.PI / 2);
      rail.translate(0, yy, 0);
      group.add(G.mesh(rail, ctx.m('steel'), 'dam-rail'));
    }
  }

  /* ── 坝顶径向引道（自坝顶道路通向塔脚，数条即可）── */
  const rampGeos = [];
  const nRamp = 4;
  for (let i = 0; i < nRamp; i++) {
    const a = (i / nRamp) * Math.PI * 2 + 0.5;
    const w = 150;
    const g = new THREE.BoxGeometry(Ro - Ri - 40, 26, w);
    const m4 = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * (Ri + (Ro - Ri) / 2), baseY1 + 16, Math.sin(a) * (Ri + (Ro - Ri) / 2)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m4);
    rampGeos.push(g);
  }
  const ramps = mergeGeometries(rampGeos, false);
  for (const g of rampGeos) g.dispose();
  if (ramps) {
    ramps.computeVertexNormals();
    group.add(G.mesh(ramps, ctx.m('warningDark'), 'dam-ramps'));
  }

  /* ── 升降竖井口（官方：坝体内设通往地下城的升降井）── */
  // 34 座井口沿坝顶均布 —— 与官方"34 条升降井"数字对应
  const shaftCount = 34;
  const headGeos = [];
  const capGeos = [];
  for (let i = 0; i < shaftCount; i++) {
    const a = (i / shaftCount) * Math.PI * 2 + 0.09;
    const rr = Ri + (Ro - Ri) * 0.5;
    // 井口塔（方形机房）
    const g = new THREE.BoxGeometry(74, 130, 74);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * rr, baseY1 + 65, Math.sin(a) * rr),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
      new THREE.Vector3(1, 1, 1),
    ));
    headGeos.push(g);
    // 顶盖
    const cap = new THREE.CylinderGeometry(50, 56, 26, 8);
    cap.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * rr, baseY1 + 143, Math.sin(a) * rr),
      new THREE.Quaternion().identity(),
      new THREE.Vector3(1, 1, 1),
    ));
    capGeos.push(cap);
  }
  const heads = mergeGeometries(headGeos, false);
  for (const g of headGeos) g.dispose();
  if (heads) {
    heads.computeVertexNormals();
    group.add(G.mesh(heads, concrete, 'dam-shaft-heads'));
  }
  const caps = mergeGeometries(capGeos, false);
  for (const g of capGeos) g.dispose();
  if (caps) {
    caps.computeVertexNormals();
    group.add(G.mesh(caps, steel, 'dam-shaft-caps'));
  }

  /* ── 坝顶控制中心（官方：坝体内设控制中心）── */
  const cc = G.makeEquipmentBox({
    w: 420, h: 190, d: 260, material: concrete,
    detailMaterial: steel, seed: 5, name: 'dam-control-centre',
  });
  cc.position.set(0, baseY1 + 95, -(damRoadR - 96));
  cc.rotation.y = Math.PI;
  group.add(cc);
  const ccDome = new THREE.Mesh(new THREE.SphereGeometry(78, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), steel);
  ccDome.position.set(0, baseY1 + 190, -(damRoadR - 96));
  group.add(ccDome);
  const ccStrip = new THREE.Mesh(new THREE.BoxGeometry(400, 8, 8), ctx.m('strip'));
  ccStrip.position.set(0, baseY1 + 120, -(damRoadR - 96) + 132);
  group.add(ccStrip);

  /* ── 坝体分块缝（大体积混凝土的伸缩缝）── */
  const seamGeos = [];
  const seams = 68;
  const seamH = H * 0.86;
  for (let i = 0; i < seams; i++) {
    const a = (i / seams) * Math.PI * 2;
    const g = new THREE.BoxGeometry(12, seamH, Ro - Ri);
    const m4 = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * (Ri + (Ro - Ri) / 2), baseY0 + seamH / 2 + H * 0.04, Math.sin(a) * (Ri + (Ro - Ri) / 2)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m4);
    seamGeos.push(g);
  }
  const seamMesh = mergeGeometries(seamGeos, false);
  for (const g of seamGeos) g.dispose();
  if (seamMesh) {
    seamMesh.computeVertexNormals();
    const sm = G.mesh(seamMesh, steel, 'dam-joints');
    sm.castShadow = false;
    group.add(sm);
  }

  /* ── 外坡水平马道（大坝特征的台阶）── */
  for (const t of [0.34, 0.67]) {
    const yy = THREE.MathUtils.lerp(baseY0, baseY1, t);
    const rr = THREE.MathUtils.lerp(Ro * 1.06, Ro, t);
    const bermOuter = new THREE.CylinderGeometry(rr + 30, rr + 30, 34, G.SEG.huge, 1, true);
    bermOuter.translate(0, yy, 0);
    const bm = G.mesh(bermOuter, concrete, 'dam-berm');
    bm.castShadow = false;
    group.add(bm);
  }

  ctx.add('base-ring', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 900,
    order: 14,
    explodeMode: 'rise',
    material: concrete,
  });
  return group;
}

/* ── 2. 主支撑腿（官方"七条主支撑腿" + 调节支撑臂 + 维修平台）──
 * 官方设计意图：剧中存在猛烈地震，支撑架必须能相互分担受力、
 * 在支撑点加强缓冲，因此采用多腿斜撑的骨架形式。
 * 七条腿自坝顶环梁沿径向斜向内收，与塔身相接。 */
function buildButtresses(ctx) {
  const group = new THREE.Group();
  const steel = ctx.m('steel');
  const concrete = ctx.m('concrete');
  const plate = ctx.m('plateHeavy');
  const n = DIMS.buttressCount;          // = 7
  const { legFootY: y0, legFootR: r0, legTopY: y1, legTopR: r1 } = DIMS;

  // 单条腿：自 (r0, y0) 斜向 (r1, y1)；用分段箱型梁 + 格构腹杆表现钢—混组合支撑腿
  const chordGeos = [];   // 主弦杆
  const webGeos = [];     // 腹杆（格构）
  const gussetGeos = [];  // 节点板
  const deckGroup = new THREE.Group();

  const stages = 8;       // 沿腿长分 8 段

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;     // 360/7 ≈ 51.43° 均布
    const ca = Math.cos(a), sa = Math.sin(a);

    // 腿的轴线（径向剖面内的斜线）—— 坝顶更宽后，斜度更夸张
    const p0 = new THREE.Vector3(ca * r0, y0, sa * r0);
    const p1 = new THREE.Vector3(ca * r1, y1, sa * r1);

    // 垂直于腿轴的水平切向，用于布置两根/四根弦杆
    const tangent = new THREE.Vector3(-sa, 0, ca);
    const widthAt = (t) => THREE.MathUtils.lerp(460, 240, t);   // 根部粗、顶部细（坝体加宽后同步加粗）
    const depthAt = (t) => THREE.MathUtils.lerp(520, 260, t);

    // 四根主弦杆（矩形截面格构柱的四角）
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const segPts = [];
        for (let s = 0; s <= stages; s++) {
          const t = s / stages;
          const c = new THREE.Vector3().lerpVectors(p0, p1, t);
          const w = widthAt(t) * 0.5 * su;
          const d = depthAt(t) * 0.5 * sv;
          // 径向/竖向偏移：沿水平径向 + 切向
          const radial = new THREE.Vector3(ca, 0, sa);
          segPts.push(new THREE.Vector3(
            c.x + radial.x * d + tangent.x * w,
            c.y + d * 0.35,
            c.z + radial.z * d + tangent.z * w,
          ));
        }
        for (let s = 0; s < stages; s++) {
          const A = segPts[s], B = segPts[s + 1];
          const dir = new THREE.Vector3().subVectors(B, A);
          const len = dir.length();
          if (len < 1e-3) continue;
          const g = new THREE.BoxGeometry(58, len, 58);
          const mid = A.clone().addScaledVector(dir, 0.5);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
          g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
          chordGeos.push(g);
        }
      }
    }

    // 腹杆：X 形斜撑（每段两侧各一对）+ 水平横隔
    for (let s = 0; s < stages; s++) {
      const tA = s / stages, tB = (s + 1) / stages;
      const cA = new THREE.Vector3().lerpVectors(p0, p1, tA);
      const cB = new THREE.Vector3().lerpVectors(p0, p1, tB);
      const wA = widthAt(tA) * 0.5, wB = widthAt(tB) * 0.5;
      const dA = depthAt(tA) * 0.5, dB = depthAt(tB) * 0.5;
      const radial = new THREE.Vector3(ca, 0, sa);

      // 每个侧面（±切向）一对斜杆
      for (const su of [-1, 1]) {
        const A = new THREE.Vector3(
          cA.x + tangent.x * wA * su + radial.x * dA, cA.y + dA * 0.35, cA.z + tangent.z * wA * su + radial.z * dA);
        const B = new THREE.Vector3(
          cB.x + tangent.x * wB * su - radial.x * dB, cB.y - dB * 0.35, cB.z + tangent.z * wB * su - radial.z * dB);
        const dir = new THREE.Vector3().subVectors(B, A);
        const len = dir.length();
        if (len < 1e-3) continue;
        const g = new THREE.BoxGeometry(26, len, 26);
        const mid = A.clone().addScaledVector(dir, 0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
        webGeos.push(g);
      }

      // 水平横隔（箍）
      const hg = new THREE.BoxGeometry(widthAt(tB) * 0.9, 22, depthAt(tB) * 0.5);
      const hq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0));
      hg.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(cB.x, cB.y + dB * 0.35, cB.z), hq, new THREE.Vector3(1, 1, 1)));
      webGeos.push(hg);
    }

    // 节点板（根部 + 顶部）
    for (const [tt, sz] of [[0.0, 300], [1.0, 240]]) {
      const c = new THREE.Vector3().lerpVectors(p0, p1, tt);
      const g = new THREE.BoxGeometry(sz, sz * 0.5, depthAt(tt) * 1.15);
      g.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(c.x, c.y + depthAt(tt) * 0.35, c.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
        new THREE.Vector3(1, 1, 1),
      ));
      gussetGeos.push(g);
    }

    /* ── 调节支撑臂（官方"调节支撑臂"）：自腿中部斜撑至塔身 ── */
    const tArm = 0.72;
    const cArm = new THREE.Vector3().lerpVectors(p0, p1, tArm);
    const armTargetR = shellRadiusAt(THREE.MathUtils.lerp(y0, y1, tArm)) + 40;
    const armY = cArm.y + 420;
    const pA = new THREE.Vector3(cArm.x, cArm.y, cArm.z);
    const pB = new THREE.Vector3(ca * armTargetR, armY, sa * armTargetR);
    {
      const dir = new THREE.Vector3().subVectors(pB, pA);
      const len = dir.length();
      if (len > 1e-3) {
        const g = new THREE.BoxGeometry(54, len, 54);
        const mid = pA.clone().addScaledVector(dir, 0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
        webGeos.push(g);
      }
      // 支撑臂的液压调节缸（官方强调"缓冲支撑点"）
      const hg = new THREE.CylinderGeometry(40, 40, 420, 12);
      const hMid = pA.clone().lerp(pB, 0.30);
      const hq = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(pB, pA).normalize());
      hg.applyMatrix4(new THREE.Matrix4().compose(hMid, hq, new THREE.Vector3(1, 1, 1)));
      webGeos.push(hg);
      // 铰座
      const seat = new THREE.BoxGeometry(170, 130, 170);
      seat.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(pB.x, pB.y - 60, pB.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
        new THREE.Vector3(1, 1, 1),
      ));
      gussetGeos.push(seat);
    }

    /* ── 每条腿上的多功能可移动维修平台（官方描述）── */
    for (const tt of [0.30, 0.62]) {
      const c = new THREE.Vector3().lerpVectors(p0, p1, tt);
      const rr = Math.hypot(c.x, c.z);
      // 平台为环绕该腿的一段窄环：内缘贴腿、外缘只略作外挑，
      // 保证平台外缘不超过所在高度的腿截面，避免整机轮廓外溢。
      const deck = G.makePlatform({
        radius: Math.max(40, rr - 40), width: 120, y: c.y + depthAt(tt) * 0.35,
        railHeight: 36, material: ctx.m('grating'), railMaterial: steel,
        segments: 20, name: 'leg-deck',
      });
      deck.rotation.y = -a;
      deckGroup.add(deck);
    }

    // 腿脚的锚固座（落在坝顶）
    const foot = new THREE.BoxGeometry(420, 110, 480);
    foot.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(ca * r0, y0 + 20, sa * r0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
      new THREE.Vector3(1, 1, 1),
    ));
    gussetGeos.push(foot);
  }

  const chords = mergeGeometries(chordGeos, false);
  for (const g of chordGeos) g.dispose();
  if (chords) {
    chords.computeVertexNormals();
    group.add(G.mesh(chords, steel, 'leg-chords'));
  }
  const webs = mergeGeometries(webGeos, false);
  for (const g of webGeos) g.dispose();
  if (webs) {
    webs.computeVertexNormals();
    group.add(G.mesh(webs, plate, 'leg-webs'));
  }
  const gussets = mergeGeometries(gussetGeos, false);
  for (const g of gussetGeos) g.dispose();
  if (gussets) {
    gussets.computeVertexNormals();
    group.add(G.mesh(gussets, concrete, 'leg-gussets'));
  }
  group.add(deckGroup);

  /* ── 腿脚处的环形压梁（把七条腿的根部连成整体，分担受力）── */
  group.add(G.makeTrussRing({
    radius: r0, y: y0 + 90, beam: 64, material: steel, tubular: 56,
    stiffeners: 21, boltCount: 0, name: 'leg-foot-ring',
  }));

  ctx.add('base-buttress', group, {
    explodeDir: new THREE.Vector3(1, 0.25, 0),
    explodeDist: 1500,
    order: 12,
    explodeMode: 'radial',
    material: steel,
  });
  return group;
}

/* ── 3. 地脚锚栓（7 × 16 = 112 颗，锚固在坝顶七条腿脚处）── */
function buildAnchorBolts(ctx) {
  const boltMat = ctx.m('plateHeavy') || ctx.m('steel');
  const nLegs = DIMS.buttressCount;       // 7
  const perLeg = 16;                      // 每条腿 16 颗
  const positions = [];
  const baseR = DIMS.legFootR;
  const yTop = DIMS.legFootY + 95;
  const plateGeos = [];

  for (let i = 0; i < nLegs; i++) {
    const a = (i / nLegs) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const tx = -sa, tz = ca;              // 切向

    // 每条腿脚周围两圈锚栓
    for (let r = 0; r < perLeg; r++) {
      const ringIdx = r < 10 ? 0 : 1;
      const k = ringIdx === 0 ? r : r - 10;
      const cnt = ringIdx === 0 ? 10 : 6;
      const rad = baseR + (ringIdx === 0 ? -150 : 150);
      const ang = (k / cnt) * Math.PI * 2 + i * 0.31;
      positions.push({
        x: ca * rad + Math.cos(ang) * 150,
        y: yTop,
        z: sa * rad + Math.sin(ang) * 150,
        ny: 1,
      });
    }

    // 腿脚下的底板压条
    const g = new THREE.BoxGeometry(620, 30, 620);
    const m4 = new THREE.Matrix4().compose(
      new THREE.Vector3(ca * baseR, DIMS.legFootY + 62, sa * baseR),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m4);
    plateGeos.push(g);
    void tx; void tz;
  }

  const inst = G.makeInstancedBolts({
    positions,
    radius: 34,
    height: 62,
    material: boltMat,
    partId: 'anchor-bolt',
    name: 'anchor-bolts',
  });
  const group = new THREE.Group();
  group.add(inst);

  const plates = mergeGeometries(plateGeos, false);
  for (const g of plateGeos) g.dispose();
  if (plates) {
    plates.computeVertexNormals();
    group.add(G.mesh(plates, ctx.m('steel'), 'anchor-plates'));
  }

  ctx.add('anchor-bolt', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 420,
    order: 16,
    explodeMode: 'rise',
    material: boltMat,
  });
  return group;
}

/* ── 4~6. 塔身壳体（下/中/上） ──
 * 每段都是**凹形喇叭**：由 taperPow 决定的幂曲线母线沿高度分段拼接。
 * 竖向加劲肋不再拉直为一整根，而是按母线拆成若干小段逐段贴合锥面。 */
function buildShellSection(ctx, {
  id, rBottom, rTop, y0, y1, taperPow = 1.5, ribs, ribSize, materialKey, order, explodeDist,
  addBands = true, bandCount = 3,
}) {
  const group = new THREE.Group();
  const mat = ctx.m(materialKey);
  const dark = ctx.m('darkAlloy');

  // 外壳（凹形母线，沿高度 12 段拼接）
  const outerGeo = flaredShellGeometry(rBottom, rTop, y0, y1, taperPow, G.SEG.huge, 12);
  if (outerGeo) group.add(G.mesh(outerGeo, mat, `${id}-shell`));

  // 内壁（暗色，透过环梁缝隙可见；同样跟随母线）
  const innerGeo = flaredShellGeometry(rBottom * 0.965, rTop * 0.965, y0, y1, taperPow, G.SEG.huge, 8);
  if (innerGeo) {
    const innerMesh = G.mesh(innerGeo, dark, 'shell-inner');
    innerMesh.material = dark;
    innerMesh.castShadow = false;
    group.add(innerMesh);
  }

  // 壳体分带加劲环（水平，半径按母线取，不按线性插值）
  if (addBands) {
    for (let i = 1; i <= bandCount; i++) {
      const yy = THREE.MathUtils.lerp(y0, y1, i / (bandCount + 1));
      const r = shellRadiusAt(yy);
      const band = new THREE.TorusGeometry(r + 6, 9, 3, G.SEG.huge);
      band.rotateX(Math.PI / 2);
      band.translate(0, yy, 0);
      group.add(G.mesh(band, dark, 'shell-band'));
    }
  }

  // 竖向加劲肋：沿母线拆段，每段贴合该高度的锥面半径与斜率
  {
    const ribSegs = 12;
    const ribGeos = [];
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const out = ribSize[1] * 0.5;     // 肋条沿径向的外挑量
      const wide = ribSize[0];          // 肋条切向宽度
      for (let s = 0; s < ribSegs; s++) {
        const tA = s / ribSegs, tB = (s + 1) / ribSegs;
        const yA = THREE.MathUtils.lerp(y0, y1, tA);
        const yB = THREE.MathUtils.lerp(y0, y1, tB);
        const rA = taperLerp(rBottom, rTop, tA, taperPow) + out;
        const rB = taperLerp(rBottom, rTop, tB, taperPow) + out;
        const pA = new THREE.Vector3(ca * rA, yA, sa * rA);
        const pB = new THREE.Vector3(ca * rB, yB, sa * rB);
        const dir = new THREE.Vector3().subVectors(pB, pA);
        const len = dir.length();
        if (len < 1e-3) continue;
        const g = new THREE.BoxGeometry(wide, len * 1.06, ribSize[1]);
        const mid = pA.clone().addScaledVector(dir, 0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
        ribGeos.push(g);
      }
    }
    const ribMerged = mergeGeometries(ribGeos, false);
    for (const g of ribGeos) g.dispose();
    if (ribMerged) {
      ribMerged.computeVertexNormals();
      const rm = G.mesh(ribMerged, mat, 'shell-ribs');
      rm.userData.partId = 'rib-vertical';
      group.add(rm);
    }
  }

  ctx.add(id, group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist,
    order,
    explodeMode: 'rise',
    material: mat,
  });
  return group;
}

/* ── 7. 水平环梁（14 道） ── */
function buildRingGirders(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('steel');
  const dark = ctx.m('darkAlloy');

  for (let i = 0; i < GIRDER_LEVELS.length; i++) {
    const y = GIRDER_LEVELS[i];
    const r = shellRadiusAt(y) + 6;
    group.add(G.makeTrussRing({
      radius: r, y, beam: 46, material: mat, tubular: G.SEG.huge,
      depth: 62, stiffeners: 48, boltCount: i % 2 === 0 ? 24 : 0,
      boltScale: 16, materials: ctx.mats, name: `ring-girder-${i}`,
    }));
    // 环梁下翼缘加劲小牛腿
    const bracketGeos = [];
    const nb = 48;
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2;
      const g = new THREE.BoxGeometry(18, 40, 34);
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * (r - 12), y - 40, Math.sin(a) * (r - 12)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      g.applyMatrix4(m4);
      bracketGeos.push(g);
    }
    const br = mergeGeometries(bracketGeos, false);
    for (const g of bracketGeos) g.dispose();
    if (br) {
      br.computeVertexNormals();
      const m = G.mesh(br, dark, 'girder-brackets');
      m.position.set(0, 0, 0);
      group.add(m);
    }
  }

  ctx.add('ring-girder', group, {
    explodeDir: new THREE.Vector3(1, 0.15, 0),
    explodeDist: 2600,
    order: 40,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 8. 竖向加劲肋（独立注册的"全局肋"层，补充壳体局部肋） ──
 * 母线是凹形喇叭，通长直肋会中途脱离壳体，因此这里沿高度拆成多节，
 * 每节按 shellRadiusAt 取半径，逐节贴合锥面。 */
function buildGlobalRibs(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('plateHeavy');

  // 覆盖中上段的连续通长肋（壳体局部肋之外的视觉加强层）
  const count = 96;
  const y0 = DIMS.lowerY1;
  const y1 = DIMS.capY0;
  const segs = 22;
  const out = 17;                 // 肋条中心相对壳面的外挑量
  const ribGeos = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let s = 0; s < segs; s++) {
      const yA = THREE.MathUtils.lerp(y0, y1, s / segs);
      const yB = THREE.MathUtils.lerp(y0, y1, (s + 1) / segs);
      const rA = shellRadiusAt(yA) + out;
      const rB = shellRadiusAt(yB) + out;
      const pA = new THREE.Vector3(ca * rA, yA, sa * rA);
      const pB = new THREE.Vector3(ca * rB, yB, sa * rB);
      const dir = new THREE.Vector3().subVectors(pB, pA);
      const len = dir.length();
      if (len < 1e-3) continue;
      const g = new THREE.BoxGeometry(14, len * 1.05, 34);
      const mid = pA.clone().addScaledVector(dir, 0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
      ribGeos.push(g);
    }
  }
  const merged = mergeGeometries(ribGeos, false);
  for (const g of ribGeos) g.dispose();
  if (merged) {
    merged.computeVertexNormals();
    const m = G.mesh(merged, mat, 'global-ribs');
    m.userData.partId = 'rib-vertical';
    group.add(m);
  }

  ctx.add('rib-vertical', group, {
    explodeDir: new THREE.Vector3(1, 0.5, 0),
    explodeDist: 1800,
    order: 46,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 9. 燃料主管道（24 条） ── */
function buildFuelPipes(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('copper');
  const count = 24;
  const y0 = DIMS.baseY1 + 340;
  const y1 = DIMS.reactorY0 + 260;
  const pipeR = 23;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.06;
    const pts = [];
    const steps = 9;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const y = THREE.MathUtils.lerp(y0, y1, t);
      // 管道贴合塔身外壁，并在膨胀弯处外凸
      const bulge = 26 + 22 * Math.sin(t * Math.PI * 3.0);
      const r = shellRadiusAt(y) + bulge;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const pipe = G.makePipeRun(pts, pipeR, mat, 8, {
      tubular: 36,
      // 法兰由独立的 'fuel-flange' 部件承担，这里只留少量以体现分段
      flangeCount: 3,
      flangeEvery: 0.5,
      flangeBolts: 8,
      materials: ctx.mats,
      flangeMaterial: ctx.m('steelDark'),
      flangeBoltMaterial: ctx.m('bolt'),
      name: `fuel-pipe-${i}`,
    });
    if (pipe) group.add(pipe);

    // 管道支吊架（管托）
    const clampGeos = [];
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const y = THREE.MathUtils.lerp(y0, y1, t);
      const bulge = 26 + 22 * Math.sin(t * Math.PI * 3.0);
      const r = shellRadiusAt(y) + bulge;
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r;
      const g = new THREE.BoxGeometry(26, 20, 70);
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(px, y, pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      g.applyMatrix4(m4);
      clampGeos.push(g);
    }
    const cl = mergeGeometries(clampGeos, false);
    for (const g of clampGeos) g.dispose();
    if (cl) {
      cl.computeVertexNormals();
      const m = G.mesh(cl, ctx.m('steelDark'), 'pipe-clamps');
      m.castShadow = false;
      group.add(m);
    }
  }

  ctx.add('fuel-main-pipe', group, {
    explodeDir: new THREE.Vector3(1, 0.12, 0),
    explodeDist: 3400,
    order: 62,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 10. 管道法兰（独立注册：外段大法兰环） ── */
function buildFuelFlanges(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('steelDark');
  const count = 24;
  const levels = 5;
  const y0 = DIMS.baseY1 + 340;
  const y1 = DIMS.reactorY0 + 260;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.06;
    for (let k = 1; k <= levels; k++) {
      const t = k / (levels + 1);
      const y = THREE.MathUtils.lerp(y0, y1, t);
      const bulge = 26 + 22 * Math.sin(t * Math.PI * 3.0);
      const r = shellRadiusAt(y) + bulge;
      const f = G.makeFlange(46, 16, 6, ctx.mats, {
        material: mat,
        boltMaterial: ctx.m('bolt'),
        name: 'fuel-flange',
      });
      f.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      f.rotation.y = -a;
      group.add(f);
    }
  }

  ctx.add('fuel-flange', group, {
    explodeDir: new THREE.Vector3(1, 0.35, 0),
    explodeDist: 2400,
    order: 66,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 11. 燃料泵组（12 组） ── */
function buildFuelPumps(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('steelDark');
  const accent = ctx.m('copper');
  const count = 12;
  const y = DIMS.baseY1 + 200;
  const r = DIMS.lowerR0 + 210;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count;
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const unit = new THREE.Group();
    unit.position.set(px, y, pz);
    unit.rotation.y = -a;

    const body = G.makeEquipmentBox({
      w: 260, h: 170, d: 190, material: mat, detailMaterial: ctx.m('darkAlloy'),
      seed: i + 7, name: 'pump-body',
    });
    body.position.y = 85;
    unit.add(body);

    // 泵壳蜗壳 + 进出口
    const volute = new THREE.Mesh(new THREE.TorusGeometry(96, 40, 8, 20), accent);
    volute.rotation.y = Math.PI / 2;
    volute.position.set(0, 130, 150);
    volute.castShadow = true;
    unit.add(volute);

    const outlet = new THREE.Mesh(new THREE.CylinderGeometry(38, 38, 200, 10), accent);
    outlet.position.set(0, 260, 150);
    outlet.castShadow = true;
    unit.add(outlet);

    // 电机 + 散热片
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(62, 62, 210, 12), ctx.m('darkAlloy'));
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-180, 110, 0);
    motor.castShadow = true;
    unit.add(motor);
    const finGeos = [];
    for (let k = 0; k < 10; k++) {
      const g = new THREE.BoxGeometry(10, 130, 130);
      g.translate(-180 + (k - 4.5) * 20, 110, 0);
      finGeos.push(g);
    }
    const fins = mergeGeometries(finGeos, false);
    for (const g of finGeos) g.dispose();
    if (fins) {
      fins.computeVertexNormals();
      unit.add(G.mesh(fins, ctx.m('aluminium'), 'motor-fins'));
    }

    // 基础墩
    const pad = new THREE.Mesh(new THREE.BoxGeometry(320, 120, 260), ctx.m('concrete'));
    pad.position.y = -60;
    pad.castShadow = true;
    pad.receiveShadow = true;
    unit.add(pad);

    // 接管
    const suction = G.makePipeRun([
      new THREE.Vector3(0, 60, 150),
      new THREE.Vector3(-60, 20, 260),
      new THREE.Vector3(-120, -40, 320),
    ], 30, accent, 8);
    if (suction) unit.add(suction);

    group.add(unit);
  }

  ctx.add('fuel-pump', group, {
    explodeDir: new THREE.Vector3(1, 0.4, 0),
    explodeDist: 2000,
    order: 58,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 12. 燃料喷注环 ── */
function buildInjectorRing(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('tungsten');
  const glow = ctx.m('strip');
  const y = DIMS.reactorY0 + 330;
  const r = DIMS.reactorR + 40;

  // 环形集管
  const manifold = new THREE.TorusGeometry(r, 52, 8, G.SEG.huge);
  manifold.rotateX(Math.PI / 2);
  manifold.translate(0, y, 0);
  group.add(G.mesh(manifold, mat, 'injector-manifold'));

  // 96 个切向喷注嘴
  const n = 96;
  const nozzleGeo = new THREE.CylinderGeometry(16, 26, 90, 8);
  const nozzleInst = new THREE.InstancedMesh(nozzleGeo, mat, n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // 切向 24° 偏转
    const tangent = a + Math.PI / 2 + THREE.MathUtils.degToRad(24);
    const rr = r - 60;
    pos.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
    q.setFromEuler(new THREE.Euler(Math.PI * 0.5 + 0.3, -tangent, 0, 'YXZ'));
    m4.compose(pos, q, scl);
    nozzleInst.setMatrixAt(i, m4);
  }
  nozzleInst.instanceMatrix.needsUpdate = true;
  nozzleInst.frustumCulled = false;
  nozzleInst.castShadow = true;
  group.add(nozzleInst);

  // 喷注环上的发光带
  const glowRing = new THREE.TorusGeometry(r + 14, 8, 3, G.SEG.huge);
  glowRing.rotateX(Math.PI / 2);
  glowRing.translate(0, y + 60, 0);
  group.add(G.mesh(glowRing, glow, 'injector-glow'));

  // 供给支管
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const pts = [
      new THREE.Vector3(Math.cos(a) * (r + 130), y + 120, Math.sin(a) * (r + 130)),
      new THREE.Vector3(Math.cos(a) * (r + 60), y + 60, Math.sin(a) * (r + 60)),
      new THREE.Vector3(Math.cos(a) * (r + 30), y + 10, Math.sin(a) * (r + 30)),
    ];
    const p = G.makePipeRun(pts, 18, ctx.m('copper'), 6);
    if (p) group.add(p);
  }

  ctx.add('fuel-injector', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 2600,
    order: 70,
    explodeMode: 'rise',
    material: mat,
  });
  return group;
}

/* ── 13. 聚变反应室 ── */
function buildReactorVessel(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('steelDark');
  const { reactorR: r, reactorY0: y0, reactorY1: y1 } = DIMS;
  const midY = (y0 + y1) / 2;

  // 压力壳（分段制造感：三道箍 + 壳板）
  const shell = new THREE.CylinderGeometry(r, r, y1 - y0, G.SEG.huge, 4, true);
  shell.translate(0, midY, 0);
  group.add(G.mesh(shell, mat, 'reactor-shell'));

  for (let i = 0; i < 5; i++) {
    const yy = THREE.MathUtils.lerp(y0, y1, i / 4);
    const band = new THREE.TorusGeometry(r + 22, 30, 6, G.SEG.huge);
    band.rotateX(Math.PI / 2);
    band.translate(0, yy, 0);
    group.add(G.mesh(band, ctx.m('plateHeavy'), 'reactor-band'));
  }

  // 上下封头（球缺近似）
  const topCap = new THREE.SphereGeometry(r, G.SEG.huge, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
  topCap.translate(0, y1, 0);
  group.add(G.mesh(topCap, mat, 'reactor-top'));
  const botCap = new THREE.SphereGeometry(r, G.SEG.huge, 8, 0, Math.PI * 2, Math.PI * 0.58, Math.PI * 0.42);
  botCap.translate(0, y0, 0);
  const bm = G.mesh(botCap, mat, 'reactor-bottom');
  group.add(bm);

  // 观察窗 / 检修口（环向均布）
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const port = new THREE.Mesh(new THREE.CylinderGeometry(60, 74, 90, 10), ctx.m('plateHeavy'));
    port.position.set(Math.cos(a) * (r + 30), THREE.MathUtils.lerp(y0, y1, 0.28), Math.sin(a) * (r + 30));
    port.rotation.z = Math.PI / 2;
    port.rotation.y = -a;
    port.castShadow = true;
    group.add(port);
    const win = new THREE.Mesh(new THREE.CircleGeometry(46, 12), ctx.m('gold'));
    win.position.set(Math.cos(a) * (r + 74), THREE.MathUtils.lerp(y0, y1, 0.28), Math.sin(a) * (r + 74));
    win.rotation.y = -a + Math.PI / 2;
    group.add(win);
  }

  // 顶部人孔与接管
  const manhole = new THREE.Mesh(new THREE.CylinderGeometry(80, 90, 70, 12), ctx.m('plateHeavy'));
  manhole.position.y = y1 + r * 0.36;
  manhole.castShadow = true;
  group.add(manhole);

  ctx.add('reactor-vessel', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 1800,
    order: 52,
    explodeMode: 'rise',
    material: mat,
  });
  return group;
}

/* ── 13b. 点火核心（点火闸门 + 球柱状强场发生器） ── */
function buildIgnitionCore(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('tungstenHot');
  const armor = ctx.m('tungsten');
  const glow = ctx.m('plasmaCore');

  // 位置：燃烧室底部、喉部正上方
  const y = DIMS.reactorY0 + 320;
  const coreR = 150;

  // 点火闸门（下方的重型法兰座）
  const gate = new THREE.Mesh(new THREE.CylinderGeometry(240, 280, 120, 24), ctx.m('plateHeavy'));
  gate.position.y = y - 300;
  gate.castShadow = true;
  gate.receiveShadow = true;
  group.add(gate);

  // 闸门上的楔紧块（火石插入机构）
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(46, 90, 70), ctx.m('steelDark'));
    wedge.position.set(Math.cos(a) * 210, y - 220, Math.sin(a) * 210);
    wedge.rotation.y = -a;
    wedge.castShadow = true;
    group.add(wedge);
  }

  // 球柱状强场发生器外壳
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(coreR, coreR * 1.15, 320, 24, 2, false), armor);
  shell.position.y = y;
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(coreR, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), armor);
  dome.position.y = y + 160;
  dome.castShadow = true;
  group.add(dome);

  // 强场发生环（堆叠的多道线圈盘）
  for (let i = 0; i < 5; i++) {
    const r = coreR * (0.72 + i * 0.06);
    const ring = new THREE.TorusGeometry(r, 20, 6, 28);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y - 110 + i * 66, 0);
    group.add(G.mesh(ring, ctx.m('coil'), 'ignition-field-ring'));
  }

  // 核心发光体（点火时最亮的部分）
  const core = new THREE.Mesh(new THREE.SphereGeometry(coreR * 0.5, 20, 14), glow);
  core.position.y = y;
  core.castShadow = false;
  group.add(core);

  // 竖向支撑臂（把发生器固定在燃烧室底部）
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(40, 340, 40), ctx.m('steelDark'));
    arm.position.set(Math.cos(a) * (coreR + 60), y - 120, Math.sin(a) * (coreR + 60));
    arm.rotation.y = -a;
    arm.castShadow = true;
    group.add(arm);
  }

  // 火石注入导管（从侧面斜插到闸门）
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const pts = [
      new THREE.Vector3(Math.cos(a) * 520, y + 420, Math.sin(a) * 520),
      new THREE.Vector3(Math.cos(a) * 400, y + 60, Math.sin(a) * 400),
      new THREE.Vector3(Math.cos(a) * 300, y - 250, Math.sin(a) * 300),
    ];
    const pipe = G.makePipeRun(pts, 26, ctx.m('copper'), 8, {
      tubular: 28, flangeCount: 2, flangeBolts: 8, materials: ctx.mats,
      flangeMaterial: ctx.m('steelDark'), name: 'igniter-feed',
    });
    if (pipe) group.add(pipe);
  }

  ctx.add('ignition-core', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 1400,
    order: 54,
    explodeMode: 'rise',
    material: mat,
  });
  return group;
}

/* ── 14. 钨基内衬层（12 层嵌套） ── */
function buildReactorLiner(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('tungsten');
  const { reactorR: r, reactorY0: y0, reactorY1: y1 } = DIMS;
  const layers = 12;

  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const rr = r * (0.62 + t * 0.3);
    const h = (y1 - y0) * (0.72 + t * 0.24);
    const g = new THREE.CylinderGeometry(rr, rr, h, G.SEG.big, 1, true);
    g.translate(0, (y0 + y1) / 2, 0);
    const m = G.mesh(g, i === 0 ? ctx.m('plasma') : mat, `liner-${i}`);
    m.material.side = THREE.DoubleSide;
    m.castShadow = false;
    group.add(m);
  }

  // 内衬层间的纵向分隔板
  const sepGeos = [];
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    const g = new THREE.BoxGeometry(10, (y1 - y0) * 0.9, 40);
    const m4 = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * r * 0.86, (y0 + y1) / 2, Math.sin(a) * r * 0.86),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m4);
    sepGeos.push(g);
  }
  const seps = mergeGeometries(sepGeos, false);
  for (const g of sepGeos) g.dispose();
  if (seps) {
    seps.computeVertexNormals();
    const m = G.mesh(seps, mat, 'liner-separators');
    m.material.side = THREE.DoubleSide;
    group.add(m);
  }

  // 中心等离子柱（可视化"重聚变"核心）
  const core = new THREE.CylinderGeometry(r * 0.3, r * 0.3, (y1 - y0) * 0.82, G.SEG.big, 1, true);
  core.translate(0, (y0 + y1) / 2, 0);
  const coreMesh = G.mesh(core, ctx.m('plasmaCore'), 'liner-plasma-core');
  coreMesh.castShadow = false;
  group.add(coreMesh);

  ctx.add('reactor-liner', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 620,
    order: 56,
    explodeMode: 'rise',
    material: mat,
  });
  return group;
}

/* ── 15. 磁约束线圈（18 组环形 + 托卡马克式纵场线圈） ── */
function buildMagneticCoils(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('coil');
  const casing = ctx.m('coilCryo');
  const n = DIMS.coilCount;
  const y0 = DIMS.coilY0;
  const y1 = DIMS.coilY1;
  const baseR = DIMS.reactorR + 150;

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const y = THREE.MathUtils.lerp(y0, y1, t);
    // 中段鼓起（贴合反应室），两端略收
    const r = baseR * (0.94 + 0.12 * Math.sin(t * Math.PI));
    const tube = 34 + 10 * Math.sin(t * Math.PI);

    // 线圈导体（环）
    const coil = new THREE.TorusGeometry(r, tube, 8, G.SEG.huge);
    coil.rotateX(Math.PI / 2);
    coil.translate(0, y, 0);
    group.add(G.mesh(coil, mat, `coil-${i}`));

    // 低温冷屏夹套（略大一圈的薄壳环）
    const jacket = new THREE.TorusGeometry(r, tube * 1.55, 6, G.SEG.huge);
    jacket.rotateX(Math.PI / 2);
    jacket.translate(0, y, 0);
    const jm = G.mesh(jacket, casing, `coil-jacket-${i}`);
    jm.material = casing;
    jm.castShadow = false;
    group.add(jm);

    // 线圈支撑腿（径向）
    const legs = 12;
    const legGeos = [];
    for (let k = 0; k < legs; k++) {
      const a = (k / legs) * Math.PI * 2 + t * 0.2;
      const g = new THREE.BoxGeometry(24, 30, 120);
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * (r - 70), y, Math.sin(a) * (r - 70)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      g.applyMatrix4(m4);
      legGeos.push(g);
    }
    const lg = mergeGeometries(legGeos, false);
    for (const g of legGeos) g.dispose();
    if (lg) {
      lg.computeVertexNormals();
      const m = G.mesh(lg, casing, 'coil-legs');
      m.castShadow = false;
      group.add(m);
    }

    // 每 3 组加一对馈线
    if (i % 3 === 0) {
      for (const sgn of [1, -1]) {
        const a = (i * 0.7) * Math.PI * 2 + (sgn > 0 ? 0 : Math.PI);
        const rr = r + 120;
        const pts = [
          new THREE.Vector3(Math.cos(a) * rr, y - 60, Math.sin(a) * rr),
          new THREE.Vector3(Math.cos(a) * (rr + 30), y - 220, Math.sin(a) * (rr + 30)),
          new THREE.Vector3(Math.cos(a) * (rr + 10), y - 380, Math.sin(a) * (rr + 10)),
        ];
        const p = G.makePipeRun(pts, 22, ctx.m('superconductor'), 8);
        if (p) group.add(p);
      }
    }
  }

  ctx.add('magnetic-coil', group, {
    explodeDir: new THREE.Vector3(1, 0.05, 0),
    explodeDist: 4200,
    order: 78,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 16. 低温冷屏（独立注册的环形冷屏组） ── */
function buildCryo(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('coilCryo');
  const n = 9;
  const y0 = DIMS.coilY0 + 60;
  const y1 = DIMS.coilY1 - 60;
  const r = DIMS.reactorR + 96;

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = THREE.MathUtils.lerp(y0, y1, t);
    const shell = new THREE.CylinderGeometry(r, r, (y1 - y0) / n * 0.82, G.SEG.big, 1, true);
    shell.translate(0, y, 0);
    const m = G.mesh(shell, mat, `cryo-shield-${i}`);
    m.material.side = THREE.DoubleSide;
    m.castShadow = false;
    group.add(m);

    // 液氦管环
    const ring = new THREE.TorusGeometry(r + 16, 14, 6, G.SEG.big);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y + (y1 - y0) / n * 0.5, 0);
    group.add(G.mesh(ring, ctx.m('coolant'), 'cryo-line'));
  }

  // 冷箱与压缩机
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const box = G.makeEquipmentBox({
      w: 90, h: 150, d: 90, material: mat, detailMaterial: ctx.m('steelDark'),
      seed: 20 + i, name: 'cryo-coldbox',
    });
    box.position.set(Math.cos(a) * (r + 90), THREE.MathUtils.lerp(y0, y1, 0.5), Math.sin(a) * (r + 90));
    box.rotation.y = -a;
    group.add(box);
  }

  ctx.add('coil-cryo', group, {
    explodeDir: new THREE.Vector3(1, 0, 0),
    explodeDist: 3000,
    order: 82,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 17. 喷管喉部 ── */
function buildNozzleThroat(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('carbonInner');
  const outer = ctx.m('tungsten');
  const { throatR: r, throatY: y } = DIMS;

  const inner = new THREE.CylinderGeometry(r, r * 1.12, 170, G.SEG.huge, 2, true);
  inner.translate(0, y, 0);
  const im = G.mesh(inner, mat, 'throat-inner');
  im.material.side = THREE.DoubleSide;
  group.add(im);

  const shell = new THREE.CylinderGeometry(r * 1.4, r * 1.5, 190, G.SEG.huge, 1, false);
  shell.translate(0, y, 0);
  group.add(G.mesh(shell, outer, 'throat-shell'));

  // 主动冷却通道（外壁密排小管）
  const n = 96;
  const tubeGeo = new THREE.CylinderGeometry(5, 5, 180, 5);
  const inst = new THREE.InstancedMesh(tubeGeo, ctx.m('coolant'), n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos.set(Math.cos(a) * (r * 1.52), y, Math.sin(a) * (r * 1.52));
    q.identity();
    m4.compose(pos, q, scl);
    inst.setMatrixAt(i, m4);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  group.add(inst);

  // 喉部加强环
  for (const yy of [y + 100, y - 100]) {
    const ring = new THREE.TorusGeometry(r * 1.5, 14, 5, G.SEG.huge);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, yy, 0);
    group.add(G.mesh(ring, outer, 'throat-ring'));
  }

  ctx.add('nozzle-throat', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 1600,
    order: 86,
    explodeMode: 'linear',
    material: outer,
  });
  return group;
}

/* ── 18. 喷管扩张段（钟形） ── */
function buildNozzleBell(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('carbon');
  const innerMat = ctx.m('carbonInner');
  const { throatR, nozzleExitR } = DIMS;
  const yTop = DIMS.throatY + 110;   // 自喉部向上扩张（排气朝 +Y）

  // 外壁（钟形，分段锥台，向上扩张）
  const steps = 6;
  let rPrev = throatR * 1.5;
  let y = yTop;
  const outerGeos = [];
  const innerGeos = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const rNext = throatR * 1.5 + (nozzleExitR - throatR * 1.5) * Math.pow(t, 0.6);
    const segH = ((DIMS.nozzleTopY - yTop) / steps) * (1 + t * 0.3);
    const o = new THREE.CylinderGeometry(rPrev, rNext, segH, G.SEG.huge, 1, true);
    o.translate(0, y + segH / 2, 0);
    outerGeos.push(o);
    const inr = new THREE.CylinderGeometry(rPrev * 0.955, rNext * 0.955, segH, G.SEG.huge, 1, true);
    inr.translate(0, y + segH / 2, 0);
    innerGeos.push(inr);
    y += segH;
    rPrev = rNext;
  }
  const outerMerged = mergeGeometries(outerGeos, false);
  for (const g of outerGeos) g.dispose();
  if (outerMerged) {
    outerMerged.computeVertexNormals();
    group.add(G.mesh(outerMerged, mat, 'bell-outer'));
  }
  const innerMerged = mergeGeometries(innerGeos, false);
  for (const g of innerGeos) g.dispose();
  if (innerMerged) {
    innerMerged.computeVertexNormals();
    const im = G.mesh(innerMerged, innerMat, 'bell-inner');
    im.material.side = THREE.DoubleSide;
    im.castShadow = false;
    group.add(im);
  }

  // 出口加强环 + 再生冷却环管
  const lip = new THREE.TorusGeometry(nozzleExitR, 26, 8, G.SEG.huge);
  lip.rotateX(Math.PI / 2);
  lip.translate(0, DIMS.nozzleTopY - 30, 0);
  group.add(G.mesh(lip, ctx.m('tungsten'), 'bell-lip'));

  // 沿钟形母线的加强环箍（6 道）
  for (let i = 1; i <= 6; i++) {
    const t = i / 7;
    const rr = throatR * 1.5 + (nozzleExitR - throatR * 1.5) * Math.pow(t, 0.6);
    const yy = THREE.MathUtils.lerp(yTop, DIMS.nozzleTopY - 40, t);
    const hoop = new THREE.TorusGeometry(rr * 1.03, 16, 5, G.SEG.huge);
    hoop.rotateX(Math.PI / 2);
    hoop.translate(0, yy, 0);
    group.add(G.mesh(hoop, ctx.m('titanium'), 'bell-hoop'));
  }

  // 纵向加强筋（沿母线，向上）
  const nRib = 48;
  const ribGeos = [];
  for (let i = 0; i < nRib; i++) {
    const a = (i / nRib) * Math.PI * 2;
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps;
      const t1 = (k + 1) / steps;
      const r0 = throatR * 1.5 + (nozzleExitR - throatR * 1.5) * Math.pow(t0, 0.6);
      const r1 = throatR * 1.5 + (nozzleExitR - throatR * 1.5) * Math.pow(t1, 0.6);
      const y0 = yTop + (DIMS.nozzleTopY - yTop) * Math.pow(t0, 0.85);
      const y1 = yTop + (DIMS.nozzleTopY - yTop) * Math.pow(t1, 0.85);
      const p0 = new THREE.Vector3(Math.cos(a) * (r0 + 14), y0, Math.sin(a) * (r0 + 14));
      const p1 = new THREE.Vector3(Math.cos(a) * (r1 + 14), y1, Math.sin(a) * (r1 + 14));
      const dir = new THREE.Vector3().subVectors(p1, p0);
      const len = dir.length();
      if (len < 1e-3) continue;
      const g = new THREE.BoxGeometry(14, len, 30);
      const mid = p0.clone().addScaledVector(dir, 0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
      ribGeos.push(g);
    }
  }
  const ribs = mergeGeometries(ribGeos, false);
  for (const g of ribGeos) g.dispose();
  if (ribs) {
    ribs.computeVertexNormals();
    group.add(G.mesh(ribs, ctx.m('titanium'), 'bell-ribs'));
  }

  ctx.add('nozzle-bell', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 4600,
    order: 90,
    explodeMode: 'linear',
    material: mat,
  });
  return group;
}

/* ── 19. 喷管作动器（8 组） ── */
function buildActuators(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('actuator');
  const rodMat = ctx.m('actuatorRod');
  const n = 8;
  // 作动器安装于喉部之下、塔帽收头之上，向上推动喉部/喷管实现推力矢量
  const yTop = DIMS.capTip - 20;          // 上端（靠近喉部，但低于喷口出口）
  const yBot = DIMS.capY0 + 260;          // 下端（塔帽收头上）
  const rTop = 620;
  const rBot = DIMS.nozzleExitR + 320;

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(52, 52, Math.abs(yTop - yBot) * 0.55, 12), mat);
    cyl.position.set(Math.cos(a) * rTop, (yTop + yBot) / 2 + 220, Math.sin(a) * rTop);
    cyl.castShadow = true;
    group.add(cyl);

    // 活塞杆（伸向喉部方向，向下外倾）
    const p0 = new THREE.Vector3(Math.cos(a) * rTop, yTop - 60, Math.sin(a) * rTop);
    const p1 = new THREE.Vector3(Math.cos(a) * rBot, yBot, Math.sin(a) * rBot);
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const len = dir.length();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, len, 10), rodMat);
    rod.position.copy(p0).addScaledVector(dir, 0.5);
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    rod.castShadow = true;
    group.add(rod);

    // 上下铰座
    for (const [pp] of [[p0], [p1]]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(150, 100, 150), ctx.m('steelDark'));
      seat.position.copy(pp);
      seat.castShadow = true;
      group.add(seat);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 190, 10), rodMat);
      pin.rotation.z = Math.PI / 2;
      pin.rotation.y = -a + Math.PI / 2;
      pin.position.copy(pp);
      group.add(pin);
    }

    // 液压管路
    const hose = G.makePipeRun([
      new THREE.Vector3(Math.cos(a) * (rTop + 70), yTop + 60, Math.sin(a) * (rTop + 70)),
      new THREE.Vector3(Math.cos(a) * (rTop + 110), yTop + 200, Math.sin(a) * (rTop + 110)),
      new THREE.Vector3(Math.cos(a) * (rTop + 40), yTop + 330, Math.sin(a) * (rTop + 40)),
    ], 16, ctx.m('cable'), 6);
    if (hose) group.add(hose);
  }

  // 作动器支承环梁
  group.add(G.makeTrussRing({
    radius: rTop + 40, y: yTop - 40, beam: 40, material: ctx.m('steel'), tubular: 40,
    stiffeners: 16, name: 'actuator-ring',
  }));

  ctx.add('nozzle-actuator', group, {
    explodeDir: new THREE.Vector3(1, -0.6, 0),
    explodeDist: 2600,
    order: 94,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 20. 喷口转向臂 + 屏障壁（官方资产名"喷口转向臂"）
 *     位于塔顶喷口阵列外围，由机械臂驱动可收放的屏障壁约束等离子体射流。
 *     注意：本机喷口朝上，射流不会冲击地面，因此不存在地面导流槽。 ── */
function buildFlameTrench(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('refractory');
  const steel = ctx.m('steelDark');
  const armMat = ctx.m('actuator');
  const panelMat = ctx.m('titanium');

  const n = 7;                      // 七组转向臂（与"七条主支撑腿"呼应）
  const rBase = DIMS.nozzleExitR + 240;
  const yBase = DIMS.throatY - 60;              // 臂根：喉部附近
  const yTop = DIMS.nozzleTopY - 420;           // 臂与屏障壁顶端：低于喷口出口，绝不越过喷口

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const ca = Math.cos(a), sa = Math.sin(a);

    // 主臂：自喷口根部斜向外上方伸出
    const p0 = new THREE.Vector3(ca * rBase, yBase, sa * rBase);
    const p1 = new THREE.Vector3(ca * (rBase + 300), yTop, sa * (rBase + 300));
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const len = dir.length();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(120, len, 160), armMat);
    arm.position.copy(p0).addScaledVector(dir, 0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    arm.castShadow = true;
    group.add(arm);

    // 屏障壁面板（弧形，面向喷流；顶端不超过 yTop + 半高）
    const panelH = 760;
    const panel = new THREE.Mesh(
      new THREE.CylinderGeometry(320, 320, panelH, 14, 1, true, a - 0.26, 0.52),
      panelMat,
    );
    panel.position.set(ca * (rBase + 400), yTop - 60, sa * (rBase + 400));
    panel.castShadow = true;
    group.add(panel);

    // 面板背肋
    for (let k = 0; k < 3; k++) {
      const aa = a - 0.20 + k * 0.20;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(40, panelH * 0.92, 90), steel);
      rib.position.set(Math.cos(aa) * (rBase + 520), yTop - 60, Math.sin(aa) * (rBase + 520));
      rib.rotation.y = -aa;
      rib.castShadow = true;
      group.add(rib);
    }

    // 根部铰座
    const seat = new THREE.Mesh(new THREE.BoxGeometry(260, 180, 260), steel);
    seat.position.set(ca * rBase, yBase - 90, sa * rBase);
    seat.castShadow = true;
    group.add(seat);

    // 液压驱动缸
    const cylP0 = new THREE.Vector3(ca * (rBase - 40), yBase - 260, sa * (rBase - 40));
    const cylP1 = new THREE.Vector3(ca * (rBase + 240), yTop - 700, sa * (rBase + 240));
    const cdir = new THREE.Vector3().subVectors(cylP1, cylP0);
    const clen = cdir.length();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(56, 56, clen, 12), armMat);
    cyl.position.copy(cylP0).addScaledVector(cdir, 0.5);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cdir.clone().normalize());
    cyl.castShadow = true;
    group.add(cyl);

    // 液压软管
    const hose = G.makePipeRun([
      new THREE.Vector3(ca * (rBase - 90), yBase - 300, sa * (rBase - 90)),
      new THREE.Vector3(ca * (rBase + 60), yBase - 120, sa * (rBase + 60)),
      new THREE.Vector3(ca * (rBase + 200), yBase + 40, sa * (rBase + 200)),
    ], 14, ctx.m('cable'), 6);
    if (hose) group.add(hose);
  }

  // 转向臂支承环梁（环绕喷口）
  group.add(G.makeTrussRing({
    radius: rBase + 60, y: yBase - 150, beam: 46, material: steel, tubular: 44,
    stiffeners: 21, name: 'steering-ring',
  }));

  ctx.add('flame-trench', group, {
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 2200,
    order: 91,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 21. 散热鳍片组 ── */
function buildCoolingFins(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('finAlloy');
  const layers = DIMS.finLayers;

  for (let li = 0; li < layers.length; li++) {
    const y = layers[li];
    const r = shellRadiusAt(y) + 40;
    const mesh = G.makeRadiatorRing({
      count: DIMS.finPerLayer,
      radiusFn: () => r,
      width: 150,
      height: 260,
      thickness: 12,
      yFn: () => 0,
      tilt: 0,
      material: mat,
      partId: 'cooling-fin',
      name: `fin-layer-${li}`,
    });
    mesh.position.y = y;
    group.add(mesh);

    // 鳍片根部集管
    const header = new THREE.TorusGeometry(r - 6, 20, 6, G.SEG.big);
    header.rotateX(Math.PI / 2);
    header.translate(0, y, 0);
    group.add(G.mesh(header, ctx.m('coolant'), 'fin-header'));
  }

  ctx.add('cooling-fin', group, {
    explodeDir: new THREE.Vector3(1, 0.1, 0),
    explodeDist: 3200,
    order: 74,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 22. 冷却剂回路 ── */
function buildCoolantPipes(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('coolant');
  const loops = 4;

  for (let i = 0; i < loops; i++) {
    const a = (i / loops) * Math.PI * 2 + 0.8;
    const pts = [];
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const y = THREE.MathUtils.lerp(DIMS.reactorY0 - 200, DIMS.finLayers[DIMS.finLayers.length - 1] + 260, t);
      const wobble = 120 + 90 * Math.sin(t * Math.PI * 5);
      const r = shellRadiusAt(y) + wobble;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const pipe = G.makePipeRun(pts, 26, mat, 8, {
      tubular: 80, flangeCount: 5, flangeEvery: 0.25, flangeBolts: 10,
      materials: ctx.mats, flangeMaterial: ctx.m('steelDark'), name: `coolant-loop-${i}`,
    });
    if (pipe) group.add(pipe);

    // 波纹补偿节
    for (let s = 2; s < steps; s += 5) {
      const t = s / steps;
      const y = THREE.MathUtils.lerp(DIMS.reactorY0 - 200, DIMS.finLayers[DIMS.finLayers.length - 1] + 260, t);
      const wobble = 120 + 90 * Math.sin(t * Math.PI * 5);
      const r = shellRadiusAt(y) + wobble;
      const bellows = new THREE.CylinderGeometry(44, 44, 90, 10);
      bellows.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      group.add(G.mesh(bellows, ctx.m('pipeInsulation'), 'bellows'));
    }
  }

  // 泵与阀组
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.35;
    const y = THREE.MathUtils.lerp(DIMS.reactorY0, DIMS.reactorY1, i % 2 ? 0.3 : 0.7);
    const r = shellRadiusAt(y) + 150;
    const box = G.makeEquipmentBox({
      w: 130, h: 100, d: 90, material: ctx.m('steelDark'),
      detailMaterial: ctx.m('aluminium'), seed: 40 + i, name: 'coolant-valve',
    });
    box.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    box.rotation.y = -a;
    group.add(box);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(38, 9, 5, 12), ctx.m('red'));
    wheel.position.set(Math.cos(a) * (r + 60), y + 80, Math.sin(a) * (r + 60));
    wheel.rotation.y = -a;
    group.add(wheel);
  }

  ctx.add('coolant-pipe', group, {
    explodeDir: new THREE.Vector3(1, 0.25, 0),
    explodeDist: 2800,
    order: 76,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 23. 换热站（8 座） ── */
function buildHeatExchangers(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('titanium');
  const shell = ctx.m('steelDark');
  const n = 8;

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.15;
    const y = DIMS.lowerY1 - 260;
    const r = shellRadiusAt(y) + 320;
    const station = new THREE.Group();
    station.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    station.rotation.y = -a;

    const body = new THREE.Mesh(new THREE.BoxGeometry(280, 320, 200), mat);
    body.castShadow = true;
    body.receiveShadow = true;
    station.add(body);

    // 板式换热器叠片
    const plateGeos = [];
    for (let k = 0; k < 14; k++) {
      const g = new THREE.BoxGeometry(240, 300, 8);
      g.translate(0, 0, 110 + k * 14);
      plateGeos.push(g);
    }
    const plates = mergeGeometries(plateGeos, false);
    for (const g of plateGeos) g.dispose();
    if (plates) {
      plates.computeVertexNormals();
      station.add(G.mesh(plates, ctx.m('aluminium'), 'hx-plates'));
    }

    // 进出口管
    for (const sgn of [-1, 1]) {
      const p = G.makePipeRun([
        new THREE.Vector3(sgn * 120, 200, 0),
        new THREE.Vector3(sgn * 200, 300, 60),
        new THREE.Vector3(sgn * 260, 420, 120),
      ], 22, ctx.m('coolant'), 8);
      if (p) station.add(p);
    }

    // 底座
    const base = new THREE.Mesh(new THREE.BoxGeometry(340, 60, 260), shell);
    base.position.y = -190;
    base.receiveShadow = true;
    station.add(base);

    // 状态灯
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(18, 8, 6), ctx.m('statusLight'));
    lamp.position.set(0, 200, 0);
    station.add(lamp);

    group.add(station);
  }

  ctx.add('heat-exchanger', group, {
    explodeDir: new THREE.Vector3(1, 0.35, 0),
    explodeDist: 2200,
    order: 72,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 24. 控制舱段 ── */
function buildControlDeck(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('plateHeavy');
  const y = 8800;
  const r = shellRadiusAt(y) + 190;
  const a = -0.55;
  const px = Math.cos(a) * r;
  const pz = Math.sin(a) * r;

  const deck = new THREE.Group();
  deck.position.set(px, y, pz);
  deck.rotation.y = -a;

  // 主舱体（340 × 180 × 120 量级）
  const body = new THREE.Mesh(new THREE.BoxGeometry(340, 180, 240), mat);
  body.castShadow = true;
  body.receiveShadow = true;
  deck.add(body);

  // 观察窗带（玻璃幕）
  const glass = new THREE.Mesh(new THREE.BoxGeometry(300, 60, 10), ctx.m('glass'));
  glass.position.set(0, 30, 125);
  deck.add(glass);
  const glassBack = glass.clone();
  glassBack.position.z = -125;
  deck.add(glassBack);

  // 舱顶设备
  const roof = G.makeEquipmentBox({
    w: 260, h: 70, d: 180, material: ctx.m('steelDark'),
    detailMaterial: ctx.m('aluminium'), seed: 55, name: 'deck-roof',
  });
  roof.position.y = 125;
  deck.add(roof);

  // 天线 / 传感器
  const mast = G.makeLatticeMast({
    height: 260, radius: 26, legs: 4, bays: 5, chordRadius: 4, braceRadius: 2.2,
    material: ctx.m('titanium'), name: 'deck-mast',
  });
  mast.position.set(120, 90, 0);
  deck.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(70, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), ctx.m('white'));
  dish.rotation.x = Math.PI * 0.72;
  dish.position.set(120, 350, 0);
  dish.material.side = THREE.DoubleSide;
  deck.add(dish);

  // 登舱栈桥
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(r * 0.28, 34, 90), ctx.m('steel'));
  bridge.position.set(-r * 0.15, -120, 0);
  deck.add(bridge);
  for (let i = 0; i < 8; i++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 34, 5), ctx.m('steel'));
    post.position.set(-r * 0.02 - i * r * 0.035, -104, 40);
    deck.add(post);
  }

  // 舱内灯光带
  const strip = new THREE.Mesh(new THREE.BoxGeometry(330, 8, 8), ctx.m('strip'));
  strip.position.set(0, -70, 124);
  deck.add(strip);

  group.add(deck);

  // 支撑桁架
  const brace = G.makeLatticeMast({
    height: 240, radius: 60, legs: 4, bays: 4, chordRadius: 10, braceRadius: 5,
    material: ctx.m('steel'), name: 'deck-support',
  });
  brace.position.set(px * 0.82, y - 230, pz * 0.82);
  group.add(brace);

  ctx.add('control-deck', group, {
    explodeDir: new THREE.Vector3(1, 0.5, 0),
    explodeDist: 3000,
    order: 98,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 25. 电力母线 ── */
function buildPowerBus(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('cableTray');
  const glow = ctx.m('strip');
  const count = 4;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.9;
    const pts = [];
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const y = THREE.MathUtils.lerp(DIMS.lowerY1 - 200, 9400, t);
      const r = shellRadiusAt(y) + 200;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const run = G.makePipeRun(pts, 34, mat, 6, { tubular: 70, name: `power-bus-${i}` });
    if (run) {
      run.geometry?.computeVertexNormals?.();
      group.add(run);
    }

    // 母线槽内的发光导体
    const inner = G.makePipeRun(pts, 12, glow, 6, { tubular: 70, name: 'bus-conductor' });
    if (inner) group.add(inner);

    // 支吊架
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const y = THREE.MathUtils.lerp(DIMS.lowerY1 - 200, 9400, t);
      const r = shellRadiusAt(y) + 200;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(220, 20, 20), ctx.m('steel'));
      arm.position.set(Math.cos(a) * (r - 100), y, Math.sin(a) * (r - 100));
      arm.rotation.y = -a;
      group.add(arm);
    }
  }

  // 变压器 / 配电柜组
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 1.4;
    const y = THREE.MathUtils.lerp(DIMS.lowerY1, 9000, (i % 3) / 2);
    const r = shellRadiusAt(y) + 300;
    const box = G.makeEquipmentBox({
      w: 150, h: 190, d: 120, material: ctx.m('steelDark'),
      detailMaterial: ctx.m('circuit'), seed: 70 + i, name: 'switchgear',
    });
    box.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    box.rotation.y = -a;
    group.add(box);
    // 绝缘子串
    for (let k = 0; k < 3; k++) {
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 90, 6), ctx.m('white'));
      ins.position.set(Math.cos(a) * (r + 90) + (k - 1) * 40, y + 90, Math.sin(a) * (r + 90));
      group.add(ins);
    }
  }

  ctx.add('power-bus', group, {
    explodeDir: new THREE.Vector3(1, 0.4, 0),
    explodeDist: 2600,
    order: 100,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 26. 传感阵列 ── */
function buildSensors(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('white');
  const n = 240;

  const podGeo = new THREE.SphereGeometry(16, 8, 6);
  const podInst = new THREE.InstancedMesh(podGeo, mat, n);
  const mastGeo = new THREE.CylinderGeometry(4, 4, 60, 5);
  mastGeo.translate(0, 30, 0);
  const mastInst = new THREE.InstancedMesh(mastGeo, ctx.m('titanium'), n);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);

  for (let i = 0; i < n; i++) {
    const ring = Math.floor(i / 24);
    const k = i % 24;
    const a = (k / 24) * Math.PI * 2 + ring * 0.13;
    const y = THREE.MathUtils.lerp(DIMS.lowerY0 + 200, 9300, ring / 9);
    const r = shellRadiusAt(y) + 46;
    pos.set(Math.cos(a) * r, y, Math.sin(a) * r);
    q.setFromEuler(new THREE.Euler(0, -a, 0));
    m4.compose(pos, q, scl);
    podInst.setMatrixAt(i, m4);
    pos.y = y + 60;
    m4.compose(pos, q, scl);
    mastInst.setMatrixAt(i, m4);
  }
  podInst.instanceMatrix.needsUpdate = true;
  podInst.frustumCulled = false;
  podInst.castShadow = true;
  mastInst.instanceMatrix.needsUpdate = true;
  mastInst.frustumCulled = false;
  group.add(podInst);
  group.add(mastInst);

  // 大型监测站基座
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const y = THREE.MathUtils.lerp(1200, 8800, i / 5);
    const r = shellRadiusAt(y) + 120;
    const st = G.makeEquipmentBox({
      w: 90, h: 70, d: 70, material: ctx.m('steelDark'),
      detailMaterial: ctx.m('circuit'), seed: 90 + i, name: 'sensor-station',
    });
    st.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    st.rotation.y = -a;
    group.add(st);
  }

  ctx.add('sensor-array', group, {
    explodeDir: new THREE.Vector3(1, 0.6, 0),
    explodeDist: 2000,
    order: 102,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 27. 航空障碍灯 ── */
function buildBeacons(ctx) {
  const group = new THREE.Group();
  const beaconMat = ctx.m('beacon');
  const n = 72;

  const nGeo = new THREE.SphereGeometry(20, 8, 6);
  const inst = new THREE.InstancedMesh(nGeo, beaconMat, n);
  const hoodGeo = new THREE.CylinderGeometry(30, 26, 26, 8);
  hoodGeo.translate(0, 26, 0);
  const hoodInst = new THREE.InstancedMesh(hoodGeo, ctx.m('steelDark'), n);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);

  let idx = 0;
  for (let ring = 0; ring < 12 && idx < n; ring++) {
    const y = THREE.MathUtils.lerp(900, 10200, ring / 11);
    const cnt = ring % 2 === 0 ? 8 : 4;
    for (let k = 0; k < cnt && idx < n; k++, idx++) {
      const a = (k / cnt) * Math.PI * 2 + ring * 0.4;
      const r = shellRadiusAt(y) + 60;
      pos.set(Math.cos(a) * r, y, Math.sin(a) * r);
      q.identity();
      m4.compose(pos, q, scl);
      inst.setMatrixAt(idx, m4);
      hoodInst.setMatrixAt(idx, m4);
    }
  }
  inst.count = idx;
  hoodInst.count = idx;
  inst.instanceMatrix.needsUpdate = true;
  hoodInst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  hoodInst.frustumCulled = false;
  group.add(inst);
  group.add(hoodInst);

  // 塔尖主信标（更大、更高）
  const tip = new THREE.Mesh(new THREE.SphereGeometry(64, 12, 10), beaconMat);
  tip.position.y = DIMS.beaconTip;
  group.add(tip);
  const tipMast = new THREE.Mesh(new THREE.CylinderGeometry(20, 34, 700, 8), ctx.m('steel'));
  tipMast.position.y = DIMS.beaconTip - 420;
  tipMast.castShadow = true;
  group.add(tipMast);

  // 环向灯带（沿塔身的发光条）
  for (let i = 0; i < 8; i++) {
    const y = THREE.MathUtils.lerp(1300, 9800, i / 7);
    const r = shellRadiusAt(y) + 24;
    const ring = new THREE.TorusGeometry(r, 7, 3, G.SEG.big);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    group.add(G.mesh(ring, ctx.m('strip'), 'beacon-strip'));
  }

  ctx.add('beacon-light', group, {
    explodeDir: new THREE.Vector3(1, 0.8, 0),
    explodeDist: 2400,
    order: 104,
    explodeMode: 'radial',
    material: beaconMat,
  });
  return group;
}

/* ── 28. 检修平台（14 层） ── */
function buildPlatforms(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('grating');
  const steel = ctx.m('steel');

  for (let i = 0; i < GIRDER_LEVELS.length; i++) {
    const y = GIRDER_LEVELS[i];
    const r = shellRadiusAt(y) + 34;
    group.add(G.makePlatform({
      radius: r, width: 26, y: y + 46, railHeight: 34,
      material: mat, railMaterial: steel, segments: G.SEG.huge,
      name: `platform-${i}`,
    }));

    // 平台边缘黄黑警示带
    const stripe = new THREE.TorusGeometry(r + 26, 4.5, 3, G.SEG.huge);
    stripe.rotateX(Math.PI / 2);
    stripe.translate(0, y + 48, 0);
    const sm = G.mesh(stripe, ctx.m('warningPaint'), 'platform-stripe');
    group.add(sm);
  }

  ctx.add('maintenance-platform', group, {
    explodeDir: new THREE.Vector3(1, 0.15, 0),
    explodeDist: 2200,
    order: 68,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 29. 升降竖井（4 座） ──
 * 井道贴着喇叭形塔身爬升：随高度逐节改变半径，使井架始终与壳面保持
 * 约等于平台外挑量的恒定间隙，而不是在塔顶"飞离"壳体。 */
function buildElevatorShafts(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('steel');
  const cageMat = ctx.m('glass');
  const count = 4;
  const y0 = DIMS.baseY1 + 60;
  const y1 = 9600;
  const offset = 130;                 // 井道中心相对壳面的径向偏移
  const segs = 18;                    // 井架沿高度分节数

  // 井道中心半径（随高度跟随母线）
  const shaftR = (y) => shellRadiusAt(y) + offset;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.78;
    const ca = Math.cos(a), sa = Math.sin(a);
    const tx = -sa, tz = ca;          // 切向

    // 井道框架：沿母线分节，每节是一段小格构柱
    for (let s = 0; s < segs; s++) {
      const yA = THREE.MathUtils.lerp(y0, y1, s / segs);
      const yB = THREE.MathUtils.lerp(y0, y1, (s + 1) / segs);
      const segH = yB - yA;
      const rA = shaftR(yA);
      const rB = shaftR(yB);
      const pA = new THREE.Vector3(ca * rA, yA, sa * rA);
      const pB = new THREE.Vector3(ca * rB, yB, sa * rB);
      const dir = new THREE.Vector3().subVectors(pB, pA);
      const len = dir.length();
      if (len < 1e-3) continue;
      const mast = G.makeLatticeMast({
        height: len * 1.04, radius: 62, legs: 4, bays: 2,
        chordRadius: 12, braceRadius: 6, material: mat, name: `shaft-${i}-${s}`,
      });
      mast.position.copy(pA).addScaledVector(dir, 0.5);
      mast.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      group.add(mast);
      void segH;
    }

    // 井道导轨（沿母线分节，贴合锥面）
    for (const sgn of [-1, 1]) {
      const railGeos = [];
      for (let s = 0; s < segs; s++) {
        const yA = THREE.MathUtils.lerp(y0, y1, s / segs);
        const yB = THREE.MathUtils.lerp(y0, y1, (s + 1) / segs);
        const off = 46;
        const rA = shaftR(yA);
        const rB = shaftR(yB);
        const pA = new THREE.Vector3(ca * rA + tx * off * sgn, yA, sa * rA + tz * off * sgn);
        const pB = new THREE.Vector3(ca * rB + tx * off * sgn, yB, sa * rB + tz * off * sgn);
        const dir = new THREE.Vector3().subVectors(pB, pA);
        const len = dir.length();
        if (len < 1e-3) continue;
        const g = new THREE.BoxGeometry(16, len * 1.05, 16);
        const mid = pA.clone().addScaledVector(dir, 0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
        railGeos.push(g);
      }
      const railMerged = mergeGeometries(railGeos, false);
      for (const g of railGeos) g.dispose();
      if (railMerged) {
        railMerged.computeVertexNormals();
        group.add(G.mesh(railMerged, ctx.m('titanium'), 'shaft-rails'));
      }
    }

    // 轿厢（沿高度分布若干，半径同样跟随母线）
    for (let k = 0; k < 6; k++) {
      const t = (k + 0.5) / 6;
      const y = THREE.MathUtils.lerp(y0 + 300, y1 - 300, t);
      const rr = shellRadiusAt(y) + offset;
      const cage = new THREE.Mesh(new THREE.BoxGeometry(80, 100, 80), cageMat);
      cage.position.set(ca * rr + tx * 46, y, sa * rr + tz * 46);
      cage.rotation.y = -a;
      group.add(cage);
      const lightbar = new THREE.Mesh(new THREE.BoxGeometry(84, 6, 6), ctx.m('strip'));
      lightbar.position.copy(cage.position);
      lightbar.position.x += ca * 44;
      lightbar.position.z += sa * 44;
      lightbar.rotation.y = -a;
      group.add(lightbar);
    }

    // 底部机房
    const house = G.makeEquipmentBox({
      w: 200, h: 160, d: 200, material: ctx.m('steelDark'),
      detailMaterial: ctx.m('circuit'), seed: 120 + i, name: 'shaft-house',
    });
    house.position.set(ca * shaftR(y0), y0 - 40, sa * shaftR(y0));
    house.rotation.y = -a;
    group.add(house);
  }

  ctx.add('elevator-shaft', group, {
    explodeDir: new THREE.Vector3(1, 0.5, 0),
    explodeDist: 3600,
    order: 96,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 30. 塔顶吊机（4 台） ── */
function buildCranes(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('steel');
  const count = 4;
  const y = 9500;
  const span = 780;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / 4;
    const crane = G.makeGantryCrane({
      span, height: 420, material: mat,
      cableMaterial: ctx.m('actuatorRod'), name: `gantry-${i}`,
    });
    const r = shellRadiusAt(y) * 0.35;
    crane.position.set(Math.cos(a) * r, y - 300, Math.sin(a) * r);
    crane.rotation.y = -a + Math.PI / 4;
    group.add(crane);
  }

  // 吊机基座环形平台
  group.add(G.makeTrussRing({
    radius: shellRadiusAt(y) + 60, y: y - 340, beam: 54,
    material: ctx.m('plateHeavy'), tubular: G.SEG.huge, stiffeners: 32, name: 'crane-ring',
  }));

  ctx.add('gantry-crane', group, {
    explodeDir: new THREE.Vector3(1, 1, 0),
    explodeDist: 3200,
    order: 106,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 31. 警示标识带 ── */
function buildWarningStripes(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('warningYellow');
  const darkMat = ctx.m('warningDark');

  // 坝顶外缘黄黑警示带（沿坝体上缘，半径取坝体外缘）
  const baseBand = new THREE.CylinderGeometry(DIMS.baseOuter + 4, DIMS.baseOuter + 4, 90, G.SEG.huge, 1, true);
  baseBand.translate(0, DIMS.baseY1 - 130, 0);
  group.add(G.mesh(baseBand, mat, 'base-warning-band'));

  // 各平台边缘斜纹带
  for (let i = 0; i < GIRDER_LEVELS.length; i++) {
    const y = GIRDER_LEVELS[i];
    const r = shellRadiusAt(y) + 62;
    const band = new THREE.CylinderGeometry(r, r, 26, G.SEG.huge, 1, true);
    band.translate(0, y + 52, 0);
    group.add(G.mesh(band, i % 2 ? mat : darkMat, 'platform-warning-band'));
  }

  // 塔身中段的警示条（竖直面板）
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const y of [2400, 5200, 8000]) {
      const r = shellRadiusAt(y) + 50;
      const p = G.makeWarningStripe({ width: 620, height: 110, material: mat, name: 'warning-stripe' });
      p.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      p.rotation.y = -a + Math.PI / 2;
      group.add(p);
    }
  }

  // 喷口附近的警示环
  const nozBand = new THREE.CylinderGeometry(DIMS.nozzleExitR + 40, DIMS.nozzleExitR + 40, 60, G.SEG.huge, 1, true);
  nozBand.translate(0, DIMS.throatY + 250, 0);
  group.add(G.mesh(nozBand, mat, 'nozzle-warning-band'));

  ctx.add('warning-stripe', group, {
    explodeDir: new THREE.Vector3(1, 0.7, 0),
    explodeDist: 2600,
    order: 108,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 32. 电缆桥架 ── */
function buildCableTrays(ctx) {
  const group = new THREE.Group();
  const mat = ctx.m('cableTray');
  const cableMat = ctx.m('cable');
  const count = 6;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 1.15;
    const y0 = DIMS.baseY1 + 120;
    const y1 = 9700;
    const steps = 14;
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const y = THREE.MathUtils.lerp(y0, y1, t);
      const r = shellRadiusAt(y) + 96;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }

    // 桥架槽体（三层）
    for (let k = 0; k < 3; k++) {
      const trayPts = pts.map((p) => new THREE.Vector3(
        p.x + Math.cos(a + Math.PI / 2) * (k - 1) * 46,
        p.y,
        p.z + Math.sin(a + Math.PI / 2) * (k - 1) * 46,
      ));
      const tray = G.makePipeRun(trayPts, 16, mat, 4, { tubular: 84, name: 'cable-tray' });
      if (tray) group.add(tray);
      // 桥架内的电缆束
      const bun = G.makePipeRun(trayPts, 8, cableMat, 5, { tubular: 84, name: 'cable-bundle' });
      if (bun) group.add(bun);
    }

    // 桥架托臂
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const y = THREE.MathUtils.lerp(y0, y1, t);
      const r = shellRadiusAt(y) + 96;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(200, 16, 130), ctx.m('steel'));
      arm.position.set(Math.cos(a) * (r - 90), y, Math.sin(a) * (r - 90));
      arm.rotation.y = -a;
      group.add(arm);
    }
  }

  ctx.add('cable-tray', group, {
    explodeDir: new THREE.Vector3(1, 0.45, 0),
    explodeDist: 2400,
    order: 110,
    explodeMode: 'radial',
    material: mat,
  });
  return group;
}

/* ── 33. 塔帽 / 尖顶（并入上部壳体之外的收头结构） ── */
function buildCap(ctx) {
  // 塔帽作为上部壳体的子结构，不单独注册部件；
  // 但为了让塔顶轮廓完整，把它挂到 'shell-upper' 的 object3D 上。
  const rec = registry.get('shell-upper');
  if (!rec || !rec.object3D) return;
  const group = new THREE.Group();
  group.name = 'tower-cap';
  const mat = ctx.m('paintedShell');
  const steel = ctx.m('steel');

  // 截锥收头
  const steps = 5;
  let rPrev = DIMS.upR1;
  let y = DIMS.capY0;
  const geos = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const rNext = THREE.MathUtils.lerp(DIMS.upR1, 60, Math.pow(t, 0.7));
    const segH = ((DIMS.capTip - DIMS.capY0) / steps);
    const g = new THREE.CylinderGeometry(rNext, rPrev, segH, G.SEG.big, 1, true);
    g.translate(0, y + segH / 2, 0);
    geos.push(g);
    y += segH;
    rPrev = rNext;
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (merged) {
    merged.computeVertexNormals();
    const m = G.mesh(merged, mat, 'cap-cone');
    m.material.side = THREE.DoubleSide;
    group.add(m);
  }

  // 收头处的环梁与加强环
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const y2 = THREE.MathUtils.lerp(DIMS.capY0, DIMS.capTip, t);
    const r = THREE.MathUtils.lerp(DIMS.upR1, 60, Math.pow(t, 0.7)) + 6;
    const ring = new THREE.TorusGeometry(r, 14, 4, G.SEG.big);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y2, 0);
    group.add(G.mesh(ring, steel, 'cap-ring'));
  }

  // 顶部平台 + 栏杆 + 桅杆
  const deck = new THREE.Mesh(new THREE.CircleGeometry(90, 24), steel);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = DIMS.capTip;
  deck.receiveShadow = true;
  group.add(deck);
  const railGeo = new THREE.TorusGeometry(88, 3, 3, 24);
  railGeo.rotateX(Math.PI / 2);
  railGeo.translate(0, DIMS.capTip + 36, 0);
  group.add(G.mesh(railGeo, steel, 'cap-rail'));

  rec.object3D.add(group);
}

/* ═══════════════ 主构建入口 ═══════════════ */

/**
 * 构建整台行星发动机。
 * @param {object} materials createMaterials() 的返回值
 * @returns {THREE.Group} 名称为 'planetary-engine' 的根组
 */
export function buildEngine(materials) {
  registry.clear();

  const ctx = new Ctx(materials);

  // 自下而上、由外到内构建
  buildFlameTrench(ctx);        // 导流槽（地面，静态）
  buildBaseRing(ctx);           // 环形基座
  buildButtresses(ctx);         // 径向支撑墩
  buildAnchorBolts(ctx);        // 地脚锚栓

  buildShellSection(ctx, {
    id: 'shell-lower', rBottom: DIMS.lowerR0, rTop: DIMS.lowerR1,
    y0: DIMS.lowerY0, y1: DIMS.lowerY1, taperPow: DIMS.lowerPow,
    ribs: 144, ribSize: [16, 42],
    materialKey: 'paintedShell', order: 24, explodeDist: 2000, bandCount: 4,
  });
  buildShellSection(ctx, {
    id: 'shell-mid', rBottom: DIMS.midR0, rTop: DIMS.midR1,
    y0: DIMS.midY0, y1: DIMS.midY1, taperPow: DIMS.midPow,
    ribs: 120, ribSize: [14, 34],
    materialKey: 'paintedShell', order: 26, explodeDist: 2400, bandCount: 3,
  });
  buildShellSection(ctx, {
    id: 'shell-upper', rBottom: DIMS.upR0, rTop: DIMS.upR1,
    y0: DIMS.upY0, y1: DIMS.upY1, taperPow: DIMS.upPow,
    ribs: 96, ribSize: [12, 28],
    materialKey: 'titanium', order: 28, explodeDist: 2800, bandCount: 3,
  });
  buildCap(ctx);                // 塔帽（并入 shell-upper）

  buildRingGirders(ctx);        // 水平环梁
  buildGlobalRibs(ctx);         // 竖向加劲肋

  buildFuelPumps(ctx);          // 燃料泵组
  buildFuelPipes(ctx);          // 燃料主管道
  buildFuelFlanges(ctx);        // 管道法兰
  buildInjectorRing(ctx);       // 燃料喷注环

  buildReactorVessel(ctx);      // 聚变反应室
  buildIgnitionCore(ctx);       // 点火核心
  buildReactorLiner(ctx);       // 钨基内衬
  buildMagneticCoils(ctx);      // 磁约束线圈
  buildCryo(ctx);               // 低温冷屏

  buildNozzleThroat(ctx);       // 喷管喉部
  buildNozzleBell(ctx);         // 喷管扩张段
  buildActuators(ctx);          // 喷管作动器

  buildCoolingFins(ctx);        // 散热鳍片
  buildCoolantPipes(ctx);       // 冷却剂回路
  buildHeatExchangers(ctx);     // 换热站

  buildControlDeck(ctx);        // 控制舱
  buildPowerBus(ctx);           // 电力母线
  buildSensors(ctx);            // 传感阵列
  buildBeacons(ctx);            // 障碍灯

  buildPlatforms(ctx);          // 检修平台
  buildElevatorShafts(ctx);     // 升降竖井
  buildCranes(ctx);             // 塔顶吊机
  buildWarningStripes(ctx);     // 警示标识
  buildCableTrays(ctx);         // 电缆桥架

  // ── 校验：PARTS 每个键恰好注册一次 ──
  const missing = Object.keys(PARTS).filter((k) => !ctx.registered.has(k));
  const extra = [...ctx.registered].filter((k) => !PARTS[k]);
  if (missing.length) throw new Error(`[assembly] 缺少部件注册: ${missing.join(', ')}`);
  if (extra.length) throw new Error(`[assembly] 注册了多余的部件: ${extra.join(', ')}`);

  // ── 注册表头信息 ──
  registry.engineHeight = ENGINE_META.totalHeight;
  registry.engineRadius = DIMS.baseOuter;
  registry.legCount = DIMS.buttressCount;      // 官方：七条主支撑腿
  registry.nozzleTopY = DIMS.nozzleTopY;       // 喷口出口高度（用于校验排气朝上）
  registry.throatY = DIMS.throatY;
  registry.ignitionCoreY = DIMS.ignitionCoreY;

  // ── 高亮器接线 ──
  const highlight = createHighlighter(materials);
  registry.highlight = highlight;
  registry.setHover = (id) => highlight(registry.__selectedId ?? null, id);
  registry.setSelected = (id) => {
    registry.__selectedId = id;
    highlight(id, registry.__hoveredId ?? null);
  };

  return ctx.root;
}

/* ═══════════════ 高亮 ═══════════════ */

const HIGHLIGHT_EMISSIVE = new THREE.Color(0x66e0ff);
const HOVER_EMISSIVE = new THREE.Color(0xffc857);

/** 收集一个部件子树里的所有网格材质（去重） */
function collectMaterials(record) {
  const out = new Set();
  const obj = record?.object3D;
  if (!obj) return out;
  obj.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m && m.isMeshStandardMaterial) out.add(m);
  });
  if (record.material && record.material.isMeshStandardMaterial) out.add(record.material);
  return out;
}

/**
 * 创建高亮函数。
 *
 * 由于材质是全局共享的，直接改材质会"点亮"所有共用该材质的部件。
 * 因此这里对处于高亮态的对象做**材质克隆**（Object3D 级隔离），
 * 其余情况复用原始共享材质。
 *
 * @returns {(selectedId: string|null, hoveredId: string|null) => void}
 */
export function createHighlighter(materials) {
  // Object3D -> 原始材质数组（clone 时记录）
  const overrides = new Map();

  function restore() {
    for (const [mesh, originals] of overrides) {
      if (Array.isArray(mesh.material)) mesh.material = originals.slice();
      else mesh.material = originals[0];
    }
    overrides.clear();
  }

  function apply(record, color) {
    if (!record?.object3D) return;
    record.object3D.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (overrides.has(o)) return;
      const original = o.material;
      overrides.set(o, Array.isArray(original) ? original.slice() : [original]);

      const cloneOne = (m) => {
        if (!m) return m;
        if (m.isMeshStandardMaterial) {
          const c = m.clone();
          c.emissive = color.clone();
          c.emissiveIntensity = Math.max(1.6, (m.emissiveIntensity || 0) * 1.4);
          if (m.userData) c.userData = { ...m.userData };
          return c;
        }
        // 非标准材质（极少）保持原样
        return m;
      };
      if (Array.isArray(original)) o.material = original.map(cloneOne);
      else o.material = cloneOne(original);
    });
  }

  return function highlight(selectedId = null, hoveredId = null) {
    restore();
    // 选中优先：先应用 hover，再覆盖 selected
    if (hoveredId && hoveredId !== selectedId) {
      const rec = registry.get(hoveredId);
      if (rec && rec.pickable) apply(rec, HOVER_EMISSIVE);
    }
    if (selectedId) {
      const rec = registry.get(selectedId);
      if (rec && rec.pickable) apply(rec, HIGHLIGHT_EMISSIVE);
    }
  };
}

export { DIMS as ENGINE_DIMS };
export default { buildEngine, createHighlighter, DIMS, GIRDER_LEVELS, shellRadiusAt };
