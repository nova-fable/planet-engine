/**
 * effects.js — 点火 / 发射 特效系统
 *
 * 组成：
 *   · 等离子喷流（分层锥体 + 加色混合 + 自定义 ShaderMaterial 湍流）
 *   · 冲击波环（多个扩散环，advective ring）
 *   · 火花粒子（Points + 程序化径向渐变 CanvasTexture）
 *   · 地面辉光贴片（加色网格）
 *   · 屏幕震动（偏移相机，结束后精确还原）
 *   · 整机自发光涌动（同步点亮反应室 / 线圈 / 喷管）
 *
 * 无 WebGL / 无 document 环境下所有构建函数安全降级：
 * 仍然推进时间轴、仍然回调 onStep，只是不产生可见对象。
 */

import * as THREE from '../vendor/three.module.js';
import { SEQUENCE } from './data/parts.js';
import { easeOutCubic, easeInOutCubic } from './animation.js';

/* ═══════════════ 调色板 ═══════════════ */

const FX_PALETTE = {
  dark: {
    plasmaCore: 0xffffff,
    plasmaMid: 0x66e8ff,
    plasmaOuter: 0x1e6fff,
    plasmaOpacity: 0.85,
    shockwave: 0x9fe8ff,
    spark: 0xfff0c0,
    sparkHot: 0xff9a3c,
    glow: 0x3fd0ff,
    glowOpacity: 0.5,
    surge: 2.6,
    shakeScale: 1.0,
  },
  light: {
    plasmaCore: 0xffffff,
    plasmaMid: 0xbfe9f5,
    plasmaOuter: 0x7fb8dd,
    plasmaOpacity: 0.4,
    shockwave: 0xa8cee0,
    spark: 0xd8c9a0,
    sparkHot: 0xd89a60,
    glow: 0x9fd0e8,
    glowOpacity: 0.22,
    surge: 0.7,
    shakeScale: 0.35,
  },
};

/* ═══════════════ 工具 ═══════════════ */

/** 程序化径向渐变精灵贴图（无 document 返回 null） */
function makeSparkTexture(size = 64) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,200,0.85)');
  g.addColorStop(0.6, 'rgba(255,160,60,0.35)');
  g.addColorStop(1.0, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 程序化柔和圆盘（地面辉光） */
function makeGlowTexture(size = 128) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(160,225,255,0.5)');
  g.addColorStop(1, 'rgba(80,150,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = THREE.MathUtils.lerp;

/* ═══════════════ 特效系统 ═══════════════ */

export class EffectsSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./registry.js').registry} registry
   */
  constructor(scene, registry) {
    this.scene = scene;
    this.registry = registry;

    /** 特效根组 */
    this.group = new THREE.Group();
    this.group.name = 'fx';
    this.group.visible = false;
    this.group.frustumCulled = false;
    scene?.add(this.group);

    this.theme = 'dark';
    this.palette = FX_PALETTE.dark;

    /** 运行状态 */
    this.running = false;
    this.kind = null;
    this.elapsedMs = 0;
    this._stepIndex = -1;
    /** 在途 runSequence 的 resolver 集合（保证 await 必定 settle） */
    this._pendingSeq = new Set();
    this._aborted = false;

    /** 相机震动状态 */
    this._shakeState = { amp: 0, freq: 1, t: 0, active: false };
    this._savedCamPos = new THREE.Vector3();
    this._camSaved = false;

    /** 自发光涌动备份 */
    this._surgeBackup = new Map();
    this._surgeActive = false;

    /** 各处强度（0..1），每帧平滑趋近目标 */
    this.level = {
      plasma: 0, shock: 0, spark: 0, ground: 0, surge: 0, shake: 0,
    };
    this.target = { ...this.level };

    // 几何基准（由 registry / 装配尺寸推断）
    // 官方修正：喷口朝上、位于云层之上 —— 射流自塔顶垂直向上排出。
    const H = registry?.engineHeight || 11000;
    this.H = H;
    this.nozzleExitR = registry?.nozzleExitR || 390;
    this.throatY = registry?.throatY ?? 10560;       // 喷管喉部（塔顶）
    this.nozzleTopY = registry?.nozzleTopY ?? 11000; // 喷口出口（模型最高处）
    this.ignitionCoreY = registry?.ignitionCoreY ?? 7100;

    this._build();
  }

  /* ─────────── 构建 ─────────── */

  _build() {
    const H = this.H;

    /* 1. 等离子喷流：多层加色锥体 */
    /* 1. 等离子喷流：多层加色锥体 —— 自塔顶喷口垂直向上排出（+Y） */
    this.plasmaGroup = new THREE.Group();
    this.plasmaGroup.name = 'plasma-column';
    this.group.add(this.plasmaGroup);

    // 射流起点 = 喷口出口（塔顶）
    const exitY = this.nozzleTopY;
    this.exitY = exitY;

    this.plasmaMaterials = [];
    const layers = [
      { r0: 300, r1: 900, len: H * 0.30, color: this.palette.plasmaOuter, opacity: 0.30, seg: 28 },
      { r0: 210, r1: 620, len: H * 0.24, color: this.palette.plasmaMid, opacity: 0.42, seg: 24 },
      { r0: 120, r1: 330, len: H * 0.18, color: this.palette.plasmaMid, opacity: 0.60, seg: 20 },
      { r0: 55, r1: 140, len: H * 0.13, color: this.palette.plasmaCore, opacity: 0.80, seg: 16 },
    ];
    this.plasmaCones = [];
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      // CylinderGeometry(radiusTop, radiusBottom, ...)：
      // 底部窄（= 喷口）、顶部宽（= 射流扩散），整体向上扩张。
      const geo = new THREE.CylinderGeometry(L.r1, L.r0, L.len, L.seg, 3, true);
      geo.translate(0, L.len / 2, 0);            // 锥底落在 y=0，向上生长
      const mat = new THREE.MeshBasicMaterial({
        color: L.color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
        name: `plasma-layer-${i}`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = exitY;                       // 自喷口向上
      m.frustumCulled = false;
      m.renderOrder = 10 + i;
      this.plasmaGroup.add(m);
      this.plasmaCones.push(m);
      this.plasmaMaterials.push(mat);
    }

    // 喷口内的炽热核心（喉部，位于喷口出口之下）
    const coreGeo = new THREE.CylinderGeometry(150, 150, 260, 20, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
      color: this.palette.plasmaCore, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthWrite: false, toneMapped: false,
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.coreMesh.position.y = this.throatY;
    this.coreMesh.frustumCulled = false;
    this.coreMesh.renderOrder = 14;
    this.plasmaGroup.add(this.coreMesh);
    this.plasmaMaterials.push(coreMat);

    /* 2. 冲击波环：自喷口向上传播的环面（垂直于 +Y 的环，沿 Y 上升）*/
    this.shockGroup = new THREE.Group();
    this.shockGroup.name = 'shockwaves';
    this.group.add(this.shockGroup);
    this.shockRings = [];
    for (let i = 0; i < 5; i++) {
      const geo = new THREE.RingGeometry(0.86, 1.0, 48, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: this.palette.shockwave, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        depthWrite: false, toneMapped: false, name: `shock-${i}`,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = exitY;
      m.frustumCulled = false;
      m.renderOrder = 8;
      this.shockGroup.add(m);
      this.shockRings.push({ mesh: m, mat, phase: i * 0.14, speed: 0.85 + i * 0.14 });
    }

    /* 3. 火花粒子 */
    const SPARKS = 900;
    this.sparkCount = SPARKS;
    const positions = new Float32Array(SPARKS * 3);
    const velocities = new Float32Array(SPARKS * 3);
    const seeds = new Float32Array(SPARKS);
    for (let i = 0; i < SPARKS; i++) {
      seeds[i] = Math.random();
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const sprite = makeSparkTexture(64);
    const pmat = new THREE.PointsMaterial({
      color: this.palette.spark,
      size: H * 0.016,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      map: sprite || null,
      alphaTest: sprite ? 0.01 : 0,
      name: 'sparks',
    });
    this.sparks = new THREE.Points(pgeo, pmat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 12;
    this.group.add(this.sparks);
    this._sparkVel = velocities;
    this._sparkSeeds = seeds;
    this._sparkBase = positions;
    this._sparkT = new Float32Array(SPARKS);
    for (let i = 0; i < SPARKS; i++) this._sparkT[i] = Math.random();

    /* 4. 坝顶照明（原"地面辉光"）—— 喷口朝上后，地面不再是射流落点；
     *    这里的贴片改为坝体顶面的泛光照明，用于表现坝体在点火时的冷光。 */
    const glowTex = makeGlowTexture(128);
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: this.palette.glow, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthWrite: false, toneMapped: false,
      map: glowTex || null, name: 'dam-glow',
    });
    this.damGlow = new THREE.Mesh(glowGeo, glowMat);
    // 坝顶高度（baseY1 = 400）——坝顶泛光
    this.damGlow.position.y = this.registry?.damTopY ?? 404;
    this.damGlow.scale.set(H * 0.62, 1, H * 0.62);
    this.damGlow.frustumCulled = false;
    this.damGlow.renderOrder = 6;
    this.group.add(this.damGlow);
    // 兼容旧字段名（外部可能引用 groundGlow）
    this.groundGlow = this.damGlow;

    /* 5. 喷口阵列外缘的屏障壁泛光（原"导流槽射流偏转光锥"）——
     *    喷口朝上后不存在横向导流，改为环绕喷口的竖直光幕。 */
    const deflGeo = new THREE.CylinderGeometry(this.nozzleExitR * 1.9, this.nozzleExitR * 1.35, H * 0.10, 28, 1, true);
    deflGeo.translate(0, H * 0.05, 0);
    const deflMat = new THREE.MeshBasicMaterial({
      color: this.palette.plasmaOuter, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthWrite: false, toneMapped: false, name: 'barrier-glow',
    });
    this.deflectors = [];
    {
      const m = new THREE.Mesh(deflGeo, deflMat);
      m.position.y = exitY - H * 0.055;
      m.frustumCulled = false;
      m.renderOrder = 9;
      this.group.add(m);
      this.deflectors.push(m);
    }

    this.group.visible = false;
  }

  /* ─────────── 主题 ─────────── */

  setTheme(mode) {
    const key = mode === 'light' ? 'light' : 'dark';
    this.theme = key;
    this.palette = FX_PALETTE[key];
    const P = this.palette;

    // 等离子层重新着色
    const layerColors = [P.plasmaOuter, P.plasmaMid, P.plasmaMid, P.plasmaCore];
    this.plasmaCones?.forEach((m, i) => {
      m.material.color.setHex(layerColors[Math.min(i, layerColors.length - 1)]);
    });
    this.plasmaMaterials?.forEach((m, i) => {
      if (i < layerColors.length) m.color.setHex(layerColors[i]);
      else m.color.setHex(P.plasmaCore);
    });
    if (this.coreMesh) this.coreMesh.material.color.setHex(P.plasmaCore);

    for (const r of this.shockRings || []) r.mat.color.setHex(P.shockwave);
    if (this.sparks) this.sparks.material.color.setHex(P.spark);
    if (this.groundGlow) this.groundGlow.material.color.setHex(P.glow);
    for (const d of this.deflectors || []) d.material.color.setHex(P.plasmaOuter);
  }

  /* ─────────── 序列 ─────────── */

  /**
   * 播放一段序列（可 await）。
   *
   * 关于 Promise 必定 settle 的保证：
   *   `_resolveSeq` 曾经是"单个槽位"，一旦在序列进行中再次调用 runSequence，
   *   新的 resolver 会覆盖旧的，旧 promise 永远不 settle，Node 报
   *   "Detected unsettled top-level await"。现在改为 `_pendingSeq` 集合：
   *   · runSequence 在开始新序列前先 settle 所有在途 promise；
   *   · stop() / _finish() 调用 _settleSeq()，必定清空集合并 resolve 全部。
   *   因此任何路径下 await 都能返回。
   *
   * @param {'ignition'|'launch'} kind
   * @param {(text:string, pct:number)=>void} [onStep]
   */
  async runSequence(kind, onStep) {
    const seq = SEQUENCE[kind] || SEQUENCE.ignition;
    // stop() 会 settle 所有在途 promise（包括尚未被 await 的那个）
    this.stop();

    this.running = true;
    this.kind = kind;
    this.elapsedMs = 0;
    this._stepIndex = -1;
    this._aborted = false;
    this.group.visible = true;

    const steps = seq.steps;
    const total = steps.length ? steps[steps.length - 1].t : 0;
    const TAIL = 1400; // 收尾时间
    this._totalMs = total + TAIL;

    return new Promise((resolve) => {
      this._pendingSeq.add(resolve);
      this._onStep = onStep;
      // 立即报告第 0 步
      this._emitStep(steps[0], 0, onStep);
    });
  }

  /**
   * 结算所有在途的 runSequence promise（幂等）。
   * stop() 与 _finish() 都通过它保证 await 一定返回。
   */
  _settleSeq() {
    const pending = this._pendingSeq;
    if (!pending || pending.size === 0) {
      this._onStep = null;
      return;
    }
    const resolvers = [...pending];
    pending.clear();
    this._onStep = null;
    for (const resolve of resolvers) {
      try { resolve(); } catch (err) { /* resolver 异常不得影响其余结算 */ }
    }
  }

  _emitStep(step, idx, onStep) {
    this._stepIndex = idx;
    if (!step) return;
    const steps = (SEQUENCE[this.kind] || SEQUENCE.ignition).steps;
    const total = steps.length ? steps[steps.length - 1].t : 1;
    const pct = total > 0 ? clamp01(step.t / total) : 0;
    const cb = onStep || this._onStep;
    try { cb?.(step.text, pct); } catch (err) { /* UI 回调异常不应中断序列 */ }
    // 依据事件名设置阶段目标
    this._applyEvent(step.event, pct);
  }

  /** 事件 → 各特效通道的目标强度 */
  _applyEvent(event, pct) {
    const T = this.target;
    switch (event) {
      case 'check':      T.plasma = 0.0; T.shock = 0; T.spark = 0.05; T.ground = 0.05; T.surge = 0.10; T.shake = 0.02; break;
      case 'pumps':      T.plasma = 0.10; T.shock = 0; T.spark = 0.15; T.ground = 0.10; T.surge = 0.20; T.shake = 0.05; break;
      case 'trench':     T.plasma = 0.10; T.shock = 0; T.spark = 0.25; T.ground = 0.30; T.surge = 0.24; T.shake = 0.06; break;
      case 'dam':        T.plasma = 0.12; T.shock = 0; T.spark = 0.30; T.ground = 0.38; T.surge = 0.30; T.shake = 0.07; break;
      case 'coils':      T.plasma = 0.18; T.shock = 0.12; T.spark = 0.30; T.ground = 0.34; T.surge = 0.55; T.shake = 0.10; break;
      case 'inject':     T.plasma = 0.34; T.shock = 0.24; T.spark = 0.45; T.ground = 0.45; T.surge = 0.68; T.shake = 0.18; break;
      case 'preignite':  T.plasma = 0.42; T.shock = 0.32; T.spark = 0.55; T.ground = 0.55; T.surge = 0.75; T.shake = 0.28; break;
      // 点火瞬间：所有通道拉满
      case 'ignite':     T.plasma = 0.95; T.shock = 0.85; T.spark = 0.90; T.ground = 0.90; T.surge = 1.00; T.shake = 0.75; break;
      // 稳定燃烧：等离子维持高位，冲击波略回落
      case 'burn':       T.plasma = 0.98; T.shock = 0.70; T.spark = 0.95; T.ground = 0.92; T.surge = 1.00; T.shake = 0.85; break;
      case 'nozzle':     T.plasma = 1.00; T.shock = 1.00; T.spark = 1.00; T.ground = 0.95; T.surge = 1.00; T.shake = 1.00; break;
      case 'vector':     T.plasma = 1.00; T.shock = 0.90; T.spark = 0.95; T.ground = 1.00; T.surge = 1.00; T.shake = 0.90; break;
      case 'stable':     T.plasma = 0.86; T.shock = 0.45; T.spark = 0.70; T.ground = 0.86; T.surge = 0.92; T.shake = 0.42; break;
      case 'full':       T.plasma = 1.00; T.shock = 0.60; T.spark = 0.92; T.ground = 1.00; T.surge = 1.00; T.shake = 0.70; break;
      default: break;
    }
  }

  /* ─────────── 每帧 ─────────── */

  /**
   * @param {number} dt 秒
   * @param {THREE.Camera} [camera]
   */
  update(dt, camera) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.05);

    // 推进序列时钟
    if (this.running) {
      this.elapsedMs += step * 1000;
      const steps = (SEQUENCE[this.kind] || SEQUENCE.ignition).steps;
      while (
        this._stepIndex + 1 < steps.length &&
        this.elapsedMs >= steps[this._stepIndex + 1].t
      ) {
        this._stepIndex += 1;
        const s = steps[this._stepIndex];
        const total = steps.length ? steps[steps.length - 1].t : 1;
        const pct = total > 0 ? clamp01(s.t / total) : 0;
        try { this._onStep?.(s.text, pct); } catch (err) { /* ignore */ }
        this._applyEvent(s.event, pct);
      }
      if (this.elapsedMs >= this._totalMs) {
        this.running = false;
      }
    }

    // 强度平滑趋近
    const k = this.running ? 3.2 * step : 2.2 * step;
    for (const key of Object.keys(this.level)) {
      const tgt = this.running ? this.target[key] : 0;
      this.level[key] += (tgt - this.level[key]) * Math.min(1, k * (key === 'surge' ? 2.4 : 1.6));
      if (this.level[key] < 1e-4) this.level[key] = 0;
    }

    const L = this.level;
    const P = this.palette;

    // 等离子
    this.plasmaGroup.visible = L.plasma > 0.002;
    if (this.plasmaGroup.visible) {
      const t = this.elapsedMs * 0.001;
      this.plasmaCones.forEach((m, i) => {
        const flick = 0.82 + 0.18 * Math.sin(t * (5.5 + i * 1.7) + i * 1.3);
        const base = [0.30, 0.42, 0.60, 0.80][i] ?? 0.5;
        m.material.opacity = clamp01(base * L.plasma * flick * (this.theme === 'light' ? 0.55 : 1));
        const s = 0.94 + 0.10 * Math.sin(t * (3.2 + i) + i);
        m.scale.set(s, 0.55 + 0.75 * L.plasma, s);
      });
      if (this.coreMesh) {
        this.coreMesh.material.opacity = clamp01(0.9 * L.plasma * (this.theme === 'light' ? 0.45 : 1));
        this.coreMesh.scale.setScalar(0.85 + 0.3 * Math.sin(this.elapsedMs * 0.008));
      }
      for (const d of this.deflectors) {
        d.material.opacity = clamp01(0.34 * L.plasma * (this.theme === 'light' ? 0.4 : 1));
        d.scale.setScalar(0.8 + 0.4 * L.plasma);
      }
    }

    // 冲击波环：自喷口向上传播（环沿 +Y 升起并扩散）
    const shockOn = L.shock > 0.002;
    this.shockGroup.visible = shockOn;
    if (shockOn) {
      const t = this.elapsedMs * 0.001;
      for (const r of this.shockRings) {
        const cyc = ((t * r.speed * 0.55 + r.phase) % 1 + 1) % 1;
        const scale = lerp(this.H * 0.06, this.H * 0.85, easeOutCubic(cyc));
        r.mesh.scale.set(scale, 1, scale);
        // 沿喷流方向上升：自喷口向上 H*0.55 的范围内循环
        r.mesh.position.y = this.exitY + cyc * this.H * 0.55;
        r.mat.opacity = clamp01((1 - cyc) * 0.55 * L.shock * (this.theme === 'light' ? 0.5 : 1));
      }
    }

    // 火花
    const sparkOn = L.spark > 0.002;
    this.sparks.visible = sparkOn;
    if (sparkOn) {
      this._updateSparks(step, L.spark);
      this.sparks.material.opacity = clamp01(0.95 * L.spark * (this.theme === 'light' ? 0.45 : 1));
    }

    // 坝顶泛光（原"地面辉光"）
    const glowOn = L.ground > 0.002;
    this.damGlow.visible = glowOn;
    if (glowOn) {
      const pulse = 0.85 + 0.15 * Math.sin(this.elapsedMs * 0.004);
      this.damGlow.material.opacity = clamp01(P.glowOpacity * L.ground * pulse);
      const s = this.H * (0.55 + 0.12 * L.ground);
      this.damGlow.scale.set(s, 1, s);
    }

    // 整机自发光涌动
    this._applySurge(L.surge * P.surge);

    // 屏幕震动
    if (camera) {
      this._camera = camera;
      this._applyShake(camera, step, L.shake * P.shakeScale);
    }

    // 序列结束 → 收尾
    if (!this.running && this.group.visible && this._allQuiet()) {
      this.group.visible = false;
      this._finish();
    }
  }

  _allQuiet() {
    const L = this.level;
    return L.plasma < 0.004 && L.shock < 0.004 && L.spark < 0.004 && L.ground < 0.004 && L.surge < 0.004;
  }

  _updateSparks(dt, intensity) {
    const n = this.sparkCount;
    const pos = this._sparkBase;
    const vel = this._sparkVel;
    const seeds = this._sparkSeeds;
    const life = this._sparkT;
    const H = this.H;
    const exitY = this.exitY;                 // 喷口出口（塔顶）
    const exitR = this.nozzleExitR;
    const speed = H * 0.9;
    const gravity = H * 0.55;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      life[i] += dt * (0.42 + seeds[i] * 0.75);
      if (life[i] >= 1) {
        // 重生：自塔顶喷口边缘向上抛射（喷口朝上，射流朝 +Y）
        life[i] -= 1;
        const a = Math.random() * Math.PI * 2;
        const rr = exitR * (0.5 + Math.random() * 0.75);
        if (Math.random() < 0.65) {
          // 主射流：自喷口向上高速喷出
          pos[i3] = Math.cos(a) * rr;
          pos[i3 + 1] = exitY + Math.random() * 120;
          pos[i3 + 2] = Math.sin(a) * rr;
          vel[i3] = Math.cos(a) * speed * (0.18 + Math.random() * 0.45);
          vel[i3 + 1] = speed * (0.75 + Math.random() * 0.9);      // 向上
          vel[i3 + 2] = Math.sin(a) * speed * (0.18 + Math.random() * 0.45);
        } else {
          // 喷口外缘的翻卷火花（沿屏障壁向外翻，仍整体向上）
          const sgn = Math.random() < 0.5 ? -1 : 1;
          const rb = exitR * (1.6 + Math.random() * 0.9);
          pos[i3] = Math.cos(a) * rb;
          pos[i3 + 1] = exitY - H * 0.01 + Math.random() * 120;
          pos[i3 + 2] = Math.sin(a) * rb;
          vel[i3] = Math.cos(a) * speed * (0.45 + Math.random() * 0.7);
          vel[i3 + 1] = speed * (0.35 + Math.random() * 0.55);      // 仍向上
          vel[i3 + 2] = Math.sin(a) * speed * (0.45 + Math.random() * 0.7);
          void sgn;
        }
      } else {
        vel[i3 + 1] -= gravity * dt;        // 随上升逐渐减速（重力仍向下）
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
      }
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    const s = H * 0.016 * (0.6 + 0.7 * intensity);
    this.sparks.material.size = s;
  }

  /* ─────────── 整机自发光涌动 ─────────── */

  _surgeTargets() {
    const ids = ['ignition-core', 'reactor-vessel', 'reactor-liner', 'magnetic-coil', 'coil-cryo',
      'nozzle-throat', 'nozzle-bell', 'fuel-injector', 'fuel-main-pipe'];
    const out = [];
    for (const id of ids) {
      const rec = this.registry?.get?.(id);
      if (!rec?.object3D) continue;
      rec.object3D.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m?.isMeshStandardMaterial) out.push(m);
      });
    }
    return out;
  }

  _applySurge(amount) {
    const mats = this._surgeCache || (this._surgeCache = this._surgeTargets());

    if (!this._surgeActive && amount > 0.002) {
      // 首次进入：记录基准强度
      this._surgeBackup.clear();
      for (const m of mats) this._surgeBackup.set(m, m.emissiveIntensity ?? 1);
      this._surgeActive = true;
    }

    if (!this._surgeActive) return;

    const flick = 0.88 + 0.12 * Math.sin(this.elapsedMs * 0.011);
    for (const m of mats) {
      const base = this._surgeBackup.get(m) ?? 1;
      m.emissiveIntensity = (base + amount * 2.2) * flick;
    }

    if (amount <= 0.002 && this._surgeActive) {
      for (const m of mats) m.emissiveIntensity = this._surgeBackup.get(m) ?? 1;
      this._surgeActive = false;
      this._surgeBackup.clear();
    }
  }

  /* ─────────── 相机震动 ─────────── */

  _applyShake(camera, dt, amount) {
    const s = this._shakeState;
    // 还原上一帧的偏移
    if (s.active && this._camSaved) {
      camera.position.copy(this._savedCamPos);
      s.active = false;
    }

    if (amount <= 0.003) return;

    const H = this.H;
    this._savedCamPos.copy(camera.position);
    this._camSaved = true;
    s.t += dt;
    const f = s.t * 22;
    const amp = amount * H * 0.0042;
    camera.position.x += Math.sin(f * 1.0) * amp;
    camera.position.y += Math.sin(f * 1.37 + 0.7) * amp * 0.85;
    camera.position.z += Math.sin(f * 0.83 + 2.1) * amp;
    s.active = true;
  }

  /** 立刻还原相机（stop 时调用） */
  _restoreCamera() {
    if (this._shakeState.active && this._camSaved && this._camera) {
      this._camera.position.copy(this._savedCamPos);
    }
    this._shakeState.active = false;
    this._camSaved = false;
  }

  /* ─────────── 停止 / 复位 ─────────── */

  /** 干净地中止并复位所有特效 */
  stop() {
    this._aborted = true;
    this.running = false;
    this.elapsedMs = 0;
    this._stepIndex = -1;
    this.target = { plasma: 0, shock: 0, spark: 0, ground: 0, surge: 0, shake: 0 };
    this.level = { plasma: 0, shock: 0, spark: 0, ground: 0, surge: 0, shake: 0 };

    this.group.visible = false;
    this.plasmaGroup.visible = false;
    this.shockGroup.visible = false;
    this.sparks.visible = false;
    this.damGlow.visible = false;
    for (const m of this.plasmaMaterials || []) m.opacity = 0;
    for (const r of this.shockRings || []) r.mat.opacity = 0;
    for (const d of this.deflectors || []) d.material.opacity = 0;
    if (this.sparks) this.sparks.material.opacity = 0;
    if (this.damGlow) this.damGlow.material.opacity = 0;

    // 还原自发光
    if (this._surgeActive) {
      const mats = this._surgeCache || [];
      for (const m of mats) m.emissiveIntensity = this._surgeBackup.get(m) ?? 1;
      this._surgeActive = false;
      this._surgeBackup.clear();
    }

    this._restoreCamera();

    // 解开 await（必定 settle，包括被新序列抢占的旧 promise）
    this._settleSeq();
  }

  /** 序列自然结束的收尾（必定 settle 在途 await） */
  _finish() {
    this._restoreCamera();
    this.target = { plasma: 0, shock: 0, spark: 0, ground: 0, surge: 0, shake: 0 };
    if (this._surgeActive) {
      const mats = this._surgeCache || [];
      for (const m of mats) m.emissiveIntensity = this._surgeBackup.get(m) ?? 1;
      this._surgeActive = false;
      this._surgeBackup.clear();
    }
    this._settleSeq();
  }

  /** 记录相机引用（update 传入，stop 时可还原） */
  bindCamera(camera) {
    this._camera = camera;
  }

  dispose() {
    this.stop();
    this.scene?.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m?.map?.dispose?.(); m?.dispose?.(); }
    });
  }
}

export default { EffectsSystem, FX_PALETTE };
