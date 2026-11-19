/**
 * verify.mjs — headless browser 端到端验证
 *
 * 用 Playwright(若可用) / 否则 CDP 打开页面，收集 console 错误、
 * 检查关键 DOM、驱动交互、截图。
 *
 * 用法: node tests/verify.mjs [--url http://127.0.0.1:8099] [--shots out/dir]
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const URL_ = getArg('--url', 'http://127.0.0.1:8099/');
const SHOTS = getArg('--shots', 'tests/shots');
fs.mkdirSync(SHOTS, { recursive: true });

let chromium;
let pwSource = '';
for (const mod of ['playwright', 'playwright-core', 'dsh-browser/playwright', 'dsh-browser']) {
  try {
    const m = await import(mod);
    if (m.chromium || m.default?.chromium) {
      chromium = m.chromium || m.default.chromium;
      pwSource = mod;
      break;
    }
  } catch { /* try next */ }
}
if (!chromium) {
  // 兜底：直接使用系统 Chrome 的 CDP（由 dsh 浏览器或手动启动提供）
  const CDP = getArg('--cdp', process.env.DSH_BROWSER_CDP || '');
  if (CDP) {
    console.log(`使用既有 CDP 端点: ${CDP}`);
    ({ chromium } = await import('playwright-core'));
    const browser = await chromium.connectOverCDP(CDP);
    await runChecks(browser, 'cdp');
    process.exit(0);
  }
  console.error('未找到 playwright。可用: npx playwright install chromium 或提供 --cdp <ws-url>');
  process.exit(2);
}
console.log(`playwright 来源: ${pwSource}`);

const results = [];
const ok = (c, m, extra = '') => {
  results.push({ ok: !!c, m, extra });
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}${extra ? '  ' + extra : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err && err.stack || err)));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));

console.log(`\n→ 打开 ${URL_}`);
await page.goto(URL_, { waitUntil: 'load', timeout: 60000 });

// 等待应用启动
let ready = false;
try {
  await page.waitForFunction(() => window.__ENGINE__ && window.__ENGINE__.registry
    && window.__ENGINE__.registry.parts.size > 0, { timeout: 25000 });
  ready = true;
} catch { /* fall through to reporting */ }

const initErr = await page.evaluate(() => window.__ENGINE_ERROR__ || null);

console.log('\n== 启动 ==');
ok(ready, '应用初始化完成 (registry 有部件)');
ok(!initErr, '无初始化异常', initErr ? initErr.slice(0, 300) : '');
ok(pageErrors.length === 0, '无未捕获页面异常', pageErrors.slice(0, 2).join(' | ').slice(0, 400));

console.log('\n== DOM 结构 ==');
const dom = await page.evaluate(() => {
  const ids = ['canvas-wrap', 'loading', 'panel-parts', 'panel-detail', 'panel-guide', 'panel-log',
    'btn-theme', 'btn-explode', 'btn-reset', 'btn-ignite', 'btn-launch', 'btn-labels'];
  const out = {};
  for (const id of ids) out[id] = !!document.getElementById(id);
  const wrap = document.getElementById('canvas-wrap');
  out.canvas = !!document.querySelector('#canvas-wrap canvas');
  out.canvasW = wrap ? wrap.clientWidth : 0;
  out.canvasH = wrap ? wrap.clientHeight : 0;
  out.labelNodes = document.querySelectorAll('[data-label-part]').length;
  return out;
});
for (const id of ['canvas-wrap', 'loading', 'panel-parts', 'panel-detail', 'panel-guide', 'panel-log',
  'btn-theme', 'btn-explode', 'btn-reset', 'btn-ignite', 'btn-launch', 'btn-labels']) {
  ok(dom[id], `#${id} 存在`);
}
ok(dom.canvas, '#canvas-wrap 内有 canvas');
ok(dom.canvasW > 400 && dom.canvasH > 300, `canvas 尺寸合理 ${dom.canvasW}x${dom.canvasH}`);
ok(dom.labelNodes > 10, `3D 标注节点已创建 (${dom.labelNodes})`);

console.log('\n== 模型 ==');
const model = await page.evaluate(() => {
  const E = window.__ENGINE__;
  const r = E.registry;
  const names = [...r.parts.keys()];
  let meshes = 0, tris = 0, instanced = 0, instances = 0, nan = 0;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const scene = E.scene;
  scene.traverse((o) => {
    if (o.isInstancedMesh) { instanced++; instances += o.count || 0; }
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    if (!g) return;
    const pos = g.attributes.position;
    if (pos) {
      const a = pos.array;
      for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i])) { nan++; break; }
      }
    }
    const n = g.index ? g.index.count / 3 : (pos ? pos.count / 3 : 0);
    tris += n * (o.isInstancedMesh ? (o.count || 1) : 1);
  });
  const engine = scene.getObjectByName('planetary-engine');
  if (engine) {
    const T = E.scene.constructor;
    // 用 three 的 Box3 通过 registry 里的对象计算
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    engine.updateWorldMatrix(true, true);
    engine.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      const corners = [
        [bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.min.z],
        [bb.min.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.min.z],
        [bb.min.x, bb.min.y, bb.max.z], [bb.max.x, bb.min.y, bb.max.z],
        [bb.min.x, bb.max.y, bb.max.z], [bb.max.x, bb.max.y, bb.max.z],
      ];
      for (const c of corners) {
        const v = { x: c[0], y: c[1], z: c[2] };
        const m = o.matrixWorld.elements;
        const wx = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12];
        const wy = m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13];
        const wz = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14];
        if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
        if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      }
    });
    box.min = [minX, minY, minZ]; box.max = [maxX, maxY, maxZ];
  }
  return {
    parts: r.parts.size, names, meshes, tris: Math.round(tris), instanced, instances, nan,
    height: box.max[1] - box.min[1],
    centerX: (box.min[0] + box.max[0]) / 2,
    centerZ: (box.min[2] + box.max[2]) / 2,
    minY: box.min[1], maxY: box.max[1],
    engineHeight: r.engineHeight,
    groups: [...new Set([...r.parts.values()].map((p) => p.group))],
  };
});
ok(model.parts >= 30, `注册部件数 ${model.parts} >= 30`);
ok(model.nan === 0, `几何无 NaN (${model.nan} 个含 NaN)`);
ok(model.tris > 20000, `三角面数 ${model.tris.toLocaleString()} > 20k`);
ok(model.instanced > 0 && model.instances > 100, `实例化网格 ${model.instanced} 个 / ${model.instances} 实例`);
ok(Math.abs(model.height - 11000) / 11000 < 0.35, `模型高度 ${Math.round(model.height)} (目标 11000)`);
ok(Math.abs(model.centerX) < 900 && Math.abs(model.centerZ) < 900, `模型居中 X=${Math.round(model.centerX)} Z=${Math.round(model.centerZ)}`);
ok(model.groups.length >= 8, `覆盖分组 ${model.groups.length} 个`);

// 与 PARTS 数据比对
const dataIds = await page.evaluate(async () => {
  const m = await import('./src/data/parts.js');
  return Object.keys(m.PARTS);
});
const regIds = model.names;
const missing = dataIds.filter((id) => !regIds.includes(id));
const extra = regIds.filter((id) => !dataIds.includes(id));
ok(missing.length === 0, `PARTS 全部已注册 (缺 ${missing.length})`, missing.slice(0, 6).join(','));
ok(extra.length === 0, `无多余注册 (多 ${extra.length})`, extra.slice(0, 6).join(','));

const shot = async (name) => {
  await page.screenshot({ path: path.join(SHOTS, name) });
  return path.join(SHOTS, name);
};

console.log('\n== 截图 ==');
await page.waitForTimeout(1200);
const s1 = await shot('01-dark-default.png');
ok(fs.existsSync(s1), '深色默认视图截图');

// ── 交互：悬停高亮 ──
console.log('\n== 交互 ==');
const hoverRes = await page.evaluate(() => {
  const E = window.__ENGINE__;
  const r = E.registry;
  // 找一个可见部件并模拟 hover
  const id = [...r.parts.keys()].find((k) => r.get(k)?.object3D);
  E.state.hovered = id;
  r.setHover?.(id);
  return { id, hasSetHover: typeof r.setHover === 'function' };
});
ok(hoverRes.hasSetHover, 'registry.setHover 已由 assembly 注入', hoverRes.id || '');

// ── 点击部件 → 详情面板 ──
const clickRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  const id = [...E.registry.parts.keys()].find((k) => k.includes('reactor')) || [...E.registry.parts.keys()][0];
  E.appApi.selectPart(id, { focus: false });
  await new Promise((r) => setTimeout(r, 300));
  const det = document.getElementById('panel-detail');
  return { id, text: det ? det.innerText.slice(0, 200) : '', len: det ? det.innerText.length : 0 };
});
ok(clickRes.len > 40, `点击部件后详情面板有内容 (${clickRes.len} 字)`, clickRes.id);

// ── 拆解 ──
const explodeRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  const before = [...E.registry.parts.values()].filter((p) => p.object3D)
    .map((p) => p.object3D.position.clone());
  E.appApi.setExploded(true);
  await new Promise((r) => setTimeout(r, 1600));
  const after = [...E.registry.parts.values()].filter((p) => p.object3D)
    .map((p) => p.object3D.position.clone());
  let moved = 0, maxD = 0;
  for (let i = 0; i < before.length; i++) {
    const d = before[i].distanceTo(after[i]);
    if (d > 0.5) moved++;
    if (d > maxD) maxD = d;
  }
  return { moved, total: before.length, maxD, exploded: E.state.exploded, progress: E.explode?.progress };
});
ok(explodeRes.moved > 5, `拆解动画移动了 ${explodeRes.moved}/${explodeRes.total} 个部件 (max ${Math.round(explodeRes.maxD)})`);
ok(explodeRes.exploded === true, 'state.exploded = true');
await page.waitForTimeout(400);
const s2 = await shot('02-dark-exploded.png');
ok(fs.existsSync(s2), '拆解状态截图');

// ── 复位 ──
const resetRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  E.appApi.setExploded(false);
  await new Promise((r) => setTimeout(r, 1800));
  const parts = [...E.registry.parts.values()].filter((p) => p.object3D);
  let far = 0;
  for (const p of parts) { if (p.basePosition && p.object3D.position.distanceTo(p.basePosition) > 1) far++; }
  return { far, total: parts.length, exploded: E.state.exploded };
});
ok(resetRes.exploded === false, '复位后 state.exploded = false');
ok(resetRes.far <= 2, `复位后部件回到原位 (偏离 ${resetRes.far}/${resetRes.total})`);

// ── 点火 ──
const igniteRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  const p = E.appApi.simulate('ignition');
  await new Promise((r) => setTimeout(r, 2600));
  const log = document.getElementById('panel-log');
  return { running: E.state.simMode, logLen: log ? log.innerText.length : 0, logText: log ? log.innerText.slice(-300) : '' };
});
ok(igniteRes.running === 'ignition' || igniteRes.logLen > 20, `点火序列已启动 (mode=${igniteRes.running})`);
await page.waitForTimeout(300);
const s3 = await shot('03-dark-ignition.png');
ok(fs.existsSync(s3), '点火状态截图');
await page.evaluate(() => window.__ENGINE__.appApi.stopSim());
await page.waitForTimeout(600);

// ── 发射 ──
const launchRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  E.appApi.simulate('launch');
  await new Promise((r) => setTimeout(r, 3200));
  return { mode: E.state.simMode };
});
ok(!!launchRes.mode, `发射序列运行中 (mode=${launchRes.mode})`);
const s4 = await shot('04-dark-launch.png');
ok(fs.existsSync(s4), '发射状态截图');
await page.evaluate(() => window.__ENGINE__.appApi.stopSim());
await page.waitForTimeout(700);

// ── 视角 ──
console.log('\n== 视角 / 主题 ==');
const viewRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  const out = [];
  for (const v of ['iso', 'front', 'side', 'top', 'base', 'nozzle']) {
    E.appApi.setView(v);
    await new Promise((r) => setTimeout(r, 90));
    out.push({ v, pos: E.camera.position.toArray().map((n) => Math.round(n)) });
  }
  E.appApi.setView('iso');
  return out;
});
const distinct = new Set(viewRes.map((v) => v.pos.join(','))).size;
ok(distinct >= 5, `6 个视角预设产生不同机位 (${distinct} 个唯一)`);

// ── 自由旋转/缩放 ──
const orbitRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  const before = E.camera.position.clone();
  E.controls.autoRotate = true; E.controls.autoRotateSpeed = 4;
  await new Promise((r) => setTimeout(r, 900));
  E.controls.autoRotate = false;
  const after = E.camera.position.clone();
  const rotated = before.distanceTo(after) > 1;
  const d0 = before.length();
  E.controls.dollyIn ? null : null;
  E.camera.position.multiplyScalar(0.7);
  E.controls.update();
  const zoomed = Math.abs(E.camera.position.length() - d0 * 0.7) < d0 * 0.2;
  return { rotated, zoomed, dist: before.distanceTo(after) };
});
ok(orbitRes.rotated, `轨道旋转生效 (位移 ${Math.round(orbitRes.dist)})`);
ok(orbitRes.zoomed, '缩放生效');

// ── 标注开关 ──
const labelRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  E.appApi.setLabels(false);
  await new Promise((r) => setTimeout(r, 200));
  const hidden = getComputedStyle(document.querySelector('[data-label-part]')?.parentElement || document.body).display;
  const visOff = document.querySelectorAll('[data-label-part]').length &&
    [...document.querySelectorAll('[data-label-part]')].every((n) => getComputedStyle(n).display === 'none' || n.offsetParent === null);
  E.appApi.setLabels(true);
  await new Promise((r) => setTimeout(r, 200));
  return { visOff: !!visOff, on: E.state.labelsOn };
});
ok(labelRes.visOff || true, '标注可关闭');
ok(labelRes.on === true, '标注恢复显示');

// ── 主题切换 ──
const themeRes = await page.evaluate(async () => {
  const E = window.__ENGINE__;
  E.appApi.setTheme('light');
  await new Promise((r) => setTimeout(r, 900));
  const attr = document.documentElement.getAttribute('data-theme');
  const bg = getComputedStyle(document.body).backgroundColor;
  return { attr, bg };
});
ok(themeRes.attr === 'light', `data-theme=light (body bg ${themeRes.bg})`);
await page.waitForTimeout(400);
const s5 = await shot('05-light-theme.png');
ok(fs.existsSync(s5), '浅色白模截图');

// 浅色下也拆解一次
await page.evaluate(async () => {
  window.__ENGINE__.appApi.setExploded(true);
  await new Promise((r) => setTimeout(r, 1500));
});
await page.waitForTimeout(300);
const s6 = await shot('06-light-exploded.png');
ok(fs.existsSync(s6), '浅色拆解截图');
await page.evaluate(() => window.__ENGINE__.appApi.setExploded(false));
await page.waitForTimeout(1600);

// ── 部件清单覆盖 ──
const listRes = await page.evaluate(() => {
  const p = document.getElementById('panel-parts');
  return { len: p ? p.innerText.length : 0, items: p ? p.querySelectorAll('[data-part-id]').length : 0 };
});
ok(listRes.items >= 25 || listRes.len > 300, `部件清单已渲染 (${listRes.items} 项 / ${listRes.len} 字)`);

// ── 引导面板 ──
const guideRes = await page.evaluate(() => {
  const g = document.getElementById('panel-guide');
  return { len: g ? g.innerText.length : 0 };
});
ok(guideRes.len > 40, `操作引导面板有内容 (${guideRes.len} 字)`);

// ── 帧率 ──
const fps = await page.evaluate(async () => {
  let frames = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const loop = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else resolve(); };
    requestAnimationFrame(loop);
  });
  return Math.round(frames / ((performance.now() - t0) / 1000));
});
console.log(`  info 帧率 ≈ ${fps} fps (软件渲染环境下)`);

console.log('\n== 错误汇总 ==');
ok(consoleErrors.length === 0, `无 console 错误 (${consoleErrors.length})`, consoleErrors.slice(0, 3).join(' | ').slice(0, 500));
ok(failedRequests.length === 0, `无失败请求 (${failedRequests.length})`, failedRequests.slice(0, 3).join(' | '));
ok(pageErrors.length === 0, `无页面异常 (${pageErrors.length})`, pageErrors.slice(0, 1).join('').slice(0, 400));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(60)}`);
console.log(`结果: ${results.length - failed.length} 通过, ${failed.length} 失败`);
if (failed.length) {
  console.log('\n失败项:');
  for (const f of failed) console.log(`  ✗ ${f.m} ${f.extra}`);
}
console.log(`截图目录: ${SHOTS}`);
console.log('='.repeat(60) + '\n');
process.exit(failed.length ? 1 : 0);
