import fs from 'node:fs'

const grammar = JSON.parse(fs.readFileSync(new URL('./tex-grammar.json', import.meta.url), 'utf8'))

console.log('contexts:', Object.keys(grammar.contexts).length)
console.log('main:', JSON.stringify(grammar.contexts.main)?.slice(0, 400))
console.log()
console.log('latex 前 6 条:')
for (const p of (grammar.contexts.latex || []).slice(0, 6)) {
  console.log('  ', JSON.stringify(p).slice(0, 220))
}
console.log()
console.log('prototype:', JSON.stringify(grammar.contexts.prototype)?.slice(0, 300))

/* 在 pos 0 上手工试 main / latex / prototype 的每条 pattern */
const text = '\\bi \\zh{频率与角频率}: $E=h\\nu=\\hbar\\omega$。'
console.log('\n样本:', JSON.stringify(text))

for (const ctxName of ['main', 'latex', 'prototype']) {
  const body = grammar.contexts[ctxName]
  if (!Array.isArray(body)) { console.log(ctxName, '不存在'); continue }
  console.log(`\n--- ${ctxName}（${body.length} 条）在 pos 0 的匹配 ---`)
  let n = 0
  for (const p of body) {
    if (typeof p.include === 'string') { if (n < 6) console.log('   include:', p.include); n += 1; continue }
    if (p.match === undefined) { if (n < 6) console.log('   指令:', JSON.stringify(p).slice(0, 120)); n += 1; continue }
    let re = null
    let err = ''
    try { re = new RegExp(p.match, 'dy') } catch (e) { try { re = new RegExp(p.match, 'y') } catch (e2) { err = e2.message } }
    if (re === null) { console.log('   ✗ 编译失败:', err, '|', p.match.slice(0, 80)); n += 1; continue }
    re.lastIndex = 0
    const m = re.exec(text)
    if (n < 12) console.log(`   ${m ? '✓ ' + JSON.stringify(m[0]) : '·'}  ${p.match.slice(0, 70)}  → ${p.scope || (p.captures ? JSON.stringify(p.captures) : '')}`)
    n += 1
  }
}
