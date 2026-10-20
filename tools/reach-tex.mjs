import fs from 'node:fs'

const g = JSON.parse(fs.readFileSync(new URL('./tex-grammar.json', import.meta.url), 'utf8'))
const C = g.contexts

/* 从 main 做 BFS，算每个 context 的最短 include 深度 */
const depth = new Map([['main', 0]])
const q = ['main']
while (q.length > 0) {
  const name = q.shift()
  const body = C[name]
  if (!Array.isArray(body)) continue
  for (const p of body) {
    if (p === null || typeof p !== 'object') continue
    let target = null
    if (typeof p.include === 'string') {
      const s = p.include
      if (s.charCodeAt(0) === 35) target = s.slice(1)
      else if (s === '$self' || s === '$base') target = 'main'
      else if (s.startsWith('scope:') || s.startsWith('Packages/')) continue
      else target = s
    } else if (typeof p.push === 'string') target = p.push
    else if (typeof p.set === 'string') target = p.set
    else if (Array.isArray(p.push)) target = p.push[0]
    if (target === null || !C[target]) continue
    const d = depth.get(name) + 1
    if (!depth.has(target) || depth.get(target) > d) {
      depth.set(target, d)
      q.push(target)
    }
  }
}

console.log('从 main 可达的 context 数:', depth.size, '/', Object.keys(C).length)
const want = ['inline-math', 'inline-math-dollar-body', 'math-content', 'math-builtin',
  'general-commands', 'brace-group-end', 'sections', 'section-commands', 'label-commands',
  'begin-end-commands', 'math-greeks', 'math-variables']
for (const w of want) {
  console.log(`  ${w.padEnd(28)} ${depth.has(w) ? '深度 ' + depth.get(w) : '✗ 不可达'}${C[w] ? '' : '（context 不存在）'}`)
}
const unreachable = Object.keys(C).filter((k) => !depth.has(k.name))
console.log('\n不可达的 context（前 40）:')
console.log(' ', Object.keys(C).filter((k) => !depth.has(k)).slice(0, 40).join(', '))

/* inline-math 到底在哪被 include */
console.log('\n谁 include 了 inline-math:')
for (const [name, body] of Object.entries(C)) {
  if (!Array.isArray(body)) continue
  for (const p of body) {
    if (p && p.include === 'inline-math') console.log('  ', name)
  }
}
