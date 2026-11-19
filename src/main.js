/**
 * main.js — 应用编排层
 *
 * 负责：渲染器/场景/相机/控制器初始化、主题、拾取、UI 事件绑定、主循环。
 * 几何构建见 assembly.js，拆解动画见 animation.js，特效见 effects.js。
 */

import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/addons/OrbitControls.js';

import { registry } from './registry.js';
import { PARTS, ENGINE_META } from './data/parts.js';
import { buildEngine } from './assembly.js';
import { createMaterials, applyTheme } from './materials.js';
import { ExplodeController } from './animation.js';
import { EffectsSystem } from './effects.js';
import { createPostFX } from './postprocessing.js';
import { initPanels, showPartDetail, setActivePart, setTheme, pushLog, setProgress, setPartListActive } from './ui/panels.js';
import { initLabels, updateLabels, setLabelsVisible } from './ui/labels.js';

/* ═══════════════ 状态 ═══════════════ */
const state = {
  theme: 'dark',
  exploded: false,
  explodeT: 0,
  hovered: null,
  selected: null,
  labelsOn: true,
  autoRotate: false,
  picking: true,
  simMode: null,       // null | 'ignition' | 'launch'
};

let renderer, scene, camera, controls, clock;
let postfx = null;
let explode = null;
let effects = null;
let raycaster, pointer;
let sunLight, hemiLight, fillLight;

const canvasWrap = () => document.getElementById('canvas-wrap');

/* VIEW_ISO_DIR：默认等轴视角的相机方向（相对视线目标，未归一化前也一致）*/
const VIEW_ISO_DIR = [0.70, 0.30, 0.70];

/* ═══════════════ 相机取景 ═══════════════
 * 模型高 ≈ 11280、底部跨度 ≈ 4760，且左右两侧各被面板遮挡
 * （左 ~230px / 右 ~320px），所以要同时满足：
 *   · 整机高度约占视口 70–80%
 *   · 水平方向落在中间未被遮挡的 band 内（实测水平远不是约束，垂直才是）
 * VIEW_DIST_K = 2.15，等轴视角下整机约占视口高度 76%。
 * init / resetView / setView 共用同一组常量，避免三处不一致。 */
const VIEW_DIST_K = 2.15;              // 默认取景距离 / H
const VIEW_TARGET_K = 0.47;            // 视线目标高度 / H（整机竖向中心略偏上）
const FRAME_TARGET = 0.76;             // 期望整机占据的视口高度比例

/** 由方向 + 距离算出相机位置（方向先归一化，保证距离精确） */
function camPos(H, targetY, dir, distK) {
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = H * distK;
  return [
    (dir[0] / dl) * d,
    targetY + (dir[1] / dl) * d,
    (dir[2] / dl) * d,
  ];
}

function init() {
  const wrap = canvasWrap();

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(42, wrap.clientWidth / wrap.clientHeight, 0.5, 80000);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.7;
  controls.screenSpacePanning = true;

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  clock = new THREE.Clock();

  // ── 灯光 ──
  hemiLight = new THREE.HemisphereLight(0x8fb6ff, 0x1a1f2e, 0.55);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
  sunLight.position.set(900, 2600, 1400);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0018;
  sunLight.shadow.normalBias = 2.0;
  const sc = sunLight.shadow.camera;
  // 坝体外缘半径已增至 ≈2020（直径 ≈4040），阴影正交视锥需覆盖整个基座
  sc.near = 100; sc.far = 16000;
  sc.left = -4200; sc.right = 4200; sc.top = 4200; sc.bottom = -4200;
  sc.updateProjectionMatrix();
  scene.add(sunLight);
  scene.add(sunLight.target);

  fillLight = new THREE.DirectionalLight(0x4ea8ff, 0.85);
  fillLight.position.set(-1400, 700, -1100);
  scene.add(fillLight);

  // ── 材质库 ──
  const materials = createMaterials();
  registry.materials = materials;

  // ── 构建发动机 ──
  const engine = buildEngine(materials);
  scene.add(engine);
  registry.buildPickMap();

  // ── 相机取景 ──
  registry.engineHeight = ENGINE_META.totalHeight;
  const H = registry.engineHeight;
  const ty0 = H * VIEW_TARGET_K;
  const p0 = camPos(H, ty0, VIEW_ISO_DIR, VIEW_DIST_K);
  controls.target.set(0, ty0, 0);
  camera.position.set(p0[0], p0[1], p0[2]);
  controls.minDistance = H * 0.05;
  controls.maxDistance = H * 4.5;      // 整机更宽后放宽，避免取景被裁
  controls.maxPolarAngle = Math.PI * 0.94;
  controls.update();

  // ── 环境（程序化星空/地面）──
  buildEnvironment();

  // ── 拆解动画 ──
  explode = new ExplodeController(registry);

  // ── 特效 ──
  effects = new EffectsSystem(scene, registry);

  // ── 后处理 ──
  try {
    postfx = createPostFX(renderer, scene, camera);
  } catch (err) {
    console.warn('[postfx] 初始化失败，回退到直接渲染', err);
    postfx = null;
  }

  // ── UI ──
  initPanels(appApi);
  initLabels(appApi);
  bindEvents();

  // 以首帧落定的 data-theme 为准（index.html 的内联脚本已解析过 localStorage
  // 与 prefers-color-scheme），避免 state.theme 与 DOM 主题不一致。
  const initial = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  state.theme = initial;
  applyThemeToScene(initial);
  setTheme(initial);

  window.addEventListener('resize', onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(wrap);

  onResize();
  animate();
}

/* ═══════════════ 环境 ═══════════════ */
let envGroup = null;
function buildEnvironment() {
  envGroup = new THREE.Group();
  envGroup.name = 'environment';
  const H = ENGINE_META.totalHeight;

  // 地面
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a, roughness: 0.96, metalness: 0.05,
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(H * 2.6, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  ground.name = 'ground';
  envGroup.add(ground);

  // 网格辅助（科技感）
  const grid = new THREE.PolarGridHelper(H * 2.4, 16, 12, 96, 0x1e5f8f, 0x14384f);
  grid.position.y = 0.2;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.name = 'polarGrid';
  envGroup.add(grid);

  // 星空
  const starCount = 2600;
  const sg = new THREE.BufferGeometry();
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = H * 6 + Math.random() * H * 14;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 1.6 - 0.6);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.9 + H * 0.05;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xbcd6ff, size: H * 0.012, sizeAttenuation: true,
    transparent: true, opacity: 0.85, depthWrite: false,
  }));
  stars.name = 'stars';
  envGroup.add(stars);

  scene.add(envGroup);
  registry.envGroup = envGroup;
}

/* ═══════════════ 主题 ═══════════════ */
function applyThemeToScene(mode) {
  const dark = mode === 'dark';

  if (envGroup) {
    const ground = envGroup.getObjectByName('ground');
    const grid = envGroup.getObjectByName('polarGrid');
    const stars = envGroup.getObjectByName('stars');
    if (ground) ground.material.color.set(dark ? 0x2a2f3a : 0xb8c1cc);
    if (grid) {
      grid.material.opacity = dark ? 0.5 : 0.42;
      grid.material.color?.set?.(dark ? 0x1e5f8f : 0x7d8b9c);
    }
    if (stars) stars.visible = dark;
  }

  // 浅色白模：降低环境光、抬高主光，靠明暗塑造体积（纯白 + 强环境光会把形体冲平）
  hemiLight.color.set(dark ? 0x8fb6ff : 0xffffff);
  hemiLight.groundColor.set(dark ? 0x1a1f2e : 0xb9c2cc);
  hemiLight.intensity = dark ? 0.55 : 0.62;

  sunLight.intensity = dark ? 2.2 : 3.1;
  sunLight.position.set(dark ? 900 : 1500, dark ? 2600 : 3400, dark ? 1400 : 2100);
  fillLight.intensity = dark ? 0.85 : 0.35;

  // 浅色下加一盏弱的反向补光，避免暗面死黑
  if (fillLight.color) fillLight.color.set(dark ? 0x4ea8ff : 0xc8d4e2);

  renderer.toneMappingExposure = dark ? 1.05 : 0.98;

  applyTheme(mode, registry.materials);

  // 背景沿用 CSS（透明画布），由 body 主题决定
  renderer.setClearColor(0x000000, 0);

  effects?.setTheme(mode);
  if (registry.envGroup) registry.envGroup.visible = dark || true;
}

/* ═══════════════ 拾取 ═══════════════ */
const dragState = { down: false, moved: false, x: 0, y: 0 };

function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickAt(clientX, clientY) {
  setPointerFromEvent({ clientX, clientY });
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(registry.meshToPart.size ? [...registry.meshToPart.keys()] : [], false);
  for (const h of hits) {
    if (!h.object.visible) continue;
    const part = registry.partOf(h.object);
    if (part) return { part, hit: h };
  }
  return null;
}

function onPointerDown(e) {
  dragState.down = true;
  dragState.moved = false;
  dragState.x = e.clientX;
  dragState.y = e.clientY;
}

function onPointerMove(e) {
  if (dragState.down) {
    if (Math.hypot(e.clientX - dragState.x, e.clientY - dragState.y) > 4) dragState.moved = true;
    return; // 拖动中不做 hover 计算
  }
  if (!state.picking) return;
  const r = pickAt(e.clientX, e.clientY);
  const id = r ? r.part.id : null;
  if (id !== state.hovered) {
    state.hovered = id;
    registry.setHover?.(id);
    renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    appApi.onHover?.(id);
  }
}

function onPointerUp(e) {
  if (dragState.down && !dragState.moved) {
    const r = pickAt(e.clientX, e.clientY);
    if (r) {
      selectPart(r.part.id, { focus: false });
    } else {
      selectPart(null);
    }
  }
  dragState.down = false;
}

/* ═══════════════ 选中 / 高亮 ═══════════════ */
let highlightImpl = null;   // 由 assembly/animation 注入
export function registerHighlighter(fn) { highlightImpl = fn; }

function selectPart(id, opts = {}) {
  state.selected = id;
  highlightImpl?.(id, state.hovered);
  setActivePart(id);
  if (id) showPartDetail(id);
  if (id && opts.focus) focusOn(id);
}

function focusOn(id) {
  const part = registry.get(id);
  if (!part) return;
  const box = new THREE.Box3().setFromObject(part.object3D);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, Math.max(size * 1.3, registry.engineHeight * 0.14));
  controls.update();
}

/* ═══════════════ UI API（传给面板层） ═══════════════ */
const appApi = {
  state,
  registry,
  get camera() { return camera; },
  get controls() { return controls; },
  get renderer() { return renderer; },
  get scene() { return scene; },

  initPanels,  // 占位，避免误用

  selectPart,
  focusOn,

  setExploded(on) {
    state.exploded = !!on;
    explode.setExploded(state.exploded);
    pushLog(state.exploded ? '拆解视图：展开' : '拆解视图：复位');
    return state.exploded;
  },

  toggleExploded() { return this.setExploded(!state.exploded); },

  resetView() {
    const H = registry.engineHeight;
    const ty = H * VIEW_TARGET_K;
    const p = camPos(H, ty, VIEW_ISO_DIR, VIEW_DIST_K);
    controls.target.set(0, ty, 0);
    camera.position.set(p[0], p[1], p[2]);
    controls.update();
    pushLog('视角已复位');
  },

  setView(preset) {
    const H = registry.engineHeight;
    // 各预设给出 { ty: 视线目标高度(×H), dir: 相机方向(单位向量), dist: 距离(×H) }。
    // 模型底部跨度 ≈4760（≈0.43H），基座视角需足够远的距离才能纳入整个坝体。
    const views = {
      iso:    { ty: VIEW_TARGET_K, dir: [0.70, 0.30, 0.70], dist: VIEW_DIST_K },
      front:  { ty: VIEW_TARGET_K, dir: [0, 0, 1], dist: VIEW_DIST_K },
      side:   { ty: VIEW_TARGET_K, dir: [1, 0, 0], dist: VIEW_DIST_K },
      // 俯视：从正上方俯瞰整机（含 4760 宽的坝体），距离需覆盖水平跨度
      top:    { ty: VIEW_TARGET_K, dir: [0.001, 1, 0.001], dist: VIEW_DIST_K * 1.05 },
      // 基座：低机位近观坝体与七条支撑腿，目标下移到坝顶附近（主体占视口 ≈64%）
      base:   { ty: 0.10, dir: [0.62, 0.22, 0.62], dist: VIEW_DIST_K * 0.62 },
      // 喷口：低机位仰视塔顶喷管阵列，目标抬到塔帽/喉部附近
      nozzle: { ty: 0.90, dir: [0.35, -0.16, 0.92], dist: VIEW_DIST_K * 0.58 },
    };
    const v = views[preset] || views.iso;
    const ty = H * v.ty;
    const p = camPos(H, ty, v.dir, v.dist);
    controls.target.set(0, ty, 0);
    camera.position.set(p[0], p[1], p[2]);
    controls.update();
    pushLog(`视角：${{ iso: '等轴', front: '正视', side: '侧视', top: '俯视', base: '基座', nozzle: '喷口' }[preset] || preset}`);
  },

  setTheme(mode) {
    state.theme = mode;
    document.documentElement.setAttribute('data-theme', mode);
    applyThemeToScene(mode);
    setTheme(mode);
    pushLog(mode === 'dark' ? '切换：深色科技' : '切换：浅色白模');
  },

  toggleTheme() { this.setTheme(state.theme === 'dark' ? 'light' : 'dark'); },

  setLabels(on) {
    state.labelsOn = !!on;
    setLabelsVisible(state.labelsOn);
    pushLog(state.labelsOn ? '标注：显示' : '标注：隐藏');
  },

  toggleLabels() { this.setLabels(state.labelsOn ? false : true); },

  setAutoRotate(on) {
    state.autoRotate = !!on;
    controls.autoRotate = state.autoRotate;
    controls.autoRotateSpeed = 0.45;
  },

  async simulate(kind) {
    if (state.simMode) { pushLog('序列执行中，请稍候…'); return; }
    state.simMode = kind;
    try {
      await effects.runSequence(kind, (text, pct) => { pushLog(text); setProgress(pct); });
    } finally {
      state.simMode = null;
      setProgress(0);
    }
  },

  stopSim() {
    effects?.stop();
    state.simMode = null;
    setProgress(0);
    pushLog('序列已中止');
  },

  // 供面板层回调
  onHover: null,
  isExploded: () => state.exploded,
  isLabelsOn: () => state.labelsOn,
  getTheme: () => state.theme,
};

/* ═══════════════ 事件绑定 ═══════════════ */
function bindEvents() {
  const el = renderer.domElement;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointerleave', () => { dragState.down = false; });

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    switch (e.key.toLowerCase()) {
      case 'e': appApi.toggleExploded(); break;
      case 'r': appApi.resetView(); break;
      case 'l': appApi.toggleLabels(); break;
      case 't': appApi.toggleTheme(); break;
      case 'i': appApi.simulate('ignition'); break;
      case 'space': e.preventDefault(); appApi.setAutoRotate(!state.autoRotate); break;
      case 'escape': selectPart(null); break;
      default: break;
    }
  });

  document.getElementById('btn-theme')?.addEventListener('click', () => appApi.toggleTheme());
  document.getElementById('btn-explode')?.addEventListener('click', () => appApi.toggleExploded());
  document.getElementById('btn-reset')?.addEventListener('click', () => appApi.resetView());
  document.getElementById('btn-ignite')?.addEventListener('click', () => appApi.simulate('ignition'));
  document.getElementById('btn-launch')?.addEventListener('click', () => appApi.simulate('launch'));
  document.getElementById('btn-labels')?.addEventListener('click', () => appApi.toggleLabels());
}

/* ═══════════════ 循环 ═══════════════ */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  explode?.update(dt);
  effects?.update(dt, camera);
  controls.update();

  if (state.labelsOn) updateLabels();

  if (postfx) postfx.render(dt);
  else renderer.render(scene, camera);
}

function onResize() {
  const wrap = canvasWrap();
  if (!wrap) return;
  const w = wrap.clientWidth || window.innerWidth;
  const h = wrap.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  postfx?.setSize(w, h);
}

/* ═══════════════ 启动 ═══════════════ */
const api = { state, appApi, registry, selectPart, registerHighlighter,
  get scene() { return scene; }, get camera() { return camera; },
  get renderer() { return renderer; }, get explode() { return explode; },
  get effects() { return effects; } };

window.__ENGINE__ = api;

try {
  init();
  document.getElementById('loading')?.classList.add('hidden');
  pushLog('行星发动机模型加载完成');
  pushLog(`已注册部件：${registry.parts.size} 个`);
} catch (err) {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.innerHTML = `<div class="err"><h2>初始化失败</h2><pre>${String(err && err.stack || err)}</pre></div>`;
  window.__ENGINE_ERROR__ = String(err && err.stack || err);
}
