import fs from 'node:fs'
import { tokenize } from './tex-tokenizer.mjs'
import { makeColorizer } from './tex-colors.mjs'

const grammar = JSON.parse(fs.readFileSync(new URL('./tex-grammar.json', import.meta.url), 'utf8'))
const scheme = JSON.parse(fs.readFileSync(new URL('./mariana-colors.json', import.meta.url), 'utf8'))
const styleOf = makeColorizer(scheme)

let bad = 0
function expect(scopes, wantFg, wantFs, label) {
  const got = styleOf(scopes)
  const ok = got.fg === wantFg && (wantFs === undefined || got.fs === wantFs)
  if (!ok) bad += 1
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(38)} ${got.fg}${got.fs ? ' [' + got.fs + ']' : ''}` +
    (ok ? '' : `   期望 ${wantFg}${wantFs ? ' [' + wantFs + ']' : ''}`))
}

console.log('=== A. 直接拿 scope 栈核对（对照 Mariana 的规则表）===')
const T = 'text.tex.latex'
expect([T, 'support.function.general.latex'], '#6699CC', 'italic', '命令名 → support.function 蓝')
expect([T, 'support.function.section.latex'], '#6699CC', 'italic', '\\chapter → 蓝斜')
expect([T, 'punctuation.definition.backslash.latex'], '#5FB4B4', '', '反斜杠 → punctuation.definition 青')
expect([T, 'punctuation.definition.group.brace.begin.tex'], '#5FB4B4', '', '花括号 → 青')
expect([T, 'punctuation.definition.group.brace.end.tex'], '#5FB4B4', '', '闭花括号 → 青')
expect([T, 'string.other.math.tex', 'punctuation.definition.string.begin.tex'], '#5FB4B4', '', '$ → 青（压过 string 的绿）')
expect([T, 'keyword.other.math.greek.tex'], '#C695C6', '', '数学内置 \\nu → keyword 紫')
expect([T, 'keyword.other.math.symbol.tex'], '#C695C6', '', '数学内置 \\hbar → 紫')
expect([T, 'keyword.control.flow.begin.latex'], '#C695C6', '', '\\begin → 紫')
expect([T, 'keyword.operator.comparison.tex'], '#F97B58', '', '= → keyword.operator 橙红')
expect([T, 'keyword.operator.arithmetic.tex'], '#F97B58', '', '+ → 橙红')
expect([T, 'constant.numeric.value.tex'], '#F9AE58', '', '数字 → 橙')
expect([T, 'variable.other.math.tex', 'markup.italic.math.tex'], '#D8DEE9', 'italic', '数学标识符 → 前景色+斜体')
expect([T, 'support.function.math.tex'], '#6699CC', 'italic', '自定义数学宏 → 蓝')
expect([T, 'entity.name.section.latex'], '#D8DEE9', '', '章节标题 → 被排除，落到前景')
expect([T, 'variable.parameter.function.latex'], '#F9AE58', '', '环境名 → variable.parameter 橙')
expect([T, 'comment.line.percentage.latex'], '#A6ACB9', '', '注释 → blue6 灰')
expect([T], '#D8DEE9', '', '纯正文 → 前景')
expect([T, 'punctuation.separator.superscript.tex'], '#A6ACB9', '', '^ → punctuation.separator 灰')

console.log('\n=== B. 端到端：真机上那段，逐 token 上色 ===')
const text = '$\\hH=-\\frac{\\hbar^2}{2m}\\lap-\\frac{e^2}{r}$? 那个 $\\lap$ 是天上掉下来的吗？'
const { tokens } = tokenize(text, grammar)
for (const tk of tokens) {
  const st = styleOf(tk.scopes)
  const piece = text.slice(tk.start, tk.end)
  console.log(`  ${JSON.stringify(piece).padEnd(12)} ${st.fg}${st.fs ? ' [' + st.fs + ']' : ''}`)
}

const text2 = '\\bi \\zh{频率与角频率}: $E=h\\nu=\\hbar\\omega$'
console.log('\n=== C. 第 234 行 ===')
for (const tk of tokenize(text2, grammar).tokens) {
  const st = styleOf(tk.scopes)
  console.log(`  ${JSON.stringify(text2.slice(tk.start, tk.end)).padEnd(16)} ${st.fg}${st.fs ? ' [' + st.fs + ']' : ''}`)
}

console.log('')
if (bad > 0) { console.log(`✗ ${bad} 项颜色不符`); process.exit(1) }
console.log('✓ 颜色规则全部符合 Mariana')
