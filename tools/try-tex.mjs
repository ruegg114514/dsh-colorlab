import fs from 'node:fs'
import { tokenize } from './tex-tokenizer.mjs'

const grammar = JSON.parse(fs.readFileSync(new URL('./tex-grammar.json', import.meta.url), 'utf8'))

const samples = [
  ['第 8 行', '$\\hH=-\\frac{\\hbar^2}{2m}\\lap-\\frac{e^2}{r}$? 那个 $\\lap$ 是天上掉下来的吗？'],
  ['第 234 行', '\\bi \\zh{频率与角频率}: $E=h\\nu=\\hbar\\omega$，其中 $\\omega=2\\pi\\nu$。'],
  ['第 235 行', '记清楚这个 $\\hbar$ 就是为了吞掉 $2\\pi$。'],
  ['章节+环境', '\\chapter{从经典到量子}\\label{ch:whyquant}'],
]

for (const [label, text] of samples) {
  console.log('='.repeat(70))
  console.log(label, '→', JSON.stringify(text))
  const t0 = Date.now()
  const { tokens, broken } = tokenize(text, grammar)
  const ms = Date.now() - t0
  console.log(`token 数 ${tokens.length}，耗时 ${ms}ms，正则编译失败 ${broken.length} 条`)
  for (const b of broken.slice(0, 3)) console.log('   ✗', b.message, '|', b.pattern.slice(0, 70))
  for (const tk of tokens) {
    const piece = text.slice(tk.start, tk.end)
    /* 只显示最具体的两三层 scope，太长看不清 */
    const sc = tk.scopes.slice(-3).join(' ')
    console.log(`   ${JSON.stringify(piece).padEnd(22)} ${sc}`)
  }
  console.log()
}
