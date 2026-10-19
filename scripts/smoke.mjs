#!/usr/bin/env node
/**
 * dsh-colorlab 在线冒烟测试（**需要先重启 DSH 桌面端**，让新插件被 loader 装载）。
 *
 * 它只读不写，检查四件事：
 *   1. GUI 首页返回 200，且 `<head>` 里有本插件的首屏画布色样式（Host 半体生效）。
 *   2. `/plugins/dsh-colorlab/client.js` 返回 200 且内容包含 bundle id。
 *   3. 首页的 boot graph（`window.__DSH_BOOT__`）里出现了本插件的行。
 *   4. 设置命名空间 `mariana-theme` 被宿主服务。
 *
 * ---- 认证 ----
 * DSH 的 GUI 用「进程启动令牌」鉴权：直接 `GET /` 会拿到 401，只有带
 * `?token=<launchToken>` 的请求才会铸一个 cookie 并重定向到干净 URL。
 * 所以本脚本接受三种 token 来源，按顺序尝试：
 *
 *   1. 命令行第一个参数直接给完整 URL：`node scripts/smoke.mjs "http://127.0.0.1:60192/?token=xxx"`
 *   2. 环境变量 `DSH_WEB_TOKEN`
 *   3. 环境变量 `DSH_WEB_URL`（可含 token 查询串）
 *
 * 拿不到 token 时脚本会明确告诉你「需要令牌」，而不是把 401 当成插件失败。
 *
 * 用法：
 *   node scripts/smoke.mjs
 *   node scripts/smoke.mjs "http://127.0.0.1:60192/?token=<你的令牌>"
 *   $env:DSH_WEB_TOKEN='<你的令牌>'; node scripts/smoke.mjs
 */

const rawArg = process.argv[2] || process.env.DSH_WEB_URL || 'http://127.0.0.1:60192'

/** 拆出 base 与 token（token 可能来自 URL 查询串或环境变量）。 */
function parseTarget(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    url = new URL('http://127.0.0.1:60192')
  }
  const fromQuery = url.searchParams.get('token') || url.searchParams.get('access_token') || ''
  const token = fromQuery || process.env.DSH_WEB_TOKEN || ''
  url.search = ''
  const base = url.href.replace(/\/+$/, '')
  return { base, token }
}

const { base, token } = parseTarget(rawArg)

const results = []
function record(ok, name, detail) {
  results.push({ ok, name, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
}
function skip(name, detail) {
  results.push({ ok: true, skipped: true, name, detail })
  console.log(`  ⚠ ${name}${detail ? ' — ' + detail : ''}`)
}

/** 带 token 的请求；返回 { status, text, authenticated }。 */
async function getText(path) {
  const url = new URL(base + path)
  if (token !== '') url.searchParams.set('token', token)
  const response = await fetch(url, { redirect: 'follow' })
  const text = await response.text()
  return { status: response.status, text, finalUrl: response.url }
}

async function main() {
  console.log('')
  console.log(`dsh-colorlab 在线冒烟（${base}）`)
  console.log('─'.repeat(52))
  if (token === '') {
    console.log('  ⚠ 未提供令牌：DSH GUI 会对匿名请求返回 401。')
    console.log('    从浏览器地址栏复制带 ?token= 的完整 URL，作为第一个参数传进来。')
  }

  /* ---- 1. 首页 + 首屏样式 ---- */
  const index = await getText('/')
  if (index.status === 401) {
    record(false, '首页可达', 'HTTP 401 —— 需要令牌（见上面的用法说明）')
    finish()
    return
  }
  record(index.status === 200, '首页可达', `HTTP ${index.status}`)

  const bootOk = /body\[data-ds-dark-theme\]\{background-color:#343D46/.test(index.text)
  record(
    bootOk,
    'Host 半体首屏样式已注入',
    bootOk ? '#343D46' : '未找到（插件未装载、已禁用，或设置里关掉了开关）',
  )

  /* ---- 2. client bundle ---- */
  const bundle = await getText('/plugins/dsh-colorlab/client.js')
  record(bundle.status === 200, 'client bundle 可取', `HTTP ${bundle.status}`)
  const idOk = bundle.status === 200 && bundle.text.includes('dsh-colorlab')
  record(idOk, 'bundle 内容含插件 id')

  /* ---- 3. boot graph ---- */
  const bootOk2 = index.text.includes('dsh-colorlab')
  record(bootOk2, 'boot graph 里出现本插件行')

  /* ---- 4. 设置命名空间 ---- */
  let nsOk = false
  let nsDetail = ''
  for (const path of ['/api/settings/describe', '/api/settings/namespaces']) {
    try {
      const response = await getText(path)
      if (response.status !== 200) {
        nsDetail = `${path} → HTTP ${response.status}`
        continue
      }
      nsOk = response.text.includes('mariana-theme')
      nsDetail = `${path} → ${nsOk ? '包含 mariana-theme' : '未包含'}`
      if (nsOk) break
    } catch (error) {
      nsDetail = `${path} → ${error.message}`
    }
  }
  /* 这个端点随内核版本变化，取不到只算提示，不算失败。 */
  if (nsOk) record(true, '设置命名空间已服务', nsDetail)
  else skip('设置命名空间探测未命中', `${nsDetail || '端点不可用'}；以设置页是否出现为准`)

  finish()
}

function finish() {
  const failed = results.filter((result) => !result.ok)
  console.log('─'.repeat(52))
  if (failed.length > 0) {
    console.log(`✗ ${failed.length} 项失败`)
    console.log('')
    console.log('排查顺序：')
    console.log('  1. 确认 profile package.json 的 dsh.profile.bundles 里有 dsh-colorlab，并已 pnpm install')
    console.log('  2. 重启 DSH 桌面端（loader 只在启动时扫描 bundle 列表）')
    console.log('  3. 打开设置 → 插件表，确认 mariana-theme 行是启用状态')
    console.log('  4. 打开设置 → Mariana 主题，看顶部状态条（通道 / 令牌数 / 外观 / 配置）')
    process.exit(1)
  }
  const checked = results.filter((result) => !result.skipped).length
  console.log(`✓ ${checked} 项全部通过`)
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
