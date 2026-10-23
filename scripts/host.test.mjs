#!/usr/bin/env node
/**
 * dsh-colorlab Host 半体测试。
 *
 * 用假的 cordis ctx 跑 `apply()`，验证 `webserver/index-inject` 的注入内容：
 *   1. 开关为 on 时注入一条 style，选择器是 body[data-ds-dark-theme]。
 *   2. 开关为 off 时不注入。
 *   3. 配置以响应式引用（`.get()`）形式给出时也能正确读到。
 *   4. 没有 webserver 事件时 apply 不留任何副作用（不抛、不注册多余东西）。
 *   5. `Config` schema 在 Electron 运行时下能被 schemastery 解析出 5 个字段。
 *
 * 用法：
 *   node scripts/host.test.mjs              # 用普通 node 跑（Config 可能为 undefined，会跳过第 5 项）
 *   ELECTRON_RUN_AS_NODE=1 "D:\dsh\DeepSeek Harness.exe" scripts/host.test.mjs   # 完整
 */

import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const entry = pathToFileURL(join(root, 'index.js')).href

const results = []
function check(ok, name, detail) {
  results.push({ ok, name, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** 假 ctx：只实现 apply 用到的 on。 */
function createFakeCtx() {
  const handlers = new Map()
  return {
    on(event, handler) {
      const list = handlers.get(event) || []
      list.push(handler)
      handlers.set(event, list)
    },
    fire(event, ...args) {
      for (const handler of [...(handlers.get(event) || [])]) handler(...args)
    },
    count(event) {
      return (handlers.get(event) || []).length
    },
  }
}

/** 跑一次注入，返回 table。 */
async function runInject(apply, config) {
  const ctx = createFakeCtx()
  apply(ctx, config)
  const table = []
  ctx.fire('webserver/index-inject', table)
  return { ctx, table }
}

async function main() {
  console.log('')
  console.log('dsh-colorlab Host 半体测试')
  console.log('─'.repeat(52))

  /* 🔧 诊断文件测试的前置：把 profile 目录指到临时位置，**在 import 之前**。
   * index.js 的 `const Config = buildConfig()` 在模块加载时就跑完 ——
   * 纯 node 下 schemastery 必然解析失败，诊断文件应落在 DSH_PROFILE_DIR。 */
  const diagDir = join(root, '.tmp-host-diag')
  mkdirSync(diagDir, { recursive: true })
  const diagFile = join(diagDir, 'colorlab-diagnostic.json')
  try { rmSync(diagFile, { force: true }) } catch { /* 没有 */ }
  process.env.DSH_PROFILE_DIR = diagDir

  const mod = await import(entry)
  {
    const isElectron = typeof process.versions.electron === 'string'
    const exists = existsSync(diagFile)
    if (isElectron && mod.Config !== undefined) {
      /* Electron 下 schemastery 能解析 → Config 成功 → 诊断文件必须被清掉。 */
      check(!exists, '成功路径：诊断文件不存在（或被清除）')
    } else if (!isElectron) {
      check(exists, '失败路径：诊断文件已写入 profile 目录')
      if (exists) {
        try {
          const report = JSON.parse(readFileSync(diagFile, 'utf8'))
          check(report.plugin === 'dsh-colorlab' && report.reason === 'no-anchor-resolved',
            '报告含 plugin/reason', report.reason)
          check(Array.isArray(report.anchors) && report.anchors.length >= 3,
            '报告逐锚点轨迹（anchors）', String(report.anchors.length) + ' 个锚点')
          check(report.anchors.every((a) => typeof a.anchor === 'string' && Array.isArray(a.attempts)),
            '每个锚点有 anchor 与 attempts 明细')
          check(typeof report.hint === 'string' && report.hint.includes('schemastery'),
            '报告带人话 hint')
        } catch (error) {
          check(false, '报告可被 JSON.parse', String(error))
        }
      }
      /* 绝不污染插件目录本身。 */
      check(!existsSync(join(root, 'colorlab-diagnostic.json')),
        '诊断不落在插件目录（尊重 DSH_PROFILE_DIR）')
    }
  }
  try { rmSync(diagDir, { recursive: true, force: true }) } catch { /* 清不掉就算了 */ }
  delete process.env.DSH_PROFILE_DIR

  check(typeof mod.apply === 'function', 'apply 已导出')
  check(mod.SETTINGS_ENTRY === 'mariana-theme', 'SETTINGS_ENTRY = mariana-theme', mod.SETTINGS_ENTRY)
  check(mod.BOOT_BACKGROUND === '#343D46', 'BOOT_BACKGROUND = #343D46', mod.BOOT_BACKGROUND)
  check(mod.FIELD_DEFAULTS && Object.keys(mod.FIELD_DEFAULTS).length === 60, 'FIELD_DEFAULTS 有 60 个字段', String(Object.keys(mod.FIELD_DEFAULTS || {}).length))
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.shape === 'off', 'FIELD_DEFAULTS.shape = off（手绘造型默认关）', mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.shape)
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.prose === 'on', 'FIELD_DEFAULTS.prose = on（默认开正文高亮）')
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.proseBoost === 'soft', 'FIELD_DEFAULTS.proseBoost = soft（默认提亮一档）', mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.proseBoost)
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.proseColors === '', 'FIELD_DEFAULTS.proseColors = 空串（正文颜色跟随派生）')
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.summaryColor === '#FAC863', 'FIELD_DEFAULTS.summaryColor = 亮黄 #FAC863', mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.summaryColor)
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.cardColor === '', 'FIELD_DEFAULTS.cardColor = 空串（卡片头部跟随宿主）', JSON.stringify(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.cardColor))
  check(
    mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.rowVariants === '["write","edit","bash","summary","turn"]',
    'FIELD_DEFAULTS.rowVariants = 写入/编辑/运行命令 + 汇总行 + 本轮汇总',
    mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.rowVariants,
  )
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.custom === '', 'FIELD_DEFAULTS.custom = 空串（无自定义覆盖）')
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.presets === '', 'FIELD_DEFAULTS.presets = 空串（无已存方案）')
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.rowHighlight === 'on', 'FIELD_DEFAULTS.rowHighlight = on（默认开过程行高亮）')
  check(mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.rowColor === '#7EE787', 'FIELD_DEFAULTS.rowColor = 亮绿 #7EE787', mod.FIELD_DEFAULTS && mod.FIELD_DEFAULTS.rowColor)

  /* ---- 0. 字段防漂移：FIELD_DEFAULTS 与 Config schema 必须一一对应 ----
     这是根治"字段能改但存不进 profile"的断言：漏加 str(...) 时 Config 里
     就没有这个字段，DSH 投射不出表单、write() 也会拒绝 —— 而且不报错。
     纯读源码比对，不需要 Electron。 */
  {
    const source = readFileSync(join(root, 'index.js'), 'utf8')
    const defaultsBlock = /const FIELD_DEFAULTS = \{([\s\S]*?)\n\}/.exec(source)
    /* schema 块现在包在 try/catch 里（构造失败也要落诊断文件），锚定改跟
     * `z.object({` 本身，缩进放宽 —— 语义不变：字段仍须一一对应。 */
    const schemaBlock = /z\.object\(\{([\s\S]*?)\n\s*\}\)/.exec(source)
    check(defaultsBlock !== null, '能定位 FIELD_DEFAULTS 块')
    check(schemaBlock !== null, '能定位 Config schema 块')
    if (defaultsBlock !== null && schemaBlock !== null) {
      const declared = [...defaultsBlock[1].matchAll(/^\s*([A-Za-z]\w*):\s/gm)].map((m) => m[1])
      const wired = [...schemaBlock[1].matchAll(/^\s*([A-Za-z]\w*):\s*str\(/gm)].map((m) => m[1])
      const missing = declared.filter((name) => !wired.includes(name))
      const extra = wired.filter((name) => !declared.includes(name))
      check(missing.length === 0, 'FIELD_DEFAULTS 每个字段都进了 Config schema（否则无法落盘）', missing.join(', '))
      check(extra.length === 0, 'Config schema 没有多余字段', extra.join(', '))
      console.log(`  · 字段清单（${declared.length}）：${declared.join(', ')}`)
    }
  }

  /* ---- 1. 开关 on：注入一条 style ---- */
  {
    const { ctx, table } = await runInject(mod.apply, { enabled: 'on' })
    check(ctx.count('webserver/index-inject') === 1, '注册了 webserver/index-inject 处理器')
    check(table.length === 1, '开关 on → 注入 1 条', String(table.length))
    const row = table[0]
    check(row && row.kind === 'style', '注入的是 style 行', row ? row.kind : 'n/a')
    check(row && typeof row.text === 'string' && row.text.includes('body[data-ds-dark-theme]{'), '选择器 = body[data-ds-dark-theme]')
    /* 总闸：这条样式是烤进 HTML 的，运行时撤不掉，所以必须带一个能被客户端关掉的条件。
       少了它，用户关掉插件后界面底色会留在 Mariana。 */
    check(
      row && typeof row.text === 'string' && row.text.includes(`html:not([${mod.DISABLED_ATTR}])`),
      `总闸条件 html:not([${mod.DISABLED_ATTR}]) 存在`,
      mod.DISABLED_ATTR,
    )
    check(mod.DISABLED_ATTR === 'data-dsh-colorlab-off', '总闸属性名与客户端约定一致', mod.DISABLED_ATTR)
    check(row && row.text.includes('background-color:#343D46'), '画布色 = #343D46')
    check(row && row.text.includes('--dsh-boot-bg:#343D46'), '同步设置 --dsh-boot-bg')
    check(row && !row.text.includes('!important'), '不使用 !important（避免压掉客户端 inline 值）')
  }

  /* ---- 2. 开关 off：不注入 ---- */
  {
    const { table } = await runInject(mod.apply, { enabled: 'off' })
    check(table.length === 0, '开关 off → 不注入', String(table.length))
  }

  /* ---- 3. 响应式引用（.get()）---- */
  {
    const reactive = {
      enabled: { get: () => 'off' },
      schemeMode: { get: () => 'dark' },
    }
    const { table } = await runInject(mod.apply, reactive)
    check(table.length === 0, '响应式配置 .get() 读到 off → 不注入', String(table.length))

    const reactiveOn = { enabled: { get: () => 'on' } }
    const second = await runInject(mod.apply, reactiveOn)
    check(second.table.length === 1, '响应式配置 .get() 读到 on → 注入', String(second.table.length))
  }

  /* ---- 4. 无配置 / 无事件：不崩、不多注册 ---- */
  {
    const ctx = createFakeCtx()
    let threw = null
    try {
      mod.apply(ctx, undefined)
    } catch (error) {
      threw = error
    }
    check(threw === null, 'config 为 undefined 时不抛异常', threw ? threw.message : '')
    check(ctx.count('webserver/index-inject') === 1, '仍然只注册一个处理器')
    const table = []
    ctx.fire('webserver/index-inject', table)
    check(table.length === 1, 'config 缺失时按默认 on 注入', String(table.length))
  }

  /* ---- 5. Config schema（只在 Electron 运行时下可解析）---- */
  {
    const isElectron = typeof process.versions.electron === 'string'
    if (!isElectron) {
      console.log('  ⚠ 非 Electron 运行时，跳过 Config schema 检查（用 ELECTRON_RUN_AS_NODE=1 重跑可覆盖）')
    } else {
      check(mod.Config !== undefined, 'Config 已解析（schemastery 加载成功）')
      if (mod.Config !== undefined) {
        const dict = mod.Config.dict || {}
        const keys = Object.keys(dict)
        check(keys.length === 15, 'Config 有 15 个字段', keys.join(', '))
        for (const field of ['enabled', 'schemeMode', 'surface', 'accent', 'syntax', 'prose', 'proseBoost', 'proseColors', 'custom', 'presets', 'rowHighlight', 'rowColor', 'summaryColor', 'cardColor', 'rowVariants']) {
          check(keys.includes(field), `Config 含字段 ${field}`)
        }
        /* volatile 标记：没有它字段不可写（dsh-settings 的 write 会抛）。 */
        const volatileFields = Object.entries(dict).filter(([, schema]) => schema && schema.meta && schema.meta.volatile)
        check(volatileFields.length === 15, '15 个字段全部 volatile（可落盘）', String(volatileFields.length))
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * 🔧 2026-10-23：URL 壁纸（glassWallpaperUrl）
   * ---------------------------------------------------------------- */
  console.log('')
  console.log('URL 壁纸')
  {
    check(typeof mod.normalizeWallpaperUrl === 'function', 'normalizeWallpaperUrl 已导出')
    check(typeof mod.fetchWallpaperUrl === 'function', 'fetchWallpaperUrl 已导出')

    /* 1. 只接受 http / https —— 安全边界第一道。 */
    const n = mod.normalizeWallpaperUrl
    check(n('https://example.com/a.jpg') === 'https://example.com/a.jpg', 'https 通过')
    check(n('http://example.com/a.jpg') === 'http://example.com/a.jpg', 'http 通过')
    check(n('  https://example.com/a.jpg  ') === 'https://example.com/a.jpg', '去首尾空白')
    for (const bad of [
      'file:///C:/Windows/System32/config/SAM',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'ftp://example.com/a.jpg',
      'chrome://settings',
      '//example.com/a.jpg',
      'not a url',
      '',
      null,
      undefined,
      123,
      {},
    ]) {
      check(n(bad) === '', '拒绝非法来源：' + JSON.stringify(bad), JSON.stringify(n(bad)))
    }

    /* 2. 上限常量。 */
    check(mod.WALLPAPER_URL_MAX_BYTES === 24 * 1024 * 1024, '大小上限 24 MiB', String(mod.WALLPAPER_URL_MAX_BYTES))
    check(mod.WALLPAPER_URL_TIMEOUT === 8000, '超时 8 秒', String(mod.WALLPAPER_URL_TIMEOUT))

    /* 3. 源码层面的安全约束（行为测不到的部分）。 */
    const hostSrc = readFileSync(join(root, 'index.js'), 'utf8')
    const i = hostSrc.indexOf('async function fetchWallpaperUrl')
    const fn = hostSrc.slice(i, i + 2800)
    check(/AbortController/.test(fn) && /controller\.abort\(\)/.test(fn), '有超时中止（AbortController）')
    check(/redirect:\s*'follow'/.test(fn), '跟随重定向')
    check(/normalizeWallpaperUrl\(response\.url\)/.test(fn), '重定向后的最终 URL 也要校验')
    check(/content-length/.test(fn) && /WALLPAPER_URL_MAX_BYTES/.test(fn), '按 content-length 预检大小')
    check(/buffer\.length > WALLPAPER_URL_MAX_BYTES/.test(fn), '再按实际字节兜底')
    check(/detectImageMime\(buffer\)/.test(fn) && /application\/octet-stream/.test(fn),
      '魔数嗅探：不是图片就拒绝')
    check(/user-agent/.test(fn), '带 User-Agent')

    /* 4. 缓存。 */
    check(/WALLPAPER_URL_TTL/.test(hostSrc) && /wallpaperUrlCache/.test(hostSrc), '有 URL 缓存')

    /* 5. 回落链。 */
    const handler = hostSrc.slice(hostSrc.indexOf('handler: async (request, response)'),
      hostSrc.indexOf('handler: async (request, response)') + 3200)
    check(/wantedUrl !== ''/.test(handler) && /fetchWallpaperUrl\(wantedUrl\)/.test(handler), 'URL 分支优先')
    /* ⚠️ 不能只检查注释里有没有「拉取失败」—— 变异测试证明那样恒真。
     * 必须检查**实际控制流**：从 `fetchWallpaperUrl` 调用到
     * `readWallpaper` 之间**不许出现 404 / return**，
     * 否则 URL 失败就不会回落到本地路径。
     *
     * 注意区间起点要取 `if (wantedUrl`（含整个 URL 分支），
     * 终点取 `readWallpaper` —— 变异可能把 404 放在 if 块**外面**，
     * 只取 if 块内部会漏掉。 */
    const urlToLocal = handler.slice(handler.indexOf("if (wantedUrl !== '')"),
      handler.indexOf('const found = readWallpaper'))
    check(urlToLocal !== '' && !/writeHead\(404\)/.test(urlToLocal),
      'URL 拉取失败不直接 404（要继续回落本地路径）',
      '区间长 ' + urlToLocal.length + '，含 404: ' + /writeHead\(404\)/.test(urlToLocal))
    check(/readWallpaper\(queryPath/.test(handler) && handler.indexOf('readWallpaper') > handler.indexOf('fetchWallpaperUrl'),
      'URL 分支在 readWallpaper 之前，失败自然落下去')
    check(/readWallpaper\(queryPath/.test(handler), '本地路径逻辑保留')
  }

  const failed = results.filter((result) => !result.ok)
  console.log('─'.repeat(52))
  if (failed.length > 0) {
    console.log(`✗ ${failed.length}/${results.length} 项失败`)
    process.exit(1)
  }
  console.log(`✓ ${results.length} 项全部通过`)
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
