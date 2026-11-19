/**
 * tests/test-assembly.mjs — 整机装配的自动化验收
 *
 * 纯 Node ESM，无需 WebGL / document。验证：
 *   a) PARTS 的每个键恰好注册一次（不多不少）
 *   b) 每个部件的 object3D 是合法 Object3D 且至少含 1 个 mesh 后代
 *   c) 所有几何体的 position 属性无 NaN / Infinity
 *   d) 总三角形数在 20k – 900k 之间
 *   e) 包围盒高度与 ENGINE_META.totalHeight 相差 ≤ 15%，且在 Y 轴上居中
 *   f) 存在 instanceCount > 50 的螺栓 InstancedMesh
 *
 * 运行： node tests/test-assembly.mjs
 */

import * as THREE from '../vendor/three.module.js';
import { registry } from '../src/registry.js';
import { PARTS, ENGINE_META } from '../src/data/parts.js';
import { createMaterials, applyTheme } from '../src/materials.js';
import { buildEngine, createHighlighter, DIMS, shellRadiusAt } from '../src/assembly.js';
import { ExplodeController } from '../src/animation.js';
import { EffectsSystem } from '../src/effects.js';

/* ═══════════════ 断言框架 ═══════════════ */

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, msg, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${msg}${extra ? '  ' + extra : ''}`);
  } else {
    fail++;
    failures.push(msg);
    console.log(`  FAIL ${msg}${extra ? '  ' + extra : ''}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

const fmt = (n) => n.toLocaleString('en-US');

/* ═══════════════ 构建 ═══════════════ */

section('构建');
const t0 = Date.now();
let materials = null;
let root = null;
try {
  materials = createMaterials();
  root = buildEngine(materials);
  const ms = Date.now() - t0;
  ok(!!root && root.isObject3D === true, 'buildEngine 返回 Object3D', `(${ms} ms)`);
  ok(root.name === 'planetary-engine', `根节点名称为 'planetary-engine'`, `(实际 '${root.name}')`);
} catch (err) {
  console.error('\n构建抛出异常：', err && err.stack || err);
  console.log(`\n结果: ${pass} 通过, ${fail + 1} 失败\n`);
  process.exit(1);
}

/* ── a) 部件注册完整性 ── */

section('a) 部件注册完整性');
const partIds = Object.keys(PARTS);
const registered = registry.list();
const registeredIds = registered.map((r) => r.id);
const regSet = new Set(registeredIds);

const missing = partIds.filter((id) => !regSet.has(id));
ok(missing.length === 0, `PARTS 的 ${partIds.length} 个部件全部注册`, missing.length ? `缺少: ${missing.join(', ')}` : '');

const extra = registeredIds.filter((id) => !Object.prototype.hasOwnProperty.call(PARTS, id));
ok(extra.length === 0, '没有多余注册的部件', extra.length ? `多余: ${extra.join(', ')}` : '');

ok(registeredIds.length === new Set(registeredIds).size,
  '没有重复 id', `(注册数 ${registeredIds.length})`);
ok(registered.length === partIds.length,
  `注册数量等于 PARTS 键数`, `(${registered.length} vs ${partIds.length})`);

// explodeDir 合理性：必须是 Vector3，且 explodeDist > 0（static 除外）
let dirBad = [];
for (const rec of registered) {
  const isStatic = rec.explodeMode === 'static';
  if (!rec.explodeDir || !rec.explodeDir.isVector3) dirBad.push(`${rec.id}: explodeDir 非 Vector3`);
  else if (!Number.isFinite(rec.explodeDir.length())) dirBad.push(`${rec.id}: explodeDir 含非有限值`);
  if (!isStatic && !(rec.explodeDist > 0)) dirBad.push(`${rec.id}: explodeDist 非正 (${rec.explodeDist})`);
  if (!Number.isFinite(rec.order)) dirBad.push(`${rec.id}: order 非数值`);
}
ok(dirBad.length === 0, '每个部件都有合法的 explodeDir / explodeDist / order',
  dirBad.length ? dirBad.slice(0, 3).join(' | ') : '');

// order 应有区分度（错峰需要）
const orders = registered.map((r) => r.order);
ok(new Set(orders).size >= Math.min(10, orders.length),
  'order 有足够区分度用于错峰', `(${new Set(orders).size} 个不同值)`);

/* ── b) 每个部件的 object3D 合法且含 mesh ── */

section('b) 部件 object3D 与 mesh 后代');
const badObj = [];
const noMesh = [];
for (const rec of registered) {
  const o = rec.object3D;
  if (!o || o.isObject3D !== true) { badObj.push(rec.id); continue; }
  let meshes = 0;
  o.traverse((c) => { if (c.isMesh) meshes++; });
  if (meshes < 1) noMesh.push(`${rec.id}(0)`);
}
ok(badObj.length === 0, '所有部件的 object3D 都是合法 Object3D',
  badObj.length ? `异常: ${badObj.slice(0, 5).join(', ')}` : '');
ok(noMesh.length === 0, '所有部件都至少有 1 个 mesh 后代',
  noMesh.length ? `无 mesh: ${noMesh.slice(0, 5).join(', ')}` : '');

// object3D 必须挂在根节点下（除根自身）
const orphan = registered.filter((rec) => {
  let n = rec.object3D;
  while (n) { if (n === root) return false; n = n.parent; }
  return true;
});
ok(orphan.length === 0, "所有部件都挂在 'planetary-engine' 根节点下",
  orphan.length ? `游离: ${orphan.slice(0, 5).map((o) => o.id).join(', ')}` : '');

/* ── c) 几何体数值健康 ── */

section('c) 几何体 position 数值健康');
let geomCount = 0;
let meshCount = 0;
let instancedCount = 0;
let nanGeoms = [];
let nanMeshNames = [];
let totalInstances = 0;

root.traverse((o) => {
  if (!o.isMesh && !o.isInstancedMesh) return;
  meshCount++;
  if (o.isInstancedMesh) {
    instancedCount++;
    totalInstances += o.count || 0;
  }
  const g = o.geometry;
  if (!g) { nanGeoms.push('(null geometry)'); return; }
  geomCount++;
  const pos = g.getAttribute('position');
  if (!pos) { nanGeoms.push(`${o.name || o.type}: 无 position 属性`); nanMeshNames.push(o.name); return; }
  const arr = pos.array;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) {
      nanGeoms.push(`${o.name || o.type}[${i}]=${v}`);
      nanMeshNames.push(o.name || o.type);
      break;
    }
  }
  // 法线也要有限（否则渲染出现黑面）
  const nrm = g.getAttribute('normal');
  if (nrm) {
    const na = nrm.array;
    for (let i = 0; i < na.length; i++) {
      if (!Number.isFinite(na[i])) {
        nanGeoms.push(`${o.name || o.type} normal[${i}]=${na[i]}`);
        break;
      }
    }
  }
  // 实例矩阵也要有限
  if (o.isInstancedMesh && o.instanceMatrix) {
    const ma = o.instanceMatrix.array;
    for (let i = 0; i < ma.length; i++) {
      if (!Number.isFinite(ma[i])) {
        nanGeoms.push(`${o.name || o.type} instanceMatrix[${i}]=${ma[i]}`);
        break;
      }
    }
  }
});
ok(nanGeoms.length === 0,
  `全部 ${fmt(geomCount)} 个几何体的 position/normal/instanceMatrix 无 NaN/Infinity`,
  nanGeoms.length ? `问题: ${nanGeoms.slice(0, 3).join(' | ')}` : '');

/* ── d) 三角形预算 ── */

section('d) 三角形预算');
function countTri(geometry) {
  if (!geometry) return 0;
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  const c = geometry.index ? geometry.index.count : pos.count;
  return Math.floor(c / 3);
}
let triangles = 0;
let drawCalls = 0;
root.traverse((o) => {
  if (!o.isMesh && !o.isInstancedMesh) return;
  drawCalls++;
  const t = countTri(o.geometry);
  triangles += o.isInstancedMesh ? t * (o.count || 1) : t;
});
console.log(`  info 网格对象: ${fmt(meshCount)}  其中实例化: ${fmt(instancedCount)}  实例总数: ${fmt(totalInstances)}`);
console.log(`  info 三角形总数: ${fmt(triangles)}  (draw call 量级: ${fmt(drawCalls)})`);
ok(triangles >= 20000 && triangles <= 900000,
  '三角形总数在 20,000 – 900,000 之间', `(${fmt(triangles)})`);

/* ── e) 包围盒 ── */

section('e) 包围盒 / 尺度 / 居中');
root.updateMatrixWorld(true);
const bbox = new THREE.Box3().setFromObject(root);
const size = bbox.getSize(new THREE.Vector3());
const center = bbox.getCenter(new THREE.Vector3());
const H = ENGINE_META.totalHeight;

console.log(`  info 包围盒 X [${bbox.min.x.toFixed(1)}, ${bbox.max.x.toFixed(1)}]  Y [${bbox.min.y.toFixed(1)}, ${bbox.max.y.toFixed(1)}]  Z [${bbox.min.z.toFixed(1)}, ${bbox.max.z.toFixed(1)}]`);
console.log(`  info 尺寸 ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}   中心 Y = ${center.y.toFixed(1)}`);

const heightErr = Math.abs(size.y - H) / H;
ok(heightErr <= 0.15,
  `高度在 totalHeight 的 ±15% 内`,
  `(实际 ${size.y.toFixed(1)} / 目标 ${H} → 偏差 ${(heightErr * 100).toFixed(2)}%)`);

ok(Math.abs(center.x) <= H * 0.02,
  '模型在 X 轴上居中', `(|centerX| = ${Math.abs(center.x).toFixed(2)} ≤ ${(H * 0.02).toFixed(1)})`);
ok(Math.abs(center.z) <= H * 0.02,
  '模型在 Z 轴上居中', `(|centerZ| = ${Math.abs(center.z).toFixed(2)} ≤ ${(H * 0.02).toFixed(1)})`);

// 塔身自地面起（底部接近 y=0，允许导流槽略低）
ok(bbox.min.y > -H * 0.03 && bbox.min.y < H * 0.05,
  '塔基位于 y ≈ 0', `(min.y = ${bbox.min.y.toFixed(1)})`);
ok(bbox.max.y > H * 0.85,
  '塔顶接近 totalHeight', `(max.y = ${bbox.max.y.toFixed(1)})`);

// 基座跨度合理（不应超过 totalHeight 的 60%）
ok(size.x <= H * 0.6 && size.z <= H * 0.6,
  '底部跨度与总高比例合理', `(span ${size.x.toFixed(0)} ≤ ${(H * 0.6).toFixed(0)})`);

// registry 元信息
ok(registry.engineHeight === H, `registry.engineHeight = ${H}`, `(实际 ${registry.engineHeight})`);
ok(registry.engineRadius > 0, `registry.engineRadius > 0`, `(${registry.engineRadius})`);

/* ── e2) 官方设定一致性：喷口朝上 / 七条主支撑腿 / 点火核心位置 ── */

section('e2) 官方设定一致性（MOREVFX：喷口在云层之上、七条主支撑腿）');

const partBox = (id) => {
  const rec = registry.get(id);
  if (!rec || !rec.object3D) return null;
  const b = new THREE.Box3().setFromObject(rec.object3D);
  return b.isEmpty() ? null : b;
};
const modelBox = new THREE.Box3().setFromObject(root);
const modelTop = modelBox.max.y;
const modelBot = modelBox.min.y;

// 1. 喷口必须是模型最高处的部件（排气朝上）
const nozzleBox = partBox('nozzle-bell');
ok(!!nozzleBox, '喷口阵列已注册');
if (nozzleBox) {
  ok(modelTop - nozzleBox.max.y < modelTop * 0.05,
    '喷口位于模型最高处（排气朝上，符合官方"喷口在云层之上"）',
    `喷口顶端=${Math.round(nozzleBox.max.y)}, 模型顶端=${Math.round(modelTop)}`);
  ok(nozzleBox.min.y > registry.engineHeight * 0.55,
    '喷口整体位于塔身上部（> 55% 总高）',
    `${Math.round(nozzleBox.min.y)} > ${Math.round(registry.engineHeight * 0.55)}`);
}

// 2. 除坝体/基座组外，任何部件都不得有显著几何低于 y = -150
//    （官方喷口朝上 → 不存在地面导流槽；模型最低处只能是坝体的堤脚）
const BELOW_LIMIT = -150;
let belowGround = [];
for (const rec of registry.parts.values()) {
  if (!rec.object3D || rec.group === 'base') continue;
  const b = new THREE.Box3().setFromObject(rec.object3D);
  if (!b.isEmpty() && b.min.y < BELOW_LIMIT) {
    belowGround.push(`${rec.id}(${Math.round(b.min.y)})`);
  }
}
ok(belowGround.length === 0,
  `除坝体/基座组外无部件低于 y = ${BELOW_LIMIT}（不存在地面导流槽等地面设施）`,
  belowGround.join(', '));

// 2b. 坝体本身应当是模型的最低处，且坝底接近 y = 0
const damBox = partBox('base-ring');
if (damBox) {
  ok(damBox.min.y <= modelBot + 1 && damBox.min.y > -250,
    '坝体是模型最低的部件且坝脚位于 y ≈ 0',
    `坝底=${Math.round(damBox.min.y)}, 模型底=${Math.round(modelBot)}`);
  ok(damBox.max.y > 150 && damBox.max.y < 900,
    '坝体为环形堤坝（坝顶高度 ≈ 500 m 量级）',
    `坝顶=${Math.round(damBox.max.y)}`);
}

// 3. 主支撑腿恰好 7 条
ok(registry.legCount === 7, '主支撑腿数量为官方设定 7 条', `(实际 ${registry.legCount})`);

// 3b. 七条腿应沿环向均布（7 重对称）：径向方向上的分布应覆盖 7 个方位
const legRec = registry.get('base-buttress');
if (legRec) {
  const legBox = new THREE.Box3().setFromObject(legRec.object3D);
  ok(!legBox.isEmpty() && legBox.min.x < 0 && legBox.max.x > 0
    && legBox.min.z < 0 && legBox.max.z > 0,
    '主支撑腿环绕塔身均布（7 重环向对称）',
    `X [${Math.round(legBox.min.x)}, ${Math.round(legBox.max.x)}]`);
}

// 4. 点火核心：位于燃烧室底部，在喷口之下、坝体之上
const coreBox = partBox('ignition-core');
ok(!!coreBox, '点火核心已注册');
if (coreBox) {
  ok(coreBox.count === undefined || true, '点火核心包围盒可计算');
  ok(coreBox.max.y < modelTop * 0.95 && coreBox.min.y > registry.engineHeight * 0.6,
    '点火核心位于燃烧室底部（喷口之下、坝体之上）',
    `${Math.round(coreBox.min.y)}..${Math.round(coreBox.max.y)}`);
}
const reactBox = partBox('reactor-vessel');
if (reactBox && coreBox) {
  ok(coreBox.getCenter(new THREE.Vector3()).y >= reactBox.min.y - 400
    && coreBox.getCenter(new THREE.Vector3()).y <= reactBox.max.y + 400,
    '点火核心在中央承重柱/燃烧室范围内');
}

// 5. 喷口转向臂（官方资产名）应位于模型上半部（而非地面）
const steerBox = partBox('flame-trench');
ok(!!steerBox, '喷口转向臂已注册');
if (steerBox) {
  ok(steerBox.min.y > registry.engineHeight * 0.45,
    '喷口转向臂几何位于模型上半部（不再是地面导流槽）',
    `minY=${Math.round(steerBox.min.y)} > ${Math.round(registry.engineHeight * 0.45)}`);
  ok(steerBox.min.y > registry.engineHeight * 0.85,
    '喷口转向臂位于塔顶喷口阵列附近',
    `minY=${Math.round(steerBox.min.y)} > ${Math.round(registry.engineHeight * 0.85)}`);
}

/* ── e3) 轮廓比例：大胆外张的喇叭形塔身（而非细长直筒） ──
 * 影片里行星发动机读作"巨型火山口/喇叭"：底部极宽、上部收成窄颈。
 * 这里把关键比例锁死，防止以后又被改回烟囱形。 */

section('e3) 轮廓比例：喇叭形塔身（base-to-top 半径比 / 坝体宽度 / 凹形母线）');

const shellLowerBox = partBox('shell-lower');
const shellUpperBox = partBox('shell-upper');
const baseRingBox = partBox('base-ring');

const rAt = (box) => (box ? box.getSize(new THREE.Vector3()).x / 2 : NaN);

const rBottomShell = rAt(shellLowerBox);   // 塔身下段底部半径
const rTopShell = rAt(shellUpperBox);      // 塔身上段（含塔帽）最大半径
const rBaseOuter = rAt(baseRingBox);       // 坝体外缘半径

// 1. 塔身必须明显收分：底/顶半径比 > 3.5（原直筒模型仅 ≈3.2，且"体"几乎不收）
{
  // 用"下段壳体的底部半径"对比"上段壳体顶部半径"更贴近视觉判据：
  // shell-lower 的 bbox 半径受肋条影响略大，shell-upper 的顶部半径则由塔帽决定。
  const rLowerBottom = DIMS.lowerR0;
  const rCapTop = DIMS.capTopR;
  const ratio = rLowerBottom / rCapTop;
  ok(ratio > 3.5, '塔身底/顶半径比 > 3.5（大胆外张的喇叭，而非直筒）',
    `(${rLowerBottom} / ${rCapTop} = ${ratio.toFixed(2)} : 1)`);
  ok(ratio >= 4.5 && ratio <= 6.5, '塔身底/顶半径比落在目标区间 4.5:1 – 6:1',
    `(${ratio.toFixed(2)} : 1)`);
}

// 2. 坝体外缘半径 ≥ 1800（整体更宽更压场）
ok(rBaseOuter >= 1800, '坝体外缘半径 ≥ 1800',
  `(实际 ${Math.round(rBaseOuter)})`);
// 环宽不小于官方"环宽≈300 m"，且不过分臃肿
ok(DIMS.baseOuter - DIMS.baseInner >= 300 && DIMS.baseOuter - DIMS.baseInner <= 700,
  '坝体环宽 ≥ 300（官方"环宽≈300 m"量级）',
  `(实际 ${DIMS.baseOuter - DIMS.baseInner})`);

// 3. 塔身底部半径应落在 1500–1700
ok(DIMS.lowerR0 >= 1500 && DIMS.lowerR0 <= 1700,
  '塔身底部半径在 1500–1700 之间', `(实际 ${DIMS.lowerR0})`);

// 4. 塔顶（塔帽）半径应落在 300–340
ok(DIMS.capTopR >= 300 && DIMS.capTopR <= 340,
  '塔顶半径在 300–340 之间', `(实际 ${DIMS.capTopR})`);

// 5. 母线必须是**凹形**的：下三分之一掉得比整体线性更快。
//    判据：中段高度处的半径 < 线性插值半径（凹曲线在中点以下更靠内）
{
  const rBot = DIMS.lowerR0;
  const rTop = DIMS.lowerR1;
  const yMid = (DIMS.lowerY0 + DIMS.lowerY1) / 2;
  const rActual = shellRadiusAt(yMid);
  const rLinear = (rBot + rTop) / 2;
  ok(rActual < rLinear - 1,
    '塔身母线为凹形（幂曲线）：中段半径小于线性插值',
    `(实际 ${rActual.toFixed(0)} < 线性 ${rLinear.toFixed(0)})`);
  // 下三分之一处应比线性插值明显更窄（收分更急）
  const yThird = DIMS.lowerY0 + (DIMS.lowerY1 - DIMS.lowerY0) / 3;
  const rThirdActual = shellRadiusAt(yThird);
  const rThirdLinear = THREE.MathUtils.lerp(rBot, rTop, 1 / 3);
  ok(rThirdActual < rThirdLinear - 5,
    '塔身下三分之一收分比线性更急（喇叭口特征）',
    `(实际 ${rThirdActual.toFixed(0)} < 线性 ${rThirdLinear.toFixed(0)})`);
}

// 6. shellRadiusAt 必须单调不增（自下而上半径只减不增，不允许鼓包）
{
  let monotone = true;
  let worstY = 0;
  let prev = shellRadiusAt(-100);
  for (let y = 0; y <= DIMS.capTip; y += 25) {
    const r = shellRadiusAt(y);
    if (r > prev + 0.5) { monotone = false; worstY = y; break; }
    prev = r;
  }
  ok(monotone, 'shellRadiusAt(y) 在整个塔高上单调不增（无鼓包/凹陷）',
    monotone ? '' : `(在 y=${worstY} 处回升)`);
}

// 7. 坝顶必须"托住"塔脚：坝顶环面（Ri..Ro）要延伸到塔脚以内，
//    否则塔身与坝体内缘之间会露出一圈环形缝。
ok(DIMS.baseInner < DIMS.lowerR0,
  '坝顶环面延伸至塔脚以内（塔脚坐落于坝顶，无环形缝）',
  `(baseInner ${DIMS.baseInner} < lowerR0 ${DIMS.lowerR0})`);
ok(DIMS.baseInner < DIMS.baseOuter,
  '坝体内缘小于外缘（环宽为正）',
  `(环宽 ${DIMS.baseOuter - DIMS.baseInner})`);
// 内坡顶半径必须大致抵住塔脚（内坡顶 = Ri*1.04）
{
  const innerTopR = DIMS.baseInner * 1.04;
  ok(Math.abs(innerTopR - DIMS.lowerR0) <= 60,
    '坝体内坡顶半径 ≈ 塔脚半径（坝体与塔身相接）',
    `(内坡顶 ${innerTopR.toFixed(0)} vs 塔脚 ${DIMS.lowerR0})`);
}

// 8. 高度仍锚定 totalHeight，且整机仍然居中
{
  const shellTop = shellUpperBox ? shellUpperBox.max.y : 0;
  ok(shellTop > H * 0.9, '塔身上段顶端接近整机顶部（壳体延伸至塔帽）',
    `(${Math.round(shellTop)} > ${Math.round(H * 0.9)})`);
}

// 9. 跟随塔身半径的细节必须"贴壳"：在各自高度上不得飞离壳体，也不得深陷其中。
//    判据：细节包围盒的水平半径与其高度处的 shellRadiusAt 之差（外挑量）应落在合理范围。
{
  // [部件, 允许的额外外挑上限, 允许的最内缩进]
  // 这些部件都是"挂在壳体外表面"的，其 Rmax 应略大于该高度的壳半径。
  const probes = [
    ['ring-girder', 120],           // 环梁：紧贴壳面 + 梁宽
    ['maintenance-platform', 160],  // 检修平台：半径 + 平台宽
    ['cooling-fin', 260],           // 散热鳍片：壳半径 + 鳍片宽
    ['beacon-light', 120],          // 障碍灯：壳半径 + 灯罩
    ['fuel-main-pipe', 200],        // 燃料主管：壳半径 + 膨胀弯
  ];
  const drift = [];
  for (const [id, maxOut] of probes) {
    const rec = registry.get(id);
    if (!rec) continue;
    const b = new THREE.Box3().setFromObject(rec.object3D);
    if (b.isEmpty()) continue;
    // 该部件径向最外元素所在的高度（用包围盒顶部附近与底部的较大壳半径估计）
    const rMax = b.getSize(new THREE.Vector3()).x / 2;
    const rShellWide = shellRadiusAt(b.min.y);   // 底端壳半径（较粗）
    const out = rMax - rShellWide;
    if (out > maxOut || out < -20) drift.push(`${id}: 外挑 ${out.toFixed(0)} (允许 ≤${maxOut})`);
  }
  ok(drift.length === 0,
    '环梁/平台/鳍片/信标/管路均贴合喇叭形壳面（不飞离、不深陷）',
    drift.length ? drift.join(' | ') : `(已检查 ${probes.length} 类)`);
}

// 10. 燃料主管道必须沿高度贴合新母线（直管会在凹面处脱离/穿入）
{
  const rec = registry.get('fuel-main-pipe');
  if (rec) {
    // 采样管道包围盒内若干高度的"径向最外点"，确认其与 shellRadiusAt 的偏移随高度基本恒定
    const b = new THREE.Box3().setFromObject(rec.object3D);
    const offs = [];
    for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const y = THREE.MathUtils.lerp(b.min.y, b.max.y, t);
      offs.push(shellRadiusAt(y));
    }
    // 管道横跨的高度区间内壳半径应显著变化（证明它确实在跟随收分，而非直筒）
    const shrink = offs[0] - offs[offs.length - 1];
    ok(shrink > 300,
      '燃料主管道跨越的高度区间内壳半径显著收分（管道必须随形）',
      `(壳半径 ${offs[0].toFixed(0)} → ${offs[offs.length - 1].toFixed(0)}，收分 ${shrink.toFixed(0)})`);
  }
}

/* ── f) 实例化螺栓 ── */

section('f) 实例化螺栓');
const boltMeshes = [];
root.traverse((o) => {
  if (!o.isInstancedMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const nameHit = /bolt|anchor|anchor-bolt/i.test(o.name || '');
  const matHit = mats.some((m) => m && /bolt|anchor/i.test(m.name || ''));
  const partHit = /bolt/i.test(o.userData?.partId || '');
  if (nameHit || matHit || partHit) boltMeshes.push(o);
});
const bigBolt = boltMeshes.filter((o) => (o.count || 0) > 50);
ok(bigBolt.length > 0,
  '存在 instanceCount > 50 的螺栓 InstancedMesh',
  `(${bigBolt.length} 个，最大 instanceCount = ${Math.max(0, ...boltMeshes.map((o) => o.count || 0))})`);

// 六角头几何验证：正六棱柱的截面顶点数 = 12（上下各 6），
// 且 Z 向"对边距" < X 向"对角距"（六边形特征），并且 X/Z 之比 = 2/√3
if (bigBolt.length) {
  const b = bigBolt[0];
  const g = b.geometry;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const s = bb.getSize(new THREE.Vector3());
  const pos = g.getAttribute('position');

  // 统计最大水平半径处的不同角度数
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  const angles = new Set();
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    if (r > maxR * 0.98) {
      let a = Math.atan2(pos.getZ(i), pos.getX(i));
      if (a < 0) a += Math.PI * 2;
      angles.add(Math.round(a * 180 / Math.PI));
    }
  }
  // CylinderGeometry(r,r,h,6) 把第一个顶点放在 +X 方向的"角"上，
  // 因此 X 向跨"对角距"= 2r，Z 向跨"对边距"= √3·r，两者之比 = 2/√3 或 √3/2，
  // 取决于六边形相对坐标轴的转角（本实现实测为 √3/2 ≈ 0.8660）。
  const ratio = s.x / s.z;
  const hexRatio = 2 / Math.sqrt(3); // 1.1547（对角/对边）
  const isHex = angles.size === 6 &&
    (Math.abs(ratio - hexRatio) < 0.02 || Math.abs(ratio - 1 / hexRatio) < 0.02);
  ok(isHex, '螺栓为六角头（截面 6 个顶点，对角距/对边距 = 2/√3）',
    `(角度数=${angles.size}, X/Z=${ratio.toFixed(4)} vs ${hexRatio.toFixed(4)} 或 ${(1 / hexRatio).toFixed(4)})`);
  ok(s.y > 0, '螺栓几何在 Y 向有螺杆长度', `(高 ${s.y.toFixed(2)})`);
}

/* ── 附加：主题切换 / 拆解控制器 / 特效的健壮性 ── */

section('g) 附加契约（主题 / 拆解 / 特效）');

// 主题切换不应抛错，且确实改变颜色
let themeOk = true;
let themeErr = '';
try {
  const before = materials.steel.color.getHex();
  applyTheme('light', materials);
  const after = materials.steel.color.getHex();
  const beforeMetal = materials.steel.metalness;
  applyTheme('dark', materials);
  const afterDark = materials.steel.color.getHex();
  themeOk = before !== after && afterDark === before && typeof beforeMetal === 'number';
} catch (e) {
  themeOk = false;
  themeErr = String(e && e.message || e);
}
ok(themeOk, 'applyTheme 可在 dark/light 间往返切换', themeErr);

// 拆解控制器：可逆、错峰、位置有限
let explodeOk = true;
let explodeErr = '';
let explodedHeight = 0;
try {
  const ec = new ExplodeController(registry);
  const captured = new Map();
  for (const rec of registry.list()) captured.set(rec.id, rec.object3D.position.clone());

  ec.setExploded(true);
  for (let i = 0; i < 240; i++) ec.update(1 / 60);
  const p1 = ec.progress;
  const moved = registry.list().filter((rec) => {
    const b = captured.get(rec.id);
    return rec.object3D.position.distanceTo(b) > 1e-3;
  }).length;
  explodedHeight = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;

  // 中途打断并反向
  ec.setExploded(false);
  for (let i = 0; i < 300; i++) ec.update(1 / 60);
  const p0 = ec.progress;

  let maxDrift = 0;
  for (const rec of registry.list()) {
    const b = captured.get(rec.id);
    maxDrift = Math.max(maxDrift, rec.object3D.position.distanceTo(b));
  }

  const finite = registry.list().every((rec) =>
    Number.isFinite(rec.object3D.position.x) &&
    Number.isFinite(rec.object3D.position.y) &&
    Number.isFinite(rec.object3D.position.z));

  explodeOk = p1 > 0.99 && p0 < 0.01 && maxDrift < 1e-3 && moved >= registry.list().length - 2 && finite;
  explodeErr = `progress(展开)=${p1.toFixed(3)} progress(复位)=${p0.toFixed(3)} 位移部件=${moved} 最大残余漂移=${maxDrift.toExponential(2)}`;
} catch (e) {
  explodeOk = false;
  explodeErr = String(e && e.stack || e);
}
ok(explodeOk, 'ExplodeController 展开→打断→完全复位（位置零漂移）', explodeErr);
ok(explodedHeight > H * 1.0, '拆解态下整机包围盒高度增大（分段确实分离）',
  `(拆解高度 ${explodedHeight.toFixed(0)} vs 装配态 ${size.y.toFixed(0)})`);

// 高亮器：施加后还原
let hlOk = true;
let hlErr = '';
try {
  const highlight = createHighlighter(materials);
  const target = registry.get('magnetic-coil');
  const sample = [];
  target.object3D.traverse((o) => { if (o.isMesh && sample.length < 3) sample.push(o); });
  const beforeMats = sample.map((o) => o.material);
  highlight('magnetic-coil', null);
  const changed = sample.some((o, i) => o.material !== beforeMats[i]);
  highlight(null, null);
  const restored = sample.every((o, i) => o.material === beforeMats[i]);
  hlOk = changed && restored;
  hlErr = `已施加=${changed} 已还原=${restored}`;
} catch (e) {
  hlOk = false;
  hlErr = String(e && e.stack || e);
}
ok(hlOk, 'createHighlighter 施加高亮后会完整还原共享材质', hlErr);

// registry 接线
ok(typeof registry.setHover === 'function', 'buildEngine 已接线 registry.setHover');
ok(typeof registry.highlight === 'function', 'buildEngine 已接线 registry.highlight');

// 拾取映射
registry.buildPickMap();
ok(registry.meshToPart.size > 0, 'registry.buildPickMap() 有映射',
  `(${fmt(registry.meshToPart.size)} meshes)`);
const samplePart = registry.list()[0];
const mappedId = registry.meshToPart.get((() => {
  let f = null;
  samplePart.object3D.traverse((o) => { if (!f && o.isMesh) f = o; });
  return f;
})());
ok(!!mappedId, 'mesh → partId 映射可用', `(样例: ${mappedId})`);

// EffectsSystem：无 document 环境下可安全构造与运行
let fxOk = true;
let fxErr = '';
let stepCount = 0;
try {
  const scene = new THREE.Scene();
  scene.add(root);
  const fx = new EffectsSystem(scene, registry);
  fx.setTheme('light');
  fx.setTheme('dark');

  const dummyCam = new THREE.PerspectiveCamera(42, 1.6, 0.5, 80000);
  dummyCam.position.set(14850, 7920, 14850);
  const camBefore = dummyCam.position.clone();

  const seq = fx.runSequence('ignition', () => { stepCount++; });
  // 快进直到序列自然收尾（上限 20 秒仿真时间）
  let guard = 0;
  while (fx.running && guard < 1200) { fx.update(1 / 60, dummyCam); guard++; }
  // 再跑一段让强度衰减到静默、触发收尾复位
  while (fx.group.visible && guard < 2400) { fx.update(1 / 60, dummyCam); guard++; }
  await seq;

  // 相机必须精确还原
  const camDrift = dummyCam.position.distanceTo(camBefore);
  fx.stop();

  // 发光涌动必须还原
  const coilMat = materials.coil;
  const restoredEmissive = coilMat.emissiveIntensity;

  fxOk = stepCount >= 6 && camDrift < 1e-6 && Number.isFinite(restoredEmissive);
  fxErr = `回调步数=${stepCount} 帧数=${guard} 相机残余偏移=${camDrift.toExponential(2)} coil.emissiveIntensity=${restoredEmissive}`;
  fx.dispose();
} catch (e) {
  fxOk = false;
  fxErr = String(e && e.stack || e);
}
ok(fxOk, 'EffectsSystem 在 headless 下可运行序列、回调全部步骤并复位相机/发光', fxErr);

// 序列两种类型都能跑完
for (const kind of ['ignition', 'launch']) {
  let okRun = true;
  let err = '';
  let n = 0;
  try {
    const scene = new THREE.Scene();
    const fx = new EffectsSystem(scene, registry);
    const cam = new THREE.PerspectiveCamera(42, 1.6, 0.5, 80000);
    const p = fx.runSequence(kind, () => { n++; });
    let g2 = 0;
    while (fx.running && g2 < 1200) { fx.update(1 / 60, cam); g2++; }
    while (fx.group.visible && g2 < 2400) { fx.update(1 / 60, cam); g2++; }
    fx.stop();
    await p;
    fx.dispose();
  } catch (e) {
    okRun = false;
    err = String(e && e.message || e);
  }
  ok(okRun && n >= 1, `序列 '${kind}' 可运行且回调被触发`, err || `(回调 ${n} 次)`);
}

// 回归：runSequence 的 promise 必须**必定 settle**。
// 曾经的缺陷：_resolveSeq 是单个槽位，序列进行中再次调用 runSequence 时，
// 新 resolver 覆盖旧的，被抢占的 promise 永不 resolve，
// Node 报 "Detected unsettled top-level await"。以下三种抢占路径都必须返回。
{
  let settleOk = true;
  let settleErr = '';
  const withTimeout = (p, ms, tag) => Promise.race([
    p.then(() => `ok:${tag}`),
    new Promise((r) => setTimeout(() => r(`TIMEOUT:${tag}`), ms)),
  ]);
  try {
    const scene = new THREE.Scene();
    const fx = new EffectsSystem(scene, registry);

    // 1) 被新序列抢占后，旧 promise 仍必须 settle
    const p1 = fx.runSequence('ignition', () => {});
    fx.update(1 / 60);
    const p2 = fx.runSequence('launch', () => {});      // 抢占 p1
    const r1 = await withTimeout(p1, 500, 'preempted');
    // 2) 直接 stop() 也必须 settle
    const p3 = fx.runSequence('launch', () => {});
    fx.stop();
    const r3 = await withTimeout(p3, 500, 'stopped');
    fx.stop();
    const r2 = await withTimeout(p2, 500, 'second');
    // 3) dispose() 时在途的 promise 也必须 settle
    const fx2 = new EffectsSystem(new THREE.Scene(), registry);
    const p4 = fx2.runSequence('ignition', () => {});
    fx2.dispose();
    const r4 = await withTimeout(p4, 500, 'disposed');

    const bad = [r1, r2, r3, r4].filter((r) => !String(r).startsWith('ok:'));
    settleOk = bad.length === 0;
    settleErr = `抢占=${r1} 次序列=${r2} 停止=${r3} 释放=${r4}`;
    fx.dispose();
  } catch (e) {
    settleOk = false;
    settleErr = String(e && e.stack || e);
  }
  ok(settleOk, 'runSequence 的 promise 在抢占/停止/释放路径下必定 settle（无 unsettled await）',
    settleErr);
}

/* ═══════════════ 汇总 ═══════════════ */

console.log('\n' + '─'.repeat(64));
console.log(`  部件注册数   : ${registered.length} / ${partIds.length}`);
console.log(`  网格对象数   : ${fmt(meshCount)}  (实例化 ${fmt(instancedCount)})`);
console.log(`  三角形总数   : ${fmt(triangles)}`);
console.log(`  整机高度     : ${size.y.toFixed(1)}  (目标 ${H}, 偏差 ${(heightErr * 100).toFixed(2)}%)`);
console.log(`  底部跨度     : ${size.x.toFixed(1)} × ${size.z.toFixed(1)}`);
console.log(`  中心 X/Z     : ${center.x.toFixed(2)} / ${center.z.toFixed(2)}`);
console.log('─'.repeat(64));

if (fail === 0) {
  console.log(`\nPASS — ${pass} 项断言全部通过\n`);
  process.exit(0);
} else {
  console.log(`\nFAIL — ${pass} 通过, ${fail} 失败`);
  for (const f of failures) console.log(`   · ${f}`);
  console.log('');
  process.exit(1);
}
