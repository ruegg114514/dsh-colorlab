#!/usr/bin/env node
/**
 * dsh-colorlab 自定义配色与配色方案测试。
 *
 * 验证两个用户功能：
 *   A. 自定义配色 —— 改一个槽位能正确覆盖对应令牌，且非法输入不污染 CSS。
 *   B. 配色方案 —— 保存 / 载入 / 删除 / 同名覆盖 / 上限，以及"使用中"判定。
 *
 * 全部用纯函数（parseCustom / serializeCustom / normalizeCustom / resolveTokens /
 * parsePresets / contrastRatio）驱动，不需要 DOM。
 *
 * 用法：node scripts/custom.test.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const results = []
function check(ok, name, detail) {
  results.push({ ok, name, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** 载入 bundle，取出 __test。 */
function loadPlugin() {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: { load: (definition) => { captured = definition } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const fakeRequire = (id) => {
    if (id === 'react') {
      return { createElement: () => null, Fragment: 'f', useSyncExternalStore: (s, g) => g(), useState: (v) => [v, () => {}] }
    }
    throw new Error('unexpected require: ' + id)
  }
  const run = new Function('window', 'document', 'require', 'setTimeout', 'clearTimeout', 'console', source)
  run(fakeWindow, undefined, fakeRequire, () => ({ unref() {} }), () => {}, console)
  return captured.factory(fakeRequire).__test
}

function main() {
  console.log('')
  console.log('dsh-colorlab 自定义配色与配色方案测试')
  console.log('─'.repeat(52))

  const test = loadPlugin()
  const {
    DEFAULTS,
    PALETTE,
    SURFACES,
    ACCENTS,
    CUSTOM_SLOTS,
    CUSTOM_PATHS,
    MAX_PRESETS,
    resolveTokens,
    resolveProseTokens,
    parseCustom,
    serializeCustom,
    normalizeCustom,
    parsePresets,
    contrastRatio,
  } = test

  /* ---- 导出完整性 ---- */
  check(Array.isArray(CUSTOM_SLOTS) && CUSTOM_SLOTS.length > 0, 'CUSTOM_SLOTS 已导出', String((CUSTOM_SLOTS || []).length) + ' 个槽位')
  check(CUSTOM_PATHS instanceof Set, 'CUSTOM_PATHS 是 Set')
  check(typeof MAX_PRESETS === 'number' && MAX_PRESETS > 0, 'MAX_PRESETS 已声明', String(MAX_PRESETS))
  check(typeof parseCustom === 'function', 'parseCustom 已导出')
  check(typeof serializeCustom === 'function', 'serializeCustom 已导出')
  check(typeof normalizeCustom === 'function', 'normalizeCustom 已导出')
  check(typeof parsePresets === 'function', 'parsePresets 已导出')
  check(typeof contrastRatio === 'function', 'contrastRatio 已导出')

  /* ---- A. 自定义配色 ---- */
  console.log('')
  console.log('A. 自定义配色')

  /* 基线：无自定义时，令牌等于内置值。 */
  const base = resolveTokens({ ...DEFAULTS, custom: '' })
  check(base['--dsw-alias-bg-base'].dark === SURFACES.standard.base, '无自定义时底色 = 内置值', base['--dsw-alias-bg-base'].dark)
  check(base['--dsw-alias-label-primary'].dark === PALETTE.fg, '无自定义时正文色 = 内置值', base['--dsw-alias-label-primary'].dark)

  /* 改背景 → 应当传导到 bg-base，且不动的槽位保持原值。 */
  const customBg = resolveTokens({ ...DEFAULTS, custom: JSON.stringify({ 'surface.base': '#101418' }) })
  check(customBg['--dsw-alias-bg-base'].dark === '#101418', '自定义 surface.base 生效', customBg['--dsw-alias-bg-base'].dark)
  check(customBg['--dsw-alias-label-primary'].dark === PALETTE.fg, '未改的槽位保持原值')

  /* 改正文色 → 传导到 label-primary / brand-primary 等多个令牌。 */
  const customFg = resolveTokens({ ...DEFAULTS, custom: JSON.stringify({ 'palette.fg': '#FFEEDD' }) })
  check(customFg['--dsw-alias-label-primary'].dark === '#FFEEDD', '自定义 palette.fg → label-primary', customFg['--dsw-alias-label-primary'].dark)
  check(customFg['--dsw-alias-brand-primary'].dark === '#FFEEDD', '自定义 palette.fg → brand-primary（派生令牌同步）')
  check(customFg['--shiki-foreground'].dark === '#FFEEDD', '自定义 palette.fg → shiki-foreground（语法高亮同步）')
  check(customFg['--dmt-prose-em'] !== undefined, '自定义不影响正文高亮令牌的存在')

  /* 改语法色 → 传导到 shiki 与正文高亮。 */
  const customGreen = resolveTokens({ ...DEFAULTS, custom: JSON.stringify({ 'palette.green': '#00FF88' }) })
  check(customGreen['--shiki-token-string'].dark === '#00FF88', '自定义 palette.green → shiki 字符串色', customGreen['--shiki-token-string'].dark)
  check(customGreen['--dsw-alias-state-success-primary'].dark === '#00FF88', '自定义 palette.green → 成功态色')
  /* prose 也吃自定义覆盖 —— 但默认档位是 soft（会提亮），所以这里显式关掉亮度，
     单独验证"覆盖传导"这一件事，不与亮度混在一起。 */
  const proseTokens = resolveProseTokens({ ...DEFAULTS, proseBoost: 'off', custom: JSON.stringify({ 'palette.green': '#00FF88' }) })
  check(proseTokens['--dmt-prose-code'].dark === '#00FF88', '自定义 palette.green → 正文行内代码色（prose 也吃覆盖，off 档）')

  /* 非法输入防御：坏 JSON / 未知键 / 非法色值都必须被忽略。 */
  const badInputs = [
    ['不是 JSON', '{not json'],
    ['数组', '[1,2,3]'],
    ['null', 'null'],
    ['未知槽位', JSON.stringify({ 'surface.nope': '#FFFFFF' })],
    ['非法色值', JSON.stringify({ 'surface.base': 'red' })],
    ['简写 hex 合法', JSON.stringify({ 'surface.base': '#abc' })],
    ['注入尝试', JSON.stringify({ 'surface.base': 'red;}body{display:none' })],
  ]
  for (const [label, raw] of badInputs) {
    let threw = null
    let tokens = null
    try {
      tokens = resolveTokens({ ...DEFAULTS, custom: raw })
    } catch (error) {
      threw = error
    }
    check(threw === null, `自定义输入不抛异常：${label}`, threw ? threw.message : '')
    if (tokens !== null) {
      const bg = tokens['--dsw-alias-bg-base'].dark
      const legal = /^#[0-9a-f]{3,8}$/i.test(bg) || /^color-mix\(/.test(bg)
      check(legal, `非法输入不污染底色：${label}`, bg)
    }
  }

  /* parseCustom 的过滤行为。 */
  const parsed = parseCustom(JSON.stringify({ 'surface.base': '#112233', 'palette.fg': '#ABCDEF', 'surface.nope': '#000000', 'palette.dim': 'nothex' }))
  check(Object.keys(parsed.surface).length === 1 && parsed.surface.base === '#112233', 'parseCustom 只留合法槽位（surface）')
  check(Object.keys(parsed.palette).length === 1 && parsed.palette.fg === '#ABCDEF', 'parseCustom 只留合法槽位（palette）')

  /* serializeCustom：空覆盖 → 空串；与默认相同 → 应被调用方删掉（这里测序列化本身）。 */
  check(serializeCustom({ palette: {}, surface: {} }) === '', '空覆盖序列化成空串')
  check(serializeCustom(null) === '', 'null 覆盖序列化成空串')
  const serialized = serializeCustom({ palette: { fg: '#FFFFFF' }, surface: { base: '#000000' } })
  check(serialized.includes('palette.fg') && serialized.includes('surface.base'), '序列化用扁平 path', serialized)
  check(JSON.parse(serialized)['palette.fg'] === '#FFFFFF', '序列化结果可被 JSON.parse 还原')

  /* normalizeCustom：扁平与分组两种输入都要能吃。 */
  const fromFlat = normalizeCustom({ 'surface.base': '#111111' })
  check(fromFlat.surface.base === '#111111', 'normalizeCustom 接受扁平 path')
  const fromGrouped = normalizeCustom({ surface: { base: '#222222' }, palette: { fg: '#333333' } })
  check(fromGrouped.surface.base === '#222222' && fromGrouped.palette.fg === '#333333', 'normalizeCustom 接受分组对象')

  /* ---- 浅色外观不受自定义影响（刻意的设计约束）---- */
  const lightUnaffected = resolveTokens({ ...DEFAULTS, custom: JSON.stringify({ 'surface.base': '#101418', 'palette.fg': '#FFEEDD' }) })
  check(lightUnaffected['--dsw-alias-bg-base'].light !== '#101418', '自定义不覆盖浅色底色（刻意）', lightUnaffected['--dsw-alias-bg-base'].light)
  check(lightUnaffected['--dsw-alias-label-primary'].light !== '#FFEEDD', '自定义不覆盖浅色正文色（刻意）')

  /* ---- B. 配色方案 ---- */
  console.log('')
  console.log('B. 配色方案')

  check(parsePresets('') .length === 0, '空串 → 无方案')
  check(parsePresets('坏 JSON').length === 0, '坏 JSON → 无方案（不抛）')
  check(parsePresets('{"a":1}').length === 0, '对象而非数组 → 无方案')

  const sample = [
    { name: '夜蓝', at: 1700000000000, surface: 'deep', accent: 'blue', custom: { 'palette.fg': '#E0E8F0' } },
    { name: '低对比', at: 1700000001000, surface: 'dim', accent: 'orange', custom: {} },
  ]
  const parsedPresets = parsePresets(JSON.stringify(sample))
  check(parsedPresets.length === 2, '解析出 2 套方案', String(parsedPresets.length))
  check(parsedPresets[0].name === '夜蓝' && parsedPresets[0].surface === 'deep', '方案字段完整', JSON.stringify(parsedPresets[0]))
  check(parsedPresets[0].custom['palette.fg'] === '#E0E8F0', '方案内自定义覆盖保留')

  /* 坏条目被跳过，好条目保留。 */
  const mixed = parsePresets(JSON.stringify([
    { name: '好的', at: 1, surface: 'standard', accent: 'teal', custom: {} },
    { at: 2 },
    { name: '', at: 3 },
    { name: '缺字段的' },
    null,
  ]))
  check(mixed.length === 2, '跳过坏条目，保留合法条目', mixed.map((p) => p.name).join(', '))
  check(mixed[1].surface === 'standard' && mixed[1].accent === 'teal', '缺字段条目补默认值', JSON.stringify(mixed[1]))

  /* 上限：超过 MAX_PRESETS 截断。 */
  const many = Array.from({ length: MAX_PRESETS + 5 }, (_, i) => ({ name: 'p' + i, at: i, surface: 'standard', accent: 'teal', custom: {} }))
  check(parsePresets(JSON.stringify(many)).length === MAX_PRESETS, `方案数上限 ${MAX_PRESETS} 生效`)

  /* 载入方案 = 把 surface/accent/custom 写回设置，令牌应当对应变化。 */
  const loaded = resolveTokens({ ...DEFAULTS, surface: 'deep', accent: 'blue', custom: JSON.stringify({ 'palette.fg': '#E0E8F0' }) })
  check(loaded['--dsw-alias-bg-base'].dark === SURFACES.deep.base, '载入方案后底色 = 该方案的 surface', loaded['--dsw-alias-bg-base'].dark)
  check(loaded['--dsw-alias-state-business-primary'].dark === ACCENTS.blue.dark, '载入方案后强调色 = 该方案的 accent', loaded['--dsw-alias-state-business-primary'].dark)
  check(loaded['--dsw-alias-label-primary'].dark === '#E0E8F0', '载入方案后自定义覆盖生效')

  /* ---- C. 对比度提示 ---- */
  console.log('')
  console.log('C. 对比度提示')

  const goodContrast = contrastRatio('#D8DEE9', '#343D46')
  check(goodContrast > 7, 'Mariana 默认正文/背景对比度 > 7:1', goodContrast.toFixed(2) + ':1')

  const badContrast = contrastRatio('#3A4048', '#343D46')
  check(badContrast < 4.5, '接近的深灰对深灰 → 对比度 < 4.5（会触发提示）', badContrast.toFixed(2) + ':1')

  check(contrastRatio('nothex', '#343D46') === 0, '非法色值 → 对比度 0（不抛）')
  check(contrastRatio('#000000', '#FFFFFF') > 20, '黑白对比度 > 20:1', contrastRatio('#000000', '#FFFFFF').toFixed(2) + ':1')
  /* 简写 hex 也要能算。 */
  check(Math.abs(contrastRatio('#fff', '#000') - contrastRatio('#ffffff', '#000000')) < 0.001, '简写 hex 与完整 hex 结果一致')

  /* ---- D. 槽位覆盖完整性 ---- */
  console.log('')
  console.log('D. 槽位完整性')

  /* 每个槽位都必须真实存在（否则界面调了没反应）。 */
  for (const slot of CUSTOM_SLOTS) {
    const [group, key] = slot.path.split('.')
    const exists = group === 'palette' ? key in PALETTE : Object.values(SURFACES).some((surface) => key in surface)
    check(exists, `槽位对应真实字段：${slot.path}`, group + '.' + key)
  }

  /* 每个槽位改一次，都必须真的改变某个令牌（否则是死槽位）。 */
  const deadSlots = []
  for (const slot of CUSTOM_SLOTS) {
    const probe = resolveTokens({ ...DEFAULTS, custom: JSON.stringify({ [slot.path]: '#FF00FF' }) })
    const baseline = resolveTokens({ ...DEFAULTS, custom: '' })
    const changed = Object.keys(probe).some((name) => probe[name].dark !== baseline[name].dark)
    if (!changed) deadSlots.push(slot.path)
  }
  check(deadSlots.length === 0, '没有死槽位（每个槽位都能改到至少一个令牌）', deadSlots.join(', '))

  /* 分组标签齐全（界面按这三个分组渲染）。 */
  const groups = [...new Set(CUSTOM_SLOTS.map((slot) => slot.group))]
  check(groups.length === 3, '槽位分 3 组', groups.join(' / '))
  for (const group of ['界面底色', '文字', '语法色']) {
    check(groups.includes(group), `分组存在：${group}`)
  }

  /* ---- E. 正文高亮亮度档位 ---- */
  console.log('')
  console.log('E. 正文高亮亮度档位')

  const { PROSE_BOOSTS, lightenHex } = test
  check(PROSE_BOOSTS !== undefined && Object.keys(PROSE_BOOSTS).length === 3, 'PROSE_BOOSTS 有 3 档', Object.keys(PROSE_BOOSTS || {}).join(', '))
  check(typeof lightenHex === 'function', 'lightenHex 已导出')

  /* lightenHex 基本行为。 */
  check(lightenHex('#000000', 1) === '#FFFFFF', 't=1 把纯白化')
  check(lightenHex('#000000', 0) === '#000000', 't=0 原样返回')
  /* 128 + (255-128)*0.5 = 191.5 → 取整 192 = 0xC0。 */
  check(lightenHex('#808080', 0.5) === '#C0C0C0', 't=0.5 中灰提亮', lightenHex('#808080', 0.5))
  check(lightenHex('#abc', 0.18) === lightenHex('#AABBCC', 0.18), '简写与完整 hex 提亮结果一致')
  check(lightenHex('notacolor', 0.5) === 'notacolor', '非法输入原样返回，不抛')
  check(lightenHex('#FF0000', -1) === '#FF0000', '负 t 按原值处理')
  /* 提亮必须单调变亮（每通道都朝 255 靠）。 */
  const step1 = lightenHex('#5FB3B3', 0.18)
  const step2 = lightenHex('#5FB3B3', 0.32)
  check(contrastRatio(step1, '#000000') > contrastRatio('#5FB3B3', '#000000'), '提亮后亮度上升（对黑对比度变大）')
  check(contrastRatio(step2, '#000000') > contrastRatio(step1, '#000000'), '档位越高越亮')

  /* 三档的 prose 令牌：off 等于原值，soft/strong 逐级更亮。 */
  const proseOff = resolveProseTokens({ ...DEFAULTS, proseBoost: 'off' })
  const proseSoft = resolveProseTokens({ ...DEFAULTS, proseBoost: 'soft' })
  const proseStrong = resolveProseTokens({ ...DEFAULTS, proseBoost: 'strong' })
  check(proseOff['--dmt-prose-heading'].dark === PALETTE.teal, 'off 档 = Mariana 原值', proseOff['--dmt-prose-heading'].dark)
  check(proseSoft['--dmt-prose-heading'].dark !== PALETTE.teal, 'soft 档已提亮', proseSoft['--dmt-prose-heading'].dark)
  check(
    contrastRatio(proseSoft['--dmt-prose-heading'].dark, '#000000') > contrastRatio(proseOff['--dmt-prose-heading'].dark, '#000000'),
    'soft 比 off 亮',
  )
  check(
    contrastRatio(proseStrong['--dmt-prose-heading'].dark, '#000000') > contrastRatio(proseSoft['--dmt-prose-heading'].dark, '#000000'),
    'strong 比 soft 亮',
  )

  /* 未知档位回落到 off（不能因为手改 profile 写了个错值就崩）。 */
  const proseBogus = resolveProseTokens({ ...DEFAULTS, proseBoost: 'nope' })
  check(proseBogus['--dmt-prose-heading'].dark === proseOff['--dmt-prose-heading'].dark, '未知档位回落 off')
  /* 缺字段回落 off：注意不能 spread DEFAULTS（它自带 proseBoost:'soft'），
     要构造一个真的没有这个键的对象。 */
  const proseMissing = resolveProseTokens({ custom: '' })
  check(proseMissing['--dmt-prose-heading'].dark === proseOff['--dmt-prose-heading'].dark, '缺字段回落 off')

  /* **浅色值不受亮度影响**（浅色是深字浅底，朝白插值会降低对比度）。 */
  for (const name of ['--dmt-prose-heading', '--dmt-prose-strong', '--dmt-prose-code', '--dmt-prose-link', '--dmt-prose-del']) {
    check(proseSoft[name].light === proseOff[name].light, `浅色值不随亮度变：${name}`, proseOff[name].light)
  }

  /* 亮度只动 prose 令牌，不动代码高亮与界面令牌（作用域隔离）。 */
  const tokensOff = resolveTokens({ ...DEFAULTS, proseBoost: 'off' })
  const tokensSoft = resolveTokens({ ...DEFAULTS, proseBoost: 'soft' })
  check(
    tokensOff['--shiki-token-keyword'].dark === tokensSoft['--shiki-token-keyword'].dark,
    '亮度不影响代码块语法色（只作用于正文）',
  )
  check(
    tokensOff['--dsw-alias-label-primary'].dark === tokensSoft['--dsw-alias-label-primary'].dark,
    '亮度不影响正文基准色 label-primary',
  )
  check(
    tokensOff['--dsw-alias-bg-base'].dark === tokensSoft['--dsw-alias-bg-base'].dark,
    '亮度不影响界面底色',
  )

  /* 提亮后仍要够得着对比度下限（在三种背景变体上）。 */
  const bgVariants = { standard: '#343D46', deep: '#252B32', dim: '#2B333C' }
  for (const [surfaceName, bg] of Object.entries(bgVariants)) {
    for (const [name, minimum] of [['--dmt-prose-em', 4.5], ['--dmt-prose-strong', 4.5], ['--dmt-prose-heading', 4.5], ['--dmt-prose-link', 4.5]]) {
      const ratio = contrastRatio(proseSoft[name].dark, bg)
      check(ratio >= minimum, `soft 档 ${name} 在 ${surfaceName} 上 ≥ ${minimum}:1`, ratio.toFixed(2) + ':1')
    }
  }
  /* 提亮不能把"次级文字"提到和正文一样 —— 那样层次就没了。 */
  const emVsBody = contrastRatio(proseSoft['--dmt-prose-em'].dark, PALETTE.fg)
  check(emVsBody > 1.15, 'soft 档次级文字仍明显弱于正文（层次未消失）', emVsBody.toFixed(2) + ':1')
  const emVsBodyStrong = contrastRatio(proseStrong['--dmt-prose-em'].dark, PALETTE.fg)
  check(emVsBodyStrong > 1.15, 'strong 档次级文字仍与正文有层次', emVsBodyStrong.toFixed(2) + ':1')

  /* 自定义配色 + 亮度可以叠加：先覆盖再提亮。 */
  const proseBoth = resolveProseTokens({ ...DEFAULTS, proseBoost: 'soft', custom: JSON.stringify({ 'palette.green': '#00FF88' }) })
  check(proseBoth['--dmt-prose-code'].dark === lightenHex('#00FF88', PROSE_BOOSTS.soft.t), '自定义色 + 亮度可叠加', proseBoth['--dmt-prose-code'].dark)
  check(proseBoth['--dmt-prose-code'].dark !== '#00FF88', '叠加后确实被提亮（不等于自定义原值）')

  /* ---- F. 正文颜色手挑（proseColors）---- */
  console.log('')
  console.log('F. 正文颜色手挑')

  const { PROSE_COLOR_SLOTS, parseProseColors } = test
  check(Array.isArray(PROSE_COLOR_SLOTS) && PROSE_COLOR_SLOTS.length === 9, 'PROSE_COLOR_SLOTS 有 9 个槽位', String((PROSE_COLOR_SLOTS || []).length))
  check(typeof parseProseColors === 'function', 'parseProseColors 已导出')

  /* 手挑色直接生效，且**不再叠加亮度**（所见即所得）。 */
  const picked = resolveProseTokens({ ...DEFAULTS, proseColors: JSON.stringify({ heading: '#112233' }) })
  check(picked['--dmt-prose-heading'].dark === '#112233', '手挑 heading 原样生效（不叠加亮度）', picked['--dmt-prose-heading'].dark)
  const pickedStrong = resolveProseTokens({ ...DEFAULTS, proseBoost: 'strong', proseColors: JSON.stringify({ heading: '#112233' }) })
  check(pickedStrong['--dmt-prose-heading'].dark === '#112233', '手挑色不受亮度档影响', pickedStrong['--dmt-prose-heading'].dark)
  /* 未手挑的槽位仍走派生。 */
  check(picked['--dmt-prose-strong'].dark === proseSoft['--dmt-prose-strong'].dark, '未手挑的槽位仍跟随派生')

  /* 非法输入防御。 */
  check(Object.keys(parseProseColors('')).length === 0, '空串 → 无覆盖')
  check(Object.keys(parseProseColors('坏json')).length === 0, '坏 JSON → 无覆盖')
  check(Object.keys(parseProseColors('[1,2]')).length === 0, '数组 → 无覆盖')
  check(Object.keys(parseProseColors(JSON.stringify({ nope: '#FFFFFF' }))).length === 0, '未知键被忽略')
  check(Object.keys(parseProseColors(JSON.stringify({ heading: 'red' }))).length === 0, '非法色值被忽略')
  const injected = parseProseColors(JSON.stringify({ heading: '#112233', __proto__: 'x' }))
  check(injected.heading === '#112233', '合法键保留', injected.heading)
  /* 注入的键不会污染令牌层。 */
  const injectTokens = resolveProseTokens({ ...DEFAULTS, proseColors: JSON.stringify({ heading: 'red;}body{display:none' }) })
  check(injectTokens['--dmt-prose-heading'].dark === proseSoft['--dmt-prose-heading'].dark, '非法注入值回落派生色')

  /* 每个槽位都不是死槽位：挑一次必须改到对应令牌。 */
  for (const slot of PROSE_COLOR_SLOTS) {
    const one = resolveProseTokens({ ...DEFAULTS, proseColors: JSON.stringify({ [slot.key]: '#0A0B0C' }) })
    check(one[slot.token].dark === '#0A0B0C', `正文槽位可挑：${slot.key}`, one[slot.token].dark)
  }
  /* 挑一个不能牵连别的（隔离）。 */
  const isolated = resolveProseTokens({ ...DEFAULTS, proseColors: JSON.stringify({ heading: '#0A0B0C' }) })
  const untouched = PROSE_COLOR_SLOTS.filter((slot) => slot.key !== 'heading')
  check(
    untouched.every((slot) => isolated[slot.token].dark === proseSoft[slot.token].dark),
    '挑一个正文色不牵连其它槽位',
  )
  /* 正文手挑不影响代码高亮与界面令牌。 */
  const tokensPicked = resolveTokens({ ...DEFAULTS, proseColors: JSON.stringify({ heading: '#0A0B0C' }) })
  check(
    tokensPicked['--shiki-token-function'].dark === resolveTokens(DEFAULTS)['--shiki-token-function'].dark,
    '正文手挑不影响代码块函数色（作用域隔离）',
  )
  check(
    tokensPicked['--dsw-alias-label-primary'].dark === resolveTokens(DEFAULTS)['--dsw-alias-label-primary'].dark,
    '正文手挑不影响界面正文色',
  )

  const failed = results.filter((result) => !result.ok)
  console.log('─'.repeat(52))
  if (failed.length > 0) {
    console.log(`✗ ${failed.length}/${results.length} 项失败`)
    process.exit(1)
  }
  console.log(`✓ ${results.length} 项全部通过`)
}

main()
