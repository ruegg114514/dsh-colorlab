#!/usr/bin/env node
/**
 * LaTeX 代码块命令色的回归测试。
 *
 * 背景：Shiki 的 `css-variables` 主题把 `support.function`（LaTeX 命令）和
 * `entity.name.function`（JS/Python 函数名）合并成同一个 `function` 令牌，
 * 而 Sublime 的 Mariana 给它们不同颜色：
 *
 *   support.function    → var(blue)  = #6699CC 蓝   ← LaTeX 命令
 *   entity.name.function → var(blue5) = #5FB3B3 青   ← 其它语言的函数名
 *
 * 一个令牌只能一个颜色，所以插件改成：**只给 LaTeX 代码块**换掉 function 令牌。
 * 这套件验证「哪些块被判定为 LaTeX」这个判定逻辑。
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

const { isLatexBlock, LATEX_BLOCK_CLASS, LATEX_FUNCTION_COLOR, PALETTE } = loadPlugin().__test

check(typeof isLatexBlock === 'function', 'isLatexBlock 已导出')
check(typeof LATEX_BLOCK_CLASS === 'string' && LATEX_BLOCK_CLASS.length > 0, 'LATEX_BLOCK_CLASS 已声明', LATEX_BLOCK_CLASS)

/* LaTeX 命令色必须是 Mariana 的 var(blue)（Sublime 里 support.function 的色）。 */
check(
  LATEX_FUNCTION_COLOR === '#6699CC',
  'LaTeX 命令色 = Mariana var(blue) #6699CC',
  LATEX_FUNCTION_COLOR,
)
check(
  PALETTE && PALETTE.blue === LATEX_FUNCTION_COLOR,
  '与 PALETTE.blue 一致（同一个色源）',
  PALETTE ? PALETTE.blue : 'n/a',
)

/* ------------------------------------------------------------------ *
 * 造一个最小的 DOM 替身
 * ------------------------------------------------------------------ */

/**
 * 造一个假的 pre 元素：它按 `spans` 列表返回 querySelectorAll 的结果。
 * 每个 span 是 { text, style }，style 里含 --shiki-token-function 就算命中。
 */
function fakePre(spans) {
  const matched = spans.filter((span) => span.style && span.style.includes('--shiki-token-function'))
  return {
    textContent: spans.map((span) => span.text).join(''),
    querySelectorAll(selector) {
      if (selector !== 'span[style*="--shiki-token-function"]') return []
      /* 真实 DOM 里查到的是元素，有 textContent；替身要还原这一点。 */
      return matched.map((span) => ({ textContent: span.text }))
    },
  }
}

const FN = 'color:var(--shiki-token-function)'

/* ---- LaTeX 代码块：命令名以 \ 开头 ---- */
const latexPre = fakePre([
  { text: '\\chapter', style: FN },
  { text: '{', style: 'color:var(--shiki-token-punctuation)' },
  { text: '从经典到量子', style: 'color:var(--shiki-token-foreground)' },
  { text: '}', style: 'color:var(--shiki-token-punctuation)' },
  { text: '\\begin', style: FN },
  { text: '{roadmapbox}', style: 'color:var(--shiki-token-constant)' },
  { text: '\\frac', style: FN },
  { text: '\\ket', style: FN },
  { text: '\\label', style: FN },
  { text: '{ch:x}', style: 'color:var(--shiki-token-constant)' },
])
check(isLatexBlock(latexPre) === true, 'LaTeX 块被判定为 LaTeX')

/* ---- JavaScript：函数名不以 \ 开头 ---- */
const jsPre = fakePre([
  { text: 'const', style: 'color:var(--shiki-token-keyword)' },
  { text: ' answer', style: 'color:var(--shiki-token-foreground)' },
  { text: ' = ', style: 'color:var(--shiki-token-punctuation)' },
  { text: 'compute', style: FN },
  { text: '(x)', style: 'color:var(--shiki-token-punctuation)' },
  { text: ' => x * 2', style: 'color:var(--shiki-token-foreground)' },
])
check(isLatexBlock(jsPre) === false, 'JavaScript 块不被判定为 LaTeX')

/* ---- Python：函数名同样不以 \ 开头 ---- */
const pyPre = fakePre([
  { text: 'def', style: 'color:var(--shiki-token-keyword)' },
  { text: ' solve', style: FN },
  { text: '(a, b):', style: 'color:var(--shiki-token-punctuation)' },
  { text: ' return a + b', style: 'color:var(--shiki-token-foreground)' },
])
check(isLatexBlock(pyPre) === false, 'Python 块不被判定为 LaTeX')

/* ---- 没有 function span 的块（纯文本 / 未高亮）---- */
const plainPre = fakePre([
  { text: 'hello world', style: 'color:var(--shiki-token-foreground)' },
])
check(isLatexBlock(plainPre) === false, '无 function span 的块不被判定为 LaTeX')

/* ---- 少数派：只有 1 个 \ 开头，其余是普通函数名 → 不判定 ---- */
const mixedPre = fakePre([
  { text: '\\n', style: FN },
  { text: 'compute', style: FN },
  { text: 'render', style: FN },
  { text: 'update', style: FN },
  { text: 'fetch', style: FN },
])
check(isLatexBlock(mixedPre) === false, '少数派 \\ 开头不误判（JS 续行符）')

/* ---- 边界：null / 无 querySelectorAll ---- */
check(isLatexBlock(null) === false, 'null → false')
check(isLatexBlock({}) === false, '无 querySelectorAll → false')

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
