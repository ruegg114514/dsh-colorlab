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

/** 把 CSS 文本转成最小可用的 CSSOM 替身（供 detectPopoverClasses 测试）。 */
function toCssom(cssText) {
  const out = []
  const re = /([^{}]+)\{([^}]*)\}/g
  let m
  while ((m = re.exec(cssText)) !== null) {
    const map = {}
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':')
      if (i < 0) continue
      map[d.slice(0, i).trim()] = d.slice(i + 1).trim()
    }
    out.push({
      selectorText: m[1].trim(),
      cssText: m[0],
      style: { getPropertyValue: (n) => (map[n] === undefined ? '' : map[n]) },
    })
  }
  return out
}

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
    const shouldBlur = filterLines.filter((l) => /role="dialog"|_frame"\]\[style\*="grid-template-columns"\]::before/.test(l))
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
  /* 2026-10-24：frame 规则必须限定「布局 frame」——
   * 裸 [class*="_frame"] 会误伤 jIHOOq_frame（子智能体卡）等
   * 10 个带底色的内容框。判据 = 内联 grid-template-columns。 */
  const frameLine = lines.find((l) => /\[class\*="_frame"\]\[style\*="grid-template-columns"\]\{/.test(l))
  check(frameLine !== undefined && /background:transparent/.test(frameLine),
    '布局 frame 容器 = transparent（父容器铺色会吃掉列的壁纸信号）')
  check(!lines.some((l) => /\[class\*="_frame"\](\[[^\]]*\])?\{[^}]*rgba\(/.test(l)),
    '没有任何规则给 frame 容器铺 rgba 色（::before 双色条除外）')
  /* 反向：不许再用不限定的裸 _frame 子串（会连坐内容卡）。 */
  check(!lines.some((l) => /\[class\*="_frame"\]\{/.test(l) && !l.includes('grid-template-columns')),
    'frame 透明规则必须限定布局 frame')
  const beforeLine = lines.find((l) => /\[class\*="_frame"\]\[style\*="grid-template-columns"\]::before\{/.test(l))
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
  /* 2026-10-23 整理：「浮层浓度」(glassFog) 滑块已并入「浮层增量」，
   * UI 上不再有独立滑块 —— 但字段仍在，内部三处消费照旧。
   * 所以这里只验证还存在的三个滑块。 */
  check(/updateGlassNow\(\{ glassTint/.test(src) && /updateGlassNow\(\{ glassBlur/.test(src)
    && /updateGlassNow\(\{ glassHaze/.test(src)
    && !/updateDraft\(\{ glassTint/.test(src)
    && !/updateDraft\(\{ glassBlur/.test(src) && !/updateDraft\(\{ glassHaze/.test(src),
    '① 玻璃滑块即时应用（草稿路径已移除）')
  check(!/updateGlassNow\(\{ glassFog/.test(src),
    '「浮层浓度」滑块已合并（UI 不再单独暴露 glassFog）')
  /* ①：fog 不再被对话框规则硬编码 0 */
  check(!/glassFloatTarget\(alpha, 0\)/.test(src),
    '① 对话框/菜单不再硬编码 fog=0（读滑块值）')
}

/* ======================================================================
 * 🔧 2026-10-23：参照 dsh-glass-ranswork 补齐的三组能力
 *   ① 分层浓度可调（GLASS_TIER 常量 → glassFloat/glassCode/glassHover）
 *   ② 背景图摆放（glassFit 五种）+ 裁剪（glassCrop）
 *   ③ 文字保护（glassGuard）+ 跟随图片明暗（glassAutoTone）
 * 这一组锁的是「设置真的能改出不同的 CSS / 真的走到对应代码路径」——
 * 光有 UI 不接线是最容易漏的（本项目上一轮刚踩过）。
 * ====================================================================== */
console.log('')
console.log('J. 分层浓度可调（glassFloat / glassCode / glassHover）')
{
  const build = (extra) => buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', ...extra },
    dark, true,
  )
  /* 1. 默认值与出厂常量一致（不写这些字段时行为不变）。 */
  const base = build({})
  const explicit = build({ glassFloat: '10', glassCode: '14', glassHover: '5' })
  check(base === explicit, '不写新字段 = 出厂值（向后兼容，老 profile 行为不变）')

  /* 2. 三个字段各自真的改变输出。 */
  check(build({ glassCode: '30' }) !== base, 'glassCode 改了 → 玻璃表跟着变')
  check(build({ glassFloat: '30' }) !== base, 'glassFloat 改了 → 玻璃表跟着变')
  check(build({ glassHover: '15' }) !== base, 'glassHover 改了 → 玻璃表跟着变')

  /* 3. 语义方向正确：code 越大，代码块越实（alpha 数字更大）。 */
  const alphaOf = (sheet) => {
    const m = sheet.match(/--shiki-background:rgba\([^)]*?,\s*([\d.]+)\)/)
    return m === null ? null : Number(m[1])
  }
  const aLow = alphaOf(build({ glassCode: '2' }))
  const aHigh = alphaOf(build({ glassCode: '35' }))
  check(aLow !== null && aHigh !== null && aHigh > aLow,
    'glassCode 越大 → 代码块 alpha 越大（语义方向正确）',
    '低 ' + aLow + ' / 高 ' + aHigh)

  /* 4. 钳制：越界值不能击穿区间（0–40 / 0–20）。 */
  check(build({ glassCode: '999' }) === build({ glassCode: '40' }),
    'glassCode 超上限 999 被夹到 40')
  check(build({ glassFloat: '-50' }) === build({ glassFloat: '0' }),
    'glassFloat 负值被夹到 0')
  check(build({ glassHover: '999' }) === build({ glassHover: '20' }),
    'glassHover 超上限被夹到 20')

  /* 5. 坏值回落默认，不抛错。 */
  check(build({ glassCode: 'abc' }) === base, 'glassCode 非数字 → 回落默认（不抛错）')

  /* 6. 计算路径不许再直接读常量对象（绕过设置）。 */
  const calcRegion = src.slice(src.indexOf('function glassFloatTarget'),
    src.indexOf('function glassFloatTarget') + 400)
  check(!/GLASS_TIER\./.test(calcRegion),
    '计算路径不再直接读 GLASS_TIER 常量（一律走 glassTier()）')
  check(/function glassTier\(/.test(src), '有 glassTier(from) 从设置解析分层增量')
  check(t.glassTier !== undefined && typeof t.glassTier === 'function',
    'glassTier 已导出到 __test（测试可直接断言）')
  check(t.GLASS_TIER_DEFAULTS !== undefined && t.GLASS_TIER_DEFAULTS.code === 0.14,
    'GLASS_TIER_DEFAULTS 保留出厂值（code = 0.14）')
}

console.log('')
console.log('K. 背景图摆放（glassFit）')
{
  const styleOf = (fit) => t.wallpaperFitStyle({ glassFit: fit })
  check(t.wallpaperFitStyle !== undefined, 'wallpaperFitStyle 已导出')
  const cover = styleOf('cover')
  check(cover.size === 'cover' && cover.repeat === 'no-repeat',
    'cover → 填充（原行为，向后兼容）', JSON.stringify(cover))
  const contain = styleOf('contain')
  check(contain.size === 'contain' && contain.repeat === 'no-repeat', 'contain → 适应', JSON.stringify(contain))
  const stretch = styleOf('stretch')
  check(stretch.size === '100% 100%', 'stretch → 拉伸（100% 100%）', JSON.stringify(stretch))
  const tile = styleOf('tile')
  check(tile.size === 'auto' && tile.repeat === 'repeat',
    'tile → 平铺（auto + repeat，不让 cover 把 512px 图放大 8 倍）', JSON.stringify(tile))
  const center = styleOf('center')
  check(center.size === 'auto' && center.repeat === 'no-repeat', 'center → 居中（auto + 不重复）', JSON.stringify(center))
  /* 非法值回落 cover，不抛错。 */
  check(styleOf('nonsense').size === 'cover', '非法 fit → 回落 cover')
  check(styleOf(undefined).size === 'cover', '缺省 fit → cover')

  /* 五个选项都在 OPTIONS 里（设置页要能渲染）。 */
  const opts = t.OPTIONS.glassFit
  check(Array.isArray(opts) && opts.length === 6, 'OPTIONS.glassFit 有 6 项', String(opts && opts.length))
  const values = (opts || []).map((o) => o.value).join(',')
  check(values === 'cover,contain,stretch,tile,center,blur', '六项顺序与语义齐全', values)
}

console.log('')
console.log('L. 背景图裁剪（glassCrop）')
{
  const norm = t.normalizeGlassCrop
  check(typeof norm === 'function', 'normalizeGlassCrop 已导出')

  /* 1. 整图 = 0,0,1,1 */
  const full = norm({ x: 0, y: 0, w: 1, h: 1 })
  check(full.x === 0 && full.y === 0 && full.w === 1 && full.h === 1, '整图规范化', JSON.stringify(full))

  /* 2. 越界夹取：x/w 超出 [0,1] */
  const over = norm({ x: 2, y: -1, w: 5, h: 5 })
  check(over.x === 0 && over.y === 0 && over.w === 1 && over.h === 1, '越界值被夹回 [0,1]', JSON.stringify(over))

  /* 3. 最小尺寸：w/h 不得小于 5% */
  const tiny = norm({ x: 0, y: 0, w: 0.001, h: 0.001 })
  check(tiny.w === 0.05 && tiny.h === 0.05, 'w/h 下限 5%（再小就没意义）', JSON.stringify(tiny))

  /* 4. **边界回推**：框不能越出右下边界 —— 保持宽高、把左上角往回推，
   *    而不是把框压扁（参照插件的手感：框被挡在边上停住）。 */
  const pushed = norm({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 })
  check(Math.abs(pushed.w - 0.5) < 1e-9 && Math.abs(pushed.h - 0.5) < 1e-9,
    '边界回推：宽高保持不变（不压扁）', JSON.stringify(pushed))
  check(Math.abs(pushed.x - 0.5) < 1e-9 && Math.abs(pushed.y - 0.5) < 1e-9,
    '边界回推：左上角被推回到 1-w / 1-h', JSON.stringify(pushed))

  /* 5. 坏输入不抛错 */
  check(norm(undefined) !== null && norm('garbage') !== null && norm(null) !== null,
    '坏输入（undefined / 字符串 / null）不抛错，回落整图')

  /* 6. 序列化：整图存空串（不把默认值写进 profile）。 */
  check(t.serializeGlassCrop({ x: 0, y: 0, w: 1, h: 1 }) === '',
    '整图序列化为空串（只存偏离默认的项）')
  const partial = t.serializeGlassCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })
  check(partial !== '' && JSON.parse(partial).w === 0.5, '非整图序列化成 JSON', partial)

  /* 7. 往返一致：serialize → parse 得回同一个区域。 */
  const round = t.parseCropSafe(partial)
  check(round.x === 0.1 && round.y === 0.2 && round.w === 0.5 && round.h === 0.6,
    '序列化往返一致', JSON.stringify(round))

  /* 8. parseCropSafe 对坏 JSON 安全回落。 */
  check(t.parseCropSafe('{broken').w === 1, '坏 JSON → 回落整图（不抛错）')
  check(t.parseCropSafe('').w === 1, '空串 → 整图')

  /* 9. 裁剪必须**真的重画**，不能用 background-position 模拟
   *    （百分比位移只对 cover 成立，平铺/居中会露出整张原图）。 */
  check(/function renderWallpaperCrop/.test(src), '有 renderWallpaperCrop（canvas 真重画）')
  check(/context\.drawImage\(/.test(src) && /canvas\.toBlob\(/.test(src),
    '裁剪走 drawImage + toBlob（真位图，不是 CSS 位移模拟）')
  /* ⚠️ 光有 drawImage 不够 —— 必须检查**参数语义**：第 2–5 参是源矩形
   * (sx, sy, sw, sh)，第 6–9 参是目标矩形。如果写成 drawImage(image, 0, 0,
   * nw, nh, …) 就是「整图缩放到裁剪尺寸」，等于用缩放冒充裁剪 ——
   * 画面会变形而不是裁掉边缘。这条断言是变异测试补出来的缺口。 */
  const cropFn = src.slice(src.indexOf('function renderWallpaperCrop'),
    src.indexOf('function renderWallpaperCrop') + 2200)
  check(/drawImage\(image,\s*sx,\s*sy,\s*sw,\s*sh,\s*0,\s*0,\s*sw,\s*sh\)/.test(cropFn),
    'drawImage 的源矩形用裁剪后的 sx/sy/sw/sh（不是整图 nw/nh）')
  check(/const sx = Math\.round\(crop\.x \* nw\)/.test(cropFn)
    && /const sy = Math\.round\(crop\.y \* nh\)/.test(cropFn),
    'sx/sy 由 crop.x/y × 原图尺寸算出（按比例定位）')
  check(/const sw = Math\.max\(1, Math\.round\(crop\.w \* nw\)\)/.test(cropFn)
    && /const sh = Math\.max\(1, Math\.round\(crop\.h \* nh\)\)/.test(cropFn),
    'sw/sh 由 crop.w/h × 原图尺寸算出（按比例定尺寸）')
  check(/wallpaperCropSeq/.test(src) && /seq !== wallpaperCropSeq/.test(src),
    '裁剪有递增序号（丢弃过期的异步结果，否则拖回整图会被旧结果覆盖）')
  check(/revokeObjectURL\(wallpaperCroppedUrl\)/.test(src),
    '裁剪结果用完 revoke（不泄漏 objectURL）')
}

console.log('')
console.log('M. 文字保护（glassGuard）')
{
  const build = (guard, isDarkMode) => buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', glassGuard: guard },
    dark, isDarkMode,
  )
  const off = build('off', true)
  const on = build('on', true)
  check(off !== on, 'glassGuard 开 → 玻璃表多出文字保护规则')
  check(!/text-shadow/.test(off), '关着的时候不写 text-shadow')

  /* 1. 光晕存在且与明暗同向。
   *    ⚠️ 去空白后 `0 0 1px` 会变成 `001px`，所以匹配的必须是**压缩后**的字面量。 */
  const onDark = build('on', true)
  const onLight = build('on', false)
  const squeeze = (text) => text.replace(/\s/g, '')
  check(/text-shadow:001pxrgba\(0,0,0,/.test(squeeze(onDark)),
    '深色主题 → 黑晕')
  check(/text-shadow:001pxrgba\(255,255,255,/.test(squeeze(onLight)),
    '浅色主题 → 白晕')

  /* 2. 次要文字必须一起改 —— 光晕在浅灰字上是帮倒忙
   *    （灰字压在白晕上对比度反而更低），必须把字本身改深。 */
  check(/--dsw-alias-label-secondary/.test(onDark), '次要文字 token 被调整')
  check(/--dsw-alias-label-tertiary/.test(onDark), '三级文字 token 被调整')
  check(/--dsw-alias-label-caption/.test(onDark), 'caption token 被调整')

  /* 3. ⚠️ 核心纪律：文字保护规则里**不许出现 background** ——
   *    靠加底色「修」可读性会直接违背用户调好的透明度。 */
  const guardBlock = (sheet) => {
    const i = sheet.indexOf('text-shadow')
    if (i < 0) return ''
    const start = sheet.lastIndexOf('\n', i) + 1
    const end = sheet.indexOf('}', i)
    return sheet.slice(start, end + 1)
  }
  const block = guardBlock(onDark)
  check(block !== '' && !/background/.test(block),
    '文字保护规则体不含任何 background（不许靠加底色修可读性）', block.slice(0, 60))

  /* 4. 深浅两套用不同的调色板方向。 */
  check(onDark !== onLight, '深/浅两套文字保护规则不同（同向而非同一套）')
}

console.log('')
console.log('N. 跟随图片明暗（glassAutoTone）')
{
  check(/function applyGlassAutoTone/.test(src), '有 applyGlassAutoTone')
  check(/function measureGlassLuma/.test(src), '有 measureGlassLuma（32×32 亮度采样）')
  check(/function restoreGlassBaseTheme/.test(src), '有 restoreGlassBaseTheme（还原用户偏好）')

  /* 1. 阈值：< 0.42 切 dark、> 0.58 切 light、中间不切。 */
  check(/GLASS_TONE_DARK_BELOW = 0\.42/.test(src), '深色阈值 0.42')
  check(/GLASS_TONE_LIGHT_ABOVE = 0\.58/.test(src), '浅色阈值 0.58')

  /* 2. 亮度公式必须是 WCAG 相对亮度（0.2126/0.7152/0.0722），
   *    不能用简单平均 —— 后者对绿色权重过低，判断会偏。 */
  const lumaFn = src.slice(src.indexOf('function measureGlassLuma'),
    src.indexOf('function measureGlassLuma') + 2600)
  check(/0\.2126/.test(lumaFn) && /0\.7152/.test(lumaFn) && /0\.0722/.test(lumaFn),
    '亮度用 WCAG 相对亮度权重（不是简单平均）')
  check(/0\.04045/.test(lumaFn) && /Math\.pow/.test(lumaFn),
    '做了 sRGB → 线性光转换（否则暗部判断失真）')

  /* 3. ⚠️ 只动内置主题：第三方主题 id 一律不碰。 */
  check(/BUILTIN_THEME_IDS/.test(src), '有内置主题白名单（light/dark/system）')
  check(/BUILTIN_THEME_IDS\.includes\(preference\)/.test(src),
    '切换前检查当前偏好是不是内置主题（不顶掉第三方主题）')

  /* 4. 必须走官方 setTheme，不是改 DOM 属性。 */
  const autoFn = src.slice(src.indexOf('async function applyGlassAutoTone'),
    src.indexOf('async function applyGlassAutoTone') + 3000)
  check(/themeService\.setTheme\(want\)/.test(autoFn), '走官方 themeService.setTheme()')
  check(!/data-ds-dark-theme/.test(autoFn),
    '不自己改 data-ds-dark-theme 属性（改了宿主内部状态不跟）')

  /* 5. 还原纪律：用户中途自己改过 → 只清基准、不覆盖。 */
  check(/const changed = preference !== '' && preference !== base/.test(src),
    '还原前检查用户是否中途改过（改过就不覆盖他的选择）')
  check(/glassBaseTheme/.test(src), '有 glassBaseTheme 记住原偏好（重启后仍认得）')

  /* 6. 测量期间设置变了要丢弃结果。 */
  check(/if \(sig !== glassToneSig\) return/.test(src),
    '异步测量期间设置变了 → 丢弃过期结果')
}

console.log('')
console.log('O. 按区域独立档（glassPanelOpacity / glassPreviewOpacity / glassOverlayBlur / glassComposerBlur）')
{
  const build = (extra) => buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', ...extra },
    dark, true,
  )
  const base = build({})

  /* 1. 默认 -1 = 不覆盖 → 行为与升级前完全一致（老 profile 不受影响）。 */
  check(build({ glassPanelOpacity: '-1' }) === base, 'glassPanelOpacity = -1 → 跟随默认（行为不变）')
  check(build({ glassPreviewOpacity: '-1' }) === base, 'glassPreviewOpacity = -1 → 跟随默认')
  check(build({ glassOverlayBlur: '-1' }) === base, 'glassOverlayBlur = -1 → 跟随默认')
  check(build({ glassComposerBlur: '-1' }) === base, 'glassComposerBlur = -1 → 跟随默认')
  /* 不写字段也等于 -1。 */
  check(build({}) === base, '不写这四个字段 = 全部跟随默认')

  /* 2. 给了值就真的改变输出。 */
  check(build({ glassPanelOpacity: '95' }) !== base, 'glassPanelOpacity 给了值 → 玻璃表跟着变')
  /* ⚠️ previewOpacity 的消费者是**运行时检测到的宿主卡片类名**（cardTargets），
   * 不传 targets 时它没有输出 —— 这是设计使然，不是缺陷。所以这里必须传。 */
  const targets = [{ defClass: '_card', varName: '--changes-fill', hoverVar: '--changes-hover' }]
  const withTargets = (extra) => buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', ...extra }, dark, true, targets)
  check(withTargets({ glassPreviewOpacity: '95' }) !== withTargets({}),
    'glassPreviewOpacity 给了值 → 卡片浓度跟着变（需 cardTargets）')
  check(build({ glassOverlayBlur: '50' }) !== base, 'glassOverlayBlur 给了值 → 玻璃表跟着变')
  check(build({ glassComposerBlur: '95' }) !== base, 'glassComposerBlur 给了值 → 玻璃表跟着变')

  /* 3. 浮层模糊：默认必须是 blur + 10（原行为），给了值就直接用。
   * ⚠️ 不能从 [role="dialog"] 往后懒匹配 —— 那条规则前面还有 `_frame::before`
   * 的 blur，懒匹配会先命中它（实测抓到 16 而不是 26）。必须切到规则体内取。 */
  const frostedOf = (sheet) => {
    const i = sheet.indexOf('[role="dialog"]')
    if (i < 0) return null
    const seg = sheet.slice(i, sheet.indexOf('}', i))
    const m = seg.match(/backdrop-filter:blur\((\d+(?:\.\d+)?)px\)/)
    return m === null ? null : Number(m[1])
  }
  const defBlur = frostedOf(base)
  check(defBlur === 26, '浮层模糊默认 = glassBlur(16) + 10 = 26', String(defBlur))
  const customBlur = frostedOf(build({ glassOverlayBlur: '50' }))
  check(customBlur === 50, 'glassOverlayBlur 给了值 → 浮层直接用该值（不再 +10）', String(customBlur))
  const zeroBlur = frostedOf(build({ glassOverlayBlur: '0' }))
  check(zeroBlur === 0, 'glassOverlayBlur = 0 → 浮层真的不模糊（不是 +10）', String(zeroBlur))

  /* 4. 钳制与坏值。 */
  check(build({ glassPanelOpacity: '999' }) === build({ glassPanelOpacity: '100' }),
    'glassPanelOpacity 超上限被夹到 100')
  check(build({ glassPanelOpacity: 'abc' }) === base, 'glassPanelOpacity 非数字 → 回落跟随默认')

  /* 5. 计算路径必须透传 from（不能只读模块级 state）。 */
  for (const fn of ['glassPanelAlpha', 'glassPreviewAlpha', 'glassOverlayBlurPx', 'glassComposerBlurPx', 'glassComposerAlpha']) {
    check(new RegExp('function ' + fn + '\\([^)]*from').test(src), fn + ' 接受 from 参数（设置页预览不分叉）')
  }

  /* 6. ⚠️ 我们的输入卡**不做模糊**（做了硬裁，背后无文字可糊）——
   *    所以 glassComposerBlur 在我们这里管浓度。这条锁住这个架构决定，
   *    防止有人照抄参照插件往卡片上加 backdrop-filter。 */
  const cardRule = src.slice(src.indexOf('[class*="RlGAzG_card"]{'),
    src.indexOf('[class*="RlGAzG_card"]{') + 400)
  check(!/backdrop-filter/.test(cardRule),
    '输入卡规则里没有 backdrop-filter（硬裁后背后无文字，加了只有包含块副作用）')
}

console.log('')
console.log('P. 氛围光配色（glassAmbientAccent）')
{
  /* 1. 空串 = 跟随表面色（原行为，向后兼容）。 */
  const baseGrad = t.buildGradientBackdrop(dark, true, '')
  const noArg = t.buildGradientBackdrop(dark, true)
  check(baseGrad === noArg, "空串 / 不传参 = 跟随表面色（原行为不变）")

  /* 2. ⚠️ 2026-10-23 第五轮起，地面由 buildGround() 接管（光源自选颜色），
   * buildGradientBackdrop 降级为 deprecated 包装，**不再接受 accentId**。
   * 氛围光配色表本身仍然存在（AMBIENT_ACCENTS），但不再是地面色的来源。
   * 这里改为验证「表还在 + 四套配色互不相同」。 */
  /* 2026-10-23 整理：AMBIENT_ACCENTS 与 glassAmbientAccent 已删除（死代码）。 */
  check(t.AMBIENT_ACCENTS === undefined, 'AMBIENT_ACCENTS 已删除（死代码清理）')
  check(t.OPTIONS.glassAmbientAccent === undefined, 'OPTIONS.glassAmbientAccent 已删除')

  /* 4. 非法值回落跟随表面色，不抛错。 */
  check(t.buildGradientBackdrop(dark, true, 'nonsense') === baseGrad, '非法配色 id → 回落跟随表面色')

  /* 5. 输出必须是合法 CSS（四个色标 + 三个 radial-gradient）。 */
  const grad = t.buildGradientBackdrop(dark, true, 'ocean')
  check((grad.match(/radial-gradient/g) || []).length === 3, '渐变仍含 3 个光斑')
  check(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/.test(grad), '色标是合法的 rgba 串')
  check(!/undefined|NaN/.test(grad), '渐变里没有 undefined/NaN')

  /* 7. 与「强调色」是两件事：氛围光只影响背景，不影响 accent 令牌。 */
  const sheetA = buildGlassSheet({ glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', glassAmbientAccent: 'ocean' }, dark, true)
  const sheetB = buildGlassSheet({ glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', glassAmbientAccent: '' }, dark, true)
  check(sheetA === sheetB, '氛围光配色不改变玻璃令牌表（只作用于背景层）')
}

console.log('')
console.log('Q. 改实心：浮层（glassSolidFloats）')
{
  /* 浅色表面色（文件顶部只定义了 dark）。 */
  const lightSurf = { base: '#FFFFFF', sidebar: '#F8F9FA', layer1: '#F1F3F4', layer2: '#E8EAEC', layer3: '#DFE2E5', overlay: '#FFFFFF', bubble: '#F5F6F7' }
  const build = (extra, isDarkMode = true, surf = dark) => buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', ...extra },
    surf, isDarkMode,
  )
  const off = build({})
  const on = build({ glassSolidFloats: 'on' })

  /* ⚠️ 2026-10-24 行为改变（用户报 bug）：
   * 之前默认关时这两个浮层**完全没被玻璃处理**，背后活文字直接透上来。
   * 现在分两层：
   *   · 默认 → 跟 dialog/menu 同一套差值+预补偿+模糊（半透明玻璃）
   *   · 开启改实心 → 再钉成完全不透明（后一条规则覆盖前一条）
   * 所以「默认不写规则」这条旧断言必须反转。 */


  /* ---- 2026-10-24：浮层类名检测（detectPopoverClasses）----
   *
   * 为什么不能按类名硬匹配（两次踩坑）：
   *   第一版 [class*="_preview_"] → 漏掉 xpvNua_preview（无前导下划线）
   *   第二版 [class*="preview"]   → 误伤 JSON 树着色（_preview_1alm6_221
   *                                只有 color 没有 background），
   *                                diff 区域每个 JSON 值都变成实心块
   * 现在改为扫样式表 + 判「规则里有没有 background」。 */
  {
    const hostCss = [
      '._preview_38jqx_52{display:flex;background:var(--dsw-alias-bg-layer-1)}',
      '.xpvNua_preview{position:absolute;background:var(--dsw-alias-bg-layer-1)}',
      '._float_6nhg2_156{background:var(--dsw-alias-bg-base)}',
      '._preview_1alm6_221,._previewProperty_1alm6_225{color:var(--json-tree-punctuation)}',
      '._previewEllipsis_1alm6_229{color:var(--dsw-alias-label-tertiary)}',
      '.xpvNua_previewPrompt{font:var(--dsw-font-xs-strong-13)}',
      '.xpvNua_previewResponse{color:var(--dsw-alias-label-caption)}',
      '._floatingCell_6nhg2_156{width:0;height:0}',
      '.dmt-preview{background:var(--dsw-alias-markdown-code-block)}',
    ].join('\n')
    const cssom = (() => {
      const out = []
      const re = /([^{}]+)\{([^}]*)\}/g
      let m
      while ((m = re.exec(hostCss)) !== null) {
        const map = {}
        for (const d of m[2].split(';')) {
          const i = d.indexOf(':')
          if (i < 0) continue
          map[d.slice(0, i).trim()] = d.slice(i + 1).trim()
        }
        out.push({ selectorText: m[1].trim(), style: { getPropertyValue: (n) => map[n] === undefined ? '' : map[n] } })
      }
      return out
    })()
    const found = t.detectPopoverClasses({ styleSheets: [{ cssRules: cssom }] })

    /* 三个浮层本体必须命中 —— 包括两种命名格式。 */
    check(found.includes('_preview_38jqx_52'), '检测到 _preview_38jqx_52（格式 A）', JSON.stringify(found))
    check(found.includes('xpvNua_preview'), '检测到 xpvNua_preview（格式 B）', JSON.stringify(found))
    check(found.includes('_float_6nhg2_156'), '检测到 _float_6nhg2_156', JSON.stringify(found))
    /* 只有 color 没有 background 的必须排除 —— 第二版误伤的根源。 */
    for (const c of ['_preview_1alm6_221', '_previewProperty_1alm6_225',
      '_previewEllipsis_1alm6_229', 'xpvNua_previewPrompt', 'xpvNua_previewResponse',
      '_floatingCell_6nhg2_156', 'dmt-preview']) {
      check(!found.includes(c), '排除非浮层 ' + c, JSON.stringify(found))
    }

    /* 检测结果必须真的被用进 CSS：精确类名，不是子串匹配。 */
    const withPop = buildGlassSheet(
      { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16' },
      dark, true, [], [], ['_preview_38jqx_52', 'xpvNua_preview'],
    )
    check(/\._preview_38jqx_52/.test(withPop), '规则用精确类名（不用 [class*=]）')
    check(/\.xpvNua_preview/.test(withPop), '规则覆盖 xpvNua_preview')
    check(/:has\(> \._preview_38jqx_52\)/.test(withPop), 'contain 解除用精确类名')
    check(/contain:none !important/.test(withPop), 'contain 被设为 none')
    /* 未检测到时不该瞎猜。 */
    check(!/[^{]*_preview_38jqx[^{]*\{background/.test(off), '未检测到 → 不生成浮层规则')
  }

  /* ---- ⚠️ 2026-10-24 真 bug：调用点没传 popoverClasses ----
   *
   * buildGlassSheet 加了第 6 个参数，但**真正的调用点漏传了** ——
   * 我改字符串时改到的是导出区的同名文本，不是调用点。
   * 表现：规则生成逻辑本身没问题（单测能过），但运行时永远拿不到
   * 浮层类名，规则从不生成，浮层没模糊。
   *
   * 这条断言锁死「所有调用点都传第 6 个参数」。 */
  {
    const callLines = src.split('\n').filter((l) => l.includes('buildGlassSheet(state, surfaces'))
    check(callLines.length > 0, '找到 buildGlassSheet 的运行时调用点', String(callLines.length))
    for (const l of callLines) {
      check(/popoverClasses/.test(l), '调用点传入 popoverClasses', l.trim().slice(0, 100))
    }
    /* ⚠️ 2026-10-27：检测从「找到就永久停止」改成 refreshPopoverClasses()
     * —— 跟着样式表张数变化重扫并**合并**。队友面板（EBLgjq_panel）的
     * CSS 来自实验性插件、注入晚于启动期，旧写法扫到 hovercard 就不再
     * 重扫，晚到的面板类永远抓不到（用户报「还是不行」的直接原因）。 */
    check(/function refreshPopoverClasses/.test(src), '检测走统一重扫入口')
    check(/popoverScannedSheets/.test(src), '记录上一轮扫描的样式表张数')
    check(/mergePopoverClasses/.test(src), '多轮检测结果合并（不互相覆盖）')
    check(/diag\.popovers/.test(src), '诊断暴露 popovers 计数')

    /* ⚠️ 行为驱动测试（不是查函数存在——那是第四次假绿教训）。
     * refreshPopoverClasses 接受注入的 doc，直接模拟
     * 「启动期一张表 → 插件晚到注入第二张」的真实时序。 */
    {
      const earlySheet = { cssRules: toCssom(
        '.xpvNua_preview{position:absolute;background:#2F3841;box-shadow:0 0 0 red}') }
      const lateSheet = { cssRules: toCssom(
        '.EBLgjq_panel{position:fixed;border-radius:12px;box-shadow:0 8px 32px #000}') }
      /* ⚠️ 每个场景先 reset —— popoverClasses/ScanTries 是模块级状态，
       * 不隔离的话前一个场景烧掉的预算会让后一个看到"预算已尽"的假象。 */
      t.resetPopoverScan()

      /* 场景 1：启动期一张表 → 插件晚到注入第二张（真实时序）。 */
      t.refreshPopoverClasses({ styleSheets: [earlySheet] })
      const after1 = t.getPopoverClasses()
      check(after1.includes('xpvNua_preview'),
        '第一轮扫到启动期浮层', JSON.stringify(after1))
      t.refreshPopoverClasses({ styleSheets: [earlySheet, lateSheet] })
      const after2 = t.getPopoverClasses()
      check(after2.includes('xpvNua_preview') && after2.includes('EBLgjq_panel'),
        '张数变化后合并晚到的面板类（"找到就停"会漏 EBLgjq_panel）',
        JSON.stringify(after2))
      /* 张数没变 → 不扫。 */
      check(t.refreshPopoverClasses({ styleSheets: [earlySheet, lateSheet] }) === false,
        '张数未变时不重复扫描')

      /* 场景 2：结果为空 + 张数不变时**不消耗预算**。
       * 旧守卫要求「已有结果才跳过」—— 结果为空时每次 applyNow
       * （启动期每 250ms 一次）都放行到计数，预算在宿主注入完成前
       * 就被白白烧光，插件晚到的表反而扫不到。
       * 判别法：空集合下 refresh 超过预算次数，然后新表出现 ——
       * 新守卫一次都没消耗（张数没变），照样扫到；旧守卫烧光，扫不到。 */
      t.resetPopoverScan()
      for (let i = 0; i < 450; i += 1) {
        t.refreshPopoverClasses({ styleSheets: [] })
      }
      t.refreshPopoverClasses({ styleSheets: [lateSheet] })
      check(t.getPopoverClasses().includes('EBLgjq_panel'),
        '空结果+张数不变不烧预算（450 次空转后仍能扫到新表）',
        JSON.stringify(t.getPopoverClasses()))

      /* 场景 3：预算必须 > 启动期注入量（宿主约 200 张表）。
       * 模拟 250 次"张数+1"的空扫（每步都触发扫描），第 251 步
       * 才出现浮层表：预算 60 会在第 61 步耗尽 → 永远扫不到。 */
      t.resetPopoverScan()
      let budgetOk = true
      for (let n = 1; n <= 250; n += 1) {
        t.refreshPopoverClasses({ styleSheets: new Array(n).fill({ cssRules: [] }) })
      }
      t.refreshPopoverClasses({ styleSheets: [lateSheet] })
      check(t.getPopoverClasses().includes('EBLgjq_panel'),
        '预算扛得住启动期 250 次注入（60 不够，本次提到 400）',
        JSON.stringify(t.getPopoverClasses()))

      /* 场景 4：表被替换（HMR/插件重载）时旧结果不丢——合并语义。
       * 必须让**张数变化**才会触发扫描（张数相同走守卫直接返回）：
       * 1 张 → 2 张（合并进 EBLgjq_panel）→ 1 张（只剩 lateSheet）。
       * 最后一轮本轮扫描看不到 xpvNua_preview —— 覆盖式赋值会把它丢掉，
       * 合并则保住。 */
      t.resetPopoverScan()
      t.refreshPopoverClasses({ styleSheets: [earlySheet] })
      t.refreshPopoverClasses({ styleSheets: [earlySheet, lateSheet] })
      t.refreshPopoverClasses({ styleSheets: [lateSheet] })
      const after4 = t.getPopoverClasses()
      check(after4.includes('xpvNua_preview') && after4.includes('EBLgjq_panel'),
        '表被替换时旧结果不丢（合并而非覆盖）', JSON.stringify(after4))

      /* 合并函数本身：保序、去重。 */
      const merged = t.mergePopoverClasses(['a', 'b'], ['b', 'c'])
      check(JSON.stringify(merged) === JSON.stringify(['a', 'b', 'c']),
        'merge 保序去重', JSON.stringify(merged))
      t.resetPopoverScan()
    }
  }

  /* ---- ⚠️ 2026-10-24：白雾只能叠一层 ----
   *
   * 用户报「代码预览的白雾比其他地方重很多」。
   * 根因：代码块嵌在卡片/列里，两者都应用了 glassSurface（含白雾），
   * 8% + 8% 合成约 15.4% —— 视觉上明显更白更闷。
   *
   * 修法：拆成两个版本
   *   glassSurface     带白雾 → 只给最外层（列/卡片/弹层/浮层）
   *   glassSurfaceFlat 无白雾 → 给嵌套层（代码块）
   *
   * 这条断言锁死「代码块不带白雾」。 */
  {
    const sheet = buildGlassSheet(
      { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', glassHaze: '8' },
      dark, true,
    )
    const codeRule = sheet.split('\n').find((l) => l.includes('.md-code-block'))
    check(codeRule !== undefined, '代码块规则存在')
    if (codeRule !== undefined) {
      /* ⚠️ 2026-10-24 修正：代码块**要有**白雾，但只能是薄的一层。
       *
       * 第一版把它完全去掉（background-image:none），用户反馈
       * 「他们的白雾效果怎么就没了」—— 因为父层的白雾被代码块自己的
       * 实色底盖住了，子层不补就真的看不见。
       *
       * 正确做法：子层给父层的 1/3。
       *   父 8% + 子 8%   → 合成 15.4%（太重，原 bug）
       *   父 8% + 子 0%   → 合成 8%，但子层自己不发白（第一版，"白雾没了"）
       *   父 8% + 子 2.7% → 合成 10.5%（第二版，用户说"浓了"）
       *   父 8% + 子 1%   → 合成 8.9%（现在，基本等于单层基准）
       *
       * 目标不是"看得出有白雾"，而是"和别处一样" —— 合成浓度贴近 8%。
       * 断言：代码块有白雾，但合成后不超过父层的 1.5 倍。 */
      const codeHaze = codeRule.match(/background-image:linear-gradient\(to bottom,rgba\(255, 255, 255, ([\d.]+)\)/)
      check(codeHaze !== null, '代码块有白雾（不能是 none）', codeRule.slice(0, 100))
      if (codeHaze !== null) {
        const codeVal = Number(codeHaze[1])
        check(codeVal > 0, '代码块白雾大于 0', String(codeVal))
        /* 合成浓度必须贴近单层基准：子层 1% + 父层 8% = 8.9%，
         * 和别处的 8% 肉眼一致。上限 2%（合成 9.8%）已是可接受边界。 */
        check(codeVal < 0.02, '代码块白雾远淡于父层（<2%，合成≤9.8%）', String(codeVal))
        /* 但不能为 0 —— 那会让代码块自己完全没白雾。 */
        check(codeVal >= 0.005, '代码块白雾不为 0（否则该层无白雾）', String(codeVal))
      }
      /* 但边缘高光和描边要留着 —— 那是材质感，不是白雾。 */
      check(/box-shadow:/.test(codeRule), '代码块保留边缘阴影')
      check(/border:0\.5px solid/.test(codeRule), '代码块保留描边')
    }
    /* 最外层仍然要有白雾。 */
    const cardRule = sheet.split('\n').find((l) => l.includes('kuvljq_card'))
    check(cardRule !== undefined && /rgba\(255, 255, 255/.test(cardRule),
      '最外层卡片仍有白雾', cardRule ? cardRule.slice(0, 80) : '未找到')
  }

  /* ---- 2026-10-24：三个真机 bug 的修复锁 ---- */
  {
    /* A. 子智能体悬浮卡透明（bug2）：frame 规则必须限定布局 frame。 */
    check(/\[class\*="_frame"\]\[style\*="grid-template-columns"\]\{background:transparent/.test(src),
      'frame 透明规则限定布局 frame（不误伤 jIHOOq_frame 等内容卡）')
    check(/\[class\*="_frame"\]\[style\*="grid-template-columns"\]::before/.test(src),
      '顶部条规则同样限定（否则内容卡会多出 40px 渐变条）')

    /* B. 切渐变要点两下（bug3）：paint 必须同时判「当前模式 = 壁纸」。
     *    只判 status 时，切走的瞬间旧壁纸还会被画一遍。 */
    const paintFn = src.slice(src.indexOf('function paintWallpaperLayer'),
      src.indexOf('function paintWallpaperLayer') + 1200)
    check(/state\.glassBackground === 'wallpaper'/.test(paintFn),
      'paint 判当前模式（切换立即生效，不需要第二下）')
    /* 非壁纸路径要撤出血层（blur 填充的糊图层只属于壁纸模式）。 */
    const gradPath = paintFn.slice(paintFn.indexOf('syncWallpaperBleed(false'))
    check(gradPath.length > 0 && paintFn.indexOf('syncWallpaperBleed(false') > paintFn.indexOf('const gradient = backdropGradient') - 400,
      '非壁纸模式撤出血层')

    /* C. 重启后会话加载失败（bug1）：seat 抬升必须是防抖（每次变动
     *    clearTimeout 重排），不能是节流（有 timer 就 return）。
     *    节流的 250ms 到点常落在 React commit 之间 → removeChild 崩树。 */
    const schedFn = src.slice(src.indexOf('function scheduleSeatLift'),
      src.indexOf('function scheduleSeatLift') + 900)
    check(/clearTimeout\(seatLiftTimer\)/.test(schedFn),
      'scheduleSeatLift 是防抖（clearTimeout 重排，React 空闲才搬）')
    check(!/if \(seatLiftTimer !== null\) return\n/.test(schedFn),
      '不再是节流语义（有 timer 直接 return 会在 commit 中途搬 DOM）')
  }

  /* ---- 2026-10-27：判据②（悬浮面板特征）+ paint 的 loading 分支 ----
   *
   * bug2 上一轮修错了对象：jIHOOq_frame 是「只读输入卡」，用户截图里
   * 那块是**队友面板** .EBLgjq_panel —— 它类名里没有 preview/float，
   * 而且**宿主没给它 background**（底色铺在每一行成员上），
   * 所以判据①完全抓不到，面板本体一直裸透明。
   *
   * 判据②：position:fixed + border-radius + box-shadow，且非铺满整窗。
   * 全宿主扫这条命中 13 个类，全是真浮层，零误伤。 */
  {
    const hostCss = [
      /* 真浮层：无底色的面板本体（队友面板） */
      '.EBLgjq_panel{z-index:100;width:min(500px,100vw - 32px);border-radius:12px;box-shadow:var(--dsw-elevation-prominent);position:fixed;overflow:hidden}',
      /* 真浮层：有底色但名字不含 preview */
      '.Xt1eiG_panel{position:fixed;border-radius:12px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}',
      '._toast_l6cvn_6{position:fixed;border-radius:8px;background:var(--dsw-alias-bg-tooltip);box-shadow:0 4px 16px rgba(0,0,0,.3)}',
      /* 真浮层，但类名**含连字符**（宿主全局类常见形态）。
       * 正则若退化成 [a-zA-Z0-9_]+，配合 (?![\w-]) 前瞻会整体匹配失败
       * → 这个浮层被漏掉（不是误伤，是漏检，更难发现）。 */
      '.team-hoverPanel{position:fixed;border-radius:12px;box-shadow:var(--dsw-elevation-prominent);z-index:120}',
      /* 判据①的两种命名 */
      '._preview_38jqx_52{background:var(--dsw-alias-bg-layer-1);position:absolute}',
      '.xpvNua_preview{position:absolute;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel)}',
      /* 非浮层：面板内的成员行（有底色，但没 fixed/投影） */
      '.EBLgjq_member{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:8px}',
      /* 非浮层：正文卡片（有底色有圆角，但是 static） */
      '.kuvljq_card{background:var(--changes-fill);border-radius:12px;width:100%}',
      /* 非浮层：布局 frame（有底色，relative） */
      '.BynINW_frame{background:var(--dsw-alias-bg-base);display:grid;position:relative;height:100%}',
      /* 非浮层：铺满整窗的遮罩（fixed 但 inset:0） */
      '._backdrop_19zw2_2{position:fixed;inset:0;background:rgba(0,0,0,.4)}',
      /* 非浮层：吸顶工具条 —— fixed + 圆角，但**没有投影**
       * （只有 box-shadow 要求能挡住它） */
      '.Zticky_bar{position:fixed;border-radius:8px;background:var(--dsw-alias-bg-layer-1);top:0;left:0;right:0;height:40px}',
      /* 非浮层：全宽抽屉 —— fixed + 投影，但**没有圆角**
       * （只有 border-radius 要求能挡住它） */
      '.Drawer_root{position:fixed;box-shadow:0 0 40px rgba(0,0,0,.5);background:var(--dsw-alias-bg-layer-1);top:0;right:0;width:420px;height:100%}',
      /* 非浮层：全屏模态底 —— fixed + 圆角 + 投影，但 inset:0 铺满整窗
       * （只有 inset 排除能挡住它；涂上去 = 整屏糊一遍） */
      '.Modal_sheet{position:fixed;inset:0;border-radius:12px;box-shadow:var(--dsw-elevation-prominent);background:var(--dsw-alias-bg-layer-1)}',
      /* 非浮层：插件自己的设置页浮层 —— 命中特征但带 dmt- 前缀
       * （只有 dmt- 排除能挡住它，它由设置页样式表自己管） */
      '.dmt-floatPanel{position:fixed;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);background:var(--dsw-alias-bg-layer-2)}',
      /* 非浮层：插件设置页自己的元素 */
      '.dmt-preview{background:var(--dsw-alias-markdown-code-block);border-radius:8px}',
    ].join('\n')
    const found = t.detectPopoverClasses({ styleSheets: [{ cssRules: toCssom(hostCss) }] })
    for (const c of ['EBLgjq_panel', 'Xt1eiG_panel', '_toast_l6cvn_6',
      'team-hoverPanel', '_preview_38jqx_52', 'xpvNua_preview']) {
      check(found.includes(c), '检测到浮层 ' + c, JSON.stringify(found))
    }
    /* 每个排除项都由**特定一条守卫**挡住 —— 缺任何守卫都会漏进来。 */
    for (const c of ['EBLgjq_member', 'kuvljq_card', 'BynINW_frame',
      '_backdrop_19zw2_2', 'Zticky_bar', 'Drawer_root', 'Modal_sheet',
      'dmt-floatPanel', 'dmt-preview']) {
      check(!found.includes(c), '排除非浮层 ' + c, JSON.stringify(found))
    }
    /* ⚠️ 类名正则必须含连字符：宿主里 `dmt-floatPanel` 形态的 token，
     * 若正则退化成 [a-zA-Z0-9_]+，捕获到的是被连字符截断的 `dmt` ——
     * 前缀排除 /^dmt-/ 匹配不上 'dmt'，垃圾 token 混进结果。
     * 断言两头：完整 token 不出现，截断的 'dmt' 也不出现。 */
    check(!found.includes('dmt'),
      '类名正则含连字符（不把 dmt-floatPanel 截断成 dmt）', JSON.stringify(found))
    /* 检测到的类名要真的进 CSS，且带 backdrop-filter（浮在活文字上必须糊）。 */
    const withPanel = buildGlassSheet(
      { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16' },
      dark, true, [], [], ['EBLgjq_panel'],
    )
    const panelRule = withPanel.split('\n').find((l) => l.includes('.EBLgjq_panel'))
    check(panelRule !== undefined, '队友面板规则已生成')
    check(panelRule !== undefined && /backdrop-filter:blur/.test(panelRule),
      '队友面板带 backdrop-filter（糊掉背后正文）')
    check(panelRule !== undefined && /background-color:rgba\(/.test(panelRule),
      '队友面板有半透明底色（原本全透明）')
  }

  /* paint 的 loading 分支：换壁纸路径时不能先画渐变再翻回来。 */
  {
    const paintFn = src.slice(src.indexOf('function paintWallpaperLayer'),
      src.indexOf('function paintWallpaperLayer') + 1600)
    check(/if \(wallpaperStatus === 'loading'\) return/.test(paintFn),
      '壁纸模式 loading 期间保持当前画面（不闪渐变）')
    /* 顺序：loading 检查必须在 ready 检查之前。 */
    check(paintFn.indexOf("wallpaperStatus === 'loading'")
      < paintFn.indexOf("wallpaperStatus === 'ready'"),
      'loading 检查先于 ready')
  }

  /* ---- 2026-10-24：卡片本体必须用 ~= 词匹配，不能用 *= 子串 ----
   *
   * 用户截图实证：交付文件卡/计划卡内部出现"条中条"——
   * [class*="flL80G_file"] 连 flL80G_fileBody / fileName / fileIcon
   * 一起命中，描边+阴影+白雾被涂在每个内部行上。
   * CSS Modules 每个元素只有一个 token，~= 按词精确匹配即可区分。 */
  {
    const sheet = buildGlassSheet(
      { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16' },
      dark, true,
    )
    const cardLine = sheet.split('\n').find((l) => l.includes('flL80G_file'))
    check(cardLine !== undefined, '卡片玻璃规则存在')
    if (cardLine !== undefined) {
      /* 六个卡片前缀全部必须是 ~=。 */
      for (const tok of ['kuvljq_card', 'flL80G_file', 'KuQXFq_card',
        'QSKnSa_card', 'KZf9OG_card', 'j_8BDW_card']) {
        check(cardLine.includes('[class~="' + tok + '"]'),
          '卡片本体用 ~= 词匹配：' + tok, cardLine.slice(0, 60))
        check(!cardLine.includes('[class*="' + tok + '"]'),
          '不再用 *= 子串（会命中 ' + tok + 'Body/Title 等内部行）')
      }
      /* bubble 是唯一保留子串的：token 带各包哈希，不能写死。 */
      check(cardLine.includes('[class*="bubble"]'), 'bubble 保留子串匹配')
    }
  }

  /* ---- 2026-10-24：壁纸模式背景亮度 ----
   *
   * 用户要求壁纸模式也能调亮度。实现与渐变不同但语义一致：
   *   渐变 → mixTowards 改底色（拉到两端纯黑/纯白）
   *   壁纸 → CSS brightness() 滤镜（0 全黑 / 50 原样 / 100 翻倍）
   * 关键约束：等高线不适用（线色由强调色直出，改亮度会改歪）。 */
  {
    const wallSrc = src.slice(src.indexOf('function applyWallpaperFilter'), src.indexOf('function applyWallpaperFilter') + 2600)
    check(/brightness\(/.test(wallSrc), '壁纸滤镜链含 brightness()')
    /* 50 = 原样（brightness 不为 1 时才写进 filter 串）。 */
    check(/const bright = \(contourActive \|\| gradientMode\)\s*\n\s*\? 1/.test(wallSrc),
      '渐变/等高线时 brightness 为 1（不生效）')
    /* 换算：0 → 0（全黑），50 → 1，100 → 2（翻倍，保留照片细节）。 */
    check(/bpct < 50 \? Math\.max\(0, bpct \/ 50\) : 1 \+ \(bpct - 50\) \/ 50/.test(wallSrc),
      '换算公式：0→0, 50→1, 100→2')
    /* 亮度必须排在 blur/saturate 之前或之后都行，但必须在同一条 filter 串。 */
    check(/parts\.push\('brightness\('/.test(wallSrc), 'brightness 进入 filter 串')
  }

  /* 3. 打开 → 两个浮层**额外**被钉成实色。 */
  check(/_float_/.test(on), '打开 → 覆盖 _float_（历史消息浮层）')
  check(/_preview_/.test(on), '打开 → 覆盖 _preview_（悬停预览浮层）')

  /* 4. 实心档必须是**不透明**，否则「字压字」原样存在。 */
  const rule = on.match(/\[class\*="_float_"\],html\[data-dsh-glass\] \[class\*="_preview_"\]\{background-color:#[0-9a-fA-F]{6}/)
    || on.match(/\[class\*="_float_"\][^{]*\{background-color:#[0-9a-fA-F]{6}[^}]*backdrop-filter:none/)
  check(rule !== null, '打开 → 有 6 位 hex 实色规则', rule === null ? '' : rule[0].slice(0, 80))
  /* 实心档那条规则体里不能有 rgba。 */
  const solidBody = (() => {
    const all = [...on.matchAll(/\[class\*="_float_"\][^{]*\{[^}]*\}/g)].map(x => x[0])
    return all.find(b => /backdrop-filter:none/.test(b)) || ''
  })()
  check(solidBody !== '', '找到实心档规则体')
  check(/background-color:#[0-9a-fA-F]{6}\s*!important/.test(solidBody),
    '实心档底色是 6 位 hex（不带 alpha）', solidBody.slice(0, 90))
  check(!/rgba\(/.test(solidBody), '实心档规则里没有 rgba（完全不透明）')

  /* 4. 打开后必须**撤掉** backdrop-filter：实色之后模糊已无意义，
   *    留着只会白白建一层合成层。 */
  check(/backdrop-filter:none/.test(solidBody), '打开后撤掉 backdrop-filter（实色后模糊无意义）')

  /* 5. 深/浅两套用不同实色。 */
  const onDark = build({ glassSolidFloats: 'on' }, true, dark)
  const onLight = build({ glassSolidFloats: 'on' }, false, lightSurf)
  const colorOf = (sheet) => {
    const m = sheet.match(/\[class\*="_float_"\][^{]*\{background-color:(#[0-9a-fA-F]{6})/)
    return m === null ? null : m[1]
  }
  check(colorOf(onDark) !== null && colorOf(onLight) !== null && colorOf(onDark) !== colorOf(onLight),
    '深/浅两套实色不同', colorOf(onDark) + ' vs ' + colorOf(onLight))

  /* 6. 只匹配这两个局部名，不做全树扫描。 */
  check(!/\[class\*="_card_"\]/.test(on) || /_float_/.test(on),
    '选择器只点名 _float_ / _preview_（不做全树扫描）')
}

console.log('')
console.log('R. 改实心：diff 区域（glassSolidDiff）')
{
  const build = (extra, isDarkMode = true) => buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', ...extra },
    dark, isDarkMode,
  )
  const off = build({})
  const on = build({ glassSolidDiff: 'on' })

  /* 1. 默认关 → 不覆盖 diff 变量（玻璃观感不变）。 */
  check(!/--dsw-alias-code-diff-added:#/.test(off), '默认关 → 不覆盖 diff 变量')

  /* 2. 打开 → 两个变量都被覆盖成不透明实色。 */
  const m = on.match(/body\{--dsw-alias-code-diff-added:(#[0-9a-fA-F]{6}) !important;--dsw-alias-code-diff-deleted:(#[0-9a-fA-F]{6}) !important\}/)
  check(m !== null, '打开 → 同时覆盖 added 与 deleted')
  check(m !== null && /^#[0-9a-fA-F]{6}$/.test(m[1]) && /^#[0-9a-fA-F]{6}$/.test(m[2]),
    '两个值都是 6 位 hex 实色（不带 alpha）', m === null ? '' : m[1] + ' / ' + m[2])

  /* 3. ⚠️ 核心约束：**只改行底色，不动卡片/代码块**。
   *    用户明确说过「只动 diff 区域，不要动卡片本身」。 */
  const i = on.indexOf('--dsw-alias-code-diff-added:#')
  const ruleStart = on.lastIndexOf('\n', i) + 1
  const ruleEnd = on.indexOf('}', i)
  const diffRule = on.slice(ruleStart, ruleEnd + 1)
  check(!/_card_/.test(diffRule) && !/RlGAzG/.test(diffRule) && !/_markdown_/.test(diffRule),
    'diff 规则里不含卡片/代码块选择器（只动行底色）', diffRule.slice(0, 80))
  check(/^html\[data-dsh-glass\] body\{/.test(diffRule.trim()),
    'diff 规则只作用在 body 上的变量（不点名容器）', diffRule.trim().slice(0, 50))

  /* 4. 深/浅两套不同（暗背景下不能沿用亮色，否则刺眼）。 */
  const onDark = build({ glassSolidDiff: 'on' }, true)
  const onLight = build({ glassSolidDiff: 'on' }, false)
  const addedOf = (sheet) => {
    const mm = sheet.match(/--dsw-alias-code-diff-added:(#[0-9a-fA-F]{6})/)
    return mm === null ? null : mm[1]
  }
  check(addedOf(onDark) !== null && addedOf(onLight) !== null && addedOf(onDark) !== addedOf(onLight),
    '深/浅两套 diff 实色不同', addedOf(onDark) + ' vs ' + addedOf(onLight))

  /* 5. 保留色相语义：added 偏绿、deleted 偏红（不能调反）。 */
  const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) })
  const a = hex(addedOf(onDark))
  const d = hex((onDark.match(/--dsw-alias-code-diff-deleted:(#[0-9a-fA-F]{6})/) || [])[1])
  check(a.g > a.r && a.g > a.b, 'added 保留绿色语义（G 最大）', JSON.stringify(a))
  check(d.r > d.g && d.r > d.b, 'deleted 保留红色语义（R 最大）', JSON.stringify(d))
}

console.log('')
console.log('S. 任意强调色（accentCustom）')
{
  /* 1. 空串 = 用预设（原行为不变）。 */
  const preset = t.resolveAccent({ accent: 'teal' })
  check(preset.dark === '#5FB3B3', '空 accentCustom → 用 accent 预设', preset.dark)
  check(t.resolveAccent({ accent: 'teal', accentCustom: '' }).dark === preset.dark,
    '空串 accentCustom 等同不写（向后兼容）')

  /* 2. 给了合法 hex 就用它，预设失效。 */
  const custom = t.resolveAccent({ accent: 'teal', accentCustom: '#FF00FF' })
  check(custom.dark === '#FF00FF', '自定义色优先于预设', custom.dark)

  /* 3. 派生四档：深色直接用原色，浅色压暗一档（保证浅底上够对比）。 */
  check(custom.darkSoft === '#FF00FF55', 'darkSoft = 原色 + 33% alpha', custom.darkSoft)
  check(/^#[0-9a-f]{6}$/.test(custom.light), 'light 是合法 hex', custom.light)
  check(parseInt(custom.light.slice(1, 3), 16) < 0xFF,
    'light 比原色暗（浅色主题要压暗才够对比）', custom.light)
  check(custom.lightSoft === custom.light + '33', 'lightSoft = light + 20% alpha', custom.lightSoft)

  /* 4. 非法值安全回落预设，不抛错。 */
  for (const bad of ['abc', '#12345', '#GGGGGG', null, undefined, 123, {}]) {
    const r = t.resolveAccent({ accent: 'blue', accentCustom: bad })
    check(r.dark === '#6699CC', '非法 accentCustom（' + JSON.stringify(bad) + '）→ 回落预设', r.dark)
  }

  /* 5. 令牌层真的跟着变（不是只有 resolveAccent 对）。 */
  const key = '--dsw-alias-state-business-primary'
  check(key !== undefined, '找到品牌强调色令牌', key || '未找到')
  if (key !== undefined) {
    const a = t.resolveTokens({ accent: 'teal' })[key]
    const b = t.resolveTokens({ accent: 'teal', accentCustom: '#FF00FF' })[key]
    check(a.dark !== b.dark && b.dark === '#FF00FF',
      'resolveTokens 走自定义色（令牌真的变）', b.dark)
  }

  /* 6. hslToHex 产出合法颜色（随机按钮用）。 */
  for (const [h, sat, l] of [[0, 60, 60], [120, 60, 60], [240, 60, 60], [359, 50, 70]]) {
    const hex = t.hslToHex(h, sat, l)
    check(/^#[0-9a-f]{6}$/.test(hex), 'hslToHex(' + h + ') 产出合法 hex', hex)
  }
  /* 色相方向正确：0=红、120=绿、240=蓝。 */
  const red = t.hslToHex(0, 100, 50)
  const green = t.hslToHex(120, 100, 50)
  const blue = t.hslToHex(240, 100, 50)
  check(parseInt(red.slice(1, 3), 16) === 255 && parseInt(red.slice(3, 5), 16) === 0,
    'hsl(0) = 红', red)
  check(parseInt(green.slice(3, 5), 16) === 255 && parseInt(green.slice(1, 3), 16) === 0,
    'hsl(120) = 绿', green)
  check(parseInt(blue.slice(5, 7), 16) === 255 && parseInt(blue.slice(1, 3), 16) === 0,
    'hsl(240) = 蓝', blue)
}

console.log('')
console.log('T. 模糊填充（glassFit = blur）')
{
  const styleOf = (fit) => t.wallpaperFitStyle({ glassFit: fit })

  /* 1. blur 档：上层 contain（完整显示），并要求出血层。 */
  const blur = styleOf('blur')
  check(blur.size === 'contain' && blur.repeat === 'no-repeat',
    'blur 档上层是 contain（完整显示，不裁切）', JSON.stringify(blur))
  check(blur.bleed === true, 'blur 档要求出血层（bleed: true）')

  /* 2. 其他五档都不需要出血层（不能误开）。 */
  for (const fit of ['cover', 'contain', 'stretch', 'tile', 'center']) {
    check(styleOf(fit).bleed === false, fit + ' 档不要出血层')
  }

  /* 3. 出血层必须真的存在且带模糊。 */
  check(/function syncWallpaperBleed/.test(src), '有 syncWallpaperBleed')
  const fn = src.slice(src.indexOf('function syncWallpaperBleed'),
    src.indexOf('function syncWallpaperBleed') + 2400)
  check(/filter:blur\(48px\)/.test(fn), '出血层挂 filter: blur(48px)')
  check(/position:fixed/.test(fn) && /z-index:-1/.test(fn),
    '出血层 fixed + z-index:-1（在内容之下）')
  check(/inset:-40px/.test(fn), '出血层外扩 40px（抵消模糊边缘露底）')
  check(/pointer-events:none/.test(fn), '出血层不吃鼠标事件')

  /* 4. ⚠️ 关键约束：出血层必须是**独立元素**。
   *    filter 是元素级属性，没法只糊 background 的第一层 ——
   *    想糊出血层就不能糊壁纸层本身（会把上层清晰的 contain 图一起糊掉）。 */
  check(/wallpaperEl\.parentNode\.insertBefore/.test(fn),
    '出血层是独立 DOM 元素（插在壁纸层之前）')
  check(!/wallpaperEl\.style\.filter\s*=\s*'blur/.test(src),
    '不把 blur 挂在壁纸层自己身上（会糊掉上层清晰图）')

  /* 5. 关闭/切档时必须清理出血层，不留残留。 */
  check(/syncWallpaperBleed\(false, ''\)/.test(src), '玻璃关掉时清理出血层')
  check(/if \(!needed\) \{[\s\S]{0,200}wallpaperBleedEl\.remove\(\)/.test(fn),
    '不需要时 remove 出血层')
}

console.log('')
console.log('U. 侧栏独立浓度（glassSidebarOpacity）')
{
  const build = (extra) => buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', ...extra },
    dark, true,
  )
  const sidebarAlphaOf = (sheet) => {
    const m = sheet.match(/\[class\*="_sidebarCol"\]\{background:rgba\([^)]*?,\s*([\d.]+)\)/)
    return m === null ? null : Number(m[1])
  }

  /* 1. 默认 -1 = 跟随表面浓度（原行为不变）。 */
  const base = build({})
  check(sidebarAlphaOf(base) === 0.65, '默认跟随表面浓度 65%', String(sidebarAlphaOf(base)))
  check(build({ glassSidebarOpacity: '-1' }) === base, 'glassSidebarOpacity = -1 等同不写')

  /* 2. 给了值就真的改侧栏，且只改侧栏。 */
  check(sidebarAlphaOf(build({ glassSidebarOpacity: '100' })) === 1,
    'glassSidebarOpacity=100 → 侧栏不透明', String(sidebarAlphaOf(build({ glassSidebarOpacity: '100' }))))
  check(sidebarAlphaOf(build({ glassSidebarOpacity: '20' })) === 0.2,
    'glassSidebarOpacity=20 → 侧栏 20%', String(sidebarAlphaOf(build({ glassSidebarOpacity: '20' }))))

  /* 3. ⚠️ 不能连带改正文列 —— 那是「独立」的全部意义。 */
  /* ⚠️ 正文列的规则是「_centerCol + _rightbarCol」两个选择器连在一起，
   * 所以不能要求 "]{" 紧邻 —— 那样永远匹配不到，null === null 恒真，
   * 断言变成假绿（变异测试抓到过）。必须从选择器组起点扫到规则体。 */
  const centerOf = (sheet) => {
    const i = sheet.indexOf('[class*="_centerCol"]')
    if (i < 0) return null
    const seg = sheet.slice(i, sheet.indexOf('}', i))
    const m = seg.match(/background:rgba\([^)]*?,\s*([\d.]+)\)/)
    return m === null ? null : Number(m[1])
  }
  const withSidebar = build({ glassSidebarOpacity: '100' })
  check(centerOf(withSidebar) === centerOf(base),
    '改侧栏浓度**不动**正文列', '正文 ' + centerOf(withSidebar) + ' vs ' + centerOf(base))

  /* 4. 钳制与坏值。 */
  check(sidebarAlphaOf(build({ glassSidebarOpacity: '999' })) === 1, '超上限夹到 100')
  check(build({ glassSidebarOpacity: 'abc' }) === base, '非数字回落跟随默认')
}

console.log('')
console.log('V. 背景亮度（glassBrightness，双向）')
{
  const build = (b) => t.buildGradientBackdrop(dark, true, '', b, true)
  const tail = (sheet) => {
    /* 底色是整条 background 的最后一个值。 */
    const parts = sheet.split(/,(?![^()]*\))/)
    return parts[parts.length - 1].trim()
  }

  /* 1. 50 = 中性 → 原样输出 base（向后兼容，默认行为不变）。 */
  check(tail(build(50)) === '#343D46', 'brightness=50 → 原样 base', tail(build(50)))
  check(t.buildGradientBackdrop(dark, true, '', undefined, true) === build(50),
    '不传 brightness = 50（默认中性）')

  /* 2. **双向**：这是与 glassVeil 的核心区别 —— veil 只能压暗。 */
  const dark50 = tail(build(50))
  const dark20 = tail(build(20))
  const dark80 = tail(build(80))
  const lum = (hex) => {
    const n = (o) => parseInt(hex.slice(o, o + 2), 16)
    return 0.2126 * n(1) + 0.7152 * n(3) + 0.0722 * n(5)
  }
  check(lum(dark20) < lum(dark50), 'brightness=20 → 比中性**暗**', dark20)
  check(lum(dark80) > lum(dark50), 'brightness=80 → 比中性**亮**', dark80)
  check(lum(dark20) < lum(dark50) && lum(dark80) > lum(dark50),
    '**双向**可调（往左压暗、往右提亮）')

  /* 3. 端点：0 = 全黑，100 = 全白。 */
  check(tail(build(0)) === '#000000', 'brightness=0 → 纯黑', tail(build(0)))
  check(tail(build(100)) === '#FFFFFF', 'brightness=100 → 纯白', tail(build(100)))

  /* 4. 钳制与坏值。 */
  check(tail(build(999)) === '#FFFFFF', '超上限夹到 100')
  check(build('abc') === build(50), '非数字回落 50（中性）')

  /* 5. ⚠️ 联动淡出：亮度离开中性越远，氛围层越弱。
   *    拉到端点时必须**完全没有** radial-gradient（纯色）。 */
  const gradCount = (sheet) => (sheet.match(/radial-gradient/g) || []).length
  check(gradCount(build(50)) === 3, '中性时 3 个光斑全在', String(gradCount(build(50))))
  /* ⚠️ 2026-10-23：buildGradientBackdrop 已降级为 deprecated 包装，
   * 端点时 alpha 是 0 但字符串里仍会生成 radial-gradient（alpha 0）。
   * 真正的地面走 buildGround()，淡出由调用方把 glowA 乘 ambience 实现。
   * 这里改为断言「端点 alpha ≈ 0」。 */
  const firstAlpha = (sheet) => {
    const m = sheet.match(/rgba\([^)]*?,\s*([\d.]+)\)/)
    return m === null ? null : Number(m[1])
  }
  check(firstAlpha(build(0)) === 0 || firstAlpha(build(0)) < 0.01,
    '亮度拉到 0 → 光斑 alpha ≈ 0', String(firstAlpha(build(0))))
  check(firstAlpha(build(100)) === 0 || firstAlpha(build(100)) < 0.01,
    '亮度拉到 100 → 光斑 alpha ≈ 0', String(firstAlpha(build(100))))
  /* 中间值应该是部分淡出（alpha 变小），不是突然消失。 */
  const alphaAt = (sheet, idx) => {
    const m = [...sheet.matchAll(/rgba\([^)]*?,\s*([\d.]+)\)/g)]
    return m.length > idx ? Number(m[idx][1]) : null
  }
  const a50 = alphaAt(build(50), 0)
  const a30 = alphaAt(build(30), 0)
  check(a50 !== null && a30 !== null && a30 < a50,
    '亮度离开中性 → 光斑 alpha 变小（连续淡出，不是跳变）',
    '50: ' + a50 + ' / 30: ' + a30)
}

console.log('')
console.log('W. 地面光斑开关（glassGlow）')
{
  const withGlow = t.buildGradientBackdrop(dark, true, '', 50, true)
  const noGlow = t.buildGradientBackdrop(dark, true, '', 50, false)

  /* 1. 默认 on（不传参 = 开，向后兼容）。 */
  check(/radial-gradient/.test(withGlow), '光斑开 → 有 radial-gradient')
  check(t.buildGradientBackdrop(dark, true, '', 50) === withGlow, '不传 glow = 开（默认）')

  /* 2. 关掉 → 径向渐变全部消失。 */
  check(!/radial-gradient/.test(noGlow), '光斑关 → 没有 radial-gradient')
  check(noGlow !== withGlow, '开/关输出不同')

  /* 3. 关掉后**仍要有底色**（不能变成透明 —— 那会露出窗口黑底）。 */
  check(/#[0-9A-Fa-f]{6}/.test(noGlow), '关掉后仍有实色底（不会露黑）')
  check(/linear-gradient/.test(noGlow), '关掉后保留极轻方向渐变（不呆板）')

  /* 4. 关掉光斑 + 亮度拉满 → 纯色，无任何渐变。 */
  const flat = t.buildGradientBackdrop(dark, true, '', 100, false)
  check(!/radial-gradient/.test(flat), '光斑关 + 亮度 100 → 无径向渐变')
  check(/#FFFFFF/.test(flat), '光斑关 + 亮度 100 → 纯白底')

  /* 5. ⚠️ 2026-10-23 第五轮：glassGlow 开关被 glassGroundMode（glow/bands/blend）取代。
   * 保留字段是为了向后兼容（老 profile 里还有它），但新代码走 mode。 */
  check(/glassGroundMode/.test(src), '新代码走 glassGroundMode（glassGlow 保留兼容）')
  check(typeof t.buildGround === 'function', 'buildGround 已导出')
}

console.log('')
console.log('X. 背景地面：光晕（glassGroundMode = glow）')
{
  const build = (extra) => t.buildGround(dark, true, {
    mode: 'glow',
    lights: t.parseLightList('', t.GLOW_DEFAULTS, 6),
    bands: t.parseBandList(''),
    glowA: 38, spread: 100, dir: 165, soft: 2, base: '#343D46',
    ...extra,
  })

  /* 1. 光晕模式**只有** radial-gradient，绝不能混进 linear-gradient
   *    （那是分割层 —— 上一版预览就是这里错了，导致「光晕」看起来还是切割）。 */
  const css = build({})
  check(/radial-gradient/.test(css), '光晕模式有 radial-gradient')
  check(!/linear-gradient/.test(css), '光晕模式**没有** linear-gradient（不混入分割层）')

  /* 2. 光源数量可调（2–6）。 */
  for (const n of [2, 3, 4, 5, 6]) {
    const lights = []
    for (let i = 0; i < n; i++) lights.push({ color: '#5FB3B3', strength: '100', x: String(i * 15), y: String(i * 15) })
    const out = build({ lights })
    check((out.match(/radial-gradient/g) || []).length === n, n + ' 个光源 → ' + n + ' 条 radial')
  }

  /* 3. 每个光源的颜色可自选。 */
  const red = build({ lights: [{ color: '#FF0000', strength: '100', x: '50', y: '50' }] })
  check(/rgba\(255,\s*0,\s*0/.test(red), '光源颜色可自选（红色进了 CSS）', red.slice(0, 60))

  /* 4. 每个光源的位置可调。 */
  const atCorner = build({ lights: [{ color: '#5FB3B3', strength: '100', x: '5', y: '95' }] })
  check(/at 5% 95%/.test(atCorner), '光源位置可调（X/Y 进了 CSS）', atCorner.slice(0, 70))

  /* 5. 强度为 0 的光源不生成（避免空图层）。 */
  const zero = build({ lights: [{ color: '#5FB3B3', strength: '0', x: '50', y: '50' }] })
  check(!/radial-gradient/.test(zero), '强度 0 的光源不生成图层')

  /* 6. 浓度 0 → 无光晕（只有底色）。 */
  const none = build({ glowA: 0 })
  check(!/radial-gradient/.test(none), '浓度 0 → 无光晕')
  check(/#343D46/.test(none), '浓度 0 → 仍有底色')

  /* 6b. 浓度上限 100（2026-10-23 用户要求调高，原为 70）。 */
  const alphaAt = (sheet) => {
    const m = sheet.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/)
    return m === null ? null : Number(m[1])
  }
  const oneLight = (glowA) => build({
    lights: [{ color: '#5FB3B3', strength: '100', x: '50', y: '50' }], glowA,
  })
  check(alphaAt(oneLight(100)) === 1, '浓度 100% → alpha 1（完全不透明）', String(alphaAt(oneLight(100))))
  check(alphaAt(oneLight(150)) === 1, '浓度超上限 150 被夹到 100', String(alphaAt(oneLight(150))))
  check(alphaAt(oneLight(85)) === 0.85, '浓度 85% 正常生效', String(alphaAt(oneLight(85))))

  /* 7. 扩散范围真的改半径。 */
  const narrow = build({ spread: 40 })
  const wide = build({ spread: 140 })
  const radiusOf = (sheet) => {
    const m = sheet.match(/radial-gradient\((\d+)% (\d+)%/)
    return m === null ? null : Number(m[1])
  }
  check(radiusOf(narrow) < radiusOf(wide), '扩散范围越大 → 半径越大',
    radiusOf(narrow) + ' vs ' + radiusOf(wide))
}

console.log('')
console.log('Y. 背景地面：分割（glassGroundMode = bands）')
{
  const build = (extra) => t.buildGround(dark, true, {
    mode: 'bands',
    lights: t.parseLightList('', t.GLOW_DEFAULTS, 6),
    bands: t.parseBandList(''),
    glowA: 38, spread: 100, dir: 165, soft: 2, base: '#343D46',
    ...extra,
  })
  const css = build({})

  /* 1. 分割模式**只有** linear-gradient。 */
  check(/linear-gradient/.test(css), '分割模式有 linear-gradient')
  check(!/radial-gradient/.test(css), '分割模式**没有** radial-gradient（不混入光晕层）')

  /* 2. 方向可调。 */
  for (const d of [0, 90, 135, 165]) {
    check(new RegExp('linear-gradient\\(' + d + 'deg').test(build({ dir: d })), '方向 ' + d + '° 生效')
  }
  /* ---- 任意角度（2026-10-23 用户要求自由调节）----
   * 原来只接受 0/90/135/165 四个预设，其他值一律回退 165°。
   * 现在 0–360° 任意整数都该原样生效。 */
  const dirOf = (sheet) => {
    const m = sheet.match(/linear-gradient\((-?\d+)deg/)
    return m === null ? null : Number(m[1])
  }
  for (const d of [0, 30, 45, 90, 120, 135, 165, 180, 200, 270, 315, 359]) {
    check(dirOf(build({ dir: d })) === d, '任意角度 ' + d + '° 生效', String(dirOf(build({ dir: d }))))
  }
  /* 360 归一成 0（视觉等价，但 CSS 里写 360deg 也合法 —— 这里断言归一行为）。 */
  check(dirOf(build({ dir: 360 })) === 0, '360° 归一为 0°', String(dirOf(build({ dir: 360 }))))
  /* 超范围取模。 */
  check(dirOf(build({ dir: 400 })) === 40, '400° 取模为 40°', String(dirOf(build({ dir: 400 }))))
  check(dirOf(build({ dir: -30 })) === 330, '-30° 归一为 330°', String(dirOf(build({ dir: -30 }))))

  /* ⚠️ 2026-10-23：方向改成 0–360° 自由可调，不再只接受 4 个预设。
   * 超范围值取模归一（999 → 279），只有「非数字」才回落 165°。 */
  check(/linear-gradient\(279deg/.test(build({ dir: 999 })), '超范围角度取模归一（999 → 279°）',
    (build({ dir: 999 }).match(/linear-gradient\((\d+)deg/) || [])[1])
  check(/linear-gradient\(165deg/.test(build({ dir: 'abc' })), '非数字方向回落 165°')

  /* 3. 每条色带颜色可自选。 */
  const custom = build({ bands: [{ color: '#FF0000' }, { color: '#00FF00' }, { color: '#0000FF' }] })
  check(/#FF0000/.test(custom), '色带 1 自定义色生效')
  check(/#00FF00/.test(custom), '色带 2 自定义色生效')
  check(/#0000FF/.test(custom), '色带 3 自定义色生效')
  check((custom.match(/#[0-9A-F]{6}/g) || []).filter((x) => ['#FF0000','#00FF00','#0000FF'].includes(x)).length >= 3,
    '三条自定义色都在')

  /* 4. 色带数量可调（2–6）。 */
  for (const n of [2, 3, 4, 5, 6]) {
    const bands = []
    for (let i = 0; i < n; i++) bands.push({ color: '#4A555F' })
    const out = build({ bands })
    /* 每条带产生两个色标（起止），所以 2n 个。 */
    const stops = (out.match(/#[0-9A-F]{6} \d/g) || []).length
    check(stops >= n, n + ' 条色带 → 至少 ' + n + ' 个色标', String(stops))
  }

  /* 5. 边缘柔和：0 = 硬边（相邻色标几乎重合），大值 = 有过渡带。 */
  const hard = build({ soft: 0 })
  const soft = build({ soft: 60 })
  /* ⚠️ 取「相邻两条色带的交界处」两个色标：
   * soft=0 时它们完全重合（如 25.00% / 25.00% = 硬边）；
   * soft=60 时展开成过渡带（如 17.88% / 32.13%）。
   * 注意不能取第 1、2 个色标 —— 那是同一条色带的起止，永远差 25%。 */
  const gapOf = (sheet) => {
    const m = [...sheet.matchAll(/#[0-9A-F]{6} (\d+(?:\.\d+)?)%/g)].map((x) => Number(x[1]))
    /* 索引 1 与 2 = 第 1 条带的终点 / 第 2 条带的起点。 */
    return m.length >= 3 ? Math.abs(m[2] - m[1]) : null
  }
  check(gapOf(hard) !== null && gapOf(soft) !== null && gapOf(soft) > gapOf(hard),
    '边缘柔和越大 → 交界过渡带越宽', gapOf(hard) + '% vs ' + gapOf(soft) + '%')
  check(gapOf(hard) === 0, '边缘柔和 0 → 相邻色标完全重合（硬边）', String(gapOf(hard)))
}

console.log('')
console.log('Z. 背景地面：叠加模式与默认值')
{
  const build = (extra) => t.buildGround(dark, true, {
    mode: 'blend',
    lights: t.parseLightList('', t.GLOW_DEFAULTS, 6),
    bands: t.parseBandList(''),
    glowA: 38, spread: 100, dir: 165, soft: 2, base: '#343D46',
    ...extra,
  })
  const css = build({})
  check(/linear-gradient/.test(css) && /radial-gradient/.test(css),
    '叠加模式同时有 linear 和 radial')
  /* 分割层在前（在下），光晕层在后（在上）—— 与预览一致。 */
  check(css.indexOf('linear-gradient') < css.indexOf('radial-gradient'),
    '分割层在光晕层之前（DOM 顺序 = 层叠在下）')

  /* 出厂光源 / 色带表。 */
  check(Array.isArray(t.GLOW_DEFAULTS) && t.GLOW_DEFAULTS.length === 3, '出厂 3 个光源')
  check(Array.isArray(t.BAND_DEFAULTS) && t.BAND_DEFAULTS.length === 4, '出厂 4 条色带')
  check(t.MAX_LIGHTS === 6 && t.MAX_BANDS === 6, '光源/色带上限都是 6')

  /* parseLightList / parseBandList 的健壮性。 */
  check(t.parseLightList('', t.GLOW_DEFAULTS, 6).length === 3, '空串 → 出厂光源')
  check(t.parseLightList('{broken', t.GLOW_DEFAULTS, 6).length === 3, '坏 JSON → 出厂光源')
  check(t.parseLightList('[]', t.GLOW_DEFAULTS, 6).length === 3, '空数组 → 出厂光源')
  /* 非法颜色回落默认。 */
  const badColor = t.parseLightList('[{"color":"nope","strength":"50","x":"10","y":"20"}]', t.GLOW_DEFAULTS, 6)
  check(/^#[0-9a-fA-F]{6}$/.test(badColor[0].color), '非法颜色回落合法 hex', badColor[0].color)
  /* 超上限截断。 */
  const many = []
  for (let i = 0; i < 20; i++) many.push({ color: '#5FB3B3', strength: '50', x: '10', y: '10' })
  check(t.parseLightList(JSON.stringify(many), t.GLOW_DEFAULTS, 6).length === 6, '超过 6 个被截断')
  /* 数值钳制。 */
  const clamped = t.parseLightList('[{"color":"#5FB3B3","strength":"999","x":"-50","y":"500"}]', t.GLOW_DEFAULTS, 6)
  check(clamped[0].strength === '100', 'strength 超上限夹到 100', clamped[0].strength)
  check(clamped[0].x === '0', 'x 负值夹到 0', clamped[0].x)
  check(clamped[0].y === '100', 'y 超上限夹到 100', clamped[0].y)
}

console.log('')
console.log('AA. 渐变模式不压暗（2026-10-23 用户报「光晕比预览差好多」）')
{
  /* 背景层 veil 默认 auto 会盖 31% 实色，把光晕压掉三分之一。
   * 渐变模式（我们自己生成的底）不需要压暗 —— 那是给照片壁纸用的。 */
  check(/state\.glassBackground === 'gradient' && state\.glassVeil === 'auto'/.test(src),
    '渐变 + auto 档被识别为「不压暗」')
  check(/\? '0'/.test(src.slice(src.indexOf('const veilMode'), src.indexOf('const veilMode') + 300)),
    'auto 档在渐变模式下被替换成 "0"')

  /* glassVeilColor 本身的行为不能变（壁纸模式仍要压暗）。 */
  const auto = t.glassVeilColor(dark, true, 0.65, 'auto')
  const zero = t.glassVeilColor(dark, true, 0.65, '0')
  check(auto !== '' && /rgba/.test(auto), 'glassVeilColor auto 仍返回压暗色', auto)
  check(zero === '', 'glassVeilColor "0" 返回空串（不压暗）', JSON.stringify(zero))

  /* 手动固定档不受影响 —— 用户明确想要更暗时要尊重。 */
  for (const m of ['20', '35', '50']) {
    check(/rgba/.test(t.glassVeilColor(dark, true, 0.65, m)), '手动档 ' + m + ' 仍压暗')
  }
}

console.log('')
console.log('AB. 渐变模式不糊背景层（2026-10-23 用户报「还是差一档」）')
{
  /* 用户把表面浓度调到 0 后仍然觉得光晕弱。
   * 根因：背景层的 filter 是给照片壁纸设计的（blur 抹平高频细节），
   * 对低频的渐变光晕是纯损失：
   *   · blur(16px) 把 70%×60% 的光团边缘抹平、中心色稀释；
   *   · scale(1.08) 把整个渐变放大，半径更散。
   * 与 veil 一样：只改渐变模式。 */
  check(/const gradientMode = state && state\.glassBackground === 'gradient'/.test(src),
    '识别渐变模式')
  check(/\(contourActive \|\| gradientMode\) \? 0 : Math\.max\(0, Math\.min\(40, wallpaperBlur\)\)/.test(src),
    '渐变模式 blur = 0（不糊背景层）')
  check(/\(contourActive \|\| gradientMode\) \? 100 : wallpaperSat/.test(src),
    '渐变模式 saturate = 100（不改色相）')
  /* scale 必须跟随 blur：不糊就不该放大。 */
  check(/wallpaperEl\.style\.transform = blur > 0 \? 'scale\(1\.08\)' : 'none'/.test(src),
    'scale 跟随 blur（不糊就不放大）')

  /* 壁纸模式必须完全不受影响。 */
  const filterFn = src.slice(src.indexOf('function applyWallpaperFilter'),
    src.indexOf('function applyWallpaperFilter') + 1800)
  check(/contourActive \|\| gradientMode/.test(filterFn),
    '条件里只有 contour 和 gradient 两个例外')
  check(!/glassBackground === 'wallpaper'/.test(filterFn),
    '壁纸模式没有被加例外（照旧模糊）')
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')