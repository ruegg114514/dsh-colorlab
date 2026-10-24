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
/* 「计划」卡片（ui-plan）—— 它有自己的 `--plan-card-fill`，早先漏掉了它，
   于是「计划」卡片一直是宿主的中性灰。 */
const planPreviewCss = extractModuleCss(asarText, 'PlanPreview.module.css')
const scheduleCardCss = extractModuleCss(asarText, 'ScheduleCreateCard.module.css')

check(changedFilesCss !== null, '从 app.asar 抠出 ChangedFiles.module.css')
check(deliverablesCss !== null, '从 app.asar 抠出 Deliverables.module.css')
check(planPreviewCss !== null, '从 app.asar 抠出 PlanPreview.module.css')
check(scheduleCardCss !== null, '从 app.asar 抠出 ScheduleCreateCard.module.css')
if (changedFilesCss === null || deliverablesCss === null
  || planPreviewCss === null || scheduleCardCss === null) {
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
  { cssRules: toCssomRules(planPreviewCss) },
  { cssRules: toCssomRules(scheduleCardCss) },
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
check(Array.isArray(CARD_TARGETS) && CARD_TARGETS.length === 4,
  'CARD_TARGETS 覆盖四种卡片组件（改动文件 / 交付文件 / 计划 / 排程）',
  String(CARD_TARGETS && CARD_TARGETS.length))

/* document 替身已在加载时挂上（闭包捕获的是加载时的 document）。 */
const found = detectCardTargets()

console.log('  · 检测到：', JSON.stringify(found))
check(found.length === 4, '四种卡片组件的变量都检测到了', `${found.length} 个`)

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

/* ------------------------------------------------------------------ *
 * 6. 【回归】分批注入：只找到一个组件时不能算「已检测完成」
 *
 * 宿主是分批注入样式表的，第一轮往往只找得到 ChangedFiles 的
 * `--changes-fill`，Deliverables 的 `--deliverable-fill` 晚一步才进 DOM。
 * 早先的判据是「找到一个就算成功」，于是再也不重试 —— 表现就是
 * 「已编辑」卡片有色、「交付文件」卡片一直没色。
 * ------------------------------------------------------------------ */

console.log('  分批注入（回归）')

const { mergeCardTargets, cardTargetsComplete } = test

check(cardTargetsComplete(found) === true, '两个都找到 → 判定为「已找齐」')
check(cardTargetsComplete([]) === false, '一个都没找到 → 未找齐')
check(cardTargetsComplete(undefined) === false, 'undefined → 未找齐')
check(cardTargetsComplete([changesHit]) === false,
  '只找到 ChangedFiles → **未找齐**（这正是早先漏掉的情形）',
  String([changesHit].length) + ' / ' + CARD_TARGETS.length)

{
  /* 第一轮：只有 ChangedFiles 的样式表 */
  const partialDoc = { styleSheets: [{ cssRules: toCssomRules(changedFilesCss) }] }
  const partial = loadPlugin(partialDoc).__test.detectCardTargets()
  check(partial.length === 1 && partial[0].varName === '--changes-fill',
    '第一轮只检测到 --changes-fill', partial.map((x) => x.varName).join(','))

  /* 第二轮：Deliverables 的样式表也进来了 → 合并，不能丢掉上轮结果 */
  const merged = mergeCardTargets(partial, found)
  check(merged.length === CARD_TARGETS.length, '合并后两组都在', String(merged.length))
  check(merged.some((x) => x.varName === '--changes-fill'), '合并后保留 --changes-fill')
  check(merged.some((x) => x.varName === '--deliverable-fill'), '合并后补上 --deliverable-fill')
  check(cardTargetsComplete(merged) === true, '合并后判定为已找齐')

  /* 重复合并不应产生重复项 */
  const again = mergeCardTargets(merged, found)
  check(again.length === merged.length, '重复合并不产生重复项', String(again.length))
  check(mergeCardTargets(undefined, found).length === CARD_TARGETS.length, '从 undefined 合并也正常')
  check(mergeCardTargets(found, undefined).length === CARD_TARGETS.length, 'found 为 undefined 不炸')

  /* 关键：部分检测结果生成的样式表**只有一条规则** —— 这正是用户看到的
     「已编辑有色、交付文件没色」 */
  const partialSheet = buildCardSheet({ cardColor: '#3B454F' }, partial)
  check(partialSheet.includes('--changes-fill') && !partialSheet.includes('--deliverable-fill'),
    '只找到一组时样式表只覆盖一半（所以必须继续重试）')
}

﻿/* ------------------------------------------------------------------ *
 * 🔧 2026-10-23：宿主 CSS Module 有**两种命名格式**，原来的正则只认一种
 * ------------------------------------------------------------------ */

console.log('')
console.log('H. 类名两种命名格式（2026-10-23 真 bug）')

/* 宿主当前构建（320 个类）用的是「_局部名_哈希_序号」：_card_38jqx_9
 * 旧构建用的是「哈希_局部名」：kuvljq_card
 *
 * 原正则「\.([a-zA-Z0-9]+_card)\b」有两个问题：
 *   1. 只认第二种（局部名在后）
 *   2. \b 在第一种上失效（下划线是单词字符，_card 后面跟 _9 不构成边界）
 * 结果是「带序号后缀的类名全部漏检」。 */
{
  const cases = [
    /* 格式 A + _card：用 --changes-fill（CARD_TARGETS 里 _card 对应的变量）。
     * --dsw-hovercard-bg 归 FLOAT_TARGETS，在 I 段单独测。 */
    { css: '._card_38jqx_9{--changes-fill: #123;background:var(--changes-fill)}', want: '_card_38jqx_9' },
    /* 注意：_root 对应 --deliverable-fill（CARD_TARGETS 里 defClass: '_root' 的那项），
     * 用 --changes-fill 会检测不到 —— 那是 _card 的变量。 */
    { css: '._root_abc12_1{--deliverable-fill: #123;background:var(--deliverable-fill)}', want: '_root_abc12_1' },
    { css: '.kuvljq_card{--changes-fill: #123;background:var(--changes-fill)}', want: 'kuvljq_card' },
    { css: '.flL80G_root{--deliverable-fill: #123;background:var(--deliverable-fill)}', want: 'flL80G_root' },
  ]
  for (const c of cases) {
    const doc = { styleSheets: [{ cssRules: toCssomRules(c.css) }] }
    const found = loadPlugin(doc).__test.detectCardTargets()
    check(found.length === 1 && found[0].defClass === c.want,
      '检测到 ' + c.want + '（格式兼容）',
      found.length === 0 ? '未检测到' : found[0].defClass)
  }

  /* 不能把更长的局部名误认成目标（_cardHeader 不是 _card）。 */
  const headerDoc = { styleSheets: [{ cssRules: toCssomRules('._cardHeader_x_1{--changes-fill: #123}') }] }
  const headerFound = loadPlugin(headerDoc).__test.detectCardTargets()
  check(headerFound.length === 0, '不误匹配 _cardHeader（局部名前缀保护）',
    headerFound.length === 0 ? '正确拒绝' : '误匹配 ' + headerFound[0].defClass)

  /* 格式 B 的前缀保护：.kuvljq_cardHeader 不能被当成 .kuvljq_card。
   * （这条才真正锁住 (?![\w-]) —— 格式 A 的正则靠 _ 本身就能边界。） */
  const bHeaderDoc = { styleSheets: [{ cssRules: toCssomRules('.kuvljq_cardHeader{--changes-fill: #123}') }] }
  const bHeaderFound = loadPlugin(bHeaderDoc).__test.detectCardTargets()
  check(bHeaderFound.length === 0, '不误匹配 kuvljq_cardHeader（格式 B 前缀保护）',
    bHeaderFound.length === 0 ? '正确拒绝' : '误匹配 ' + bHeaderFound[0].defClass)
}

console.log('')
console.log('I. HoverCard 浮层检测（--dsw-hovercard-bg）')
{
  const hoverCss = '._card_38jqx_9{--dsw-hovercard-bg: #2C2C2E;position:fixed;z-index:100;background:var(--dsw-hovercard-bg);box-shadow:var(--dsw-shadow-lv3)}'
  const doc = { styleSheets: [{ cssRules: toCssomRules(hoverCss) }] }
  const test = loadPlugin(doc).__test

  check(typeof test.detectFloatTargets === 'function', 'detectFloatTargets 已导出')
  check(Array.isArray(test.FLOAT_TARGETS) && test.FLOAT_TARGETS.length === 1, 'FLOAT_TARGETS 有一项')
  check(test.FLOAT_TARGETS[0].varName === '--dsw-hovercard-bg',
    'FLOAT_TARGETS 目标是 --dsw-hovercard-bg', test.FLOAT_TARGETS[0].varName)

  const floats = test.detectFloatTargets()
  check(floats.length === 1 && floats[0] === '_card_38jqx_9',
    '检测到 HoverCard 的真实类名', JSON.stringify(floats))

  /* 关键：HoverCard 不能被 CARD_TARGETS 误捡（那会让「预览浓度」
   * 滑块意外改到浮层底色）。 */
  const cards = test.detectCardTargets()
  check(cards.every((c) => c.varName !== '--dsw-hovercard-bg'),
    'HoverCard 不进 CARD_TARGETS（两套语义分开）',
    cards.map((c) => c.varName).join(',') || '(空)')
}

console.log('')
console.log('J. 浮层改实心：按检测到的类名写覆盖')
{
  const darkSurf = { base: '#343D46', sidebar: '#2E363F', layer1: '#3B444D', layer2: '#424B55', layer3: '#49525C', overlay: '#1E242A', bubble: '#3B444D' }
  const hoverCss = '._card_38jqx_9{--dsw-hovercard-bg: #2C2C2E;background:var(--dsw-hovercard-bg)}'
  const doc = { styleSheets: [{ cssRules: toCssomRules(hoverCss) }] }
  const test = loadPlugin(doc).__test
  const floats = test.detectFloatTargets()

  const build = (extra) => test.buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', ...extra },
    darkSurf, true, [], floats)

  /* ⚠️ 2026-10-24 行为改变（用户报 bug）：HoverCard 气泡默认也要跟玻璃走。
   * 之前只有「改实心」开关会碰它，且直接钉成不透明 —— 默认状态下这个浮层
   * 完全没被玻璃处理，背后活文字透上来。现在分两层：
   *   · 默认 → rgba 半透明 + backdrop-filter
   *   · 改实心 on → 6 位 hex 实色，且撤掉模糊
   * 两条规则同选择器，后一条覆盖前一条（CSS 顺序）。 */
  const off = build({})
  const offRule = off.match(/\._card_38jqx_9\{[^}]*\}/)
  check(offRule !== null, '默认 → 也覆盖 hovercard 变量（跟玻璃走）',
    offRule ? offRule[0].slice(0, 80) : '未生成')
  check(offRule !== null && /--dsw-hovercard-bg:rgba\(/.test(offRule[0]),
    '默认档是 rgba 半透明', offRule ? offRule[0].slice(0, 90) : '')
  check(offRule !== null && /backdrop-filter:blur\(/.test(offRule[0]),
    '默认档带 backdrop-filter（真玻璃）')

  const on = build({ glassSolidFloats: 'on' })
  const rules = [...on.matchAll(/\._card_38jqx_9\{[^}]*\}/g)].map(x => x[0])
  check(rules.length >= 2, '打开 → 两条规则（玻璃档 + 实心档）', String(rules.length))
  const solidRule = rules.find(r => /#[0-9a-fA-F]{6} !important/.test(r) && !/rgba\(/.test(r))
  check(solidRule !== undefined, '打开 → 有 6 位 hex 实色规则',
    solidRule ? solidRule.slice(0, 90) : '未生成')
  /* 实心档必须排在玻璃档之后 —— CSS 同特异性靠顺序决胜。 */
  if (solidRule !== undefined) {
    const idxGlass = on.indexOf(rules[0])
    const idxSolid = on.indexOf(solidRule)
    check(idxSolid > idxGlass, '实心档在玻璃档之后（同特异性靠顺序覆盖）',
      idxGlass + ' < ' + idxSolid)
  }

  /* 绝对不能写成 body 级 —— 自定义属性不从 body 继承过元素本地声明。 */
  check(!/body\{--dsw-hovercard-bg/.test(on),
    '不写在 body 上（元素本地声明会挡住 body 级 !important）')

  /* 没检测到类名（还没扫描）→ 只生成 _float_/_preview_，不崩不瞎写。 */
  const noTargets = test.buildGlassSheet(
    { glass: 'on', glassTint: '65', glassFog: '16', glassBlur: '16', glassSolidFloats: 'on' },
    darkSurf, true, [], [])
  check(/_float_/.test(noTargets) && !/hovercard-bg/.test(noTargets),
    '未检测到类名时只生成 _float_/_preview_（不崩、不瞎写）')
}

console.log('')
console.log('K. 浮层检测不被卡片进度阻塞（2026-10-23 真 bug）')
{
  /* 原实现把 detectFloatTargets() 放在 `if (have < total)` 里 ——
   * 而 CARD_TARGETS 有 4 项，启动几秒内就找齐，之后整块跳过，
   * 浮层检测**永远不跑**，floatTargets 恒为 undefined，
   * 「浮层改实心」对 HoverCard 完全失效（用户实测：悬停浮层仍透明）。
   *
   * 这条锁的是「两个检测互不依赖」：卡片齐了浮层照样要检测。 */
  const src = readFileSync(join(root, 'client.js'), 'utf8')
  const i = src.indexOf('function syncCardSheet')
  const seg = src.slice(i, i + 2600)
  const cardGuard = seg.indexOf('if (have < total)')
  const floatDetect = seg.indexOf('detectFloatTargets()')
  check(cardGuard > 0 && floatDetect > 0, '两个检测都在 syncCardSheet 里')
  check(floatDetect > cardGuard, '浮层检测在卡片守卫之后')
  /* 关键：浮层检测必须在 `have < total` 块**之外**。 */
  const guardBlockEnd = seg.indexOf('\n      }', cardGuard)
  check(guardBlockEnd > 0 && floatDetect > guardBlockEnd,
    '浮层检测在 have<total 块之外（卡片找齐后仍然跑）',
    '守卫块结束 ' + guardBlockEnd + ' / 浮层检测 ' + floatDetect)

  /* 浮层检测有自己的「没找到就重试」判定，不依赖 cardTargets。 */
  check(/if \(!Array\.isArray\(floatTargets\) \|\| floatTargets\.length === 0\)/.test(seg),
    '浮层检测有自己的重试判定（不受 cardTargets 进度影响）')
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
