#!/usr/bin/env node
/**
 * 玻璃界面测试（壁纸层 + 单层 alpha）。
 *
 * 这个功能在本插件里**失败过一次并被整个回退**，失败原因记在这里，
 * 每一条都对应下面一组断言：
 *
 *   1. **没有背景图**。`backdrop-filter` 只能模糊「同一张画布内、位于它背后的像素」；
 *      窗口背后的桌面不在 Chromium 画布里，所以玻璃背后是空的 —— 调什么参数都没反应。
 *      必须有 Host 提供的壁纸路由 + 页面内的背景层。
 *   2. **alpha 层层叠加**。宿主背景是嵌套的（frame → 三列），每层都加 alpha 会合成到
 *      接近不透明（0.6 叠两层 = 0.84、三层 0.944），屏幕上等于没做。
 *      必须「容器层全透明 + 只在三列各铺一次」。
 *   3. **选择器写错**。`html[data-dsh-glass] html` 永远匹配不到 —— html 不可能是
 *      html 的后代，属性所在的元素本身不能加后代前缀。
 *   4. **关掉不干净**。所有规则必须挂在同一个总闸属性下，摘掉即完全恢复原样。
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

const dark = { base: '#343D46', sidebar: '#2E363F', layer1: '#3B444D', layer2: '#424B55', layer3: '#49525C', overlay: '#1E242A', bubble: '#3B444D' }

console.log('')
console.log('dsh-colorlab 玻璃界面测试')
console.log('─'.repeat(56))

/* ------------------------------------------------------------------ *
 * A. 基础工具
 * ------------------------------------------------------------------ */

console.log('  A. 工具函数')

check(hexToRgba('#343D46', 0.1) === 'rgba(52, 61, 70, 0.1)', 'hexToRgba 正确', hexToRgba('#343D46', 0.1))
check(hexToRgba('#69C', 1) === 'rgba(102, 153, 204, 1)', '3 位简写展开')
check(hexToRgba('nope', 0.5) === 'nope', '非法输入原样返回')
check(parsePercent('10', 0, 30, 10) === 10, 'parsePercent 正常')
check(parsePercent('99', 0, 30, 10) === 30, 'parsePercent 上界 clamp')
check(parsePercent('x', 0, 30, 10) === 10, 'parsePercent 非法回落')
check(parsePercent('', 0, 30, 10) === 10, 'parsePercent 空串回落')

/* ------------------------------------------------------------------ *
 * B. 关掉时不产生样式
 * ------------------------------------------------------------------ */

console.log('  B. 关闭状态')

check(buildGlassSheet({ glass: 'off' }, dark, true) === '', 'glass=off → 空串（不挂样式表）')
check(buildGlassSheet({}, dark, true) === '', '未设置 glass → 空串')
check(GLASS_ATTR === 'data-dsh-glass', '总闸属性名', GLASS_ATTR)

/* ------------------------------------------------------------------ *
 * C. 【失败原因 3】选择器必须合法
 * ------------------------------------------------------------------ */

console.log('  C. 选择器合法性（失败原因 3）')

{
  const css = buildGlassSheet({ glass: 'on', glassTint: '10', glassBlur: '16' }, dark, true)
  check(!/html\[data-dsh-glass\]\s+html/.test(css), '不存在 `html[attr] html`（永远匹配不到）')
  check(css.includes('html[data-dsh-glass],'), 'html 自身用单选择器命中')
  check(css.includes('html[data-dsh-glass] body'), 'body 用后代选择器')
  check(css.includes('html[data-dsh-glass] #root'), '#root 用后代选择器')
}

/* ------------------------------------------------------------------ *
 * D. 【失败原因 2】单层 alpha，不叠加
 * ------------------------------------------------------------------ */

console.log('  D. 分层策略（失败原因 2）')

{
  const css = buildGlassSheet({ glass: 'on', glassTint: '10', glassBlur: '16' }, dark, true)
  const lines = css.split('\n')

  /* 容器层必须清成透明 —— 给它们任何底色都会和上面的 alpha 叠加。 */
  const transparentRule = lines.find((l) => l.startsWith('html[data-dsh-glass],'))
  check(transparentRule !== undefined && transparentRule.includes('transparent'),
    'html/body/#root 一起清成透明')
  check(transparentRule !== undefined && transparentRule.includes('body')
    && transparentRule.includes('#root'), '透明规则同时覆盖 body 与 #root')
  check(css.includes('[class*="_frame"]:has('), '窗口框架清成透明（用 :has 精确定位）')

  /* 三列是**唯一**铺色（带 rgba）的地方。注意 `:has()` 那条也含 _sidebarCol，
     所以按「带 rgba」来筛，才是真正铺色的规则。 */
  const colPaintLines = lines.filter((l) => /rgba\(/.test(l) && /_sidebarCol|_centerCol|_rightbarCol/.test(l))
  check(colPaintLines.length === 2, '三列只有 2 条铺色规则（sidebar / center+rightbar）', String(colPaintLines.length))
  check(colPaintLines.some((l) => l.includes('_sidebarCol')), '侧栏有铺色规则')
  check(colPaintLines.some((l) => l.includes('_centerCol') && l.includes('_rightbarCol')),
    '中列与右栏共用一条铺色规则')
  check(colPaintLines.every((l) => l.includes('0.1')), 'alpha = 浓度设置值 10%')

  /* 关键：容器层不许出现 rgba —— 一旦有，就说明又在叠。 */
  check(transparentRule !== undefined && !transparentRule.includes('rgba('),
    '容器层规则里没有 rgba（不叠加）')
  const frameLine = lines.find((l) => l.includes(':has(') && l.includes('transparent'))
  check(frameLine !== undefined && !frameLine.includes('rgba('), 'frame 规则里没有 rgba（不叠加）')
}

/* 浓度可调且被 clamp */
{
  const low = buildGlassSheet({ glass: 'on', glassTint: '0' }, dark, true)
  check(low.includes('rgba(46, 54, 63, 0)'), '浓度 0 → alpha 0')
  const high = buildGlassSheet({ glass: 'on', glassTint: '99' }, dark, true)
  check(high.includes('rgba(46, 54, 63, 0.3)'), '浓度超界 clamp 到 30%')
}

/* 模糊：0 时不挂 backdrop-filter */
{
  const noBlur = buildGlassSheet({ glass: 'on', glassBlur: '0' }, dark, true)
  check(noBlur.includes('backdrop-filter:none'), '半径 0 → backdrop-filter:none')
  const withBlur = buildGlassSheet({ glass: 'on', glassBlur: '24' }, dark, true)
  check(withBlur.includes('backdrop-filter:blur(24px)'), '半径 24 → blur(24px)')
  check(withBlur.includes('-webkit-backdrop-filter:blur(24px)'), '带 -webkit- 前缀')
}

/* ------------------------------------------------------------------ *
 * E. 【失败原因 1】背景层与壁纸路由
 * ------------------------------------------------------------------ */

console.log('  E. 背景层与壁纸（失败原因 1）')

{
  check(typeof t.WALLPAPER_ROUTE === 'string' && t.WALLPAPER_ROUTE.startsWith('/'),
    '壁纸路由是绝对路径', t.WALLPAPER_ROUTE)
  check(t.WALLPAPER_LAYER_ID === 'dmt-wallpaper', '背景层元素 id', t.WALLPAPER_LAYER_ID)

  const gradient = buildGradientBackdrop(dark, true)
  check(gradient.includes('radial-gradient'), '渐变兜底是渐变而非纯色')
  check(gradient.includes('rgba('), '渐变用 rgba 叠光斑')
  check(gradient.includes('#343D46'), '渐变的底仍是当前配色的 base')
}

/* Host 半体必须真的注册了壁纸路由 */
{
  const host = readFileSync(join(root, 'index.js'), 'utf8')
  check(/ctx\.inject\(\['webServer'\]/.test(host), 'Host 半体注入 webServer 服务')
  check(host.includes('/dsh-colorlab/wallpaper'), 'Host 注册壁纸路由')
  check(host.includes('TranscodedWallpaper'), '读 Windows 当前壁纸缓存')
  check(host.includes('detectImageMime'), '按魔数嗅探图片类型')
  check(host.includes('wallpaperCache'), '带 mtime 缓存（不每次重读 1MB）')
  check(host.includes('registerWallpaperRoute(ctx)'), 'apply() 里真的调用了注册')
}

/* ------------------------------------------------------------------ *
 * F. 【失败原因 4】关掉要干净
 * ------------------------------------------------------------------ */

console.log('  F. 关闭时的清理（失败原因 4）')

{
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  check(/removeAttribute\(GLASS_ATTR\)/.test(source), 'teardown 摘掉总闸属性')
  check(/syncWallpaperLayer\(false\)/.test(source), 'teardown 移除背景层')
  check(/revokeObjectURL/.test(source), 'teardown 释放 objectURL')
  /* 所有规则都必须带总闸前缀，否则关掉后还会残留 */
  const css = buildGlassSheet({ glass: 'on', glassTint: '10', glassBlur: '16' }, dark, true)
  const ruleLines = css.split('\n').filter((l) => l.includes('{') && !l.startsWith('/*'))
  check(ruleLines.every((l) => l.includes('[' + GLASS_ATTR + ']')),
    '每条 CSS 规则都带总闸前缀', String(ruleLines.length) + ' 条')
}

/* ------------------------------------------------------------------ *
 * G. 设置项
 * ------------------------------------------------------------------ */

console.log('  G. 设置项')

{
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const defaults = t.DEFAULTS
  check(defaults !== undefined, 'DEFAULTS 已导出')
  if (defaults) {
    check(defaults.glass === 'on', 'glass 默认开', String(defaults.glass))
    check(defaults.glassBackground === 'wallpaper', '背景来源默认桌面壁纸', String(defaults.glassBackground))
    check(defaults.glassTint === '10', '表面浓度默认 10', String(defaults.glassTint))
    check(defaults.glassFog === '16', '浮层浓度默认 16', String(defaults.glassFog))
    check(defaults.glassBlur === '16', '模糊半径默认 16', String(defaults.glassBlur))
  }
  check(source.includes("'透明与壁纸'"), '设置页有分组标题')
  check(source.includes("title: '玻璃界面'"), '有「玻璃界面」开关')
  check(source.includes("title: '背景来源'"), '有「背景来源」选择')
  check(source.includes("title: '表面浓度'"), '有「表面浓度」滑块')
  check(source.includes("title: '浮层浓度'"), '有「浮层浓度」滑块')
  check(source.includes("title: '模糊半径'"), '有「模糊半径」滑块')
  check(source.includes("title: '壁纸状态'"), '有「壁纸状态」只读行')
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
