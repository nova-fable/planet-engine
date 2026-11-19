/** 共享契约自动化检查：在写业务代码前即可运行 */
import { registry, PartRecord, GROUP_DEFS, GROUP_BY_ID } from '../src/registry.js';
import { PARTS, ENGINE_META, SOURCE_LABELS, SEQUENCE } from '../src/data/parts.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok  ' + m)) : (fail++, console.log('  FAIL ' + m)); };

console.log('\n== registry 契约 ==');
ok(typeof registry.register === 'function', 'registry.register 存在');
ok(typeof registry.buildPickMap === 'function', 'registry.buildPickMap 存在');
ok(typeof registry.partOf === 'function', 'registry.partOf 存在');
ok(PartRecord.length >= 0, 'PartRecord 可构造');
const r = new PartRecord({ id: 't', label: 'T', group: 'base', object3D: null, explodeDir: null });
ok(r.id === 't' && r.pickable === true && r.explodeMode === 'linear', 'PartRecord 默认值正确');

console.log('\n== 数据完整性 ==');
const ids = Object.keys(PARTS);
ok(ids.length >= 25, `部件数量 >= 25 (实际 ${ids.length})`);
ok(ids.every((k) => PARTS[k].label && PARTS[k].labelEn), '每个部件都有中英文名');
ok(ids.every((k) => PARTS[k].desc && PARTS[k].fn && PARTS[k].material), '每个部件都有 desc/fn/material');
ok(ids.every((k) => Array.isArray(PARTS[k].specs) && PARTS[k].specs.length > 0), '每个部件都有 specs');
ok(ids.every((k) => PARTS[k].specs.every((s) => s.k && s.v !== undefined)), 'specs 项都有 k/v');
ok(ids.every((k) => ['official','derived','extrapolated'].includes(PARTS[k].source)), 'source 取值合法');
ok(ids.every((k) => PARTS[k].sourceNote), '每个部件都标注了来源说明');
ok(ids.every((k) => GROUP_BY_ID.has(PARTS[k].group)), '所有 group 都在 GROUP_DEFS 中定义');

console.log('\n== 来源诚实性 ==');
const official = ids.filter((k) => PARTS[k].source === 'official');
console.log(`  info 标注为 official 的部件 (${official.length}): ${official.join(', ') || '(无)'}`);
// 每个 official 部件都必须给出可核对的官方依据
const weakOfficial = official.filter((k) => {
  const n = PARTS[k].sourceNote || '';
  return n.length < 20 || !/官方|MOREVFX/.test(n);
});
ok(weakOfficial.length === 0, 'official 部件均给出可核对的官方依据', weakOfficial.join(', '));
ok(Object.values(SOURCE_LABELS).length === 3, 'SOURCE_LABELS 有 3 个等级');

console.log('\n== 官方口径一致性（依据 MOREVFX 视效解析）==');
ok(ENGINE_META.orientation === 'nozzle-up', '喷口朝向为向上（官方"喷口在云层之上"）');
ok(ENGINE_META.official?.heightM === 8000, '记录官方高度 8000 m');
ok(ENGINE_META.official?.legs === 7, '记录官方"七条主支撑腿"');
ok(ENGINE_META.count === 10000, '发动机数量为官方 10000 台');
const allText = ids.map((k) => (PARTS[k].desc || '') + (PARTS[k].sourceNote || '')).join('');
ok(!/导流槽/.test(allText.replace(/不存在[^。]*导流槽/g, '')), '已移除与"喷口朝上"矛盾的导流槽设定');
ok(/重核聚变|重聚变/.test(allText), '重聚变原理有体现');
ok(ids.includes('ignition-core'), '包含官方命名部件"点火核心"');

console.log('\n== 序列脚本 ==');
for (const [name, seq] of Object.entries(SEQUENCE)) {
  ok(seq.steps.length > 0, `${name} 有步骤`);
  ok(seq.steps.every((s) => typeof s.t === 'number' && s.text && s.event), `${name} 步骤字段完整`);
  const ts = seq.steps.map((s) => s.t);
  ok(ts.every((v, i) => i === 0 || v > ts[i - 1]), `${name} 时间戳严格递增`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
