/**
 * animation.js — 拆解（exploded view）动画控制器
 *
 * 设计要点：
 *   · 构造时缓存每个部件的基准位置（basePosition），之后只做 position 的插值
 *   · 按 part.order 错峰（stagger），easeInOutCubic 缓动
 *   · 完全可逆：setExploded(true/false) 可在飞行途中打断并反向
 *   · explodeMode：
 *       'linear'  → basePosition + dir.normalize() * dist
 *       'radial'  → 由装配轴（Y 轴）出发的径向方向，绕轴均匀外扩
 *       'rise'    → 主要沿 +Y 抬升（壳体分段）
 *       'static'  → 不动（地面设施）
 */

import * as THREE from '../vendor/three.module.js';

/** easeInOutCubic */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** easeOutCubic（用于灯光/强度曲线） */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** 错峰窗口：整个拆解序列占用的"归一化时间跨度" */
const STAGGER_SPAN = 0.62;
/** 单个部件的补间时长（归一化） */
const TWEEN_LEN = 0.38;

export class ExplodeController {
  /**
   * @param {import('./registry.js').registry} registry
   */
  constructor(registry) {
    this.registry = registry;
    /** 总进度 0..1 */
    this._progress = 0;
    /** 目标：0 = 装配态，1 = 拆解态 */
    this._target = 0;
    /** 每帧推进速度（1 / 秒） */
    this.speed = 0.85;
    /** 是否处于拆解态（目标态） */
    this.exploded = false;
    /** 每个部件的动画状态 */
    this.tracks = [];
    this._built = false;
    this._dirty = true;

    this._axis = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this._radial = new THREE.Vector3();

    /** 可选的每帧回调 (progress) => void */
    this.onUpdate = null;

    this.build();
  }

  /** 缓存基准位置与拆解向量（幂等，可重复调用以纳入后注册的部件） */
  build() {
    const list = this.registry.list();
    this.tracks = list.map((rec) => {
      const obj = rec.object3D;
      const base = obj ? obj.position.clone() : new THREE.Vector3();
      const dir = this.resolveDirection(rec, base);
      const dist = rec.explodeDist ?? 0;
      const offset = dir.clone().multiplyScalar(dist);
      return {
        rec,
        obj,
        base,
        offset,
        order: rec.explodeOrder ?? rec.order ?? 0,
        // 归一化时间窗口
        t0: 0,
        t1: 1,
      };
    });

    // 依据 order 计算错峰窗口
    if (this.tracks.length) {
      const orders = this.tracks.map((t) => t.order);
      const minO = Math.min(...orders);
      const maxO = Math.max(...orders);
      const span = Math.max(1e-6, maxO - minO);
      for (const t of this.tracks) {
        const u = (t.order - minO) / span;   // 0..1
        t.t0 = u * STAGGER_SPAN;
        t.t1 = Math.min(1, t.t0 + TWEEN_LEN);
      }
    }

    this._built = true;
    this._apply(this._progress);
    return this;
  }

  /**
   * 计算某部件的拆解方向（未乘距离）。
   * 'radial' 时方向由装配轴指向该部件（水平径向分量为准）。
   */
  resolveDirection(rec, basePos) {
    const mode = rec.explodeMode || 'linear';
    const raw = rec.explodeDir;

    if (mode === 'static') return new THREE.Vector3(0, 0, 0);

    if (mode === 'radial') {
      // 由 Y 轴出发的径向：取部件基准位置的水平分量
      const rx = basePos.x;
      const rz = basePos.z;
      const len = Math.hypot(rx, rz);
      if (len < 1e-6) {
        // 正好在轴上 —— 退化为给定方向的水平分量，再退化为 +X
        if (raw && Math.hypot(raw.x, raw.z) > 1e-6) {
          return new THREE.Vector3(raw.x, raw.y || 0, raw.z).normalize();
        }
        return new THREE.Vector3(1, 0, 0);
      }
      const vertical = raw ? (raw.y || 0) : 0;
      const d = new THREE.Vector3(rx / len, vertical, rz / len);
      return d.normalize();
    }

    if (mode === 'rise') {
      if (raw && raw.lengthSq() > 1e-9) {
        // 保证抬升分量占主导
        const d = raw.clone();
        d.y = Math.abs(d.y) + 0.35;
        return d.normalize();
      }
      return new THREE.Vector3(0, 1, 0);
    }

    // linear
    if (raw && raw.lengthSq() > 1e-9) return raw.clone().normalize();
    return new THREE.Vector3(0, 1, 0);
  }

  /** 当前进度 0..1（0 = 完全装配，1 = 完全拆解） */
  get progress() {
    return this._progress;
  }

  /** 是否已经到达目标态 */
  get settled() {
    return Math.abs(this._progress - this._target) < 1e-4;
  }

  /**
   * 设置目标态。
   * @param {boolean} on
   * @param {object} [opts] { immediate: boolean }
   */
  setExploded(on, opts = {}) {
    this.exploded = !!on;
    this._target = on ? 1 : 0;
    if (opts.immediate) {
      this._progress = this._target;
      this._apply(this._progress);
    }
    return this;
  }

  /** 立即复位（不带动画） */
  reset() {
    this.setExploded(false, { immediate: true });
    return this;
  }

  /**
   * 每帧推进。
   * @param {number} dt 秒
   */
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!this._built) this.build();

    const d = Math.min(dt, 0.1);
    const prev = this._progress;
    const delta = this._target - this._progress;
    if (Math.abs(delta) < 1e-5) {
      this._progress = this._target;
    } else {
      const step = Math.sign(delta) * this.speed * d;
      this._progress = Math.abs(step) >= Math.abs(delta) ? this._target : this._progress + step;
    }

    if (this._progress !== prev) {
      this._apply(this._progress);
      this.onUpdate?.(this._progress);
    }
  }

  /** 把进度映射到每个部件的局部 t，并写入位置 */
  _apply(p) {
    const clamped = Math.min(1, Math.max(0, p));
    for (const tr of this.tracks) {
      const { obj, base, offset, t0, t1 } = tr;
      if (!obj) continue;
      let local;
      if (t1 <= t0) local = clamped;
      else local = (clamped - t0) / (t1 - t0);
      local = Math.min(1, Math.max(0, local));
      const e = easeInOutCubic(local);
      obj.position.set(
        base.x + offset.x * e,
        base.y + offset.y * e,
        base.z + offset.z * e,
      );
    }
  }

  /** 某个部件当前的拆解位移量（供 UI 显示） */
  offsetOf(id) {
    const tr = this.tracks.find((t) => t.rec.id === id);
    return tr ? tr.offset.clone() : new THREE.Vector3();
  }

  dispose() {
    this.tracks = [];
    this._built = false;
  }
}

export default { ExplodeController, easeInOutCubic, easeOutCubic };
