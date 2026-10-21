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

/**
 * OKLCH 模块的函数在嵌入时**统一加 ok 前缀**。
 * 插件自己已有 contrastRatio / hexToRgb 这类同名函数，
 * 同一个作用域里重名不会报错，只会**后者静默覆盖前者**。
 * tools/oklch.mjs 本身保持原名（scripts/oklch.test.mjs 直接 import 它）。
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

/** 按映射表批量改标识符。 */
function renameIdents(source, map) {
  let out = source
  for (const [from, to] of Object.entries(map)) {
    out = out.replace(new RegExp('\\b' + from + '\\b', 'g'), to)
  }
  return out
}

/** 把 client.js 里 start…end 之间换成新内容。 */
function spliceBlock(source, startMark, endMark, content, label) {
  const from = source.indexOf(startMark)
  if (from === -1) {
    console.error('client.js 里找不到生成区起点（' + label + '）')
    process.exit(1)
  }
  const to = source.indexOf(endMark, from)
  if (to === -1) {
    console.error('client.js 里找不到生成区终点（' + label + '）')
    process.exit(1)
  }
  return source.slice(0, from) + content + source.slice(to + endMark.length)
}

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
source = spliceBlock(source, START, END, block, 'tex')

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
    '       感知均匀的亮度调整：背景层光斑、hover 提亮都走它。 */',
    '',
    oklch,
    '',
    '    ' + OK_END,
  ].join('\n')
  source = spliceBlock(source, OK_START, OK_END, okBlock, 'oklch')
}

writeFileSync(clientPath, source)

const kb = (n) => (n / 1024).toFixed(1) + ' KB'
console.log(`语法 ${kb(grammar.length)} ｜ 配色 ${kb(colors.length)} ｜ ` +
  `分词器 ${kb(tokenizer.length)} ｜ 配色器 ${kb(colorizer.length)}`)
console.log(`client.js 写入完成: ${kb(source.length)}`)
