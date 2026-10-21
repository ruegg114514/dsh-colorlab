/**
 * OKLCH / OKLab 色彩科学工具（Björn Ottosson 的 OKLab，sRGB 基准）。
 *
 * 设计约束：
 * - **零依赖**：不 import 任何东西，不碰 DOM、不碰 Node API，纯函数、无副作用。
 *   同一份文件既能被浏览器端（client.js）import，也能被 Node 测试脚本 import。
 * - **官方矩阵**：线性 sRGB → LMS 用 M1，LMS' → OKLab 用官方系数；
 *   反向走 M2。不做任何近似或"看起来差不多"的化简。
 * - **sRGB 传递函数**：srgbToOklab / oklabToSrgb 内部自己做 gamma 解码 / 编码，
 *   传入的 {r,g,b} 是**非线性 sRGB 值**（就是 hex 里那两个十六进制数 / 255）。
 *
 * 参考：https://bottosson.github.io/posts/oklab/
 */

/* ------------------------------------------------------------------ *
 * 内部常量与私有助手（不导出）
 * ------------------------------------------------------------------ */

/** sRGB → 线性 sRGB 的 gamma 解码阈值（IEC 61966-2-1）。 */
const SRGB_GAMMA_THRESHOLD = 0.04045

/** 把 0..1 的值夹到 0..1；非有限值（NaN/Infinity）退回 0。 */
function clamp01(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** 把一个 0..1 的分量转成两位小写十六进制（内部会 clamp）。 */
function byteToHex(value) {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0')
}

/** 单通道 sRGB 非线性值 → 线性值。 */
function srgbChannelToLinear(channel) {
  return channel <= SRGB_GAMMA_THRESHOLD
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

/** 单通道线性值 → sRGB 非线性值（不做 clamp，由调用方决定）。 */
function linearChannelToSrgb(channel) {
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055
}

/**
 * 低于这个彩度就当作灰阶（色相无意义）。
 * 取 1e-7 而不是 0：M1/M2 的系数是有限小数，纯灰（如 `#ffffff`）算出来的
 * C 是 3.7e-8 这个量级的浮点残差，不是真彩度。
 */
const NEUTRAL_CHROMA_EPSILON = 1e-7

/** 角度归一化到 [0, 360)。 */
function normalizeHue(degrees) {
  const wrapped = degrees % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/** 取出 hexToRgb 的结果，失败时返回 null（供派生函数统一判空）。 */
function parseHex(hex) {
  return hexToRgb(hex)
}

/* ------------------------------------------------------------------ *
 * 导出：hex / rgb 基础互转
 * ------------------------------------------------------------------ */

/**
 * 把十六进制颜色字符串转成 0..1 的 RGB(A) 分量。
 *
 * @param {string} hex 形如 `'#rrggbb'` 或 `'#rrggbbaa'`（大小写均可，必须带 `#`）。
 * @returns {{r: number, g: number, b: number, a: number}|null}
 *   `r/g/b/a` 均为 0..1 的数（`a` 省略时默认 1）；非法输入返回 `null`，不抛异常。
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex.trim())
  if (match === null) return null
  const digits = match[1]
  return {
    r: Number.parseInt(digits.slice(0, 2), 16) / 255,
    g: Number.parseInt(digits.slice(2, 4), 16) / 255,
    b: Number.parseInt(digits.slice(4, 6), 16) / 255,
    a: match[2] === undefined ? 1 : Number.parseInt(match[2], 16) / 255,
  }
}

/**
 * 把 0..1 的 RGB 分量转成 `'#rrggbb'`（小写，超出范围的分量会被夹到 0..1）。
 *
 * @param {{r: number, g: number, b: number}} rgb 0..1 的 sRGB 非线性分量。
 * @returns {string} 形如 `'#6699cc'` 的字符串（非法输入按 0 处理，不抛异常）。
 */
export function rgbToHex(rgb) {
  if (rgb === null || typeof rgb !== 'object') return '#000000'
  return `#${byteToHex(rgb.r)}${byteToHex(rgb.g)}${byteToHex(rgb.b)}`
}

/* ------------------------------------------------------------------ *
 * 导出：sRGB ↔ OKLab（官方矩阵）
 * ------------------------------------------------------------------ */

/**
 * 把 sRGB（非线性）颜色转成 OKLab。内部先做 gamma 解码到线性光，再走官方
 * M1 矩阵与立方根，最后套 OKLab 的线性组合。
 *
 * @param {{r: number, g: number, b: number}} rgb 0..1 的 sRGB 非线性分量。
 * @returns {{L: number, a: number, b: number}} OKLab 坐标；`L` 约 0..1，`a/b` 大致 ±0.4。
 */
export function srgbToOklab(rgb) {
  const r = clamp01(rgb?.r)
  const g = clamp01(rgb?.g)
  const b = clamp01(rgb?.b)

  const lr = srgbChannelToLinear(r)
  const lg = srgbChannelToLinear(g)
  const lb = srgbChannelToLinear(b)

  /* M1：线性 sRGB → 近似锥体响应 LMS。 */
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

  const lRoot = Math.cbrt(l)
  const mRoot = Math.cbrt(m)
  const sRoot = Math.cbrt(s)

  return {
    L: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  }
}

/**
 * 把 OKLab 转回 sRGB（非线性）。这是 srgbToOklab 的严格逆运算，
 * 超出 sRGB 色域的结果会被夹到 0..1。
 *
 * @param {{L: number, a: number, b: number}} lab OKLab 坐标。
 * @returns {{r: number, g: number, b: number}} 0..1 的 sRGB 非线性分量（已 clamp）。
 */
export function oklabToSrgb(lab) {
  const L = Number.isFinite(lab?.L) ? lab.L : 0
  const a = Number.isFinite(lab?.a) ? lab.a : 0
  const b = Number.isFinite(lab?.b) ? lab.b : 0

  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = L - 0.0894841775 * a - 1.291485548 * b

  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3

  /* M2：LMS → 线性 sRGB。 */
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return {
    r: clamp01(linearChannelToSrgb(lr)),
    g: clamp01(linearChannelToSrgb(lg)),
    b: clamp01(linearChannelToSrgb(lb)),
  }
}

/* ------------------------------------------------------------------ *
 * 导出：OKLCH（极坐标形式）
 * ------------------------------------------------------------------ */

/**
 * 把 hex 颜色转成 OKLCH：`L` 为感知亮度，`C` 为彩度，`h` 为色相角。
 * 色相取 OKLab 平面上的 `atan2(b, a)`，单位度、范围 [0, 360)。
 * 灰阶（C 小到 1e-7 以下，含浮点残差导致的"假彩度"）时色相没有意义，
 * 此时固定返回 0，调用方不应依赖它。
 *
 * @param {string} hex `'#rrggbb'` 或 `'#rrggbbaa'`。
 * @returns {{L: number, C: number, h: number}|null} 非法输入返回 `null`。
 */
export function oklchFromHex(hex) {
  const rgb = parseHex(hex)
  if (rgb === null) return null
  const lab = srgbToOklab(rgb)
  const C = Math.hypot(lab.a, lab.b)
  const h =
    C < NEUTRAL_CHROMA_EPSILON ? 0 : normalizeHue((Math.atan2(lab.b, lab.a) * 180) / Math.PI)
  return { L: lab.L, C, h }
}

/**
 * 把 OKLCH 转成 `'#rrggbb'`。`L` 超出 0..1、`C` 为负或负数导致的超界都会
 * 被安全地夹回 sRGB 色域（不抛异常）；`C≈0`（灰阶）时色相被忽略。
 *
 * @param {{L: number, C: number, h: number}} lch OKLCH 坐标（`h` 单位为度，任意实数）。
 * @returns {string} 小写 `'#rrggbb'`；输入不可用时退回 `'#000000'`。
 */
export function hexFromOklch(lch) {
  const L = Number.isFinite(lch?.L) ? lch.L : 0
  const C = Number.isFinite(lch?.C) ? Math.max(0, lch.C) : 0
  const h = Number.isFinite(lch?.h) ? lch.h : 0
  const radians = (h * Math.PI) / 180
  return rgbToHex(
    oklabToSrgb({
      L: clamp01(L),
      a: C * Math.cos(radians),
      b: C * Math.sin(radians),
    }),
  )
}

/* ------------------------------------------------------------------ *
 * 导出：派生调整
 * ------------------------------------------------------------------ */

/**
 * 在感知亮度 L 上加减 `dL`，保持 a/b（即色相与彩度）不变。
 * 加减后会夹到 0..1，再回到 sRGB；比直接缩放 RGB 更符合人眼观感。
 *
 * @param {string} hex 起始颜色 `'#rrggbb'` 或 `'#rrggbbaa'`。
 * @param {number} dL 亮度增量（可为负）。
 * @returns {string|null} 小写 `'#rrggbb'`；`hex` 非法时返回 `null`。
 */
export function adjustLightness(hex, dL) {
  const rgb = parseHex(hex)
  if (rgb === null) return null
  const lab = srgbToOklab(rgb)
  const delta = Number.isFinite(dL) ? dL : 0
  return rgbToHex(oklabToSrgb({ L: clamp01(lab.L + delta), a: lab.a, b: lab.b }))
}

/**
 * 按倍数缩放彩度 C（`factor < 1` 去饱和，`> 1` 加饱和），保持 L 与色相 h 不变。
 * 结果若超出 sRGB 色域会被夹回，因此极饱和的颜色可能无法完全达到目标 C。
 *
 * @param {string} hex 起始颜色 `'#rrggbb'` 或 `'#rrggbbaa'`。
 * @param {number} factor 彩度倍数（0 即变灰）。
 * @returns {string|null} 小写 `'#rrggbb'`；`hex` 非法时返回 `null`。
 */
export function adjustChroma(hex, factor) {
  const lch = oklchFromHex(hex)
  if (lch === null) return null
  const scale = Number.isFinite(factor) ? Math.max(0, factor) : 1
  return hexFromOklch({ L: lch.L, C: lch.C * scale, h: lch.h })
}

/**
 * 在 OKLab 空间里对两个颜色做线性插值（比在 sRGB 里插值更接近感知中点）。
 * `t = 0` 精确返回 A，`t = 1` 精确返回 B；`t` 超出 [0,1] 时按外推处理。
 *
 * @param {string} hexA 起点颜色。
 * @param {string} hexB 终点颜色。
 * @param {number} t 插值比例，通常 0..1。
 * @returns {string|null} 小写 `'#rrggbb'`；任一输入非法时返回 `null`。
 */
export function mixOklch(hexA, hexB, t) {
  const rgbA = parseHex(hexA)
  const rgbB = parseHex(hexB)
  if (rgbA === null || rgbB === null) return null
  const labA = srgbToOklab(rgbA)
  const labB = srgbToOklab(rgbB)
  const ratio = Number.isFinite(t) ? t : 0
  return rgbToHex(
    oklabToSrgb({
      L: labA.L + (labB.L - labA.L) * ratio,
      a: labA.a + (labB.a - labA.a) * ratio,
      b: labA.b + (labB.b - labA.b) * ratio,
    }),
  )
}

/**
 * 给颜色附加透明度，输出 8 位 `'#rrggbbaa'`（小写）。
 * `alpha` 会被夹到 0..1，并按 `round(alpha * 255)` 转两位十六进制
 * （例如 0.5 → 127.5 → 128 → `'80'`）。
 *
 * @param {string} hex 起始颜色 `'#rrggbb'` 或 `'#rrggbbaa'`（原 alpha 被覆盖）。
 * @param {number} alpha 0..1 的透明度，1 为完全不透明。
 * @returns {string|null} 形如 `'#6699cc80'`；`hex` 非法时返回 `null`。
 */
export function withAlpha(hex, alpha) {
  const rgb = parseHex(hex)
  if (rgb === null) return null
  const a = Number.isFinite(alpha) ? clamp01(alpha) : 1
  const base = rgbToHex(rgb)
  const byte = Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')
  return `${base}${byte}`
}

/* ------------------------------------------------------------------ *
 * 导出：WCAG 对比度
 * ------------------------------------------------------------------ */

/**
 * 计算 WCAG 2.x 对比度（用 sRGB 相对亮度，**不是** OKLab 的 L）。
 * 公式：`(L_lighter + 0.05) / (L_darker + 0.05)`，范围 1..21。
 * 注意：这里直接用 sRGB 分量做 gamma 解码求相对亮度，符合 WCAG 定义。
 *
 * @param {string} hexA 前景或背景色。
 * @param {string} hexB 另一个颜色。
 * @returns {number|null} 1..21 的对比度（如 4.5）；任一输入非法时返回 `null`。
 */
export function contrastRatio(hexA, hexB) {
  const rgbA = parseHex(hexA)
  const rgbB = parseHex(hexB)
  if (rgbA === null || rgbB === null) return null
  const luminance = (rgb) =>
    0.2126 * srgbChannelToLinear(rgb.r) +
    0.7152 * srgbChannelToLinear(rgb.g) +
    0.0722 * srgbChannelToLinear(rgb.b)
  const la = luminance(rgbA)
  const lb = luminance(rgbB)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}
