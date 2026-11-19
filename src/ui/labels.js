/**
 * ui/labels.js — 部件标注覆盖层
 *
 * HTML-overlay 方案：每帧用 vector.project(camera) 把部件世界坐标投影到屏幕，
 * 驱动一个绝对定位的 DOM 标签 + 一条 1px 引线（旋转的 div）。
 *
 * 性能约定：
 *   · 每个部件只创建一次 DOM 节点，之后只改 transform / opacity / className
 *   · 不做 layout 读取（不调用 getBoundingClientRect，屏幕尺寸由 window 提供）
 *   · 标签数量超过 MAX_FULL_LABELS 时，只显示 悬停 / 选中 / 最大的若干部件
 */

const MAX_FULL_LABELS = 16;   // 同屏最多完整标注数（超出则按体量取舍）
const PRIORITY_LABELS = 10;   // 超量时保留的“最大部件”数量
const MAX_DIST_FADE = 3.6;    // 距离淡出倍数（相对相机距离中位数）
const OFFSCREEN_PAD = 120;    // 屏幕外判定余量（像素）

const ANCHOR_OFFSET = 26;     // 标签相对锚点的水平偏移（像素）
const LEADER_MIN = 8;         // 引线短于该长度则隐藏

let app = null;
let layer = null;
let visible = true;
let inited = false;

/** @type {Map<string, {rec:any, root:HTMLElement, zh:HTMLElement, en:HTMLElement, leader:HTMLElement, size:number, w:number, h:number}>} */
const entries = new Map();

/* 复用向量，避免每帧分配 —— 世界坐标与投影必须各用一个，绝不能共用同一个实例 */
let _projVec = null;
let _box = null;
let _boxCtr = null;
let _boxSize = null;

/** 本帧各候选部件与相机的距离（排序/中位数用，避免每帧新建数组） */
const distScratch = [];

/* 上一帧的摆放记录，用于简单去重叠 */
const placed = [];

/* 每帧缓存 */
const camPos = { x: 0, y: 0, z: 0 };

/**
 * 取得 Vector3 / Box3 构造器。
 *
 * 关键：main.js 用 `import * as THREE` 引入 three，并不会挂到 window 上，
 * 所以 globalThis.THREE 通常不存在。这里改为从场景图里的活对象上"就地取材"：
 * 任意 Object3D 都有 .position（Vector3 实例）→ 取其 constructor；
 * Box3 则从 registry 缓存的或由 Vector3 组合的方式获得。
 */
let _V3 = null;
let _Box3 = null;

function acquireMath() {
  if (_V3 && _Box3) return true;

  const sample = app?.registry?.engineRoot
    || app?.scene
    || app?.camera;
  const v3 = sample?.position?.constructor
    || sample?.up?.constructor
    || globalThis.THREE?.Vector3;

  if (!_V3 && v3) _V3 = v3;

  // Box3：优先用场景里已存在的实例（registry 或 three 全局），否则懒构造
  if (!_Box3) {
    _Box3 = globalThis.THREE?.Box3
      || app?.registry?.Box3
      || null;
    if (!_Box3 && _V3) {
      // 从 Object3D 的 boundingBox 之类的既有实例上找
      const anyBox = app?.registry?.engineRoot?.geometry?.boundingBox;
      if (anyBox?.constructor) _Box3 = anyBox.constructor;
    }
  }

  return !!_V3;
}

function ensureVectors() {
  if (!acquireMath() || !_V3) return false;
  if (!_projVec) _projVec = new _V3();
  return true;
}

/** 兜底：THREE 未挂到 window 时，自己实现世界坐标 -> NDC 投影 */
function projectFallback(world, camera) {
  const v = { x: world.x, y: world.y, z: world.z };
  const e = camera.matrixWorldInverse?.elements;
  if (e) {
    const x = v.x, y = v.y, z = v.z;
    const ex = e[0] * x + e[4] * y + e[8] * z + e[12];
    const ey = e[1] * x + e[5] * y + e[9] * z + e[13];
    const ez = e[2] * x + e[6] * y + e[10] * z + e[14];
    v.x = ex; v.y = ey; v.z = ez;
  }
  const p = camera.projectionMatrix?.elements;
  if (p && camera.isPerspectiveCamera) {
    const x = v.x, y = v.y, z = v.z;
    const cx = p[0] * x + p[8] * z;
    const cy = p[5] * y + p[9] * z;
    const cw = -z;
    if (cw !== 0) { v.x = cx / cw; v.y = cy / cw; v.z = cw; }
  }
  return v;
}

/* ═══════════════ 初始化 ═══════════════ */

export function initLabels(appApi) {
  app = appApi || null;
  layer = document.getElementById('label-layer');

  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'label-layer';
    layer.className = 'label-layer';
    (document.getElementById('canvas-wrap') || document.body).appendChild(layer);
  }

  rebuild();
  inited = true;
}

/** 依据注册表重建标签节点（main.js 在 initLabels 之前已经完成装配） */
function rebuild() {
  if (!layer) return;

  for (const e of entries.values()) {
    e.root.remove();
    e.leader.remove();
  }
  entries.clear();

  const registry = app?.registry;
  if (!registry?.parts?.size) return;

  for (const rec of registry.parts.values()) {
    if (!rec?.object3D) continue;

    const root = document.createElement('div');
    root.className = 'lbl';
    root.dataset.partId = rec.id;
    root.dataset.labelPart = rec.id;   // 验证脚本 tests/verify.mjs 依赖该属性

    const zh = document.createElement('span');
    zh.className = 'lbl-zh';
    zh.textContent = rec.label || rec.id;

    const en = document.createElement('span');
    en.className = 'lbl-en';
    en.textContent = rec.labelEn || '';

    root.appendChild(zh);
    root.appendChild(en);

    // 关键参数（需求：标注各部件"名称和参数"）——
    // 取 specs 中信息量最大的一项：优先含"数量/内径/高度/直径/温度"等尺寸量纲者。
    const specs = rec.detail?.specs || [];
    let pick = null;
    for (const s of specs) {
      if (/数量|道数|台|组|层数|枚/.test(s.k)) { pick = s; break; }
    }
    if (!pick) {
      for (const s of specs) {
        if (/径|高度|长度|跨度|厚度|坝高|行程|提升高度/.test(s.k)) { pick = s; break; }
      }
    }
    if (!pick && specs.length) pick = specs[0];
    if (pick) {
      const sp = document.createElement('span');
      sp.className = 'lbl-spec';
      sp.textContent = `${pick.k} ${pick.v}`;
      root.appendChild(sp);
    }

    const leader = document.createElement('div');
    leader.className = 'lbl-leader';

    // 预置到屏幕外，避免首帧闪现
    root.style.transform = 'translate3d(-9999px,-9999px,0)';
    root.style.opacity = '0';
    leader.style.transform = 'translate3d(-9999px,-9999px,0)';
    leader.style.opacity = '0';

    layer.appendChild(leader);
    layer.appendChild(root);


    entries.set(rec.id, {
      rec, root, zh, en, leader, size: 0, w: 0, h: 0, anchor: null, anchorFrame: 0,
    });
  }
}

/**
 * 计算标签锚点（世界坐标）。
 *
 * 为什么不能直接用 getWorldPosition()：
 *   本工程的部件 object3D 多是 Group，几何体挂在子节点上、Group 自身停在原点，
 *   所以 getWorldPosition() 会得到 (0,0,0)，32 个标签会全部叠在同一处。
 *
 * 这里遍历子树、用每个 mesh 的包围盒角点乘以其 matrixWorld，算出真实的世界空间
 * 包围盒中心。只依赖 Vector3（从场景对象上取得），不需要 Box3。
 *
 * 顺便缓存部件尺寸，供"标签超量时优先显示大部件"排序使用。
 */
function computeAnchor(e, force) {
  const obj = e.rec.object3D;
  if (!obj) return null;

  if (e.anchor && !force) return e.anchor;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let found = false;

  const visit = (node) => {
    if (!node || node.visible === false) return;
    const geo = node.geometry;
    const m = node.matrixWorld?.elements;
    if (geo && m) {
      if (!geo.boundingBox && typeof geo.computeBoundingBox === 'function') {
        try { geo.computeBoundingBox(); } catch { /* 忽略 */ }
      }
      const bb = geo.boundingBox;
      if (bb) {
        const xs = [bb.min.x, bb.max.x];
        const ys = [bb.min.y, bb.max.y];
        const zs = [bb.min.z, bb.max.z];
        // 8 个角点变换到世界空间
        for (let i = 0; i < 8; i++) {
          const x = xs[i & 1], y = ys[(i >> 1) & 1], z = zs[(i >> 2) & 1];
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
          if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
          if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
          found = true;
        }
      }
    }
    const kids = node.children;
    if (kids) for (let i = 0; i < kids.length; i++) visit(kids[i]);
  };

  visit(obj);

  const ctr = e._ctr || (e._ctr = _V3 ? new _V3() : { x: 0, y: 0, z: 0 });

  if (found) {
    ctr.set ? ctr.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
            : (ctr.x = (minX + maxX) / 2, ctr.y = (minY + maxY) / 2, ctr.z = (minZ + maxZ) / 2);
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    e.size = Math.sqrt(dx * dx + dy * dy + dz * dz);
  } else {
    // 真的没有任何几何体：退回节点世界位置（至少不会错位到原点）
    if (typeof obj.getWorldPosition === 'function' && ctr.set) obj.getWorldPosition(ctr);
    e.size = e.size || 0;
  }

  e.anchor = ctr;
  e.anchorFrame = frame;
  return ctr;
}

/* ═══════════════ 每帧更新 ═══════════════ */

let frame = 0;

/** 包围盒缓存的有效帧数：部件在拆解中会移动，需周期性重算 */
const ANCHOR_TTL = 12;

export function updateLabels() {
  if (!inited || !visible || !layer) return;

  const camera = app?.camera;
  const renderer = app?.renderer;
  if (!camera || !renderer) return;

  const registry = app?.registry;
  if (!registry?.parts?.size) {
    if (entries.size) rebuild();
    return;
  }
  if (!entries.size || entries.size !== registry.parts.size) rebuild();

  frame++;
  camera.updateMatrixWorld?.();
  registry.engineRoot?.updateMatrixWorld?.(true);
  app?.scene?.updateMatrixWorld?.(true);

  const W = window.innerWidth;
  const H = window.innerHeight;

  camPos.x = camera.position.x;
  camPos.y = camera.position.y;
  camPos.z = camera.position.z;

  const state = app?.state || {};
  const hovered = state.hovered || null;
  const selected = state.selected || null;

  /* ── 收集候选：可见 + 世界坐标 + 相机距离 ── */
  const cands = [];

  for (const e of entries.values()) {
    const rec = e.rec;
    const obj = rec.object3D;

    if (!obj || obj.visible === false) { e.root.style.opacity = '0'; e.leader.style.opacity = '0'; continue; }

    // 沿父链检查可见性（拆解/隐藏时同步隐藏标签）
    let vis = true;
    for (let n = obj; n; n = n.parent) {
      if (n.visible === false) { vis = false; break; }
    }
    if (!vis) { e.root.style.opacity = '0'; e.leader.style.opacity = '0'; continue; }

    // 部件 object3D 多为 Group，几何体在子节点上 —— 必须用包围盒中心作锚点
    const anchor = computeAnchor(e, (frame - (e.anchorFrame || 0)) >= ANCHOR_TTL);
    if (!anchor) { e.root.style.opacity = '0'; e.leader.style.opacity = '0'; continue; }

    const dx = anchor.x - camPos.x;
    const dy = anchor.y - camPos.y;
    const dz = anchor.z - camPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const v = project(anchor, camera);
    // z > 1 => 在远裁剪面之外 / 相机背后
    const behind = !v || v.z > 1;

    e.wx = anchor.x; e.wy = anchor.y; e.wz = anchor.z;
    e.dist = dist;
    e.ndcX = v ? v.x : 0;
    e.ndcY = v ? v.y : 0;
    e.behind = behind;

    cands.push(e);
  }

  /* ── 距离中位数（用于淡出基准） ── */
  distScratch.length = 0;
  for (let i = 0; i < cands.length; i++) distScratch.push(cands[i].dist);
  distScratch.sort((a, b) => a - b);
  const median = distScratch.length ? distScratch[distScratch.length >> 1] : 1;
  const fadeRef = Math.max(median * MAX_DIST_FADE, 1);

  /* ── 超量时筛选 ── */
  let list = cands;
  if (cands.length > MAX_FULL_LABELS) {
    const must = [];
    const rest = [];
    for (const e of cands) {
      if (e.rec.id === hovered || e.rec.id === selected) must.push(e);
      else rest.push(e);
    }
    rest.sort((a, b) => b.size - a.size);
    list = must.concat(rest.slice(0, Math.max(PRIORITY_LABELS, MAX_FULL_LABELS - must.length)));
  }

  const keep = new Set(list);

  /* ── 摆放 ── */
  placed.length = 0;

  for (const e of entries.values()) {
    if (!keep.has(e)) { hide(e); continue; }

    if (e.behind) { hide(e); continue; }

    const ax = (e.ndcX + 1) * 0.5 * W;
    const ay = (1 - e.ndcY) * 0.5 * H;

    if (ax < -OFFSCREEN_PAD || ax > W + OFFSCREEN_PAD ||
        ay < -OFFSCREEN_PAD || ay > H + OFFSCREEN_PAD) {
      hide(e);
      continue;
    }

    // 距离淡出
    const fade = clamp(1 - Math.max(0, e.dist - median) / (fadeRef - median || 1), 0.15, 1);
    const scale = clamp(1 - Math.max(0, e.dist - median) / ((fadeRef - median || 1) * 2.2), 0.72, 1);

    // 水平锚定：根据锚点在屏幕的左右位置决定标签朝向
    const right = ax <= W * 0.5;
    let tx = right ? ax + ANCHOR_OFFSET : ax - ANCHOR_OFFSET;
    let ty = ay;

    if (!e.w || !e.h) {
      // 首次出现：用一次测量确定宽度（之后不再测量）
      const r = e.root.getBoundingClientRect();
      e.w = r.width || 120;
      e.h = r.height || 30;
    }
    if (!right) tx -= e.w;

    // 简单去重叠：与已放置标签垂直错开
    ty = deoverlap(tx, ty, e.w, e.h);

    placed.push({ x: tx, y: ty, w: e.w * scale, h: e.h * scale });

    // 引线：从锚点到标签靠近锚点的那一侧
    const lx = right ? tx : tx + e.w * scale;
    const ly = ty + (e.h * scale) * 0.5;
    const dx = lx - ax;
    const dy = ly - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;

    if (len >= LEADER_MIN) {
      e.leader.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0) rotate(${ang.toFixed(2)}deg)`;
      e.leader.style.width = `${len.toFixed(1)}px`;
      e.leader.style.opacity = (0.85 * fade).toFixed(2);
    } else {
      e.leader.style.opacity = '0';
    }

    e.root.style.transform =
      `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    e.root.style.opacity = fade.toFixed(2);

    // 状态类：只在与上次不同时改写，减少样式重算
    setCls(e, 'is-active', e.rec.id === selected);
    setCls(e, 'is-hover', e.rec.id === hovered);
    setCls(e, 'is-near', e.dist < median * 0.55);
  }
}

function hide(e) {
  if (e.hidden) return;
  e.hidden = true;
  e.root.style.opacity = '0';
  e.leader.style.opacity = '0';
}

function setCls(e, cls, on) {
  const has = e.root.classList.contains(cls);
  if (on && !has) e.root.classList.add(cls);
  else if (!on && has) e.root.classList.remove(cls);
}

function deoverlap(x, y, w, h) {
  let ty = y;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const p of placed) {
      const overlapX = Math.abs(p.x - x) < (p.w + w) * 0.5;
      const overlapY = Math.abs(p.y - ty) < (p.h + h) * 0.5 + 2;
      if (overlapX && overlapY) {
        ty = p.y + p.h * 0.5 + h * 0.5 + 6 + pass * 3;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return ty;
}

/* ═══════════════ 可见性 ═══════════════ */

export function setLabelsVisible(on) {
  visible = !!on;
  if (!layer) return;
  layer.classList.toggle('is-off', !visible);
  if (!visible) {
    for (const e of entries.values()) {
      e.root.style.opacity = '0';
      e.leader.style.opacity = '0';
    }
  }
}

/* ═══════════════ 工具 ═══════════════ */

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function project(world, camera) {
  if (ensureVectors()) {
    _projVec.set(world.x, world.y, world.z);
    _projVec.project(camera);
    return _projVec;
  }
  return projectFallback(world, camera);
}


/** 调试用：当前标签数量 */
export function labelCount() { return entries.size; }
