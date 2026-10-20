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

function makePre(text, tokens) {
  const classes = new Set(['shiki', 'css-variables'])
  const spans = (tokens || []).map((t) => {
    const sc = new Set()
    return {
      textContent: t,
      children: [],
      classList: { add: (c) => sc.add(c), contains: (c) => sc.has(c), remove: (c) => sc.delete(c) },
      _classes: sc,
    }
  })
  return {
    tagName: 'PRE',
    textContent: text,
    children: spans,
    _spans: spans,
    querySelectorAll: (sel) => (sel === 'span' ? spans : []),
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
    },
    _classes: classes,
  }
}

function createFakeDom(pres) {
  const list = pres.map((p) => (typeof p === 'string' ? makePre(p) : makePre(p.text, p.tokens)))
  const pres2 = list
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
    pres: pres2,
    created,
    head,
    documentElement,
    document: {
      head,
      documentElement,
      body: { tagName: 'BODY' },
      querySelectorAll(selector) {
        if (selector === 'pre.shiki') return pres2
        const m = /^pre\.(.+)$/.exec(selector)
        if (m !== null) return pres2.filter((p) => p._classes.has(m[1]))
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
    {
      text: '\\bi \\zh{频率与角频率}: $E=h\\nu$',
      tokens: ['\\', 'bi', ' ', '\\', 'zh', '{', '频率与角频率', '}', ':', ' ', '$', 'E', '=', 'h', '\\', 'nu', '$'],
    },
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
  /* 集成链路：apply → 识别 → 打块标记 → span 级上色 */
  check(dom.pres[0]._spans[0]._classes.has('dmt-tx-bs'), '集成：apply 后反斜杠 span 被打上青色类')
  check(dom.pres[0]._spans[10]._classes.has('dmt-tx-mdelim'), '集成：apply 后 $ span 被打上青色类')
  check(dom.pres[0]._spans[15]._classes.has('dmt-tx-mcmd'), '集成：apply 后 nu span 被打上紫色类')
  check(dom.pres[1]._spans === undefined || dom.pres[1].children.length === 0, 'Python 块没有 span 被处理')
  const latexSheet = dom.created.find((n) => n.dataset && n.dataset.pluginCss === LATEX_SHEET_ID)
  check(latexSheet !== undefined, 'LaTeX 覆盖样式表已挂上')
  check(
    latexSheet !== undefined && String(latexSheet.textContent).includes('#C695C6'),
    '样式表内容含紫色覆盖',
    latexSheet ? String(latexSheet.textContent).slice(0, 60) : 'n/a',
  )
}

console.log('  D. span 级后处理（补齐令牌模型盖不到的部分）')

const { TX_CLASS, applyLatexSpans, latexSpansIntact, MATH_BUILTINS, TEXT_KEYWORD_COMMANDS, LATEX_COLORS } = test

check(MATH_BUILTINS.has('hbar') && MATH_BUILTINS.has('nu') && MATH_BUILTINS.has('oint'),
  '数学内置表含 hbar / nu / oint', String(MATH_BUILTINS.size) + ' 项')
check(MATH_BUILTINS.has('dd') === false, '自定义宏 dd 不在内置表里（应判为蓝）')
check(TEXT_KEYWORD_COMMANDS.has('begin') && TEXT_KEYWORD_COMMANDS.has('label'),
  '文本关键字命令表含 begin / label')

/**
 * 造一个仿 Shiki 输出的 span 序列：
 * 每个 token 一个叶子 span，textContent 就是 token 原文。
 * `\` 与命令名在 Shiki 里是**两个** span（capture 1 是反斜杠）。
 */
function makeBlock(tokens) {
  const spans = tokens.map((t) => {
    const classes = new Set()
    return {
      textContent: t,
      children: [],
      classList: {
        add: (c) => classes.add(c),
        contains: (c) => classes.has(c),
        remove: (c) => classes.delete(c),
      },
      _classes: classes,
    }
  })
  const pre = {
    textContent: tokens.join(''),
    children: spans,
    querySelectorAll: (sel) => (sel === 'span' ? spans : []),
    classList: { contains: () => false, add: () => {}, remove: () => {} },
  }
  return { pre, spans }
}

function runTokens(tokens) {
  const { pre, spans } = makeBlock(tokens)
  applyLatexSpans(pre)
  return spans
}

/* `\bi \zh{频率}: $E=h\nu$` —— 文本模式命令 + 花括号 + 数学块 */
{
  const spans = runTokens([
    '\\', 'bi', ' ', '\\', 'zh', '{', '频率', '}', ':',
    ' ', '$', 'E', '=', 'h', '\\', 'nu', '2', '\\', 'pi', '$',
  ])
  const cls = (i) => spans[i]._classes
  check(cls(0).has(TX_CLASS.backslash), '反斜杠 → 青（punctuation.definition）')
  check(cls(1).has(TX_CLASS.backslash) === false, '文本模式命令名不改色（交给令牌：蓝）')
  check(cls(5).has(TX_CLASS.brace) && cls(7).has(TX_CLASS.brace), '花括号 → 青')
  check(cls(10).has(TX_CLASS.mathDelim), '$ → 青（punctuation.definition.string）')
  check(cls(11).has(TX_CLASS.ident), '数学标识符 E → 正文色斜体')
  check(cls(12).has(TX_CLASS.operator), '数学 = → 橙红（keyword.operator）')
  check(cls(14).has(TX_CLASS.backslash), '数学里的反斜杠 → 青')
  check(cls(15).has(TX_CLASS.mathCmd), '数学内置命令 nu → 紫（keyword.other.math.*）')
  check(cls(16).has(TX_CLASS.number), '数学数字 2 → 橙（constant.numeric）')
  check(cls(18).has(TX_CLASS.mathCmd), '数学内置命令 pi → 紫')
  check(cls(19).has(TX_CLASS.mathDelim), '收尾 $ → 青')
  check(cls(2).has(TX_CLASS.ident) === false, '数学外的空格不被打标')
}

/* 数学里的自定义宏 → 蓝；下标 → 灰；圆括号 → 白 */
{
  const spans = runTokens(['$', '\\', 'dd', 'q', '_', 'n', '(', 'a', ')', '$'])
  check(spans[2]._classes.has(TX_CLASS.mathCustom), '数学自定义宏 dd → 蓝（support.function.math）')
  check(spans[4]._classes.has(TX_CLASS.separator), '下标 _ → 灰（punctuation.separator）')
  check(spans[6]._classes.has(TX_CLASS.paren), '数学圆括号 → 白（punctuation.section）')
}

/* 文本模式的关键字命令 → 紫（Shiki 给的是 function，Sublime 是 keyword） */
{
  const spans = runTokens(['\\', 'begin', '{', 'summarybox', '}'])
  check(spans[1]._classes.has(TX_CLASS.kwCmd), '文本模式 \\begin → 紫（keyword.control.*）')
  check(spans[0]._classes.has(TX_CLASS.backslash), '\\begin 的反斜杠 → 青')
}

/* `\$` 转义不能切换数学模式 */
{
  const spans = runTokens(['\\', '$', 'x', '$'])
  check(
    spans[2]._classes.has(TX_CLASS.ident) === false,
    '转义 \\$ 不开启数学模式（后续 x 不被打成标识符）',
  )
}

/* 颜色值必须是 Mariana 的精确值 */
check(LATEX_COLORS.teal === '#5FB4B4', '青 = #5FB4B4（hsl(180,36%,54%)，不是近似的 #5FB3B3）', LATEX_COLORS.teal)
check(LATEX_COLORS.operatorRed === '#F97B58', '运算符红 = #F97B58（var(red2)）', LATEX_COLORS.operatorRed)

/* 类规则都带 !important（Shiki 把颜色写在内联 style 上） */
const classRules = buildLatexSheet().split('\n').slice(1)
check(classRules.length >= 8, '样式表含 8 组以上的类规则', String(classRules.length) + ' 组')
check(classRules.every((r) => r.includes('!important')), '每组类规则都带 !important')

/* ---- 重渲染：类被抹掉后必须能补回来（真机上「有的正常、有的是白的」就是这个）---- */
{
  const { pre, spans } = makeBlock(['\\', 'bi', '{', 'x', '}', '$', 'E', '$'])
  /* 给叶子 span 补上真实 DOM 会有的成员，让探针能判定 */
  for (const s of spans) {
    s.isConnected = true
    s.parentNode = pre
    let cn = ''
    Object.defineProperty(s, 'className', {
      get() {
        return [...s._classes].join(' ')
      },
      set(v) {
        cn = v
      },
    })
  }
  const n1 = applyLatexSpans(pre)
  check(n1 > 0, '首次遍历打上类', String(n1) + ' 个')
  check(latexSpansIntact(pre) === true, '打完之后探针判定「仍然有效」')

  /* 模拟 Shiki 重渲染：旧子树被摘掉（isConnected=false / parentNode=null），
     换一批全新的 span，类全没了（但文本长度一模一样）。 */
  for (const s of spans) {
    s.isConnected = false
    s.parentNode = null
  }
  const fresh = makeBlock(['\\', 'bi', '{', 'x', '}', '$', 'E', '$'])
  for (const s of fresh.spans) {
    s.isConnected = true
    s.parentNode = fresh.pre
    Object.defineProperty(s, 'className', { get: () => [...s._classes].join(' '), set: () => {} })
  }
  pre.querySelectorAll = (sel) => (sel === 'span' ? fresh.spans : [])
  check(latexSpansIntact(pre) === false, '重渲染后（旧探针已脱离）判定「需要重跑」')
  const n2 = applyLatexSpans(pre)
  check(n2 > 0, '重跑后类补回来了', String(n2) + ' 个')
  check(fresh.spans[0]._classes.has(TX_CLASS.backslash), '重跑后反斜杠又是青的')
  check(fresh.spans[2]._classes.has(TX_CLASS.brace), '重跑后花括号又是青的')
  check(fresh.spans[6]._classes.has(TX_CLASS.ident), '重跑后数学标识符被重新判类')
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
