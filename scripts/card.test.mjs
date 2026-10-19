#!/usr/bin/env node
/**
 * 文件卡片检测的**真实数据**回归测试。
 *
 * 为什么单独一个套件：卡片类名的检测逻辑（detectCardTargets）依赖宿主
 * ui-deliverables 的 CSS 结构。别的套件用假的 CSSOM 替身，只能证明"逻辑自洽"，
 * 证明不了"还对得上今天的宿主"。
 *
 * 这个套件从**安装态 app.asar** 里抠出宿主真实的 CSS 文本，按真实 CSSOM 的
 * 形状（每条规则一个对象，selectorText / cssText 各自独立）构造替身，然后
 * 跑真正的 detectCardTargets。
 *
 * 宿主改了卡片结构（换变量名、换类名后缀、拆成新组件）时，这里会先红。
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(condition, label, detail) {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ------------------------------------------------------------------ *
 * 1. 找安装态 app.asar
 * ------------------------------------------------------------------ */

const asarCandidates = [
  process.env.DSH_ASAR,
  'D:\\dsh\\resources\\app.asar',
  join(process.env.LOCALAPPDATA || '', '@deepseek-ai', 'dsh-desktop', 'resources', 'app.asar'),
].filter((value) => typeof value === 'string' && value !== '')

const asarPath = asarCandidates.find((candidate) => existsSync(candidate))
if (asarPath === undefined) {
  console.log('  ⚠ 找不到 app.asar，跳过（宿主 CSS 检测无法离线验证）')
  console.log('  ⚠ 装 DSH 桌面端后重跑，或设 DSH_ASAR 指向 app.asar')
  process.exit(0)
}

/* ------------------------------------------------------------------ *
 * 2. 从 asar 里抠出宿主真实的 CSS 文本
 * ------------------------------------------------------------------ */

/**
 * 宿主把 CSS Module 编译成 JS 常量：`css$2 = "...."`。
 * 这里按 CSS Module 的源文件名定位，抠出紧跟其后的那个常量。
 */
function extractModuleCss(source, moduleName) {
  const marker = source.indexOf(moduleName)
  if (marker === -1) return null
  const constAt = source.indexOf('css$', marker)
  if (constAt === -1) return null
  const quoteAt = source.indexOf('"', constAt)
  if (quoteAt === -1) return null
  /* 找到该字符串字面量的结束引号（要跳过转义引号）。 */
  let end = quoteAt + 1
  while (end < source.length) {
    if (source[end] === '\\') {
      end += 2
      continue
    }
    if (source[end] === '"') break
    end += 1
  }
  const literal = source.slice(quoteAt, end + 1)
  try {
    return JSON.parse(literal)
  } catch {
    return null
  }
}

const asarText = readFileSync(asarPath, 'latin1')
const changedFilesCss = extractModuleCss(asarText, 'ChangedFiles.module.css')
const deliverablesCss = extractModuleCss(asarText, 'Deliverables.module.css')

check(changedFilesCss !== null, '从 app.asar 抠出 ChangedFiles.module.css')
check(deliverablesCss !== null, '从 app.asar 抠出 Deliverables.module.css')
if (changedFilesCss === null || deliverablesCss === null) {
  process.exit(1)
}

/* ------------------------------------------------------------------ *
 * 3. 按真实 CSSOM 的形状构造替身
 * ------------------------------------------------------------------ */

/**
 * 真实浏览器里，CSSOM 的每个 rule 是一个独立对象：
 *   - `selectorText` 只含**这一条**规则的选择器
 *   - `cssText` 是这一条规则的完整文本
 *   - `style` 是一个 CSSStyleDeclaration，可用 `getPropertyValue` 问某个声明
 * 宿主的一个 CSS Module 文件里有很多条规则，所以要拆开。
 *
 * ⚡ `style.getPropertyValue` 必须还原：插件为了省掉「序列化 2179 条规则的
 * cssText」而优先用它。替身不给这个成员的话，测到的就只是 cssText 兜底路径，
 * 真正跑在生产里的那条快路径反而没被覆盖。
 */
function toCssomRules(cssText) {
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = re.exec(cssText)) !== null) {
    const selector = match[1].trim()
    const body = match[2]
    /* 去掉 `css$2 = "` 这类编译期前缀残留。 */
    const clean = selector.replace(/^css\$\d+\s*=\s*"?/, '').trim()
    const decls = new Map()
    for (const part of body.split(';')) {
      const at = part.indexOf(':')
      if (at === -1) continue
      decls.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
    }
    rules.push({
      selectorText: clean,
      cssText: clean + '{' + body + '}',
      style: {
        getPropertyValue: (name) => (decls.has(name) ? decls.get(name) : ''),
      },
    })
  }
  return rules
}

const sheets = [
  { cssRules: toCssomRules(changedFilesCss) },
  { cssRules: toCssomRules(deliverablesCss) },
]

/* ------------------------------------------------------------------ *
 * 4. 跑真正的 detectCardTargets
 * ------------------------------------------------------------------ */

/**
 * 用假的 ModuleLoader 接住 bundle，取出纯函数。
 * 与 verify.mjs 同一套加载方式（client.js 顶层就调 window.__ModuleLoader__.load）。
 *
 * ⚠️ client.js 是用 `new Function('window','document',...)` 跑的，闭包里的
 * `document` 是**加载时传入的那个**，不是 globalThis.document。所以样式表
 * 替身必须在加载时就挂上。
 */
function loadPlugin(fakeDocument) {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) {
        captured = definition
      },
    },
    React: undefined,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const fakeRequire = (id) => {
    if (id === 'react') {
      return { createElement: () => null, Fragment: 'fragment', useSyncExternalStore: () => ({}) }
    }
    throw new Error('unexpected require: ' + id)
  }
  const run = new Function('window', 'document', 'require', 'setTimeout', source)
  run(fakeWindow, fakeDocument, fakeRequire, () => ({ unref() {} }))
  if (captured === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load')
  return captured.factory(fakeRequire)
}

/* 样式表替身必须在加载时就挂上（见 loadPlugin 的注释）。 */
const fakeDocument = { styleSheets: sheets }

const exportsObj = loadPlugin(fakeDocument)
const test = exportsObj.__test
check(test !== undefined, 'client.js 导出 __test')
if (test === undefined) process.exit(1)

const { detectCardTargets, CARD_TARGETS, buildCardSheet } = test

check(typeof detectCardTargets === 'function', 'detectCardTargets 已导出')
check(Array.isArray(CARD_TARGETS) && CARD_TARGETS.length === 2, 'CARD_TARGETS 覆盖两种卡片组件', String(CARD_TARGETS && CARD_TARGETS.length))

/* document 替身已在加载时挂上（闭包捕获的是加载时的 document）。 */
const found = detectCardTargets()

console.log('  · 检测到：', JSON.stringify(found))
check(found.length === 2, '同时检测到两种卡片组件', `${found.length} 个`)

const changesHit = found.find((entry) => entry.varName === '--changes-fill')
const deliverHit = found.find((entry) => entry.varName === '--deliverable-fill')

check(changesHit !== undefined, '检测到改动文件卡片（--changes-fill）')
check(deliverHit !== undefined, '检测到交付文件卡片（--deliverable-fill）')

if (changesHit !== undefined) {
  check(
    /^[a-zA-Z0-9]+_card$/.test(changesHit.defClass),
    '改动文件卡片的类名后缀是 _card',
    changesHit.defClass,
  )
}
if (deliverHit !== undefined) {
  check(
    /^[a-zA-Z0-9]+_root$/.test(deliverHit.defClass),
    '交付文件卡片的类名后缀是 _root',
    deliverHit.defClass,
  )
}

/* 检测到的类名必须真的出现在宿主 CSS 里（防止正则误命中）。 */
for (const entry of found) {
  const inHost = asarText.includes('.' + entry.defClass)
  check(inHost, '检测到的类名确实存在于宿主 CSS：' + entry.defClass)
}

/* ------------------------------------------------------------------ *
 * 5. 生成的样式表要同时覆盖两个变量
 * ------------------------------------------------------------------ */

const sheet = buildCardSheet({ cardColor: '#3B454F' }, found)
check(sheet.includes('--changes-fill:#3B454F'), '样式表覆盖 --changes-fill')
check(sheet.includes('--deliverable-fill:#3B454F'), '样式表覆盖 --deliverable-fill')
check(!sheet.includes('!important'), '不使用 !important')

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
