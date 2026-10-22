#!/usr/bin/env node
/**
 * 手绘造型（shape）测试 —— 抄自 dsh-maid-whale-UI，只抄机制不抄美术。
 *
 * 不变量：
 *   1. 独立总闸 html[data-dsh-shape]，关掉整表消失（零残留）；
 *   2. 每条规则都带总闸前缀（纸影那条带的是"玻璃没开"的条件前缀，也算）；
 *   3. 四件事都在：不规则圆角（四角不同值）、纸影（硬+软两层）、
 *      悬停微抬、侧栏分界线（渐变 + pointer-events:none）；
 *   4. 与玻璃互不依赖：shape=on + glass=off 时表照常出；
 *      纸影只在玻璃关时生效（避免和玻璃投影打架）；
 *   5. 括号平衡（glass.test 的 I 节教训：拼字符串的表必须整体验）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(condition, label, detail) {
  if (condition) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function loadPlugin() {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: { load: (d) => { captured = d } },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
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
    fakeWindow, undefined, fakeRequire, () => ({ unref() {} }),
  )
  if (captured === null) throw new Error('client.js 没有注册 bundle')
  return captured.factory(fakeRequire)
}

const t = loadPlugin().__test
const { buildShapeSheet, SHAPE_ATTR, GLASS_ATTR } = t
const src = readFileSync(join(root, 'client.js'), 'utf8')

const dark = { base: '#343D46', sidebar: '#2E363F', layer1: '#3B444D', layer2: '#424B55', layer3: '#49525C', overlay: '#1E242A', bubble: '#3B444D' }
const targets = [
  { defClass: 'kuvljq_card', varName: '--changes-fill', hoverVar: '--changes-hover' },
  { defClass: 'flL80G_root', varName: '--deliverable-fill', hoverVar: '--deliverable-hover' },
]

console.log('')
console.log('dsh-colorlab 手绘造型测试')
console.log('─'.repeat(60))

/* A. 开关与总闸 */
console.log('  A. 开关与总闸')
check(buildShapeSheet({ shape: 'off' }, dark, true) === '', 'shape=off → 空串')
check(SHAPE_ATTR === 'data-dsh-shape', '总闸属性名', SHAPE_ATTR)
check(t.SHAPE_SHEET_ID === 'dsh-colorlab/shape.css', '表 id', t.SHAPE_SHEET_ID)

const css = buildShapeSheet({ shape: 'on' }, dark, true, targets)
const lines = css.split('\n').filter((l) => l.includes('{') && !l.startsWith('/*'))
check(lines.length >= 10, '规则数量合理', String(lines.length) + ' 条')
check(lines.every((l) => l.includes('[' + SHAPE_ATTR + ']')),
  '每条规则都带总闸前缀', lines.length + ' 条')

/* B. 四件抄来的事 */
console.log('  B. 四件事')
/* ① 不规则圆角：四角值互不相同 */
const radiusLines = lines.filter((l) => /border-radius:(\d+)px (\d+)px (\d+)px (\d+)px/.test(l))
check(radiusLines.length >= 6, '① 不规则圆角覆盖 6+ 类表面', String(radiusLines.length))
{
  const m = /border-radius:(\d+)px (\d+)px (\d+)px (\d+)px/.exec(radiusLines[0])
  const vals = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  check(new Set(vals).size === 4 && Math.max(...vals) - Math.min(...vals) <= 4,
    '四角互不相同且差 ≤4px（手绘感不是锯齿感）', vals.join('/'))
}
check(radiusLines.some((l) => l.includes('RlGAzG_card')), '输入卡有圆角')
check(radiusLines.some((l) => l.includes('[role="dialog"]')), '对话框有圆角')
check(radiusLines.some((l) => l.includes('.md-code-block')), '代码块有圆角')
check(radiusLines.some((l) => l.includes('.kuvljq_card')) && radiusLines.some((l) => l.includes('.flL80G_root')),
  '检测到的卡片类有圆角（cardTargets 传入生效）')
/* ② 纸影：硬+软两层，且带"玻璃没开"的条件 */
{
  const shadowLine = lines.find((l) => l.includes('box-shadow:1px 2px'))
  check(shadowLine !== undefined, '② 纸影存在（硬垫影 1px 2px 0 + 软散影）')
  check(shadowLine !== undefined && shadowLine.includes('[' + SHAPE_ATTR + ']:not([' + GLASS_ATTR + '])'),
    '纸影只在玻璃关闭时生效（不与玻璃投影打架），且带 shape 总闸')
}
/* ③ 微抬 */
check(lines.some((l) => /button:hover:not\(:disabled\)\{transform:translateY\(-1px\)/.test(l)),
  '③ 按钮悬停微抬 -1px')
check(lines.some((l) => l.includes('RlGAzG_card"]:focus-within') && l.includes('translateY(-1px)')),
  '③ 输入卡聚焦微抬')
/* ④ 分界线 */
{
  const seam = lines.find((l) => l.includes('_sidebarCol"]::after'))
  check(seatOk(seam), '④ 侧栏右缘渐变分界线（两端渐隐）')
  function seatOk(l) {
    return l !== undefined && l.includes('linear-gradient') && l.includes('pointer-events:none')
      && l.includes('width:1px')
  }
  const kill = lines.find((l) => l.includes('_sidebarCol"]{') && l.includes('border-right:0'))
  check(kill !== undefined, '④ 宿主原 border-right 被清（避免双线）')
  const pos = lines.find((l) => l.includes('_sidebarCol"]{position:relative'))
  check(pos !== undefined, '④ sidebarCol 补 position:relative（::after 定位前提）')
}

/* C. 与玻璃独立 + 深浅 */
console.log('  C. 独立性与深浅')
check(buildShapeSheet({ shape: 'on', glass: 'off' }, dark, true, targets).includes('RlGAzG_card'),
  '玻璃关时造型表照常出（互相独立）')
const lightCss = buildShapeSheet({ shape: 'on' }, { base: '#FFFFFF' }, false, targets)
check(lightCss.includes('rgba(92, 110, 113') && !lightCss.includes('rgba(0, 0, 0, 0.28)'),
  '浅色下纸影/分界线换成墨蓝色系')

/* D. 结构合法（glass.test I 节同款教训） */
console.log('  D. 结构合法')
{
  const variants = [
    [{ shape: 'on' }, dark, true, targets],
    [{ shape: 'on' }, { base: '#FFFFFF' }, false, []],
    [{ shape: 'on' }, dark, true, undefined],
  ]
  let bad = 0
  for (const [st, sf, dk, tg] of variants) {
    const out = buildShapeSheet(st, sf, dk, tg)
    if ((out.match(/{/g) || []).length !== (out.match(/}/g) || []).length) bad += 1
    for (const ln of out.split('\n')) {
      if (!ln.includes('{') || ln.startsWith('/*')) continue
      if ((ln.match(/{/g) || []).length !== (ln.match(/}/g) || []).length) bad += 1
    }
    if (out.includes('undefined')) bad += 1
  }
  check(bad === 0, '三种参数：逐行闭合、总数平衡、无 undefined', bad + ' 处异常')
}

/* E. 接线完整性（源码级锁） */
console.log('  E. 接线')
check(/syncGlassSheet\(\)[\s\S]{0,300}syncShapeSheet\(\)/.test(src),
  'applyNowOnce 在玻璃之后同步造型（纸影规则要看玻璃状态）')
check(/teardown shape sheet/.test(src) && /removeAttribute\(SHAPE_ATTR\)/.test(src),
  '卸载时摘表 + 摘总闸')
check(/shape: 'off'/.test(src) && /shape: str\(FIELD_DEFAULTS\.shape\)/.test(
  readFileSync(join(root, 'index.js'), 'utf8')),
  '双半体都有 shape 字段（Host schema 不落则无法落盘）')
check(src.includes("title: '手绘造型'"), '设置页有开关行')

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
