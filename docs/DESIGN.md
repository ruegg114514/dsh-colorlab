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

两条互斥，成功一条即卸掉另一条。设置页的诊断行（只在异常时出现）会报告当前走的是哪条。

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

**例外：玻璃滑块也走即时路径**（`updateGlassNow` = 立即重建玻璃表 +
400ms 防抖写盘）。理由：表面浓度/浮层/模糊/白雾的效果就在**整个界面**上，
设置页里没有自己的预览区 —— 进草稿等于"拖了看不到"，用户实测报过。
草稿机制保护的是"每帧重建全局令牌"的成本，玻璃表的重建没有这个成本。

## 差量写盘 + 防回弹（修"保存方案后再调整会自己弹回"）

用户报的 bug：保存一个配色方案之后再调整，界面会时不时自己加载回原来的配置。
根因是两个叠在一起的缺陷，都已修复并有回归锁：

1. **整批写被一颗坏字段拖死**。旧版每次把全部字段打包成一次 `mutate`；
   宿主对整批做校验，任何一个字段被拒就**整批失败** —— "保存方案"看似成功
   （界面变了），实际一个字段都没落盘，下一次宿主镜像回推就把旧值倒回来。
   现在只写**与宿主快照不同的字段**（正常 1~2 个），失败时诊断行显示「写入被拒」。
2. **写未落地时的竞态**。`mutate` 是异步的；promise 落地前宿主镜像的任何更新
   （重连、别的命名空间写盘）都会回调订阅，那一刻镜像里**还是写之前的值**，
   旧代码直接 adopt 就把刚提交的设置倒回去了。现在 `pendingWrites > 0` 期间
   adopt 整体跳过，落定后由宿主推送的 document-updated 自然对齐
   （与官方 ui-theme 对同一问题的做法一致）。

`page.test.mjs` 里的防回弹场景用"挂起的 promise + 中途推旧快照"复现了竞态，
并做过变异验证：临时禁用守卫，该断言立刻变红。

## 文件卡片颜色

宿主里有**四个独立组件**都会渲染卡片，各自定义自己的底色变量 —— 它们互不相干，
只覆盖其中一个，另一个就永远是宿主中性灰：

| 组件 | 渲染什么 | 变量 | 变量定义处 | 消费处 | 表现 |
|---|---|---|---|---|---|
| `ChangedFiles` | 「已编辑 N 个文件」 | `--changes-fill` / `--changes-hover` | `.<hash>_card` | `.<hash>_header` | 卡片**头部横带** |
| `Deliverables` | 「交付文件」 | `--deliverable-fill` / `--deliverable-hover` | `.<hash>_root` | `.<hash>_file` | **整张卡片底色** |
| `ui-plan` `PlanPreview` | 「计划」卡片 | `--plan-card-fill` / `--plan-card-hover` | `.<hash>_card` | 与定义处**同一个类** | **整张卡片底色** |
| `ui-schedule` `ScheduleCreateCard` | 排程卡片 | `--card-fill` / `--card-hover` | `.<hash>_card` | 与定义处**同一个类** | **整张卡片底色** |

> ⚠️ 前两种是「父定义、子消费」，后两种是**变量和背景在同一个类上**；变量名也
> 各不相同（`--changes-*` / `--deliverable-*` / `--plan-card-*` / `--card-*`）。
> 早先只覆盖了前两种，于是「计划」卡片一直是中性灰 —— 这类遗漏只能靠
> **把宿主里所有卡片组件的变量名找全**来避免，不能只照着已生效的那个推理。

四组变量都不走 `--dsw-alias-*` 令牌，值来自宿主中性灰，
`--deliverable-hover`）**都不走 `--dsw-alias-*` 令牌**，值来自宿主中性灰，
所以是这几类卡片上唯一不跟主题的一块。类名前缀每次构建都变，不能写死，
插件的做法是：

1. **运行时从 CSSOM 检测类名**：扫所有样式表，找内容里定义了目标变量的那条规则，
   取它的类选择器（`_*_card` / `_*_root`）—— 不猜前缀，宿主重新构建哈希变了也能跟上。
   某个组件的样式表是**懒加载**的（用到它才注入），所以「没找齐」是常态；
   重试每秒一次、上限 60 次，不无限轮询，且重试**不强制重扫**（只有样式表张数变了才扫，
   否则空转的重试几乎不花钱）。

   > ⚠️ **判据必须是「两个都找到」，不是「找到一个」。** 宿主是**分批注入**样式表的：
   > 第一轮往往只找得到 ChangedFiles 的 `--changes-fill`，Deliverables 的
   > `--deliverable-fill` 晚一步才进 DOM。早先用「结果非空即算成功」，于是找到一个
   > 就再也不重试 —— 真机表现就是**「已编辑」卡片有色、「交付文件」卡片一直没色**。
   > 现在按 `CARD_TARGETS` 的总数判定（`cardTargetsComplete`），并且新检测用
   > `mergeCardTargets` **并进**上一轮的结果而不是覆盖，重试时也不清空已找到的。
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

### LaTeX：**整份移植 Sublime 的语法**，不再自己猜规则

前面几轮走过弯路，教训值得留着：**不要靠"按 token 猜颜色"去逼近 Sublime**。
宿主用的 Shiki 主题会把 scope 归并成 9 个令牌，插件只能改令牌的**值**、
改不了**映射**；更要命的是 **Shiki 会按"解析后的颜色"合并相邻 token** ——
数学里大量 scope 在主题里没有规则 → 全落到同一个 `var(--shiki-foreground)`
→ **整段数学糊成一个 span**。在那上面怎么做都不可能对。

所以 LaTeX 走独立通道：**照抄 Sublime 的语法与配色，自己分词、自己上色。**

**先决问题：哪些块是 LaTeX —— 只认宿主声明的语言名，绝不猜内容。**

宿主把语言写在代码块左上角的**横幅**里（`data-code-block-banner` 里的第一个 `span`）。
文件预览时它就是**文件后缀**推出来的语言，对话代码块里则来自 ``` 后面的标注 ——
两种情况都已经是对的了，直接读即可。**读不到语言名就不碰**（退回 Shiki 的普通高亮）。

> ⚠️ 早先这里有一套「猜内容特征」的兜底，**误伤很严重**：用户随便点几个就发现
> js / yaml / json / ps1 全被按 LaTeX 上色。根因是两条规则太松：
>
> - 「≥2 个 `\cmd{`」被**正则量词**打中 —— `\d{4}` `\w{2}` 正好是「反斜杠 + 字母 + `{`」；
> - 「`$…\cmd…$`」被 **PowerShell** 打中 —— `"C:\Users\$env:USERNAME"` 里两个 `$`
>   夹着 `\Users`，形状和行内数学一模一样。
>
> 教训：**能读就别猜。** 兜底那套已经整个删掉，宁可漏掉一个 LaTeX 块（它退回普通高亮），
> 也不能把 JS 文件按 LaTeX 上色。

```
LaTeX.sublime-syntax ─┐
                      ├─ tools/build-tex-grammar.py ─→ tools/tex-grammar.json
TeX.sublime-syntax ───┘        （变量替换 / extends 合并 / Oniguruma→JS）

Mariana.sublime-color-scheme ─ tools/build-mariana-colors.py ─→ tools/mariana-colors.json

tools/tex-tokenizer.mjs  ← mini TextMate 引擎，跑上面那份语法
tools/tex-colors.mjs     ← 选择器匹配（`,` 并列 / 空格后代 / `-` 排除 / `|` 或）
        └─ tools/embed-tex-assets.mjs ─→ 注入 client.js 的生成区
```

**`tools/` 是唯一真源，`client.js` 里的那段是生成物。** 改了 tools/ 要跑
`node tools/embed-tex-assets.mjs`；测试会核对生成区与真源一致，忘了重新生成会红。

编译期要处理的几件事（都有专门的注释）：

| 事项 | 说明 |
|---|---|
| 变量替换 | LaTeX `extends` TeX，所以**变量也要继承**（`{{letter}}`/`{{cmdname}}` 定义在 TeX 侧） |
| `meta_prepend` / `meta_append` | context 首项是这两个指令时，表示**前置/追加**到继承来的同名 context，而不是覆盖。丢掉它会让 LaTeX 的 `math-content` 整个替换掉 TeX 的 → **数学着色规则一条不剩**，`$` 也匹配不上 |
| Oniguruma → JS 正则 | `(?x)` 扩展模式、POSIX 字符类 `[[:alpha:]]`、原子组、占有量词 |
| 正则标志 | `d`（拿捕获组精确下标）、`y`（锚定 lastIndex）、**`m`（`^` 按行 —— Sublime 的 `^` 就是行首）** |

引擎侧踩过的坑：

- `m.indices[i]` 是**绝对**下标，不是相对匹配起点 —— 当成相对用会"pos=0 时对、
  往后每段都错位"。
- 捕获组会**嵌套**：`sections` 规则里捕获 2（反斜杠 `\`）嵌在捕获 1（`\chapter`）
  内部。顺序输出会让内层和外层重叠，**反斜杠被打印两遍**。正确做法是按边界切段、
  每段取"覆盖它的所有捕获组"，外层在前内层在后。
- 颜色特异性：**先看命中位置在 scope 栈里的深度**，再看选择器长度，都相同才轮到
  "后写者胜"。这是反斜杠能单独取到青色的原因 —— 它的栈是
  `[… support.function.general.latex, punctuation.definition.backslash.latex]`，
  两条规则的路径长度都是 1，但 `punctuation.definition` 命中更深的那层。

**于是这些以前做不到的现在都对了**（都有测试锁着）：

| 元素 | 结果 |
|---|---|
| 反斜杠 | 独立成段 → **青** `#5FB4B4` |
| 命令名 | `support.function.*` → **蓝斜**；`\begin`/`\label` 等 `keyword.*` → **紫** |
| **所有花括号** | `punctuation.definition.group.brace.*` → **青**（`\zh{` 这种自定义宏也不例外） |
| `$` | `punctuation.definition.string.*` → **青** |
| 数学内置命令 | `keyword.other.math.*` → **紫** |
| 自定义数学宏 | `support.function.math` → **蓝斜** |
| 数字 | `constant.numeric.value` → **橙** |
| `=` `+` `-` | `keyword.operator.*` → **橙红** `#F97B58` |
| 标识符 | `variable.other.math` → **正文色 + 斜体** |
| 注释 | `comment.line.percentage` → blue6 灰 |

### 渲染：**一个宿主的节点都不动**

宿主的代码块有两条渲染路径：

1. **流式**：React 自己管 `<pre><code>`，它持有 text 节点的引用；
2. **静态**：`<div dangerouslySetInnerHTML={{__html: Shiki输出}}>`（文件预览走这条）。

第 1 条里改写 DOM 会让 React 更新到已脱离的节点上，**流式输出直接卡住**。
所以做法是「兄弟层」：

```
<pre class="shiki dmt-latex">        ← 只加一个类
  <code class="dmt-tex-hidden">…</code>   ← 宿主原本的，display:none，React 照常更新它
  <code class="dmt-tex-layer">…</code>    ← 我们渲染的，正常流布局，占同样的位置
</pre>
```

- 宿主节点**原封不动**（测试断言其 `textContent` 不变）；
- 我们的层是**新加的兄弟**，React 不管它，所以可以放心 `innerHTML`；
- 行号是 `.line` 上的 CSS 计数器画的，所以我们的层同样按
  `<span class="line">` 分行、行间放换行文本节点；
- 宿主内容一变（流式追加/换主题重渲染），观察器发现原文变了就重画我们的层。
  **判据用"原文内容"** —— 早先用"子元素数 + 文本长度"，重渲染后这两个数不变，
  于是永远跳过、样式补不回来（表现为"有的正常、有的是白的"）。

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
* 1 dependencies were added: dsh-colorlab@link:<DSH_HOME>/plugins/dsh-colorlab
```

**修法**：让 lockfile 与 package.json 对齐。`link:` 依赖在 lockfile 里**只需要一条
importer 记录**（不进 `packages`/`snapshots`，和已有的三个 link 依赖同形）：

```yaml
      dsh-colorlab:
        specifier: link:<DSH_HOME>/plugins/dsh-colorlab
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

## 玻璃界面（可选层）

### 架构一句话

**一张背景层 + 全透明容器 + 只在叶子表面涂差值 alpha。** 背景层
（`#dmt-wallpaper`，body 首子、fixed、z-index:0）里铺壁纸/渐变/等高线，
模糊做在它自己身上（`style.filter` + `scale(1.08)` 抗晕边）；三列与所有
容器透明；每类表面按自己的档位涂 `rgba(色, α)`。

### 三条用真机事故换来的定律

1. **绝不跨列涂父容器。** 曾经给 `_frame` 及其父补过侧栏色，结果"左边栏
   颜色被统一到正栏、只有标题栏跟着浓度变"—— 父层被两层各吃一次 alpha，
   信号连乘。所有涂色只发生在叶子表面。
2. **压暗层（veil）必须合成进背景层自身的 `background-image`，不能挂
   `#root::before`。** `#root` 被设为 `z-index:1` 后自身是层叠上下文，
   它内部的定位伪元素会画在静态流内容**之上** —— 一整页 55% 灰纱连文字
   一起压暗。放进背景层后结构上保证"压背景不压字"。
3. **OS 的 `prefers-reduced-transparency` 不能当否决闸。** Windows
   「透明效果=关」会让 Chromium 报 reduce —— 用户**显式打开**的插件功能
   被系统启发式钉死（浓度滑块全失效的真机事故）。无障碍启发式只该约束
   系统自己的 UI，不该覆盖显式 opt-in；该媒体查询已整体删除并有负向锁。

### 差值上色（为什么每层涂的不是目标值）

宿主每类浮面都有自己的涂色层（卡片、气泡、菜单各一层），旧版"每层直涂
α"的结果是合成值连乘 → 卡片几乎实心。现在每层只补**自己与下层之间的差**：

```
a = (F − B) / (1 − B)      B = 下层合成值，F = 本层档位目标
```

合成恰好收敛到档位：浮层 = 列 + 0.10、代码块 = 列 + 0.14、横幅 + 0.04、
hover + 0.05、active + 0.09。「浮层浓度」滑块 = 在 +0.10 之上再加的量
（0–40%），不是绝对值。

**颜色预补偿**：列的半透明会把透上来的东西染成列色，卡片"变成正文色"。
每个涂色点先解 `C' = [(1−α)·F·C − α·(1−F)·B] / (F−α)`，合成后各表面
保住自己的语义色。

### 输入卡硬裁（seat lift）

正文从输入卡底下穿帮的解法：把 `[data-composer-seat]` 从滚动容器内部
**搬到它旁边**（flex 兄弟），滚动内容在卡片上缘被物理裁断，不需要任何
backdrop-filter。900ms 启动保护 + body MutationObserver + 250ms 去抖，
玻璃关掉时原位还原。

### backdrop-filter 的保留清单

只留在**背后有活文字**的表面：对话框/菜单（frosted）、标题栏拖动区。
代码块/卡片/输入卡**一律不加**（dsh-theme-endfield 的 glass.md 实测：
backdrop-filter 使元素成为 fixed 后代的包含块 → tooltip 坐标错乱 +
ResizeObserver 抖动；且我们的表面背后本来就是糊好的图，再糊是纯浪费）。
glass.test 有正/负双向锁。

### 分层浓度可调（2026-10-23，参照 dsh-glass-ranswork）

原来 `GLASS_TIER` 是五个写死的常量（`float 0.10 / code 0.14 / hover 0.05 /
banner 0.04 / fogPer 0.30`）。参照插件 dsh-glass-ranswork 的做法相反 ——
它算法简单（`color-mix` 乘百分比）但**每一档都给滑块**，其中
`panelOpacity` / `previewOpacity` 两档是它 README 里专门论证过的
「可读性预算不能只有一个」。

我们保留自己的差值算法（它更严谨：每层只补 `(F−B)/(1−B)`，
任何位置的最终合成都收敛于目标；它自己也踩过 `1-(1-a)²` 的连乘问题），
只把三个「用户真的会想调」的档位暴露出来：

| 字段 | 映射 | 区间 | 默认 |
|---|---|---|---|
| `glassFloat` | `tier.float` | 0–40 | 10 |
| `glassCode` | `tier.code` | 0–40 | 14 |
| `glassHover` | `tier.hover`（`active` 自动取 1.8×） | 0–20 | 5 |

`banner` / `fogPer` 刻意不暴露：前者是代码块横幅的固定微调，
后者是 fog 滑块的换算系数 —— 再给一个滑块只会让两个控件互相打架。

**踩到的两个坑**（都是测试抓出来的，值得记）：

1. **单位不统一**。`read()` 的 fallback 传的是「出厂增量的百分点」（10/14/5），
   但函数内部统一除以 100 换算成 0–1。第一版写成
   `if (!Number.isFinite(raw)) return fallback`，于是缺字段时 `float` 直接
   返回 **10** 而不是 0.1 —— 等于 1000% 不透明度，整窗被刷成实心，
   玻璃表的合成值全是 `1.00`。现在 fallback 走同一条 `/100` 路径。
2. **`from` 参数必须一路透传**。`buildGlassSheet(state, …)` 收的是**参数** `s`，
   而 `glassTier()` 最初只读模块级 `state`。两者在设置页「预览 vs 实际生效」
   时会分叉。现在 `glassTier(from)` / `wallpaperFitStyle(from)` /
   `glassSolidAlpha(alpha, from)` / `glassFloatAlpha(a, fog, from)` /
   `glassFloatTarget(a, fog, from)` / `glassTokenDecls(…, from)` 全部支持透传，
   `buildGlassSheet` 内部一律传 `s`，运行时路径省略参数读 `state`。

### 按区域独立档（2026-10-23 第二轮）

第一轮把 `GLASS_TIER` 的三个常量（浮层/代码块/悬停）暴露成滑块，那解决的是
「**离底板多远**」。第二轮解决的是另一个维度：**这块 UI 要不要读字**。

参照插件 dsh-glass-ranswork 的 `panelOpacity` / `previewOpacity` 两档在它
README 里有专门论证：「面板（文件预览、费用/会话统计弹层、浮层菜单）是
**要读字**的地方，和背景装饰不是一个可读性预算。」这条判断是对的，采纳。

四个字段，默认全部 `-1` = **不覆盖**（跟随默认档）：

| 字段 | 区间 | 消费者 | 默认行为 |
|---|---|---|---|
| `glassPanelOpacity` | 0–100 | 对话框/菜单/列表/radix popper | 浮层档 + 0.02 |
| `glassPreviewOpacity` | 0–100 | 卡片检测到的宿主类（`--changes-fill` 等） | 浮层档 |
| `glassOverlayBlur` | 0–80 px | 同 panelOpacity 那组选择器 | `min(40, glassBlur + 10)` |
| `glassComposerBlur` | 0–100 | 输入卡 `[class*="RlGAzG_card"]` | 浮层档 |

**`-1` 语义是刻意设计的**：老 profile 不写这些字段时，`glassIndependent()`
返回 `null`，调用点走原来的公式 —— 升级后行为**逐字节不变**。
这比「给个新默认值」安全得多：新默认值会静默改变所有现有用户的观感。

### ⚠️ 与参照插件的分歧：输入卡是浓度不是模糊

参照插件的 `composerBlur` 挂在 `[data-composer-card]::before` 上做**真模糊**，
因为**它没有做输入卡硬裁** —— 输入卡背后是活的正文，必须糊掉才不穿帮。

我们做了 seat lift（见「输入卡硬裁」一节）：输入卡被抬成滚动容器的 flex 兄弟，
聊天内容**物理硬断在卡片上沿**，卡片背后根本没有文字。所以 2026-10-22 就
已经把这张卡的 `backdrop-filter` 删了 —— 保留它只有「成为 fixed 后代包含块
→ tooltip 坐标错乱」的风险，没有任何收益。

所以 `glassComposerBlur` 在我们这里的真实消费者是**输入卡浓度**
（`glassComposerAlpha()`），不是模糊。字段名沿用参照插件的命名是为了
迁移时语义可对照，但含义在注释和设置页 hint 里都写清了。

`glass.test` 里有一条断言专门锁这个决定：
**输入卡规则里不许出现 backdrop-filter**。变异测试验证过 —— 往卡片上加
`backdrop-filter:blur(24px)` 会让两条断言变红。

### 氛围光配色（`glassAmbientAccent`）

与 `accent`（强调色）解耦：强调色管按钮/链接/状态高亮，氛围光管背景光斑。
`buildGradientBackdrop(surfaces, isDark, accentId)` 第三参为空时走原逻辑
（从表面色派生），非空时用 `AMBIENT_ACCENTS` 里的色板。

四个色系各给深/浅两套、每套三个色（对应三个光斑：左上/右下/中心）。
数值按 Mariana 的明度区间调 —— 太亮会盖过正文，太暗光斑就看不见。
只在 `glassBackground === 'gradient'` 时有意义，所以 UI 也只在那时渲染。

**它不改变玻璃令牌表**（`glass.test` 有断言）：氛围光只作用于背景层，
不会影响任何表面的颜色。

### 改实心：浮层与 diff（2026-10-23 第三轮）

前两轮都在调「浓度」，但这两处的问题**不在浓度，在层级**。

#### ① 历史消息 / 悬停预览浮层

宿主里这两类是 `position:fixed` 的普通 `<div>`：

    ._float_6nhg2_156{position:fixed;…;background:var(--dsw-alias-bg-layer-2);…}
    ._preview_38jqx_52{…;background:var(--dsw-alias-bg-layer-1);…}

它们**没有 role 属性**，所以玻璃表里那组
`[role="dialog"] / [role="menu"] / [role="listbox"] / [data-radix-popper-content-wrapper] > *`
**一条都压不到**。而它们浮在正文之上、背后是活文字，半透明 + 模糊挡不住
—— 用户看到的就是字压字。

修法：`glassSolidFloats` 打开后按局部名匹配（`_float_` / `_preview_`，
哈希每次构建都变、局部名稳定，与 markdown 那套同一个约定），
钉成不透明实色并撤掉 backdrop-filter（实色之后模糊已无意义，
留着只会白建一层合成层）。

#### ② diff 区域

宿主的增删行底色是变量，而且**本身就带 alpha**：

    ._add_17vb8_48{background:var(--dsw-alias-code-diff-added)}
    ._del_17vb8_38{background:var(--dsw-alias-code-diff-deleted)}
    --dsw-alias-code-diff-added: #99C7941F   /* 0x1F ≈ 12% */

玻璃模式下卡片本身也半透明，12% 的淡绿/淡红压在透明底上几乎不可辨。

修法：`glassSolidDiff` 只把这两个变量换成**不透明**的同色相实色
（绿=增、红=删），深浅两套各一组：

| 模式 | added | deleted |
|---|---|---|
| 深色 | `#1E3A2A` | `#3A2026` |
| 浅色 | `#DCF3E4` | `#FBE0E3` |

**⚠️ 只改变量，不写任何容器选择器。** 用户明确要求「只动 diff 区域，
不要动卡片本身」，所以这条规则里不许出现 `_card_` / `RlGAzG` /
`_markdown_`。`glass.test` 有断言锁这条（变异测试验证过：往规则里塞
一个 `[class*="_card_"]` 会立刻变红）。

两个开关都默认 `off` —— 玻璃是插件的主卖点，这些是「读不了才开」的补丁，
不是默认观感。

### 光晕浓度上限 70 → 100（2026-10-23 第八轮）

原上限 70% 是参照「旧实现 alpha 0.9 那种一坨」反向定的 —— 怕用户调出实心色块。
但实际观感上 0.7 仍偏淡，尤其：

- 表面浓度不为 0 时，光晕会被三列进一步稀释；
- 光源分散在 4–6 个时，单团的贡献本来就小。

现在放开到 **100%**（光源中心完全不透明），把「顶到头」的自由交给用户。
钳制点两处同步：`buildGround()` 里的 `Math.min(100, …)` 与设置页滑块的 `max`。

预览文件同步改成 `max="100"`。

`glass.test` 有三条断言锁：100% → alpha 1、150 被夹到 100、85% 正常生效。
变异验证过：上限退回 70 会让 3 条变红。

### 渐变模式不压暗（2026-10-23 第七轮）

**用户报：「光晕效果比预览差好多」。**

排查发现插件生成的 CSS 与预览**逐字符相同** —— 差异来自背景层上多叠的两层：

| 层 | 插件 | 预览 | 影响 |
|---|---|---|---|
| **veil 压暗** | 默认 `auto` → 盖 `rgba(52,61,70,0.31)` | 无 | **光晕被压掉三分之一**（主因） |
| 背景 filter | `blur(16px) saturate(120%)` | 无 | 光晕被糊开 |

veil 的设计目的是「亮照片下文字不发灰」——**对照片壁纸是对的**。
但渐变背景是我们自己生成的，本来就落在暗色区间，再压 31% 就是纯损失：
光晕是低对比的柔和色雾，压掉三分之一后几乎看不见。

修法：**只在「渐变 + auto」这一种组合下不压暗**。

```js
const veilMode = state.glassBackground === 'gradient' && state.glassVeil === 'auto'
  ? '0'                       // 渐变默认不压暗
  : state.glassVeil           // 壁纸 / 手动固定档照旧
```

三条边界：

- **只改 auto 档** —— 用户手动设了 20/35/50 说明他明确想要更暗，尊重原意；
- **壁纸模式完全不变** —— 那是 veil 真正该干活的地方；
- `glassVeilColor()` 本身的行为不变，只是调用方换了个参数。

`glass.test` 有断言锁这条（含变异验证：还原成旧行为会让 3 条断言变红）。

### 分割角度自由可调（2026-10-23 第十二轮）

**用户要求：「分割方向能不能让用户自己选择调整角度」。**

原来只有 4 个预设（165° / 135° / 90° / 0°），要 200° 这种中间值做不到。

#### 改动

| 层 | 之前 | 现在 |
|---|---|---|
| UI | `Segmented` 四选一 | `Slider` 0–360° |
| 字段 | `glassBandDir: '165'` | 同字段，值域放宽 |
| 校验 | `[0,90,135,165].includes(v) ? v : 165` | 取模归一 |
| `OPTIONS.glassBandDir` | 4 项枚举 | 删除（无消费者） |

#### 校验逻辑

```js
const rawDir = Number(c.dir)
const dir = Number.isFinite(rawDir)
  ? ((Math.round(rawDir) % 360) + 360) % 360   // 取模归一，负数也能处理
  : 165                                         // 非数字才回落默认
```

关键点：**超范围值取模而不是回退**。
旧逻辑下把滑块拖到 200° 会突然跳回 165°，用户看起来像「滑块坏了」；
现在 400° → 40°、-30° → 330°，行为连续可预期。

360° 归一为 0° —— 视觉上等价（CSS 里 360deg 和 0deg 一样），但归一后
滑块回到左端时显示一致。

#### 测试

12 个角度逐个验证（0/30/45/90/120/135/165/180/200/270/315/359），
外加 360 归一、400 取模、-30 归一、非数字回落。

变异验证：
- 还原成 4 预设白名单 → **13 条变红**
- 角度写死 165 → **19 条变红**

预览文件 `preview-ground.html` 同步改成滑块。

### 修复：壁纸本地路径输入框丢失（2026-10-23 第十一轮）

**用户报：「壁纸的本地路径填写怎么没了」。**

排查确认：`glassWallpaperPath` 字段还在、读取逻辑还在（`loadWallpaper` 第 3965 行
仍在用它拼缓存 key），但**设置页的 UI 没了** —— 用户根本填不了。

#### 怎么丢的

不是一次操作丢的，是**多轮字符串手术的累积损伤**：

1. 「高级」Fold 合并进「分层浓度」时，路径输入框跟着「高级」的内容一起搬走；
2. 「玻璃界面」重组时又搬了一次，这次连同「摆放方式」一起丢了；
3. 因为字段还在、`node --check` 也过（删 UI 不产生语法错），**测试没覆盖 UI 存在性**。

剩下只有「壁纸图片链接」，而它的 hint 里还写着「优先于**上面的本地路径**」——
上面根本没有那一行，用户看到的就是这句悬空的话。

#### 修复

补回两个 Row（`摆放方式` + `自选壁纸`），并清掉同区域的两段死注释
（「按区域独立档」「高级折叠」—— 都是已删功能的残留）。

#### 测试补强

新增 5 条断言，关键是**不只测标题存在，还测绑定关系**：

```js
check(/title: '自选壁纸'/.test(wpSeg), '壁纸段有「自选壁纸」')
check(/value: snapshot\.glassWallpaperPath/.test(wpSeg),
  '「自选壁纸」输入框绑定 glassWallpaperPath')     // ← 这条才是关键
check(/updateDraft\(\{ glassWallpaperPath/.test(wpSeg),
  '「自选壁纸」改动写进草稿')
```

变异验证：
- 删掉整块（复现原 bug）→ 4 条变红
- 把 `value` 绑到 `glassWallpaperUrl`（复制粘贴错字段）→ 2 条变红

#### 教训

**「删了 UI 不报错」是最危险的回归**：语法检查过、测试也过、字段还在，
只有用户点了才发现调不了。UI 存在性必须显式断言，且要断言到**绑定关系**层面。

这次还顺手做了字段覆盖交叉检查：`index.js` 60 个字段 vs 设置页引用的 59 个，
差集是 `proseBoost` / `glassFog` / `glassBaseTheme` —— 三个都是**有意无 UI** 的
（前两个已合并到别的滑块，第三个是「跟随图片明暗」的内部状态，本就不该暴露）。

### 颜色组二次整合（2026-10-23 第十轮）

用户要求把「代码与正文」和「过程行」两组的内容也并进颜色组 ——
这两组本来就是纯上色开关，独立成组只是历史包袱。

#### 合并前后

**之前**（7 个分组）：

```
## 主题        启用 ColorLab
## 代码与正文   代码高亮色板 / 正文高亮
## 过程行      启用过程行高亮 + 分类勾选网格
## 玻璃界面    …
## 手绘造型    开关
## 颜色        自定义强调色 / 三色 / 两个折叠块
## 配色方案    保存 / 列表
```

**之后**（5 个分组）：

```
## 主题        启用 ColorLab
## 玻璃界面    …
## 手绘造型    开关
## 颜色        代码高亮色板 / 正文高亮 / 启用过程行高亮
              自定义强调色 / 工具行 / 汇总行 / 文件卡片
              [F] 正文调色（9 槽位）
              [F] 完整调色板（18 槽）
## 配色方案    保存 / 列表
```

「颜色」组现在 9 项，涵盖：**语法色 → 正文层次 → 过程行 → 强调色 → 界面底色**，
从上到下正好是「从文字到界面」的顺序。

#### 实现细节

搬移时两个 GroupHead 也跟着进了颜色组内部 —— 会变成三个并列的组头。
去掉后改成普通注释（`/* ---- 语法色板 ---- */`），保持代码可读但不产生视觉分组。

搬移用**行号切片**而不是字符串查找：前几轮用 `indexOf` 定位反复失败
（同一个锚点在字段定义区和 UI 区各出现一次），行号虽然脆但可验证 ——
搬完立刻 `node --check` + 结构打印确认。

#### 测试

新增 11 条断言：

- 颜色组必须包含全部 9 项（7 个 Row + 2 个 Fold）
- 反向断言：「代码与正文」「过程行」组头必须**不存在**

变异验证：把 `代码高亮色板` 改名 → 2 条变红；把「过程行」组头加回来 → 3 条变红。

### 设置页深度重组（2026-10-23 第九轮）

用户三条要求：**删没意义的、颜色整合到一起、玻璃界面按壁纸模式分折叠**。

#### 一、删除的内容

| 删除项 | 理由 |
|---|---|
| **套用范围**（深色/浅色/都套用） | Mariana 本质是深色主题，浅色只是同色相提亮，三个选项实际差异很小 |
| **背景变体**（标准/深/暗） | 三档底色差别不明显，且与「表面浓度」的效果重叠 |
| **强调色预设**（青/橙/蓝三选一） | 被「自定义强调色」完全覆盖 —— 能选任意色，预设就没意义了 |
| **正文高亮亮度**（三档） | 只对深色生效、浅色不动，属于隐性行为，不值得占一行 |
| **正文高亮预览块** | 真实界面里就能看到效果，复刻一套增加维护成本 |
| **过程行预览块** | 同上；勾选后回对话即见 |
| **卡片预览块**（已编辑/交付文件） | 同上 |

字段本身全部保留（`schemeMode` / `surface` / `accent` / `proseBoost`）——
它们在内部逻辑里仍有真实消费（深浅色规则、配色变体、令牌派生）。
删 UI 不等于删字段：老 profile 的持久化契约不能破。

同时清掉了 `previewVars` 这个只为预览服务的变量（连带三处 CSS 类退役）。

#### 二、颜色整合

原来颜色设置散在三个地方：「主题」组的自定义强调色、「过程行」组的三色、「自定义配色」组的调色板。
现在统一到一个 **「颜色」** 分组：

```
## 颜色
   自定义强调色          取色器 + hex 输入 + 随机
   工具行颜色            过程行图标与标签
   汇总行颜色            聚合标题
   文件卡片颜色          已编辑/交付文件卡底色
   [F] 正文调色（9 槽位） 标题/加粗/斜体/代码/链接/列表/引用…
   [F] 完整调色板（18 槽） bg0-bg3 / fg / 边框 / 状态色
```

#### 三、玻璃界面重组（核心）

**之前**：19 个 Row 平铺，加一个「分层浓度」折叠块。滚动条要拉很久。

**现在**：只有 2 个常显项 + 2 个折叠块。

```
## 玻璃界面
   玻璃界面              ← 常显：总开关
   背景来源              ← 常显：桌面壁纸 / 渐变 / 等高线（三选一）
   [F] 通用设置           ← 15 项：表面浓度/模糊/浮层增量/代码块/悬停/
                            侧栏/信息面板/文件预览/浮层模糊/输入卡/
                            背景压暗/饱和度/白雾/浮层改实心/diff改实心
   [F] 当前壁纸专属        ← 只显示当前模式那一套
```

**「当前壁纸专属」的实现**：内部三段各自带 `snapshot.glassBackground` 守卫，
不匹配时返回 `null`（完全不占位，不是 `display:none`）：

```js
snapshot.glassBackground === 'wallpaper'
  ? h(Fold, { label: '裁剪与文字保护', … }, …)   // 图片链接/裁剪/文字保护/跟随明暗
  : null,
snapshot.glassBackground === 'gradient'
  ? h(Fold, { label: '地面', … }, …)              // 亮度/地面模式/光晕/分割
  : null,
snapshot.glassBackground === 'contour'
  ? h(Fold, { label: '等高线画质', … }, …)        // 速度/换地形/线条/密度/fps
  : null,
```

切到渐变时看不到壁纸裁剪，切到等高线时看不到光晕参数 —— 一眼只有当前能调的东西。

#### 测试陷阱（值得记）

第一版守卫断言写的是 `/snapshot.glassBackground === 'wallpaper'/.test(segment)` ——
**变异测试直接证伪**：把守卫改成 `true` 照样通过，因为字符串还在文件里。

改成测「守卫 → 三元 → 紧跟具体控件」这条链路：

```js
/snapshot\.glassBackground === 'wallpaper'\s*\n\s*\? h\(\s*\n\s*Row,.*title: '壁纸图片链接'/
```

改 `true` 后立刻变红。**「出现过」不等于「生效了」** —— 这是本项目第三次踩同一个坑。

### 设置页整理（2026-10-23 第六轮）

#### 删掉的死代码

前几轮迭代留下了两个**没有任何消费者**的控件：

| 字段 | 状态 | 处理 |
|---|---|---|
| `glassGlow` | 旧「地面光斑」开关。第五轮被 `glassGroundMode` 取代后，**只剩定义、零消费** | 删除字段 + index.js 镜像 |
| `glassAmbientAccent` | 氛围光配色（aurora/ocean/…）。第五轮后地面颜色由用户直接选（`glassLights`/`glassBands`），解析函数**再也没被调用** | 删除字段 + `OPTIONS` 枚举 + `glassAmbientAccent()` 函数 + `AMBIENT_ACCENTS` 色表 |

字段总数 62 → 60。这类「留着以防万一」的兼容字段是技术债：
它们会出现在设置页、出现在 profile YAML、出现在 Config schema 里，
但调了没有任何效果 —— 比没有更糟。

#### 重新分组

整理前的问题：**「过程行」组后面忘了收口，把整个玻璃界面都吞了进去**。
分组统计（Row 数）：

| 分组 | 整理前 | 整理后 |
|---|---|---|
| 过程行 | 4 | 4 |
| 玻璃界面 | 8 | 8 |
| **改实心** | **39 + 5 折叠** | 并入玻璃界面 |
| 分层与区域 | — | 8 + 2 折叠（新建） |
| 壁纸 | — | 10 + 1 折叠（新建） |
| 背景地面 | — | 8 + 1 折叠（新建） |
| 等高线 | — | 11 + 1 折叠（新建） |

新结构（11 个分组）：

```
主题          启用 / 套用范围 / 背景变体 / 强调色 / 自定义强调色
代码与正文     代码高亮 / 正文高亮 / 亮度 / [折叠] 正文调色
过程行        开关 / 工具行 / 汇总行 / 文件卡片
玻璃界面      开关 / 来源 / 表面浓度 / 浮层浓度 / 模糊 / [折叠] 分层浓度
              改实心（浮层 / diff）— 只有两项，不再单独成组
分层与区域     [折叠] 按区域独立档（侧栏/面板/预览/输入卡/浮层模糊）
              [折叠] 高级（压暗/饱和度/白雾）
壁纸          摆放方式 / 自选壁纸 / 壁纸图片链接 / [折叠] 裁剪与文字保护
背景地面      背景亮度 / [折叠] 地面模式·光晕·分割
等高线        速度 / [折叠] 等高线高级
手绘造型      开关
自定义配色     [折叠] 18 槽
配色方案      保存 / 列表
```

#### 顺序原则

1. **来源在参数之前** —— 壁纸组把「自选壁纸 / 图片链接」放在「摆放方式」前面：
   先决定用哪张图，再决定怎么摆；
2. **高频在前，低频进折叠** —— 玻璃的五个核心旋钮常显，分层/区域/壁纸细节收进折叠；
3. **同主题相邻** —— 裁剪和文字保护都属于「壁纸」，不再散落在「背景地面」组里。

### 背景地面重做：光晕 / 分割（2026-10-23 第五轮）

#### 旧实现为什么是一坨纯色

```js
radial-gradient(circle at 18% 12%, rgba(35,41,46,0.9) 0%, transparent 55%),
radial-gradient(circle at 82% 78%, rgba(42,50,59,0.9) 0%, transparent 58%),
radial-gradient(circle at 50% 50%, rgba(47,56,65,0.7) 0%, transparent 70%),
#343D46
```

三个致命问题：

1. **alpha 0.9** —— 几乎不透明，三团叠加等于三块实色圆盘；
2. **颜色全是灰蓝**（`#23292E` / `#2A323B` / `#2F3841`），亮度差只有 21/255，
   色相完全相同 —— 叠起来看不出层次；
3. **`circle` 全屏** —— 半径无界，糊满整个背景。

#### 新结构

`buildGround(surfaces, isDark, cfg)` 按 `cfg.mode` 分三条路径：

| 模式 | 生成的 CSS | 约束 |
|---|---|---|
| `glow` | 只有 `radial-gradient` × N | **不许**出现 `linear-gradient` |
| `bands` | 只有一条 `linear-gradient` | **不许**出现 `radial-gradient` |
| `blend` | 两者都有，分割在前 | — |

**这条「不许混层」是硬约束**，测试有正反断言。原因：预览第一版把
`bandLayer` 也拼进了 glow 分支，结果「光晕」看起来还是切割 —— 用户
一眼就看出来了。

#### 数据形状

光源与色带都存成 JSON 字符串（与 `presets` / `custom` 同一套做法）：

```js
glassLights: '[{"color":"#5FB3B3","strength":"100","x":"16","y":"10"}, …]'
glassBands:  '[{"color":"#4A555F"}, {"color":"#3D4650"}, …]'
```

`parseLightList()` / `parseBandList()` 负责规范化：坏 JSON / 空数组 →
出厂值；非法颜色 → `#5FB3B3`；数值钳制到各自区间；超过 6 条截断。
**绝不抛错** —— 用户手改 YAML 写坏了不该让背景直接消失。

#### 亮度联动仍然生效

`backdropGradient()` 把 `glassBrightness` 算成 `ambience`
（`1 − |b−50|/50`），再乘到 `glowA` 上。所以亮度拉到端点时，
光晕/分割会一起收成纯色 —— 一个滑块两个作用。

#### `buildGradientBackdrop` 降级为 deprecated

新代码走 `buildGround()`。旧函数保留为包装（内部调 `GLOW_DEFAULTS`），
让既有测试与调用点不必立刻全改。氛围光配色 `AMBIENT_ACCENTS` 表仍在，
但**不再是地面色的来源** —— 颜色现在由用户直接选。

### 背景亮度与地面光斑（2026-10-23，参照 dsh-catppuccin-theme）

#### 为什么需要「双向」亮度

原来只有 `glassVeil`（背景压暗），它**只能变暗**：

| 档位 | 效果 |
|---|---|
| auto | 跟随表面浓度（0.50 − 0.30·α） |
| 0 / 20 / 35 / 50 | 固定压暗百分比 |

浅色主题下「想让背景更亮一点」做不到 —— 而这是个真实需求
（用户觉得壁纸压得太灰、想让画面通透些）。

`glassBrightness`（0–100，50 = 中性）改成双向：

```
0 ──── 20 ──── 50 ──── 80 ──── 100
纯黑   压暗    原样    提亮    纯白
```

实现是 `mixTowards(hex, pct)`：`pct < 50` 朝黑混、`pct > 50` 朝白混，
比例 `|pct−50|/50`。50 时原样返回，所以**默认行为与升级前完全一致**。

#### 联动淡出：一个滑块两个作用

亮度离开中性越远，三团光斑越淡：

```js
const ambience = Math.max(0, 1 - Math.abs(pct - 50) / 50)
// 三个 radial-gradient 的 alpha 全部 × ambience
```

这是参照插件 `--dsh-glass-ambience: calc(1 - |b−50|/50)` 的等价实现
（它用纯 CSS calc，我们用 JS —— 因为我们的光斑色是运行时派生的，
本来就在 JS 里算）。

**为什么必须联动**：不联动的话，用户把亮度拉到 100 想要「纯白」，
但三团彩色光斑还压在上面，结果是一块发灰的彩色渐变 —— 承诺落空。
联动之后，端点就是真正的纯白 / 纯黑。

端点时光斑 alpha 归零，代码直接**不生成**那几条 radial-gradient
（而不是生成 `alpha: 0` 的无效层）。

#### 光斑开关

`glassGlow`（默认 `on` = 原行为）。关掉后：

```css
linear-gradient(165deg, <layer1@0.35·ambience> 0%, transparent 55%, <black@0.12·ambience> 100%), <base>
```

**必须保留 `<base>`** —— 只留渐变会让背景变透明，露出 Electron 窗口的
黑底（本项目在「先建层再开总闸」那条上也踩过同类问题）。
`glass.test` 有断言：「关掉后仍有实色底（不会露黑）」。

#### 一个踩到的细节

`mixTowards` 第一版输出**小写** hex（`#343d46`），而项目里其它色值都是大写。
这导致「默认值原样透出」的断言失效（`#343D46` vs `#343d46`）。
改成 `.toUpperCase()` 后一致。

这类问题很小，但**默认值必须逐字节原样透出**是向后兼容的前提 ——
否则「升级后行为不变」这个承诺就没法用断言守。

### 壁纸图片链接（2026-10-23）

背景来源新增第四种：填一个 http/https 图片地址。

#### 为什么必须由 Host 代拉

页面跑在 `dsh-app://` 协议下。外站图片直接 `<img src>` 有三个问题：

1. **CSP**：可能被页面策略拦掉；
2. **CORS**：即使显示出来，canvas 也会被判定污染 ——
   而我们要用 canvas 做**裁剪**（`renderWallpaperCrop`）和
   **亮度采样**（`measureGlassLuma`），这两处都会 `getImageData` 失败；
3. **无统一边界**：几十 MB 的图、不响应的服务器，页面侧没法管。

所以走 Host 路由 `/dsh-colorlab/wallpaper?url=…` 代拉，
页面拿到的永远是「一张已经校验过的图」。

#### 安全边界

| 约束 | 值 | 理由 |
|---|---|---|
| 协议 | 只 `http:` / `https:` | `file://` 能读任意本地文件；`data:` 绕过大小限制 |
| 大小 | 24 MiB | `content-length` 预检 + 实际字节兜底（有些服务器不给头） |
| 超时 | 8s | `AbortController`，服务器不响应时不能挂死 |
| 重定向 | follow，最终 URL 仍须 http(s) | 防 302 跳到 `file://` |
| 类型 | 魔数嗅探 | 防把 HTML 错误页当壁纸 |

`normalizeWallpaperUrl()` 是唯一的校验入口，`fetchWallpaperUrl()`
只接收它的输出。测试里有一条专门的「危险协议清单」：
`file://` / `data:` / `javascript:` / `ftp:` / `chrome://` / `//host` 全部拒绝。

#### 优先级与回落

```
URL（合法且拉取成功）
  ↓ 失败
本地路径 → 系统壁纸（TranscodedWallpaper → 注册表）
  ↓ 都失败
渐变
```

**URL 失败不直接 404** —— 继续走本地路径。这条有断言锁：
从 `if (wantedUrl !== '')` 到 `readWallpaper` 之间不许出现 `writeHead(404)`。

> 变异测试抓到过我的第一版断言：它只检查区间里有没有「拉取失败」这个**注释**，
> 把 404 塞进去照样绿。改成检查实际控制流才真正生效。

#### 缓存

Host 侧 60 秒 TTL（`wallpaperUrlCache`）：`applyNow` 会在拖任意滑块时
反复触发，不缓存就是每次都出网。

### 任意强调色（2026-10-23 第四轮，参照 dsh-dream-skin）

预设只有三色（teal / orange / blue），但「只影响业务态高亮」这个语义决定了
用户会想用自己的品牌色。`accentCustom`（`#RRGGBB`，空串 = 用预设）
通过 `resolveAccent()` 统一解析，**替换了全部 7 个 `ACCENTS[...]` 直读点**：

| 原直读点 | 现在 |
|---|---|
| `resolveTokens` | `resolveAccent(state)` |
| `resolveProseTokens` | `resolveAccent(state)` |
| `contourAccentHex` | `resolveAccent(state)` |
| 设置页预设色点（2 处） | `resolveAccent(preset/snapshot)` |

**为什么要派生四档而不是直接复用原色**：预设里深/浅两档是手调过的 ——
浅色主题要压暗才够对比（`#5FB3B3` → `#3E8E8E`），深色主题要够亮才看得见。
自定义色如果深浅共用同一个值，浅色主题下会比周围暗一档、看着脏。
派生规则：`light` = 各通道 × 0.78，`darkSoft`/`lightSoft` = 对应色 + alpha。

### 模糊填充（glassFit = 'blur'）

`cover` / `contain` / `stretch` / `tile` / `center` 之外新增第六档：
整图完整显示（contain），**留白处用同一张图放大模糊铺底**。

**必须两层独立元素**，这是硬约束：

- `filter` 是**元素级**属性，不是 background 层的属性；
- CSS `background` 简写没法「只糊第一层」；
- 所以不能糊壁纸层本身 —— 那会把上层清晰的 contain 图一起糊掉。

实现（`syncWallpaperBleed`）：出血层是独立 `<div>`，
`position:fixed; inset:-40px; z-index:-1; filter:blur(48px)`，
插在壁纸层**之前**（DOM 顺序即层叠顺序）。`inset:-40px` 是为了
抵消模糊在边缘产生的透明晕边。

`wallpaperFitStyle()` 返回 `bleed: boolean`，就是告诉调用方
「这一档需要那个出血层」。其他五档一律 `false`（测试有断言）。

### 侧栏独立浓度（glassSidebarOpacity）

`[class*="_sidebarCol"]` 原来直接用表面浓度 `alpha`。现在支持独立值
（`-1` = 跟随 `glassTint`）。

理由：侧栏和正文列是**两种视觉权重**。有人要侧栏实（导航一眼看清）、
正文列透（看壁纸）；也有人反过来（侧栏融进壁纸当装饰、正文列保住可读性）。
一个滑块管两列时这两种需求都满足不了。

⚠️ **只改侧栏，不能连带改正文列** —— 那是「独立」的全部意义。
测试里有一条专门断言：`glassSidebarOpacity=100` 时
`_centerCol` 的 alpha 必须仍是原值。

### 壁纸摆放与裁剪（2026-10-23）

`background-size` 原本写死 `cover`。现在 `glassFit` 五档，映射到
`background-size / position / repeat` 三件套（`wallpaperFitStyle()`）。
平铺用 `auto + repeat`：`cover` 会把 512px 纹理图在 4K 屏上放大 8 倍。

裁剪用 `glassCrop`（JSON 字符串，`{x,y,w,h}` 全为**比例**）。
规范化规则直接采用参照插件的语义（用户在两个玻璃插件间迁移时手感一致）：

- `w/h` 下限 `GLASS_CROP_MIN = 0.05`；
- 越界时**保持宽高、把左上角往回推**（`x = min(1-w, max(0, x))`），
  不把框压扁 —— 框被挡在边上停住，和桌面裁剪工具一致。

**必须真重画，不能用 CSS 位移模拟**：`background-position` 百分比只对
「填充」成立，平铺/居中会露出整张原图。所以 `renderWallpaperCrop()`
用 `drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)` 裁出新位图再
`toBlob('image/webp', 0.92)`。两个细节：

- **递增序号 `wallpaperCropSeq`**：异步裁剪期间用户可能又改了框，
  过期结果必须丢弃 —— 否则「刚拖回整图」会被上一次的结果覆盖；
- 每次重画前 `revokeObjectURL` 旧的，不泄漏。

裁剪渲染的触发点有三处，都收敛到 `applyWallpaperCrop()`：
壁纸加载完成、`syncGlassSheet` 里检测到 `status === 'ready'`、以及
`glassCrop` 变化时（`loadWallpaper` 会因为签名没变而早退，必须补这一次）。

### 文字保护：为什么只加光晕、不加底色（2026-10-23）

`glassGuard` 的规则体里**不许出现任何 `background`**，这是硬约束
（`glass.test` 有回归断言，变异测试验证过能抓到）。

理由：壁纸下最自然的诱惑是「把表面调实一点」，但那等于替用户改掉了他
调好的透明度 —— 有人就是要把表面压到 5%、模糊调到 0 来看壁纸。

两条规则：

1. `text-shadow` 光晕，方向与明暗同向。可继承属性 → 挂在 `body` 上就覆盖
   侧栏/顶栏/输入框/portal 浮层。1px 实 + 2px 柔 + 3px 更柔是「描边」不是
   「发光」，再大就让字发虚。
2. 次要文字 token 加深一档（`label-secondary` → bluish-750、
   `tertiary`/`caption` → bluish-700；深色反向 200/300/400）。
   **这步不能省**：光晕压在浅灰字上会让对比度更差（灰字 + 白晕），
   必须把字本身改深。只改明度、不动字号字重 → 不引起重排。

### 跟随图片明暗（2026-10-23）

文字颜色跟主题模式走，但壁纸明暗和模式无关 —— 浅色主题下换暗壁纸，
深色字压在暗图上，光晕和加深 token 都救不了「方向错了」。

`applyGlassAutoTone()` 测裁剪后区域的平均相对亮度（32×32 采样，
`0.2126/0.7152/0.0722` + sRGB 线性化），< 0.42 切 dark、> 0.58 切 light、
中间不切（来回切会晃眼）。

三条纪律：

1. 走官方 `themeService.setTheme()`，**不**改 `data-ds-dark-theme` ——
   改属性宿主内部调色板/组件状态不跟，且下次主题变更就被覆盖；
2. **只动内置 `light`/`dark`/`system`**（`BUILTIN_THEME_IDS` 白名单）。
   用户选了第三方主题 id 就一律不碰 —— `setTheme('dark')` 会把第三方顶掉；
3. 切换前把原偏好记进 `glassBaseTheme`（落盘），删图/关开关时还原。
   还原前检查「当前偏好是否仍是我们切的那个」，用户中途自己改过就
   只清基准、不覆盖。

测量是异步的（`measureGlassLuma` 返回 Promise），所以用签名守卫
（`glassToneSig`）丢弃过期结果 —— 与裁剪的序号守卫同一类问题。


## 等高线背景（移植自 dsh-theme-endfield，MIT）

管线：mulberry32 种子 → 3 长波底纹 + 22 正负高斯岛（有界散布 + smoothstep
收口）→ 5 遍可分离平滑 → EMA 连续化 → marching squares（鞍点双线性判定
+ 16 列块界跳跃）→ 边 id 缝合 → 去屑三阈值 + deneedle 发须坍缩 →
Chaikin + 约束 Catmull-Rom → **一笔总描、环先画**（逐条 stroke 会让交叉
处二次合成变黑）。上游注释与实测常数原样保留。

### 为什么必须有 worker，以及为什么还留了主线程路径

上游的出厂画质（6px 网格）是配着 worker/WebGL 后端跑的；初版移植判断
"主线程 canvas 够用"，实测 1920×1080 单帧 extract+draw = 45ms —— 卡。
搬进 worker（引擎函数用 `String(fn)` 序列化进 Blob-URL，无构建步骤的
插件唯一防漂移的做法）+ OffscreenCanvas 后，主线程动画期间只发消息。

**宿主 CSP 是 `script-src 'nonce-…'`，blob: worker 可能被拦** —— 拦截时
静默回落主线程路径，所以：主线程预算收到 **8ms**（用户的手按 60Hz 读
输入，>16.7ms 的任务就吞一帧滚轮事件；旧值 20.8ms 是按我们自己的 24fps
算的，尺度错了），降级重建推迟到**空闲回调**（32 轮验证器绝不在 rAF 回调里
同步跑），并且**实际后端显示在设置页副标题**（"独立线程渲染 / 主线程
渲染"）——不再让用户对着"应该已经不卡了"的代码猜。

### 第二轮性能手术（2026-10-23，"开着等高线就一直卡"）

第一轮把 FPS 压到 8、DPR 封顶 1、平滑从 3 遍砍到 2 遍，方向对但**只降了
频率，没降单帧量**，而且三道安全阀在真实用法里全都没生效。实测（真实
Chromium，1920×1080，`getImageData` 强制 flush 才量得到光栅）：

| 项 | 修前 | 修后 |
|---|---|---|
| 起步 step | 6（58,101 格） | 10（21,037 格） |
| 每帧贝塞尔段数 | 60,483 | 17,913 |
| extract | 15.0 ms | 6.8 ms |
| draw（JS） | 8.4 ms | 2.6 ms |
| **光栅化** | **11.3 ms** | **7.3 ms** |
| 单帧合计 | **34.7 ms** | **16.7 ms** |
| `build()` | 66.8 ms | 34.3 ms |

五处改动：

1. **`CONTOUR_MAX_CELLS` 60000 → 24000。** 旧上限**在 1080p 上从没生效过**
   —— 1920×1080 @ step 6 正好 58,101 格，卡在上限之下，于是最常见的分辨率
   永远拿到最贵的那一档。这是"成本封顶"这条设计名存实亡的根因。
2. **Chaikin 遍数改成按「是否动画」分开**：动画态 1 遍（顶点 ×2）、静止态
   2 遍（×4）。实测"2 遍"相对"不密集化"是 3.3 倍光栅成本，而 8fps 慢漂下
   根本看不清圆角；静止档只画一帧，把画质给回去。
3. **降级自律修好了三处**：
   · `contourOnScroll` 恢复时**不再清零** `contourOverBudget`。降档要求连续
     3 帧超预算，而"边读边滚"的用户每隔几百毫秒就滚一次 —— 每次清零等于
     **永远凑不满 3 帧、永远停在最贵档**，恰恰是最需要降级的用法把档位锁死；
   · `contourScheduleBuild` **不再把 `contourStepNow` 归零**，阶梯终点改成
     `max(出厂地板, 学到的档位)`。旧行为让降级成果活不过任何一次 resize，
     而且阶梯最后一级恰好落在最贵档（1080p 是 …→ 8 → 7 → 6）；
   · worker 路径 resize 时同样带上学到的档位，不再 `step: 0` 重测。
4. **重建改到 `requestIdleCallback`。** 旧的 `setTimeout(fn, 0)` 只是把长任务
   挪到下一个立即执行的宏任务，注释写的"推迟到空闲"从来没成立过。
   另把验证器改为**降级档只跑 10 轮**（出厂档仍 32 轮）：实测 1080p/step 12
   的 32 轮就是 56ms 同步长任务，而那一档存在的意义本来就是省成本。
5. **候选 scratch 跨 attempt 复用。** 旧实现每轮 `buildCandidate` 都新建一整份
   field（1080p ≈ 3.5MB typed array），32 轮最坏 ≈ 112MB 瞬时垃圾 → 实测
   `build()` 在粗网格上反而飙到 84ms（不是算出来的，是 GC 出来的）。
   代价：`best` 不能再持有候选引用（scratch 只有一个），改成只记 salt、循环
   结束后重放一次。测试里加了「同引擎重复 build 逐字节相同」+「两引擎不串味」
   两条锁。

**顺带修掉的第四处（这一条最容易被忽略）**：壁纸层的 `filter` 早就为等高线
关掉了，但 `buildGlassSheet` 里**另外两处 `backdrop-filter` 没关** ——
`_frame::before`（顶部 40px 全宽，16px 高斯）和 `[role=dialog]/[role=menu]/`
`[role=listbox]`（`blur+10`，默认 26px）。壁纸模式下这两处背后的底图是
**静止的**，Chromium 能缓存模糊结果；等高线模式下背后是每 125ms 换像素的
全窗 canvas → **模糊被强制重算 8 次/秒**，而视觉收益为零。而**设置页本身就是
`role="dialog"`** —— 用户正是在那个面板里把背景切成等高线的，卡顿最直观的
时刻就在这里。

### 用户可调项（2026-10-23，「等高线高级」折叠块）

原来只有「漂移速度」一个旋钮，其余全是写死常量。现在 8 个观感/画质档位
全部暴露，收在设置页的折叠块里（只在背景来源 = 等高线时出现），摘要行
显示「浓度 · 画质 · 帧率」三件套。

| 设置项 | 字段 | 范围 | 默认 | 作用 |
|---|---|---|---|---|
| 换一张地形 | （按钮） | — | — | 重掷种子 + 重建，不必刷新页面 |
| 线条浓度 | `contourInk` | 0–100% | 55 | 描边不透明度（原来写死 55%/70%） |
| 线条颜色 | `contourColor` | `#RRGGBB` / 空 | 空 | 空 = 跟随强调色；非空 = 独立取色 |
| 线条粗细 | `contourWidth` | 1 / 1.5 / 2 px | 1 | 原来写死 `lineWidth = 1` |
| 地形密度 | `contourDensity` | 细/中/粗 | 中 | 格数上限 40000 / 24000 / 14000 |
| 等高线密集程度 | `contourLevels` | 12–30 层 | 20 | 按 20 为基准等比缩放层数 |
| 动画帧率 | `contourFps` | 4 / 8 / 15 fps | 8 | 原来写死 `CONTOUR_FPS = 8` |
| 地形起伏 | `contourRelief` | 40–160% | 100 | 高斯岛振幅倍率 |
| 漂移幅度 | `contourDrift` | 0–200% | 100 | 岛的呼吸位移倍率 |

**关键实现约束（踩过）**：`createContourEngine` 与 `contourStepFor` /
`contourLevelsFor` 会被 `String(fn)` 序列化进 worker，**引擎内部绝不能读
`state`** —— 否则 worker 里 `ReferenceError`，整条 worker 路径静默降级。
所以用户档位统一由 `setLook()` 从主线程推进去（worker 走消息里的 `look`
字段），档位→常数的换算留在主线程的 `contourLookNow()`。第一版就是把
`contourLineWidth()` 直接写进 `drawTo`，测试立刻抓到了。

真实 Chromium 渲染验证（数非透明像素 / 贝塞尔段数）：

| 档位 | 墨迹像素 | 贝塞尔段数 | step |
|---|---|---|---|
| 密度 细 / 中 / 粗（1080p） | 120716 / 119483 / 118150 | 22569 / 17913 / 13692 | 8 / 10 / 13 |
| 层数 12 / 30 | 72822 / 157903 | 10896 / 23609 | — |
| 起伏 40% / 160% | 51566 / 144011 | 7865 / 21647 | — |
| 粗细 1px / 2px | 122099 / 207204 | — | — |
| 浓度 10% / 90% | 80981 / 122781 | — | — |

另外修掉一个真 bug：**漂移幅度拉到 0 时地形仍然在变** —— 岛停了，但底纹
正弦的相位 `phase * 0.11` 没吃 `drift`，所以地形依然漂移。现在两项都乘
`drift`，0 = 真正完全静止。

### 高程标注（2026-10-23，可选、默认关）

真等高线地图会在线上打断一小段、写上该线的高程值。这里做了简化版：
每条等高线取一处标注点，沿切线方向写字，先用底色铺一小块把线打断再写。

**为什么默认关、且只在静止档生效** —— 实测（1080p / 21 电平 / 86 条路径，
真实 Chromium）：

| | draw (JS) | 光栅化 | fillText 次数 |
|---|---|---|---|
| 关标注 | 2.8 ms | 5.8 ms | 0 |
| 开标注（按路径标） | 6.5 ms | 6.3 ms | **76** |
| 开标注（按电平去重后） | **3.7 ms** | 6.0 ms | **21** |

`fillText` 是重操作（字体查找 + 字形光栅）。两处优化把增量从 +141% 压到
+32%：**每个电平只标一次**（同一电平的不同曲线不重复标，76→21 次）；
标注点在路径上按 50%→42%→58%→… 试探，避开画布边缘（否则长线的中点
常常贴在边角被裁掉）。

即便如此，动画档每帧都重画的话这 21 次 fillText 会持续消耗光栅线程，
所以 `contourLabelsOn()` 里加了硬条件：**速度档 > 0 时一律不画标注**。
静止档只画一帧，标注是纯赚；动画档回退到纯线条，零额外成本。

场值本身是无量纲的（-1.45 ~ +1.45），标注时线性映射到 100–900 的整数，
借它的相对大小做出"海拔"的观感 —— 不是真实高程数据。

### 滚动让路

任何滚动（捕获+passive，一个 document 监听覆盖全部容器）期间动画**完全
停止**（不是降频），停稳 140ms 后恢复。相位只按名义步进
推进、绝不按挂钟补帧：机器忙 = 慢放，不是跳变。
恢复时**不清零成本对账**（见上一节第 3 条）。

## 手绘造型（可选，默认关）

抄 dsh-maid-whale-UI 的机制不抄美术：四角不等圆角（差 ≤4px）、纸影
（硬 1px 垫影 + 软散影，**只在玻璃关时生效**）、悬停/聚焦微抬 -1px、
侧栏右缘渐变发光线（替掉宿主 border-right）。全部只点名已知表面，
不做全树扫描；独立总闸 `html[data-dsh-shape]`，每条规则自带前缀。

## 校验

### 离线校验（不需要重启，共 14 个套件）

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
| `host.test.mjs` | `webserver/index-inject` 注入内容、开关生效、Config schema 与 volatile 标记、**探测失败落诊断文件** |
| `glass.test.mjs` | 玻璃表生成：三列透明、差值收敛到档位、颜色预补偿、veil 合成进背景层、**括号逐行平衡**（事故回归锁）、backdrop-filter 正/负清单、seat 硬裁接线、压暗联动 |
| `shape.test.mjs` | 手绘造型：总闸逐条前缀、四角互不相同且差 ≤4px、纸影的玻璃让位条件、分界线三件套、卸载零残留 |
| `contour.test.mjs` | 等高线：同种子逐字节确定性、8×5 覆盖率零空格、无碎屑、环精确闭合、视口自适应单调、一笔总描、**worker source 假 self 回放**（init/frame/recolor/rebuild/error）、成本降级与启动阶梯接线 |

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
- [ ] 设置 → ColorLab：一切正常时**没有**诊断行；把「套用范围」切到仅深色再用浅色外观，才出现对应提示
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
- [ ] **LaTeX 对标 Sublime（整份语法移植，逐字符核对）**：
      - [ ] `\` 反斜杠**独立成青**，命令名蓝（`\begin`/`\label` 紫）
      - [ ] `{}` **全部**青，包括 `\zh{` 这种自定义宏（以前这里会白掉）
      - [ ] `$` 青、数学内置命令（`\hbar` `\nu` `\oint`）紫、自定义宏（`\cH` `\dd`）蓝斜
      - [ ] 数字橙、`=` `+` `-` 橙红、标识符白斜体、注释灰
      - [ ] 行号、横向滚动、复制按钮仍正常（渲染层是兄弟节点，宿主的 DOM 一个没动）
