#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 Sublime 的 LaTeX / TeX 语法编译成一份紧凑 JSON，供浏览器端的分词引擎使用。

**这个脚本是"照抄"的搬运工，不发明任何规则**：它只做四件事

  1. 变量替换 `{{name}}`（每个语法用自己的 variables）
  2. 合并 contexts —— LaTeX 的 `extends: Packages/TeX/TeX.sublime-syntax`
     表示把 TeX 的 contexts 并进来，LaTeX 里同名的覆盖
  3. Oniguruma 正则 → JavaScript 正则（扩展模式、POSIX 字符类等）
  4. 丢掉引擎用不到的键，输出紧凑 JSON

用法：python tools/build-tex-grammar.py <LaTeX.sublime-syntax> <TeX.sublime-syntax> <输出.json>
"""

import yaml, json, re, sys, os

yaml.SafeLoader.add_constructor('tag:yaml.org,2002:value', lambda l, n: '=')

KEEP = ('match', 'scope', 'captures', 'push', 'pop', 'set', 'include',
        'meta_scope', 'meta_content_scope', 'meta_include_prototype',
        'clear_scopes', 'embed', 'escape', 'fail', 'apply_prototype',
        'with_prototype',
        # 合并阶段要读、读完就丢的指令
        'meta_prepend', 'meta_append')
# begin/end 形式（老式语法）保留，引擎里支持
KEEP_BEGIN_END = ('begin', 'end', 'while', 'beginCaptures', 'endCaptures',
                  'contentName', 'name')

POSIX = {
    '[:alpha:]': 'a-zA-Z', '[:digit:]': '0-9', '[:alnum:]': 'a-zA-Z0-9',
    '[:space:]': ' \\t\\r\\n\\f\\v', '[:upper:]': 'A-Z', '[:lower:]': 'a-z',
    '[:punct:]': '!-/:-@\\[-`{-~', '[:xdigit:]': '0-9A-Fa-f',
    '[:word:]': 'a-zA-Z0-9_', '[:blank:]': ' \\t', '[:cntrl:]': '\\x00-\\x1f\\x7f',
    '[:graph:]': '!-~', '[:print:]': ' -~',
}


def die(msg):
    sys.stderr.write(msg + '\n')
    sys.exit(1)


def load(path):
    with open(path, encoding='utf-8') as f:
        return yaml.safe_load(f)


def subst_vars(text, variables, depth=0):
    """把 {{name}} 换成变量值（可嵌套）。"""
    if not isinstance(text, str) or depth > 10:
        return text

    def repl(m):
        key = m.group(1).strip()
        val = variables.get(key)
        if val is None:
            return m.group(0)  # 未知变量原样留着，方便排查
        return subst_vars(str(val), variables, depth + 1)

    return re.sub(r'\{\{([^}]+)\}\}', repl, text)


def strip_extended(pattern):
    """把 Oniguruma 的扩展模式 (?x) 展开：去掉空白与 # 注释（字符类内不动）。"""
    if '(?x)' not in pattern and '(?x:' not in pattern:
        return pattern
    out = []
    i = 0
    in_class = False
    n = len(pattern)
    while i < n:
        c = pattern[i]
        if c == '\\' and i + 1 < n:
            out.append(pattern[i:i + 2])
            i += 2
            continue
        if c == '[':
            in_class = True
        elif c == ']':
            in_class = False
        if not in_class:
            if c == '#':
                while i < n and pattern[i] != '\n':
                    i += 1
                continue
            if c in ' \t\r\n':
                i += 1
                continue
        out.append(c)
        i += 1
    s = ''.join(out)
    s = s.replace('(?x)', '')
    return s


def onig_to_js(pattern):
    """把 Oniguruma 写法转成 JavaScript 能编译的形式。"""
    s = strip_extended(pattern.__str__())

    # POSIX 字符类
    for k, v in POSIX.items():
        s = s.replace(k, v)

    # (?x: ... ) → (?: ... )
    s = re.sub(r'\(\?x:', '(?:', s)
    # 原子组 (?> ... ) → 非捕获组（语义略弱，配合 \K 的用法这里用不到）
    s = s.replace('(?>', '(?:')
    # 占有量词 → 贪婪量词
    s = s.replace('*+', '*').replace('++', '+').replace('?+', '?').replace('}+', '}')
    # Oniguruma 的十六进制字符类 \h
    s = re.sub(r'\\h', '[0-9a-fA-F]', s)
    # \R 任意换行
    s = s.replace('\\R', '(?:\\r\\n|[\\r\\n\\v\\f\\x85])')
    # \K（丢弃之前匹配）—— 语法里若出现，退化为无操作会改变语义，
    # 编译期记录下来由调用方检查
    return s


def clean(node, variables, stats):
    """递归清洗一个 pattern/结构。"""
    if isinstance(node, list):
        out = []
        for x in node:
            c = clean(x, variables, stats)
            if c is not None:
                out.append(c)
        return out
    if not isinstance(node, dict):
        return node

    # 先做变量替换（只在字符串上）
    node = {k: (subst_vars(v, variables) if isinstance(v, str) else v)
            for k, v in node.items()}

    out = {}
    for k, v in node.items():
        if k in KEEP or k in KEEP_BEGIN_END:
            if k in ('match', 'begin', 'end', 'while') and isinstance(v, str):
                js = onig_to_js(v)
                if '\\K' in js:
                    stats['has_K'].append(v[:80])
                out[k] = js
            elif k == 'captures' or k in ('beginCaptures', 'endCaptures'):
                caps = {}
                for ck, cv in (v or {}).items():
                    if isinstance(cv, dict) and 'name' in cv:
                        caps[str(ck)] = subst_vars(str(cv['name']), variables)
                    elif isinstance(cv, dict) and 'scopes' in cv:
                        caps[str(ck)] = subst_vars(str(cv['scopes']), variables)
                    elif isinstance(cv, str):
                        caps[str(ck)] = subst_vars(cv, variables)
                if caps:
                    out['captures' if k == 'captures' else k] = caps
            elif k in ('scope', 'meta_scope', 'meta_content_scope', 'include',
                       'name', 'contentName'):
                out[k] = subst_vars(str(v), variables) if isinstance(v, str) else v
            elif k in ('push', 'set'):
                if isinstance(v, str):
                    out[k] = subst_vars(v, variables)
                elif isinstance(v, list):
                    out[k] = [subst_vars(str(x), variables) for x in v]
                else:
                    out[k] = v
            else:
                out[k] = v
    return out or None


def build(path_latex, path_tex, out_path):
    stats = {'has_K': [], 'contexts_latex': 0, 'contexts_tex': 0, 'patterns': 0,
             'unknown_vars': set()}
    latex = load(path_latex)
    tex = load(path_tex)

    def contexts_of(g, variables):
        ctx = {}
        for name, body in (g.get('contexts') or {}).items():
            ctx[name] = clean(body, variables, stats)
        return ctx

    ctx_tex = contexts_of(tex, tex.get('variables') or {})
    # Sublime 的 `extends` 不仅并 contexts，也**继承 variables**：
    # LaTeX 里用到 {{letter}}/{{cmdname}} 这些，定义在 TeX 的 variables 里。
    vars_merged = dict(tex.get('variables') or {})
    vars_merged.update(latex.get('variables') or {})
    ctx_latex = contexts_of(latex, vars_merged)
    stats['contexts_tex'] = len(ctx_tex)
    stats['contexts_latex'] = len(ctx_latex)

    # ---- 合并：LaTeX extends TeX ----
    #
    # ⚠️ 关键点：`meta_prepend: true` 作为 context 的第一项时，意思是
    #    「把这批 pattern **前置**到从基语法继承来的同名 context 上」，
    #    而不是覆盖它。
    #
    # 早先把这个指令当无用项丢掉 → LaTeX 的 `math-content`（6 项）
    # 整个替换掉 TeX 的（9 项）→ `math-builtin`/`math-braces`/`math-operators`/
    # `math-variables` 全丢 → **数学的着色规则一条不剩**，
    # `inline-math` 也失去了入口（`$` 匹配不上就是它）。
    merged = dict(ctx_tex)
    prepended = []
    appended = []
    for name, body in ctx_latex.items():
        if isinstance(body, list) and body and isinstance(body[0], dict) \
                and body[0].get('meta_prepend') is True:
            base = merged.get(name) or []
            merged[name] = body[1:] + (base if isinstance(base, list) else [])
            prepended.append(name)
        elif isinstance(body, list) and body and isinstance(body[0], dict) \
                and body[0].get('meta_append') is True:
            # `meta_append: true` = 追加到继承项**之后**（`inline-math` 用的就是它，
            # TeX 里那条 `\$` 的 match 必须留下来，否则 `$` 根本匹配不上）
            base = merged.get(name) or []
            merged[name] = (base if isinstance(base, list) else []) + body[1:]
            appended.append(name)
        else:
            merged[name] = body

    # 统计 pattern 数
    for body in merged.values():
        if isinstance(body, list):
            stats['patterns'] += len(body)
    doc = {
        'scope': latex.get('scope'),
        'extends': tex.get('scope'),
        'contexts': merged,
    }
    js = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(js)

    print(f'LaTeX contexts {stats["contexts_latex"]} + TeX {stats["contexts_tex"]} '
          f'→ 合并 {len(merged)} 个')
    print(f'其中 meta_prepend 合并的 {len(prepended)} 个: {sorted(prepended)[:8]}')
    print(f'其中 meta_append  合并的 {len(appended)} 个: {sorted(appended)[:8]}')
    print(f'pattern 总数 {stats["patterns"]}')
    print(f'输出 {out_path}: {len(js):,} 字节')
    if stats['has_K']:
        print(f'⚠ 含 \\K 的 pattern {len(stats["has_K"])} 条（语义可能不完整）')
        for s in stats['has_K'][:5]:
            print('   ', s)
    # 漏掉的变量（{{x}} 没被替换）
    leftover = set(re.findall(r'\{\{[^}]+\}\}', js))
    if leftover:
        print('⚠ 未替换的变量:', sorted(leftover)[:10])
    return doc


if __name__ == '__main__':
    if len(sys.argv) < 4:
        die(__doc__)
    build(sys.argv[1], sys.argv[2], sys.argv[3])
