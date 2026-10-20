/**
 * mini TextMate 引擎 —— 直接跑编译好的 Sublime 语法，不自创任何规则。
 *
 * 支持 Sublime `.sublime-syntax` 里这套语法用到的全部要素：
 *   match / captures / push / set / pop / include / meta_scope /
 *   meta_content_scope / meta_include_prototype / clear_scopes / prototype
 *
 * 匹配语义按 TextMate：
 *   - 当前 context 里的 pattern **按书写顺序**逐个试，第一个命中的胜出
 *   - `include: X` 就地展开成 X 的 pattern 列表（懒展开，带深度上限防递归）
 *   - 每个 context 末尾隐式带上 `prototype`（除非 meta_include_prototype: false）
 *   - 整个匹配范围按 `captures` 的分组边界切开，各段附加各自的 scope
 */

const MAX_INCLUDE_DEPTH = 24

/** 指令型条目：不是匹配器，只在进入 context 时读一次。 */
const DIRECTIVE = new Set([
  'meta_scope', 'meta_content_scope', 'meta_include_prototype',
  'clear_scopes', 'apply_prototype', 'with_prototype',
])

const EMPTY = []

/**
 * 正则缓存 —— **跨调用常驻**。
 *
 * 早先这个 Map 建在 `tokenize()` 里面，等于每次分词都要把 400+ 条 pattern
 * 重新编译一遍。提到模块级之后，同一份语法只编译一次。
 */
const REGEX_CACHE = new Map()

/** 每个语法的「context 名 → 进入时指令」缓存（按语法对象弱引用）。 */
const DIRECTIVES_CACHE = new WeakMap()

/**
 * 编译并缓存正则。语法里已经做过 Oniguruma→JS 的转换；
 * 这里再兜一层：任何编译失败都退化成「永不匹配」，不让整块崩掉。
 */
function compile(pattern, broken) {
  let re = REGEX_CACHE.get(pattern)
  if (re !== undefined) return re
  try {
    /* `d` = hasIndices（拿到每个捕获组的精确 [start,end) 绝对下标）
       `y` = 锚定在 lastIndex
       `m` = `^`/`$` 按**行**匹配 —— Sublime 的 `^` 就是行首，少了它多行语法全废 */
    re = new RegExp(pattern, 'dym')
  } catch (error) {
    try {
      re = new RegExp(pattern, 'ym')
    } catch (error2) {
      broken.push({ pattern, message: String(error2 && error2.message) })
      re = null
    }
  }
  REGEX_CACHE.set(pattern, re)
  return re
}
/**
 * 把一个 context 的「进入时指令」读出来（meta_scope / meta_content_scope /
 * meta_include_prototype）。
 */
function readDirectives(list) {
  let metaScope = null
  let metaContentScope = null
  let includePrototype = true
  if (!Array.isArray(list)) return { metaScope, metaContentScope, includePrototype }
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i]
    if (p === null || typeof p !== 'object') continue
    if (typeof p.meta_scope === 'string') metaScope = p.meta_scope
    if (typeof p.meta_content_scope === 'string') metaContentScope = p.meta_content_scope
    if (p.meta_include_prototype === false) includePrototype = false
  }
  return { metaScope, metaContentScope, includePrototype }
}

/**
 * 分词。
 *
 * @param {string} text - 原文。
 * @param {object} grammar - `{ contexts: {...} }`，编译产物。
 * @returns {{tokens: Array, broken: Array}} tokens 为
 *          `{ start, end, scopes: string[] }`，按位置升序、无重叠。
 */
export function tokenize(text, grammar) {
  const contexts = grammar.contexts || {}
  const broken = []
  const tokens = []

  /* 「进入 context 要读的指令」按语法只算一次，别每次 push 都重扫 pattern 列表 */
  let dirCache = DIRECTIVES_CACHE.get(grammar)
  if (dirCache === undefined) {
    dirCache = new Map()
    DIRECTIVES_CACHE.set(grammar, dirCache)
  }
  const directivesOf = (name) => {
    let d = dirCache.get(name)
    if (d === undefined) {
      d = readDirectives(contexts[name])
      dirCache.set(name, d)
    }
    return d
  }

  /** 栈：每层 `{ name, scopes: string[], includePrototype }`。 */
  const stack = []
  const pushContext = (name, extraScopes) => {
    const body = contexts[name]
    if (!Array.isArray(body)) return false
    const d = directivesOf(name)
    const scopes = (extraScopes || []).slice()
    if (d.metaScope !== null) scopes.push(d.metaScope)
    if (d.metaContentScope !== null) scopes.push(d.metaContentScope)
    stack.push({ name, scopes, includePrototype: d.includePrototype })
    return true
  }

  if (!pushContext('main', null)) return { tokens, broken }

  /** 当前累积的 scope 栈（自底向上拼接）。 */
  const currentScopes = (extra) => {
    const out = []
    for (let i = 0; i < stack.length; i += 1) {
      const s = stack[i].scopes
      for (let j = 0; j < s.length; j += 1) out.push(s[j])
    }
    if (extra !== undefined && extra !== null) {
      const parts = String(extra).split(/\s+/)
      for (let k = 0; k < parts.length; k += 1) if (parts[k] !== '') out.push(parts[k])
    }
    return out
  }

  /**
   * 在当前 context（递归含 include 与 prototype）里找第一个命中的 pattern。
   * @returns {object|null} `{ pat, m }`。
   */
  const findMatch = (name, pos, depth) => {
    if (depth > MAX_INCLUDE_DEPTH) return null
    const body = contexts[name]
    if (!Array.isArray(body)) return null
    for (let i = 0; i < body.length; i += 1) {
      const pat = body[i]
      if (pat === null || typeof pat !== 'object') continue
      if (typeof pat.include === 'string') {
        const target = resolveInclude(pat.include)
        if (target === null) continue
        const hit = findMatch(target, pos, depth + 1)
        if (hit !== null) return hit
        continue
      }
      if (pat.match === undefined) continue
      const re = compile(pat.match, broken)
      if (re === null) continue
      re.lastIndex = pos
      const m = re.exec(text)
      if (m !== null && m.index === pos) return { pat, m }
    }
    return null
  }

  const resolveInclude = (spec) => {
    if (spec.charCodeAt(0) === 35 /* # */) return spec.slice(1)
    if (spec === '$self' || spec === '$base') return 'main'
    if (spec.startsWith('scope:')) return null /* 跨语法，已合并，忽略 */
    if (spec.startsWith('Packages/')) return null
    return spec
  }

  /** 顶层查找：当前 context → 它的 prototype。 */
  const findHere = (pos) => {
    const top = stack[stack.length - 1]
    if (top === undefined) return null
    const hit = findMatch(top.name, pos, 0)
    if (hit !== null) return hit
    if (top.includePrototype && contexts.prototype !== undefined) {
      return findMatch('prototype', pos, 0)
    }
    return null
  }

  const emit = (start, end, scopes) => {
    if (end <= start) return
    const last = tokens.length > 0 ? tokens[tokens.length - 1] : null
    if (last !== null && last.end === start && sameScopes(last.scopes, scopes)) {
      last.end = end /* 相邻同 scope 合并，token 数少很多 */
      return
    }
    tokens.push({ start, end, scopes })
  }

  const sameScopes = (a, b) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
    return true
  }

  const applyActions = (pat, m) => {
    /* pop / set 先执行（set = 弹掉当前再压入） */
    if (pat.pop !== undefined) {
      const n = pat.pop === true ? 1 : (typeof pat.pop === 'number' ? pat.pop : 1)
      for (let i = 0; i < n && stack.length > 1; i += 1) stack.pop()
    }
    if (pat.set !== undefined) {
      if (stack.length > 1) stack.pop()
      const list = Array.isArray(pat.set) ? pat.set : [pat.set]
      for (let i = 0; i < list.length; i += 1) pushContext(list[i], null)
    }
    if (pat.push !== undefined) {
      const list = Array.isArray(pat.push) ? pat.push : [pat.push]
      for (let i = 0; i < list.length; i += 1) pushContext(list[i], null)
      void m
    }
  }

  let pos = 0
  let guard = 0
  const guardMax = text.length * 8 + 4096

  while (pos < text.length) {
    guard += 1
    if (guard > guardMax) break /* 异常语法导致的死循环，保命 */
    const hit = findHere(pos)
    if (hit === null) {
      emit(pos, pos + 1, currentScopes(null))
      pos += 1
      continue
    }
    const { pat, m } = hit
    const len = m[0].length
    const base = currentScopes(pat.scope)

    /* 按 captures 的分组边界切开，各段追加自己的 scope。
       ⚠️ `m.indices[i]` 是**绝对**下标（不是相对 match 起点）。
       ⚠️ 捕获组会**嵌套**：`sections` 规则里捕获 2（反斜杠 `\`）就在捕获 1
          （`\chapter`）内部。所以不能简单排序后顺序输出 —— 那样内层会和外层
          重叠，渲染时反斜杠会被输出两遍。正确做法是按边界切段，
          每段取「覆盖它的所有捕获组」，外层在前、内层在后。 */
    const caps = pat.captures
    if (caps !== undefined && caps !== null && len > 0) {
      const marks = []
      const indices = m.indices
      for (const key of Object.keys(caps)) {
        const idx = Number(key)
        if (!Number.isFinite(idx) || idx <= 0) continue
        const span = indices === undefined ? undefined : indices[idx]
        if (span === undefined || span === null) continue
        if (span[1] <= span[0]) continue
        marks.push({ from: span[0], to: span[1], scope: String(caps[key]) })
      }
      const end = pos + len
      if (marks.length === 0) {
        emit(pos, end, base)
      } else {
        const bounds = [pos, end]
        for (const mk of marks) {
          if (mk.from > pos && mk.from < end) bounds.push(mk.from)
          if (mk.to > pos && mk.to < end) bounds.push(mk.to)
        }
        bounds.sort((a, b2) => a - b2)
        const head = pat.scope === undefined ? '' : String(pat.scope) + ' '
        for (let k = 0; k + 1 < bounds.length; k += 1) {
          const a = bounds[k]
          const b2 = bounds[k + 1]
          if (b2 <= a) continue
          /* 覆盖这一段的所有捕获组：外层先出、内层后出 */
          const active = []
          for (const mk of marks) {
            if (mk.from <= a && mk.to >= b2) active.push(mk)
          }
          active.sort((x, y) => (y.to - x.to) || (x.from - y.from))
          let extra = ''
          for (const mk of active) extra += mk.scope + ' '
          emit(a, b2, currentScopes(head + extra))
        }
      }
    } else {
      emit(pos, pos + len, base)
    }

    applyActions(pat, m)

    if (len === 0) {
      /* 零宽匹配：只要栈有变化就继续，否则前进一格防死循环 */
      const before = stack.length
      if (stack.length === before) {
        emit(pos, pos + 1, currentScopes(null))
        pos += 1
      }
      continue
    }
    pos += len
  }
  if (pos === text.length) {
    /* 收尾：无需输出 */
  }
  return { tokens, broken }
}

export default tokenize
