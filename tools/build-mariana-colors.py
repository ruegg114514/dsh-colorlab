#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 Mariana 配色方案编译成「选择器 → 颜色」的 JSON，供浏览器端匹配。

也是照抄：规则、顺序、var() 定义全部取自 `Mariana.sublime-color-scheme`，
这里只做三件事

  1. `var(x)` → 十六进制（hsl/hsla 换算）
  2. 把 Sublime/TextMate 的选择器语法解析成表达式树
     （`,` 并列 / 空格 后代 / `-` 排除 / `|` 或 / `()` 分组）
  3. 丢掉用不到的键，输出紧凑 JSON

**规则顺序即优先级**：引擎按「特异性高者胜、同分后写者胜」匹配，
所以顺序必须原样保留。
"""

import yaml, json, re, sys

POSIX = {}


def hsl_to_hex(h, s, l):
    s /= 100.0
    l /= 100.0

    def k(n):
        return (n + h / 30.0) % 12

    a = s * min(l, 1 - l)

    def f(n):
        return l - a * max(-1, min(k(n) - 3, min(9 - k(n), 1)))

    def to(v):
        return '%02X' % max(0, min(255, round(255 * v)))

    return '#' + to(f(0)) + to(f(8)) + to(f(4))


def resolve(value, variables):
    if not isinstance(value, str):
        return value
    m = re.fullmatch(r'var\(([A-Za-z0-9_-]+)\)', value.strip())
    if not m:
        return value
    raw = variables.get(m.group(1))
    if raw is None:
        return value
    hm = re.match(r'hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%', raw)
    if hm:
        return hsl_to_hex(float(hm.group(1)), float(hm.group(2)), float(hm.group(3)))
    return raw


def split_top(text, sep):
    """按顶层分隔符切分（忽略括号内与引号内的）。sep 为字符串或回调。"""
    out = []
    depth = 0
    cur = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        if depth == 0:
            if callable(sep):
                m = sep(text, i)
                if m:
                    out.append(''.join(cur))
                    cur = []
                    i += m
                    continue
            elif text.startswith(sep, i):
                out.append(''.join(cur))
                cur = []
                i += len(sep)
                continue
        cur.append(c)
        i += 1
    out.append(''.join(cur))
    return [x.strip() for x in out if x.strip() != '']


def parse_expr(text):
    """解析一个 scope 选择器表达式（不含顶层 `,`）。

    返回 `{ 'path': [unit...], 'exclude': path|null }`。
    unit = 字符串（scope 名）或 list（`|` 的多个分支，递归）。
    """
    # 顶层 ` - ` 切分：左边是 include，右边是 exclude（可能有多个）
    parts = split_top(text, lambda s, i: 3 if s.startswith(' - ', i) else None)
    inc = parts[0]
    exc = parts[1] if len(parts) > 1 else None

    def parse_path(p):
        units = split_top(p, ' ')
        out = []
        for u in units:
            out.append(parse_unit(u))
        return out

    def parse_unit(u):
        u = u.strip()
        # 去一层最外层括号
        if u.startswith('(') and u.endswith(')'):
            inner = u[1:-1]
            # 括号内可能是 `a | b | ...` 或完整表达式
            alts = split_top(inner, '|')
            if len(alts) > 1:
                return [parse_unit(a) for a in alts]
            return parse_unit(inner)
        alts = split_top(u, '|')
        if len(alts) > 1:
            return [parse_unit(a) for a in alts]
        return u

    return {'path': parse_path(inc), 'exclude': parse_path(exc) if exc else None}


def parse_selector(sel):
    alts = split_top(sel, ',')
    return [parse_expr(a) for a in alts]


def build(path, out_path):
    with open(path, encoding='utf-8') as f:
        raw = f.read()
    raw = re.sub(r',\s*([}\]])', r'\1', raw)  # Sublime 允许尾随逗号
    scheme = json.loads(raw)
    variables = scheme.get('variables') or {}
    globals_ = scheme.get('globals') or {}

    fg = resolve(globals_.get('foreground', '#D8DEE9'), variables)
    bg = resolve(globals_.get('background', '#343D46'), variables)

    rules = []
    for r in scheme.get('rules') or []:
        scope = r.get('scope')
        if not isinstance(scope, str):
            continue
        entry = {'sel': parse_selector(scope)}
        if 'foreground' in r:
            entry['fg'] = resolve(r['foreground'], variables)
        if 'font_style' in r:
            entry['fs'] = r['font_style']
        if 'background' in r:
            entry['bg'] = r['background']
        rules.append(entry)

    doc = {'foreground': fg, 'background': bg, 'rules': rules}
    js = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(js)

    colored = sum(1 for r in rules if 'fg' in r)
    print(f'规则 {len(rules)} 条（其中带前景色 {colored} 条）')
    print(f'全局前景 {fg} / 背景 {bg}')
    print(f'输出 {out_path}: {len(js):,} 字节')
    return doc


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.stderr.write(__doc__)
        sys.exit(1)
    build(sys.argv[1], sys.argv[2])
