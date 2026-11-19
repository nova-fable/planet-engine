/**
 * ui/panels.js — UI 面板层
 *
 * 职责（严格限定）：
 *   · 部件清单（分组 / 筛选 / 搜索 / 折叠 / 悬停 / 选中）
 *   · 部件详情渲染（PARTS + SOURCE_LABELS）
 *   · 操作引导（视角预设 / 开关 / 拆解控制 / 分步导览 / 序列读数 / 快捷键表）
 *   · 事件日志、全局与序列进度条、主题按钮外观
 *
 * 不负责：E / R / L / T / I / 空格 六个主按钮的绑定（main.js 已经绑定，
 * 这里只做「状态回显」与 is-on 样式同步，绝不重复 addEventListener 到那六个按钮上）。
 */

import { GROUP_DEFS, GROUP_BY_ID } from '../registry.js';
import { PARTS, ENGINE_META, SOURCE_LABELS, SEQUENCE } from '../data/parts.js';

/* ═══════════════ 常量 ═══════════════ */

const LOG_MAX = 200;
const TOUR_DURATION = 4200;

/** 无 PARTS 条目时的兜底 */
const UNKNOWN_PART = {
  label: '未知部件',
  labelEn: 'Unknown Part',
  group: 'aux',
  category: '未分类',
  desc: '该部件在数据字典（data/parts.js）中没有对应条目，仅能在三维视图中查看几何形态。',
  fn: '—',
  material: '—',
  specs: [],
  source: null,
  sourceNote: '',
};

const VIEW_PRESETS = [
  ['iso', '等轴'], ['front', '正视'], ['side', '侧视'],
  ['top', '俯视'], ['base', '基座'], ['nozzle', '喷口'],
];

/* 顺序化导览步骤（沿用 SEQUENCE 的“自下而上”叙事节奏） */
const TOUR_STEPS = [
  { group: 'base', view: 'base', title: '① 基础与支撑',
    text: '环形基座把整机自重与推力反作用力扩散到地壳。' },
  { group: 'structure', view: 'side', title: '② 主体结构',
    text: '三段收分塔身壳体 + 环梁 + 加劲肋构成承力骨架。' },
  { group: 'fuel', view: 'iso', title: '③ 燃料注入系统',
    text: '24 条主管道自基座爬升至反应室入口，输送岩石等离子体浆料。' },
  { group: 'reactor', view: 'iso', title: '④ 聚变反应室',
    text: '发动机的心脏：重元素聚变，工作温度达 1×10⁸ K 量级。' },
  { group: 'confinement', view: 'iso', title: '⑤ 磁约束系统',
    text: '18 组超导线圈产生约 24 T 环形磁场，把等离子体悬空约束。' },
  { group: 'nozzle', view: 'nozzle', title: '⑥ 喷口与推进',
    text: '拉瓦尔喷管把等离子体加速到约 120 km/s，产生主推力。' },
  { group: 'cooling', view: 'iso', title: '⑦ 冷却系统',
    text: '鳍片、回路与换热站排散约 90 TW 废热。' },
  { group: 'control', view: 'iso', title: '⑧ 控制与电力',
    text: '控制舱段、电力母线、传感阵列与航空障碍灯。' },
  { group: 'aux', view: 'iso', title: '⑨ 辅助与检修',
    text: '检修平台、升降竖井、塔顶吊机与各类标识。' },
];

/* ═══════════════ 内部状态 ═══════════════ */

let app = null;

const S = {
  bound: false,
  theme: 'dark',
  exploded: false,
  labelsOn: true,
  autoRotate: false,
  selected: null,
  hovered: null,
  query: '',
  groupEnabled: new Map(),
  groupCollapsed: new Map(),
  rows: new Map(),        // partId -> row element
  groupEls: new Map(),    // groupId -> { root, body, count }
  logCount: 0,
  simKind: null,
  simKindTimer: 0,
  simStep: -1,
  simPct: 0,
  simPrevText: '',
  tourIdx: -1,
  tourTimer: 0,
  tourUntil: 0,
  progressPct: 0,
  progressTimer: 0,
  keyhintTimer: 0,
};

const els = {
  partsList: null, partsScroll: null, partsCount: null, search: null,
  groupFilters: null, legend: null,
  detailBody: null,
  guide: null, tourStep: null, tourText: null, tourBar: null,
  simBar: null, simReadout: null, simSteps: null, simStop: null,
  log: null, logList: null, logCount: null, logStatus: null,
  progress: null, progressFill: null, progressPct: null, progressLabel: null,
  btnTheme: null, chkAutoRotate: null, chkLabels: null,
  explodeStagger: null, explodeStaggerOut: null,
  metaNote: null, hudModel: null, hudSub: null,
  keyhint: null,
};

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function hexToCss(hex) {
  if (typeof hex === 'number') return `#${hex.toString(16).padStart(6, '0')}`;
  return typeof hex === 'string' ? hex : '#888888';
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function two(n) { return String(n).padStart(2, '0'); }

function stamp() {
  const d = new Date();
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/* ═══════════════ 初始化 ═══════════════ */

export function initPanels(appApi) {
  app = appApi || null;

  els.partsList = $('parts-list');
  els.partsScroll = $('parts-scroll');
  els.partsCount = $('parts-count');
  els.search = $('parts-search');
  els.groupFilters = $('group-filters');
  els.legend = $('legend') || document.querySelector('.legend');
  els.detailBody = $('detail-body');
  els.guide = $('panel-guide');
  els.tourStep = $('tour-step');
  els.tourText = $('tour-text');
  els.tourBar = $('tour-bar');
  els.simBar = $('sim-bar');
  els.simReadout = $('sim-readout');
  els.simSteps = $('sim-steps');
  els.simStop = $('sim-stop');
  els.log = $('panel-log');
  els.logList = $('log-list');
  els.logCount = $('log-count');
  els.logStatus = $('log-status');
  els.progress = $('progress');
  els.progressFill = $('progress-fill');
  els.progressPct = $('progress-pct');
  els.progressLabel = $('progress-label');
  els.btnTheme = $('btn-theme');
  els.chkAutoRotate = $('chk-autorotate');
  els.chkLabels = $('chk-labels');
  els.explodeStagger = $('explode-stagger');
  els.explodeStaggerOut = $('explode-stagger-out');
  els.metaNote = $('meta-note');
  els.hudModel = $('hud-model');
  els.hudSub = $('hud-meta-sub');
  els.keyhint = $('keyhint');

  S.theme = app?.getTheme ? app.getTheme() : (document.documentElement.getAttribute('data-theme') || 'dark');
  S.exploded = !!(app?.isExploded && app.isExploded());
  S.labelsOn = !(app?.isLabelsOn && !app.isLabelsOn());

  buildGroupFilters();
  buildLegend();
  buildPartsList();
  buildMetaNote();
  buildTour();
  buildSimSteps();

  if (!S.bound) {
    bindParts();
    bindGuide();
    bindLog();
    bindGlobalKeys();
    S.bound = true;
  }

  // 初始状态回显
  setTheme(S.theme);
  syncToggles();
  showPartDetail(null);
  pushLog('控制面板就绪 · 4 个面板 / 9 个分组');
}

/* ═══════════════ 顶部栏文案 ═══════════════ */

function buildMetaNote() {
  if (els.hudModel) {
    els.hudModel.textContent = ENGINE_META.model
      ? String(ENGINE_META.model).split('/').pop().trim()
      : '重聚变发动机 · 一号机';
  }
  if (els.hudSub) {
    els.hudSub.textContent = [ENGINE_META.subtitle, `总高约 ${(ENGINE_META.totalHeight / 1000).toFixed(0)} km`]
      .filter(Boolean).join(' · ');
  }
  if (els.metaNote) {
    els.metaNote.textContent = ENGINE_META.note || '';
  }
}

/* ═══════════════ 分组筛选 / 图例 ═══════════════ */

function partIdsOfGroup(gid) {
  return Object.keys(PARTS).filter((id) => (PARTS[id]?.group || 'aux') === gid);
}

function buildGroupFilters() {
  if (!els.groupFilters) return;
  els.groupFilters.textContent = '';

  for (const g of GROUP_DEFS) {
    if (!S.groupEnabled.has(g.id)) S.groupEnabled.set(g.id, true);
    if (!S.groupCollapsed.has(g.id)) S.groupCollapsed.set(g.id, false);

    const color = hexToCss(g.color);
    const label = document.createElement('label');
    label.className = 'gf';
    label.style.color = color;
    label.title = `筛选：${g.label}`;
    label.innerHTML =
      `<input type="checkbox" data-group="${esc(g.id)}" checked />` +
      `<span class="gf-dot" aria-hidden="true"></span>` +
      `<span class="gf-label">${esc(g.label)}</span>`;

    label.querySelector('input').addEventListener('change', (e) => {
      S.groupEnabled.set(g.id, e.target.checked);
      applyFilters();
    });

    els.groupFilters.appendChild(label);
  }
}

function buildLegend() {
  if (!els.legend) return;
  els.legend.textContent = '';
  for (const g of GROUP_DEFS) {
    const span = document.createElement('span');
    span.className = 'lg';
    span.style.color = hexToCss(g.color);
    span.innerHTML = `<i aria-hidden="true"></i><span>${esc(g.label)}</span>`;
    els.legend.appendChild(span);
  }
}

/* ═══════════════ 部件清单 ═══════════════ */

function partTitle(id) {
  const p = PARTS[id];
  return p?.label || id;
}

function partSub(id) {
  const p = PARTS[id];
  if (p?.labelEn) return p.labelEn;
  return p?.category || id;
}

function buildPartsList() {
  if (!els.partsList) return;
  els.partsList.textContent = '';
  S.rows.clear();
  S.groupEls.clear();

  const registered = app?.registry?.parts instanceof Map ? app.registry.parts : null;

  // 以 PARTS 为骨架，确保即使建模尚未完成也有完整清单
  const byGroup = new Map();
  for (const g of GROUP_DEFS) byGroup.set(g.id, []);

  const ids = Object.keys(PARTS);
  for (const id of ids) {
    const gid = GROUP_BY_ID.has(PARTS[id]?.group) ? PARTS[id].group : 'aux';
    byGroup.get(gid).push({ id, inScene: !registered || registered.has(id) });
  }

  // 已注册但 PARTS 未收录的部件（容错：追加到 aux）
  if (registered) {
    for (const id of registered.keys()) {
      if (PARTS[id]) continue;
      byGroup.get('aux').push({ id, inScene: true });
    }
  }

  let total = 0;
  let shown = 0;

  for (const g of GROUP_DEFS) {
    const items = byGroup.get(g.id) || [];
    const color = hexToCss(g.color);
    total += items.length;

    const root = document.createElement('section');
    root.className = 'pgroup';
    root.dataset.group = g.id;
    root.style.color = color;

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'pgroup-head';
    head.setAttribute('aria-expanded', 'true');
    head.innerHTML =
      `<span class="caret" aria-hidden="true">▾</span>` +
      `<span class="chip" style="background:${color}" aria-hidden="true"></span>` +
      `<span class="gicon" aria-hidden="true">${esc(g.icon || '◆')}</span>` +
      `<span class="glabel">${esc(g.label)}<span class="en">${esc(g.labelEn || '')}</span></span>` +
      `<span class="gcount">${items.length}</span>`;

    const body = document.createElement('div');
    body.className = 'pgroup-body';

    head.addEventListener('click', () => {
      const now = !S.groupCollapsed.get(g.id);
      S.groupCollapsed.set(g.id, now);
      root.classList.toggle('is-collapsed', now);
      head.setAttribute('aria-expanded', String(!now));
    });

    for (const it of items) {
      body.appendChild(buildRow(it.id, color, it.inScene));
    }

    root.appendChild(head);
    root.appendChild(body);
    els.partsList.appendChild(root);
    S.groupEls.set(g.id, { root, body, head, count: items.length });
  }

  shown = total;
  if (els.partsCount) els.partsCount.textContent = `${shown} / ${total}`;
  if (!total) els.partsList.innerHTML = '<div class="list-empty">未找到部件数据</div>';

  applyFilters();
}

function buildRow(id, color, inScene) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'prow';
  row.dataset.partId = id;
  row.dataset.group = PARTS[id]?.group && GROUP_BY_ID.has(PARTS[id].group) ? PARTS[id].group : 'aux';
  row.style.color = color;
  row.title = `${partTitle(id)}\n${partSub(id)}`;

  row.innerHTML =
    `<span class="ddot" aria-hidden="true"></span>` +
    `<span class="plabel">` +
      `<span class="zh">${esc(partTitle(id))}</span>` +
      `<span class="en">${esc(partSub(id))}</span>` +
    `</span>` +
    `<span class="pcat">${esc(PARTS[id]?.category || (inScene ? '' : '未装配'))}</span>`;

  if (!inScene) row.classList.add('is-offline');

  row.addEventListener('click', () => {
    if (app?.selectPart) app.selectPart(id, { focus: true });
    else { setActivePart(id); showPartDetail(id); }
  });

  row.addEventListener('mouseenter', () => {
    S.hovered = id;
    app?.onHover?.(id);
    markHovered(id);
  });

  S.rows.set(id, row);
  return row;
}

function markHovered(id) {
  for (const [pid, el] of S.rows) el.classList.toggle('is-hovered', pid === id);
}

function matchesQuery(id) {
  const q = S.query;
  if (!q) return true;
  const p = PARTS[id];
  const hay = p
    ? `${p.label || ''} ${p.labelEn || ''} ${p.category || ''} ${p.group || ''}`
    : id;
  return hay.toLowerCase().includes(q);
}

function applyFilters() {
  let visible = 0;
  let total = 0;
  const hits = new Map();

  for (const g of GROUP_DEFS) hits.set(g.id, 0);

  for (const [id, row] of S.rows) {
    const gid = row.dataset.group;
    const enabled = S.groupEnabled.get(gid) !== false;
    total++;
    const ok = enabled && matchesQuery(id);
    row.hidden = !ok;
    if (ok) {
      visible++;
      hits.set(gid, (hits.get(gid) || 0) + 1);
    }
  }

  const searching = S.query !== '';

  for (const g of GROUP_DEFS) {
    const holder = S.groupEls.get(g.id);
    if (!holder) continue;
    const enabled = S.groupEnabled.get(g.id) !== false;
    const groupVisible = hits.get(g.id) || 0;

    holder.root.classList.toggle('is-muted', !enabled);
    holder.root.hidden = groupVisible === 0 && (searching || !enabled);

    const cnt = holder.head.querySelector('.gcount');
    if (cnt) {
      cnt.textContent = searching || !enabled
        ? `${groupVisible}/${holder.count}`
        : String(holder.count);
    }
  }

  if (els.partsCount) els.partsCount.textContent = `${visible} / ${total}`;

  const fs = document.getElementById('filter-summary');
  if (fs) {
    const on = GROUP_DEFS.filter((g) => S.groupEnabled.get(g.id) !== false).length;
    fs.textContent = `${on} / ${GROUP_DEFS.length} 组`;
  }

  let empty = els.partsList?.querySelector('.list-empty');
  if (visible === 0) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'list-empty';
      els.partsList.appendChild(empty);
    }
    empty.textContent = S.query ? `没有匹配「${S.query}」的部件` : '所有分组均已隐藏';
    empty.hidden = false;
  } else if (empty) {
    empty.hidden = true;
  }
}

/* ═══════════════ 部件详情 ═══════════════ */

export function showPartDetail(partId) {
  const box = els.detailBody || $('detail-body');
  if (!box) return;

  if (!partId) {
    box.innerHTML =
      `<div class="detail-idle">
        <div class="idle-glyph" aria-hidden="true">◎</div>
        <p class="idle-title">未选择部件</p>
        <p class="idle-hint">在三维视图中点击任意零件，或从左侧<b>部件清单</b>中选择一行，
          此处将显示该部件的功能、用料、参数与<b>来源等级</b>。</p>
        <ul class="idle-tips">
          <li><kbd>E</kbd> 展开爆炸拆解视图</li>
          <li><kbd>空格</kbd> 自动旋转巡视</li>
          <li><kbd>Esc</kbd> 取消选择</li>
        </ul>
      </div>`;
    return;
  }

  const rec = app?.registry?.get?.(partId) || null;
  const data = PARTS[partId] || null;
  const p = data || {
    ...UNKNOWN_PART,
    label: rec?.label || partId,
    labelEn: rec?.labelEn || '',
    group: rec?.group || 'aux',
    detail: rec?.detail || {},
  };

  const gdef = GROUP_BY_ID.get(p.group) || null;
  const color = hexToCss(gdef?.color ?? 0x8b9bb0);
  const src = p.source && SOURCE_LABELS[p.source] ? SOURCE_LABELS[p.source] : null;

  const specs = Array.isArray(p.specs) ? p.specs : [];
  const specsFromRecord = !specs.length && rec?.detail?.specs ? rec.detail.specs : [];
  const specRows = specs.length ? specs : specsFromRecord;

  const desc = p.desc || rec?.detail?.desc || '';
  const fn = p.fn || rec?.detail?.fn || '';
  const material = p.material || rec?.detail?.material || '';

  let html = '';

  html += `<div class="d-head">
    <span class="d-chip" style="background:${color};color:${color}" aria-hidden="true"></span>
    <div class="d-titles">
      <div class="d-label">${esc(p.label || partId)}</div>
      <div class="d-label-en">${esc(p.labelEn || partId)}</div>
      <div class="d-badges">
        ${gdef ? `<span class="badge" style="color:${color}">
          <span aria-hidden="true">${esc(gdef.icon || '◆')}</span><b>${esc(gdef.label)}</b></span>` : ''}
        ${p.category ? `<span class="badge">分类 · <b>${esc(p.category)}</b></span>` : ''}
        <span class="badge">ID · <b>${esc(partId)}</b></span>
      </div>
    </div>
  </div>`;

  if (src) {
    html += `<div class="d-actions">
      <span class="badge ${esc(src.cls)}" title="${esc(p.sourceNote || '')}">来源 · <b>${esc(src.text)}</b></span>
    </div>`;
  }

  if (desc) {
    html += `<div class="d-sec"><div class="d-sec-title">概述 · DESCRIPTION</div>
      <p class="d-text">${esc(desc)}</p></div>`;
  }

  if (fn) {
    html += `<div class="d-sec"><div class="d-sec-title">功能 · FUNCTION</div>
      <p class="d-text">${esc(fn)}</p></div>`;
  }

  html += `<div class="d-sec"><div class="d-sec-title">工程参数 · SPECS</div>`;
  if (specRows.length) {
    html += `<table class="spec-table"><tbody>`;
    for (const s of specRows) {
      html += `<tr><th scope="row">${esc(s.k)}</th><td>${esc(s.v)}</td></tr>`;
    }
    html += `</tbody></table>`;
  } else {
    html += `<p class="d-text muted">暂无参数数据。</p>`;
  }
  html += `</div>`;

  html += `<div class="d-sec"><div class="d-sec-title">用料与装配 · MATERIAL</div>
    <dl class="d-kv">
      <dt>主用料</dt><dd>${esc(material || '—')}</dd>
      ${rec ? `<dt>拆解方式</dt><dd>${esc(rec.explodeMode || 'linear')}</dd>
        <dt>拆解顺序</dt><dd>${esc(String(rec.order ?? '—'))}</dd>
        <dt>拆解距离</dt><dd>${esc(String(rec.explodeDist ?? '—'))}</dd>` : ''}
    </dl>
  </div>`;

  if (p.sourceNote) {
    html += `<div class="src-note"><span class="lbl">来源说明：</span>${esc(p.sourceNote)}</div>`;
  } else if (!data) {
    html += `<div class="src-note"><span class="lbl">提示：</span>
      该部件在数据字典中缺少条目，以上信息来自运行时注册表。</div>`;
  }

  html += `<div class="d-actions">
    <button class="btn btn-xs" type="button" data-detail-focus="1">聚焦</button>
    <button class="btn btn-xs" type="button" data-detail-copy="1">复制 ID</button>
    <button class="btn btn-xs" type="button" data-detail-clear="1">取消选择</button>
  </div>`;

  box.innerHTML = html;

  const focusBtn = box.querySelector('[data-detail-focus]');
  if (focusBtn) focusBtn.addEventListener('click', () => app?.focusOn?.(partId));

  const copyBtn = box.querySelector('[data-detail-copy]');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(partId);
        pushLog(`已复制部件 ID：${partId}`);
      } catch {
        pushLog(`部件 ID：${partId}`, 'info');
      }
    });
  }

  const clearBtn = box.querySelector('[data-detail-clear]');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (app?.selectPart) app.selectPart(null);
      else { setActivePart(null); showPartDetail(null); }
    });
  }

  box.scrollTop = 0;
}

/* ═══════════════ 选中高亮 ═══════════════ */

export function setActivePart(partId) {
  S.selected = partId || null;
  for (const [id, el] of S.rows) {
    el.classList.toggle('is-active', id === S.selected);
  }
  if (S.selected && S.rows.has(S.selected) && els.partsScroll) {
    const el = S.rows.get(S.selected);
    if (!el.hidden) {
      try {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch {
        el.scrollIntoView(false);
      }
    }
  }
}

/* ═══════════════ 主题 ═══════════════ */

export function setTheme(mode) {
  const m = mode === 'light' ? 'light' : 'dark';
  S.theme = m;
  document.documentElement.setAttribute('data-theme', m);

  try { localStorage.setItem('pe.theme', m); } catch { /* 忽略 */ }

  const btn = els.btnTheme || $('btn-theme');
  if (btn) {
    const txt = btn.querySelector('.txt');
    const ico = btn.querySelector('.ico');
    if (txt) txt.textContent = m === 'dark' ? '深色科技' : '浅色白模';
    const label = m === 'dark' ? '☾ 深色科技（点击切换浅色白模 · T）' : '☀ 浅色白模（点击切换深色科技 · T）';
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
    if (ico) ico.textContent = m === 'dark' ? '◐' : '◑';
    btn.classList.toggle('is-on', m === 'light');
  }
}

/* ═══════════════ 事件日志 ═══════════════ */

export function pushLog(text) {
  const list = els.logList || $('log-list');
  if (!list) return;

  const line = document.createElement('div');
  line.className = `log-line lv-${classifyLog(text)}`;
  line.innerHTML = `<span class="lt">${stamp()}</span><span class="lx">${esc(text)}</span>`;
  list.appendChild(line);
  S.logCount++;

  while (list.childElementCount > LOG_MAX) {
    list.removeChild(list.firstElementChild);
  }

  list.scrollTop = list.scrollHeight;

  const cnt = els.logCount || $('log-count');
  if (cnt) cnt.textContent = String(S.logCount);
}

function classifyLog(text) {
  const s = String(text || '');
  if (/失败|错误|异常|中止|error|fail/i.test(s)) return 'err';
  if (/警告|注意|请稍候|warn/i.test(s)) return 'warn';
  if (/完成|就绪|已|稳定|在线|开始/.test(s)) return 'ok';
  if (/拆解|视角|标注|切换|序列|点火|发射|导览/.test(s)) return 'accent';
  return 'info';
}

function setLogStatus(text) {
  const el = els.logStatus || $('log-status');
  if (el) el.textContent = text;
}

/* ═══════════════ 进度 ═══════════════ */

export function setProgress(pct) {
  const v = clamp(Number(pct) || 0, 0, 1);
  S.progressPct = v;

  const bar = els.progressFill || $('progress-fill');
  const pctEl = els.progressPct || $('progress-pct');
  const box = els.progress || $('progress');

  if (bar) bar.style.width = `${(v * 100).toFixed(1)}%`;
  if (pctEl) pctEl.textContent = `${Math.round(v * 100)}%`;

  if (v > 0) {
    box?.classList.add('show');
    box?.setAttribute('aria-hidden', 'false');
    window.clearTimeout(S.progressTimer);
  } else {
    box?.classList.remove('show');
    box?.setAttribute('aria-hidden', 'true');
  }

  if (els.simBar) els.simBar.style.width = `${(v * 100).toFixed(1)}%`;

  updateSimStep(v);
}

/* ═══════════════ 过滤辅助（保留导出） ═══════════════ */

export function setPartListActive(groupIds) {
  if (!Array.isArray(groupIds) || !groupIds.length) {
    for (const g of GROUP_DEFS) S.groupEnabled.set(g.id, true);
  } else {
    const set = new Set(groupIds);
    for (const g of GROUP_DEFS) S.groupEnabled.set(g.id, set.has(g.id));
  }

  if (els.groupFilters) {
    for (const input of $$('#group-filters input[data-group]')) {
      input.checked = S.groupEnabled.get(input.dataset.group) !== false;
    }
  }
  applyFilters();
}

/* ═══════════════ 引导面板：序列 / 导览 ═══════════════ */

function buildSimSteps() {
  if (!els.simSteps) return;
  els.simSteps.textContent = '';
  for (const [kind, seq] of Object.entries(SEQUENCE)) {
    for (const st of seq.steps) {
      const li = document.createElement('li');
      li.dataset.sim = kind;
      li.dataset.t = String(st.t);
      li.innerHTML = `<span class="st-t">${(st.t / 1000).toFixed(1)}s</span><span class="st-x">${esc(st.text)}</span>`;
      li.hidden = true;
      els.simSteps.appendChild(li);
    }
  }
}

function simDuration(kind) {
  const seq = SEQUENCE[kind];
  if (!seq?.steps?.length) return 5000;
  return seq.steps[seq.steps.length - 1].t + 1600;
}

function inferSimKind() {
  if (Date.now() - S.simKindTimer > simDuration(S.simKind || 'ignition') + 400) S.simKind = null;
  if (S.simKind) return S.simKind;
  if (S.simPrevText && /导流槽|全机自检|预点火|推力矢量|全推力/.test(S.simPrevText)) return 'launch';
  return 'ignition';
}

function displaySimText(kind, i) {
  const seq = SEQUENCE[kind];
  if (!seq?.steps?.length) return;
  const idx = clamp(i, 0, seq.steps.length - 1);
  const li = els.simSteps?.querySelector(`li[data-sim="${kind}"][data-t="${seq.steps[idx].t}"]`);
  S.simPrevText = li?.querySelector('.st-x')?.textContent || S.simPrevText;
}

function updateSimStep(pct) {
  const kind = inferSimKind();
  const seq = SEQUENCE[kind];
  if (!seq?.steps?.length || !els.simSteps) return;

  const list = $$(`#sim-steps li`);
  for (const li of list) li.hidden = li.dataset.sim !== kind;

  const stepCount = seq.steps.length;
  const idx = pct <= 0 ? -1 : clamp(Math.floor(pct * stepCount), 0, stepCount - 1);
  S.simStep = idx;
  displaySimText(kind, idx);

  const rows = $$(`#sim-steps li[data-sim="${kind}"]`);
  rows.forEach((li, i) => {
    li.classList.toggle('is-done', idx >= 0 && i < idx);
    li.classList.toggle('is-active', i === idx);
  });

  if (els.simReadout) {
    if (idx < 0) {
      els.simReadout.textContent = '状态：待机 · 反应室 300 K';
    } else {
      els.simReadout.textContent =
        `状态：${seq.label} ${idx + 1}/${stepCount} · ${seq.steps[idx].text}`;
    }
  }

  if (els.simStop) els.simStop.disabled = idx < 0;
}

/* ── 分步导览 ── */

function buildTour() {
  if (S.tourIdx < 0 && els.tourStep) els.tourStep.textContent = '准备就绪';
}

function tourGo(i, { auto = false } = {}) {
  if (!TOUR_STEPS.length) return;
  S.tourIdx = ((i % TOUR_STEPS.length) + TOUR_STEPS.length) % TOUR_STEPS.length;

  const step = TOUR_STEPS[S.tourIdx];
  const gdef = GROUP_BY_ID.get(step.group);

  if (els.tourStep) {
    els.tourStep.textContent = `${step.title}${gdef ? ` · ${gdef.label}` : ''}`;
  }
  if (els.tourText) els.tourText.textContent = step.text;
  if (els.tourBar) {
    els.tourBar.style.width = `${((S.tourIdx + 1) / TOUR_STEPS.length * 100).toFixed(1)}%`;
  }

  // 自动旋转
  setAutoRotateSafe(true);

  // 视角
  if (step.view && app?.setView) app.setView(step.view);
  else if (app?.resetView) app.resetView();

  // 高亮该分组的部件：用清单筛选作为辅助（不改变 3D 选中）
  setPartListActive([step.group]);

  const firstId = partIdsOfGroup(step.group)[0] || null;
  if (firstId) {
    setActivePart(firstId);
    showPartDetail(firstId);
  }

  if (app?.setExploded) app.setExploded(true);

  if (auto) {
    window.clearTimeout(S.tourTimer);
    S.tourTimer = window.setTimeout(() => tourGo(S.tourIdx + 1, { auto: true }), TOUR_DURATION);
    S.tourUntil = Date.now() + TOUR_DURATION;
  }
}

function tourStop() {
  window.clearTimeout(S.tourTimer);
  S.tourTimer = 0;
  S.tourUntil = 0;
  if (els.tourStep) els.tourStep.textContent = '导览已停止';
  if (els.tourText) els.tourText.textContent = '按「下一组」继续，或「自动」从当前分组播放。';
}

/* ═══════════════ 状态同步 ═══════════════ */

function syncToggles() {
  const exploded = !!app?.isExploded?.();
  S.exploded = exploded;
  setBtnOn($('btn-explode'), exploded);
  setBtnOn($('btn-labels'), !!app?.isLabelsOn?.());
  setBtnText($('btn-explode'), exploded ? '收拢' : '拆解');

  if (els.chkLabels) els.chkLabels.checked = !!app?.isLabelsOn?.();
  if (els.chkAutoRotate) els.chkAutoRotate.checked = !!app?.state?.autoRotate;
}

function setBtnOn(btn, on) {
  if (btn) btn.classList.toggle('is-on', !!on);
}

function setBtnText(btn, text) {
  const t = btn?.querySelector('.txt');
  if (t) t.textContent = text;
}

function setAutoRotateSafe(on) {
  if (app?.state) app.state.autoRotate = !!on;
  app?.setAutoRotate?.(!!on);
  S.autoRotate = !!on;
  if (els.chkAutoRotate) els.chkAutoRotate.checked = !!on;
}

function toggleAutoRotate() {
  const next = !(app?.state?.autoRotate ?? S.autoRotate);
  setAutoRotateSafe(next);
}

function toggleLabels() {
  const next = !(app?.isLabelsOn ? app.isLabelsOn() : S.labelsOn);
  app?.setLabels?.(next);
  S.labelsOn = next;
  if (els.chkLabels) els.chkLabels.checked = next;
  setBtnOn($('btn-labels'), next);
}

/* ═══════════════ 事件绑定 ═══════════════ */

function bindParts() {
  // 搜索
  let t = 0;
  els.search?.addEventListener('input', (e) => {
    window.clearTimeout(t);
    const v = e.target.value.trim().toLowerCase();
    t = window.setTimeout(() => {
      S.query = v;
      applyFilters();
    }, 90);
  });

  els.search?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.target.value = '';
      S.query = '';
      applyFilters();
    }
  });

  // 分组快捷操作
  for (const btn of $$('[data-group-action]')) {
    btn.addEventListener('click', () => {
      const act = btn.dataset.groupAction;
      if (act === 'all') {
        for (const g of GROUP_DEFS) S.groupEnabled.set(g.id, true);
      } else if (act === 'none') {
        for (const g of GROUP_DEFS) S.groupEnabled.set(g.id, false);
      } else if (act === 'invert') {
        for (const g of GROUP_DEFS) S.groupEnabled.set(g.id, S.groupEnabled.get(g.id) === false);
      } else if (act === 'explode') {
        // 「仅显展开组」：只显示当前未折叠的分组
        for (const g of GROUP_DEFS) S.groupEnabled.set(g.id, !S.groupCollapsed.get(g.id));
      }
      for (const input of $$('#group-filters input[data-group]')) {
        input.checked = S.groupEnabled.get(input.dataset.group) !== false;
      }
      applyFilters();
      pushLog(`部件清单筛选：${btn.textContent.trim()}`);
    });
  }

  // 清单容器整体离开：清除 3D 高亮
  const clear = () => {
    if (S.hovered === null) return;
    S.hovered = null;
    app?.onHover?.(null);
    markHovered(null);
  };
  els.partsScroll?.addEventListener('mouseleave', clear);
  els.partsList?.addEventListener('mouseleave', clear);

  // 折叠按钮（宽屏：独立折叠；窄屏：交给 initMobile 的抽屉 accordion 处理）
  for (const btn of $$('.collapse-btn')) {
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 900) return;   // 窄屏由抽屉逻辑接管，避免双重 toggle
      const panel = $(btn.dataset.collapse);
      if (!panel) return;
      const collapsed = panel.classList.toggle('is-collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
    });
  }
}

function bindGuide() {
  // 视角预设 —— 唯一的 setView 调用点（main.js 的 #btn-view 上没有绑定，安全）
  for (const btn of $$('#btn-view .seg, [data-view]')) {
    const preset = btn.dataset.view;
    if (!preset || !VIEW_PRESETS.some((p) => p[0] === preset)) continue;
    btn.addEventListener('click', () => {
      app?.setView?.(preset);
      markViewActive(preset);
    });
  }

  // 自动旋转
  els.chkAutoRotate?.addEventListener('change', (e) => {
    setAutoRotateSafe(e.target.checked);
    pushLog(e.target.checked ? '自动旋转：开启' : '自动旋转：关闭');
  });

  // 标注开关
  els.chkLabels?.addEventListener('change', (e) => {
    app?.setLabels?.(e.target.checked);
    S.labelsOn = e.target.checked;
    setBtnOn($('btn-labels'), e.target.checked);
  });

  // 拆解快捷
  for (const btn of $$('[data-explode]')) {
    btn.addEventListener('click', () => {
      const on = btn.dataset.explode === '1';
      app?.setExploded?.(on);
      syncToggles();
    });
  }

  // 错峰系数（仅 UI；动画层可用 window.__ENGINE__ 读取）
  els.explodeStagger?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    if (els.explodeStaggerOut) els.explodeStaggerOut.textContent = String(v);
    if (window.__ENGINE__) window.__ENGINE__.uiStagger = v / 100;
  });

  // 导览
  $('tour-prev')?.addEventListener('click', () => { window.clearTimeout(S.tourTimer); tourGo(S.tourIdx - 1); });
  $('tour-next')?.addEventListener('click', () => { window.clearTimeout(S.tourTimer); tourGo(S.tourIdx + 1); });
  $('tour-play')?.addEventListener('click', () => { tourGo(S.tourIdx < 0 ? 0 : S.tourIdx, { auto: true }); });
  $('tour-stop')?.addEventListener('click', tourStop);

  // 序列
  for (const btn of $$('[data-sim]')) {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.sim;
      if (!SEQUENCE[kind]) return;
      S.simKind = kind;
      S.simKindTimer = Date.now();
      S.simStep = -1;
      updateSimStep(0);
      app?.simulate?.(kind);
      setLogStatus(`序列执行中 · ${SEQUENCE[kind].label}`);
    });
  }

  els.simStop?.addEventListener('click', () => {
    app?.stopSim?.();
    S.simKind = null;
    updateSimStep(0);
    setLogStatus('就绪');
  });
}

function markViewActive(preset) {
  for (const b of $$('#btn-view .seg')) {
    b.classList.toggle('is-active', b.dataset.view === preset);
  }
}

function bindLog() {
  $('log-clear')?.addEventListener('click', () => {
    if (els.logList) els.logList.textContent = '';
    S.logCount = 0;
    if (els.logCount) els.logCount.textContent = '0';
    pushLog('日志已清空');
  });
}

/* ── 全局按键：只补充 main.js 未覆盖的键 ── */
function bindGlobalKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;

    // main.js 会在空格上 preventDefault；这里读取其后的状态做回显。
    if (e.code === 'Space' || e.key === ' ') {
      window.setTimeout(() => {
        const on = !!app?.state?.autoRotate;
        if (els.chkAutoRotate) els.chkAutoRotate.checked = on;
        S.autoRotate = on;
      }, 0);
      return;
    }
    if (e.key === 'Escape') {
      window.setTimeout(syncToggles, 0);
      return;
    }
    if (['e', 'l', 't'].includes(e.key.toLowerCase())) {
      window.setTimeout(syncToggles, 0);
    }
  });
}

/* ═══════════════ 移动端抽屉 ═══════════════ */

function initMobile() {
  const menu = $('btn-menu');
  if (!menu) return;

  const panels = $$('.panel');
  const isNarrow = () => window.innerWidth <= 900;

  const closeAll = () => {
    menu.setAttribute('aria-expanded', 'false');
    for (const p of panels) p.classList.remove('is-open');
  };

  // 抽屉（accordion）：同时只展开一个，其余收成标题条，避免互相叠压
  const openDrawer = (target) => {
    menu.setAttribute('aria-expanded', 'true');
    for (const p of panels) {
      p.classList.add('is-open');
      p.classList.toggle('is-collapsed', p !== target);
    }
  };

  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') === 'true';
    if (open) closeAll();
    else openDrawer($('panel-parts'));
  });

  // 抽屉内点标题即切换展开的那一个
  for (const btn of $$('.collapse-btn')) {
    btn.addEventListener('click', () => {
      if (!isNarrow()) return;
      const panel = $(btn.dataset.collapse);
      if (!panel) return;
      const willOpen = panel.classList.contains('is-collapsed');
      if (willOpen) openDrawer(panel);
      else panel.classList.add('is-collapsed');
    });
  }

  // 点击画布关闭抽屉
  $('canvas-wrap')?.addEventListener('pointerdown', () => {
    if (!isNarrow()) return;
    if (menu.getAttribute('aria-expanded') !== 'true') return;
    closeAll();
  });

  // 回到宽屏时清掉抽屉态
  window.addEventListener('resize', () => {
    if (isNarrow()) return;
    closeAll();
    for (const p of panels) p.classList.remove('is-collapsed');
  });
}

/* ═══════════════ 首交互提示 ═══════════════ */

function bindKeyhint() {
  const hint = els.keyhint || $('keyhint');
  if (!hint) return;

  const hide = () => {
    window.clearTimeout(S.keyhintTimer);
    hint.classList.add('hide');
  };

  $('keyhint-close')?.addEventListener('click', hide);
  window.addEventListener('pointerdown', hide, { once: true });
  window.addEventListener('keydown', hide, { once: true });
  S.keyhintTimer = window.setTimeout(hide, 12000);
}

/* ═══════════════ 收尾：延迟启动的次要绑定 ═══════════════ */

if (typeof document !== 'undefined') {
  const boot = () => {
    bindKeyhint();
    initMobile();
    // 让面板的折叠状态在窄屏下默认收起底部两块，保证 3D 视野
    if (window.innerWidth <= 900) {
      $('panel-guide')?.classList.add('is-collapsed');
      $('panel-log')?.classList.add('is-collapsed');
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
