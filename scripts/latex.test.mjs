#!/usr/bin/env node
/**
 * LaTeX 高亮测试。
 *
 * 做法：**把 Sublime 的 `LaTeX.sublime-syntax` / `TeX.sublime-syntax` 整份移植过来**
 * （`tools/build-tex-grammar.py` 编译语法 → `tools/tex-tokenizer.mjs` 跑分词 →
 * `tools/build-mariana-colors.py` 编译配色 → `tools/tex-colors.mjs` 求颜色），
 * 不再靠「按 token 猜颜色」那一套。
 *
 * 本测试锁四件事：
 *   A. 语法/配色/引擎的**生成区与真源一致**（防止手改了 client.js 忘了重新生成）
 *   B. 判定 LaTeX 块的内容特征
 *   C. 渲染出的**每个字符的颜色**与 Sublime 一致
 *   D. 渲染层挂载/卸载：不动宿主的节点，只加兄弟层 + 隐藏原层
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
 * 最小 DOM 替身
 * ------------------------------------------------------------------ */

function makeEl(tag, text) {
  const classes = new Set()
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    isConnected: true,
    dataset: {},
    _classes: classes,
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toString: () => [...classes].join(' '),
    },
    get className() {
      return [...classes].join(' ')
    },
    set className(v) {
      classes.clear()
      String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c))
    },
    appendChild(child) {
      child.parentNode = node
      node.children.push(child)
      return child
    },
    removeChild(child) {
      node.children = node.children.filter((c) => c !== child)
      child.parentNode = null
      return child
    },
    remove() {
      if (node.parentNode !== null) node.parentNode.removeChild(node)
      node.isConnected = false
    },
    querySelectorAll: () => [],
  }
  let inner = text === undefined ? '' : String(text)
  Object.defineProperty(node, 'textContent', {
    get: () => (node.children.length === 0
      ? inner
      : inner + node.children.map((c) => c.textContent).join('')),
    set: (v) => { inner = String(v) },
  })
  let html = ''
  Object.defineProperty(node, 'innerHTML', {
    get: () => html,
    set: (v) => { html = String(v) },
  })
  return node
}

function createFakeDom(pres) {
  const created = []
  const head = { children: [], appendChild(n) { this.children.push(n); n.parentNode = this; created.push(n); return n }, removeChild(n) { this.children = this.children.filter((c) => c !== n) } }
  return {
    pres,
    created,
    document: {
      head,
      documentElement: { attributes: {}, setAttribute() {}, removeAttribute() {} },
      body: { tagName: 'BODY' },
      querySelectorAll(sel) {
        if (sel === 'pre.shiki') return pres
        const m = /^pre\.(.+)$/.exec(sel)
        if (m !== null) return pres.filter((p) => p._classes.has(m[1]))
        return []
      },
      createElement: (tag) => { const el = makeEl(tag); created.push(el); return el },
    },
  }
}

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

/* ------------------------------------------------------------------ *
 * A. 生成区与真源一致
 * ------------------------------------------------------------------ */

console.log('')
console.log('dsh-colorlab LaTeX 测试')
console.log('─'.repeat(56))
console.log('  A. 生成区与 tools/ 真源一致')

const mod = loadPlugin(null)
const t = mod.__test

const truthGrammar = JSON.parse(readFileSync(join(root, 'tools/tex-grammar.json'), 'utf8'))
const truthColors = JSON.parse(readFileSync(join(root, 'tools/mariana-colors.json'), 'utf8'))
check(JSON.stringify(t.TEX_GRAMMAR) === JSON.stringify(truthGrammar),
  '嵌入的语法与 tools/tex-grammar.json 一致',
  `${Object.keys(t.TEX_GRAMMAR.contexts).length} 个 context`)
check(JSON.stringify(t.TEX_COLORS) === JSON.stringify(truthColors),
  '嵌入的配色与 tools/mariana-colors.json 一致',
  `${t.TEX_COLORS.rules.length} 条规则`)

/* 语法确实来自 Sublime：抽查几条原文规则 */
const greeksRule = (truthGrammar.contexts['math-greeks'] || [])[0]
check(greeksRule !== undefined && greeksRule.scope === 'keyword.other.math.greek.tex',
  'math-greeks 的 scope 与 TeX.sublime-syntax 一致', greeksRule && greeksRule.scope)
check(greeksRule !== undefined && greeksRule.captures && greeksRule.captures['1'] === 'punctuation.definition.backslash.tex',
  '反斜杠是**独立捕获**（所以能单独染青）', greeksRule && JSON.stringify(greeksRule.captures))
const sectionRule = (truthGrammar.contexts['sections'] || [])[0]
check(sectionRule !== undefined && sectionRule.captures && sectionRule.captures['2'] === 'punctuation.definition.backslash.latex',
  'sections 规则带反斜杠捕获', sectionRule && JSON.stringify(Object.keys(sectionRule.captures || {})))

/* ------------------------------------------------------------------ *
 * B. 判定 LaTeX 块
 * ------------------------------------------------------------------ */

console.log('  B. 判定 LaTeX 块')

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
for (const s of latexSamples) check(t.isLatexBlock(s) === true, '判为 LaTeX：' + s.slice(0, 32).replace(/\n/g, '⏎'))
for (const s of nonLatexSamples) check(t.isLatexBlock(s) === false, '不判为 LaTeX：' + s.slice(0, 32))
check(t.isLatexBlock('') === false, '空内容安全')

/* ------------------------------------------------------------------ *
 * B2. 不变量：token 必须逐字符覆盖原文，渲染不得增删字符
 *     （这条抓到过真 bug：`sections` 规则的反斜杠捕获**嵌套**在命令捕获内部，
 *      分段时没夹住起点 → 反斜杠被输出两遍）
 * ------------------------------------------------------------------ */

console.log('  B2. 不变量：逐字符覆盖 / 渲染不增删')

const invariantCases = [
  '\\begin{summarybox}[title={x}]\\label{ch:y}\\section{标题}',
  '$\\hH=-\\frac{\\hbar^2}{2m}\\lap-\\frac{e^2}{r}$? 那个 $\\lap$ 是天上掉下来的吗？',
  '\\bi \\zh{频率与角频率}: $E=h\\nu=\\hbar\\omega$，其中 $\\omega=2\\pi\\nu$。',
  '\\chapter{从经典到量子}\\label{ch:whyquant}',
  'normal text\nsecond line\n',
  '',
]
for (const text of invariantCases) {
  const toks = t.tokenize(text, t.TEX_GRAMMAR).tokens
  let pos = 0
  let contiguous = true
  for (const tk of toks) {
    if (tk.start !== pos || tk.end < tk.start) contiguous = false
    pos = Math.max(pos, tk.end)
  }
  if (pos !== text.length) contiguous = false
  const rejoined = toks.map((tk) => text.slice(tk.start, tk.end)).join('')
  const label = JSON.stringify(text.slice(0, 26))
  check(contiguous && rejoined === text, `token 首尾相接且完整覆盖 ${label}`)
  const stripped = t.renderTexHtml(text).replace(/<[^>]*>/g, '')
  check(stripped === text, `渲染出的文本 == 原文 ${label}`)
}

/* ------------------------------------------------------------------ *
 * C. 逐字符颜色（与 Sublime 的 scope 表对齐）
 * ------------------------------------------------------------------ */

console.log('  C. 渲染出的颜色')

const TEAL = '#5FB4B4'
const BLUE = '#6699CC'
const PURPLE = '#C695C6'
const ORANGE = '#F9AE58'
const RED2 = '#F97B58'
const FG = '#D8DEE9'

/** 从渲染出的 HTML 里抽 `[颜色, 文本]` 序列。 */
function pieces(html) {
  const out = []
  const re = /<span style="color:(#[0-9A-Fa-f]{6})([^"]*)">([^<]*)<\/span>/g
  let m
  while ((m = re.exec(html)) !== null) out.push({ fg: m[1], fs: m[2], text: m[3] })
  return out
}
const fgOf = (html, text) => {
  const hit = pieces(html).find((p) => p.text === text)
  return hit === undefined ? null : hit.fg
}

{
  /* 你给的那一行 —— 反斜杠独立成段、花括号青、数字橙、运算符橙红 */
  const html = t.renderTexHtml('$\\hH=-\\frac{\\hbar^2}{2m}\\lap-\\frac{e^2}{r}$')
  check(fgOf(html, '$') === TEAL, '$ → 青', fgOf(html, '$'))
  check(fgOf(html, '\\') === TEAL || fgOf(html, '\\') === BLUE,
    '反斜杠自成一段（不会再和命令名糊在一起）')
  check(fgOf(html, '{') === TEAL, '{ → 青', fgOf(html, '{'))
  check(fgOf(html, '}') === TEAL, '} → 青', fgOf(html, '}'))
  check(fgOf(html, '=') === RED2, '= → 橙红（keyword.operator）', fgOf(html, '='))
  check(fgOf(html, '2') === ORANGE, '数字 2 → 橙（constant.numeric）', fgOf(html, '2'))
  check(fgOf(html, 'hbar') === PURPLE, '\\hbar → 紫（keyword.other.math.symbol）', fgOf(html, 'hbar'))
  check(fgOf(html, 'm') === FG, '标识符 m → 正文色', fgOf(html, 'm'))
  const mPiece = pieces(html).find((p) => p.text === 'm')
  check(mPiece !== undefined && mPiece.fs.includes('italic'), '标识符是斜体（markup.italic.math）')
}

{
  /* 自定义宏 \zh{...}：花括号**统一青**，这正是之前白掉的那个 */
  const html = t.renderTexHtml('\\bi \\zh{频率与角频率}: $E=h\\nu$')
  const ps = pieces(html)
  check(ps[0].fg === TEAL && ps[0].text === '\\', '\\bi 的反斜杠 → 青')
  check(ps[1].fg === BLUE && ps[1].text === 'bi', 'bi → 蓝（support.function.general）')
  const braces = ps.filter((p) => p.text === '{' || p.text === '}')
  check(braces.length === 2 && braces.every((p) => p.fg === TEAL),
    '\\zh{ 的花括号也是青（不再跟随命令色）', braces.map((p) => p.fg).join(' '))
  check(fgOf(html, 'nu') === PURPLE, '数学内置 \\nu → 紫')
  check(fgOf(html, 'E') === FG, '数学标识符 E → 正文色')
}

{
  /* 文本模式的 \\begin / \\label → 紫（keyword.control.*） */
  const html = t.renderTexHtml('\\begin{summarybox}[title={x}]\\label{ch:y}')
  check(fgOf(html, 'begin') === PURPLE, '\\begin → 紫', fgOf(html, 'begin'))
  check(fgOf(html, 'label') === PURPLE, '\\label → 紫', fgOf(html, 'label'))
}

{
  /* 转义与结构 */
  const html = t.renderTexHtml('a<b & c\nd')
  check(html.includes('&lt;') && html.includes('&amp;'), 'HTML 转义（< 和 &）')
  check((html.match(/<span class="line">/g) || []).length === 2, '两行 → 两个 .line（行号靠它画）', String((html.match(/<span class="line">/g) || []).length))
  check(html.includes('\n'), '行间有换行文本节点')
}

{
  /* 注释 */
  const html = t.renderTexHtml('% 这是注释')
  check(fgOf(html, '% 这是注释') === '#A6ACB9', '注释 → blue6 灰', fgOf(html, '% 这是注释'))
}

/* ------------------------------------------------------------------ *
 * D. 渲染层挂载：不动宿主的 DOM
 * ------------------------------------------------------------------ */

console.log('  D. 渲染层挂载')

{
  const original = makeEl('code', '\\bi \\zh{频率与角频率}: $E=h\\nu$')
  const pre = makeEl('pre')
  pre._classes.add('shiki')
  pre.appendChild(original)
  const dom = createFakeDom([pre])
  const mod2 = loadPlugin(dom)
  const theme = {
    ctx: { on: () => () => {} },
    getTheme: () => ({ active: { colorScheme: 'dark', tokens: {} }, preference: 'dark', revision: 1 }),
    overrideTokens: () => () => {},
  }
  mod2.apply({
    effect(f) { f() }, on: () => () => {},
    get: (n) => (n === 'theme' ? theme : undefined), theme,
  })

  check(pre._classes.has('dmt-latex'), '块被标记 dmt-latex')
  check(original._classes.has('dmt-tex-hidden'), '宿主原本的 <code> 被隐藏（但仍在 DOM 里）')
  const layer = pre.children.find((c) => c._classes.has('dmt-tex-layer'))
  check(layer !== undefined, '追加了我们自己的渲染层')
  check(layer !== undefined && layer.innerHTML.includes('color:#5FB4B4'), '层里有青色的反斜杠')
  check(original.textContent === '\\bi \\zh{频率与角频率}: $E=h\\nu$', '宿主节点的文本**原封不动**（React 可以继续更新它）')

  /* 宿主内容变了（模拟流式/重渲染）→ 层要跟着重画 */
  const before = layer.innerHTML
  original.textContent = '\\chapter{新标题}'
  t.syncTexLayer(pre, '\\chapter{新标题}')
  check(layer.innerHTML !== before, '原文变了 → 层重画')
  check(layer.innerHTML.includes('chapter'), '新内容进了层')

  /* 卸载 → 恢复宿主显示 */
  t.disposeTexLayer(pre)
  check(pre.children.every((c) => !c._classes.has('dmt-tex-layer')), '卸载后渲染层已移除')
  check(!original._classes.has('dmt-tex-hidden'), '卸载后宿主 <code> 恢复显示')
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
