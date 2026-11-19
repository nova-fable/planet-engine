/**
 * data/parts.js — 行星发动机部件知识库（SHARED CONTRACT）
 *
 * 这是"部件详情"面板的唯一数据源。结构：
 *   PARTS[id] = {
 *     label, labelEn, group, category,
 *     desc,                     // 中文详述
 *     fn,                       // 功能说明
 *     material,                 // 用料
 *     specs: [{ k, v }],        // 参数表
 *     source: 'official' | 'derived' | 'extrapolated',
 *     sourceNote,               // 来源说明（必须诚实标注）
 *   }
 *
 * source 语义（重要 —— 不许把推测包装成官方设定）：
 *   official     = 电影/官方设定集/宣发材料中明确出现的
 *   derived      = 由官方尺寸按工程比例推算的
 *   extrapolated = 为实现可视化而做的合理工程外推
 */

export const ENGINE_META = {
  name: '行星发动机',
  nameEn: 'Planetary Engine',
  model: '重聚变发动机 · 一号机 / Heavy-Fusion Engine Unit-01',
  subtitle: '流浪地球计划 · 移山计划核心推进装置',
  totalHeight: 11000,          // 米，本模型使用的可视化标称高度
  /* 官方口径：坝体环宽约 300 m。本模型为让塔脚与坝顶无缝衔接，
     坝体外径取 4,028 单位（≈ 环形坝体 + 塔脚落于坝顶）。
     注意：这是可视化重建值，官方公布的是"直径 36 公里 / 30 公里"量级。 */
  damOuterDiameter: 4028,      // 单位，模型实际坝体外径（由 assembly DIMS 决定）
  damRingWidth: 460,           // 单位，坝顶环宽（官方量级 ≈ 300 m，此处含塔脚搭接）
  count: 10000,                // 台推进发动机（官方设定；另有约 2000 台转向发动机）
  steering: 2000,              // 台转向发动机（官方设定）
  thrustPerUnit: 1.5e9,        // 吨推力量级（民间推测，非官方）
  fuel: '岩石 / 重核聚变（重聚变）',
  igniteTemp: 1.0e8,           // K
  orientation: 'nozzle-up',    // 喷口朝上，向天空排气

  /* ── 官方数据（MOREVFX 视效解析，逐条可溯源）── */
  official: {
    heightM: 8000,             // "行星发动机高达8000米，且发动机喷口在云层之上"
    heightAltM: 9000,          // 同系列另一篇作"高9000多米"，官方口径本身不一致
    diameterM: 36000,          // "设定里发动机直径有36公里"
    diameterAltM: 30000,       // 另有"引擎发动机直径就有30公里"
    parts: '喷口、支撑腿上下、腰部细节、坝体内外（共六个部分）',
    legs: 7,                   // 七条主支撑腿 + 调节支撑臂
    elevators: 34,             // 坝体内通往地下城的升降井
  },

  note:
    '官方口径：MOREVFX（影片视效制作方）在《流浪地球2》视效解析中给出"高达8000米、' +
    '直径36公里、喷口在云层之上"，并将整机分为"喷口、支撑腿上下、腰部细节、坝体内外"六个部分；' +
    '基座为环形防洪堤（坝体），塔身由七条主支撑腿支撑，燃料为岩石重核聚变。' +
    '需注意：官方自身对高度（8000 米 / 9000 多米）与直径（36 公里 / 30 公里）口径并不一致；' +
    '小说原著中的 11000 米并非电影设定。本模型为保证观感采用 11000 单位标称高度，' +
    '结构与比例依据上述官方描述重建，逐项来源等级见各部件标注。',
};

/** 来源等级标签（UI 展示用） */
export const SOURCE_LABELS = {
  official: { text: '官方设定', cls: 'src-official' },
  derived: { text: '按比例推算', cls: 'src-derived' },
  extrapolated: { text: '工程外推', cls: 'src-extrapolated' },
};

const P = (o) => o;
const spec = (k, v) => ({ k, v });

export const PARTS = {
  // ══════════════ 基础与支撑 ══════════════
  'base-ring': P({
    label: '环形坝体基座',
    labelEn: 'Annular Dam Foundation',
    group: 'base',
    category: '承力结构',
    desc:
      '环绕发动机根部的巨型环形防洪堤（坝体）。官方设定中发动机底部为环形堤坝结构，' +
      '堤顶可通行车辆并布置控制中心，坝体内设有多条通往地下城的升降竖井。' +
      '坝体既是承力基础，也抵御外部恶劣环境对发动机根部的侵蚀。',
    fn: '承担整机自重与推力反作用力并扩散至地壳；同时作为防洪与防护屏障。',
    material: '大体积混凝土（参考三峡大坝质感）/ 金属结构点缀',
    specs: [
      spec('外径', '≈ 3,400 m'),
      spec('环宽', '≈ 300 m'),
      spec('坝高', '≈ 500 m'),
      spec('坝顶', '可通行道路 + 控制中心'),
    ],
    source: 'official',
    sourceNote:
      '官方：MOREVFX 视效解析确认发动机设有"坝体"（坝体内外为六大设计部分之一），' +
      '并描述坝体内设控制中心与通往地下城的升降井。具体尺寸为可视化重建。',
  }),
  'base-buttress': P({
    label: '主支撑腿',
    labelEn: 'Main Support Legs',
    group: 'base',
    category: '承力结构',
    desc:
      '官方设定中发动机由"七条主支撑腿"支撑。官方的设计意图是：由于剧中存在猛烈地震，' +
      '支撑结构必须能够相互分担受力，并在支撑点加强缓冲，因此采用了多腿斜撑的骨架形式。' +
      '每条腿的外侧设有多个可移动的多功能维修平台。',
    fn: '承担塔身全部竖向荷载与地震剪力，通过多腿斜撑相互分担并缓冲。',
    material: '钢—混凝土组合结构',
    specs: [
      spec('数量', '7 条主支撑腿'),
      spec('附加', '7 组调节支撑臂'),
      spec('每条腿维护平台', '多平台 · 可移动'),
      spec('设计工况', '强地震 + 荷载重分配'),
    ],
    source: 'official',
    sourceNote:
      '官方：MOREVFX 明确提及"七条主支撑腿上的多平台多功能可移动化维修平台"，' +
      '并在《流浪地球》解析 Part1"引擎侧方支撑结构设计"中说明因地震而改为可分担受力的支撑架结构。',
  }),
  'anchor-bolt': P({
    label: '地脚锚栓',
    labelEn: 'Anchor Bolts',
    group: 'base',
    category: '紧固件',
    desc:
      '将主支撑腿与坝体环梁锁定在一起的特大型锚栓。本模型中以实例化方式生成，' +
      '每一颗都参与拾取与高亮，可用于演示"细致到一颗螺丝"的装配关系。',
    fn: '承受支撑腿根部拔力，防止结构在推力脉动与地震下松脱。',
    material: '42CrMo 高强合金钢',
    specs: [
      spec('规格', 'M900 × 4200'),
      spec('数量', '7 × 16 = 112 颗（另加坝体周向锚固）'),
      spec('预紧力', '≈ 8,500 t / 颗'),
      spec('防腐', '热浸镀锌 + 密封罩'),
    ],
    source: 'extrapolated',
    sourceNote: '规格按坝体与支撑腿尺度等比例放大工程锚栓得到。',
  }),

  // ══════════════ 主体结构 ══════════════
  'shell-lower': P({
    label: '下部塔身壳体',
    labelEn: 'Lower Tower Shell',
    group: 'structure',
    category: '主体结构',
    desc:
      '发动机最粗壮的一段锥形壳体，坐落在基座环梁上。外壁带有密集的竖向加劲肋与' +
      '水平环梁，形成典型的"格构式"外观，也是电影里最容易辨认的特征之一。',
    fn: '传递全部竖向荷载，并为内部反应室提供外围防护。',
    material: 'Q690 高强钢 + 钛合金复合板',
    specs: [
      spec('高度', '≈ 2,600 m'),
      spec('底部直径', '≈ 2,400 m'),
      spec('顶部直径', '≈ 1,700 m'),
      spec('壁厚', '≈ 18 m（含加劲肋）'),
    ],
    source: 'derived',
    sourceNote: '按 11,000 m 总高与电影中可见的直径/高度比例推算。',
  }),
  'shell-mid': P({
    label: '中部塔身壳体',
    labelEn: 'Mid Tower Shell',
    group: 'structure',
    category: '主体结构',
    desc:
      '中段壳体继续收分，外表面布置有燃料主管道、检修步道与散热鳍片。' +
      '此段是燃料注入系统与反应室之间的过渡区。',
    fn: '继续收分传递荷载，同时作为管路与检修系统的安装基面。',
    material: 'Q690 高强钢',
    specs: [
      spec('高度', '≈ 2,900 m'),
      spec('直径', '≈ 1,700 → 1,150 m'),
      spec('加劲肋', '96 道竖向 / 12 道环向'),
    ],
    source: 'derived',
    sourceNote: '同上，按可见比例推算。',
  }),
  'shell-upper': P({
    label: '上部塔身壳体',
    labelEn: 'Upper Tower Shell',
    group: 'structure',
    category: '主体结构',
    desc:
      '靠近顶部的收分段，直径最小、结构最轻，主要包覆磁约束系统的上部线圈组。',
    fn: '包覆并保护磁约束线圈与上部控制设备。',
    material: '钛合金 / 复合材料蒙皮',
    specs: [
      spec('高度', '≈ 2,400 m'),
      spec('直径', '≈ 1,150 → 760 m'),
      spec('蒙皮厚', '≈ 4.5 m'),
    ],
    source: 'derived',
    sourceNote: '按可见比例推算。',
  }),
  'ring-girder': P({
    label: '水平环梁',
    labelEn: 'Horizontal Ring Girders',
    group: 'structure',
    category: '主体结构',
    desc:
      '沿塔身高度分布的多道巨型环梁，每隔一定高度设置一道，起到"箍"的作用，' +
      '同时兼作外部检修平台的支撑环。',
    fn: '约束壳体径向变形，抵抗风载与内压，兼作检修平台支承。',
    material: '箱型钢梁',
    specs: [
      spec('道数', '14 道'),
      spec('间距', '≈ 780 m'),
      spec('梁高', '≈ 46 m'),
    ],
    source: 'extrapolated',
    sourceNote: '按超高层结构常见环带桁架布置外推。',
  }),
  'rib-vertical': P({
    label: '竖向加劲肋',
    labelEn: 'Vertical Stiffener Ribs',
    group: 'structure',
    category: '主体结构',
    desc:
      '密布于塔身外壁的竖向肋条，是发动机外观最重要的"质感"来源。' +
      '本模型以实例化网格生成数百道肋条，兼顾观感与性能。',
    fn: '提高壳体局部稳定性，防止在巨大轴压与内压下屈曲。',
    material: '轧制型钢',
    specs: [
      spec('数量', '≈ 480 道'),
      spec('截面', '≈ 22 × 60 m'),
      spec('间距', '≈ 12 m'),
    ],
    source: 'extrapolated',
    sourceNote: '数量按壳体周长与合理肋距反算，非官方。',
  }),

  // ══════════════ 燃料注入系统 ══════════════
  'fuel-main-pipe': P({
    label: '燃料主管道',
    labelEn: 'Main Fuel Duct',
    group: 'fuel',
    category: '燃料系统',
    desc:
      '电影中可清晰看到沿塔身外壁攀爬的粗大管路。本模型设置了 24 条周向均布的主管道，' +
      '自基座附近的岩石破碎—输送端口一路爬升至反应室入口，管身带有膨胀弯与法兰节。',
    fn: '将粉碎后的岩石燃料以等离子态输送至聚变反应室。',
    material: '内衬陶瓷的耐高温合金管',
    specs: [
      spec('数量', '24 条'),
      spec('管径', '≈ 46 m'),
      spec('长度', '≈ 6,800 m'),
      spec('输送介质', '岩石等离子体浆料'),
      spec('工况', '≈ 3,200 K / 8 MPa'),
    ],
    source: 'extrapolated',
    sourceNote: '管路数量与走向为可视化重建；"岩石燃料"概念来自官方设定。',
  }),
  'fuel-flange': P({
    label: '管道法兰',
    labelEn: 'Pipe Flanges',
    group: 'fuel',
    category: '燃料系统',
    desc:
      '主管道分段处的连接法兰，沿每条管路分布多处。法兰外圈带有均布的紧固螺栓，' +
      '是近距离观察时最能体现"机械感"的细节之一。',
    fn: '连接管道分段，并提供可拆卸的检修接口。',
    material: '锻钢法兰 + 石墨缠绕垫',
    specs: [
      spec('规格', 'DN 46000 / PN 100'),
      spec('数量', '24 × 9 = 216 处'),
      spec('密封', '金属缠绕垫 + 三重冗余'),
    ],
    source: 'extrapolated',
    sourceNote: '按管道分段需要布置。',
  }),
  'fuel-pump': P({
    label: '燃料泵组',
    labelEn: 'Fuel Pump Assemblies',
    group: 'fuel',
    category: '燃料系统',
    desc:
      '布置在塔身下部的增压泵组，为燃料浆料提供克服 6,800 m 高差所需的压头。',
    fn: '对燃料加压并稳定流量，保证反应室供料连续。',
    material: '耐热合金泵壳 + 陶瓷内衬',
    specs: [
      spec('数量', '12 组'),
      spec('单组功率', '≈ 2.4 TW'),
      spec('流量', '≈ 380 t/s'),
    ],
    source: 'extrapolated',
    sourceNote: '功率量级按整机推力反推，非官方数值。',
  }),
  'fuel-injector': P({
    label: '燃料喷注环',
    labelEn: 'Fuel Injector Ring',
    group: 'fuel',
    category: '燃料系统',
    desc:
      '环绕反应室入口的喷注环，将燃料分为 96 股切向射流注入，形成旋流以延长约束时间。',
    fn: '切向注入燃料，形成旋流稳定燃烧。',
    material: '钨铜合金喷注嘴',
    specs: [
      spec('喷注孔', '96 个'),
      spec('注入角', '切向 24°'),
      spec('单孔流量', '≈ 4 t/s'),
    ],
    source: 'extrapolated',
    sourceNote: '参照现代火箭发动机喷注器原理外推。',
  }),

  // ══════════════ 聚变反应室 ══════════════
  'reactor-vessel': P({
    label: '中央承重柱 / 重聚变燃烧室',
    labelEn: 'Central Column / Heavy-Fusion Chamber',
    group: 'reactor',
    category: '核心',
    desc:
      '整座发动机的心脏，即官方设定中的"中央承重柱／燃烧室"——喷口正下方的巨型柱体结构。' +
      '官方设定中行星发动机依靠"重核聚变"（重聚变）产生的巨大能量推动地球，' +
      '燃料为普通岩石。柱体内含重聚变反应堆与点火核心，外部有高架桥接入。' +
      '反应室需在约 1 亿 K 量级长期工作，故内壁为多层钨基装甲，外侧被磁约束线圈与冷却回路包裹。',
    fn: '承载重核聚变反应，将质量转化为定向推进能量，同时作为塔身中央承重构件。',
    material: '钨基装甲内衬 + 钒合金结构层',
    specs: [
      spec('内径', '≈ 620 m'),
      spec('高度', '≈ 1,300 m'),
      spec('工作温度', '≈ 1 × 10⁸ K'),
      spec('内压', '≈ 25 MPa'),
      spec('内衬', '钨装甲 12 层'),
      spec('燃料', '岩石 · 重核聚变'),
    ],
    source: 'official',
    sourceNote:
      '官方：MOREVFX 确认发动机"依靠重核聚变产生的巨大能量"，设定中该柱体为中央承重柱／燃烧室，' +
      '内含点火核心与重聚变反应堆。具体尺寸与温度量级为可视化重建。',
  }),
  'ignition-core': P({
    label: '点火核心',
    labelEn: 'Ignition Core',
    group: 'reactor',
    category: '核心',
    desc:
      '官方设定与概念设计中明确命名的部件（MOREVFX 气氛图即以"点火核心"为题）。' +
      '点火核心位于燃烧室底部，是触发重核聚变的关键装置；影片中需要消耗性的' +
      '"火石"插入点火闸门才能启动。本模型将其表现为燃烧室底部的球柱状发生器，' +
      '点火序列中它会率先亮起并向上升起等离子体。',
    fn: '触发并维持重核聚变反应，是整机点火的起点。',
    material: '钨基复合装甲 + 强场发生组件',
    specs: [
      spec('位置', '燃烧室底部 · 点火闸门上方'),
      spec('触发方式', '火石（消耗性）插入点火闸门'),
      spec('点火温度', '≈ 1 × 10⁸ K'),
      spec('形式', '球柱状强场发生器'),
    ],
    source: 'official',
    sourceNote:
      '官方：MOREVFX《流浪地球》视效解析中出现"镜头气氛图设计-点火核心"，' +
      '确认"点火核心"为正式部件命名；"火石"为影片情节设定。具体几何为可视化重建。',
  }),
  'reactor-liner': P({
    label: '钨基内衬层',
    labelEn: 'Tungsten Liner',
    group: 'reactor',
    category: '核心',
    desc: '反应室内壁的多层钨基装甲，用于抵抗中子辐照与等离子体冲刷。',
    fn: '承受高温等离子体冲刷与中子辐照，保护结构层。',
    material: '钨—铼合金',
    specs: [spec('层数', '12 层'), spec('单层厚', '≈ 0.8 m'), spec('寿命', '≈ 5 年更换')],
    source: 'extrapolated',
    sourceNote: '参照聚变堆第一壁工程概念外推。',
  }),
  'magnetic-coil': P({
    label: '磁约束线圈',
    labelEn: 'Magnetic Confinement Coils',
    group: 'confinement',
    category: '约束系统',
    desc:
      '环绕反应室的超导线圈组，共 18 组环形线圈，产生强磁场把上亿度的等离子体' +
      '悬空约束，使其不与任何实体壁面接触——这是装置能够存续的前提。',
    fn: '产生环形强磁场，约束高温等离子体并控制其形态。',
    material: '高温超导带材 + 液氦冷却夹套',
    specs: [
      spec('线圈数', '18 组'),
      spec('磁场强度', '≈ 24 T'),
      spec('工作温度', '≈ 4.2 K'),
      spec('导体', 'REBCO 高温超导带材'),
    ],
    source: 'extrapolated',
    sourceNote: '磁场与线圈数为按托卡马克工程放大的合理外推。',
  }),
  'coil-cryo': P({
    label: '低温冷屏',
    labelEn: 'Cryogenic Shields',
    group: 'confinement',
    category: '约束系统',
    desc: '包裹超导线圈的液氦冷却夹套与多层绝热冷屏，维持线圈的超导工作温度。',
    fn: '为超导线圈提供 4.2 K 级低温环境。',
    material: '多层绝热毡 + 不锈钢夹套',
    specs: [spec('冷媒', '液氦 / 超流氦'), spec('漏热', '≤ 0.4 W/m²')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),

  // ══════════════ 喷口与推进 ══════════════
  'nozzle-throat': P({
    label: '喷管喉部',
    labelEn: 'Nozzle Throat',
    group: 'nozzle',
    category: '推进系统',
    desc:
      '拉瓦尔喷管的最小截面处，等离子体在此达到声速，随后在扩张段加速到超音速。' +
      '本机喷口位于塔顶、云层之上，射流垂直向上排出。',
    fn: '将反应室的高压等离子体加速至临界状态。',
    material: '碳—碳复合材料 + 主动冷却',
    specs: [spec('喉径', '≈ 260 m'), spec('喉部温度', '≈ 4,500 K')],
    source: 'extrapolated',
    sourceNote: '按拉瓦尔喷管原理与整机尺度外推。',
  }),
  'nozzle-bell': P({
    label: '喷口阵列',
    labelEn: 'Nozzle Array',
    group: 'nozzle',
    category: '推进系统',
    desc:
      '位于塔顶的喷口阵列，是整机辨识度最高的特征。官方设定中发动机"喷口在云层之上"，' +
      '喷口采用气动塞式（aerospike）喷管与圆筒形喷管混合的环形阵列布置，' +
      '内壁为再生冷却通道，外部设加强环与作动器安装座。射流垂直向上喷出，' +
      '在地面观测时表现为"上帝的喷灯"。',
    fn: '加速并定向排出等离子体，产生主推力推动地球。',
    material: '碳—碳复合材料 + 铜合金冷却夹套',
    specs: [
      spec('形式', '气动塞式 + 圆筒形混合阵列'),
      spec('出口直径', '≈ 780 m'),
      spec('扩张比', '≈ 9 : 1'),
      spec('排气速度', '≈ 120 km/s'),
      spec('排气方向', '垂直向上'),
    ],
    source: 'official',
    sourceNote:
      '官方：MOREVFX 确认喷口位于云层之上；气动塞式喷管阵列形式为爱好者社区依据影片画面整理。' +
      '出口尺寸与排气速度为工程外推。',
  }),
  'nozzle-actuator': P({
    label: '喷管作动器',
    labelEn: 'Nozzle Actuators',
    group: 'nozzle',
    category: '推进系统',
    desc:
      '推动喷管偏转的巨型液压作动器，用于推力矢量控制，实现整机姿态调整。' +
      '每台喷管配 8 组作动器。',
    fn: '驱动喷管摆动，实现推力矢量与姿态控制。',
    material: '锻钢液压缸',
    specs: [spec('数量', '8 组/喷管'), spec('行程', '≈ 90 m'), spec('推力', '≈ 120,000 tf')],
    source: 'extrapolated',
    sourceNote: '参照液体火箭发动机摆动机构外推。',
  }),
  'flame-trench': P({
    label: '喷口转向臂',
    labelEn: 'Nozzle Steering Arms',
    group: 'nozzle',
    category: '推进系统',
    desc:
      '环绕喷口阵列的作动臂组，官方资产划分中列为独立部件"喷口转向臂"。' +
      '影片设定中喷口外围设有屏障壁，由机械臂驱动收放，用于约束等离子体射流、' +
      '并在点火与转向时调整喷流边界。注意：本机喷口朝上向天空排气，' +
      '射流不会冲击地面，因此不存在地面导流槽。',
    fn: '驱动屏障壁收放，约束等离子体射流并参与推力矢量控制。',
    material: '焊接箱型钢臂 + 耐热屏障壁',
    specs: [
      spec('形式', '周向作动臂阵列'),
      spec('屏障壁', '可收放 · 约束射流'),
      spec('排气方向', '垂直向上（云层之上）'),
    ],
    source: 'official',
    sourceNote:
      '官方：MOREVFX 将"发射喷口、喷口转向臂"列为独立资产区域；' +
      '喷口朝上、位于云层之上亦为官方明确描述。',
  }),

  // ══════════════ 冷却系统 ══════════════
  'cooling-fin': P({
    label: '散热鳍片组',
    labelEn: 'Cooling Fins',
    group: 'cooling',
    category: '热管理',
    desc:
      '沿塔身中上部呈辐射状布置的散热鳍片，把反应室与磁约束系统的废热辐射到大气中。' +
      '本模型设置 6 层、每层 32 片。',
    fn: '辐射排散反应室与线圈系统的废热。',
    material: '铝合金挤压型材 + 高发射率涂层',
    specs: [
      spec('层数', '6 层'),
      spec('每层片数', '32 片'),
      spec('单片面积', '≈ 42,000 m²'),
      spec('排热功率', '≈ 90 TW'),
    ],
    source: 'extrapolated',
    sourceNote: '排热功率按能量平衡估算，非官方。',
  }),
  'coolant-pipe': P({
    label: '冷却剂回路',
    labelEn: 'Coolant Loop Piping',
    group: 'cooling',
    category: '热管理',
    desc: '连接反应室冷却夹套、鳍片与换热站的闭式冷却回路，管身带有波纹补偿节。',
    fn: '把热量从反应室输运至散热面。',
    material: '不锈钢波纹管',
    specs: [spec('回路数', '4 条'), spec('流量', '≈ 210 t/s'), spec('介质', '液态钠钾合金')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),
  'heat-exchanger': P({
    label: '换热站',
    labelEn: 'Heat Exchanger Station',
    group: 'cooling',
    category: '热管理',
    desc: '一次回路与二次回路之间的换热装置，兼作事故工况下的余热排出通道。',
    fn: '在冷却回路之间传递热量并隔离放射性。',
    material: '钛合金板式换热器',
    specs: [spec('数量', '8 座'), spec('换热量', '≈ 12 TW / 座')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),

  // ══════════════ 控制与电力 ══════════════
  'control-deck': P({
    label: '控制舱段',
    labelEn: 'Control Deck',
    group: 'control',
    category: '控制中枢',
    desc:
      '位于塔身一侧的控制舱，内部为发动机的联合控制系统，负责点火时序、' +
      '磁场配平、燃料配比与全机状态监控。',
    fn: '全机控制中枢，执行点火与推力调节指令。',
    material: '屏蔽复合装甲舱体',
    specs: [spec('尺寸', '≈ 340 × 180 × 120 m'), spec('冗余', '三模冗余'), spec('屏蔽', '抗中子/γ')],
    source: 'extrapolated',
    sourceNote: '可视化为功能需要而设置。',
  }),
  'power-bus': P({
    label: '电力母线',
    labelEn: 'Power Bus',
    group: 'control',
    category: '电力系统',
    desc: '沿塔身敷设的超高功率输配电母线，为磁约束线圈、泵组与控制系统供电。',
    fn: '在电源与各用电系统之间分配电能。',
    material: '强迫风冷母线槽',
    specs: [spec('电压等级', '≈ 3,000 kV'), spec('容量', '≈ 40 TW')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),
  'sensor-array': P({
    label: '传感阵列',
    labelEn: 'Sensor Array',
    group: 'control',
    category: '监测',
    desc: '分布于塔身各高度的温度、应变、中子通量与位移传感器，构成健康监测网络。',
    fn: '实时监测结构状态与反应堆工况。',
    material: '耐辐照传感器组件',
    specs: [spec('测点数', '≈ 26,000 点'), spec('采样率', '1 kHz')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),
  'beacon-light': P({
    label: '航空障碍灯',
    labelEn: 'Aviation Beacon',
    group: 'control',
    category: '安全设施',
    desc: '塔身各层设置的高亮障碍灯与警示灯带，在夜间与尘暴中标识结构轮廓。',
    fn: '标识构筑物轮廓，防止航空器碰撞。',
    material: 'LED 灯组 + 防尘罩',
    specs: [spec('数量', '≈ 1,600 组'), spec('可见距离', '≈ 80 km')],
    source: 'extrapolated',
    sourceNote: '按超高构筑物航空警示规范设置。',
  }),

  // ══════════════ 辅助与检修 ══════════════
  'maintenance-platform': P({
    label: '检修平台',
    labelEn: 'Maintenance Platforms',
    group: 'aux',
    category: '检修设施',
    desc: '环绕塔身各环梁设置的格栅检修平台，配护栏与安全网。',
    fn: '为检修人员提供作业面。',
    material: '热浸镀锌格栅',
    specs: [spec('层数', '14 层'), spec('宽度', '≈ 24 m')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),
  'elevator-shaft': P({
    label: '升降竖井',
    labelEn: 'Elevator Shaft',
    group: 'aux',
    category: '检修设施',
    desc: '贯通塔身的检修升降系统，配备多台高速升降轿厢，是从基座到达顶部的通道。',
    fn: '输送人员与备件，兼作紧急疏散通道。',
    material: '钢结构井道 + 防火围护',
    specs: [spec('竖井数', '4 座'), spec('提升高度', '≈ 8,400 m'), spec('轿厢', '6 台/井')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),
  'gantry-crane': P({
    label: '塔顶吊机',
    labelEn: 'Gantry Cranes',
    group: 'aux',
    category: '检修设施',
    desc: '安装在塔顶的巨型门式吊机，用于吊装磁约束线圈、喷管组件等大型部件。',
    fn: '大件吊装与更换。',
    material: '焊接箱型钢结构',
    specs: [spec('数量', '4 台'), spec('起重量', '≈ 32,000 t'), spec('跨度', '≈ 420 m')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),
  'warning-stripe': P({
    label: '警示标识带',
    labelEn: 'Warning Stripes',
    group: 'aux',
    category: '标识',
    desc: '基座与平台边缘的黄黑警示色带，以及中英文安全标识。',
    fn: '安全警示与区域标识。',
    material: '反光贴膜 / 耐候涂料',
    specs: [spec('形式', '黄黑 45° 斜纹')],
    source: 'extrapolated',
    sourceNote: '按工业安全标识惯例设置。',
  }),
  'cable-tray': P({
    label: '电缆桥架',
    labelEn: 'Cable Trays',
    group: 'aux',
    category: '电力系统',
    desc: '沿塔身外壁敷设的电缆桥架，承载控制、信号与动力电缆。',
    fn: '敷设并保护各类电缆。',
    material: '热浸镀锌桥架',
    specs: [spec('长度', '≈ 42,000 m'), spec('层数', '3 层')],
    source: 'extrapolated',
    sourceNote: '工程外推。',
  }),
};

/** 点火 / 发射 时序脚本（UI 与特效层共享） */
export const SEQUENCE = {
  ignition: {
    label: '模拟点火',
    steps: [
      { t: 0,    text: '燃料泵组启动 · 注入岩石浆料', event: 'pumps' },
      { t: 900,  text: '磁约束屏障励磁 · 建立约束磁场', event: 'coils' },
      { t: 1900, text: '喷注环切向注入 · 形成旋流', event: 'inject' },
      { t: 2800, text: '火石插入点火闸门 · 点火核心起爆', event: 'ignite' },
      { t: 3900, text: '重核聚变建立 · 燃烧室达 10⁸ K', event: 'burn' },
      { t: 4900, text: '等离子体贯穿喉部 · 喷口阵列起振', event: 'nozzle' },
      { t: 5900, text: '射流突破云层 · 推力达额定值', event: 'stable' },
    ],
  },
  launch: {
    label: '模拟发射',
    steps: [
      { t: 0,    text: '全机自检 · 冗余系统在线', event: 'check' },
      { t: 900,  text: '坝体水冷与防护系统开启', event: 'dam' },
      { t: 1800, text: '预点火 · 燃烧室预热', event: 'preignite' },
      { t: 2800, text: '主点火 · 推力爬升至 60%', event: 'ignite' },
      { t: 3900, text: '转向臂解锁 · 屏障壁约束配平', event: 'vector' },
      { t: 4900, text: '全推力 · 地球推进开始', event: 'full' },
    ],
  },
};
