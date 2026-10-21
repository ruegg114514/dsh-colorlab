#!/usr/bin/env node
/**
 * 把 Sublime 语法、Mariana 规则、分词器与配色器注入 client.js。
 *
 * `tools/tex-tokenizer.mjs` / `tools/tex-colors.mjs` / `tools/*.json` 是**唯一真源**，
 * client.js 里那段是**生成物** —— 手改会被覆盖。改动请改 tools/，然后跑：
 *
 *     node tools/embed-tex-assets.mjs
 *
 * 生成区在 client.js 的
 *     /* @dsh-tex-assets:start *​/ … /* @dsh-tex-assets:end *​/
 * 之间。测试会校验生成区与真源一致（防止有人手改了忘了重新生成）。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const START = '/* @dsh-tex-assets:start'
const END = '/* @dsh-tex-assets:end */'

/** 去掉 ESM 导出，让源码能直接贴进插件工厂函数内部。 */
function stripExports(source) {
  return source
    .split('\n')
    .filter((line) => !/^export\s+default\s/.test(line))
    .map((line) => line.replace(/^export\s+(?=(?:async\s+)?function|const|let|var|class)/, ''))
    .join('\n')
}

/**
 * OKLCH 模块的函数在嵌入时**统一加 `ok` 前缀**。
 *
 * 为什么必须改名：插件自己早就有 `contrastRatio` / `hexToRgb` 这类同名函数，
 * 而这里是**同一个作用域**里的函数声明 —— 重名不会报错，只会**后者静默覆盖前者**。
 * 实测后果：对比度计算被换成 OKLCH 那份（对非法输入返回 null 而不是 0），
 * 6 条既有断言无声挂掉。加前缀是最省事也最难再犯的隔离方式。
 *
 * `tools/oklch.mjs` 本身**保持原名不变**（`scripts/oklch.test.mjs` 直接 import 它）。
 */
const OKLCH_RENAME = Object.freeze({
  hexToRgb: 'okHexToRgb',
  rgbToHex: 'okRgbToHex',
  srgbToOklab: 'okSrgbToOklab',
  oklabToSrgb: 'okOklabToSrgb',
  oklchFromHex: 'okOklchFromHex',
  hexFromOklch: 'okHexFromOklch',
  adjustLightness: 'okAdjustLightness',
  adjustChroma: 'okAdjustChroma',
  mixOklch: 'okMixOklch',
  withAlpha: 'okWithAlpha',
  contrastRatio: 'okContrastRatio',
})

/** 按映射表批量改标识符（注释里也会被改，无害）。 */
function renameIdents(source, map) {
  let out = source
  for (const [from, to] of Object.entries(map)) {
    out = out.replace(new RegExp('\\b' + from + '\\b', 'g'), to)
  }
  return out
}

/**
 * 把 client.js 里 `start … end` 之间那段换成新内容。
 * 两段生成区共用这个函数；找不到标记就直接报错退出（宁可红也不要静默不生成）。
 */
function spliceBlock(source, startMark, endMark, content, label) {
  const from = source.indexOf(startMark)
  if (from === -1) {
    console.error(`client.js 里找不到生成区起点（${label}）`)
    process.exit(1)
  }
  const to = source.indexOf(endMark, from)
  if (to === -1) {
    console.error(`client.js 里找不到生成区终点（${label}）`)
    process.exit(1)
  }
  return source.slice(0, from) + content + source.slice(to + endMark.length)
}

const grammar = readFileSync(join(here, 'tex-grammar.json'), 'utf8').trim()
const colors = readFileSync(join(here, 'mariana-colors.json'), 'utf8').trim()
const tokenizer = stripExports(readFileSync(join(here, 'tex-tokenizer.mjs'), 'utf8')).trim()
const colorizer = stripExports(readFileSync(join(here, 'tex-colors.mjs'), 'utf8')).trim()

const block = [
  START + ' —— 由 tools/embed-tex-assets.mjs 生成，请勿手改。',
  '     改动请改 tools/ 下的真源，然后重新运行：node tools/embed-tex-assets.mjs */',
  '',
  '    /* Sublime LaTeX/TeX 语法（编译自 LaTeX.sublime-syntax + TeX.sublime-syntax）。',
  '       体积较大，所以放在工厂函数末尾，不占前面的可读性。 */',
  '    const TEX_GRAMMAR = ' + grammar,
  '',
  '    /* Mariana 的 scope → 颜色规则（编译自 Mariana.sublime-color-scheme）。 */',
  '    const TEX_COLORS = ' + colors,
  '',
  '    /* ---- 分词器（真源：tools/tex-tokenizer.mjs）---- */',
  '',
  tokenizer,
  '',
  '    /* ---- 配色器（真源：tools/tex-colors.mjs）---- */',
  '',
  colorizer,
  '',
  '    ' + END,
].join('\n')

const clientPath = join(root, 'client.js')
let source = readFileSync(clientPath, 'utf8')

/* ---- 第一段：LaTeX 语法 / 分词器 / 配色器 ---- */
source = spliceBlock(source, START, END, block, 'tools/tex-*')

/* ---- 第二段：OKLCH 色彩科学（真源 tools/oklch.mjs）---- */
{
  const OK_START = '/* @dsh-oklch:start'
  const OK_END = '/* @dsh-oklch:end */'
  const oklch = renameIdents(stripExports(readFileSync(join(here, 'oklch.mjs'), 'utf8')), OKLCH_RENAME).trim()
  const okBlock = [
    OK_START + ' —— 由 tools/embed-tex-assets.mjs 生成，请勿手改。',
    '     改动请改 tools/oklch.mjs，然后重新运行：node tools/embed-tex-assets.mjs */',
    '',
    '    /* ---- OKLCH 色彩科学（真源：tools/oklch.mjs）----',
    '       感知均匀的亮度/彩度调整：hover 提亮、调色都走它，',
    '       而不是在 sRGB/HSL 里线性插值（那样同样步长在深色和浅色上观感不一致）。 */',
    '',
    oklch,
    '',
    '    ' + OK_END,
  ].join('\n')
  source = spliceBlock(source, OK_START, OK_END, okBlock, 'tools/oklch.mjs')
}

writeFileSync(clientPath, source)

const kb = (n) => (n / 1024).toFixed(1) + ' KB'
console.log(`语法 ${kb(grammar.length)} ｜ 配色 ${kb(colors.length)} ｜ ` +
  `分词器 ${kb(tokenizer.length)} ｜ 配色器 ${kb(colorizer.length)}`)
console.log(`client.js: ${kb(source.length)} → ${kb(updated.length)}`)
