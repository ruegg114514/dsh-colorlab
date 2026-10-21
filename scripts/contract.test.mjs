#!/usr/bin/env node
/**
 * dsh-colorlab 持久化契约检查。
 *
 * 不改任何文件，只读地确认：
 *   1. profile 的 package.json 已登记本插件（dependencies + bundles 两处）。
 *   2. node_modules 里的软链指向插件源码目录。
 *   3. cordis.patch.yml 的 insert 行 id 与 Host 半体的 SETTINGS_ENTRY 一致
 *      （不一致会导致"设置页出来了但存不进 profile"）。
 *   4. 插件 package.json 的 dsh 声明形状正确（bundle.patch / client.platform / exports）。
 *   5. 宿主 cordis.patch.yml 里**没有**本插件的残留手工行（bundle 登记 + 手工 insert
 *      同时存在会触发 duplicate loader entry）。
 *
 * 用法：node scripts/contract.test.mjs
 */

import { readFileSync, existsSync, lstatSync, readlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const profile = process.env.DSH_PROFILE_DIR || 'C:\\Users\\15623\\.dsh\\profiles\\desktop'

const results = []
function check(ok, name, detail) {
  results.push({ ok, name, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 极简 YAML 取值：只为读出 `id:` 与 `name:` 行，不引依赖。 */
function readInsertRows(yamlText) {
  const rows = []
  let current = null
  for (const rawLine of yamlText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '')
    const idMatch = /^\s*-\s+id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (idMatch !== null) {
      current = { id: idMatch[1] }
      rows.push(current)
      continue
    }
    const nameMatch = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (nameMatch !== null && current !== null && current.name === undefined) current.name = nameMatch[1]
  }
  return rows
}

/**
 * 读出 `insert:` 列表下的行（只这些才是"手工挂载"）。
 *
 * 区分两种行很重要：
 *   - `- id: xxx` 在**顶层** = 按 id 覆盖已有条目的配置（settings 服务写用户设置
 *     时生成的就是这种，例如 `- id: mariana-theme` 带 config 块）；
 *   - `- insert: [- id: xxx ...]` = **新挂载**一个条目。
 * 只有后者与 bundle 登记同时存在才会 duplicate loader entry；把前者误判成重复
 * 会让人去删掉正常的用户设置。
 */
function readInsertedRows(yamlText) {
  const rows = []
  let inInsert = false
  let insertIndent = -1
  for (const rawLine of yamlText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '')
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (/^\s*-\s+insert:\s*$/.test(line)) {
      inInsert = true
      insertIndent = indent
      continue
    }
    if (!inInsert) continue
    /* insert 列表结束：出现缩进不大于 insert 的顶层键。 */
    if (indent <= insertIndent && !/^\s*-\s/.test(line)) {
      inInsert = false
      continue
    }
    const idMatch = /^\s*-\s+id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (idMatch !== null) {
      rows.push({ id: idMatch[1] })
      continue
    }
    const nameMatch = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (nameMatch !== null && rows.length > 0 && rows[rows.length - 1].name === undefined) {
      rows[rows.length - 1].name = nameMatch[1]
    }
  }
  return rows
}

function main() {
  console.log('')
  console.log('dsh-colorlab 持久化契约检查')
  console.log('─'.repeat(52))
  console.log(`  profile: ${profile}`)

  /* ---- 1. profile package.json ---- */
  const profilePkgPath = join(profile, 'package.json')
  check(existsSync(profilePkgPath), 'profile package.json 存在')
  if (!existsSync(profilePkgPath)) {
    finish()
    return
  }
  const profilePkg = readJson(profilePkgPath)
  const dependency = profilePkg.dependencies && profilePkg.dependencies['dsh-colorlab']
  check(typeof dependency === 'string', 'dependencies 里有 dsh-colorlab', dependency || '缺失')
  check(
    typeof dependency === 'string' && dependency.startsWith('link:'),
    '依赖是 link: 形式（指向本地源码）',
    dependency || '',
  )
  const bundles = (profilePkg.dsh && profilePkg.dsh.profile && profilePkg.dsh.profile.bundles) || []
  check(bundles.includes('dsh-colorlab'), 'dsh.profile.bundles 里有 dsh-colorlab', String(bundles.length) + ' 项')

  /* ---- 1.5 插件市场的持久化禁用表 ----
   *
   * 这是最难查的一处状态。插件市场（dsh-market）把「关掉的插件」记在
   * `.dsh-market/state.json` 的 `disabled` 数组里，之后**每次启动**都会：
   *
   *   1. 把该包从 `dsh.profile.bundles` 里摘掉
   *      （日志原文："dsh.profile.bundles removed so the official page's
   *        package switch agrees (#696)"）
   *   2. 把 `cordis.patch.yml` 里对应的行设成 `disabled`
   *   3. 日志写 "plugin kept off: <name>"
   *
   * 表现是插件彻底消失：设置里没有它、bundles 里没有它、patch 行被禁用，
   * 而代码本身完全正常。手工改 bundles / patch 都会被下一次启动覆盖回去 ——
   * 必须同时清掉这张表。
   */
  {
    const marketState = join(profile, '.dsh-market', 'state.json')
    if (existsSync(marketState)) {
      let disabled = []
      let parsed = true
      try {
        const raw = JSON.parse(readFileSync(marketState, 'utf8'))
        disabled = Array.isArray(raw.disabled) ? raw.disabled : []
      } catch {
        parsed = false
      }
      check(parsed, '.dsh-market/state.json 可解析')
      check(
        parsed && !disabled.includes('dsh-colorlab'),
        '插件市场 disabled 表里没有 dsh-colorlab（否则每次启动都会被强制关闭）',
        disabled.length === 0 ? '表为空' : disabled.join(', '),
      )
    } else {
      check(true, '插件市场状态文件不存在（未装过 market 或从未启用）', '跳过')
    }
  }

  /* ---- 2. 软链 ---- */
  const linkPath = join(profile, 'node_modules', 'dsh-colorlab')
  check(existsSync(linkPath), 'node_modules 里已安装')
  if (existsSync(linkPath)) {
    const stat = lstatSync(linkPath)
    check(stat.isSymbolicLink() || stat.isDirectory(), '安装项可读', stat.isSymbolicLink() ? 'junction/symlink' : 'directory')
    if (stat.isSymbolicLink()) {
      const target = resolve(profile, 'node_modules', readlinkSync(linkPath))
      check(resolve(target) === resolve(root), '软链指向本插件源码目录', target)
    }
    check(existsSync(join(linkPath, 'client.js')), '安装项里有 client.js')
    check(existsSync(join(linkPath, 'index.js')), '安装项里有 index.js')
  }

  /* ---- 3. patch id 与 SETTINGS_ENTRY 一致 ---- */
  const patchPath = join(root, 'cordis.patch.yml')
  check(existsSync(patchPath), 'cordis.patch.yml 存在')
  const rows = readInsertRows(readFileSync(patchPath, 'utf8'))
  check(rows.length === 1, 'cordis.patch.yml 只有一行 insert', String(rows.length))
  const row = rows[0] || {}
  check(row.name === 'dsh-colorlab', 'insert 行 name = dsh-colorlab', row.name || '缺失')

  const hostSource = readFileSync(join(root, 'index.js'), 'utf8')
  const entryMatch = /const SETTINGS_ENTRY = '([^']+)'/.exec(hostSource)
  const settingsEntry = entryMatch !== null ? entryMatch[1] : null
  check(settingsEntry !== null, 'Host 半体声明了 SETTINGS_ENTRY', settingsEntry || '缺失')
  check(
    settingsEntry !== null && row.id === settingsEntry,
    'insert 行 id 与 SETTINGS_ENTRY 一致（否则设置存不进 profile）',
    `id=${row.id || '缺失'} vs SETTINGS_ENTRY=${settingsEntry || '缺失'}`,
  )

  /* ---- 4. 插件 package.json 形状 ---- */
  const pkg = readJson(join(root, 'package.json'))
  check(pkg.name === 'dsh-colorlab', 'package name = dsh-colorlab', pkg.name)
  check(pkg.type === 'module', 'type = module（Host 半体要 ESM）', pkg.type)
  check(pkg.main === undefined || pkg.exports !== undefined, '用 exports 声明入口')
  check(pkg.exports && pkg.exports['.'] === './index.js', 'exports["."] = ./index.js')
  check(pkg.exports && pkg.exports['./client'] === './client.js', 'exports["./client"] = ./client.js')
  check(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch 已声明')
  check(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', 'dsh.client.platform = web')
  check(pkg.dsh && pkg.dsh.client && pkg.dsh.client.immediately === true, 'dsh.client.immediately = true')
  const injectList = (pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject) || []
  check(injectList.includes('@deepseek-ai/dsh-client-ui-theme'), 'dsh.client.inject 含 ui-theme')
  check(injectList.includes('@deepseek-ai/dsh-client-ui-settings'), 'dsh.client.inject 含 ui-settings')
  check(Array.isArray(pkg.files) && pkg.files.includes('client.js'), 'files 里包含 client.js')

  /* ---- 5. 宿主 patch 里没有"手工挂载"行 ---- */
  const hostPatchPath = join(profile, 'cordis.patch.yml')
  if (existsSync(hostPatchPath)) {
    const hostPatch = readFileSync(hostPatchPath, 'utf8')
    /* 只有 insert: 列表里的行才是新挂载；顶层 - id: 行是配置覆盖，属于正常用户设置。 */
    const inserted = readInsertedRows(hostPatch)
    const duplicates = inserted.filter((candidate) => candidate.name === 'dsh-colorlab' || candidate.id === 'mariana-theme')
    check(
      duplicates.length === 0,
      '宿主 cordis.patch.yml 没有本插件的 insert 行（避免 duplicate loader entry）',
      duplicates.length === 0 ? '' : JSON.stringify(duplicates),
    )

    /* 反过来：配置覆盖行应当存在（说明用户设置真的落盘了）。这是"存进去了"的正向证据。 */
    const configRows = readInsertRows(hostPatch).filter((candidate) => candidate.id === 'mariana-theme')
    check(
      configRows.length === 1,
      '宿主 cordis.patch.yml 有本插件的配置覆盖行（用户设置已落盘）',
      configRows.length === 1 ? 'id=mariana-theme' : `${configRows.length} 行`,
    )
    if (configRows.length === 1) {
      /* 该行下面应当带 config 块，且字段与 FIELD_DEFAULTS 同名。 */
      const blockMatch = /-\s+id:\s*mariana-theme[\s\S]*?(?=\n- |\n#|$)/.exec(hostPatch)
      const block = blockMatch !== null ? blockMatch[0] : ''
      check(/config:/.test(block), '配置覆盖行带 config 块')
      /* 已落盘字段：老配置里可能缺本轮新增的字段（重启后由默认值补上），
         所以缺新字段只提示、不判失败 —— 缺老字段才算真问题。 */
      const NEW_FIELDS = new Set(['prose', 'proseBoost', 'custom', 'presets', 'rowHighlight', 'rowColor', 'rowVariants'])
      for (const field of ['enabled', 'schemeMode', 'surface', 'accent', 'syntax', 'prose', 'proseBoost', 'custom', 'presets', 'rowHighlight', 'rowColor', 'rowVariants']) {
        const present = new RegExp('^\\s+' + field + ':', 'm').test(block)
        if (NEW_FIELDS.has(field)) {
          if (!present) console.log(`  ⚠ 落盘配置里还没有 ${field} 字段（重启后由默认值补上）`)
        } else {
          check(present, `落盘配置含字段 ${field}`)
        }
      }
    }
  }

  finish()
}

function finish() {
  const failed = results.filter((result) => !result.ok)
  console.log('─'.repeat(52))
  if (failed.length > 0) {
    console.log(`✗ ${failed.length}/${results.length} 项失败`)
    process.exit(1)
  }
  console.log(`✓ ${results.length} 项全部通过`)
}

main()
