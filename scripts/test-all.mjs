#!/usr/bin/env node
/**
 * 一次跑完全部离线校验（不需要重启 DSH）。
 *
 *   node scripts/test-all.mjs            # 普通 node
 *   node scripts/test-all.mjs --electron # 用 DSH 自带 Electron 跑（会额外验证 Config schema）
 *
 * 退出码 0 = 全绿。
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const useElectron = process.argv.includes('--electron')

/** 找一个能跑 ESM 的 Electron 可执行文件（DSH 桌面端自带）。 */
function findElectron() {
  const candidates = [
    process.env.DSH_ELECTRON,
    'D:\\dsh\\DeepSeek Harness.exe',
    join(process.env.LOCALAPPDATA || '', '@deepseek-ai', 'dsh-desktop', 'DeepSeek Harness.exe'),
  ].filter((value) => typeof value === 'string' && value !== '')
  return candidates.find((candidate) => existsSync(candidate)) || null
}

const suites = [
  { name: '语法检查 index.js', args: ['--check', join(root, 'index.js')], node: true },
  { name: '语法检查 client.js', args: ['--check', join(root, 'client.js')], node: true },
  { name: '静态校验（令牌/对比度/覆盖）', args: [join(here, 'verify.mjs')] },
  { name: '文件卡片检测（宿主真实 CSS）', args: [join(here, 'card.test.mjs')] },
  { name: 'LaTeX 代码块判定', args: [join(here, 'latex.test.mjs')] },
  { name: '运行时行为', args: [join(here, 'runtime.test.mjs')] },
  { name: '自定义配色与配色方案', args: [join(here, 'custom.test.mjs')] },
  { name: '设置页渲染与交互', args: [join(here, 'page.test.mjs')] },
  { name: '持久化契约', args: [join(here, 'contract.test.mjs')] },
  { name: '装载兼容性（宿主解析器语义）', args: [join(here, 'loader.test.mjs')] },
  { name: 'Host 半体', args: [join(here, 'host.test.mjs')] },
]

let failures = 0
for (const suite of suites) {
  console.log('')
  console.log('━'.repeat(56))
  console.log(`▶ ${suite.name}`)
  console.log('━'.repeat(56))

  let command
  let args
  let env = { ...process.env }

  if (suite.node || !useElectron) {
    command = process.execPath
    args = suite.args
  } else {
    const electron = findElectron()
    if (electron === null) {
      console.log('  ⚠ 找不到 Electron，退回普通 node')
      command = process.execPath
      args = suite.args
    } else {
      command = electron
      args = suite.args
      env.ELECTRON_RUN_AS_NODE = '1'
    }
  }

  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env })
  if (result.status !== 0) {
    failures += 1
    console.log(`  ✗ ${suite.name} 失败（exit ${result.status}）`)
  }
}

console.log('')
console.log('━'.repeat(56))
if (failures > 0) {
  console.log(`✗ ${failures}/${suites.length} 个套件失败`)
  process.exit(1)
}
console.log(`✓ ${suites.length}/${suites.length} 个套件全部通过`)
console.log('')
console.log('下一步：重启 DSH 桌面端，然后 node scripts/smoke.mjs')
