#!/usr/bin/env node
/**
 * OKLCH 色彩科学模块（`tools/oklch.mjs`）的回归测试。
 *
 * 为什么单独一个套件：`client.js` 的主题调色、对比度提示、取色器都建立在
 * 这个模块上。矩阵抄错一位、gamma 编解码漏掉，UI 上只会表现为"颜色有点怪"，
 * 肉眼很难判定。所以这里拿**公认的参考值**当锚点，把数学部分钉死。
 *
 * 覆盖范围：
 *   1. 往返精度（hex → OKLab → hex、hex → OKLCH → hex）
 *   2. Ottosson 官方参考锚点（纯白/纯黑/纯红/纯绿/纯蓝 + Mariana 主色）
 *   3. adjustLightness / adjustChroma
 *   4. mixOklch（端点精确、中点在 OKLab 里居中）
 *   5. withAlpha（含 0.5 → 0x80 的舍入口径）
 *   6. contrastRatio（WCAG，与 OKLab 无关）
 *   7. 非法输入不抛异常、超界 L 不抛异常
 *
 * 关于 `#6699CC` 的 OKLCH 亮度 —— 历史备注，别改：
 *   它的 L 是 **0.6676**（不是"约 0.66"）。这是官方 M1/M2 矩阵 + 手工独立
 *   核对（sRGB→linear→M1→cbrt→M2 得 0.66763）得到的值，oklch 转换器口径
 *   也一致（oklch(66.76% 0.094 249.4)）。所以下面的锚点区间是 [0.65, 0.69]，
 *   早先有人凭印象写过 0.62~0.66，那是个套不住真实值的错误区间，别改回去。
 *
 * 只依赖被测模块自身，不 import 任何第三方包。
 */

import {
  hexToRgb,
  rgbToHex,
  srgbToOklab,
  oklabToSrgb,
  oklchFromHex,
  hexFromOklch,
  adjustLightness,
  adjustChroma,
  mixOklch,
  withAlpha,
  contrastRatio,
} from '../tools/oklch.mjs'

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
 * 小工具
 * ------------------------------------------------------------------ */

const HEX6 = /^#[0-9a-f]{6}$/
const HEX8 = /^#[0-9a-f]{8}$/
/** 每个通道允许的量化误差（往返时至少要能精确还原到 8 位 hex）。 */
const CHANNEL_TOLERANCE = 1 / 255

/** 数值是否落在期望值 ±tol 内（非有限值一律算失败）。 */
function close(value, expected, tol) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value - expected) <= tol
}

/** 某通道的绝对误差。 */
function channelError(a, b) {
  return Math.abs(a - b)
}

/** hex → 三个通道的 0..1 数组。 */
function channels(hex) {
  const rgb = hexToRgb(hex)
  return [rgb.r, rgb.g, rgb.b]
}

/** hex 两个颜色的逐通道最大误差。 */
function hexError(actual, expected) {
  const a = channels(actual)
  const b = channels(expected)
  return Math.max(channelError(a[0], b[0]), channelError(a[1], b[1]), channelError(a[2], b[2]))
}

/** 某颜色的 OKLab 坐标。 */
function labOf(hex) {
  return srgbToOklab(hexToRgb(hex))
}

/** 两个角度之间的最短夹角（0..180 度）。 */
function hueDelta(a, b) {
  const raw = Math.abs(a - b) % 360
  return Math.min(raw, 360 - raw)
}

/** 展平小数点，便于打印。 */
function num(value, digits = 6) {
  return typeof value === 'number' ? value.toFixed(digits) : String(value)
}

/**
 * 执行 fn 并吞掉异常：**没抛**返回 null，抛了返回那个 error 对象。
 * 用来断言"非法输入只返 null，不许崩"。
 */
function thrownBy(fn) {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}

/* ------------------------------------------------------------------ *
 * 1. 往返精度
 * ------------------------------------------------------------------ */

console.log('  往返精度（hex → OKLab → hex / hex → OKLCH → hex）')

/** 代表性颜色：两端极值、饱和原色、Mariana 三个主色、随机中间色。 */
const ROUNDTRIP_COLORS = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#6699CC',
  '#5FB4B4',
  '#F9AE58',
  '#123456',
  '#808080',
  '#f0f0f0',
  '#7f3fbf',
]

for (const hex of ROUNDTRIP_COLORS) {
  const labRound = rgbToHex(oklabToSrgb(srgbToOklab(hexToRgb(hex))))
  const labErr = hexError(labRound, hex)
  check(
    labErr <= CHANNEL_TOLERANCE + 1e-12,
    `${hex} hex → OKLab → hex 每通道误差 ≤ 1/255`,
    `最大 ${num(labErr * 255, 4)}/255，得到 ${labRound}`,
  )

  const lchRound = hexFromOklch(oklchFromHex(hex))
  const lchErr = hexError(lchRound, hex)
  check(
    lchErr <= CHANNEL_TOLERANCE + 1e-12,
    `${hex} hex → OKLCH → hex 每通道误差 ≤ 1/255`,
    `最大 ${num(lchErr * 255, 4)}/255，得到 ${lchRound}`,
  )
}

{
  /* oklabToSrgb 的输出必须始终落在 0..1，哪怕是色域外输入。 */
  const wide = oklabToSrgb({ L: 0.9, a: 0.6, b: -0.6 })
  check(
    [wide.r, wide.g, wide.b].every((c) => c >= 0 && c <= 1),
    'oklabToSrgb 色域外输入被 clamp 到 0..1',
    `${num(wide.r, 4)}, ${num(wide.g, 4)}, ${num(wide.b, 4)}`,
  )
}

/* ------------------------------------------------------------------ *
 * 2. Ottosson 官方锚点
 *
 * 参考：https://bottosson.github.io/posts/oklab/
 * 红/绿/蓝的 L 是公认参考值 0.62796 / 0.86644 / 0.45201。这三个对上，
 * 基本就锁死矩阵没抄错了。
 * ------------------------------------------------------------------ */

console.log('')
console.log('  Ottosson 官方锚点')

check(close(labOf('#ffffff').L, 1, 0.001), '纯白 OKLab L ≈ 1.0', num(labOf('#ffffff').L))
check(close(labOf('#000000').L, 0, 1e-12), '纯黑 OKLab L = 0', num(labOf('#000000').L))
check(
  Math.abs(labOf('#000000').a) <= 1e-12 && Math.abs(labOf('#000000').b) <= 1e-12,
  '纯黑 OKLab a = b = 0（完全中性）',
  `${num(labOf('#000000').a, 12)}, ${num(labOf('#000000').b, 12)}`,
)

check(close(labOf('#ff0000').L, 0.627955, 0.002), '纯红 L ≈ 0.627955', num(labOf('#ff0000').L))
check(close(labOf('#00ff00').L, 0.866440, 0.002), '纯绿 L ≈ 0.866440', num(labOf('#00ff00').L))
check(close(labOf('#0000ff').L, 0.452014, 0.002), '纯蓝 L ≈ 0.452014', num(labOf('#0000ff').L))

{
  /* 中性色的 C 只剩矩阵浮点残差（~1e-8），必须远小于 1e-6，且色相无意义 → 0。 */
  const white = oklchFromHex('#ffffff')
  const grey = oklchFromHex('#808080')
  check(white.C < 1e-6, '纯白 C < 1e-6（中性，无彩度）', num(white.C, 12))
  check(grey.C < 1e-6, '灰阶 #808080 C < 1e-6（中性，无彩度）', num(grey.C, 12))
  check(white.h === 0 && grey.h === 0, '中性色的色相固定为 0（C 太小无意义）', `${white.h} / ${grey.h}`)
}

{
  /* Mariana 主色 #6699CC：区间见文件头备注（真实 L = 0.6676）。 */
  const lch = oklchFromHex('#6699CC')
  check(lch.L >= 0.65 && lch.L <= 0.69, '#6699CC L ∈ [0.65, 0.69]', num(lch.L))
  check(lch.C >= 0.08 && lch.C <= 0.11, '#6699CC C ∈ [0.08, 0.11]', num(lch.C))
  check(lch.h >= 245 && lch.h <= 255, '#6699CC h ∈ [245, 255]（蓝青方向）', num(lch.h, 3))
}

{
  /* 色相必须落在 [0, 360)。 */
  const hues = ['#ff0000', '#00ff00', '#0000ff', '#6699CC', '#5FB4B4', '#F9AE58'].map(
    (hex) => oklchFromHex(hex).h,
  )
  check(
    hues.every((h) => h >= 0 && h < 360),
    '所有色相都在 [0, 360) 区间',
    hues.map((h) => num(h, 1)).join(', '),
  )
}

/* ------------------------------------------------------------------ *
 * 3. adjustLightness
 * ------------------------------------------------------------------ */

console.log('')
console.log('  adjustLightness（感知均匀加减亮度）')

{
  const base = '#6699CC'
  const before = oklchFromHex(base)
  const up = adjustLightness(base, 0.1)
  const upLch = oklchFromHex(up)
  check(HEX6.test(up), 'adjustLightness 返回合法 hex', up)
  check(upLch.L > before.L, '加正值后 L 确实变大', `${num(before.L)} → ${num(upLch.L)}`)
  check(close(upLch.L - before.L, 0.1, 0.005), 'L 的增量 ≈ 0.1（sRGB 色域内未被削顶）', num(upLch.L - before.L))
  check(hueDelta(upLch.h, before.h) <= 2, '色相基本不变（≤ 2°）', `${num(before.h, 2)}° → ${num(upLch.h, 2)}°`)
  check(close(upLch.C, before.C, 0.005), '彩度基本不变（≤ 0.005）', `${num(before.C)} → ${num(upLch.C)}`)

  const down = adjustLightness(base, -0.1)
  const downLch = oklchFromHex(down)
  check(downLch.L < before.L, '加负值后 L 确实变小', `${num(before.L)} → ${num(downLch.L)}`)
  check(close(before.L - downLch.L, 0.1, 0.005), 'L 的减量 ≈ 0.1', num(before.L - downLch.L))
  check(hueDelta(downLch.h, before.h) <= 2, '压暗后色相仍基本不变（≤ 2°）', `${num(downLch.h, 2)}°`)
}

{
  /* 纯黑提亮：L 上去、仍是灰阶。 */
  const lifted = adjustLightness('#000000', 0.3)
  const liftedLch = oklchFromHex(lifted)
  const rgb = hexToRgb(lifted)
  check(lifted !== '#000000', '纯黑提亮后不再是黑色', lifted)
  check(close(liftedLch.L, 0.3, 0.005), '纯黑 +0.3 后 L ≈ 0.3', num(liftedLch.L))
  check(rgb.r === rgb.g && rgb.g === rgb.b, '纯黑提亮后仍是灰阶（R=G=B）', lifted)
  check(liftedLch.C < 1e-6, '纯黑提亮后 C ≈ 0（没有染色）', num(liftedLch.C, 12))
}

check(adjustLightness('#ffffff', 0.5) === '#ffffff', '纯白再加亮被 clamp 回 #ffffff')
check(adjustLightness('#000000', -0.5) === '#000000', '纯黑再压暗被 clamp 回 #000000')
check(adjustLightness('not-a-color', 0.1) === null, '非法输入返回 null（不抛异常）')
check(adjustLightness(null, 0.1) === null, 'null 输入返回 null（不抛异常）')

/* ------------------------------------------------------------------ *
 * 4. adjustChroma
 * ------------------------------------------------------------------ */

console.log('')
console.log('  adjustChroma（缩放彩度）')

{
  const base = '#6699CC'
  const before = oklchFromHex(base)

  const grey = adjustChroma(base, 0)
  const greyLch = oklchFromHex(grey)
  const greyRgb = hexToRgb(grey)
  check(HEX6.test(grey), 'factor = 0 返回合法 hex', grey)
  check(greyLch.C < 1e-6, 'factor = 0 → 完全去饱和（C ≈ 0）', num(greyLch.C, 12))
  check(greyRgb.r === greyRgb.g && greyRgb.g === greyRgb.b, 'factor = 0 → 输出灰阶（R=G=B）', grey)
  check(close(greyLch.L, before.L, 0.003), 'factor = 0 时 L 基本不变', `${num(before.L)} → ${num(greyLch.L)}`)

  const saturated = adjustChroma(base, 2)
  check(HEX6.test(saturated), 'factor = 2 返回合法 hex', saturated)
  check(oklchFromHex(saturated).C > before.C, 'factor = 2 → C 变大', `${num(before.C)} → ${num(oklchFromHex(saturated).C)}`)
  check(hueDelta(oklchFromHex(saturated).h, before.h) <= 2, 'factor = 2 色相基本不变（≤ 2°）', num(oklchFromHex(saturated).h, 2))

  const same = adjustChroma(base, 1)
  check(hexError(same, base) <= CHANNEL_TOLERANCE + 1e-12, 'factor = 1 等价于原色（往返无损）', same)
}

check(adjustChroma('#6699CC', NaN) !== null, 'factor 为 NaN 时不抛异常（按 1 处理）')
check(adjustChroma('rgb(1,2,3)', 0.5) === null, '非法输入返回 null（不抛异常）')

/* ------------------------------------------------------------------ *
 * 5. mixOklch
 * ------------------------------------------------------------------ */

console.log('')
console.log('  mixOklch（OKLab 线性插值）')

{
  const A = '#6699CC'
  const B = '#F9AE58'
  check(mixOklch(A, B, 0) === A.toLowerCase(), 't = 0 精确返回 A', mixOklch(A, B, 0))
  check(mixOklch(A, B, 1) === B.toLowerCase(), 't = 1 精确返回 B', mixOklch(A, B, 1))
  check(mixOklch(A, B, 0) === A.toLowerCase(), '大小写不敏感：端点仍是小写 hex', mixOklch(A, B, 0))

  const mid = mixOklch(A, B, 0.5)
  const labA = labOf(A)
  const labB = labOf(B)
  const labMid = labOf(mid)
  check(
    close(labMid.L, (labA.L + labB.L) / 2, 0.005) &&
      close(labMid.a, (labA.a + labB.a) / 2, 0.005) &&
      close(labMid.b, (labA.b + labB.b) / 2, 0.005),
    't = 0.5 的结果在 OKLab 里大致居中（每分量 ≤ 0.005）',
    `ΔL ${num(labMid.L - (labA.L + labB.L) / 2)} / Δa ${num(labMid.a - (labA.a + labB.a) / 2)} / Δb ${num(labMid.b - (labA.b + labB.b) / 2)}`,
  )

  const quarter = mixOklch(A, B, 0.25)
  const labQuarter = labOf(quarter)
  check(
    labQuarter.L > labA.L && labQuarter.L < labB.L,
    't = 0.25 落在两端之间（L 单调）',
    `${num(labA.L)} < ${num(labQuarter.L)} < ${num(labB.L)}`,
  )

  /* 黑 ↔ 白的中点：OKLab 里 L 应该是 0.5 的中性灰，而不是 sRGB 的 #808080。 */
  const bw = mixOklch('#000000', '#ffffff', 0.5)
  const bwLab = labOf(bw)
  check(HEX6.test(bw), '黑白混合返回合法 hex', bw)
  check(close(bwLab.L, 0.5, 0.005), '黑白 t = 0.5 的 L ≈ 0.5', num(bwLab.L))
  check(
    Math.hypot(bwLab.a, bwLab.b) < 1e-6,
    '黑白 t = 0.5 仍是中性灰（a ≈ b ≈ 0）',
    `a ${num(bwLab.a, 12)} / b ${num(bwLab.b, 12)}`,
  )
}

check(mixOklch('#6699CC', 'oops', 0.5) === null, 'B 非法时返回 null（不抛异常）')
check(mixOklch(null, '#6699CC', 0.5) === null, 'A 为 null 时返回 null（不抛异常）')

/* ------------------------------------------------------------------ *
 * 6. withAlpha
 *
 * 舍入口径：alpha 0.5 → 0.5 * 255 = 127.5 → round → 128 → 0x80。
 * 这个 0x80 是刻意约定的（不是 floor 出来的 0x7f），client.js 依赖它。
 * ------------------------------------------------------------------ */

console.log('')
console.log('  withAlpha（8 位 hex）')

check(withAlpha('#6699CC', 0.5) === '#6699cc80', '#6699CC + 0.5 → #6699cc80（127.5 进到 128）', withAlpha('#6699CC', 0.5))
check(withAlpha('#6699CC', 1) === '#6699ccff', 'alpha = 1 → ff', withAlpha('#6699CC', 1))
check(withAlpha('#6699CC', 0) === '#6699cc00', 'alpha = 0 → 00', withAlpha('#6699CC', 0))
check(withAlpha('#6699CC', 0.25) === '#6699cc40', 'alpha = 0.25 → 40（63.75 进到 64）', withAlpha('#6699CC', 0.25))
check(HEX8.test(withAlpha('#6699CC', 0.5)), '输出是 8 位 hex', withAlpha('#6699CC', 0.5))
check(withAlpha('#6699CC', 2) === '#6699ccff', 'alpha > 1 被 clamp 到 ff', withAlpha('#6699CC', 2))
check(withAlpha('#6699CC', -1) === '#6699cc00', 'alpha < 0 被 clamp 到 00', withAlpha('#6699CC', -1))

{
  /* 写出去再读回来，alpha 误差不超过一个量化步长。 */
  const back = hexToRgb(withAlpha('#6699CC', 0.25))
  check(close(back.a, 0.25, CHANNEL_TOLERANCE), 'withAlpha 的 alpha 可被 hexToRgb 读回（误差 ≤ 1/255）', num(back.a, 6))
  const opaque = hexToRgb(withAlpha('#6699CC', 1))
  check(opaque.a === 1, 'alpha = 1 读回正好是 1', num(opaque.a, 6))
}

check(withAlpha('#xyz', 0.5) === null, '非法输入返回 null（不抛异常）')

/* ------------------------------------------------------------------ *
 * 7. contrastRatio（WCAG 相对亮度，跟 OKLab 无关）
 * ------------------------------------------------------------------ */

console.log('')
console.log('  contrastRatio（WCAG）')

{
  const bw = contrastRatio('#000000', '#ffffff')
  check(close(bw, 21, 0.01), '纯黑对纯白 = 21（±0.01）', num(bw, 6))
  check(close(contrastRatio('#6699CC', '#6699CC'), 1, 1e-9), '同色对比度 = 1', num(contrastRatio('#6699CC', '#6699CC'), 6))
  check(
    contrastRatio('#6699CC', '#ffffff') === contrastRatio('#ffffff', '#6699CC'),
    '对比度与参数顺序无关（对称）',
  )

  const onBlack = contrastRatio('#000000', '#6699CC')
  const onWhite = contrastRatio('#ffffff', '#6699CC')
  check(onBlack > onWhite, '浅蓝在黑色上的对比度高于白色上', `${num(onBlack, 3)} > ${num(onWhite, 3)}`)
  check(onBlack >= 1 && onBlack <= 21 && onWhite >= 1 && onWhite <= 21, '对比度都落在 1..21 的合法区间', `${num(onBlack, 3)} / ${num(onWhite, 3)}`)
  check(onBlack >= 6.5 && onBlack <= 7.5, '#6699CC 对纯黑 ≈ 7（6.5~7.5）', num(onBlack, 3))
  check(onWhite >= 2.5 && onWhite <= 3.5, '#6699CC 对纯白 ≈ 3（2.5~3.5）', num(onWhite, 3))
}

check(contrastRatio('#6699CC', 'nope') === null, '非法输入返回 null（不抛异常）')

/* ------------------------------------------------------------------ *
 * 8. 非法输入与基础函数健壮性
 * ------------------------------------------------------------------ */

console.log('')
console.log('  非法输入与健壮性')

{
  const badInputs = [null, undefined, '', '#xyz', 'rgb(1,2,3)', '#12345', '#gggggg', 123, {}, 'red']
  const results = badInputs.map((value) => hexToRgb(value))
  check(
    results.every((value) => value === null),
    'hexToRgb 非法输入一律返回 null',
    results.map((value) => String(value)).join(', '),
  )
}

{
  /* 上面那些调用不能抛异常（任何一次抛都会让脚本在这里挂掉）。 */
  const boom = thrownBy(() =>
    [null, undefined, '', '#xyz', 'rgb(1,2,3)'].map((value) => hexToRgb(value)),
  )
  check(boom === null, 'hexToRgb 处理非法输入时不抛异常', boom === null ? '' : String(boom))

  const deriveBoom = thrownBy(() => [
    adjustLightness(null, 0.1),
    adjustChroma(null, 0.5),
    mixOklch(null, null, 0.5),
    withAlpha(null, 0.5),
    contrastRatio(null, null),
    oklchFromHex('nope'),
  ])
  check(deriveBoom === null, '各派生函数对非法输入不抛异常', deriveBoom === null ? '' : String(deriveBoom))
  check(
    oklchFromHex('nope') === null && hexFromOklch(undefined) !== null,
    'hexFromOklch(undefined) 也返回合法 hex 而不是崩',
    String(hexFromOklch(undefined)),
  )
}

check(rgbToHex({ r: -1, g: 2, b: 0.5 }) === '#00ff80', 'rgbToHex 把越界分量 clamp 到 0..1', rgbToHex({ r: -1, g: 2, b: 0.5 }))
check(rgbToHex({ r: 0.4, g: 0.6, b: 0.8 }) === '#6699cc', 'rgbToHex 输出小写 hex', rgbToHex({ r: 0.4, g: 0.6, b: 0.8 }))
check(hexToRgb('#6699CC') !== null, 'hexToRgb 接受大写 hex', JSON.stringify(hexToRgb('#6699CC')))
check(hexToRgb('#6699cc').a === 1, '6 位 hex 的 alpha 默认为 1', num(hexToRgb('#6699cc').a, 6))

{
  const rgba = hexToRgb('#6699cc80')
  const opaque = hexToRgb('#6699cc')
  check(rgba !== null && close(rgba.a, 0.5, 1 / 255), 'hexToRgb 解析 8 位 hex 的 alpha', num(rgba.a, 6))
  check(
    close(rgba.r, opaque.r, 1e-12) && close(rgba.g, opaque.g, 1e-12) && close(rgba.b, opaque.b, 1e-12),
    '8 位 hex 的 RGB 部分与 6 位一致',
  )
}

/* ------------------------------------------------------------------ *
 * 9. 边界：超界 L / 彩度
 * ------------------------------------------------------------------ */

console.log('')
console.log('  边界（超界输入不抛异常）')

{
  const outOfRange = [
    { L: 1.5, C: 0.2, h: 120 },
    { L: -2, C: 0.1, h: 10 },
    { L: 0.5, C: 5, h: 400 },
    { L: 0.5, C: -0.3, h: 0 },
    { L: Number.NaN, C: Number.NaN, h: Number.NaN },
  ]
  const outputs = outOfRange.map((lch) => hexFromOklch(lch))
  check(
    outputs.every((hex) => HEX6.test(hex)),
    'hexFromOklch 收到超界 / NaN 的 L、C、h 时仍输出合法 hex',
    outputs.join(', '),
  )
}

{
  const boom = thrownBy(() => hexFromOklch({ L: 1.5, C: 0.2, h: 120 }))
  check(boom === null, 'hexFromOklch 超界 L 不抛异常', boom === null ? '' : String(boom))

  const grey = hexFromOklch({ L: 0.5, C: 0, h: 0 })
  const greyRgb = hexToRgb(grey)
  check(greyRgb.r === greyRgb.g && greyRgb.g === greyRgb.b, 'C = 0 时忽略色相，输出中性灰', grey)
  check(close(oklchFromHex(grey).L, 0.5, 0.01), 'C = 0、L = 0.5 的输出 L 仍 ≈ 0.5', num(oklchFromHex(grey).L))
  check(hexFromOklch({ L: 0, C: 0, h: 0 }) === '#000000', 'L = 0、C = 0 → #000000')
  check(hexFromOklch({ L: 1, C: 0, h: 0 }) === '#ffffff', 'L = 1、C = 0 → #ffffff')
}

/* ------------------------------------------------------------------ *
 * 收尾
 * ------------------------------------------------------------------ */

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
process.exit(0)
