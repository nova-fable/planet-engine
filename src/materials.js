/**
 * materials.js — 共享材质库（行星发动机可视化）
 *
 * 主题：
 *   dark  —— 深色科技：深蓝黑金属 + 强自发光霓虹强调色
 *   light —— 浅色白模：近白哑光"白模/黏土"渲染，微弱 AO 感、极低自发光
 *
 * 所有材质都是共享实例（跨部件复用），applyTheme 就地改色，
 * 因此场景中已装配的网格会立刻跟随主题变化。
 */

import * as THREE from '../vendor/three.module.js';

/* ═══════════════ 调色板 ═══════════════ */

export const PALETTE = {
  dark: {
    bg: 0x070a12,
    fog: 0x0a1020,
    structuralSteel: 0x5c6673,
    structuralSteelMetal: 0.92,
    structuralSteelRough: 0.52,
    darkAlloy: 0x2b323c,
    paintedShell: 0x4b5666,
    titanium: 0x9aa6b4,
    copperPipe: 0xb4703a,
    pipeInsulation: 0x6b6257,
    plasma: 0x35e6ff,
    plasmaEmissive: 0x9ff6ff,
    plasmaIntensity: 3.4,
    tungsten: 0x6d6259,
    tungstenHot: 0xffb066,
    tungstenHotIntensity: 1.6,
    magneticCoil: 0x8b5cf6,
    coilIntensity: 1.9,
    carbon: 0x1d2126,
    aluminium: 0xb7c0cb,
    glass: 0x8fd8ff,
    glassOpacity: 0.3,
    glassEmissive: 0x123a55,
    warningYellow: 0xf5c518,
    warningDark: 0x1a1a1a,
    emissiveStrip: 0x35e6ff,
    stripIntensity: 2.6,
    beacon: 0xff3b30,
    beaconIntensity: 3.2,
    gold: 0xc9a227,
    coolant: 0x2f8fd8,
    coolantEmissive: 0x0d2c44,
    cable: 0x24282e,
    concrete: 0x4a4f57,
    rust: 0x7a4a30,
    green: 0x34d399,
    red: 0xef4444,
    white: 0xdfe6ee,
  },
  light: {
    bg: 0xdbe1e8,
    fog: 0xd2d9e1,
    /* 白模风格：表面须是"浅灰白黏土"而非纯白，否则与浅色背景糊成一片。
       明度整体压到 0x5f–0xbf 区间，靠明暗与轮廓塑形，而非自发光。 */
    structuralSteel: 0x98a1ab,
    structuralSteelMetal: 0.12,
    structuralSteelRough: 0.72,
    darkAlloy: 0x6f7883,
    paintedShell: 0xa8b1bb,
    titanium: 0x9aa4af,
    copperPipe: 0xb08252,
    pipeInsulation: 0x8d8a83,
    plasma: 0x4fb8d8,
    plasmaEmissive: 0x4fb8d8,
    plasmaIntensity: 0.55,
    tungsten: 0x8a8880,
    tungstenHot: 0xc07a44,
    tungstenHotIntensity: 0.35,
    magneticCoil: 0x8f76c8,
    coilIntensity: 0.6,
    carbon: 0x5f666e,
    aluminium: 0xb7bec7,
    glass: 0x9fc6dc,
    glassOpacity: 0.34,
    glassEmissive: 0x5d7686,
    warningYellow: 0xd9a800,
    warningDark: 0x2e2e2e,
    emissiveStrip: 0x5f9fbe,
    stripIntensity: 0.5,
    beacon: 0xc4504a,
    beaconIntensity: 0.8,
    gold: 0xb99a3f,
    coolant: 0x6f9cc0,
    coolantEmissive: 0x6f9cc0,
    cable: 0x7b828b,
    concrete: 0xa9aeb5,
    rust: 0x9c7052,
    green: 0x6fb894,
    red: 0xbd7676,
    white: 0xeef2f6,
  },
};

/** 每个主题独立的雾/环境色，方便外部读取 */
export const THEME_SCENE = {
  dark: { background: 0x070a12, fog: 0x0a1020, fogDensity: 0.000012 },
  // 白模主题的雾要非常轻：地面与背景已是近白，雾一大塔身下半部就糊掉了
  light: { background: 0xdbe1e8, fog: 0xd2d9e1, fogDensity: 0.000004 },
};

/* ═══════════════ 内部工具 ═══════════════ */

let _canvasWarned = false;

/** 程序化 CanvasTexture —— 无 document 环境（Node 测试）返回 null */
function makeCanvas(size = 128) {
  if (typeof document === 'undefined' || !document.createElement) {
    if (!_canvasWarned) {
      _canvasWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[materials] 无 document 环境，程序化贴图已跳过（headless 模式）');
    }
    return null;
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** 程序化细微噪声图，用于打破大面积纯色（roughnessMap / map 微调） */
function makeGrainTexture(size = 128, strength = 26) {
  const canvas = makeCanvas(size);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (Math.random() * 2 - 1) * strength;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 轻微水平拉丝，模拟轧制钢板
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#ffffff';
  for (let y = 0; y < size; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(size, y + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** 程序化 45° 黄黑警示条纹贴图 */
function makeHazardTexture(size = 256, colorA = '#f5c518', colorB = '#151515') {
  const canvas = makeCanvas(size);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = colorB;
  ctx.lineWidth = size / 8;
  for (let i = -size; i < size * 2; i += size / 4) {
    ctx.beginPath();
    ctx.moveTo(i, -4);
    ctx.lineTo(i + size, size + 4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 面板网格贴图（玻璃/控制屏） */
function makePanelTexture(size = 256) {
  const canvas = makeCanvas(size);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#0b1a26';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(120,230,255,0.85)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 8; i++) {
    const p = (i / 8) * size;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(120,230,255,0.35)';
  for (let i = 0; i < 26; i++) {
    ctx.fillRect(Math.floor(Math.random() * 8) * (size / 8) + 4,
      Math.floor(Math.random() * 8) * (size / 8) + 4,
      size / 8 - 10, size / 8 - 10);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 记忆化材质工厂：多个部件请求同名材质时复用同一实例，
 * 避免材质爆炸并保证 applyTheme 一次生效。
 */
function memoFactory() {
  const cache = new Map();
  return function memo(key, factory) {
    if (!cache.has(key)) cache.set(key, factory());
    return cache.get(key);
  };
}

/* ═══════════════ 材质库构建 ═══════════════ */

let grainTexture = null;
const getGrain = () => (grainTexture || (grainTexture = makeGrainTexture(128, 24)));

/**
 * 创建共享材质库。
 * 返回的对象既可作为字典访问（mats.steel），也可通过 mats.get('steel') 访问，
 * 未知键会返回一个中性的备用材质，保证 assembly 中笔误不会导致崩溃。
 */
export function createMaterials() {
  const memo = memoFactory();
  const P = PALETTE.dark;

  const std = (name, params, key = name) =>
    memo(key, () => {
      const m = new THREE.MeshStandardMaterial({
        color: params.color ?? 0x888888,
        roughness: params.roughness ?? 0.6,
        metalness: params.metalness ?? 0.5,
        emissive: params.emissive ?? 0x000000,
        emissiveIntensity: params.emissiveIntensity ?? 1,
        flatShading: params.flatShading ?? false,
        side: params.side ?? THREE.FrontSide,
        transparent: params.transparent ?? false,
        opacity: params.opacity ?? 1,
        envMapIntensity: params.envMapIntensity ?? 1,
        name,
      });
      if (params.map) m.map = params.map;
      if (params.roughnessMap) m.roughnessMap = params.roughnessMap;
      if (params.normalMap) m.normalMap = params.normalMap;
      if (params.toneMapped !== undefined) m.toneMapped = params.toneMapped;
      return m;
    });

  const grain = getGrain();
  const hazard = makeHazardTexture(256, '#f5c518', '#151515');
  const hazardDark = makeHazardTexture(256, '#2a2a2a', '#8a8a8a');
  const panelTex = makePanelTexture(256);

  const mats = {};

  /* ── 结构类 ── */
  mats.steel = std('structural-steel', {
    color: P.structuralSteel, roughness: P.structuralSteelRough, metalness: P.structuralSteelMetal,
    roughnessMap: grain,
  });
  mats.steelDark = std('structural-steel-dark', {
    color: 0x3d454f, roughness: 0.62, metalness: 0.88, roughnessMap: grain,
  });
  mats.darkAlloy = std('dark-alloy', {
    color: P.darkAlloy, roughness: 0.48, metalness: 0.95, roughnessMap: grain,
  });
  mats.paintedShell = std('painted-shell', {
    color: P.paintedShell, roughness: 0.68, metalness: 0.35, roughnessMap: grain,
  });
  mats.paintAccent = std('paint-accent', {
    color: 0x2f4f6b, roughness: 0.7, metalness: 0.3,
  });
  mats.titanium = std('titanium', {
    color: P.titanium, roughness: 0.36, metalness: 0.98,
  });
  mats.plateHeavy = std('plate-heavy', {
    color: 0x5a636e, roughness: 0.58, metalness: 0.85, roughnessMap: grain,
  });

  /* ── 管路 / 燃料 ── */
  mats.copper = std('copper-pipe', {
    color: P.copperPipe, roughness: 0.34, metalness: 0.95,
  });
  mats.pipeInsulation = std('pipe-insulation', {
    color: P.pipeInsulation, roughness: 0.82, metalness: 0.15, roughnessMap: grain,
  });
  mats.fuelLine = std('fuel-line', {
    color: 0x8a5a2e, roughness: 0.45, metalness: 0.8,
    emissive: 0x2a0f00, emissiveIntensity: 0.35,
  });
  mats.insulationWrap = std('insulation-wrap', {
    color: 0x9a9384, roughness: 0.9, metalness: 0.05,
  });

  /* ── 等离子 / 反应室 ── */
  mats.plasma = std('plasma', {
    color: P.plasma, roughness: 0.25, metalness: 0.0,
    emissive: P.plasmaEmissive, emissiveIntensity: P.plasmaIntensity,
  });
  mats.plasmaCore = std('plasma-core', {
    color: 0xffffff, roughness: 0.2, metalness: 0.0,
    emissive: 0xffffff, emissiveIntensity: 4.2,
  });
  mats.tungsten = std('tungsten', {
    color: P.tungsten, roughness: 0.42, metalness: 0.9,
  });
  mats.tungstenHot = std('tungsten-hot', {
    color: 0x8a6a52, roughness: 0.5, metalness: 0.7,
    emissive: P.tungstenHot, emissiveIntensity: P.tungstenHotIntensity,
  });

  /* ── 磁约束 ── */
  mats.coil = std('magnetic-coil', {
    color: P.magneticCoil, roughness: 0.35, metalness: 0.75,
    emissive: P.magneticCoil, emissiveIntensity: P.coilIntensity,
  });
  mats.coilCryo = std('coil-cryo', {
    color: 0x8fa3b8, roughness: 0.55, metalness: 0.7,
  });
  mats.superconductor = std('superconductor', {
    color: 0x6f5bb5, roughness: 0.4, metalness: 0.8,
    emissive: 0x4c1d95, emissiveIntensity: 0.9,
  });

  /* ── 喷口 / 推进 ── */
  mats.carbon = std('carbon-carbon', {
    color: P.carbon, roughness: 0.72, metalness: 0.28, roughnessMap: grain,
  });
  mats.carbonInner = std('carbon-inner', {
    color: 0x111418, roughness: 0.55, metalness: 0.4,
    emissive: 0x220a00, emissiveIntensity: 0.5, side: THREE.DoubleSide,
  });
  mats.aluminium = std('aluminium-fin', {
    color: P.aluminium, roughness: 0.32, metalness: 0.82,
  });
  mats.actuator = std('actuator', {
    color: 0x8e1f1f, roughness: 0.42, metalness: 0.85,
  });
  mats.actuatorRod = std('actuator-rod', {
    color: 0xd6dde6, roughness: 0.2, metalness: 1.0,
  });
  mats.refractory = std('refractory-concrete', {
    color: P.concrete, roughness: 0.95, metalness: 0.05, roughnessMap: grain,
  });

  /* ── 冷却 ── */
  mats.coolant = std('coolant', {
    color: P.coolant, roughness: 0.4, metalness: 0.6,
    emissive: P.coolantEmissive, emissiveIntensity: 0.7,
  });
  mats.finAlloy = std('cooling-fin', {
    color: 0xd3dae2, roughness: 0.28, metalness: 0.78, roughnessMap: grain,
  });

  /* ── 控制 / 电力 ── */
  mats.glass = memo('glass-panel', () => {
    const m = new THREE.MeshStandardMaterial({
      color: P.glass, roughness: 0.08, metalness: 0.15,
      emissive: P.glassEmissive, emissiveIntensity: 0.85,
      transparent: true, opacity: P.glassOpacity,
      side: THREE.DoubleSide, name: 'glass-panel',
    });
    if (panelTex) { m.map = panelTex; m.emissiveMap = panelTex; }
    return m;
  });
  mats.darkGlass = memo('dark-glass', () => new THREE.MeshStandardMaterial({
    color: 0x14212c, roughness: 0.12, metalness: 0.4,
    emissive: 0x0a2233, emissiveIntensity: 0.6,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide, name: 'dark-glass',
  }));
  mats.cable = std('cable', { color: P.cable, roughness: 0.85, metalness: 0.2 });
  mats.cableTray = std('cable-tray', { color: 0x9aa3ad, roughness: 0.5, metalness: 0.85 });
  mats.circuit = std('circuit-board', {
    color: 0x1f3b2b, roughness: 0.6, metalness: 0.4,
    emissive: 0x0f8a5a, emissiveIntensity: 0.5,
  });

  /* ── 发光强调 ── */
  mats.strip = std('emissive-strip', {
    color: P.emissiveStrip, roughness: 0.3, metalness: 0.0,
    emissive: P.emissiveStrip, emissiveIntensity: P.stripIntensity,
  });
  mats.beacon = std('beacon', {
    color: P.beacon, roughness: 0.3, metalness: 0.0,
    emissive: P.beacon, emissiveIntensity: P.beaconIntensity,
  });
  mats.beaconGreen = std('beacon-green', {
    color: P.green, roughness: 0.3, metalness: 0.0,
    emissive: P.green, emissiveIntensity: 2.4,
  });
  mats.statusLight = std('status-light', {
    color: 0xff9d2e, roughness: 0.3, metalness: 0.0,
    emissive: 0xff9d2e, emissiveIntensity: 2.2,
  });

  /* ── 标识 ── */
  mats.warningYellow = memo('warning-yellow', () => {
    const m = new THREE.MeshStandardMaterial({
      color: P.warningYellow, roughness: 0.62, metalness: 0.2, name: 'warning-yellow',
    });
    if (hazard) m.map = hazard;
    return m;
  });
  mats.warningDark = memo('warning-dark', () => {
    const m = new THREE.MeshStandardMaterial({
      color: P.warningDark, roughness: 0.7, metalness: 0.25, name: 'warning-dark',
    });
    if (hazardDark) m.map = hazardDark;
    return m;
  });
  mats.warningPaint = std('warning-paint', {
    color: P.warningYellow, roughness: 0.68, metalness: 0.1,
  });
  mats.signPanel = std('sign-panel', {
    color: 0xe8eef4, roughness: 0.5, metalness: 0.1,
  });

  /* ── 基础 / 地面 ── */
  mats.concrete = std('concrete', {
    color: P.concrete, roughness: 0.95, metalness: 0.03, roughnessMap: grain,
  });
  mats.rebar = std('rebar', { color: P.rust, roughness: 0.85, metalness: 0.5 });
  mats.grating = memo('grating', () => new THREE.MeshStandardMaterial({
    color: 0x8d949c, roughness: 0.55, metalness: 0.85,
    side: THREE.DoubleSide, name: 'grating',
  }));
  mats.bolt = std('bolt', { color: 0x4a5058, roughness: 0.45, metalness: 0.95 });

  /* ── 通用 ── */
  mats.white = std('primary-white', { color: P.white, roughness: 0.6, metalness: 0.1 });
  mats.gold = std('primary-gold', { color: P.gold, roughness: 0.3, metalness: 1.0 });
  mats.green = std('primary-green', { color: P.green, roughness: 0.5, metalness: 0.3 });
  mats.red = std('primary-red', { color: P.red, roughness: 0.5, metalness: 0.3 });
  mats.blue = std('primary-blue', { color: 0x3b82f6, roughness: 0.5, metalness: 0.3 });
  mats.black = std('primary-black', { color: 0x14161a, roughness: 0.7, metalness: 0.4 });

  // 备用材质（未知键）
  const fallback = std('_fallback', { color: 0x808a95, roughness: 0.6, metalness: 0.5 });

  /** 材质库全部条目（含备用） */
  const all = { ...mats, _fallback: fallback };

  const lib = {
    ...mats,
    /** 主色映射表，主题切换时用于还原 */
    _palette: PALETTE,
    /** 所有共享材质的数组视图 */
    _all: all,
    /** 安全取用 */
    _unused: fallback,
    /**
     * 语义化取用；未知键返回中性材质而不是 undefined。
     */
    get(key) {
      return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback;
    },
    /** 记录每个材质"基准自发光强度"，供 effects 的辉光涌动使用 */
    _baseEmissive: new Map(),
  };

  // 记录基准自发光强度
  for (const [k, m] of Object.entries(all)) {
    if (m && m.isMeshStandardMaterial) {
      lib._baseEmissive.set(k, m.emissiveIntensity);
    }
  }

  applyTheme('dark', lib);
  return lib;
}

/* ═══════════════ 主题 ═══════════════ */

const THEME_MAP = {
  dark: [
    ['steel', { color: 0x5c6673, roughness: 0.52, metalness: 0.92 }],
    ['steelDark', { color: 0x3d454f, roughness: 0.62, metalness: 0.88 }],
    ['darkAlloy', { color: 0x2b323c, roughness: 0.48, metalness: 0.95 }],
    ['paintedShell', { color: 0x4b5666, roughness: 0.68, metalness: 0.35 }],
    ['paintAccent', { color: 0x2f4f6b, roughness: 0.7, metalness: 0.3 }],
    ['titanium', { color: 0x9aa6b4, roughness: 0.36, metalness: 0.98 }],
    ['plateHeavy', { color: 0x5a636e, roughness: 0.58, metalness: 0.85 }],
    ['copper', { color: 0xb4703a, roughness: 0.34, metalness: 0.95 }],
    ['pipeInsulation', { color: 0x6b6257, roughness: 0.82, metalness: 0.15 }],
    ['fuelLine', { color: 0x8a5a2e, roughness: 0.45, metalness: 0.8, emissive: 0x2a0f00, emissiveIntensity: 0.35 }],
    ['insulationWrap', { color: 0x9a9384, roughness: 0.9, metalness: 0.05 }],
    ['plasma', { color: 0x35e6ff, emissive: 0x9ff6ff, emissiveIntensity: 3.4 }],
    ['plasmaCore', { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 4.2 }],
    ['tungsten', { color: 0x6d6259, roughness: 0.42, metalness: 0.9 }],
    ['tungstenHot', { color: 0x8a6a52, emissive: 0xffb066, emissiveIntensity: 1.6 }],
    ['coil', { color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 1.9 }],
    ['coilCryo', { color: 0x8fa3b8, roughness: 0.55, metalness: 0.7 }],
    ['superconductor', { color: 0x6f5bb5, emissive: 0x4c1d95, emissiveIntensity: 0.9 }],
    ['carbon', { color: 0x1d2126, roughness: 0.72, metalness: 0.28 }],
    ['carbonInner', { color: 0x111418, emissive: 0x220a00, emissiveIntensity: 0.5 }],
    ['aluminium', { color: 0xb7c0cb, roughness: 0.32, metalness: 0.82 }],
    ['actuator', { color: 0x8e1f1f, roughness: 0.42, metalness: 0.85 }],
    ['actuatorRod', { color: 0xd6dde6, roughness: 0.2, metalness: 1.0 }],
    ['refractory', { color: 0x4a4f57, roughness: 0.95, metalness: 0.05 }],
    ['coolant', { color: 0x2f8fd8, emissive: 0x0d2c44, emissiveIntensity: 0.7 }],
    ['finAlloy', { color: 0xd3dae2, roughness: 0.28, metalness: 0.78 }],
    ['glass', { color: 0x8fd8ff, emissive: 0x123a55, emissiveIntensity: 0.85, opacity: 0.3 }],
    ['darkGlass', { color: 0x14212c, emissive: 0x0a2233, emissiveIntensity: 0.6, opacity: 0.55 }],
    ['cable', { color: 0x24282e, roughness: 0.85, metalness: 0.2 }],
    ['cableTray', { color: 0x9aa3ad, roughness: 0.5, metalness: 0.85 }],
    ['circuit', { color: 0x1f3b2b, emissive: 0x0f8a5a, emissiveIntensity: 0.5 }],
    ['strip', { color: 0x35e6ff, emissive: 0x35e6ff, emissiveIntensity: 2.6 }],
    ['beacon', { color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 3.2 }],
    ['beaconGreen', { color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 2.4 }],
    ['statusLight', { color: 0xff9d2e, emissive: 0xff9d2e, emissiveIntensity: 2.2 }],
    ['warningYellow', { color: 0xf5c518, roughness: 0.62, metalness: 0.2 }],
    ['warningDark', { color: 0x1a1a1a, roughness: 0.7, metalness: 0.25 }],
    ['warningPaint', { color: 0xf5c518, roughness: 0.68, metalness: 0.1 }],
    ['signPanel', { color: 0xe8eef4, roughness: 0.5, metalness: 0.1 }],
    ['concrete', { color: 0x4a4f57, roughness: 0.95, metalness: 0.03 }],
    ['rebar', { color: 0x7a4a30, roughness: 0.85, metalness: 0.5 }],
    ['grating', { color: 0x8d949c, roughness: 0.55, metalness: 0.85 }],
    ['bolt', { color: 0x4a5058, roughness: 0.45, metalness: 0.95 }],
    ['white', { color: 0xdfe6ee, roughness: 0.6, metalness: 0.1 }],
    ['gold', { color: 0xc9a227, roughness: 0.3, metalness: 1.0 }],
    ['green', { color: 0x34d399, roughness: 0.5, metalness: 0.3 }],
    ['red', { color: 0xef4444, roughness: 0.5, metalness: 0.3 }],
    ['blue', { color: 0x3b82f6, roughness: 0.5, metalness: 0.3 }],
    ['black', { color: 0x14161a, roughness: 0.7, metalness: 0.4 }],
  ],
  // 浅色"白模"：近白哑光、低金属度、几乎无自发光。
  // 关键在于保留足够的层次差：主壳体最亮，内部/细节更暗，
  // 这样在白背景下依然能读出体块与凹槽（AO 感）。
  light: [
    ['steel', { color: 0x9aa6b5, roughness: 0.8, metalness: 0.06 }],
    ['steelDark', { color: 0x6f7a88, roughness: 0.84, metalness: 0.05 }],
    ['darkAlloy', { color: 0x5d6773, roughness: 0.82, metalness: 0.08 }],
    ['paintedShell', { color: 0xaab3bd, roughness: 0.86, metalness: 0.03 }],
    ['paintAccent', { color: 0x8e99a6, roughness: 0.87, metalness: 0.03 }],
    ['titanium', { color: 0xa8b2bd, roughness: 0.72, metalness: 0.12 }],
    ['plateHeavy', { color: 0x7d8794, roughness: 0.82, metalness: 0.06 }],
    ['copper', { color: 0xb98f66, roughness: 0.76, metalness: 0.16 }],
    ['pipeInsulation', { color: 0x958f83, roughness: 0.9, metalness: 0.02 }],
    ['fuelLine', { color: 0xb08f6c, roughness: 0.8, metalness: 0.1, emissive: 0x000000, emissiveIntensity: 0 }],
    ['insulationWrap', { color: 0xafa99d, roughness: 0.92, metalness: 0.02 }],
    ['plasma', { color: 0x6fb9d0, roughness: 0.5, metalness: 0.0, emissive: 0x4fa8c4, emissiveIntensity: 0.34 }],
    ['plasmaCore', { color: 0xcfe9f2, roughness: 0.45, metalness: 0.0, emissive: 0x7fc4dd, emissiveIntensity: 0.5 }],
    ['tungsten', { color: 0xb4aea6, roughness: 0.78, metalness: 0.12 }],
    ['tungstenHot', { color: 0xc9ac93, roughness: 0.78, metalness: 0.12, emissive: 0xd89868, emissiveIntensity: 0.18 }],
    ['coil', { color: 0xa892dd, roughness: 0.74, metalness: 0.1, emissive: 0x9d84d6, emissiveIntensity: 0.38 }],
    ['coilCryo', { color: 0x8b95a1, roughness: 0.82, metalness: 0.06 }],
    ['superconductor', { color: 0x9f92c9, roughness: 0.76, metalness: 0.1, emissive: 0xb0a2e0, emissiveIntensity: 0.16 }],
    ['carbon', { color: 0x6b7079, roughness: 0.88, metalness: 0.05 }],
    ['carbonInner', { color: 0x5a5f66, emissive: 0x000000, emissiveIntensity: 0.05 }],
    ['aluminium', { color: 0xb0b8c1, roughness: 0.66, metalness: 0.14 }],
    ['actuator', { color: 0xc08d8d, roughness: 0.8, metalness: 0.08 }],
    ['actuatorRod', { color: 0xbcc3cb, roughness: 0.55, metalness: 0.2 }],
    ['refractory', { color: 0x8f959c, roughness: 0.96, metalness: 0.02 }],
    ['coolant', { color: 0x8fb4d0, roughness: 0.74, metalness: 0.08, emissive: 0x8fb4d0, emissiveIntensity: 0.1 }],
    ['finAlloy', { color: 0xa6aeb7, roughness: 0.62, metalness: 0.15 }],
    ['glass', { color: 0xb4d3e4, roughness: 0.22, metalness: 0.12, emissive: 0x7d94a4, emissiveIntensity: 0.14, opacity: 0.34 }],
    ['darkGlass', { color: 0x93a2af, roughness: 0.3, metalness: 0.15, emissive: 0x8296a4, emissiveIntensity: 0.12, opacity: 0.46 }],
    ['cable', { color: 0x6e747c, roughness: 0.9, metalness: 0.03 }],
    ['cableTray', { color: 0x828a93, roughness: 0.78, metalness: 0.08 }],
    ['circuit', { color: 0x9cb2a6, roughness: 0.8, metalness: 0.06, emissive: 0x7db193, emissiveIntensity: 0.12 }],
    ['strip', { color: 0x9dbccd, roughness: 0.6, metalness: 0.05, emissive: 0x8fb4c8, emissiveIntensity: 0.3 }],
    ['beacon', { color: 0xd4645c, roughness: 0.6, metalness: 0.05, emissive: 0xd4645c, emissiveIntensity: 0.6 }],
    ['beaconGreen', { color: 0x7fc4a4, roughness: 0.6, metalness: 0.05, emissive: 0x7fc4a4, emissiveIntensity: 0.45 }],
    ['statusLight', { color: 0xd8a262, roughness: 0.6, metalness: 0.05, emissive: 0xd8a262, emissiveIntensity: 0.45 }],
    ['warningYellow', { color: 0xdcae00, roughness: 0.82, metalness: 0.05 }],
    ['warningDark', { color: 0x3b3b3b, roughness: 0.86, metalness: 0.05 }],
    ['warningPaint', { color: 0xdcae00, roughness: 0.84, metalness: 0.04 }],
    ['signPanel', { color: 0xb2bac3, roughness: 0.7, metalness: 0.03 }],
    ['concrete', { color: 0x9298a0, roughness: 0.97, metalness: 0.01 }],
    ['rebar', { color: 0xb08a70, roughness: 0.9, metalness: 0.05 }],
    ['grating', { color: 0x878f98, roughness: 0.84, metalness: 0.06 }],
    ['bolt', { color: 0x6a7078, roughness: 0.74, metalness: 0.2 }],
    ['white', { color: 0xc3cbd4, roughness: 0.82, metalness: 0.03 }],
    ['gold', { color: 0xa88f3f, roughness: 0.68, metalness: 0.18 }],
    ['green', { color: 0x8cc9ab, roughness: 0.8, metalness: 0.05 }],
    ['red', { color: 0xcf9494, roughness: 0.8, metalness: 0.05 }],
    ['blue', { color: 0x94add6, roughness: 0.8, metalness: 0.05 }],
    ['black', { color: 0x6e747b, roughness: 0.88, metalness: 0.03 }],
  ],
};

/**
 * 应用主题。就地修改共享材质的颜色/自发光，并记录基准强度供 effects 使用。
 * @param {'dark'|'light'} mode
 * @param {object} materials createMaterials() 的返回值
 */
export function applyTheme(mode, materials) {
  if (!materials) return;
  const key = mode === 'light' ? 'light' : 'dark';
  const entries = THEME_MAP[key];

  for (const [name, patch] of entries) {
    const m = materials[name];
    if (!m) continue;
    if (patch.color !== undefined && m.color) m.color.setHex(patch.color);
    if (patch.emissive !== undefined && m.emissive) m.emissive.setHex(patch.emissive);
    if (patch.emissiveIntensity !== undefined) m.emissiveIntensity = patch.emissiveIntensity;
    if (patch.roughness !== undefined) m.roughness = patch.roughness;
    if (patch.metalness !== undefined) m.metalness = patch.metalness;
    if (patch.opacity !== undefined) m.opacity = patch.opacity;
    m.needsUpdate = true;
  }

  // 备用材质跟随中性色
  if (materials._fallback) {
    materials._fallback.color.setHex(key === 'light' ? 0xccd2d9 : 0x808a95);
    materials._fallback.roughness = key === 'light' ? 0.8 : 0.6;
    materials._fallback.metalness = key === 'light' ? 0.06 : 0.5;
  }

  // 记录基准自发光强度（effects 的"涌动"以此为 1.0 基准）
  if (materials._baseEmissive && materials._all) {
    materials._baseEmissive.clear();
    for (const [k, m] of Object.entries(materials._all)) {
      if (m && m.isMeshStandardMaterial) materials._baseEmissive.set(k, m.emissiveIntensity);
    }
  }

  materials.theme = key;
  materials.sceneTheme = THEME_SCENE[key];
}

/** 便捷：按主题取场景背景/雾配置 */
export function getSceneTheme(mode) {
  return THEME_SCENE[mode === 'light' ? 'light' : 'dark'];
}

export default { createMaterials, applyTheme, PALETTE, THEME_SCENE, getSceneTheme };
