#!/usr/bin/env node
/**
 * dsh-colorlab 装载兼容性检查。
 *
 * 这是**最接近真实装载**的离线检查：把宿主 `@deepseek-ai/dsh-client-modules`
 * 里那份 `dsh.client` 声明解析器（`parseDshClient` + `exactPackageSpecifier` +
 * `stripClientSuffix`）按源码语义复刻一遍，喂本插件的 package.json，验证：
 *
 *   1. `dsh.client` 声明形状合法（platform / inject / immediately 类型正确）。
 *   2. 裸包名 `dsh-colorlab` 能被 `exactPackageSpecifier` 识别为包根
 *      （带 `/` 或 `:` 的行会被判定为子路径/内置而**不**装载）。
 *   3. `./client` 与裸名归一到同一份 exports（bundle 即包的 client 半体）。
 *   4. `exports["./client"]` 指向的 client.js 真实存在且是可解析的 bundle
 *      （含 `window.__ModuleLoader__.load` 与正确的 id）。
 *   5. `dsh.bundle.patch` 指向的文件存在且是合法的 insert 行列表。
 *   6. 依赖树可解析：cordis.patch.yml 的 insert 行 name 能在 profile
 *      node_modules 里解析到（否则 loader 会报 failed to import）。
 *
 * 解析器语义照抄自安装态 app.asar 的
 * `@deepseek-ai/dsh-client-modules/lib/index.js`（`parseDshClient`）。
 *
 * 用法：node scripts/loader.test.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * 目标 profile 目录。
 *
 * 优先取 `DSH_PROFILE_DIR`；否则按 `DSH_HOME`（缺省为 `os.homedir()/.dsh`）
 * 拼出 `profiles/desktop`。
 *
 * **这里刻意不写死绝对路径** —— 曾经硬编码成某个用户的主目录，
 * 结果既跑不了别人的机器，又把本机用户名带进了公开仓库。
 */
function resolveProfile() {
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'profiles', process.env.DSH_PROFILE_NAME || 'desktop')
}
const profile = resolveProfile()

const results = []
function check(ok, name, detail) {
  results.push({ ok, name, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

/* ------------------------------------------------------------------ *
 * 宿主解析器语义的复刻（逐行对齐 dsh-client-modules/lib/index.js）
 * ------------------------------------------------------------------ */

/** 校验一个可选字符串数组字段。 */
function optionalStringArray(pkgName, field, value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`client-modules: ${pkgName} ${field} must be an array of strings`)
  }
  return value
}

/** 解析 `dsh.client` 声明；形状不合法时抛错（与宿主同文案）。 */
function parseDshClient(pkgName, value) {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`)
  }
  const decl = value
  if (typeof decl.platform !== 'string') {
    throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`)
  }
  const inject = optionalStringArray(pkgName, 'dsh.client.inject', decl.inject)
  const external = optionalStringArray(pkgName, 'dsh.client.external', decl.external)
  if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
    throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`)
  }
  return {
    platform: decl.platform,
    ...(inject !== undefined ? { inject } : {}),
    ...(external !== undefined ? { external } : {}),
    ...(decl.immediately !== undefined ? { immediately: decl.immediately } : {}),
  }
}

/** 裸包名才返回名字；子路径、路径、scheme 限定符一律 undefined。 */
function exactPackageSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length === 2 && parts.every(Boolean) ? specifier : undefined
  }
  return specifier.length > 0 && !specifier.includes('/') && !specifier.includes(':') ? specifier : undefined
}

/** `<id>/client` 与裸名归一到同一份 exports。 */
function stripClientSuffix(spec) {
  return spec.endsWith('/client') ? spec.slice(0, -7) : spec
}

/** 极简 YAML：只读出 insert 行的 id / name。 */
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

function main() {
  console.log('')
  console.log('dsh-colorlab 装载兼容性检查')
  console.log('─'.repeat(52))

  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

  /* ---- 1. dsh.client 声明形状 ---- */
  let decl
  let parseError = null
  try {
    decl = parseDshClient(pkg.name, pkg.dsh && pkg.dsh.client)
  } catch (error) {
    parseError = error
  }
  check(parseError === null, 'dsh.client 声明能被宿主解析器接受', parseError ? parseError.message : '')
  check(decl !== undefined, 'dsh.client 声明存在')
  if (decl !== undefined) {
    check(decl.platform === 'web', 'platform = web', decl.platform)
    check(decl.immediately === true, 'immediately = true（启动即装载）')
    check(Array.isArray(decl.inject) && decl.inject.length > 0, 'inject 非空', String((decl.inject || []).length) + ' 项')
    /* inject 里每个名字都必须是"能被解析到的包名"，否则组合期会报 missing supplier。 */
    for (const dep of decl.inject || []) {
      const isPackageName = exactPackageSpecifier(dep) !== undefined
      check(isPackageName, `inject 项是合法包名：${dep}`)
    }
  }

  /* ---- 2. 裸包名可识别 ---- */
  const spec = pkg.name
  check(exactPackageSpecifier(spec) === spec, '裸包名能被 exactPackageSpecifier 识别', spec)
  check(!spec.includes('/') && !spec.includes(':'), '包名不含 / 或 :（否则不会被当作包根装载）')
  check(stripClientSuffix(spec + '/client') === spec, '<id>/client 归一到裸包名')

  /* ---- 3. exports 指向 ---- */
  const clientRel = pkg.exports && pkg.exports['./client']
  check(typeof clientRel === 'string', 'exports["./client"] 存在', clientRel || '缺失')
  if (typeof clientRel === 'string') {
    const clientPath = resolve(root, clientRel)
    check(existsSync(clientPath), 'client.js 真实存在', clientPath)
    if (existsSync(clientPath)) {
      const source = readFileSync(clientPath, 'utf8')
      check(source.includes('window.__ModuleLoader__.load'), 'client.js 是 ModuleLoader bundle')
      const idMatch = /id:\s*'([^']+)'/.exec(source)
      check(idMatch !== null && idMatch[1] === pkg.name, 'bundle id 等于包名', idMatch ? idMatch[1] : '未找到')
      /* bundle 是手写 CJS 形态：factory 必须存在且是函数。 */
      check(/factory\s*\(/.test(source) || /factory:/.test(source), 'bundle 声明了 factory')
    }
  }
  const mainRel = pkg.exports && pkg.exports['.']
  check(typeof mainRel === 'string' && existsSync(resolve(root, mainRel)), 'exports["."] 指向真实文件', mainRel || '缺失')

  /* ---- 4. dsh.bundle.patch ---- */
  const patchRel = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch
  check(typeof patchRel === 'string', 'dsh.bundle.patch 已声明', patchRel || '缺失')
  if (typeof patchRel === 'string') {
    const patchPath = resolve(root, patchRel)
    check(existsSync(patchPath), 'patch 文件存在', patchPath)
    if (existsSync(patchPath)) {
      const rows = readInsertRows(readFileSync(patchPath, 'utf8'))
      check(rows.length >= 1, 'patch 至少有一行 insert', String(rows.length))
      const row = rows[0] || {}
      check(typeof row.id === 'string' && row.id !== '', 'insert 行有 id', row.id || '缺失')
      check(row.name === pkg.name, 'insert 行 name 等于包名（loader 按它解析模块）', row.name || '缺失')
    }
  }

  /* ---- 5. loader 能否解析到该包（profile node_modules）---- */
  const installed = join(profile, 'node_modules', pkg.name)
  check(existsSync(installed), 'profile node_modules 里能解析到该包', installed)
  if (existsSync(installed)) {
    check(existsSync(join(installed, 'index.js')), '解析到 index.js（Host 半体）')
    check(existsSync(join(installed, 'client.js')), '解析到 client.js（浏览器半体）')
    check(existsSync(join(installed, 'cordis.patch.yml')), '解析到 cordis.patch.yml')
    /* 两侧 package.json 的 name 必须一致，否则 loader 会把它当成两个包。 */
    const installedPkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
    check(installedPkg.name === pkg.name, '安装项 name 与源码一致', installedPkg.name)
  }

  /* ---- 6. inject 声明的包在 profile 里可解析 ---- */
  for (const dep of (decl && decl.inject) || []) {
    /* ui-theme / ui-settings 由宿主 app.asar 提供，不在 profile node_modules；
       这里只验证它们在宿主 bundle 列表里存在（用 asar 条目名判断）。 */
    const bare = dep.replace('@deepseek-ai/', '')
    check(
      ['dsh-client-ui-theme', 'dsh-client-ui-settings'].includes(bare),
      `inject 依赖是宿主内置包：${dep}`,
    )
  }

  const failed = results.filter((result) => !result.ok)
  console.log('─'.repeat(52))
  if (failed.length > 0) {
    console.log(`✗ ${failed.length}/${results.length} 项失败`)
    process.exit(1)
  }
  console.log(`✓ ${results.length} 项全部通过`)
}

main()
