#!/usr/bin/env node
/**
 * 代码高亮令牌映射 + LaTeX 块覆盖的回归测试。
 *
 * 两件事分开测：
 *
 *  A. **令牌映射**（全局）：核对 `--shiki-token-*` 是否落在 Sublime Mariana 的对应色上。
 *
 *  B. **LaTeX 块覆盖**（局部）：Shiki 的 LaTeX 语法把整个 `$…$` 块套了
 *     `support.class.math.block.*`，命中主题的 `support` 规则 → 整块变 `constant`（橙）；
 *     而 Sublime 是按 scope 上色（数学命令紫、括号/反斜杠/$ 青、数字橙）。
 *     所以插件只在 LaTeX 块内覆盖两个令牌，其它语言不受影响。
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
 * 最小 DOM 替身（够跑 LaTeX 块的标记与样式表挂载）
 * ------------------------------------------------------------------ */

function makePre(text) {
  const classes = new Set(['shiki', 'css-variables'])
  return {
    tagName: 'PRE',
    textContent: text,
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
    },
    _classes: classes,
  }
}

function createFakeDom(preTexts) {
  const pres = preTexts.map(makePre)
  const created = []
  const head = {
    children: [],
    appendChild(node) {
      this.children.push(node)
      node.parentNode = this
      created.push(node)
      return node
    },
    removeChild(node) {
      this.children = this.children.filter((c) => c !== node)
      node.parentNode = null
    },
  }
  const documentElement = { attributes: {} }
  return {
    pres,
    created,
    head,
    documentElement,
    document: {
      head,
      documentElement,
      body: { tagName: 'BODY' },
      querySelectorAll(selector) {
        if (selector === 'pre.shiki') return pres
        const m = /^pre\.(.+)$/.exec(selector)
        if (m !== null) return pres.filter((p) => p._classes.has(m[1]))
        return []
      },
      createElement(tag) {
        const node = {
          tagName: String(tag).toUpperCase(),
          dataset: {},
          style: {},
          parentNode: null,
          remove() {
            if (this.parentNode !== null) this.parentNode.removeChild(this)
          },
        }
        let text = ''
        Object.defineProperty(node, 'textContent', {
          get() {
            return text
          },
          set(v) {
            text = v
          },
        })
        return node
      },
    },
  }
}

/* ------------------------------------------------------------------ *
 * 载入 client.js
 * ------------------------------------------------------------------ */

function loadPlugin(dom) {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: { load: (definition) => { captured = definition } },
    React: undefined,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const fakeRequire = (id) => {
    if (id === 'react') {
      return {
        createElement: (...args) => ({ args }),
        Fragment: 'fragment',
        useSyncExternalStore: (s, g) => g(),
        useState: (v) => [v, () => {}],
      }
    }
    throw new Error('unexpected require: ' + id)
  }
  const run = new Function('window', 'document', 'require', 'setTimeout', source)
  run(fakeWindow, dom ? dom.document : undefined, fakeRequire, () => ({ unref() {} }))
  if (captured === null) throw new Error('client.js 没有注册 bundle')
  return captured.factory(fakeRequire)
}

/* ------------------------------------------------------------------ *
 * A. 全局令牌映射
 * ------------------------------------------------------------------ */

console.log('')
console.log('dsh-colorlab LaTeX 覆盖测试')
console.log('─'.repeat(52))
console.log('  A. 全局令牌映射')

const plain = loadPlugin(null)
const test = plain.__test
const {
  PALETTE, resolveTokens, DEFAULTS,
  LATEX_TOKEN_OVERRIDES, LATEX_BLOCK_CLASS, LATEX_SHEET_ID, buildLatexSheet, isLatexBlock,
} = test

const tokens = resolveTokens(DEFAULTS)
check(tokens['--shiki-token-function'].dark === '#6699CC', 'function = #6699CC 蓝（support.function）', tokens['--shiki-token-function'].dark)
check(tokens['--shiki-token-keyword'].dark === PALETTE.purple, 'keyword = #C594C5 紫（keyword）', tokens['--shiki-token-keyword'].dark)
check(tokens['--shiki-token-string'].dark === PALETTE.green, 'string = #99C794 绿（string）', tokens['--shiki-token-string'].dark)
/* 这两条是关键：全局保持 Sublime 语义，**只有 LaTeX 块**才偏移 */
check(tokens['--shiki-token-constant'].dark === PALETTE.orange, 'constant 全局仍是橙（constant.numeric）', tokens['--shiki-token-constant'].dark)
check(tokens['--shiki-token-punctuation'].dark === PALETTE.dim, 'punctuation 全局仍是灰（punctuation.separator）', tokens['--shiki-token-punctuation'].dark)

/* ------------------------------------------------------------------ *
 * B. LaTeX 块覆盖
 * ------------------------------------------------------------------ */

console.log('  B. LaTeX 块覆盖')

check(LATEX_BLOCK_CLASS === 'dmt-latex', '块标记类名 = dmt-latex', LATEX_BLOCK_CLASS)
check(
  LATEX_TOKEN_OVERRIDES['--shiki-token-constant'] === '#C695C6',
  'LaTeX 块内 constant → #C695C6 紫（Mariana keyword.other.math.*）',
  LATEX_TOKEN_OVERRIDES['--shiki-token-constant'],
)
check(
  LATEX_TOKEN_OVERRIDES['--shiki-token-punctuation'] === '#5FB4B4',
  'LaTeX 块内 punctuation → #5FB4B4 青（Mariana punctuation.definition）',
  LATEX_TOKEN_OVERRIDES['--shiki-token-punctuation'],
)

const sheet = buildLatexSheet()
check(sheet.startsWith('pre.dmt-latex{'), '样式表作用域限定在 pre.dmt-latex', sheet.slice(0, 30))
check(sheet.includes('--shiki-token-constant:#C695C6'), '覆盖 --shiki-token-constant')
check(sheet.includes('--shiki-token-punctuation:#5FB4B4'), '覆盖 --shiki-token-punctuation')

const latexSamples = [
  '\\chapter{从经典到量子}\\label{ch:whyquant}',
  '\\bi \\zh{频率与角频率}: $E=h\\nu=\\hbar\\omega$',
  '\\begin{summarybox}\n\\bi 1900--1926 的历史链条\n\\end{summarybox}',
  '$\\hbar=h/2\\pi$',
]
const nonLatexSamples = [
  'const a = "x\\n" + b;',
  'print("Pages:", len(doc))',
  'SELECT * FROM t WHERE a = 1;',
  'hello world',
]
for (const s of latexSamples) {
  check(isLatexBlock({ textContent: s }) === true, '判为 LaTeX：' + s.slice(0, 34).replace(/\n/g, '⏎'))
}
for (const s of nonLatexSamples) {
  check(isLatexBlock({ textContent: s }) === false, '不判为 LaTeX：' + s.slice(0, 34))
}
check(isLatexBlock(null) === false, 'null 安全')
check(isLatexBlock({ textContent: '' }) === false, '空内容安全')

/* ------------------------------------------------------------------ *
 * C. 应用后：只有 LaTeX 块被标记 + 样式表挂上
 * ------------------------------------------------------------------ */

console.log('  C. 应用后的 DOM 效果')

{
  const dom = createFakeDom([
    '\\bi \\zh{频率与角频率}: $E=h\\nu=\\hbar\\omega$',
    'print("Pages:", len(doc))',
  ])
  const mod = loadPlugin(dom)
  const theme = {
    ctx: { on: () => () => {} },
    getTheme: () => ({ active: { colorScheme: 'dark', tokens: {} }, preference: 'dark', revision: 1 }),
    overrideTokens: () => () => {},
  }
  const ctx = {
    effect(factory) { factory() },
    on: () => () => {},
    get: (n) => (n === 'theme' ? theme : undefined),
    theme,
  }
  mod.apply(ctx)

  check(dom.pres[0]._classes.has('dmt-latex') === true, 'LaTeX 块被标记 dmt-latex')
  check(dom.pres[1]._classes.has('dmt-latex') === false, 'Python 块没被误标')
  const latexSheet = dom.created.find((n) => n.dataset && n.dataset.pluginCss === LATEX_SHEET_ID)
  check(latexSheet !== undefined, 'LaTeX 覆盖样式表已挂上')
  check(
    latexSheet !== undefined && String(latexSheet.textContent).includes('#C695C6'),
    '样式表内容含紫色覆盖',
    latexSheet ? String(latexSheet.textContent).slice(0, 60) : 'n/a',
  )
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
