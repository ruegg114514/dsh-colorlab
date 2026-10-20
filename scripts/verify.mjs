#!/usr/bin/env node
/**
 * dsh-colorlab 静态校验。
 *
 * 直接加载 `client.js`（用假的 `window.__ModuleLoader__` 接住 bundle 注册），
 * 取出 `__test.resolveTokens` 这个纯函数，然后检查：
 *
 *   1. 令牌名合法性 —— 每个被覆盖的变量必须真实存在于宿主设计系统里，
 *      拼错或宿主改名会在这里失败，而不是等到界面上某个角落颜色不对才发现。
 *   2. 值合法性 —— 每个值必须是 CSS 能接受的颜色/颜色表达式。
 *   3. 双值齐备 —— 每个令牌必须有 `{ light, dark }` 两个值（宿主对此有运行时校验，
 *      单值会在用户切换色系时变成不可读）。
 *   4. 对比度 —— 正文/次级/三级文字与状态色在背景上必须达标。
 *   5. 覆盖完整性 —— 报告 101 个 alias 令牌里覆盖了多少、哪些没覆盖。
 *
 * 用法：node scripts/verify.mjs [--verbose]
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const verbose = process.argv.includes('--verbose')

/* ------------------------------------------------------------------ *
 * 宿主设计系统的令牌清单（从安装态 app.asar 的
 * @deepseek-ai/dsh-client-ui-theme/lib/client.js 里 design-platform.css 抽出的快照）
 * ------------------------------------------------------------------ */

/** design-platform.css 在 body / body[data-ds-dark-theme] 上声明的 --dsw-alias-* 令牌，共 101 个。 */
const ALIAS_TOKENS = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-document-preview', '--dsw-alias-bg-document-selection',
  '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1', '--dsw-alias-bg-mask-2', '--dsw-alias-bg-mask-3',
  '--dsw-alias-bg-mask-drop', '--dsw-alias-bg-mask-photo', '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-multi-select', '--dsw-alias-bg-overlay', '--dsw-alias-bg-skeleton',
  '--dsw-alias-border-inverted', '--dsw-alias-border-inverted2', '--dsw-alias-border-l1',
  '--dsw-alias-border-l2', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-border-l3',
  '--dsw-alias-border-l4', '--dsw-alias-brand-primary', '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-primary-new-colorprimary-new-color', '--dsw-alias-brand-text',
  '--dsw-alias-button-contrast-fill', '--dsw-alias-button-elevated-fill',
  '--dsw-alias-button-floating-fill', '--dsw-alias-button-floating-hover',
  '--dsw-alias-button-ghost-active-border', '--dsw-alias-button-ghost-active-fill',
  '--dsw-alias-button-ghost-active-hover', '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-hover', '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-tool-bar-fill', '--dsw-alias-button-tool-bar-fill-invisible',
  '--dsw-alias-button-tool-bar-hover', '--dsw-alias-code-diff-added',
  '--dsw-alias-code-diff-deleted', '--dsw-alias-file-diff-added-bg',
  '--dsw-alias-file-diff-added-gutter', '--dsw-alias-file-diff-added-marker',
  '--dsw-alias-file-diff-deleted-bg', '--dsw-alias-file-diff-deleted-gutter',
  '--dsw-alias-file-diff-deleted-marker', '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-interactive-bg-hover-danger', '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-label-caption', '--dsw-alias-label-deep-diving',
  '--dsw-alias-label-deep-diving-shimmer', '--dsw-alias-label-dimmed',
  '--dsw-alias-label-document-preview', '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-bluish', '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-secondary', '--dsw-alias-label-shimmer', '--dsw-alias-label-tertiary',
  '--dsw-alias-link', '--dsw-alias-markdown-citation', '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected', '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-placeholder', '--dsw-alias-markdown-tag',
  '--dsw-alias-menu-group-header-fill', '--dsw-alias-menu-icon',
  '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l1', '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-error-secondary',
  '--dsw-alias-state-idle-primary', '--dsw-alias-state-success-primary',
  '--dsw-alias-state-success-secondary', '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-label', '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-secondary', '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-switch-thumb', '--dsw-alias-toast-bg', '--dsw-alias-toast-label',
  '--dsw-alias-tooltip-bg', '--dsw-alias-tooltip-key-bg', '--dsw-alias-turn-trigger-bg',
  '--dsw-alias-turn-trigger-bg-hover',
]

/** design-platform.css 在 body 上声明的 --dsw-specific-* 与 --dsw-menu-surface-fill。 */
const SPECIFIC_TOKENS = [
  '--dsw-specific-bubble', '--dsw-specific-bubble-highlight', '--dsw-specific-input-major',
  '--dsw-specific-login-input', '--dsw-specific-menu', '--dsw-specific-selector',
  '--dsw-specific-sidebar-fill', '--dsw-specific-sidebar-nav-item-active',
  '--dsw-specific-sidebar-nav-item-active-accent', '--dsw-specific-sidebar-nav-item-hover',
  '--dsw-specific-tip', '--dsw-menu-surface-fill',
]

/** 前端 CSS 直接引用的静态色阶（不在 alias 层，需要单独覆盖）。 */
const STATIC_TOKENS = [
  '--dsw-static-deepseek-500', '--dsw-static-deepseek-450', '--dsw-static-deepseek-400',
  '--dsw-static-green-500', '--dsw-static-amber-400', '--dsw-static-amber-500',
  '--dsw-static-red-600', '--dsw-static-neutral-bluish-00', '--dsw-static-neutral-bluish-300',
]

/** Shiki css-variables 主题的变量前缀（宿主 ui-theme 的 shiki.css 声明）。 */
const SHIKI_TOKENS = [
  '--shiki-foreground', '--shiki-background', '--shiki-token-constant', '--shiki-token-string',
  '--shiki-token-comment', '--shiki-token-keyword', '--shiki-token-parameter',
  '--shiki-token-function', '--shiki-token-string-expression', '--shiki-token-punctuation',
  '--shiki-token-link',
]

/**
 * 插件自己补的别名：宿主终端状态栏 CSS 写的是 `var(--dsw-alias-bg-l2)`，
 * 但真名是 `--dsw-alias-bg-layer-2`（宿主笔误）。补一个同名变量把那条规则救回来。
 */
const PATCH_TOKENS = ['--dsw-alias-bg-l2']

/**
 * Shiki 主题里引用、但宿主 shiki.css **没有声明**的三个变量。
 * 它们用于 ```diff 代码块；不补的话新增/删除行会落到 var() 未定义的继承色。
 * 单独列出而不是塞进 SHIKI_TOKENS，因为它们是"补宿主缺口"，不是宿主已有令牌。
 */
const SHIKI_DIFF_TOKENS = ['--shiki-token-inserted', '--shiki-token-deleted', '--shiki-token-changed']

/**
 * 正文高亮用的辅助令牌。它们不属于宿主设计系统，是插件自己的命名空间
 * （前缀 `--dmt-prose-`），只被插件注入的正文样式表的 var() 消费。
 */
const PROSE_TOKENS = [
  '--dmt-prose-heading', '--dmt-prose-strong', '--dmt-prose-em', '--dmt-prose-code',
  '--dmt-prose-marker', '--dmt-prose-quote', '--dmt-prose-quote-border',
  '--dmt-prose-link', '--dmt-prose-del',
]

/**
 * 过程行高亮色令牌。同 `--dmt-prose-*`，是插件自己的命名空间，
 * 只被插件注入的过程行样式表的 var() 消费。
 * 两个：工具行（绿）与汇总行 / 本轮汇总（黄）。
 */
const ROW_TOKENS = ['--dmt-row-color', '--dmt-summary-color']

/**
 * Markdown 细节令牌。同 `--dmt-prose-*`，是插件自己的命名空间，
 * 只被插件注入的 Markdown 样式表的 var() 消费。
 * 三个：列表符号（绿）、引用正文（橙）、行内代码背景。
 */
const MARKDOWN_TOKENS = ['--dmt-md-list-marker', '--dmt-md-quote', '--dmt-md-code-bg']

const KNOWN = new Set([
  ...ALIAS_TOKENS,
  ...SPECIFIC_TOKENS,
  ...STATIC_TOKENS,
  ...SHIKI_TOKENS,
  ...SHIKI_DIFF_TOKENS,
  ...PROSE_TOKENS,
  ...ROW_TOKENS,
  ...MARKDOWN_TOKENS,
  ...PATCH_TOKENS,
])

/* ------------------------------------------------------------------ *
 * 载入 client.js 并取出纯函数
 * ------------------------------------------------------------------ */

/** 用假的 ModuleLoader 接住 bundle，返回工厂产出的 exports。 */
function loadPlugin() {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) {
        captured = definition
      },
    },
    React: undefined,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  /* 客户端半体只用到 window 与 require('react')；这里用一个最小 require 顶替。 */
  const fakeRequire = (id) => {
    if (id === 'react') return { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: () => ({}) }
    throw new Error('unexpected require: ' + id)
  }
  const run = new Function('window', 'document', 'require', 'setTimeout', source)
  run(fakeWindow, undefined, fakeRequire, () => ({ unref() {} }))
  if (captured === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')
  const exports = captured.factory(fakeRequire)
  return { id: captured.id, exports }
}

/* ------------------------------------------------------------------ *
 * 颜色工具
 * ------------------------------------------------------------------ */

/** 把 #rgb / #rrggbb / #rrggbbaa 解析成 [r,g,b,a]。 */
function parseHex(value) {
  const hex = value.replace('#', '')
  if (hex.length === 3) {
    return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16)).concat([1])
  }
  if (hex.length === 6 || hex.length === 8) {
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat([hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1])
  }
  return null
}

/** WCAG 相对亮度。 */
function luminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 对比度。 */
function contrast(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 判断一个值是否是 CSS 能接受的颜色表达式。
 * 支持：hex、rgb()/rgba()、hsl()/hsla()、color-mix(...)、var(...)、transparent、具名色。
 */
function isColorValue(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  const v = value.trim()
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true
  if (/^(?:rgb|rgba|hsl|hsla)\(/i.test(v)) return true
  if (/^color-mix\(/i.test(v)) return true
  if (/^var\(--[a-z0-9-]+\)$/i.test(v)) return true
  if (v === 'transparent') return true
  if (/^[a-z]+$/i.test(v)) return true
  return false
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

const failures = []
const warnings = []
const fail = (message) => failures.push(message)
const warn = (message) => warnings.push(message)

const { id, exports } = loadPlugin()
if (id !== 'dsh-colorlab') fail(`bundle id 应为 dsh-colorlab，实际是 ${id}`)
if (exports === undefined || exports === null) fail('factory 没有返回 exports')
if (typeof exports.apply !== 'function') fail('exports.apply 缺失')
if (!Array.isArray(exports.inject)) fail('exports.inject 应为数组')
const test = exports.__test
if (test === undefined) fail('exports.__test 缺失（scripts/verify.mjs 依赖它）')

if (failures.length === 0) {
  const { resolveTokens, DEFAULTS, SURFACES, ACCENTS, PALETTE } = test

  /* ---- 1/2/3：逐变体逐令牌检查 ---- */
  let checkedTokens = 0
  const seenNames = new Set()
  for (const surface of Object.keys(SURFACES)) {
    for (const accent of Object.keys(ACCENTS)) {
      for (const syntax of ['on', 'off']) {
        const label = `surface=${surface} accent=${accent} syntax=${syntax}`
        const tokens = resolveTokens({ ...DEFAULTS, surface, accent, syntax })
        const names = Object.keys(tokens)
        if (names.length === 0) fail(`${label}: resolveTokens 返回空对象`)
        for (const name of names) {
          checkedTokens += 1
          seenNames.add(name)
          if (!name.startsWith('--')) fail(`${label}: 令牌名 ${name} 不是 CSS 变量`)
          if (!KNOWN.has(name)) fail(`${label}: 令牌 ${name} 不在宿主设计系统里（拼写错误或宿主已改名）`)
          const pair = tokens[name]
          if (pair === null || typeof pair !== 'object') {
            fail(`${label}: 令牌 ${name} 必须是 { light, dark } 对象`)
            continue
          }
          if (typeof pair.light !== 'string' || typeof pair.dark !== 'string') {
            fail(`${label}: 令牌 ${name} 的 light/dark 必须都是字符串`)
            continue
          }
          if (!isColorValue(pair.light)) fail(`${label}: 令牌 ${name} 的 light 值不是合法颜色：${pair.light}`)
          if (!isColorValue(pair.dark)) fail(`${label}: 令牌 ${name} 的 dark 值不是合法颜色：${pair.dark}`)
        }
      }
    }
  }

  /* syntax=off 时不应出现 --shiki-* */
  const noSyntax = resolveTokens({ ...DEFAULTS, syntax: 'off' })
  for (const name of Object.keys(noSyntax)) {
    if (name.startsWith('--shiki-')) fail(`syntax=off 时不应覆盖 ${name}`)
  }
  const withSyntax = resolveTokens({ ...DEFAULTS, syntax: 'on' })
  for (const name of [...SHIKI_TOKENS, ...SHIKI_DIFF_TOKENS]) {
    if (!(name in withSyntax)) fail(`syntax=on 时缺少 Shiki 令牌 ${name}`)
  }

  /* ---- 3b：正文高亮令牌与样式表 ---- */
  const { buildProseSheet, resolveProseTokens, PROSE_SHEET_ID } = test
  const expect = (ok, message) => {
    if (!ok) fail(message)
    else if (verbose) console.log('  ✓ ' + message)
  }

  expect(typeof buildProseSheet === 'function', 'buildProseSheet 已导出')
  expect(typeof PROSE_SHEET_ID === 'string' && PROSE_SHEET_ID.length > 0, 'PROSE_SHEET_ID 已声明')

  const proseTokens = resolveProseTokens(DEFAULTS)
  for (const name of PROSE_TOKENS) {
    expect(name in proseTokens, `正文高亮令牌存在：${name}`)
    /* 正文令牌必须与 prose 开关解耦：syntax=off 时仍要在（两者互不影响）。 */
    expect(name in noSyntax, `syntax=off 时正文令牌不消失：${name}`)
  }

  const proseSheet = typeof buildProseSheet === 'function' ? buildProseSheet() : ''
  expect(typeof proseSheet === 'string' && proseSheet.length > 0, '正文样式表非空')
  /* 关键：容器选择器必须用跨构建稳定的前缀匹配，不能写死 CSS Modules 哈希。 */
  expect(
    proseSheet.includes('[class*="_markdown_"]'),
    '正文样式表用 [class*="_markdown_"] 前缀匹配（跨构建稳定）',
  )
  expect(
    proseSheet.includes(':not([data-markdown-variant="compact"])'),
    '正文样式表排除 compact 变体（宿主在那里要求继承色）',
  )
  expect(
    !/_markdown_[a-z0-9]{5}_\d+/.test(proseSheet),
    '正文样式表没有写死 CSS Modules 哈希类名',
  )
  /* 每条带 var() 的颜色规则都要有兜底，保证令牌没写进去时也不会掉色。 */
  const proseColorRules = proseSheet.split('\n').filter((line) => line.includes('color'))
  const withoutFallback = proseColorRules.filter((line) => {
    const usesVar = line.includes('var(')
    const hasFallback = /var\(--[\w-]+,\s*[^)]+\)/.test(line)
    return usesVar && !hasFallback
  })
  expect(withoutFallback.length === 0, '正文样式表每条 var() 都有 Mariana 兜底色')
  if (withoutFallback.length > 0) fail('缺兜底的规则：' + withoutFallback[0])

  /* 正文里每个被着色元素都必须出现在样式表里（覆盖完整性）。 */
  for (const tag of ['h1,h2,h3,h4,h5,h6', 'strong', 'em', 'code', 'li::marker', 'blockquote', 'a', 'th', 'del']) {
    expect(proseSheet.includes(tag), `正文样式表覆盖 ${tag}`)
  }

  /* ---- 3c：过程行高亮样式表 ---- */
  const { buildRowSheet, parseRowVariants, ROW_VARIANTS, ROW_SHEET_ID } = test
  expect(typeof buildRowSheet === 'function', 'buildRowSheet 已导出')
  expect(typeof ROW_SHEET_ID === 'string' && ROW_SHEET_ID.length > 0, 'ROW_SHEET_ID 已声明')
  expect(Array.isArray(ROW_VARIANTS) && ROW_VARIANTS.length > 0, 'ROW_VARIANTS 已导出')

  const rowSheet = buildRowSheet({ ...DEFAULTS })
  expect(rowSheet.length > 0, '默认设置下过程行样式表非空')
  /* 三条核心规则：只命中图标与标题，且锚定在 header 内（不渗进展开内容）。 */
  expect(rowSheet.includes('[data-variant="write"]'), '默认高亮 write（写入）')
  expect(rowSheet.includes('[data-variant="edit"]'), '默认高亮 edit（编辑）')
  expect(rowSheet.includes('[data-variant="bash"]'), '默认高亮 bash（运行命令）')
  expect(rowSheet.includes('[data-disclosure-header]'), '规则锚定 data-disclosure-header（排除展开内容）')
  expect(rowSheet.includes('[class*="_leading"]'), '命中图标容器 _leading')
  expect(rowSheet.includes('[class*="_title"]'), '命中标题 _title')
  /* 绝不能命中摘要/统计（那是"剩下的不变"的保证）。 */
  expect(!rowSheet.includes('_summary'), '规则不含 _summary（摘要不变色）')
  expect(!rowSheet.includes('_diffStat') && !rowSheet.includes('_diff'), '规则不含 diff 统计类')
  /* 不写死 CSS Modules 前缀 hash。 */
  expect(!/[a-zA-Z0-9]{6}_(leading|title)/.test(rowSheet), '过程行样式表没有写死 hash 类名')
  /* var() 必须有兜底色。 */
  expect(/var\(--dmt-row-color,\s*#[0-9a-f]{6}\)/i.test(rowSheet), '过程行颜色有 var() 兜底')

  /* 非法/未知 variant 值必须被白名单挡掉（防选择器注入）。 */
  const injection = parseRowVariants('["write","][{color:red}"]')
  expect(injection.length === 1 && injection[0] === 'write', '选择器注入被白名单挡掉', JSON.stringify(injection))
  expect(parseRowVariants('["nope"]').length === 0, '未知 variant 被忽略')
  expect(parseRowVariants('坏json').length === 0, '坏 JSON → 空列表')
  expect(buildRowSheet({ ...DEFAULTS, rowVariants: '[]' }) === '', '空选择 → 空样式表（不挂空节点）')
  expect(buildRowSheet(undefined) === '', 'state 缺省 → 空样式表，不抛')

  /* 自定义 rowColor 生效 + 非法值回落。 */
  const customRow = buildRowSheet({ ...DEFAULTS, rowColor: '#FF0000' })
  expect(customRow.includes('#FF0000'), '自定义 rowColor 进入样式表')
  const badRow = buildRowSheet({ ...DEFAULTS, rowColor: 'notacolor' })
  expect(badRow.includes(DEFAULTS.rowColor), '非法 rowColor 回落默认', DEFAULTS.rowColor)
  const rowToken = resolveTokens({ ...DEFAULTS, rowColor: '#123456' })['--dmt-row-color']
  expect(rowToken.dark === '#123456' && rowToken.light === '#123456', 'rowColor 令牌 light/dark 同值（用户挑色不随外观变）')

  /* ---- 汇总行 / 本轮汇总（黄）---- */
  expect(rowSheet.includes('button[data-process-activity]'), '默认样式表含汇总行规则')
  expect(rowSheet.includes('button[data-turn-process]'), '默认样式表含本轮汇总规则')
  /* :hover 必须一起写：宿主对这两类都有更高特异性的 hover 提亮规则，
     不覆盖的话鼠标一移上去就掉回宿主原色。 */
  expect(
    rowSheet.includes('button[data-process-activity]:hover'),
    '汇总行覆盖 :hover（否则悬停掉回宿主色）',
  )
  expect(
    rowSheet.includes('button[data-turn-process]:hover:not(:disabled)'),
    '本轮汇总覆盖 :hover:not(:disabled)（对齐宿主同形规则）',
  )
  expect(/var\(--dmt-summary-color,\s*#[0-9a-f]{6}\)/i.test(rowSheet), '汇总行颜色有 var() 兜底')
  /* 两类共用一个颜色令牌。 */
  const summaryUses = (rowSheet.match(/--dmt-summary-color/g) || []).length
  expect(summaryUses === 2, '汇总行与本轮汇总共用 --dmt-summary-color', String(summaryUses) + ' 处')

  /* 只勾汇总类时不应产出工具行规则；反之亦然（作用域隔离）。 */
  const onlySummary = buildRowSheet({ ...DEFAULTS, rowVariants: '["summary","turn"]' })
  expect(onlySummary.includes('[data-process-activity]') && onlySummary.includes('[data-turn-process]'), '只勾汇总类：两条汇总规则都在')
  expect(!onlySummary.includes('[data-variant='), '只勾汇总类：不产出工具行规则')
  const onlyTool = buildRowSheet({ ...DEFAULTS, rowVariants: '["write"]' })
  expect(!onlyTool.includes('data-process-activity') && !onlyTool.includes('data-turn-process'), '只勾工具行：不产出汇总规则')
  const onlyOne = buildRowSheet({ ...DEFAULTS, rowVariants: '["summary"]' })
  expect(onlyOne.includes('data-process-activity') && !onlyOne.includes('data-turn-process'), '单独勾汇总行只产出它自己那条')

  /* summaryColor 可独立自定义、非法回落、令牌 light/dark 同值。 */
  const customSum = buildRowSheet({ ...DEFAULTS, rowVariants: '["turn"]', summaryColor: '#FF0000' })
  expect(customSum.includes('#FF0000'), '自定义 summaryColor 进入样式表')
  expect(!customSum.includes(DEFAULTS.rowColor), 'summaryColor 不受 rowColor 影响（两个颜色独立）')
  const badSum = buildRowSheet({ ...DEFAULTS, rowVariants: '["turn"]', summaryColor: 'notacolor' })
  expect(badSum.includes(DEFAULTS.summaryColor), '非法 summaryColor 回落默认', DEFAULTS.summaryColor)
  const sumToken = resolveTokens({ ...DEFAULTS, summaryColor: '#654321' })['--dmt-summary-color']
  expect(sumToken.dark === '#654321' && sumToken.light === '#654321', 'summaryColor 令牌 light/dark 同值')

  /* 默认亮黄在三种背景变体上都要达标。 */
  const sumParsed = parseHex(DEFAULTS.summaryColor)
  if (sumParsed === null) {
    fail(`DEFAULTS.summaryColor 不是纯 hex：${DEFAULTS.summaryColor}`)
  } else {
    for (const surfaceName of Object.keys(SURFACES)) {
      const bgParsed = parseHex(SURFACES[surfaceName].base)
      if (bgParsed === null) continue
      const ratio = contrast(sumParsed, bgParsed)
      expect(ratio >= 4.5, `默认 summaryColor 在 ${surfaceName} 背景上 ≥ 4.5:1`, ratio.toFixed(2) + ':1')
    }
  }
  /* 两种默认色必须可区分（绿 vs 黄），否则用户看不出自己勾了哪类。 */
  expect(DEFAULTS.rowColor !== DEFAULTS.summaryColor, '工具行与汇总行的默认色不同')

  /* ROW_VARIANTS 的 kind 必须齐全且合法（分组渲染依赖它）。 */
  const kinds = new Set(ROW_VARIANTS.map((entry) => entry.kind))
  expect(kinds.has('tool') && kinds.has('summary') && kinds.has('turn'), 'ROW_VARIANTS 覆盖三种 kind', [...kinds].join(', '))
  for (const entry of ROW_VARIANTS) {
    expect(['tool', 'summary', 'turn'].includes(entry.kind), `分类 ${entry.variant} 的 kind 合法`, entry.kind)
    expect(typeof entry.label === 'string' && entry.label.length > 0, `分类 ${entry.variant} 有标签`)
  }
  /* 默认勾选：三类都在（write/edit/bash + summary + turn）。 */
  const defaultPicked = parseRowVariants(DEFAULTS.rowVariants)
  for (const want of ['write', 'edit', 'bash', 'summary', 'turn']) {
    expect(defaultPicked.includes(want), `默认勾选含 ${want}`)
  }

  /* 默认高亮色在三种背景变体上都要够亮（用户要"亮绿"，不能挑个看不清的）。 */
  const rowColorHex = DEFAULTS.rowColor
  const rowParsed = parseHex(rowColorHex)
  if (rowParsed !== null) {
    for (const surfaceName of Object.keys(SURFACES)) {
      const bgParsed = parseHex(SURFACES[surfaceName].base)
      if (bgParsed === null) continue
      const ratio = contrast(rowParsed, bgParsed)
      expect(ratio >= 4.5, `默认过程行高亮色在 ${surfaceName} 背景上 ≥ 4.5:1`, ratio.toFixed(2) + ':1')
    }
  } else {
    fail(`DEFAULTS.rowColor 不是纯 hex：${rowColorHex}`)
  }

  /* ---- 3d：文件卡片底色覆盖样式表 ---- */
  const { buildCardSheet, detectCardTargets, CARD_SHEET_ID, CARD_TARGETS } = test
  expect(typeof buildCardSheet === 'function', 'buildCardSheet 已导出')
  expect(typeof detectCardTargets === 'function', 'detectCardTargets 已导出')
  expect(typeof CARD_SHEET_ID === 'string' && CARD_SHEET_ID.length > 0, 'CARD_SHEET_ID 已声明')
  expect(Array.isArray(CARD_TARGETS) && CARD_TARGETS.length === 4, 'CARD_TARGETS 覆盖四种卡片组件', String(CARD_TARGETS && CARD_TARGETS.length))

  /* 目标组：改动文件卡片（_card / --changes-fill）+ 交付文件卡片（_root / --deliverable-fill）。 */
  const changesTarget = { defClass: 'kuvljq_card', varName: '--changes-fill', hoverVar: '--changes-hover' }
  const deliverTarget = { defClass: 'flL80G_root', varName: '--deliverable-fill', hoverVar: '--deliverable-hover' }

  /* 空串 = 跟随宿主默认 → 不产出任何规则。 */
  expect(buildCardSheet({ ...DEFAULTS, cardColor: '' }, [changesTarget]) === '', 'cardColor 空串 → 空样式表（跟随宿主）')
  expect(buildCardSheet({ ...DEFAULTS, cardColor: 'bad' }, [changesTarget]) === '', '非法 cardColor → 空样式表')
  expect(buildCardSheet({ ...DEFAULTS, cardColor: '#3B454F' }, []) === '', '目标组为空 → 空样式表')
  expect(buildCardSheet({ ...DEFAULTS, cardColor: '#3B454F' }, null) === '', '目标组未检测到 → 空样式表')
  expect(buildCardSheet({ ...DEFAULTS, cardColor: '#3B454F' }, '') === '', '空目标组 → 空样式表')
  expect(buildCardSheet(undefined, [changesTarget]) === '', 'state 缺省 → 空样式表，不抛')

  const cardSheet = buildCardSheet({ ...DEFAULTS, cardColor: '#3B454F' }, [changesTarget])
  expect(cardSheet.length > 0, '挑色后产出规则')
  expect(cardSheet.includes('.kuvljq_card,.kuvljq_card.kuvljq_card.kuvljq_card'), '三遍类名提特异性（压过宿主的 body… .x_card）')
  expect(cardSheet.includes('--changes-fill:#3B454F'), '覆盖 --changes-fill')
  expect(/--changes-hover:#[0-9a-f]{6}/i.test(cardSheet), '悬停色自动提亮一档')
  expect(!cardSheet.includes('!important'), '不使用 !important')
  /* 悬停色必须比底色亮一档（宿主 hover 方向一致）。 */
  const hoverMatch = /--changes-hover:(#[0-9a-f]{6})/i.exec(cardSheet)
  if (hoverMatch !== null) {
    const white = contrast(parseHex(hoverMatch[1]), [255, 255, 255])
    const base = contrast(parseHex('#3B454F'), [255, 255, 255])
    expect(white < base, '悬停色比底色更亮（对白色对比度更低）', `${hoverMatch[1]} vs #3B454F`)
  } else {
    fail('悬停色不是合法 hex：' + cardSheet)
  }
  /* 类名带任意哈希前缀都能生成（检测器给什么用什么）。 */
  expect(buildCardSheet({ ...DEFAULTS, cardColor: '#3B454F' }, [{ ...changesTarget, defClass: 'abc123_card' }]).includes('.abc123_card'), '类名前缀不写死')

  /* 交付文件卡片：变量定义在 _root 上，消费在 _file 上 —— 覆盖 _root 即可，
     因为 _file 读的就是 var(--deliverable-fill)。 */
  const deliverSheet = buildCardSheet({ ...DEFAULTS, cardColor: '#3B454F' }, [deliverTarget])
  expect(deliverSheet.includes('--deliverable-fill:#3B454F'), '覆盖 --deliverable-fill')
  expect(deliverSheet.includes('.flL80G_root,.flL80G_root.flL80G_root.flL80G_root'), '交付文件卡片同样三遍类名提特异性')
  expect(/--deliverable-hover:#[0-9a-f]{6}/i.test(deliverSheet), '交付文件卡片也有悬停色')

  /* 两种卡片同时存在时，两条规则都要有（不能只覆盖一种）。 */
  const bothSheet = buildCardSheet({ ...DEFAULTS, cardColor: '#3B454F' }, [changesTarget, deliverTarget])
  expect(bothSheet.includes('--changes-fill:#3B454F'), '两种卡片并存时也覆盖 --changes-fill')
  expect(bothSheet.includes('--deliverable-fill:#3B454F'), '两种卡片并存时也覆盖 --deliverable-fill')

  /* ---- 4：对比度（只查 dark，因为 Mariana 是深色主题）---- */
  const dark = resolveTokens(DEFAULTS)
  const bgHex = dark['--dsw-alias-bg-base'].dark
  const bg = parseHex(bgHex)
  if (bg === null) {
    fail(`--dsw-alias-bg-base 的 dark 值不是 hex：${bgHex}（对比度检查需要纯 hex）`)
  } else {
    const rules = [
      ['--dsw-alias-label-primary', 7, '正文'],
      ['--dsw-alias-label-secondary', 4.5, '次级文字'],
      ['--dsw-alias-label-tertiary', 3, '三级文字'],
      ['--dsw-alias-label-caption', 3, '说明文字'],
      ['--dsw-alias-state-error-primary', 3, '错误色'],
      ['--dsw-alias-state-success-primary', 3, '成功色'],
      ['--dsw-alias-state-warn-primary', 3, '警告色'],
      ['--dsw-alias-link', 4.5, '链接'],
      ['--shiki-token-keyword', 3, '语法·关键字'],
      ['--shiki-token-string', 3, '语法·字符串'],
      ['--shiki-token-function', 3, '语法·函数'],
      ['--shiki-token-comment', 3, '语法·注释'],
    ]
    for (const [name, minimum, human] of rules) {
      const entry = dark[name]
      if (entry === undefined) {
        fail(`对比度检查缺令牌 ${name}`)
        continue
      }
      const fg = parseHex(entry.dark)
      if (fg === null) {
        warn(`${human}（${name}）的值不是纯 hex，跳过对比度检查：${entry.dark}`)
        continue
      }
      const ratio = contrast(fg, bg)
      const rounded = Math.round(ratio * 100) / 100
      if (ratio < minimum) {
        fail(`${human}（${name}）对比度 ${rounded}:1 低于 ${minimum}:1（背景 ${bgHex}）`)
      } else if (verbose) {
        console.log(`  ✓ ${human} ${rounded}:1 ≥ ${minimum}:1`)
      }
    }

    /* 浅色模式也查一遍，避免"切到浅色变瞎" */
    const lightBg = parseHex(dark['--dsw-alias-bg-base'].light)
    if (lightBg !== null) {
      const lightRules = [
        ['--dsw-alias-label-primary', 7, '浅色·正文'],
        ['--dsw-alias-label-secondary', 4.5, '浅色·次级文字'],
        ['--dsw-alias-label-tertiary', 3, '浅色·三级文字'],
        ['--dsw-alias-label-caption', 3, '浅色·说明文字'],
        ['--dsw-alias-link', 4.5, '浅色·链接'],
      ]
      for (const [name, minimum, human] of lightRules) {
        const entry = dark[name]
        if (entry === undefined) continue
        const fg = parseHex(entry.light)
        if (fg === null) {
          warn(`${human}（${name}）的浅色值不是纯 hex，跳过对比度检查：${entry.light}`)
          continue
        }
        const ratio = Math.round(contrast(fg, lightBg) * 100) / 100
        if (ratio < minimum) fail(`${human}（${name}）对比度 ${ratio}:1 低于 ${minimum}:1（背景 ${dark['--dsw-alias-bg-base'].light}）`)
        else if (verbose) console.log(`  ✓ ${human} ${ratio}:1 ≥ ${minimum}:1`)
      }
    }
  }

  /* ---- 5：覆盖完整性报告 ---- */
  const coveredAlias = ALIAS_TOKENS.filter((name) => name in dark)
  const missingAlias = ALIAS_TOKENS.filter((name) => !(name in dark))
  const coveredSpecific = SPECIFIC_TOKENS.filter((name) => name in dark)
  const missingSpecific = SPECIFIC_TOKENS.filter((name) => !(name in dark))

  /* 有意不覆盖的 alias：纯黑遮罩（与色相无关）、反色边框（宿主已置透明）等。 */
  const INTENTIONAL = new Set([
    '--dsw-alias-bg-mask-1', '--dsw-alias-bg-mask-2', '--dsw-alias-bg-mask-3',
    '--dsw-alias-bg-mask-drop', '--dsw-alias-bg-mask-photo',
    '--dsw-alias-border-inverted', '--dsw-alias-border-inverted2',
  ])
  for (const name of missingAlias) {
    if (!INTENTIONAL.has(name)) warn(`未覆盖 alias 令牌 ${name}（宿主默认值会露出来）`)
  }

  console.log('')
  console.log('dsh-colorlab 静态校验')
  console.log('─'.repeat(52))
  console.log(`  令牌检查         ${checkedTokens} 次（${seenNames.size} 个唯一变量 × 变体组合）`)
  console.log(`  已知令牌白名单   ${KNOWN.size} 个（alias ${ALIAS_TOKENS.length} + specific ${SPECIFIC_TOKENS.length} + static ${STATIC_TOKENS.length} + shiki ${SHIKI_TOKENS.length} + shiki-diff ${SHIKI_DIFF_TOKENS.length} + prose ${PROSE_TOKENS.length} + row ${ROW_TOKENS.length} + patch ${PATCH_TOKENS.length}）`)
  console.log(`  alias 覆盖       ${coveredAlias.length}/${ALIAS_TOKENS.length}`)
  console.log(`  specific 覆盖    ${coveredSpecific.length}/${SPECIFIC_TOKENS.length}`)
  console.log(`  未覆盖 alias     ${missingAlias.length} 个（其中 ${missingAlias.filter((n) => INTENTIONAL.has(n)).length} 个为有意保留）`)
  if (verbose && missingAlias.length > 0) console.log('    ' + missingAlias.join(', '))
  if (verbose && missingSpecific.length > 0) console.log('  未覆盖 specific: ' + missingSpecific.join(', '))
  console.log('─'.repeat(52))
}

if (warnings.length > 0) {
  console.log('')
  console.log(`警告 ${warnings.length} 条：`)
  for (const message of warnings) console.log('  ⚠ ' + message)
}

if (failures.length > 0) {
  console.log('')
  console.log(`失败 ${failures.length} 条：`)
  for (const message of failures) console.log('  ✗ ' + message)
  process.exit(1)
}

console.log('')
console.log('✓ 全部通过')
