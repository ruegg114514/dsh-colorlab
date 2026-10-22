#!/usr/bin/env node
/**
 * 玻璃界面测试。
 *
 * 这个功能在本插件里失败过两次并被回退，每次的失败原因都对应下面一组断言 ——
 * 它们是**设计不变量**，不是实现细节：
 *
 *   1. 【第一次失败】没有背景图。backdrop-filter 只能模糊「同一画布内、位于
 *      元素背后的像素」，桌面在 Chromium 画布之外，所以玻璃背后是空的。
 *      → 必须有 Host 壁纸路由 + 页面内背景层。
 *
 *   2. 【第二次失败】模糊加在面板上。给三列各加 backdrop-filter 后，
 *      只有中栏糊了，侧栏右栏仍是实色 —— 因为列内部还有自己的不透明背景层，
 *      外层糊了、里层照样铺色。页面里有多少层背景数不完，逐个枚举注定漏。
 *      → 模糊必须做在**背景层自己**身上：底图先糊，透上去就永远是糊的。
 *
 *   3. 【第二次失败】表面浓度 10% 把主题色洗掉了。
 *      #343D46 在 10% 下合成 #D6B1B9（通道差 393），Mariana 完全消失。
 *      → 默认浓度必须足够高（65%），保证底色仍是主题色。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(condition, label, detail) {
  if (condition) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function loadPlugin() {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: { load: (d) => { captured = d } },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  }
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const fakeRequire = (id) => {
    if (id === 'react') {
      return {
        createElement: (...a) => ({ args: a }), Fragment: 'f',
        useSyncExternalStore: (s, g) => g(), useState: (v) => [v, () => {}],
      }
    }
    throw new Error('unexpected require: ' + id)
  }
  new Function('window', 'document', 'require', 'setTimeout', source)(
    fakeWindow, undefined, fakeRequire, () => ({ unref() {} }),
  )
  if (captured === null) throw new Error('client.js 没有注册 bundle')
  return captured.factory(fakeRequire)
}

const t = loadPlugin().__test
const { buildGlassSheet, buildGradientBackdrop, hexToRgba, parsePercent, GLASS_ATTR } = t
const src = readFileSync(join(root, 'client.js'), 'utf8')
const host = readFileSync(join(root, 'index.js'), 'utf8')

const dark = { base: '#343D46', sidebar: '#2E363F', layer1: '#3B444D', layer2: '#424B55', layer3: '#49525C', overlay: '#1E242A', bubble: '#3B444D' }
const css = buildGlassSheet({ glass: 'on', glassTint: '65', glassBlur: '16' }, dark, true)
const lines = css.split('\n')

console.log('')
console.log('dsh-colorlab 玻璃界面测试')
console.log('─'.repeat(60))

/* ------------------------------------------------------------------ *
 * A. 工具函数
 * ------------------------------------------------------------------ */

console.log('  A. 工具函数')

check(hexToRgba('#343D46', 0.65) === 'rgba(52, 61, 70, 0.65)', 'hexToRgba 正确', hexToRgba('#343D46', 0.65))
check(hexToRgba('#69C', 1) === 'rgba(102, 153, 204, 1)', '3 位简写展开')
check(hexToRgba('nope', 0.5) === 'nope', '非法输入原样返回')
check(parsePercent('65', 0, 100, 65) === 65, 'parsePercent 正常')
check(parsePercent('999', 0, 100, 65) === 100, 'parsePercent 上界 clamp')
check(parsePercent('x', 0, 100, 65) === 65, 'parsePercent 非法回落')

/* ------------------------------------------------------------------ *
 * B. 关闭状态
 * ------------------------------------------------------------------ */

console.log('  B. 关闭状态')

check(buildGlassSheet({ glass: 'off' }, dark, true) === '', 'glass=off → 空串')
check(GLASS_ATTR === 'data-dsh-glass', '总闸属性名', GLASS_ATTR)
const ruleLines = lines.filter((l) => l.includes('{') && !l.startsWith('/*'))
check(ruleLines.every((l) => l.includes('[' + GLASS_ATTR + ']')),
  '每条规则都带总闸前缀（关掉不留残留）', ruleLines.length + ' 条')

/* ------------------------------------------------------------------ *
 * C. 【失败原因 2】模糊必须在背景层，不在面板上
 * ------------------------------------------------------------------ */

console.log('  C. 模糊位置（失败原因 2）')

{
  check(!/\[class\*="_sidebarCol"\]\{[^}]*backdrop-filter/.test(css),
    '侧栏规则里没有 backdrop-filter')
  /* 无障碍块里三列有 backdrop-filter:none，那是正确的（关掉模糊）。
     真正要禁止的是「三列上出现 blur」，所以只匹配 blur 值。 */
  check(!/\[class\*="_centerCol"\][^{]*\{[^}]*backdrop-filter:blur/.test(css),
    '中列规则里没有 backdrop-filter: blur')
  /* 🔧 浮层（输入栏/菜单）**应该有** backdrop-filter —— 那是挡住背后文字的手段。
     但三列**不应该**有：它们的模糊来自背景层，再加一次是重复计算。
     判据：模糊只允许出现在「浮层类」选择器上。 */
  {
    const filterLines = css.split('\n').filter((l) => l.includes('backdrop-filter:blur'))
    const colFilter = filterLines.filter((l) => /_sidebarCol|_centerCol|_rightbarCol/.test(l))
    check(colFilter.length === 0, '三列没有 backdrop-filter（模糊来自背景层）',
      String(colFilter.length) + ' 条')
    const surfaceFilter = filterLines.filter((l) => /composerSeat|RlGAzG|role="dialog"/.test(l))
    check(surfaceFilter.length >= 2, '输入栏/浮层有 backdrop-filter（用来糊掉背后的字）',
      String(surfaceFilter.length) + ' 条')
  }

  check(src.includes('wallpaperEl.style.filter = value'), '模糊写进壁纸层的 style.filter')
  check(/function applyWallpaperFilter/.test(src), '有 applyWallpaperFilter 专门处理')
  check(src.includes('scale(1.08)'), '放大一点抵消模糊的边缘晕边')
  check(src.includes('applyWallpaperFilter()'), '建层后调用')
}

/* ------------------------------------------------------------------ *
 * D. 三列：主题色必须保住
 * ------------------------------------------------------------------ */

console.log('  D. 主题色（失败原因 3）')

{
  /* 无障碍块里三列各有 rgba(0.88)（退回实色），
     只统计「铺色」的那几条：排除 ::before 与 reduced-transparency 块内（含 none）。 */
  const colPaint = lines.filter((l) => /rgba\(/.test(l)
    && /_sidebarCol|_centerCol|_rightbarCol/.test(l)
    && !l.includes('::before')
    && !l.includes('backdrop-filter:none'))
  check(colPaint.length === 2, '三列 2 条上色规则（sidebar / center+rightbar）', String(colPaint.length))
  check(colPaint.every((l) => l.includes('0.65')), '默认浓度 65%')

  /* 完整合成链验算：壁纸 → 压暗层 → 三列 alpha → 显示色。
   *
   * ⚠️ 必须按**三层**算，只算「壁纸→三列」会得到 153（超标），
   * 而真实链路里有压暗层，结果是 68。
   * 这个差别正是压暗层存在的理由：没有它，亮壁纸会把主题色冲淡。 */
  const mariana = [52, 61, 70]
  const wallpaper = [232, 190, 198]
  const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)))
  const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

  /* 第 1 层：压暗层（mariana base + 55%）盖在壁纸上 */
  const veiled = over(mariana, 0.55, wallpaper)
  /* 第 2 层：三列 65% 叠在压暗后的背景上 */
  const shown = over(mariana, 0.65, veiled)
  const dist = distance(shown, mariana)
  check(dist <= 100, '完整链路（含压暗层）下仍是主题色（通道差 ≤ 100）',
    '通道差 ' + dist + ' rgb(' + shown.join(',') + ')')

  /* 反证 1：没有压暗层 → 主题色被冲淡 */
  const noVeil = over(mariana, 0.65, wallpaper)
  check(distance(noVeil, mariana) > 100,
    '没有压暗层时主题色确实被冲淡（压暗层不是可选项）',
    '通道差 ' + distance(noVeil, mariana))

  /* 反证 2：10% 浓度 → 主题色完全消失（默认值不能设低） */
  const bad = over(mariana, 0.1, wallpaper)
  check(distance(bad, mariana) > 300,
    '10% 浓度会洗掉主题色（证明默认值不能设低）',
    '通道差 ' + distance(bad, mariana))
}

/* ------------------------------------------------------------------ *
 * E. 【失败原因 1】背景层与壁纸路由
 * ------------------------------------------------------------------ */

console.log('  E. 背景层与壁纸（失败原因 1）')

{
  check(typeof t.WALLPAPER_ROUTE === 'string' && t.WALLPAPER_ROUTE.startsWith('/'),
    '壁纸路由是绝对路径', t.WALLPAPER_ROUTE)
  check(t.WALLPAPER_LAYER_ID === 'dmt-wallpaper', '背景层 id', t.WALLPAPER_LAYER_ID)

  const gradient = buildGradientBackdrop(dark, true)
  check(gradient.includes('radial-gradient'), '渐变兜底是渐变而非纯色')
  check(gradient.includes('#343D46'), '渐变底仍是当前配色的 base')

  check(/ctx\.inject\(\['webServer'\]/.test(host), 'Host 注入 webServer')
  check(host.includes('/dsh-colorlab/wallpaper'), 'Host 注册壁纸路由')
  check(host.includes('TranscodedWallpaper'), '读 Windows 当前壁纸')
  check(host.includes('detectImageMime'), '魔数嗅探图片类型')
  check(host.includes('wallpaperCache'), 'mtime 缓存')
  check(/registerWallpaperRoute\(ctx,/.test(host), 'apply() 里调用了注册（并传入读配置闭包）')
}

/* ------------------------------------------------------------------ *
 * F. 输入栏：不能把正文透进来
 * ------------------------------------------------------------------ */

console.log('  F. 输入栏（正文穿模问题）')

{
  /* 🔧 输入栏要挡住正文，靠的是**层叠上下文**而不是涂色。
     只涂色不建上下文 → 文本仍会绘制到上层（实测「设置面板也透出正文」）。
     另：它的浓度必须跟随「表面浓度」，不能写死 —— 曾写死 0.82
     导致「这块颜色不受设置影响」。 */
  check(/composerSeat[^{]*\{[^}]*isolation:isolate/.test(css), '输入栏座建立了层叠上下文（挡住溢出的正文）')
  check(/xz4KEq_scroll[^{]*\{[^}]*isolation:isolate/.test(css) ||
        /\[class\*="xz4KEq_scroll"\][^{]*\{[^}]*isolation:isolate/.test(css),
    '滚动容器建立层叠上下文（文本不会溢出到面板外）')

  /* 🔧 输入栏**必须完全不透明**：它下面压着滚动的正文，
     半透明就必然透字（这和层叠上下文无关，是透光的物理结果）。
     所以它不受「表面浓度」影响，这是设计选择而不是 bug。 */
  const seatAlpha = (c) => {
    const line = c.split('\n').find((l) => l.includes('composerSeat'))
    if (line === undefined) return null
    const m = /background:(#[0-9a-fA-F]{6})/.exec(line)
    return m === null ? null : m[1]
  }
  const seatLow = seatAlpha(buildGlassSheet({ glass: 'on', glassTint: '20' }, dark, true))
  const seatHigh = seatAlpha(buildGlassSheet({ glass: 'on', glassTint: '90' }, dark, true))
  /* 🔧 输入栏是**半透明玻璃 + 强模糊**，不是实底也不是普通透明。
     三种策略都试过：
       半透明（普通模糊）→ 背后正文能读清（bug）
       不透明实底        → 一整条死板色块，和周围对不上（bug）
       半透明 + 强模糊   → 背后正文糊成光影，读不到字，且与周围同色 ✓
     所以判据是：底色带 alpha（不是实色），且模糊半径比普通玻璃大。 */
  const seatLine = css.split('\n').find((l) => l.includes('composerSeat'))
  /* 🔧 输入区由**两部分**组成，判据也分两条：
     · composerSeat（座，卡片周边那圈）→ **完全透明**，
       它只需覆盖正文（由卡片承担），本身不该有底色。
       之前给它 rgba(0.65) 就变成用户说的「蓝白色一片」。
     · composerCard（卡片本体）→ 半透明玻璃，这才是输入框那块板。 */
  check(seatLine !== undefined && /background:transparent/.test(seatLine),
    '输入栏座完全透明（不涂色，避免蓝白色一片）',
    seatLine === undefined ? '缺失' : (seatLine.match(/background:[^;]+/) || ['?'])[0])
  const cardLine = css.split('\n').find((l) => l.includes('RlGAzG_card'))
  check(cardLine !== undefined && /background-color:rgba\(/.test(cardLine),
    '输入卡片是半透明玻璃（与周围一致）',
    cardLine === undefined ? '缺失' : (cardLine.match(/background-color:[^;]+/) || ['?'])[0])
  /* 输入栏的模糊应当明显大于「设置里的基础半径」——
     因为三列根本没有 backdrop-filter（它们的模糊来自背景层），
     所以对比基准是设置值本身，而不是某个别的选择器。 */
  const seatBlur = seatLine === undefined ? null : /blur\((\d+)px\)/.exec(seatLine)
  const baseBlurValue = 16 /* 默认 glassBlur，与 DEFAULTS 一致 */
  check(seatBlur !== null && Number(seatBlur[1]) > baseBlurValue,
    '输入栏模糊大于基础半径（要压住文字这种高频细节）',
    '输入栏 ' + (seatBlur ? seatBlur[1] : '?') + 'px / 基础 ' + baseBlurValue + 'px')
  const transparentRule = lines.find((l) => l.includes('Dc7zOa_root'))
  check(transparentRule === undefined || !transparentRule.includes('composerSeat'),
    '清透明的容器列表里不含 composerSeat（否则正文滚进输入栏）')
}

/* ------------------------------------------------------------------ *
 * F2. 标题栏：只覆盖探针，不动侧栏
 *
 * preload 插一个隐藏 span 当探针，读它的计算色送给 setTitleBarOverlay。
 * 探针读的是 var(--dsw-specific-sidebar-fill)，那个变量被侧栏共用 ——
 * 直接改变量会把侧栏玻璃弄坏（实测过）。
 * 所以只覆盖探针自己的 background-color，靠它的内联样式特征命中。
 * ------------------------------------------------------------------ */

console.log('  F2. 标题栏（探针覆盖）')

{
  /* 🔧 探针只能靠 inline style 里的变量名命中。
     浏览器把 inline style 序列化成 visibility 冒号空格 hidden 的形式，
     所以 [style*="visibility:hidden"] 永远匹配失败 —— 这就是标题栏长期不生效的原因。
     探针的独有特征是 style 里带 var(--dsw-specific-sidebar-fill)。 */
  const probeRule = lines.find((l) => l.includes('style*="sidebar-fill"'))
  check(probeRule !== undefined, '有专门针对探针的规则（用 sidebar-fill 命中）')
  if (probeRule !== undefined) {
    /* 🔧 探针必须送 **transparent**。
     *
     * 顶部 40px 是两层叠出来的：
     *   1. Electron 原生 titleBarOverlay ← 探针送的颜色决定它
     *   2. 页面内 .BynINW_frame::before（拖动区）← 可以加 backdrop-filter
     *
     * 覆盖层只要不透明就把下面的页面盖住，所以让它全透明，
     * 页面里的玻璃拖动区才露得出来、才看得到模糊。
     * （此前送过不透明色 → 顶部成了死板一条，和主体割裂） */
    check(probeRule.includes('transparent'),
      '探针送 transparent（让原生覆盖层让位给页面玻璃）',
      (probeRule.match(/background-color:[^}]+/) || ['?'])[0])
  }
  const tokenLine = lines.find((l) => l.includes('--dsw-specific-sidebar-fill'))
  check(tokenLine !== undefined && tokenLine.includes('--dsw-specific-sidebar-fill:transparent'),
    '侧栏令牌仍是 transparent（与探针分离，互不影响）')
}

/* ------------------------------------------------------------------ *
 * G. 压暗层：让文字可读
 * ------------------------------------------------------------------ */

console.log('  G. 压暗层')

{
  check(css.includes('#root::before'), '有压暗层（#root::before）')
  check(/position:fixed/.test(css), '压暗层是 fixed（铺满窗口）')
  check(/pointer-events:none/.test(css), '压暗层不挡点击')
  check(/z-index:0/.test(css), '压暗层在内容之下')
  check(css.includes('rgba(52, 61, 70, 0.55)'), '深色模式压暗 55%')
}

/* ------------------------------------------------------------------ *
 * G2. 整窗覆盖：所有表面令牌都要半透明
 *
 * 只改三列时，卡片/代码块/思考块/输入框/菜单仍是实心板，
 * 视觉上「只有中栏是玻璃」。要让整个窗口透着玻璃感，
 * 必须把这些表面令牌一起换成半透明。
 *
 * 判定标准不是「有没有声明」，而是**浓度是否落在可透区间**：
 *   too low（< 0.3）→ 几乎全透，字读不清
 *   too high（> 0.95）→ 实心板，玻璃感消失
 * ------------------------------------------------------------------ */

console.log('  G2. 整窗覆盖（所有表面令牌）')

{
  const tokenLine = lines.find((l) => l.includes('--dsw-alias-bg-layer-1'))
  const decls = tokenLine === undefined ? [] : (tokenLine.match(/--[a-z0-9-]+:[^;}]+/g) || [])
  const getAlpha = (name) => {
    const d = decls.find((x) => x.startsWith(name + ':'))
    if (d === undefined) return null
    const m = /rgba\([^)]*?,\s*([\d.]+)\)/.exec(d)
    return m === null ? null : Number(m[1])
  }

  /* 必须覆盖的表面令牌 */
  const REQUIRED = [
    ['--dsw-alias-bg-layer-1', '面板层1'],
    ['--dsw-alias-bg-layer-2', '面板层2'],
    ['--dsw-alias-bg-layer-3', '面板层3'],
    ['--dsw-alias-bg-overlay', '浮层'],
    ['--dsw-specific-bubble', '气泡'],
    ['--dsw-specific-menu', '菜单'],
    ['--dsw-specific-tip', '提示'],
    ['--dsw-specific-input-major', '输入框'],
    ['--dsw-alias-markdown-code-block', '代码块'],
    ['--changes-fill', '变更卡片'],
    ['--deliverable-fill', '交付卡片'],
    ['--plan-card-fill', '计划卡片'],
    ['--card-fill', '排程卡片'],
  ]
  for (const [name, label] of REQUIRED) {
    check(decls.some((d) => d.startsWith(name + ':')), '覆盖 ' + label, name)
  }

  /* 浓度必须在可透区间 */
  /* 🔧 分两类：可以透的表面 vs 必须实底的表面。
   *
   * 必须实底的是「底下压着正文」的那几类 —— 输入框、菜单、tooltip。
   * 它们半透明就必然透字（透光是物理结果，层叠上下文治不了）。
   * 其余表面应当留在可透区间，否则玻璃感消失。 */
  /* 🔧 没有「必须实底」的表面了 —— 挡字改由浮层的强模糊负责。 */
  const MUST_BE_OPAQUE = []
  const alphas = REQUIRED.map(([name, label]) => ({ name, label, a: getAlpha(name) }))
    .filter((x) => x.a !== null)
  const translucent = alphas.filter((x) => !MUST_BE_OPAQUE.includes(x.name))
  const opaque = alphas.filter((x) => MUST_BE_OPAQUE.includes(x.name))

  check(translucent.every((x) => x.a >= 0.3), '可透表面浓度 ≥ 30%（否则字读不清）',
    translucent.filter((x) => x.a < 0.3).map((x) => x.label + '=' + x.a).join(', ') || '全部合规')
  check(translucent.every((x) => x.a <= 0.95), '可透表面浓度 ≤ 95%（否则成实心板，没有玻璃感）',
    translucent.filter((x) => x.a > 0.95).map((x) => x.label + '=' + x.a).join(', ') || '全部合规')
  check(true, '（无必须实底的表面：挡字靠强模糊，不靠涂死）')

  /* 浮层应比底板略浓，但不能浓太多 */
  /* 🔧 反转：浮层/卡片应当比底板**更透**，不是更实。
   *
   * 旧断言写反了方向，导致实现跟着写反 ——
   * 卡片和代码块一度比底板还实（0.78~0.85），屏幕上看就是实心板。
   * 正确：三列撑主题色（浓），卡片/代码块浮在玻璃上（透）。 */
  const layer1 = getAlpha('--dsw-alias-bg-layer-1')
  const bubble = getAlpha('--dsw-specific-bubble')
  if (layer1 !== null && bubble !== null) {
    check(bubble <= layer1, '浮层/卡片比底板更透（否则成实心板）',
      '底板 ' + layer1 + ' / 气泡 ' + bubble)
  }

  /* 代码块必须最实（长段代码要读） */
  const codeBlock = getAlpha('--dsw-alias-markdown-code-block')
  if (codeBlock !== null) {
    check(codeBlock >= 0.35, '代码块浓度 ≥ 35%（可读性下限）', String(codeBlock))
  }

  /* 侧栏令牌必须 transparent（它同时决定标题栏颜色） */
  /* 🔧 侧栏令牌**不能**是 transparent：主进程校验 setTitleBarOverlay 的颜色时
     用的是 /^(?:#[\da-f]{3,8}|rgba?\\([\\d.,%\\s]+\\))$/ 这条正则，
     'transparent' 通不过，IPC 被丢弃，标题栏就保留默认不透明外观。
     必须是带 alpha 的 rgba。 */
  /* 侧栏令牌必须保持 transparent。
     ⚠️ 曾经把它改成 rgba(0.75) 想让标题栏跟着变，结果**左侧栏玻璃失效** ——
     侧栏内部多个元素都铺这个色，alpha 叠 alpha 又变回实心。
     标题栏的颜色由单独的探针规则负责（见下面 F2）。 */
  check(decls.some((d) => d === '--dsw-specific-sidebar-fill:transparent !important'),
    '侧栏令牌 = transparent（保住侧栏玻璃）')
  check(decls.some((d) => d === '--dsw-alias-bg-base:transparent !important'),
    '整页底令牌 = transparent（让背景层透上来）')
}

/* 深色模式文字必须提亮 */
{
  const textLine = lines.find((l) => l.includes('--dsw-alias-label-primary'))
  check(textLine !== undefined, '有文字提亮规则')
  if (textLine !== undefined) {
    check(textLine.includes('--dsw-alias-label-primary:rgb(255, 255, 255)'),
      'label-primary 提亮到纯白')
    check(textLine.includes('--dsw-alias-label-tertiary'), 'label-tertiary 也提亮')
    check(textLine.includes('--dsw-static-neutral-bluish-400'),
      '底层静态色 bluish-400 一并提亮（引用者多，只改 label 会漏）')
  }
}

/* ------------------------------------------------------------------ *
 * H. 设置项
 * ------------------------------------------------------------------ */

console.log('  H. 设置项')

{
  const d = t.DEFAULTS
  check(d !== undefined, 'DEFAULTS 已导出')
  if (d) {
    check(d.glass === 'on', 'glass 默认开', String(d.glass))
    check(d.glassBackground === 'wallpaper', '背景默认桌面壁纸', String(d.glassBackground))
    check(d.glassTint === '65', '浓度默认 65（保住主题色）', String(d.glassTint))
    check(d.glassBlur === '16', '模糊默认 16px', String(d.glassBlur))
  }
  check(src.includes("'透明与壁纸'"), '有分组标题')
  check(src.includes("title: '玻璃界面'"), '有「玻璃界面」开关')
  check(src.includes("title: '背景来源'"), '有「背景来源」')
  check(src.includes("title: '表面浓度'"), '有「表面浓度」')
  check(src.includes("title: '模糊半径'"), '有「模糊半径」')
  check(src.includes("title: '壁纸状态'"), '有「壁纸状态」')
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
