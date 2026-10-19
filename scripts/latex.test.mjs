#!/usr/bin/env node
/**
 * 代码高亮的**令牌映射**回归测试。
 *
 * 背景：Shiki 的 `css-variables` 主题把 scope 归并成少数几个令牌，而
 * Sublime 的 Mariana 是按 scope 上色的。两边对同一批 scope 的分派不同：
 *
 *   Sublime Mariana                 Shiki css-variables
 *   ───────────────                 ────────────────────
 *   keyword                  → keyword   （`var(pink)` = #C594C5 紫）
 *   support.function         → function  （`var(blue)`  = #6699CC 蓝）
 *   entity.name.function     → function  （`var(blue5)` = #5FB3B3 青）
 *
 * `support.function`（Python 内置函数 print/len/open、LaTeX 命令 \chapter）
 * 和 `entity.name.function`（函数定义名）在 Sublime 里是**不同颜色**，
 * 但 Shiki 把它们合并成同一个 `function` 令牌 —— 一个令牌只能一个颜色。
 *
 * 本插件取 `var(blue)`（#6699CC）：函数**调用**比函数**定义**常见得多，
 * 且前者才是 Sublime 里最常看到的那个色。
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
 * 载入 client.js（与 verify.mjs 同一套加载方式）
 * ------------------------------------------------------------------ */

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
  const fakeRequire = (id) => {
    if (id === 'react') {
      return { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: () => ({}) }
    }
    throw new Error('unexpected require: ' + id)
  }
  const run = new Function('window', 'document', 'require', 'setTimeout', source)
  run(fakeWindow, undefined, fakeRequire, () => ({ unref() {} }))
  if (captured === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')
  return captured.factory(fakeRequire)
}

const test = loadPlugin().__test
const { PALETTE, resolveTokens, DEFAULTS, MARKDOWN_RULES, buildMarkdownSheet } = test

/* ------------------------------------------------------------------ *
 * 1. function 令牌 = Mariana 的 var(blue)
 * ------------------------------------------------------------------ */

check(PALETTE && PALETTE.blue === '#6699CC', 'PALETTE.blue = #6699CC（Mariana var(blue)）', PALETTE && PALETTE.blue)

const tokens = resolveTokens(DEFAULTS)
const fn = tokens['--shiki-token-function']
check(fn !== undefined, '解析出 --shiki-token-function')
check(
  fn !== undefined && fn.dark === '#6699CC',
  'function 令牌 = #6699CC（对齐 support.function）',
  fn ? fn.dark : 'n/a',
)
check(
  fn !== undefined && fn.light === '#3E6FA8',
  '浅色是同色相的提亮版（浅色底上原色太深）',
  fn ? fn.light : 'n/a',
)

/* 其它令牌的对照（防止改 function 时手滑改了别的）。 */
check(
  tokens['--shiki-token-keyword'] !== undefined && tokens['--shiki-token-keyword'].dark === PALETTE.purple,
  'keyword 令牌 = #C594C5 紫（var(pink)）',
  tokens['--shiki-token-keyword'] ? tokens['--shiki-token-keyword'].dark : 'n/a',
)
check(
  tokens['--shiki-token-string'] !== undefined && tokens['--shiki-token-string'].dark === PALETTE.green,
  'string 令牌 = #99C794 绿（var(green)）',
  tokens['--shiki-token-string'] ? tokens['--shiki-token-string'].dark : 'n/a',
)
check(
  tokens['--shiki-token-constant'] !== undefined && tokens['--shiki-token-constant'].dark === PALETTE.orange,
  'constant 令牌 = #F9AE58 橙（var(orange)）',
  tokens['--shiki-token-constant'] ? tokens['--shiki-token-constant'].dark : 'n/a',
)

/* ------------------------------------------------------------------ *
 * 2. Markdown 细节规则
 * ------------------------------------------------------------------ */

check(Array.isArray(MARKDOWN_RULES) && MARKDOWN_RULES.length === 3, '三条 Markdown 细节规则', String(MARKDOWN_RULES && MARKDOWN_RULES.length))

const sheet = buildMarkdownSheet()
check(sheet.includes('li::marker'), '列表符号规则存在')
check(sheet.includes('blockquote'), '引用规则存在')
check(sheet.includes('code{background'), '行内代码背景规则存在')
check(sheet.includes('[class*="_markdown_"]'), '用宿主 markdown 容器的稳定前缀做锚点')
check(!sheet.includes('!important'), '不使用 !important')
/* 紧凑摘要区是宿主刻意压缩的展示，不该被主题细节干扰。 */
check(sheet.includes(':not([data-markdown-variant="compact"])'), '排除紧凑变体')

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
