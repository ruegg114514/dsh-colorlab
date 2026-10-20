# dsh-colorlab 设计说明

本文记录插件的实现取舍、踩过的坑和验收方法。面向二次开发者，**中文**。
使用说明见 [README](../README.md)。

> 包名已从 `dsh-mariana-theme` 改为 `dsh-colorlab`（它早已不只是 Mariana 配色，
> 而是一套配色引擎）。但 profile 行 id 仍为 `mariana-theme` —— 它是设置项的
> 命名空间，改名会让所有已存的颜色覆盖和配色方案变成孤儿。
> **名字是装饰，id 是承重墙。**

---

## 为什么覆盖令牌而不是注册主题

`@deepseek-ai/dsh-client-ui-theme` 提供了 `register()` 注册新主题 id，但：

1. Appearance 设置行的三个方块（浅色 / 深色 / 跟随系统）是**硬编码**的，
   新 id 没有 UI 入口；
2. `setTheme(id)` 只对内置的 `light`/`dark`/`system` 落盘，自定义 id 无法持久化。

所以本插件**不注册主题 id**，改用官方另一条扩展点
`ctx.theme.overrideTokens(source, tokens)`：它把令牌叠加层叠在活动主题之上，
按注册顺序组合、可完整回退，`ThemePresenter` 随后把结果写成 `body` 的内联变量。

## 两条通道

| 通道 | 触发条件 | 说明 |
|---|---|---|
| `overrideTokens` | `ctx.theme.overrideTokens` 存在 | 首选。同 source 再次调用即整层替换，不会堆叠 |
| `<style>` 回退 | 方法缺失或抛错 | 注入 `body[data-ds-dark-theme]{…}` / `body:not([data-ds-dark-theme]){…}`，靠更高特异性 + 后插入的源序取胜 |

两条互斥，成功一条即卸掉另一条。设置页状态条会把当前走的是哪条显示出来。

### ⚠️ `applyNow` 必须防重入（宿主在 `overrideTokens` 内部**同步** emit）

**这是一个真机抓到的爆栈，不是假想防御。**

宿主的 `overrideTokens` 实现是：

```js
overrideTokens(source, tokens) {
  const layer = { seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) };
  this.overrides.set(source, layer);
  this.publish();                 // ← 同步
  return () => { ... };
}
```

而 `publish()` 会**同步** emit `theme/change`。插件又订阅了 `theme/change` 去调
`applyNow()` —— 于是形成闭环：

```
applyNow → overrideTokens → publish() → emit theme/change
  → 我们的监听器 → applyNow → overrideTokens → …… 直到爆栈
```

真机控制台里的样子：

```
[dsh-colorlab] overrideTokens RangeError: Maximum call stack size exceeded
    at JSON.stringify
    at applyNow (client.js:1926)
    at client.js:2227            ← theme/change 监听器
    at ThemeRuntime.publish
    at ThemeRuntime.overrideTokens
    at applyNow (client.js:1927)
```

**「内容签名」那条优化救不了它**（很容易误以为能救）：签名是在 `overrideTokens`
**返回之后**才赋值的，而 emit 发生在它**内部** —— 重入时比对用的还是上一次的签名。

**修法**：`applyNow` 直接拒绝重入。自己刚推的层不需要再响应一次自己触发的事件。

```js
let applying = false
function applyNow() {
  if (applying) return
  applying = true
  try { applyNowOnce() } finally { applying = false }
}
```

**为什么它能溜过测试**：原来的测试替身 `overrideTokens` 只登记层、**不 emit**，
所以重入根本不会发生。现在替身按真机行为在 `overrideTokens` **内部同步 emit**
`theme/change`，并有断言盯着「监听器抛错次数 = 0」。

变异验证：把守卫改回 `if (false) return`，测试进程会在**第一次 `apply()` 就直接
崩溃退出**（无输出）—— 与真机现象一致。

**教训**：涉及「事件回调里再触发同一事件」的宿主，替身必须还原它的**同步性**，
否则测到的是一个不存在的时序。

## 正文高亮为什么必须单独注入样式表

`--shiki-*` 这 11 个变量**只被 Shiki 生成的 `<span>` 的 inline style 引用**，
前端 CSS 里没有任何 `--shiki-*` 的消费点。而 Markdown 正文的颜色来自那几条固定规则：

```css
._markdown_xxx        { color: var(--dsw-alias-label-primary) }  /* 全部文字同色 */
._markdown_xxx strong { font-weight: 600 }                        /* 只改字重，不改色 */
```

也就是说：**正文根本不消费 `--shiki-*`**，光覆盖令牌改不了正文颜色。
所以正文高亮只能往宿主 DOM 注入一条样式表。

**选择器怎么选才不随构建失效**（这是最容易踩的坑）：

宿主 markdown 容器的 `className` 是 CSS Modules 生成的 `_markdown_1ypvv_5` ——
末尾的 hash 与序号每次构建都变，写死必然在下一次升级后失效。
但前缀 `_markdown_` 来自**源文件名**，跨构建稳定。所以用属性子串匹配：

```css
[class*="_markdown_"]:not([data-markdown-variant="compact"]) :is(h1,h2,h3,h4,h5,h6) { … }
```

两个细节：

1. **排除 compact**。宿主对摘要/紧凑变体显式要求继承色：

   ```css
   ._compact_xxx pre, ._compact_xxx pre :is(code,span) { color: inherit !important }
   ._compact_xxx a { color: inherit; text-decoration: underline dotted }
   ```

   容器上只有 compact 时才有 `data-markdown-variant="compact"`，据此排除，
   免得在摘要区强行上色。

2. **每条 `var()` 都带兜底**。正文令牌是插件自己的命名空间（`--dmt-prose-*`），
   任何一条没定义就会继承到不可预测的值，所以每条都写 `var(--x, #fallback)`。

**唯一性已扫描确认**：`data-process-activity` 与 `data-turn-process` 在整个
`app.asar` 里各**只出现一次**（都在 ui-chat），不会误伤别的组件。

## 补了 3 个宿主缺失的 diff 变量

Shiki 的 `css-variables` 主题还引用 `--shiki-token-inserted` / `-deleted` / `-changed`
（用于 ` ```diff ` 代码块），但宿主 `shiki.css` **没有声明这三个**。
不补的话 diff 的新增/删除行会落到 `var()` 未定义的兜底色（继承正文色），看不出增删。
本插件补上：新增绿、删除红、修改黄。

## 首屏闪黑

宿主在浏览器插件加载前就把画布色写成 `#151517`（深色）或 `#fff`（浅色）。
Host 半体（`index.js`）在 `webserver/index-inject` 里补一条：

```css
html:not([data-dsh-colorlab-off]) body[data-ds-dark-theme]{
  background-color:#343D46;--dsh-boot-bg:#343D46
}
```

特异性压过宿主的 `body`（0,0,1），所以不依赖注入顺序；
且只在深色外观下命中，用户停在浅色时这条样式完全不生效。

**为什么要 Host 侧做**：首屏那段 CSS 由 `@deepseek-ai/dsh-client-ui-theme` 的 Host 半体
注入（`{prepend:true}`），浏览器插件那时还没加载，拿不到这段时机。
不用 `!important` —— 提高特异性就够了，也避免压掉后续客户端写下的 inline 值。

### 为什么外面套着 `html:not([data-dsh-colorlab-off])`

**这是一个真实 bug 的修复**：用户把「启用」关掉后，高亮消失了，但**界面底色没回来**
（深浅两种外观都遇到）。

根因：这条样式是经 `webserver/index-inject` **烤进 HTML** 的，页面加载后**撤不掉** ——
而「启用」是客户端运行时的开关，改完并不刷新页面。所以关掉开关后，客户端自己的四张
样式表和令牌叠层都撤干净了，`body` 的画布色却仍然是 Mariana 的 `#343D46`。

**修法：给这条烤死的样式配一个总闸。**

- 规则外面套 `html:not([data-dsh-colorlab-off])`；
- 页面刚加载时 `html` 上**没有**这个属性 → 首屏色照常生效（不闪黑）；
- 客户端 `syncDisabledMarker()` 在每次 `applyNow()` 里维护它：关掉「启用」就补上属性
  （规则立刻失效），重新打开就摘掉；
- 插件**卸载**时也在清理块里补上属性 —— 那之后客户端不再运行，只能在这里关。

两个半体跑在不同运行时、不能互相 import，所以属性名在 `index.js`（`DISABLED_ATTR`）
和 `client.js`（同名常量）各写一份，两边都有测试盯着字面量一致。

## 对比度

`scripts/verify.mjs` 会算 WCAG 对比度并**卡阈值**。Mariana 原色里有两处不达标，
已提亮（代码高亮仍用原值，语法色只需 3:1）：

| 用途 | Mariana 原值 | 实际取值 | 原值对比度 → 现值 |
|---|---|---|---|
| 三级文字 | `#65737E` | `#7B8790` | 2.26:1 → 3.00:1 |
| 链接 | `#6699CC` | `#80AAD5` | 3.68:1 → 4.54:1 |

浅色变体同样处理（`#8792A2`→`#848F9F`、`#4A7FB5`→`#4374A5`）。

**正文亮度三档不会把层次抹平**：提亮过头会让"次级文字"和正文一样亮，层次就没了。
所以最亮的 `strong` 档也保证次级文字与正文仍有 > 1.15:1 的距离（实测 1.25:1）。

## 一个宿主笔误的补丁

宿主终端状态栏 CSS 写的是 `var(--dsw-alias-bg-l2)`，但设计令牌的真名是
`--dsw-alias-bg-layer-2`。本插件额外声明了 `--dsw-alias-bg-l2` 别名，
把那条规则救回来（否则终端状态栏底色是透明的）。

---

## 草稿机制（改颜色不再卡顿）

颜色类输入（自定义配色、正文颜色、工具行色、汇总行色）走**先预览后应用**：

- 拖动取色器 / 逐字输入 hex 时，改动只进**草稿**，更新设置页自己的预览区，
  **不重建全局令牌、不写 profile**。
- 页脚出现草稿条，列出待应用的字段，点「应用更改」才一次性重建 + 写盘，
  点「放弃」回到已生效的值。

为什么必须有这层：`applyNow()` 会重建全部令牌并经 ThemePresenter 写成 body 内联变量
（整页重算），`persistNow()` 还要往 profile 的 YAML 写盘。取色器 onChange 每帧触发、
hex 每补全一次合法值就触发，全走这条路就是"输入一个字母卡很久"。
预览区用**容器内联 CSS 变量**局部覆盖，只作用于预览子树，全局令牌一个字节都不动。

离散开关（启用/套用范围/背景变体/强调色/各高亮开关/分类勾选）**仍然即时生效**：
一次点击就结束，不存在连续触发，即时反馈更好用。

## 差量写盘 + 防回弹（修"保存方案后再调整会自己弹回"）

用户报的 bug：保存一个配色方案之后再调整，界面会时不时自己加载回原来的配置。
根因是两个叠在一起的缺陷，都已修复并有回归锁：

1. **整批写被一颗坏字段拖死**。旧版每次把全部字段打包成一次 `mutate`；
   宿主对整批做校验，任何一个字段被拒就**整批失败** —— "保存方案"看似成功
   （界面变了），实际一个字段都没落盘，下一次宿主镜像回推就把旧值倒回来。
   现在只写**与宿主快照不同的字段**（正常 1~2 个），失败时状态条显示「写入被拒」。
2. **写未落地时的竞态**。`mutate` 是异步的；promise 落地前宿主镜像的任何更新
   （重连、别的命名空间写盘）都会回调订阅，那一刻镜像里**还是写之前的值**，
   旧代码直接 adopt 就把刚提交的设置倒回去了。现在 `pendingWrites > 0` 期间
   adopt 整体跳过，落定后由宿主推送的 document-updated 自然对齐
   （与官方 ui-theme 对同一问题的做法一致）。

`page.test.mjs` 里的防回弹场景用"挂起的 promise + 中途推旧快照"复现了竞态，
并做过变异验证：临时禁用守卫，该断言立刻变红。

## 文件卡片颜色

宿主里有**两个独立组件**都会渲染文件卡片，各自定义自己的底色变量 —— 它们互不相干，
只覆盖其中一个，另一个就永远是宿主中性灰：

| 组件 | 渲染什么 | 变量定义处 | 消费处 | 表现 |
|---|---|---|---|---|
| `ChangedFiles` | 「已编辑 N 个文件」卡片 | `.<hash>_card` | `.<hash>_header` | 卡片**头部横带** |
| `Deliverables` | 「交付文件」卡片 | `.<hash>_root` | `.<hash>_file` | **整张卡片底色** |

两组变量（`--changes-fill` / `--changes-hover` 与 `--deliverable-fill` /
`--deliverable-hover`）**都不走 `--dsw-alias-*` 令牌**，值来自宿主中性灰，
所以是这两类卡片上唯一不跟主题的一块。类名前缀每次构建都变，不能写死，
插件的做法是：

1. **运行时从 CSSOM 检测类名**：扫所有样式表，找内容里定义了目标变量的那条规则，
   取它的类选择器（`_*_card` / `_*_root`）—— 不猜前缀，宿主重新构建哈希变了也能跟上。
   检测不到（卡片组件被禁用）时有界重试（每秒一次、上限 60 次），不无限轮询。
2. **特异性对齐**：把类名写三遍 `(0,3,0)`，压过宿主的两条竞争规则
   （`.x` (0,1,0) 与 `body[data-ds-dark-theme] .x` (0,2,1)），不用 `!important`。
3. 悬停色自动 = 底色朝白提亮 12%（跟宿主"hover 更亮"的方向一致）。

留空（点 ↺）= 跟随宿主默认中性灰。

**为什么单独一个测试套件**（`scripts/card.test.mjs`）：类名检测依赖宿主 CSS 的**真实结构**。
别的套件用假的 CSSOM 替身，只能证明"逻辑自洽"，证明不了"还对得上今天的宿主"。
这个套件从**安装态 app.asar** 里抠出宿主真实的 CSS 文本，按真实 CSSOM 的形状
（每条规则一个对象，`selectorText` / `cssText` 各自独立）构造替身，再跑真正的
`detectCardTargets` —— 宿主改了卡片结构（换变量名、换类名后缀、拆成新组件）时，
这里会先红。

> ⚠️ 写这个套件时踩到的坑：`client.js` 是用 `new Function('window','document',...)`
> 跑的，闭包里的 `document` 是**加载时传入的那个**，不是 `globalThis.document`。
> 所以样式表替身必须在**加载时**就挂上，事后改 `globalThis.document` 不起作用。

## 过程行高亮的 `:hover` 必须一起覆盖

这是本轮最容易漏的点：宿主对汇总类和本轮汇总都写了 hover 提亮规则，
特异性比我们的基础规则高 —— 不覆盖的话鼠标一移上去就掉回宿主原色。
所以规则成对输出，特异性逐条对齐：

| 宿主规则 | 特异性 | 我方规则 | 特异性 |
|---|---|---|---|
| `.WW4l1q_title:hover` | (0,2,0) | `button[data-process-activity]:hover` | (0,2,1) ✓ |
| `._4AI11G_root:hover:not(:disabled)` | (0,3,0) | `button[data-turn-process]:hover:not(:disabled)` | (0,3,1) ✓ |

`verify.mjs` 会逐条断言这些 `:hover` 规则存在，漏写直接测试失败。

**工具行为什么锚 `[data-disclosure-header]`**：宿主的展开内容在 header **之外**
（兄弟节点），不锚的话颜色会渗进展开区里的结果。类名用 `[class*="_leading"]` /
`[class*="_title"]` 子串匹配 —— 前缀 hash（`pFy1Ka_`）每次构建都变，
`_leading` / `_title` 这段来自源文件类名，跨构建稳定。

**两个共用值的坑**（扫了整个 `app.asar` 才查出来的，界面上会标出来）：

1. `data-variant` **不是工具行独有** —— `think` 来自 ui-chat 的推理行，
   `others` 与命令卡**共用同一个值**。所以勾选 `others` 会连带给命令卡上色，
   没法只选工具行而排除命令卡。
2. 因此这两项在界面上带「共用」标记，勾选时下方会出现说明。

---

## 代码高亮：为什么跟 Sublime 有差

**两边用的是同一套 scope 命名**（TextMate 风格）—— Sublime 的
`LaTeX.sublime-syntax` / `Python.sublime-syntax` 和 Shiki 的 `latex` / `python`
语法把同一批元素标成同样的 scope。分类完全一致，**差别在配色规则**：

| scope | Sublime Mariana | Shiki `css-variables` |
|---|---|---|
| `keyword` | `var(pink)` = `#C594C5` 紫 | `--shiki-token-keyword` |
| **`support.function`** | **`var(blue)` = `#6699CC` 蓝** | **`--shiki-token-function`** |
| **`entity.name.function`** | **`var(blue5)` = `#5FB3B3` 青** | **`--shiki-token-function`**（同一个！） |
| `entity.name` | `var(orange)` = `#F9AE58` 橙 | `--shiki-token-constant` |

**关键**：Sublime 区分 `support.function`（蓝）和 `entity.name.function`（青），
但 Shiki 的 `css-variables` 主题把两者**合并成同一个 `function` 令牌** ——
一个令牌只能一个颜色。

后果：Python 内置函数（`print` `len` `open` `enumerate`）、LaTeX 命令
（`\chapter` `\ket` `\frac`）在 Sublime 里是**蓝**的，在本插件里曾是**青**的
—— 因为插件把 function 令牌取成了 `blue5`（青，对齐函数定义名）。

**取哪个**：函数**调用**比函数**定义**常见得多，Sublime 里最常看到的也是
`support.function` 那个蓝。所以 function 令牌取 `var(blue)` `#6699CC`。
代价是 JS/Python 的函数**定义名**也从青变蓝 —— 这是 Shiki 合并 scope 的
固有代价，无法两全。

> ⚠️ 取色时别被 ClearType 骗了：截图里采样的像素是**子像素渲染的混色**，
> 一个青色的字会采出 `#5FB3B3`/`#4DB3B3` 两种值。要判断真实颜色得
> **放大截图看**，或者直接读方案文件里的 `var()` 定义。

（实测：以 Sublime Mariana 打开 Python 文档，`print`/`len`/`enumerate`/`open`
都是蓝色；`import`/`for` 是紫色（keyword）；`'Pages:'` 是绿色（string）。）

### LaTeX：把两边的 scope 表拉平对照

**不要再靠截图猜颜色。** 正确做法是把「Sublime 语法给的 scope → Mariana 的色」
和「Shiki 语法给的 scope → 令牌」两张表并排对出来。下面是照这样得到的表
（数据源：`LaTeX.sublime-syntax`、`TeX.sublime-syntax`、
`Mariana.sublime-color-scheme`、Shiki 的 `latex-B2nUCzCX.js` 语法 + 主题 19 条规则）。

| LaTeX 构造 | Sublime scope | Mariana 色 | Shiki scope | Shiki 令牌 |
|---|---|---|---|---|
| `\bi` `\zh` 命令名 | `support.function.general.latex` | 蓝 `#6699CC` | 同 | `function` ✓ |
| `\section` `\chapter` | `support.function.section.latex` | 蓝 | 同 | `function` ✓ |
| `\begin` `\label` `\ref` | `keyword.control.*.latex` | 紫 | 同 | `keyword` ✓ |
| **`\` 反斜杠** | `punctuation.definition.backslash` | **青 `#5FB4B4`** | `punctuation.definition.function.tex` | **无规则 → 继承** ✗ |
| **`{` `}`** | `punctuation.definition.arguments` | **青** | `punctuation.definition.arguments.*` | `punctuation`（灰） ✗ |
| **`$` 数学分隔符** | `punctuation.definition.string.begin/end` | **青** | `punctuation.section.embedded.*.math` | **无规则 → 继承** ✗ |
| **数学命令 `\nu` `\hbar`** | `keyword.other.math.greek/symbol/large-operator` | **紫 `#C695C6`** | `constant.character.math.tex` | **无规则 → 继承** ✗ |
| 数学数字 | `constant.numeric` | 橙 | `constant.numeric.math.tex` | `constant` ✓ |
| 数学标识符 `E` `h` `p` | `variable.other.math` | 无色（正文色） | 无规则 | 继承 ✓ |

**发现两处结构性偏差：**

1. **整个 `$…$` 块被染成橙**。Shiki 的 LaTeX 语法给数学块套了
   `support.class.math.block.latex` 这个 meta scope，而主题里第 8 条规则是
   `["constant.numeric", …, "support"] → token-constant` —— `support` 一个前缀
   就把**块内所有 token** 归到了 `constant`（橙）。Sublime 则是块内逐 token 上色
   （紫命令、白标识符、橙数字）。
2. **括号 / 反斜杠 / `$` 落到灰或无色**。它们本该是 `punctuation.definition`（青），
   但 Shiki 的主题只把 `punctuation.definition.arguments` / `.dict` / `separator`
   归到 `punctuation`，其余 `punctuation.definition.*` 与
   `punctuation.section.embedded.*` **没有任何规则** → 继承正文色。

**修法：只对 LaTeX 块覆盖两个令牌。**

```css
pre.dmt-latex{
  --shiki-token-constant:#C695C6;    /* 数学命令 → 紫（压过数学数字的橙，命令远比裸数字常见） */
  --shiki-token-punctuation:#5FB4B4; /* punctuation.definition → 青 */
}
```

CSS 自定义属性会沿 DOM 继承，Shiki 的 token span 用的是
`color: var(--shiki-token-*)`，所以在 `pre` 上重定义就能只影响这一块。

**为什么必须按块、不能全局**：全局把 `constant` 改成紫，会让 Python / JS 的数字
也变紫，而 Sublime 里 `constant.numeric` 是橙。只有 LaTeX 需要这个偏移。

**块怎么认出来**：宿主 Shiki 的输出是 `<pre class="shiki css-variables">`，
**pre 上没有语言名**（`codeToHtml` 只加 `class="shiki <themeName>"`；宿主也没把
lang 写进 DOM）。所以按内容特征判：`\begin{env}` / `\end{env}` /
`\documentclass|usepackage|section|label|ref|cite` / `$…\cmd…$` /
至少两个 `\cmd{`。代码块是滚动时才渲染的，所以用 `MutationObserver`
（只听 `childList`，改 class 不会自激）合帧重扫。

**仍然做不到的**（令牌模型的天花板）：`\` 反斜杠、`$` 分隔符在 Shiki 的主题里
**没有任何规则**（继承正文色）；数学块内「标识符（白）／运算符（橙红）／命令（紫）」
被归成同一个令牌。改 CSS 变量到不了这些地方。

### span 级后处理：把令牌模型盖不到的部分补上

所以在令牌覆盖之外，LaTeX 块还会走一遍**span 级后处理**：按文档顺序遍历 Shiki
生成的叶子 span，维护「是否在数学模式」（`$` 开关，`\$` 转义不切换），按文本判类
并打 class；CSS 用 `!important` 盖过 Shiki 写在内联 `style` 上的
`color: var(--shiki-token-*)`（**内联样式优先于普通类选择器，不加 `!important`
会被无视** —— 这是这一步唯一必须用 `!important` 的地方）。

判类规则与对应的 Mariana 色（全部取自方案文件，含此前手抄误差的修正：
`hsl(180,36%,54%)` 精确是 `#5FB4B4`，不是 `#5FB3B3`）：

| span 文本 | Sublime scope | class | 颜色 |
|---|---|---|---|
| `\` | `punctuation.definition.backslash` | `dmt-tx-bs` | `#5FB4B4` |
| `{` `}` | `punctuation.definition.arguments` | `dmt-tx-brace` | `#5FB4B4` |
| `$` | `punctuation.definition.string` | `dmt-tx-mdelim` | `#5FB4B4` |
| `\hbar` `\nu`（数学内置） | `keyword.other.math.*` | `dmt-tx-mcmd` | `#C695C6` |
| `\begin` `\label`（文本关键字） | `keyword.control.*` | `dmt-tx-kwcmd` | `#C695C6` |
| `\dd`（自定义数学宏） | `support.function.math` | `dmt-tx-mcustom` | `#6699CC` |
| 数字 | `constant.numeric` | `dmt-tx-num` | `#F9AE58` |
| `=` `<` `+` `-` | `keyword.operator` | `dmt-tx-op` | `#F97B58` |
| `_` `^` | `punctuation.separator` | `dmt-tx-sep` | `#A6ACB9` |
| `(` `)` `[` `]` | `punctuation.section` | `dmt-tx-paren` | `#FFFFFF` |
| `E` `h` `p` | `variable.other.math` | `dmt-tx-id` | `#D8DEE9` + 斜体 |

**「数学内置命令」是查表判定的**：从 `TeX.sublime-syntax` 的九个变量
（greeks / mathfun / relations / largeops / binops / symbols / accents /
arrows / delimiters）里抽出 **240 个**命令名进了 `MATH_BUILTINS`。表内的走紫
（`keyword.other.math.*`），表外的（用户自定义宏如 `\dd`）走蓝
（`support.function.math`）—— 这个区分做不了只能靠名单。

**为什么要签名守卫**：Shiki 换主题或重渲染会换掉整棵子树，class 全丢。块上存
「子元素数 + 文本长度」当签名，签名变了才重跑；否则每次 DOM 变动遍历整块太贵。

**已知残留**（Sublime 有、这里没做）：`\begin{equation}` 这类**环境形式的数学**
不切换数学模式（只认 `$`），所以环境体内的标识符不会被当数学处理。

> ⚠️ **两次踩同一个坑的教训**：截图取色不能用「最饱和像素」—— ClearType
> 子像素渲染会给蓝字配红/绿边纹，采出来是青的。要用**众数**（笔画主体色），
> 或者干脆**别取色，去读语法与配色方案的 scope 表**。`\bi` 实际是
> 「`\` 青 + `bi` 蓝」两段拼的，任何整体取色都会误导。

---

## Markdown 的细节着色

宿主渲染 markdown 有两条路径：

1. **行内 markdown**（对话正文）：marked + React renderer，输出
   `<h1>` / `<strong>` / `<em>` / `<a>` / `<blockquote>` / `<li>` / `<code>`。
   宿主的 renderer（`case "heading": return C.createElement('h'+e.depth, ...)`）
   **不保留源码符号** —— `#`、`>` 在 DOM 里根本不存在，所以没法给它们上色。
2. **代码块形式的 markdown**（```markdown 围栏）：走 Shiki。

Shiki 的 `css-variables` 主题对 markdown 的映射：

| 元素 | scope | → token |
|---|---|---|
| `#` 标题符号 | `punctuation.definition.heading.markdown` | **无规则** → 继承 |
| 标题文字 | `entity.name.section.markdown` | **无规则** → 继承 |
| `>` 引用符号 | `punctuation.definition.quote.begin.markdown` | **无规则** → 继承 |
| 列表符号 | `beginning.punctuation.definition.list.markdown` | string（绿） |
| 行内代码 | `markup.inline.raw.string.markdown` | string（绿） |
| 链接 | `meta.link.inline.markdown` | link（蓝） |

Sublime Mariana 的 `markup.*` 规则里，宿主**没有**而 Sublime**有**的三处：

| 元素 | 宿主现状 | Sublime Mariana | 动作 |
|---|---|---|---|
| 列表符号 | `li::marker { color: var(--dsw-alias-label-secondary) }` 灰 | `var(green)` 绿 | 覆盖 |
| 引用 | 只有左边框，文字是正文色 | `var(orange)` 橙 | 覆盖 |
| 行内代码 | 无背景 | `markup.raw.inline` 蓝灰底 | 覆盖 |

标题 h1-h6 已经是粗体 + 继承正文色 —— 与 Mariana 的 `markup.heading`
（bold + 继承）一致，不动。

**怎么覆盖**：三条规则挂在 `[class*="_markdown_"]` 容器下（前缀来自宿主源文件名，
跨构建稳定 —— 与正文高亮同一套锚点），并排除紧凑变体
（`:not([data-markdown-variant="compact"])`，那是宿主刻意压缩的摘要区）。

**与正文高亮的关系**：正文高亮那套也会命中 `li::marker` / `blockquote` / `code`。
两张表都挂在 `<head>`，后插入的赢 —— markdown 细节表在
`syncMarkdownSheet` 里挂得比 prose 晚，所以细节色覆盖正文高亮的对应色。
这是刻意的：正文高亮是「对话正文」的增强（可关），markdown 细节是
「对齐 Sublime」的基础层（不该被前者盖掉）。而且 markdown 细节表
**不随 prose 开关消失** —— 关掉正文高亮，预览 .md 文件的细节仍在。

---

## 启动性能：为什么装着插件启动会变慢

### 先量清楚

| 项 | 实测值 |
|---|---|
| `client.js` 体积 | 135 KB |
| 编译 + 执行 bundle 顶层 + factory | **6.4 ms** |
| `resolveTokens`（151 令牌） | 0.09 ms/次 |
| 四张样式表的字符串构建 | 合计 0.02 ms/次 |
| 宿主注入的样式表 | **160 张 / 约 2179 条规则 / 276 KB** |
| 设置页样式表 | 15.5 KB |

**纯 JS 只占 6.4 ms** —— 所以慢的不是计算，是**对 DOM/CSS 做的事**。下面四条是
逐条量出来并修掉的，每条都在 `runtime.test.mjs` 场景 9/10 里有回归锁。

### 一、`applyNow()` 被反复调用，每次都重写一切（主因）

`applyNow()` 在启动期会被调很多次：

1. `apply()` 里立即一次；
2. 每次 `theme/change`；
3. **等 `form` 服务时的 250ms 重试**（`bindWhenReady`，最多 120 轮 ≈ 30 秒）。

而它以前每次都无条件做两件昂贵的事：

- **重推 `overrideTokens`** —— 宿主的 ThemePresenter 会因此重建令牌表，并把
  151 个令牌逐条写成 `body` 内联变量（整页重算）；
- **重写四张 `<style>` 的 `textContent`** —— 赋值会让浏览器**重新解析整张表
  并触发全文档样式重算**，哪怕内容一个字都没变。

**修法**：

- `writeSheet(el, css)` 只在内容真的变了才赋值（缓存挂在元素自己的 `__dmtCss` 上，
  元素被移除重建后自动失效）；
- `overrideTokens` 前先比令牌的内容签名，**只在"层确实装着 + 内容没变"时跳过**
  —— 所以 `teardown()` 之后仍会正常重装（`teardown` 会把签名作废）；
- `publish()` 也加了内容签名：内容没变就不 `store.set`，否则设置页每 250ms
  被 `useSyncExternalStore` 重渲染一次（顺带满足 React「没变则引用不变」的要求）。

回归锁（20 次内容相同的 `theme/change`）：

```
✓ 状态未变时 20 次 theme/change 不再重推令牌 — 1 → 1        （旧：1 → 21）
✓ 状态未变时不再重写 <style>                  — 3 → 3        （旧：3 → 83）
✓ 改设置时仍然重新应用（守卫没有吃掉正确性）   — 1 → 2
✓ 切浅色 + 仅深色模式 → 叠加层被卸掉
✓ 切回深色 → 叠加层重新装上（签名作废逻辑正确）
```

### 二、卡片检测把 2179 条规则全序列化了一遍

`detectCardTargets()` 要在宿主的 CSSOM 里找两组变量，以前的写法是：

```js
const text = rule.cssText || ''      // ← 对每一条规则都序列化
if (!text.includes(target.varName)) continue
```

`rule.cssText` 会把整条规则序列化成字符串，**只为了一次 `includes` 判断**。
160 张表 / 2179 条规则全走一遍，是启动时一次可观的开销。

**修法**：改用 `rule.style.getPropertyValue(varName)` —— 直接问声明块，
不序列化。老浏览器/测试替身没有 `.style` 时退回文本匹配。
（`card.test.mjs` 的 CSSOM 替身现在也还原了 `.style` 成员，否则测到的只是
兜底路径，跑在生产里的快路径反而没覆盖。）

另外加了**样式表计数守卫**：等 ui-deliverables 出现的重试是每秒一次、最多 60 次，
现在只在「样式表数量变了」时才重扫 —— 数量没变就说明没有新表进来，不可能有新发现。

### 三、15.5 KB 的设置页 CSS 在启动时就被解析

`installPageStyles(ctx)` 以前在 `apply()` 里就把整张设置页样式表插进 DOM，
可用户多数时候根本不打开设置页。

**修法**：改由 `MarianaSettingsPage` 在**首次渲染时**调 `ensurePageStyles()`
按需安装（幂等，重复渲染不堆叠）。启动路径完全不碰这 15.5 KB。

### 四、宿主半体的模块导入

`index.js` 顶层 `const Config = buildConfig()` 会做 `createRequire` 探测
（按"最可能命中"的顺序试多个锚点）。**在普通 Node 下实测 50.7 ms**（所有锚点
全部失败的最坏情况）；真实 DSH 里第一个锚点就能命中 `app.asar` 内的
`schemastery`，所以是一个量级更小的开销 —— 这一项没有改动。

### 已知取舍：`[class*="_markdown_"]`

正文/Markdown 两张表共有 16 条规则以 `[class*="_markdown_"]` 打头。属性子串
选择器用不了类名索引，比精确类名贵。之所以这么写是为了**跨宿主构建稳定**
（前缀来自源文件名，末尾哈希每次构建都变）。

好在这里的匹配是右到左的：浏览器先找 `strong`/`em`/`a`/`code`/`li` 这些
**右端**元素（数量不多），再沿祖先链检查属性，代价是可控的。若要进一步优化，
可以像 `detectCardTargets` 那样在运行时解析出真实哈希类再拼精确选择器 ——
但那会让"宿主换模块名就失效"的风险回来，暂不做。

### 五、profile 的 lockfile 不同步（实测 **~30 秒**，比前四条都大）

**这是最容易被忽略的一条，而且不在插件代码里。**

DSH 启动时会跑 pnpm 来对齐 profile 的依赖（`dsh-app-boot` 里的
`reconcileProfilePlugins`，注释写着 "inventory captured **before pnpm**"）。
只要 profile 的 `package.json` 比 `pnpm-lock.yaml` 新，pnpm 就会**重新解析整棵依赖树**
—— 包括 `github:` 形式的 tarball 依赖，都要联网取元数据。网络一慢，启动就多等半分钟。

装/改插件恰好会让两者不同步（往 `dependencies` 里加了一条）。判据很好拿：

```sh
node <runtime>/dependencies/pnpm/bin/pnpm.mjs install --frozen-lockfile --offline
```

不同步时它会明确报出来：

```
[ERR_PNPM_OUTDATED_LOCKFILE] pnpm-lock.yaml is not up to date with package.json
  Failure reason:
  specifiers in the lockfile don't match specifiers in package.json:
* 1 dependencies were added: dsh-colorlab@link:C:/Users/15623/.dsh/plugins/dsh-colorlab
```

**修法**：让 lockfile 与 package.json 对齐。`link:` 依赖在 lockfile 里**只需要一条
importer 记录**（不进 `packages`/`snapshots`，和已有的三个 link 依赖同形）：

```yaml
      dsh-colorlab:
        specifier: link:C:/Users/15623/.dsh/plugins/dsh-colorlab
        version: link:../../plugins/dsh-colorlab
```

对齐之后同样的命令变成：

```
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 772ms
```

**给用户的提示**：用 `dsh plugin add` 安装不会踩这个坑（安装器会一起更新 lockfile）；
手工把依赖写进 profile 的 `package.json` 时，记得跟一次 `pnpm install`。

---

## Config schema 的 volatile 标记

Host 半体额外导出 `Config`，DSH 据此投射出设置表单。但 `@deepseek-ai/dsh-settings`
的 `write()` 开头就有 `volatileForm(schema)` 检查，且每个字段路径要过
`isVolatilePath` —— **只有 `meta.volatile` 为真的字段能写盘**。

普通 `z.string()` 字段不可写：表现是界面能改、主题立即生效，
但 profile 的 `cordis.patch.yml` 永远不更新，而且错误被 remote 层吞掉，
前端连一句报错都看不到。所以每个字段都要 `.volatile()`。
`.default()` 和 `.volatile()` 都按能力探测，缺哪个就跳过哪个。

`schemastery` 不在插件自己的 node_modules 里（桌面端把它装在 `app.asar` 内部），
所以按"最可能命中"的顺序收集锚点：argv 里的 app.asar 路径 →
`process.execPath` 推出的 `resources/app.asar/dsh` → `DSH_PROFILE_DIR` →
插件自身路径上的 profiles 段 → 插件自身（兜底）。
找不到就返回 undefined —— 条目投射不出设置表单，但主题覆盖本身照常工作。

---

## 校验

### 离线校验（不需要重启，共 11 个套件）

```sh
node scripts/test-all.mjs

# 用 DSH 自带 Electron 跑，额外验证 Host 半体的 Config schema
node scripts/test-all.mjs --electron
```

| 套件 | 查什么 |
|---|---|
| 语法检查 ×2 | `index.js` / `client.js` 能被解析 |
| `verify.mjs` | 令牌名合法性 / 值合法性 / 双值齐备 / WCAG 对比度 / 覆盖完整性 / **正文与过程行选择器、var() 兜底、注入防御** / **两类卡片的底色覆盖** |
| `card.test.mjs` | 从**安装态 app.asar** 抠出宿主真实 CSS，验证**两类卡片组件**（`_card` / `_root`）都能被检出并生成覆盖规则 |
| `latex.test.mjs` | 代码高亮的令牌映射：function = `var(blue)`、keyword/string/constant 不被误改、Markdown 三条规则存在且用稳定前缀锚点 |
| `runtime.test.mjs` | 两条通道切换、`theme/change` 重算、浅色回退、开关、**正文与过程行样式表挂载/卸载**、`ctx.dispose` 无残留 |
| `custom.test.mjs` | 自定义配色传导、非法输入防御、无死槽位、方案保存/载入/上限、对比度计算、**正文亮度三档与层次保持** |
| `page.test.mjs` | 设置页渲染、控件数量、正文/过程行预览、槽位取色、勾选写盘、方案载入/删除、**亮度档位写盘** |
| `contract.test.mjs` | profile 登记、软链、`patch.id` 与 `SETTINGS_ENTRY` 一致、无 insert 行但配置覆盖行已落盘 |
| `loader.test.mjs` | 复刻宿主的 `dsh.client` 解析器，验证声明形状、包名归一、exports 指向、patch 行 |
| `host.test.mjs` | `webserver/index-inject` 注入内容、开关生效、Config schema 与 volatile 标记 |

`verify.mjs` 里的令牌名白名单是从安装态 `app.asar` 的
`@deepseek-ai/dsh-client-ui-theme/lib/client.js` 里 `design-platform.css` 抽出的**快照**；
`loader.test.mjs` 的解析器语义照抄 `@deepseek-ai/dsh-client-modules/lib/index.js`。
宿主升级后如果改了令牌名或装载契约，这两处会先失败，
而不是等到界面上某个角落不对才发现。

### 在线冒烟（需要先重启 DSH，并带上访问令牌）

DSH 的 GUI 用**进程启动令牌**鉴权：匿名 `GET /` 一律 401。令牌在宿主进程内随机生成，
外部拿不到，只能从浏览器地址栏复制：

```sh
# 把浏览器里正在用的完整 URL（含 ?token=...）作为参数传进来
node scripts/smoke.mjs "http://127.0.0.1:<port>/?token=<你的令牌>"

# 或者
DSH_WEB_TOKEN='<你的令牌>' node scripts/smoke.mjs
```

检查四件事：首页 200 且含首屏画布色样式、插件的 `client.js` 可取、
boot graph 里有本插件行、设置命名空间被服务。

### 人工验收清单

重启后逐条勾：

- [ ] 深色外观下背景是 `#343D46`，不是宿主的 `#151517`
- [ ] 侧栏、卡片、菜单、气泡都是同一族冷灰蓝，没有突兀的深灰块
- [ ] 代码块里关键字是紫、字符串是绿、函数是青、数字是橙、注释是灰蓝
- [ ] ` ```diff ` 代码块里新增行绿、删除行红（本轮补的 3 个变量）
- [ ] 对话正文里标题是青、加粗是橙、行内代码是绿、列表标记有颜色
- [ ] 侧栏终端底色跟着变（不是纯黑）
- [ ] 设置 → ColorLab，状态条显示「主题通道 override / 已覆盖 N 个令牌 / 正文高亮 开」
- [ ] 过程行高亮：「写入 / 编辑 / 运行命令」三类的图标和标签变亮绿
- [ ] 过程行高亮：同行的摘要（文件路径、`2KB +48 -0`）**不变色**
- [ ] 过程行高亮：展开条目后，里面的结果内容不变色
- [ ] 过程行高亮：勾上「读取」→ 读取行也跟着上色；取消 → 立即恢复
- [ ] 过程行高亮：换颜色 → 图标与文字一起变
- [ ] 过程行高亮：勾「工具调用 / 命令」→ 出现「与命令卡共用」提示，命令卡确实也上色
- [ ] 改「背景变体」「强调色」，界面立即变化
- [ ] 关掉「正文高亮」：正文立刻退回全部同色（预览区同步变化）
- [ ] 关掉「代码高亮色板」：代码块退回宿主配色，但正文高亮仍生效（两个开关独立）
- [ ] 自定义配色：点主背景色块改色，整个界面底色立即跟着变
- [ ] 自定义配色：把正文改成接近背景的深灰，设置页出现对比度警告
- [ ] 自定义配色：改回默认值后该槽位的「↺」按钮消失（覆盖被自动清除）
- [ ] 文件卡片颜色：挑色后「已编辑 N 个文件」卡片的**头部横带**变成该颜色
- [ ] 文件卡片颜色：挑色后「交付文件」卡片的**整张底色**也变成该颜色
- [ ] 文件卡片颜色：鼠标悬停到这两种卡片上，底色朝白提亮一档
- [ ] LaTeX 代码块：`\chapter` `\begin` `\frac` 是**蓝色** `#6699CC`（与 Sublime 一致）
- [ ] Python 代码块：`print` `len` `enumerate` `open` 是**蓝色** `#6699CC`（与 Sublime 一致）
- [ ] Python 代码块：`import` `for` 是**紫色** `#C594C5`（keyword）
- [ ] Python 代码块：字符串是**绿色** `#99C794`
- [ ] Markdown 预览：列表符号是**绿色**（Sublime 的 `var(green)`）
- [ ] Markdown 预览：引用段落文字是**橙色**（Sublime 的 `var(orange)`）
- [ ] Markdown 预览：行内代码有淡色底
- [ ] 关掉「正文高亮」后，Markdown 细节仍在（列表符号/引用/行内代码底色没消失）
- [ ] 配色方案：起名保存 → 列表出现带 5 个色点的条目 → 显示「使用中」
- [ ] 配色方案：改几个颜色 → 点「载入」→ 一键切回
- [ ] 配色方案：「恢复默认配色」后已保存的方案仍在
- [ ] 切到浅色外观：模式为「仅深色」时应完全回退成宿主浅色
- [ ] 关掉「启用」：立即回退；再打开：立即恢复
- [ ] 重启 DSH 后设置保持（`cordis.patch.yml` 里有 `mariana-theme` 行）
- [ ] 禁用插件：所有样式消失（含正文），无残留色块
- [ ] **启动耗时**：开着插件重启，首屏出现时间与禁用插件时相比没有肉眼可见的差别
- [ ] **设置页样式表按需加载**：重启后不打开设置页，`document.head` 里没有
      `data-plugin-css="dsh-colorlab/page.css"` 这个 `<style>`（打开设置页后才有）
- [ ] **控制台干净**：重启后 F12 打开 Console，没有 `[dsh-colorlab]` 开头的报错
      （尤其不能有 `RangeError: Maximum call stack size exceeded` —— 那是 `applyNow`
      与 `theme/change` 互相递归的信号，见上文防重入那一节）
- [ ] **LaTeX 对标 Sublime**：`\` 反斜杠是**青**、命令名是**蓝**（`\begin`/`\label` 是紫）
- [ ] **LaTeX 对标 Sublime**：`{` `}` 与 `$` 是**青**
- [ ] **LaTeX 对标 Sublime**：数学命令 `\hbar` `\nu` `\oint` 是**紫**，自定义宏 `\dd` 是**蓝**
- [ ] **LaTeX 对标 Sublime**：数学数字是**橙**、`=` `+` 是**橙红**、标识符 `E` `h` 是**白斜体**
