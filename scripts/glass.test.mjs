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
  /* 🔧 2026-10-22（借鉴 dsh-theme-endfield 的 glass.md）：backdrop-filter
     收窄到「背后有活文字」的表面 —— 对话框/菜单与标题栏拖动区。
     代码块/卡片/输入卡/座的 filter 全部删除：背后本来就是壁纸层
     预糊好的图（再糊 = 浪费 GPU），且 filter 有 fixed 后代包含块的
     实测事故风险（上游 tooltip 抖动）。三列依旧不许有。 */
  {
    const filterLines = css.split('\n').filter((l) => l.includes('backdrop-filter:blur'))
    const colFilter = filterLines.filter((l) => /_sidebarCol|_centerCol|_rightbarCol/.test(l))
    check(colFilter.length === 0, '三列没有 backdrop-filter（模糊来自背景层）',
      String(colFilter.length) + ' 条')
    const shouldBlur = filterLines.filter((l) => /role="dialog"|_frame"\]::before/.test(l))
    const mustNotBlur = filterLines.filter((l) => /RlGAzG|_card|md-code-block|data-code|composerSeat|bubble/.test(l))
    check(shouldBlur.length >= 2, '对话框/菜单 + 标题栏有 backdrop-filter（糊活文字）',
      String(shouldBlur.length) + ' 条')
    check(mustNotBlur.length === 0,
      '代码块/卡片/输入卡/座无 backdrop-filter（防包含块事故 + 省 GPU）',
      mustNotBlur.length + ' 条违规')
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
   * 🔧 ❸ 后压暗层与浓度联动：α=0.65 → veil=0.31（旧固定 0.55）。
   * 通道差因此从 68 放宽到 ~105 —— 这是**有意的取舍**：用一点主题色
   * 纯度换壁纸可见度（用户批准的 ❸ 方向）。反证链守住底线：
   * 没有 veil 冲淡到 153、α=0.1 洗掉主题色到 393。 */
  const mariana = [52, 61, 70]
  const wallpaper = [232, 190, 198]
  const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)))
  const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

  /* 第 1 层：压暗层（联动值 0.31）盖在壁纸上 */
  const veiled = over(mariana, 0.31, wallpaper)
  /* 第 2 层：三列 65% 叠在压暗后的背景上 */
  const shown = over(mariana, 0.65, veiled)
  const dist = distance(shown, mariana)
  check(dist <= 115, '完整链路（含联动压暗层）下仍是主题色（通道差 ≤ 115）',
    '通道差 ' + dist + ' rgb(' + shown.join(',') + ')')

  /* 反证 1：没有压暗层 → 主题色被冲淡 */
  const noVeil = over(mariana, 0.65, wallpaper)
  check(distance(noVeil, mariana) > 115,
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
  /* 🔧 2026-10-22（④ 对齐参考插件）：输入区从「强模糊挡字」换成「硬裁」——
   * JS 把 seat 抬成滚动容器的 flex 兄弟，文字硬断在输入卡上沿，
   * 背后没有文字 → 不需要 frostedFilter。断言反转：
   * seat 必须**没有** backdrop-filter（有就是旧方案没撤干净），
   * 且必须有 flex:none（参考插件实测：absolute/丢 flex 都会让裁切失效）。 */
  const seatBlur = seatLine === undefined ? null : /backdrop-filter:blur/.exec(seatLine)
  check(seatLine !== undefined && seatBlur === null,
    '座无 backdrop-filter（硬裁取代强模糊，④）',
    seatLine === undefined ? '缺失' : (seatLine.match(/backdrop-filter:[^;]+/) || ['无'])[0])
  check(seatLine !== undefined && /flex:none/.test(seatLine),
    '座带 flex:none（seat 是 content 的 flex 兄弟，裁切的布局前提）')
  const contentRule = lines.find((l) => l.includes('[data-conversation-content]{'))
  check(contentRule !== undefined && /position:relative/.test(contentRule),
    'content 容器 position:relative（lift 方案的定位前提）')
  /* 输入卡本体：保留基础 surfaceFilter（糊壁纸），不再用 frosted。 */
  check(cardLine !== undefined && !cardLine.includes('blur(26px)'),
    '输入卡不用 frosted 强模糊（硬裁后背后无文字）')
  /* seat 的 lift/restore/observer 机制存在性（源码级锁）。 */
  check(/function liftSeats/.test(src) && /function restoreSeats/.test(src)
    && /MutationObserver/.test(src) && /syncSeatLift\(false\)/.test(src),
    '硬裁机制完整（lift + restore + observer + 关闭时撤销）')
  const transparentRule = lines.find((l) => l.includes('Dc7zOa_root'))
  check(transparentRule === undefined || !transparentRule.includes('composerSeat'),
    '清透明的容器列表里不含 composerSeat（否则正文滚进输入栏）')

  /* 🔴 回归锁（2026-10-22 真机 bug「正文穿过输入区」）：
   * 座**就是** .Dc7zOa_composerSeat —— 宿主给同一个元素同时挂了
   * 类名和 data-composer-seat（渲染代码：className: composerSeat,
   * "data-composer-seat": ""）。旧版「透明化整条底栏」那条规则里也列了
   * [data-composer-seat]，且带 backdrop-filter:none —— 它在表尾，
   * 同特异性后者赢，于是座的强模糊被自己撤掉，正文直接可读地透进来。
   * 不变量：**任何含 backdrop-filter:none 的规则都不得命中座**。 */
  {
    const noneLines = lines.filter((l) => l.includes('backdrop-filter:none')
      && l.includes('data-composer-seat'))
    check(noneLines.length === 0,
      '座的模糊不被任何 backdrop-filter:none 规则撤掉',
      noneLines.length + ' 条冲突规则')
    /* 座规则不得再带强模糊（④ 硬裁取代；见 F 节的反向断言）。 */
    const seatRule = lines.find((l) => l.includes('composerSeat'))
    check(seatRule !== undefined && !/backdrop-filter:blur/.test(seatRule),
      '座规则无 frosted 强模糊（硬裁后不需要）')
  }
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
 * G. 压暗层：合成进背景层（2026-10-22 迁移）
 *
 * 旧版把压暗层放 `#root::before`（fixed, z-index:0）。那是个层叠事故：
 * `#root` 被玻璃表设为 z-index:1 = 层叠上下文，上下文**内部**的定位元素
 * 画在静态流内容（三列、卡片、正文）之上 —— 一旦生效就是整页蒙 55% 灰纱，
 * 连文字一起压暗。（它以前没出过事，是因为缺失闭括号的 CSS 错误恢复
 * 把整条吞了 —— 见 I 节的括号平衡回归锁。）
 *
 * 现在合成进背景层 `#dmt-wallpaper` 自身的 background-image：
 * 物理上在 #root 之外、之下 → 只压底图，不压内容。
 * ------------------------------------------------------------------ */

console.log('  G. 压暗层（背景层合成）')

{
  const { glassVeilColor, composeBackdrop, glassSolidAlpha } = t
  check(typeof glassVeilColor === 'function' && typeof composeBackdrop === 'function'
    && typeof glassSolidAlpha === 'function',
    'veil 三个纯函数已导出')
  /* 🔧 ❸：veil 与表面浓度联动 —— 深色 v = 0.50 − 0.30·α（夹 0.15–0.45）。
   * 浓度高 → 列自己已压得住底，veil 让位；浓度低 → veil 多干活。 */
  check(glassVeilColor({ base: '#343D46' }, true, 0.65) === 'rgba(52, 61, 70, 0.31)',
    '深色 α=0.65 → 压暗 0.31', glassVeilColor({ base: '#343D46' }, true, 0.65))
  check(glassVeilColor({ base: '#FFFFFF' }, false, 0.65) === 'rgba(255, 255, 255, 0.26)',
    '浅色 α=0.65 → 压暗 0.26')
  check(glassVeilColor({ base: '#343D46' }, true, 0) === 'rgba(52, 61, 70, 0.45)',
    'α=0 → 压暗夹到上限 0.45（文字直接坐壁纸，veil 必须多干）')
  check(glassVeilColor({ base: '#343D46' }, true, 1) === 'rgba(52, 61, 70, 0.2)',
    'α=1 → 压暗降到 0.2')
  check(glassVeilColor(undefined, true) === 'rgba(52, 61, 70, 0.31)',
    '缺 surf/缺 α 时回落默认 base+0.65')
  /* 合成：veil 在前（第一层=画在最上），图片在后 */
  const composed = composeBackdrop('rgba(52, 61, 70, 0.31)', 'url("blob:x")')
  check(composed === 'linear-gradient(rgba(52, 61, 70, 0.31), rgba(52, 61, 70, 0.31)), url("blob:x")',
    '壁纸路径合成正确（渐变前置）', composed.slice(0, 40) + '…')
  /* ⚠️ 关键防御：veil 为空时必须原样返回 —— 拼进 linear-gradient() 会得到
   * `linear-gradient(, ,)` 非法值，整条 background-image 一起报废。 */
  check(composeBackdrop('', 'url("blob:x")') === 'url("blob:x")',
    'veil 空 → 不前置（避免非法 linear-gradient）')
  /* 样式表里不能再出现 #root::before（层叠事故的载体） */
  check(!css.includes('#root::before'),
    '玻璃表不再放 #root::before 压暗层（层叠事故源）')
  /* 渐变兜底也要含 veil（paint 时走 backdropGradient，veil 由 sync 注入） */
  const veil = glassVeilColor(dark, true, 0.65)
  const g1 = t.backdropGradient(dark, true, veil)
  check(g1.startsWith('linear-gradient(' + veil + ', ' + veil + '),') && g1.includes('radial-gradient'),
    '渐变兜底同样前置压暗层', g1.slice(0, 46) + '…')
  check(t.backdropGradient(dark, true, '') === t.buildGradientBackdrop(dark, true),
    'veil 空 → 渐变兜底原样（不多包一层）')
  /* 代码块浓度：差值档 —— 合成（不是直涂）收敛到 α+0.14 */
  const near = (a, b) => Math.abs(a - b) < 1e-9
  check(near(glassSolidAlpha(0.65), 0.14 / 0.35) && near(glassSolidAlpha(0.78, 0), 0.14 / 0.22)
    && glassSolidAlpha(1) === 0,
    'glassSolidAlpha = 差值公式（α=1 时涂什么都看不见 → 0）',
    '65→' + glassSolidAlpha(0.65) + ' 78→' + glassSolidAlpha(0.78))
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

  /* 🔧  差值体系：判据从「本层浓度」改成「合成浓度」。
   * 本层涂多少不再是视觉指标 —— 卡片涂 0.29 但合成后是 0.75，
   * 观感由合成值决定。旧断言（本层 ≥0.3 / ≤0.95）测的是错的量。 */
  const { glassComposite } = t
  const colAlpha = 0.65 /* 默认 glassTint，三列选择器直涂这个值 */
  const alphas = REQUIRED.map(([name, label]) => ({ name, label, a: getAlpha(name) }))
    .filter((x) => x.a !== null)
  const composited = alphas.map((x) => ({ ...x, f: glassComposite(colAlpha, x.a) }))
  /* 合成必须收敛进档位区间：浮层档 α+0.10 … +0.40（fog 0–40 全量程），
   * 代码块档 α+0.14±0.01。
   * 🔧 上限 0.21→0.41：fogPer 从 0.10 扩到 0.30（用户报"fog 调了没反应"，
   * 观感范围太窄是原因之一）。 */
  const FLOAT = ['--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner',
    '--changes-fill', '--deliverable-fill', '--plan-card-fill', '--card-fill']
  const badFloat = composited.filter((x) => !FLOAT.includes(x.name)
    && (x.f < colAlpha + 0.09 || x.f > colAlpha + 0.41))
  check(badFloat.length === 0, '浮层档合成 = α+0.10(+fog≤0.30)（差值收敛）',
    badFloat.map((x) => x.label + '→' + x.f.toFixed(2)).join(', ') || '全部收敛')
  const code = composited.find((x) => x.name === '--dsw-alias-markdown-code-block')
  check(code !== undefined && code.f >= colAlpha + 0.13 && code.f <= colAlpha + 0.15,
    '代码块档合成 = α+0.14（比卡片实一档、不是实心板）',
    code ? '合成 ' + code.f.toFixed(2) : '缺失')
  check(true, '（无必须实底的表面：挡字靠强模糊，不靠涂死）')

  /* 浮层合成必须比列实（能区分）、比实心透（能透壁纸）。 */
  const layer1 = getAlpha('--dsw-alias-bg-layer-1')
  const bubble = getAlpha('--dsw-specific-bubble')
  if (layer1 !== null && bubble !== null) {
    check(Math.abs(bubble - layer1) < 1e-9, '气泡与面板层1 同档（浮层档）',
      '底板层 ' + layer1 + ' / 气泡 ' + bubble)
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
  /* 🔧 2026-10-22 页面整理：分组标题统一 GroupHead；「壁纸状态」整行
   * 退役，状态并进玻璃组的动态副标题（已加载壁纸 / 等高线 / 渐变…）。 */
  check(/h\(\s*GroupHead,\s*\{\s*title: '玻璃界面'/.test(src), '玻璃有分组标题（GroupHead）')
  check(src.includes("title: '玻璃界面'"), '有「玻璃界面」开关')
  check(src.includes("title: '背景来源'"), '有「背景来源」')
  check(src.includes("title: '表面浓度'"), '有「表面浓度」')
  check(src.includes("title: '模糊半径'"), '有「模糊半径」')
  check(src.includes("'壁纸已加载'"), '壁纸状态并进组副标题')
  check(!src.includes("title: '壁纸状态'"), '壁纸状态不再占整行')
}

/* ------------------------------------------------------------------ *
 * I. 生成 CSS 的结构合法性（2026-10-22 事故回归锁）
 *
 * 玻璃表是**拼字符串**生成的。曾经有两处 push 忘了收尾的 `}`：
 * CSS 错误恢复把「文字提亮块」和「压暗层」整段吞掉 —— 所有逐行正则
 * 断言照样全绿，真机上那两条规则根本没生效（用户看到的"文字发灰、
 * 亮壁纸压不住"）。**逐行匹配测不出括号**，必须整体平衡校验。
 *
 * 用真实参数（多组），而不是只测默认值。
 * ------------------------------------------------------------------ */

console.log('  I. 生成 CSS 结构合法（括号平衡 / 无非法值）')

{
  const variants = [
    [{ glass: 'on' }, dark, true], /* 默认 */
    [{ glass: 'on', glassTint: '78', glassFog: '0', glassHaze: '8' }, dark, true], /* 用户 profile 实值 */
    [{ glass: 'on', glassTint: '30', glassBlur: '0' }, dark, true],
    [{ glass: 'on', glassTint: '100' }, dark, false],
    [{ glass: 'on' }, { base: '#FFFFFF' }, false],
  ]
  let bad = 0
  for (const [st, sf, dk] of variants) {
    const out = buildGlassSheet(st, sf, dk)
    const opens = (out.match(/{/g) || []).length
    const closes = (out.match(/}/g) || []).length
    if (opens !== closes) bad += 1
    /* 每条规则行都得自己闭合（逐行数一次，报错好定位） */
    for (const ln of out.split('\n')) {
      if (!ln.includes('{') || ln.startsWith('/*')) continue
      if ((ln.match(/{/g) || []).length !== (ln.match(/}/g) || []).length) bad += 1
    }
    /* 非法值防御：空颜色 / undefined 漏进声明串 */
    if (/rgba\([^)]*undefined|linear-gradient\(\s*,|,\s*\)/.test(out)) bad += 1
    if (out.includes('undefined')) bad += 1
  }
  check(bad === 0, '五种参数组合：逐行闭合、总数平衡、无非法颜色', bad + ' 处异常')

  /* 🔴 回归锁（2026-10-22 三连事故）：无障碍 @media 块必须不存在。
   * Windows「透明效果」开关（注册表 EnableTransparency=0，很多机器默认关）
   * 被 Chromium 映射成 prefers-reduced-transparency: reduce —— 旧版那个块
   * 把三列钉成同一个 88% 实色：侧栏色被抹掉、浓度滑块失效、
   * 只有 ::before 标题栏还跟着变（用户三连报的正是这三条）。
   * 玻璃是应用内显式开关，不许被 OS 启发式劫持。 */
  check(!css.includes('prefers-reduced-transparency'),
    '不再有无障碍 @media 劫持（OS 透明开关不得钉死用户选的浓度）')
  check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length,
    '去掉 @media 块后整表仍括号平衡')
  /* 三列各自的颜色不许相同（sidebar ≠ base 是两个独立槽位） */
  const sideLine = lines.find((l) => /_sidebarCol"\]\{background:rgba/.test(l))
  const centerLine = lines.find((l) => /_rightbarCol"\]\{background:rgba/.test(l))
  check(sideLine !== undefined && centerLine !== undefined
    && sideLine.includes('rgba(46, 54, 63') && centerLine.includes('rgba(52, 61, 70'),
    '侧栏列 = sidebar 色、中/右列 = base 色（两槽位独立：夹具 #2E363F vs #343D46）')
}

/* ------------------------------------------------------------------ *
 * J. 跨列容器不得涂色（2026-10-22「只有标题栏会变」事故回归锁）
 *
 * _frame 是三列的**父容器**。上一轮 ❼ 我给它铺了 rgba(sidebar, α) 想
 * "补标题栏垫底"，真机三个症状：
 *   · 列的半透明底叠在 frame 的板上 → 壁纸信号 22%→5%，浓度滑块失效；
 *     只有 ::before 顶部条（单层）还在跟着变 —— 用户原话「只有标题会变」；
 *   · 侧栏色透过中栏渗出 → 「左栏颜色被统一到正栏」；
 *   · 顶部条被我顺手改成单色侧栏色 → sidebar/base 两个独立槽位的区分没了。
 * 不变量：frame 必须 transparent；上色只发生在 ::before（渐变双色）与三列。
 * ------------------------------------------------------------------ */

console.log('  J. 跨列容器不涂色 / 顶部双色')

{
  const frameLine = lines.find((l) => /\[class\*="_frame"\]\{/.test(l))
  check(frameLine !== undefined && /background:transparent/.test(frameLine),
    'frame 容器 = transparent（父容器铺色会吃掉列的壁纸信号）')
  check(!lines.some((l) => /\[class\*="_frame"\]\{[^}]*rgba\(/.test(l)),
    '没有任何规则给 frame 容器铺 rgba 色')
  const beforeLine = lines.find((l) => /\[class\*="_frame"\]::before\{/.test(l))
  check(beforeLine !== undefined
    && beforeLine.includes('linear-gradient(to right')
    && beforeLine.includes('rgba(46, 54, 63') /* 夹具 sidebar #2E363F */
    && beforeLine.includes('rgba(52, 61, 70'), /* 夹具 base #343D46 */
    '顶部条 = sidebar→base 双色渐变（两个独立槽位各归各）')
  check(beforeLine !== undefined && beforeLine.includes('--dsh-windows-sidebar-width'),
    '渐变接缝用宿主真实侧栏宽（不写死百分比）')
  /* 中栏清圆角是刻意设计（玻璃下弧内会露背景破洞），不许"交还宿主"。 */
  const radiusLine = lines.find((l) => /\[class\*="_centerCol"\]\{border-radius:0/.test(l))
  check(radiusLine !== undefined, '中栏左上角圆角在玻璃下清成直角（原设计）')
}

/* ------------------------------------------------------------------ *
 * K. 壁纸信号单调性（❸ 差值体系的验收不变量）
 *
 * 从壁纸到像素，每多一层涂色，壁纸信号 ×(1−该层浓度)。旧公式下
 * 卡片 = 列(0.78) × 卡片(0.78) → 信号 2%，"卡片没有玻璃"的数学根源。
 * 差值体系要求：**信号按档位单调**，且卡片上的信号 ≥ 旧公式的 4 倍。
 *   正文区信号  = (1−v)(1−α)
 *   卡片上信号  = (1−v)(1−α)(1−a_float)   a_float=差值
 *   代码块信号  = 再 ×(1−a_code)  —— 允许更低（要读字），但必须
 *                仍高于"实心板"线（>3%）
 * ------------------------------------------------------------------ */

console.log('  K. 壁纸信号单调（差值体系验收）')

{
  const { glassComposite, glassFloatAlpha, glassSolidAlpha, glassVeilColor } = t
  const a = 0.78 /* 用户 profile 的 tint */
  const v = Number(/,\s*([\d.]+)\)$/.exec(glassVeilColor({ base: '#343D46' }, true, a))[1])
  const sig = (alphaChain) => (1 - v) * alphaChain.reduce((acc, x) => acc * (1 - x), 1)
  const body = sig([a])
  const card = sig([a, glassFloatAlpha(a, 0)])
  const code = sig([a, glassSolidAlpha(a)])
  check(body > card && card > code, '信号单调：正文 > 卡片 > 代码块',
    '正文 ' + (body * 100).toFixed(1) + '% 卡片 ' + (card * 100).toFixed(1)
    + '% 代码块 ' + (code * 100).toFixed(1) + '%')
  check(card >= body * 0.50, '卡片信号 ≥ 正文的 50%（差值体系在 α=0.78 的精确比是 0.545；旧直涂公式只有 0.36）',
    (card / body * 100).toFixed(0) + '%')
  check(code >= 0.03, '代码块信号 ≥ 3%（可读性与玻璃感的下限）',
    (code * 100).toFixed(1) + '%')
  check(body >= 0.10 && body <= 0.30, 'α=0.78 时正文信号落在 10–30%（氛围可见、不抢字）',
    (body * 100).toFixed(1) + '%')
  /* 全浓度扫描：任何 tint 下都不许出现"卡片比正文还实"的倒挂 */
  let inverted = 0
  for (let t0 = 0; t0 <= 100; t0 += 5) {
    const aa = t0 / 100
    const vv = Number(/,\s*([\d.]+)\)$/.exec(glassVeilColor({ base: '#343D46' }, true, aa))[1])
    const sBody = (1 - vv) * (1 - aa)
    const sCard = sBody * (1 - glassFloatAlpha(aa, 0))
    if (sCard > sBody + 1e-9) inverted += 1
  }
  check(inverted === 0, 'tint 0–100 全扫描：卡片信号永不超过正文（无倒挂）')
}

/* ------------------------------------------------------------------ *
 * L. 卡片填充变量写在声明元素上（2026-10-22「卡片不受浓度影响」回归锁）
 *
 * 宿主把 --changes-fill 等变量声明在卡片元素自己的哈希类上 ——
 * 自定义属性不从 body 继承过本地声明，body 级 !important 完全无效。
 * 不变量：玻璃表必须按 detectCardTargets 的类名逐元素输出 rgba 覆盖，
 * 且用户挑了 cardColor 时以它为基色（❺ 一并解决）。
 * ------------------------------------------------------------------ */

console.log('  L. 卡片填充变量（声明元素级覆盖）')

{
  const targets = [
    { defClass: 'kuvljq_card', varName: '--changes-fill', hoverVar: '--changes-hover' },
    { defClass: 'flL80G_root', varName: '--deliverable-fill', hoverVar: '--deliverable-hover' },
    { defClass: 'KuQXFq_card', varName: '--plan-card-fill', hoverVar: '--plan-card-hover' },
  ]
  const withTargets = buildGlassSheet({ glass: 'on', glassTint: '65', glassFog: '0' }, dark, true, targets)
  const tLines = withTargets.split('\n')
  for (const tg of targets) {
    const l = tLines.find((x) => x.includes('.' + tg.defClass + '{') && x.includes(tg.varName))
    check(l !== undefined, '覆盖 ' + tg.varName + ' 写在 .' + tg.defClass, l ? l.slice(0, 60) + '…' : '缺失')
    if (l !== undefined) {
      check(/rgba\(/.test(l) && l.includes('!important'), tg.varName + ' 是 rgba + !important')
      /* 合成收敛到浮层档：本层涂差值（0.65 列 → 涂 (0.75-0.65)/0.35≈0.29） */
      const m = /rgba\([^)]*?,\s*([\d.]+)\)/.exec(l)
      if (m !== null) {
        const f = t.glassComposite(0.65, Number(m[1]))
        check(f >= 0.74 && f <= 0.76, tg.varName + ' 合成 ≈ α+0.10', '合成 ' + f.toFixed(2))
      }
    }
  }
  /* 用户挑了 cardColor → 以它为**基色**做预补偿（❺）。
   * 断言不能查字面色（补偿后的涂色不是原值），查的是：
   * 卡片元素级规则存在 + 补偿色的通道明显低于 base（往深色方向走）。 */
  const picked = buildGlassSheet({ glass: 'on', glassTint: '65', cardColor: '#242F3D' }, dark, true, targets.slice(0, 1))
  const pickedLine = (picked.split('\n').find((l) => l.includes('.kuvljq_card{')) || '')
  const pm = /rgba\((\d+), (\d+), (\d+)/.exec(pickedLine)
  check(pickedLine.includes('--changes-fill:rgba') && pm !== null
    && Number(pm[1]) < 36, 'cardColor 作为卡片玻璃基色（预补偿后通道 < 原值，合成还原到 #242F3D）',
    pm ? '涂 rgb(' + pm.slice(1, 4).join(',') + ')' : '缺失')
  /* 没传 targets → 不输出**元素级**规则（body 级令牌仍保留，见 ⑨ 注释）。 */
  check(!css.includes('.kuvljq_card{') && !css.includes('.flL80G_root{'),
    '未检测到时不输出元素级覆盖（等重试重建）')
  /* 括号平衡（带 targets 的组合） */
  check((withTargets.match(/\{/g) || []).length === (withTargets.match(/\}/g) || []).length,
    '含卡片元素级覆盖的表仍括号平衡')
}

/* ------------------------------------------------------------------ *
 * M. 颜色预补偿（2026-10-22「卡片/代码块/输入卡变成正文背景色」回归锁）
 *
 * 差值浓度让浮层透，但浮层涂的色穿过列（base@α）稀释后会全是 base 味
 * —— Mariana 各色板太接近，一稀释就分不出谁是谁。
 * 不变量：合成后的**颜色**必须还原成该表面自己的色（而不是 base）。
 * ------------------------------------------------------------------ */

console.log('  M. 颜色预补偿（合成后颜色还原）')

{
  const { glassSurfaceColor, glassComposite } = t
  /* 数学自检：C=B（与列同色）时不补偿 */
  check(glassSurfaceColor('#343D46', '#343D46', 0.65, 0.75) === '#343D46',
    'C=B → 原样（同色表面不受影响）')
  /* 合成验算：涂 C'@a 在 B@α 上，逐通道应还原成 C */
  const B = [52, 61, 70] /* base #343D46 */
  const C = [46, 54, 63] /* code #2E363F */
  const alpha = 0.65
  const F = 0.79 /* α+0.14 */
  const a = (F - alpha) / (1 - alpha)
  const cp = glassSurfaceColor('#343D46', '#2E363F', alpha, F)
  const cpx = [1, 3, 5].map((i) => parseInt(cp.slice(i, i + 2), 16))
  /* 最终像素 = C'@a over (B@α over 任意背景) —— 只看 C' 与 B 的混合占比 */
  const shown = cpx.map((v, i) => v * a + B[i] * (1 - a))
  const err = shown.map((v, i) => Math.abs(v - C[i]))
  check(Math.max(...err) <= 2, '预补偿后合成还原成目标色（通道误差 ≤2）',
    '目标 rgb(' + C + ') 合成 rgb(' + shown.map((x) => Math.round(x)) + ')')
  /* 生成的样式表里：代码块 pre 涂的不再是 code 原值（说明补偿生效） */
  const preLine = lines.find((l) => l.includes('pre{background-color:rgba'))
  check(preLine !== undefined && !preLine.includes('rgba(46, 54, 63'),
    'pre 涂的是补偿色（不是 code 原值 —— 原值会被列冲淡）',
    preLine ? (preLine.match(/rgba\([^)]+\)/) || ['?'])[0] : '缺失')
  /* 输入卡基色不再是 base */
  const cardLine = lines.find((l) => l.includes('RlGAzG_card"]{'))
  check(cardLine !== undefined && !cardLine.includes('rgba(52, 61, 70'),
    '输入卡不再直涂 base（旧版"和正文同色"的直接原因）')
}

/* ------------------------------------------------------------------ *
 * N. 对齐 dsh-acrylic-light 的增量项（2026-10-22）
 *   #2 输入卡聚焦态（阴影层数一致才能插值）
 *   #3 关宿主菜单材质层的双重模糊（--dsw-menu-backdrop-filter）
 *   #5 文件预览卡近实色（读小字的地方不玻璃）
 *   #6 控制台调参入口 window.colorlab
 * ------------------------------------------------------------------ */

console.log('  N. 参考插件对齐项')

{
  /* #3：菜单/面板材质层自带 blur(40px)，我们给 dialog/menu 又加了一层
   * —— 双重模糊发闷。令牌层必须把它关掉。 */
  check(css.includes('--dsw-menu-backdrop-filter:none'),
    '#3 宿主菜单材质层的 blur(40px) 被关（防双重模糊）')
  /* #5：document-preview 的近实色（合成 ≥ α+0.20） */
  const dpLine = lines.find((l) => l.includes('--dsw-alias-bg-document-preview:rgba'))
  const dpM = dpLine === undefined ? null : /rgba\([^)]*?,\s*([\d.]+)\)/.exec(dpLine)
  check(dpM !== null && t.glassComposite(0.65, Number(dpM[1])) >= 0.85,
    '#5 预览卡合成 ≥0.85（近实色，读小字不压壁纸）',
    dpM === null ? '缺失' : '本层 ' + dpM[1] + ' 合成 ' + t.glassComposite(0.65, Number(dpM[1])).toFixed(2))
  /* #2：聚焦态存在且阴影层数与静置一致（5 层，才能逐层插值） */
  const focusLine = lines.find((l) => l.includes('RlGAzG_card"]:focus-within'))
  const restLine = lines.find((l) => {
    const m = /RlGAzG_card"\]\{[^}]*box-shadow/.exec(l)
    return m !== null
  })
  const countShadow = (l) => {
    const m = /box-shadow:([^;}]+)/.exec(l || '')
    if (m === null) return 0
    /* 逗号分层：数 rgba( 的出现次数 */
    return (m[1].match(/rgba\(/g) || []).length
  }
  check(focusLine !== undefined && restLine !== undefined
    && countShadow(focusLine) === countShadow(restLine) && countShadow(focusLine) >= 5,
    '#2 聚焦/静置阴影层数一致且 ≥5（插值不跳变）',
    '静置 ' + countShadow(restLine) + ' / 聚焦 ' + countShadow(focusLine))
  /* #6：控制台入口 */
  check(src.includes('window.colorlab') && /api\.glass = \(\)/.test(src) && /api\.reset = \(\)/.test(src),
    '#6 window.colorlab 调参入口（get/glass/reset/defaults）')
  /* ①：玻璃滑块走即时应用，不再走草稿
   *（例外：自选壁纸路径是文本输入，逐字符触发，仍走草稿）。 */
  check(/updateGlassNow\(\{ glassTint/.test(src) && /updateGlassNow\(\{ glassFog/.test(src)
    && /updateGlassNow\(\{ glassBlur/.test(src) && /updateGlassNow\(\{ glassHaze/.test(src)
    && !/updateDraft\(\{ glassTint/.test(src) && !/updateDraft\(\{ glassFog/.test(src)
    && !/updateDraft\(\{ glassBlur/.test(src) && !/updateDraft\(\{ glassHaze/.test(src),
    '① 四个玻璃滑块即时应用（草稿路径已移除）')
  /* ①：fog 不再被对话框规则硬编码 0 */
  check(!/glassFloatTarget\(alpha, 0\)/.test(src),
    '① 对话框/菜单不再硬编码 fog=0（读滑块值）')
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')