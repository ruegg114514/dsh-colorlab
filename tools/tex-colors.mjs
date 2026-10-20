/**
 * scope → 颜色 —— 跑编译好的 Mariana 规则，语义照 TextMate/Sublime：
 *
 *   - 选择器的 `,` 是并列，空格是**后代匹配**（栈里后者更靠内）
 *   - `-` 是排除：整条排除路径若在栈里匹配上，则这条规则不适用
 *   - `|` 是或，`()` 是分组
 *   - scope 名按**点边界前缀**匹配（`string` 命中 `string.other.math.tex`）
 *   - 命中的规则里取**特异性最高**者；同分取**后写**者（规则顺序即优先级）
 */

/** 一个 scope 名是否命中一个选择器单元。单元是字符串或（`|` 的）单元数组。 */
function matchUnit(unit, scope) {
  if (Array.isArray(unit)) {
    for (let i = 0; i < unit.length; i += 1) {
      if (matchUnit(unit[i], scope)) return true
    }
    return false
  }
  const u = String(unit)
  return scope === u || scope.startsWith(u + '.')
}

/**
 * 一条路径（由单元组成的数组）是否在 scope 栈里按顺序匹配。
 * 从栈顶往回走：路径最后一个单元要匹配栈里最靠内的位置，依次向前。
 *
 * @returns {number} 命中时返回**最后一个单元所在的栈下标**（越靠内越大），
 *                   未命中返回 -1。这个深度就是特异性的第一判据 ——
 *                   比如反斜杠的栈是
 *                   `[… support.function.general.latex, punctuation.definition.backslash.latex]`，
 *                   `punctuation.definition` 命中更深的那层（青），
 *                   `support.function` 命中外层（蓝），Sublime 取前者。
 */
function matchPath(path, stack) {
  if (!Array.isArray(path) || path.length === 0) return -1
  let limit = stack.length - 1
  let lastHit = -1
  for (let p = path.length - 1; p >= 0; p -= 1) {
    let found = -1
    for (let k = limit; k >= 0; k -= 1) {
      if (matchUnit(path[p], stack[k])) {
        found = k
        break
      }
    }
    if (found === -1) return -1
    if (p === path.length - 1) lastHit = found
    limit = found - 1
  }
  return lastHit
}

/** 一条选择器分支（`{path, exclude}`）是否命中；命中返回深度，否则 -1。 */
function matchExpr(expr, stack) {
  const depth = matchPath(expr.path, stack)
  if (depth < 0) return -1
  if (expr.exclude !== null && expr.exclude !== undefined && matchPath(expr.exclude, stack) >= 0) return -1
  return depth
}

/**
 * 造一个「scope 栈 → 样式」的求值器。
 *
 * @param {object} scheme - `{ foreground, rules: [{ sel, fg, fs, bg }] }`
 * @returns {(scopes: string[]) => {fg: string, fs: string, score: number, rule: number}}
 */
export function makeColorizer(scheme) {
  const rules = scheme.rules || []
  const fallbackFg = scheme.foreground || '#D8DEE9'

  return function styleOf(scopes) {
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return { fg: fallbackFg, fs: '', score: 0, rule: -1 }
    }
    let bestFg = null
    let bestFs = ''
    let bestDepth = -1
    let bestLen = -1
    let bestRule = -1
    for (let i = 0; i < rules.length; i += 1) {
      const r = rules[i]
      const alts = r.sel
      if (!Array.isArray(alts)) continue
      let hitDepth = -1
      let hitLen = 0
      for (let a = 0; a < alts.length; a += 1) {
        const d = matchExpr(alts[a], scopes)
        if (d >= 0) {
          hitDepth = d
          hitLen = alts[a].path.length
          break
        }
      }
      if (hitDepth < 0) continue
      /* 特异性：**先看命中深度**（越靠内的 scope 越具体），再看选择器长度；
         都相同才轮到「后写者胜」。这与 Sublime 的排名一致，也是反斜杠能
         单独取到青色的原因。 */
      let better = false
      if (hitDepth > bestDepth) better = true
      else if (hitDepth === bestDepth && hitLen > bestLen) better = true
      else if (hitDepth === bestDepth && hitLen === bestLen && i > bestRule) better = true
      if (!better) continue
      if (r.fg !== undefined) {
        bestFg = r.fg
        bestFs = r.fs === undefined ? '' : r.fs
        bestDepth = hitDepth
        bestLen = hitLen
        bestRule = i
      } else if (r.fs !== undefined) {
        /* 只给字体的规则（如 markup.italic）：有颜色时不动色，只记字体 */
        bestFs = r.fs
        bestDepth = hitDepth
        bestLen = hitLen
        bestRule = i
      } else {
        bestDepth = hitDepth
        bestLen = hitLen
        bestRule = i
      }
    }
    return {
      fg: bestFg === null ? fallbackFg : bestFg,
      fs: bestFs,
      score: bestDepth,
      rule: bestRule,
    }
  }
}

export default makeColorizer
