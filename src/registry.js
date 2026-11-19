/**
 * registry.js — 全局共享注册表 (SHARED CONTRACT — 只由 Lead 维护)
 *
 * 所有模块通过此文件交换数据，避免循环依赖。
 * 构建器把部件注册进来，UI/交互层从注册表读取。
 */

/** 单个部件的注册记录 */
export class PartRecord {
  constructor({
    id,
    label,
    labelEn = '',
    group,            // 逻辑分组 id，见 GROUP_DEFS
    object3D,         // THREE.Object3D —— 参与拆解的根节点
    explodeDir,       // THREE.Vector3 —— 拆解方向（世界坐标，归一化前）
    explodeDist = 0,  // 该部件的拆解距离
    order = 0,        // 拆解顺序（用于错峰动画）
    detail = {},      // { desc, specs: [{k,v}], fn, material, mass, ... }
    material = null,  // 用于高亮的主材质
    pickable = true,  // 是否可被 raycast 拾取
    explodeMode = 'linear', // 'linear' | 'radial' | 'rise' | 'static'
  }) {
    this.id = id;
    this.label = label;
    this.labelEn = labelEn;
    this.group = group;
    this.object3D = object3D;
    this.explodeDir = explodeDir;
    this.explodeDist = explodeDist;
    this.order = order;
    this.detail = detail;
    this.material = material;
    this.pickable = pickable;
    this.explodeMode = explodeMode;
  }
}

class Registry {
  constructor() {
    /** @type {Map<string, PartRecord>} */
    this.parts = new Map();
    /** @type {Map<THREE.Object3D, string>} 拾取用：mesh -> partId */
    this.meshToPart = new Map();
    /** 模型总高（世界单位），由 assembly 写入 */
    this.engineHeight = 0;
    this.engineRadius = 0;
    /** 共享材质库（由 assembly 写入，UI 主题切换用） */
    this.materials = null;

    /* ── 由 assembly.buildEngine 写入的机位/几何契约（供特效与 UI 层读取）── */
    this.legCount = 0;          // 主支撑腿数量（官方设定 7）
    this.throatY = 0;           // 喷管喉部高度
    this.nozzleTopY = 0;        // 喷口出口高度（= 模型最高处，排气朝上）
    this.nozzleExitR = 0;       // 喷口出口半径
    this.ignitionCoreY = 0;     // 点火核心高度
    this.damTopY = 0;           // 坝顶高度

    /** 高亮器（由 assembly 注入） */
    this.highlight = null;
    /** 悬停回调 (id|null) => void（由 assembly 注入） */
    this.setHover = null;
  }

  /**
   * 注册一个部件。obj 及其所有后代 mesh 都会映射到该部件（除非已被更细的部件占用）。
   */
  register(record) {
    if (this.parts.has(record.id)) {
      throw new Error(`[registry] duplicate part id: ${record.id}`);
    }
    this.parts.set(record.id, record);
    return record;
  }

  /**
   * 建立 mesh -> partId 映射。后注册的部件优先（更细粒度覆盖父级）。
   * 应在所有部件注册完成后调用。
   */
  buildPickMap() {
    this.meshToPart.clear();
    const all = [...this.parts.values()];
    for (const rec of all) {
      if (!rec.pickable || !rec.object3D) continue;
      rec.object3D.traverse((child) => {
        if (child.isMesh) this.meshToPart.set(child, rec.id);
      });
    }
    return this.meshToPart;
  }

  partOf(object3D) {
    let node = object3D;
    while (node) {
      const id = this.meshToPart.get(node);
      if (id) return this.parts.get(id);
      node = node.parent;
    }
    return null;
  }

  get(id) {
    return this.parts.get(id) || null;
  }

  list() {
    return [...this.parts.values()];
  }

  grouped() {
    const out = new Map();
    for (const rec of this.parts.values()) {
      if (!out.has(rec.group)) out.set(rec.group, []);
      out.get(rec.group).push(rec);
    }
    return out;
  }

  clear() {
    this.parts.clear();
    this.meshToPart.clear();
  }
}

export const registry = new Registry();

/** 部件分组定义（用于清单面板分区、颜色图例） */
export const GROUP_DEFS = [
  { id: 'base',        label: '基础与支撑',  labelEn: 'Foundation & Support', color: 0x6b7280, icon: '▦' },
  { id: 'structure',   label: '主体结构',    labelEn: 'Main Structure',       color: 0x9ca3af, icon: '▮' },
  { id: 'fuel',        label: '燃料注入系统', labelEn: 'Fuel Injection',       color: 0xf59e0b, icon: '⬡' },
  { id: 'reactor',     label: '聚变反应室',  labelEn: 'Fusion Chamber',       color: 0x22d3ee, icon: '◉' },
  { id: 'confinement', label: '磁约束系统',  labelEn: 'Magnetic Confinement', color: 0x8b5cf6, icon: '◎' },
  { id: 'nozzle',      label: '喷口与推进',  labelEn: 'Nozzle & Thrust',      color: 0xef4444, icon: '▼' },
  { id: 'cooling',     label: '冷却系统',    labelEn: 'Cooling System',       color: 0x38bdf8, icon: '≋' },
  { id: 'control',     label: '控制与电力',  labelEn: 'Control & Power',      color: 0x34d399, icon: '⚡' },
  { id: 'aux',         label: '辅助与检修',  labelEn: 'Auxiliary & Access',   color: 0xa3a3a3, icon: '⚙' },
];

export const GROUP_BY_ID = new Map(GROUP_DEFS.map((g) => [g.id, g]));
