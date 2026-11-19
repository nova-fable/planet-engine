# AGENTS.md — 开发规范

本文件规定本仓库的**编码规范、提交规范与协作流程**。
无论你是人类开发者还是 AI Agent，向本仓库提交代码前都必须遵守。

> 目标：让代码在**没有构建步骤、没有框架、没有依赖**的前提下保持长期可维护。

---

## 1. 技术约束（硬性）

| 约束 | 说明 |
|---|---|
| **仅 Three.js** | 渲染只允许使用 Three.js。禁止引入 React/Vue/Svelte、jQuery、GSAP、tween.js 等任何库 |
| **零构建** | 不使用 webpack/vite/rollup/tsc。源码即产物，浏览器直接加载 |
| **原生 ES Module** | 全部使用 `import` / `export`，不使用 CommonJS |
| **无外部资源** | 不加载任何外部 3D 模型、图片、字体、CDN。贴图必须程序化生成（`CanvasTexture`） |
| **本地化依赖** | 新增 Three.js addon 必须下载到 `vendor/addons/` 并**改写为相对路径导入** |
| **不依赖网络** | 页面在完全离线环境下必须能正常运行 |

### 新增 vendor 文件的正确做法

```bash
# 1. 下载（版本必须与 vendor/three.module.js 一致，当前 r160）
curl -sS -o vendor/addons/Foo.js \
  "https://unpkg.com/three@0.160.0/examples/jsm/<path>/Foo.js"

# 2. 改写导入路径（关键！unpkg 的原始路径是 ../ 相对结构）
sed -i '' -E "s#from '(\.\./)+([a-zA-Z]+)/#from './#g; s#from 'three'#from '../three.module.js'#g" \
  vendor/addons/Foo.js

# 3. 校验所有 import 都能解析
node -e "
const fs=require('fs');
for (const f of fs.readdirSync('vendor/addons')) {
  const src=fs.readFileSync('vendor/addons/'+f,'utf8');
  const bad=[...src.matchAll(/from '([^']+)'/g)].map(m=>m[1])
    .filter(p=>p!=='../three.module.js' && !fs.existsSync('vendor/addons/'+p.replace('./','')));
  if(bad.length) console.log('UNRESOLVED',f,bad);
}
console.log('import graph OK');
"
```

---

## 2. 目录与写入范围

| 路径 | 职责 | 谁可以改 |
|---|---|---|
| `src/registry.js` | **共享契约**：部件注册表、分组定义 | 需评审 |
| `src/data/parts.js` | **共享契约**：部件知识库、序列脚本 | 需评审 |
| `src/main.js` | 编排层：渲染器 / 相机 / 灯光 / 主题 / 拾取 | 编排改动 |
| `src/assembly.js` | 按数据装配整机 | 几何改动 |
| `src/geometry.js` | 几何工厂（可复用图元） | 几何改动 |
| `src/materials.js` | 材质库与双主题调色 | 材质改动 |
| `src/animation.js` | 拆解动画引擎 | 动画改动 |
| `src/effects.js` | 点火 / 发射特效 | 特效改动 |
| `src/postprocessing.js` | 后处理（Bloom） | 后处理改动 |
| `src/ui/*` | 面板与 3D 标注 | UI 改动 |
| `src/styles/*` | 主题与面板样式 | UI 改动 |
| `vendor/**` | 第三方代码，**禁止手改逻辑**（仅允许改导入路径） | 谨慎 |
| `tests/**` | 测试 | 可改，但**不得弱化断言** |

### 修改共享契约的规则

`registry.js` 与 `data/parts.js` 是**全项目的接口**。改动前必须：

1. 检查所有引用方：`grep -rn "registry\.\|PARTS\." src/`
2. 同步更新受影响的模块与测试
3. 在提交信息中标注 `!`（破坏性变更）

---

## 3. 编码规范

### 3.1 语言与风格

- **纯 JavaScript**，不引入 TypeScript
- 缩进 **2 空格**，语句结尾**加分号**
- 字符串优先单引号；模板字符串用于插值
- 函数/变量 `camelCase`，类 `PascalCase`，常量 `UPPER_SNAKE_CASE`
- 文件名 `kebab-case`（如 `postprocessing.js`）

### 3.2 注释

- **注释用中文**，与项目文档保持一致
- 每个模块顶部必须有**文件级注释**，说明职责边界
- 复杂几何/数学必须注释**意图**（为什么这样切分），而非复述代码

```js
/**
 * assembly.js — 按数据装配整机
 *
 * 职责：把 data/parts.js 的描述变成 THREE.Object3D 树，并注册到 registry。
 * 不负责：材质定义（见 materials.js）、动画（见 animation.js）。
 */
```

### 3.3 Three.js 具体规范

```js
// ✅ 正确：显式设置色彩空间与色调映射（r160 API）
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// ❌ 错误：r152 之前的旧 API
renderer.outputEncoding = THREE.sRGBEncoding;

// ✅ 正确：重复 > 20 次的几何必须用 InstancedMesh
const bolts = new THREE.InstancedMesh(boltGeo, boltMat, 384);

// ✅ 正确：材质与几何共享，不在循环里 new
// ❌ 错误：for (…) scene.add(new THREE.Mesh(new THREE.BoxGeometry(...), new THREE.MeshStandardMaterial()))
```

**性能红线**：

| 指标 | 上限 |
|---|---|
| 三角面总数 | 900,000 |
| 单个基础图元分段数 | ≤ 40 |
| 重复实例（> 20 个） | 必须 `InstancedMesh` |
| 材质实例总数 | ≤ 80（共享，勿逐个部件新建） |

**几何安全**：所有程序化几何必须避免 `NaN`。除法前检查分母，`Math.pow` 底数为负时需处理。

### 3.4 Headless 兼容

模块必须能在 **无 `document` 的 Node 环境**下被导入（供测试使用）：

```js
// ✅ 正确
function makeCanvas(size) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  // …
}

// ❌ 错误：模块顶层直接访问 document，会导致测试 import 即崩溃
const canvas = document.createElement('canvas');
```

---

## 4. 测试规范

### 4.1 运行

```bash
node tests/contracts.test.mjs   # 数据契约（28 项）
node tests/test-assembly.mjs    # 几何与行为（66 项）
```

**提交前两套必须全绿。** 测试是 headless 的，不需要 WebGL。

### 4.2 铁律

> **不得为了让测试通过而弱化断言。** 断言失败时修**代码**，不是修**测试**。

若确信断言本身写错了，必须：修改断言 → 在提交信息中说明理由 → 说明为什么新断言更正确地验证了目标行为。

> 本项目真实发生过一次：六角头螺栓断言失败，一度想"修几何"，实际是
> `CylinderGeometry(r,r,h,6)` 的顶点落在 +X 方向，导致 X 为对角距、Z 为对边距，
> **断言里的比值写反了**。最终修的是断言，不是几何。

### 4.3 新增功能必须补测试

| 改动类型 | 必须新增的断言 |
|---|---|
| 新增部件 | 该部件已注册、有 mesh、无 NaN、位于合理高度区间 |
| 改几何尺度 | 包围盒 / 高度 / 居中 / 比例关系 |
| 改动画 | 展开→复位**零漂移**、可中断 |
| 改主题 | dark↔light 往返后材质值可还原 |
| 改异步序列 | promise 在**完成/中断/抢占/释放**四条路径都必须 settle |

### 4.4 官方设定一致性

凡涉及"还原程度"的改动，必须补充/保持 `test-assembly.mjs` 中 `e2)` 与 `e3)` 两节的断言：

- 喷口是最高部件（排气朝上）
- 除基座外无部件沉入地面
- 主支撑腿恰好 7 条
- 点火核心位于燃烧室底部
- 轮廓为**凹型收敛**且半径单调不增

---

## 5. 提交规范

### 5.1 提交信息格式

采用 **Conventional Commits**，**中文正文**，格式：

```
<type>(<scope>): <subject>

<body 可选：说明动机与影响>

<footer 可选：BREAKING CHANGE / Closes #12>
```

### 5.2 type 取值

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复缺陷 |
| `docs` | 仅文档 |
| `style` | 格式调整（不影响逻辑） |
| `refactor` | 重构（非新功能、非修复） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建 / 依赖 / vendor |
| `ci` | CI 与部署配置 |
| `chore` | 杂项 |

### 5.3 scope 取值

`engine`（装配几何）· `geometry` · `materials` · `animation` · `effects` · `postfx` · `ui` · `data` · `docs` · `ci` · `vendor` · `test`

### 5.4 subject 要求

- **不超过 50 字**，结尾**不加句号**
- 用**祈使句**：「增加」而非「增加了」
- 说清**做了什么**，而非「修改了一些东西」

### 5.5 示例

```bash
# ✅ 好
feat(engine): 按官方设定将喷口改为朝上并新增点火核心
fix(animation): 修复序列抢占时 promise 永不 settle
perf(geometry): 将 384 颗地脚锚栓改为实例化渲染
docs: 补充 MOREVFX 官方资料校正说明
ci: 增加 GitHub Pages 自动部署工作流

# ❌ 差
update                      # 没说什么
fix bug                     # 什么 bug
修改了一些东西                # 无信息量
feat: 重构了整个项目并优化了性能，修复了很多问题。   # 过长、混多件事、有句号
```

### 5.6 一个提交只做一件事

不要把「改几何 + 改 UI + 改文档」塞进同一个提交。按 `type`/`scope` 拆分。

### 5.7 破坏性变更

共享契约（`registry.js` / `data/parts.js` 的接口）发生不兼容改动时：

```bash
feat(data)!: 部件 source 字段改为三级枚举

BREAKING CHANGE: source 由自由文本改为 official/derived/extrapolated，
所有消费方需按新枚举处理。受影响：ui/panels.js、test-assembly.mjs
```

---

## 6. 分支与协作

### 6.1 分支

| 分支 | 用途 |
|---|---|
| `master` | 主分支，**始终可运行**，推送即自动测试并发布到 Pages |
| `feat/*` `fix/*` | 功能与修复分支 |

> 本项目采用 **artifact 部署方式**（`actions/deploy-pages`），**不使用 `gh-pages` 分支**。
> 若在历史仓库中见到该分支，可安全删除——先确认 Pages 的 Source 已设为
> **GitHub Actions**，再执行 `git push origin --delete gh-pages`。

### 6.2 合并前检查清单

- [ ] `node tests/contracts.test.mjs` 全绿
- [ ] `node tests/test-assembly.mjs` 全绿
- [ ] 浏览器实测：无 console 报错、无失败请求
- [ ] 深色与浅色两套主题均正常
- [ ] 无新增外部依赖与外部资源
- [ ] 新增功能已补测试
- [ ] 提交信息符合第 5 节规范

### 6.3 并行协作（重要教训）

> **同一个文件绝不允许两个 Agent 同时写入。**

本项目开发中真实发生过：Lead 在 subagent 正在编辑 `src/assembly.js` 时并发写入，
导致对方连续 3 次 `file changed since it was read` 并丢失修改。

规则：

1. **先声明写入范围，再动手**。范围一旦声明，其他成员不得写入该文件
2. **一个文件同一时刻只有一个写者**
3. 遇到 `FS_STALE_VERSION` / `file changed since it was read`：**重新读取 → 变基 → 重试**，不要强行覆盖
4. 共享契约（`registry.js` / `data/parts.js`）由**单一负责人**维护，其他成员只读
5. 任务分工按 **scope（目录/文件）** 切分，不按"功能点"切分

---

## 7. 目录卫生

- **不提交**：`node_modules/`、`.DS_Store`、编辑器配置、临时脚本、调试截图
- 截图如需保留，放入 `tests/shots/` 并在 README 中说明用途
- 不创建 `NOTES.md`、`TODO.md` 之类的临时文件；正式文档只有 `README.md` 与 `AGENTS.md`

---

## 8. AI Agent 专用约定

除上述内容外，AI Agent 还需遵守：

1. **不要臆造官方数据。** 涉及《流浪地球》设定时，必须实际查阅资料并给出可核对出处；
   无法核实的数值标为 `extrapolated`，绝不伪装成 `official`
2. **不要创建 README/文档文件**，除非任务明确要求
3. **不要弱化测试来"通过"**（见 4.2）
4. **报告要诚实**：说清哪些做了、哪些没做、哪些不确定。失败的实验也要说明
5. **改动前先读文件**，不要凭记忆修改
6. **提交前跑测试**，不要提交未验证的代码
