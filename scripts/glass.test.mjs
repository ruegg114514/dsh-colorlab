#!/usr/bin/env node
/**
 * 表面不透明度 + 毛玻璃（覆盖层）测试。
 *
 * 这块的设计是**从既有实现里学的**（见 README 致谢），三个要点各自对应一组断言：
 *
 *   1. 颜色用 `rgba(r, g, b, a)` 而不是 `#rrggbbaa` —— 精度更高、不与 color-mix 打架
 *   2. 光靠令牌不够：中列透明、真正铺底的是列内元素 → 还要给布局列直接上色
 *   3. 开毛玻璃必须先把外层容器 `background: transparent`，否则模糊看不见
 *
 * 另外锁住两条容易退化的性质：
 *   - 两个功能都关时**不产生任何 CSS**（不能挂空样式表）
 *   - 生成的样式表里**不含 `#rrggbbaa`**（统一走 rgba）
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
 * 载入 client.js（与其它套件同一套方式）
 * ------------------------------------------------------------------ */

function loadPlugin(dom) {
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
    fakeWindow, dom ? dom.document : undefined, fakeRequire, () => ({ unref() {} }),
  )
  if (captured === null) throw new Error('client.js 没有注册 bundle')
  return captured.factory(fakeRequire)
}

const mod = loadPlugin(null)
const t = mod.__test
const {
  buildGlassSheet, hexToRgba, parseSurfaceOpacity, parseBounded,
  GLASS_TARGETS, LAYOUT_COLUMNS, GLASS_TRANSPARENT,
  DARK_SELECTOR, LIGHT_SELECTOR, GLASS_SHEET_ID,
} = t

console.log('')
console.log('dsh-colorlab 表面不透明度 + 毛玻璃测试')
console.log('─'.repeat(56))

/* ------------------------------------------------------------------ *
 * A. hexToRgba
 * ------------------------------------------------------------------ */

console.log('  A. hexToRgba')

check(hexToRgba('#6699CC', 0.5) === 'rgba(102, 153, 204, 0.5)', '6 位 hex + alpha', hexToRgba('#6699CC', 0.5))
check(hexToRgba('#69C', 1) === 'rgba(102, 153, 204, 1)', '3 位简写展开', hexToRgba('#69C', 1))
check(hexToRgba('#000000', 0) === 'rgba(0, 0, 0, 0)', '纯黑 + alpha 0')
check(hexToRgba('#FFFFFF', 1) === 'rgba(255, 255, 255, 1)', '纯白 + alpha 1')
check(hexToRgba('#6699CC', 2) === 'rgba(102, 153, 204, 1)', 'alpha > 1 被 clamp')
check(hexToRgba('#6699CC', -1) === 'rgba(102, 153, 204, 0)', 'alpha < 0 被 clamp')
check(hexToRgba('not-a-color', 0.5) === 'not-a-color', '非法输入原样返回')
check(hexToRgba(null, 0.5) === null, 'null 原样返回')
check(hexToRgba('#12345', 0.5) === '#12345', '5 位 hex 非法，原样返回')

/* ------------------------------------------------------------------ *
 * B. 数值解析
 * ------------------------------------------------------------------ */

console.log('  B. 数值解析')

check(parseSurfaceOpacity('60') === 60, "字符串 '60' → 60")
check(parseSurfaceOpacity(60) === 60, '数字 60 → 60')
check(parseSurfaceOpacity('') === 100, '空串 → 100（默认不透明）')
check(parseSurfaceOpacity(undefined) === 100, 'undefined → 100')
check(parseSurfaceOpacity('abc') === 100, '非法 → 100')
check(parseSurfaceOpacity('150') === 100, '超上界被 clamp 到 100')
check(parseSurfaceOpacity('-20') === 0, '超下界被 clamp 到 0')
check(parseSurfaceOpacity('59.6') === 60, '四舍五入')

check(parseBounded('16', 0, 40, 16) === 16, 'parseBounded 正常值')
check(parseBounded('99', 0, 40, 16) === 40, 'parseBounded 上界')
check(parseBounded('-5', 0, 40, 16) === 0, 'parseBounded 下界')
check(parseBounded('x', 0, 40, 16) === 16, 'parseBounded 非法回落')

/* ------------------------------------------------------------------ *
 * C. 都不开 → 不产生 CSS
 * ------------------------------------------------------------------ */

console.log('  C. 关闭状态不产生样式')

const darkSurf = { base: '#343D46', sidebar: '#2E363F', layer1: '#3B444D', layer2: '#424B55', layer3: '#49525C', overlay: '#1E242A', bubble: '#3B444D' }
const lightSurf = { base: '#FFFFFF', sidebar: '#F9FAFB', layer1: '#FFFFFF', layer2: '#F3F4F6', layer3: '#E9EBEF', overlay: '#E5E7EB', bubble: '#FFFFFF' }

check(buildGlassSheet({ surfaceOpacity: '100', glass: 'off' }, darkSurf, lightSurf) === '',
  '不透明度 100 + 毛玻璃关 → 空串（不挂空样式表）')
check(buildGlassSheet({ surfaceOpacity: '100', glass: 'on', glassBlur: '0' }, darkSurf, lightSurf) === '',
  '毛玻璃开但半径为 0 → 空串')
check(buildGlassSheet({}, darkSurf, lightSurf) === '', '空设置 → 空串')

/* ------------------------------------------------------------------ *
 * D. 不透明度生效
 * ------------------------------------------------------------------ */

console.log('  D. 表面不透明度')

const half = buildGlassSheet({ surfaceOpacity: '50', glass: 'off' }, darkSurf, lightSurf)
check(half !== '', '50% 产生样式')
check(half.includes(DARK_SELECTOR), '有深色模式规则', DARK_SELECTOR)
check(half.includes(LIGHT_SELECTOR), '有浅色模式规则', LIGHT_SELECTOR)
check(half.includes('--dsw-alias-bg-base:rgba(52, 61, 70, 0.5) !important'),
  '深色底色带 0.5 alpha，且带 !important',
  'rgba(52, 61, 70, 0.5) !important')
check(half.includes('--dsw-specific-sidebar-fill:rgba(46, 54, 63, 0.54) !important'),
  '侧栏 alpha 略高（1.08×）且带 !important')
check(half.includes('--dsw-alias-bg-layer-2:rgba(66, 75, 85, 0.59) !important'),
  'layer2 alpha 更高（1.18×）且带 !important')
check(!half.includes('#343D46'), '不再出现原始 6 位 hex（已换成 rgba）')
check(!/#[0-9a-fA-F]{8}\b/.test(half), '不含 8 位 hex（统一走 rgba）')

/* 布局列必须单独上色 */
check(half.includes('[class*="centerCol"]'), '给中列类名片段上色')
check(half.includes('[class*="sidebarCol"]'), '给左栏类名片段上色')
check(half.includes('[class*="rightbarCol"]'), '给右栏类名片段上色')
check((half.match(/!important/g) || []).length > 0, '布局列覆盖带 !important（压过宿主）')

/* 【关键回归】token 声明必须**全部**带 !important。
   宿主 ThemePresenter 用 body.style.setProperty(...) 写这些 token ——
   内联样式压过普通样式表规则，不加 !important 的话整段覆盖层完全无效。
   实测症状：不透明度拖到底毫无变化，只有 backdrop-filter 生效。 */
{
  const tokenDecls = half.split('\n')
    .filter((line) => line.includes('--dsw-'))
    .flatMap((line) => (line.match(/--dsw-[a-z0-9-]+:[^;!}]+/g) || []))
  check(tokenDecls.length >= 7, 'token 声明数量 ≥ 7', String(tokenDecls.length))
  const missing = half.split('\n')
    .filter((line) => line.includes('--dsw-'))
    .filter((line) => {
      /* 找出这条规则里没有跟 !important 的声明 */
      const decls = line.match(/--dsw-[a-z0-9-]+:[^;}]+/g) || []
      return decls.some((d) => !d.includes('!important'))
    })
  check(missing.length === 0, '每条 token 声明都带 !important（否则被宿主内联样式压掉）',
    missing.length === 0 ? '' : missing[0].slice(0, 60))
}

/* 0% = 完全透明 */
const zero = buildGlassSheet({ surfaceOpacity: '0', glass: 'off' }, darkSurf, lightSurf)
check(zero.includes('rgba(52, 61, 70, 0)'), '0% → alpha 0')
check(!zero.includes('rgba(52, 61, 70, 1)'), '0% 不出现完全不透明')

/* ------------------------------------------------------------------ *
 * E. 毛玻璃生效
 * ------------------------------------------------------------------ */

console.log('  E. 毛玻璃')

const glass = buildGlassSheet({ surfaceOpacity: '100', glass: 'on', glassBlur: '20', glassSaturate: '150' }, darkSurf, lightSurf)
check(glass !== '', '毛玻璃产生样式')
check(glass.includes('backdrop-filter:blur(20px) saturate(150%)'), '模糊半径与饱和度正确',
  'blur(20px) saturate(150%)')
check(glass.includes('-webkit-backdrop-filter'), '带 -webkit- 前缀（Safari/旧 Chromium）')

/* 【关键回归】**不许透明化外层容器**。
   这条曾经写成"必须透明化"，结果真机上上半屏直接变黑 ——
   因为我们背后没有自己的背景层（别人有全屏壁纸容器，透明掉才好看），
   透明化只会露出 Electron 窗口的黑底。 */
check(!glass.includes('html,body,#root'), '不透明化 html/body/#root（否则露黑底）')
check(!glass.includes('[class*="scrollBody"]'), '不透明化 scrollBody')
check(!glass.includes('[class*="composerSeat"]'), '不透明化 composerSeat')
check(!/background:transparent !important/.test(glass),
  '整张样式表里没有 background:transparent 规则')
check(glass.split('\n').every((line) => !/^html\b|^body\b|^#root/.test(line)),
  '没有任何以 html/body/#root 开头的规则')

/* 容器要加 backdrop-filter */
check(glass.includes('[class*="sidebarCol"]'), '侧栏加模糊')
check(glass.includes('[class*="kuvljq_card"]'), '卡片加模糊')
check(glass.includes('[class*="bubble"]'), '气泡加模糊')
/* 选择器必须收窄：宽选择器（aside/nav/泛 sidebar/message）会糊掉大量不该模糊的元素。 */
check(!/\baside\b/.test(glass) && !/\bnav\b/.test(glass), '不含 aside / nav 这类宽选择器')
check(!glass.includes('[class*="message"]'), '不含 [class*="message"]（会命中消息内每一行）')
check(!glass.includes('[class*="sidebar"]') || glass.includes('[class*="sidebarCol"]'),
  '侧栏只命中 sidebarCol，不用泛 sidebar 片段')

/* 全部目标都出现 */
for (const target of GLASS_TARGETS) {
  check(glass.includes(target.sel.split(',')[0].trim()),
    `毛玻璃目标 ${target.key} 出现在样式表里`)
}

/* 不透明度与毛玻璃同时开：两者都要在 */
const both = buildGlassSheet({ surfaceOpacity: '70', glass: 'on', glassBlur: '12' }, darkSurf, lightSurf)
check(both.includes('rgba(52, 61, 70, 0.7)'), '同时开：alpha 生效')
check(both.includes('backdrop-filter:blur(12px)'), '同时开：模糊生效')
/* 输入框**不许**被设成透明：真机上那样做会让输入框丢底色、和周围糊在一起。 */
check(!both.includes('--dsw-specific-input-major:transparent'),
  '不把输入框设成 transparent（否则它没底色）')

/* ------------------------------------------------------------------ *
 * F. 常量合理性
 * ------------------------------------------------------------------ */

console.log('  F. 常量')

check(Array.isArray(GLASS_TARGETS) && GLASS_TARGETS.length >= 5, '毛玻璃目标 ≥ 5 组', String(GLASS_TARGETS.length))
check(Array.isArray(LAYOUT_COLUMNS) && LAYOUT_COLUMNS.length === 3, '布局列 3 个（左/中/右）')
check(LAYOUT_COLUMNS.every((c) => c.sel.includes('[class*=')), '布局列全部用类名片段选择器')
check(Array.isArray(GLASS_TRANSPARENT) && GLASS_TRANSPARENT.length === 0,
  '透明化容器列表为空（我们背后没有背景层）', String(GLASS_TRANSPARENT.length))
check(GLASS_SHEET_ID === 'dsh-colorlab/glass.css', '样式表 id', GLASS_SHEET_ID)
check(DARK_SELECTOR.includes('[data-ds-dark-theme][data-ds-dark-theme]'),
  '深色选择器把属性写两遍提权（不靠 !important）', DARK_SELECTOR)
check(LIGHT_SELECTOR.includes(':not('), '浅色选择器用 :not()', LIGHT_SELECTOR)

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
