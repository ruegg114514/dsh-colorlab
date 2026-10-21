#!/usr/bin/env node
/**
 * 表面不透明度 + 毛玻璃测试。
 *
 * 实现是**从 yaanlaan/deepseek-colorful 的 `lib/theme-engine.js` 移植**的（MIT）。
 * 本测试锁住原实现的三个必备机制 —— 前几版反复失败，都是缺了其中一环：
 *
 *   1. **必须自己铺一层背景**（fixed、z-index 0、prepend 到 body）。
 *      没有它，backdrop-filter 模糊的是同一块纯色，屏幕上毫无变化。
 *   2. **结构必须透明化**，否则背景层被挡住看不见。
 *   3. **背景层的颜色必须和表面色拉开明暗差**，
 *      否则透过半透明看到的还是自己（实测通道差 < 15 时肉眼无感）。
 *
 * 另外锁住两条「规则不许互相打架」的约束：
 *   - 三列不能同时出现在「透明化」和「上色」两个规则里
 *   - 三列不能既透明又带 alpha
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(condition, label, detail) {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ------------------------------------------------------------------ *
 * 载入 client.js
 * ------------------------------------------------------------------ */

function loadPlugin() {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: { load: (d) => { captured = d } },
    React: undefined,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
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

const mod = loadPlugin()
const t = mod.__test
const {
  buildGlassSheet, buildBackdropImage, hexToRgba, parseSurfaceOpacity, parseBounded,
  GLASS_TARGETS, TRANSPARENT_SELECTORS, DARK_SELECTOR, LIGHT_SELECTOR,
  GLASS_SHEET_ID, BACKDROP_ID,
} = t

const darkSurf = {
  base: '#343D46', sidebar: '#2E363F', layer1: '#3B444D', layer2: '#424B55',
  layer3: '#49525C', overlay: '#1E242A', bubble: '#3B444D',
}
const lightSurf = {
  base: '#FFFFFF', sidebar: '#F9FAFB', layer1: '#FFFFFF', layer2: '#F3F4F6',
  layer3: '#E9EBEF', overlay: '#E5E7EB', bubble: '#FFFFFF',
}

console.log('')
console.log('dsh-colorlab 表面不透明度 + 毛玻璃测试')
console.log('─'.repeat(56))

/* ------------------------------------------------------------------ *
 * A. hexToRgba
 * ------------------------------------------------------------------ */

console.log('  A. hexToRgba')

check(hexToRgba('#6699CC', 0.5) === 'rgba(102, 153, 204, 0.5)', '6 位 hex + alpha', hexToRgba('#6699CC', 0.5))
check(hexToRgba('#69C', 1) === 'rgba(102, 153, 204, 1)', '3 位简写展开')
check(hexToRgba('#000000', 0) === 'rgba(0, 0, 0, 0)', '纯黑 alpha 0')
check(hexToRgba('#FFFFFF', 1) === 'rgba(255, 255, 255, 1)', '纯白 alpha 1')
check(hexToRgba('#6699CC', 2) === 'rgba(102, 153, 204, 1)', 'alpha > 1 被 clamp')
check(hexToRgba('#6699CC', -1) === 'rgba(102, 153, 204, 0)', 'alpha < 0 被 clamp')
check(hexToRgba('nope', 0.5) === 'nope', '非法输入原样返回')
check(hexToRgba(null, 0.5) === null, 'null 原样返回')

/* ------------------------------------------------------------------ *
 * B. 数值解析
 * ------------------------------------------------------------------ */

console.log('  B. 数值解析')

check(parseSurfaceOpacity('60') === 60, "字符串 '60' → 60")
check(parseSurfaceOpacity('') === 100, '空串 → 100')
check(parseSurfaceOpacity(undefined) === 100, 'undefined → 100')
check(parseSurfaceOpacity('abc') === 100, '非法 → 100')
check(parseSurfaceOpacity('150') === 100, '超上界 clamp')
check(parseSurfaceOpacity('-20') === 0, '超下界 clamp')
check(parseBounded('16', 0, 40, 16) === 16, 'parseBounded 正常')
check(parseBounded('99', 0, 40, 16) === 40, 'parseBounded 上界')
check(parseBounded('x', 0, 40, 16) === 16, 'parseBounded 非法回落')

/* ------------------------------------------------------------------ *
 * C. 关闭状态不产生样式
 * ------------------------------------------------------------------ */

console.log('  C. 关闭状态')

check(buildGlassSheet({ surfaceOpacity: '100', glass: 'off' }, darkSurf, lightSurf, true) === '',
  '不透明度 100 + 毛玻璃关 → 空串')
check(buildGlassSheet({ surfaceOpacity: '100', glass: 'on', glassBlur: '0' }, darkSurf, lightSurf, true) === '',
  '毛玻璃开但半径 0 → 空串')
check(buildGlassSheet({}, darkSurf, lightSurf, true) === '', '空设置 → 空串')

/* ------------------------------------------------------------------ *
 * D. 【机制 1】背景层必须存在且是渐变
 * ------------------------------------------------------------------ */

console.log('  D. 背景层（机制 1：必须有东西可被模糊）')

{
  const img = buildBackdropImage(darkSurf, true)
  check(typeof img === 'string' && img.length > 0, '背景图非空')
  check(img.includes('radial-gradient'), '背景是渐变而非纯色（纯色模糊后还是纯色）')
  check(img.includes('rgba('), '渐变用 rgba 叠光斑')
  check(BACKDROP_ID === 'dmt-theme-bg-container', '背景层 id 与移植源一致', BACKDROP_ID)
  check(typeof t.syncBackdropLayer === 'function', 'syncBackdropLayer 已导出')
}

/* 【机制 3】背景色必须和表面色拉开明暗差 */
{
  const img = buildBackdropImage(darkSurf, true)
  const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(img)
  check(m !== null, '能从背景图解析出光斑色')
  if (m !== null) {
    const spot = [Number(m[1]), Number(m[2]), Number(m[3])]
    const base = [52, 61, 70]
    const diff = Math.abs(spot[0] - base[0]) + Math.abs(spot[1] - base[1]) + Math.abs(spot[2] - base[2])
    check(diff >= 40, '光斑色与底色通道差 ≥ 40（低于此值肉眼看不出半透明）', '通道差 ' + diff)
  }
}

/* ------------------------------------------------------------------ *
 * E. 【机制 2】结构透明化
 * ------------------------------------------------------------------ */

console.log('  E. 结构透明化（机制 2：让背景层露出来）')

{
  const css = buildGlassSheet({ surfaceOpacity: '60', glass: 'off' }, darkSurf, lightSurf, true)
  check(css.includes('html') && css.includes('body') && css.includes('#root'),
    'html/body/#root 被透明化')
  check(css.includes('transparent !important'), '有 transparent !important')
  check(css.includes('#root{position:relative'), '#root 抬到背景层之上')
  check(css.includes('z-index:1'), '#root z-index = 1')
  check(TRANSPARENT_SELECTORS.includes('html'), '透明化列表含 html')
  check(TRANSPARENT_SELECTORS.some((s) => s.includes('frame')),
    '透明化列表含 frame（它是铺满窗口的那层）')
}

/* ------------------------------------------------------------------ *
 * F. 半透明 + 冲突检查
 * ------------------------------------------------------------------ */

console.log('  F. 半透明与规则冲突')

{
  const css = buildGlassSheet({ surfaceOpacity: '60', glass: 'off' }, darkSurf, lightSurf, true)
  check(css.includes('--dsw-alias-bg-base:rgba(52, 61, 70, 0.6) !important'),
    '底色 token 带 0.6 alpha 且 !important')
  check(css.includes(DARK_SELECTOR), '深色选择器（属性写两遍提权）', DARK_SELECTOR)
  check(css.includes(LIGHT_SELECTOR), '浅色选择器', LIGHT_SELECTOR)

  /* 【关键回归】每条 token 声明都必须带 !important —— 宿主用 body 内联样式写 token，
     不带 !important 会被压掉，整段无效。 */
  const tokenLines = css.split('\n').filter((l) => l.includes('--dsw-'))
  const badDecl = tokenLines.find((l) => {
    const decls = l.match(/--dsw-[a-z0-9-]+:[^;}]+/g) || []
    return decls.some((d) => !d.includes('!important'))
  })
  check(tokenLines.length >= 1 && badDecl === undefined,
    '每条 token 声明都带 !important（否则被宿主内联样式压掉）',
    badDecl ? badDecl.slice(0, 50) : '')

  /* 三列各自带 alpha（它们不跟 token 走） */
  for (const [key, sel] of [['中列', 'centerCol'], ['左栏', 'sidebarCol'], ['右栏', 'rightbarCol']]) {
    const line = css.split('\n').find((l) => l.includes('"' + sel + '"'))
    check(line !== undefined && line.includes('rgba('), `${key}带 alpha`, line ? line.slice(0, 60) : '')
  }

  /* 【关键回归】同一批元素不许既被透明化又被上色 —— 两条规则打架会让 alpha 失效 */
  const transparentRule = css.split('\n').find((l) => l.startsWith('html,body,#root'))
  check(transparentRule !== undefined && !transparentRule.includes('centerCol'),
    '透明化规则里不含三列（避免与上色规则打架）')
  check(transparentRule !== undefined && !transparentRule.includes('sidebarCol'),
    '透明化规则里不含左栏')
}

/* 0% = 完全透明 */
{
  const zero = buildGlassSheet({ surfaceOpacity: '0', glass: 'off' }, darkSurf, lightSurf, true)
  check(zero.includes('rgba(52, 61, 70, 0)'), '0% → alpha 0')
}

/* ------------------------------------------------------------------ *
 * G. 毛玻璃
 * ------------------------------------------------------------------ */

console.log('  G. 毛玻璃')

{
  const css = buildGlassSheet({ surfaceOpacity: '100', glass: 'on', glassBlur: '20', glassSaturate: '150' }, darkSurf, lightSurf, true)
  check(css !== '', '毛玻璃产生样式')
  check(css.includes('backdrop-filter:blur(20px) saturate(150%)'), '模糊半径与饱和度正确')
  check(css.includes('-webkit-backdrop-filter'), '带 -webkit- 前缀')
  check(!css.includes('--dsw-alias-bg-base'), '只开毛玻璃时不改 token（表面保持不透明，模糊的是背景层）')

  for (const target of GLASS_TARGETS) {
    check(css.includes(target.sel.split(',')[0].trim()), `毛玻璃目标 ${target.key} 在样式表里`)
  }
}

/* 两者同开 */
{
  const both = buildGlassSheet({ surfaceOpacity: '70', glass: 'on', glassBlur: '12' }, darkSurf, lightSurf, true)
  check(both.includes('rgba(52, 61, 70, 0.7)'), '同时开：alpha 生效')
  check(both.includes('backdrop-filter:blur(12px)'), '同时开：模糊生效')
}

/* ------------------------------------------------------------------ *
 * H. 常量
 * ------------------------------------------------------------------ */

console.log('  H. 常量')

check(Array.isArray(GLASS_TARGETS) && GLASS_TARGETS.length >= 5, '毛玻璃目标 ≥ 5 组', String(GLASS_TARGETS.length))
check(Array.isArray(TRANSPARENT_SELECTORS) && TRANSPARENT_SELECTORS.length >= 5,
  '透明化选择器 ≥ 5 个', String(TRANSPARENT_SELECTORS.length))
check(GLASS_SHEET_ID === 'dsh-colorlab/glass.css', '样式表 id', GLASS_SHEET_ID)
check(DARK_SELECTOR.includes('[data-ds-dark-theme][data-ds-dark-theme]'),
  '深色选择器属性写两遍提权')

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
