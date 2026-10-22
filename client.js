/**
 * dsh-colorlab — 客户端半体（浏览器侧）。
 *
 * 形状对齐官方模板 `cordis-plugin-development/templates/decoration/client.js`：
 * 工厂返回 `{ inject, apply }`。注册 id 必须等于包名。
 *
 * ---- 它改的是什么（逐条从安装态 app.asar 读出，不是猜的）----
 *
 * 1. `@deepseek-ai/dsh-client-ui-theme` 的 `design-platform.css` 在
 *    `body` / `body[data-ds-dark-theme]` 上声明了全部 `--dsw-alias-*` 设计令牌
 *    （各 101 个）以及 `--dsw-specific-*`、`--dsw-menu-surface-fill`。
 *    这是**唯一的颜色权威**，所有组件都只消费 `var(--dsw-alias-*)`。
 *
 * 2. 同一包的 `ThemeRuntime` 提供了官方扩展点：
 *        ctx.theme.overrideTokens(source, { [token]: { light, dark } })
 *    叠加层按注册顺序叠在活动主题之上，返回 disposer 可完整回退；
 *    `ThemePresenter`（ui-layout）随后把 `snapshot.active.tokens` 逐条
 *    `body.style.setProperty` —— 是 **inline 样式**，压过任何样式表。
 *
 * 3. Appearance 设置行的三个方块是**硬编码** light/dark/system，`setTheme(id)`
 *    只对内置 id 落盘，所以 `register()` 注册新主题 id 既没有 UI 入口也不能持久化。
 *    ⇒ 本插件**不注册主题 id**，走 overrideTokens 叠加层 + 自己的设置页与开关。
 *
 * 4. 终端 xterm 的 bg/fg/cursor/selection 由 `getComputedStyle` 从令牌解析得出，
 *    换 `--dsw-alias-bg-base` / `label-primary` 即换终端底色。
 *
 * 5. 代码块用 Shiki 的 **CSS 变量主题**（`variablePrefix: "--shiki-"`），
 *    覆盖 `--shiki-*` 即换语法高亮色板。
 *
 * ---- 稳定性取舍 ----
 * 两条通道：① `overrideTokens`（官方扩展点，首选）；② 注入 `<style>` 直接改令牌
 * （`ctx.theme` 缺失或版本无该方法时的回退）。两条互斥，成功一条即禁用另一条。
 * 持久化失败（例如非 loopback 页面的内存模式）不会让主题失效，只记进设置页状态行。
 */

window.__ModuleLoader__.load({
  id: 'dsh-colorlab',
  factory(require) {
    const React = (typeof window !== 'undefined' && window.React) || require('react')
    const h = React.createElement
    const Fragment = React.Fragment

    /* ====================================================================== *
     * 一、色板：Sublime Text 的 Mariana 原值
     * ====================================================================== */

    /**
     * Mariana 基础色板。前 6 个是底色/文字阶梯，后 7 个是语法色。
     * 数值取自 Sublime Text 4 的 `Mariana.sublime-color-scheme`（HSL 换算成 hex）
     * 与 Sublime Text 3 的 `Mariana.tmTheme`，两者在这些值上一致。
     *
     * 两个例外是**为了让 WCAG 达标而提亮过的**，不是原值：
     *   `faintUi` = #7B8790（原 faint #65737E 在 #343D46 上只有 2.26:1）
     *   `linkUi`  = #80AAD5（原 blue #6699CC 在 #343D46 上只有 3.68:1）
     * 它们只用于 UI 文字与链接；代码高亮仍用 Mariana 原色（语法色只需 3:1，原值全部达标）。
     * 保留原值不动是刻意的 —— 改了就"不像 Mariana"了。
     */
    const PALETTE_BASE = Object.freeze({
      /* 底色阶梯 */
      bg0: '#343D46', // 编辑器背景（冷灰蓝）
      bg1: '#23292E', // 侧栏 / 状态栏
      bg2: '#1D1E22', // 面板 / tooltip
      /* 文字阶梯 */
      fg: '#D8DEE9', // 正文（带蓝调的米白）
      dim: '#A7ADBA', // 次级文字 / 注释
      faint: '#65737E', // 三级文字（仅用于非文字场合，如滚动条）
      faintUi: '#7B8790', // 三级文字的实际取值（提亮至 3:1）
      /* 语法色 */
      green: '#99C794', // 字符串
      teal: '#5FB3B3', // 函数名 / 标点
      blue: '#6699CC', // 函数调用 / 链接
      blueUi: '#80AAD5', // 链接的实际取值（提亮至 4.5:1）
      purple: '#C594C5', // 关键字
      red: '#EC5F67', // 内置常量 / 标签 / 错误
      orange: '#F9AE58', // 数字 / 光标
      yellow: '#FAC863', // 查找高亮 / 常量
    })

    /** 未经自定义覆盖的原始色板（设置页预览、重置、测试都用它）。 */
    const PALETTE = PALETTE_BASE

    /**
     * 背景变体。`standard` 是 Mariana 原值；`deep` 用 ST3 早期 tmTheme 的
     * `#252B32` 一档（社区抱怨"太灰"时的常用改法）；`dim` 取中间值。
     */
    const SURFACES = Object.freeze({
      standard: Object.freeze({
        base: '#343D46',
        layer1: '#2F3841',
        layer2: '#2A323B',
        layer3: '#252C34',
        overlay: '#23292E',
        sidebar: '#23292E',
        code: '#2E363F',
        bubble: '#3B454F',
        bubbleHi: '#46525E',
        hover: '#3B454F',
        selector: '#3B454F',
      }),
      deep: Object.freeze({
        base: '#252B32',
        layer1: '#20262C',
        layer2: '#1C2228',
        layer3: '#181D22',
        overlay: '#161A1F',
        sidebar: '#161A1F',
        code: '#1F252B',
        bubble: '#2A3138',
        bubbleHi: '#333B43',
        hover: '#2A3138',
        selector: '#2A3138',
      }),
      dim: Object.freeze({
        base: '#2B333C',
        layer1: '#26303A',
        layer2: '#222B34',
        layer3: '#1E262E',
        overlay: '#1B2229',
        sidebar: '#1B2229',
        code: '#252D36',
        bubble: '#313A44',
        bubbleHi: '#3A444F',
        hover: '#313A44',
        selector: '#313A44',
      }),
    })

    /**
     * 强调色三档。只影响 `state-business-*` 与 `brand-primary-new-color*`；
     * 不动 `brand-primary`（那是 DSH 的"主按钮反色"，必须保持中性才能保证对比度）。
     */
    const ACCENTS = Object.freeze({
      teal: Object.freeze({ dark: '#5FB3B3', darkSoft: '#5FB3B355', light: '#3E8E8E', lightSoft: '#3E8E8E33' }),
      orange: Object.freeze({ dark: '#F9AE58', darkSoft: '#F9AE5855', light: '#C97A2B', lightSoft: '#C97A2B33' }),
      blue: Object.freeze({ dark: '#6699CC', darkSoft: '#6699CC55', light: '#4A7FB5', lightSoft: '#4A7FB533' }),
    })

    /** 浅色变体（`schemeMode: "both"` 时生效）。Mariana 本身没有浅色版，这是同色相提亮。 */
    const LIGHT = Object.freeze({
      base: '#F5F7FA',
      layer1: '#FFFFFF',
      layer2: '#F0F3F7',
      layer3: '#E8EDF3',
      overlay: '#FFFFFF',
      sidebar: '#EEF1F5',
      code: '#F0F3F7',
      bubble: '#E4EDF7',
      bubbleHi: '#D6E2F0',
      hover: '#E8EDF3',
      selector: '#E8EDF3',
      fg: '#2B333C',
      dim: '#4F5B66',
      faint: '#65737E',
      caption: '#848F9F', // 提亮前的 #8792A2 在 #F5F7FA 上只有 2.94:1
      link: '#4374A5', // 提亮前的 #4A7FB5 只有 3.92:1
    })

    /** 默认设置（与 Host 半体 index.js 的 FIELD_DEFAULTS 保持一致）。 */
    const DEFAULTS = Object.freeze({
      enabled: 'on',
      schemeMode: 'dark',
      surface: 'standard',
      accent: 'teal',
      syntax: 'on',
      /* 正文高亮：给 Markdown 对话正文加颜色层次（标题/加粗/斜体/行内代码/列表/引用）。 */
      prose: 'on',
      /* 正文高亮亮度档位："off"（Mariana 原值）| "soft"（提亮一档）| "strong"（再亮一档）。 */
      proseBoost: 'soft',
      /* 正文高亮颜色：JSON，`{"heading":"#5FB3B3",...}`；空 = 跟随色板派生。 */
      proseColors: '',
      /* 自定义配色：JSON 字符串，扁平 `{ "surface.base": "#hex", "palette.fg": "#hex" }`。 */
      custom: '',
      /* 配色方案：JSON 字符串，数组 `[{ name, at, surface, accent, custom }]`。 */
      presets: '',
      /* 过程行高亮开关。 */
      rowHighlight: 'on',
      /* 工具行高亮色（图标 + 标签文字）。默认亮绿，在 #343D46 上 7.19:1。 */
      rowColor: '#7EE787',
      /* 汇总行 / 本轮汇总高亮色。默认亮黄（Mariana 的查找高亮色），在 #343D46 上 7.10:1。 */
      summaryColor: '#FAC863',
      /* 文件卡片头部横带颜色；空串 = 跟随卡片底色（宿主默认中性灰）。 */
      cardColor: '',
      /* 要高亮哪些过程行：JSON 数组，值是 ROW_VARIANTS 里的 variant。 */
      rowVariants: '["write","edit","bash","summary","turn"]',
      /* "on" | "off" —— 玻璃界面总开关。 */
      glass: 'on',
      /* "wallpaper" | "gradient" —— 玻璃背后的背景来源。 */
      glassBackground: 'wallpaper',
      /* 三列底色浓度 0–100。 */
      glassTint: '65',
      /* 浮层雾面浓度 0–40。 */
      glassFog: '16',
      /* 模糊半径 0–40 px。 */
      glassBlur: '16',
      /* 白雾浓度 0–100。*/
      glassHaze: '8',
      /* 自选壁纸路径；空串 = 跟随系统桌面壁纸。 */
      glassWallpaperPath: '',
      /* 背景压暗："auto"（跟随表面浓度的公式）| "0"（关）| "20" | "35" | "50"
       *（手动百分比）。压暗层决定壁纸被压多暗 → 亮壁纸下文字是否可读。 */
      glassVeil: 'auto',
      /* 背景饱和度 0–200%：壁纸/渐变底图的 saturate（等高线模式不饱和 ——
       * 线色由强调色直接决定，saturate 会把它改歪）。Win11 亚克力同款旋钮。 */
      glassSat: '120',
      /* 等高线漂移速度："0" 静止 | "1" | "2" | "4"（上游 CONTOUR_SPEED_OPTIONS）。 */
      contourSpeed: '2',
      /* "on" | "off" —— 手绘造型（不规则圆角 + 纸影 + 悬停微抬 + 分界线）。
         灵感与数值来自 dsh-maid-whale-UI 的纸面主题（只抄机制不抄美术），
         与玻璃界面独立，默认关。 */
      shape: 'off',
    })

    /* ====================================================================== *
     * 一·六、过程行高亮（写入 / 编辑 / 运行命令 …）
     *
     * 宿主的每一行过程条目（ToolRow）根元素带三个稳定属性：
     *     data-variant="write"  data-tool="write_file"  data-state="ok"
     * `data-variant` 是宿主 `classifyTool()` 的分类结果，值与中文标签的对应
     * 来自 ui-conversation 的 locale（`tool.title.write` = 写入 等）。
     *
     * 为什么选 data-variant 而不是类名：类名是 CSS Modules 哈希
     * （`pFy1Ka_title`），前缀 `pFy1Ka` 每次构建都变。data-variant 是宿主
     * 自己写进 DOM 的语义属性，跨构建稳定。
     *
     * ⚠ 两个坑（扫整个 asar 查出来的，不是猜的）：
     *   1. `data-variant` 不是工具行独有：ui-chat 的"思考"行是 `think`，
     *      命令卡是 `others`；ui-attachment 的图片用 `thumbnail` 等值。
     *   2. `others`（工具调用）与命令卡**共用同一个值**，所以勾选它
     *      会连带给命令卡上色 —— 界面上必须说明，不能假装没这回事。
     * ====================================================================== */

    /**
     * 可选的过程行分类。`shared: true` 表示该值与其它组件共用。
     *
     * 三类钩子（都是从安装态 app.asar 的 ui-chat / ui-tool bundle 里读出来的）：
     *
     *   1. 工具行 `data-variant="…"` —— 单条工具调用（GenericToolCard 的 ToolRow）。
     *      上色目标是行内的图标容器 `_leading` 与标题 `_title`，摘要不动。
     *   2. 汇总行 `button[data-process-activity]` —— 一组过程的聚合标题，
     *      也就是「执行了命令」「修改了文件」「正在分析请求」这些行
     *      （ProcessGroupHeader）。整行是一个 button，图标 `color:inherit`，
     *      所以给 button 设色即可带着图标一起变。
     *   3. 本轮汇总 `button[data-turn-process]` —— 「已完成，用时 xx」
     *      （TurnProcessNodeView）。同理整行设色。
     *
     * 后两类的钩子在整个 asar 里**只出现一次**（已扫描确认），不会误伤别的组件。
     */
    const ROW_VARIANTS = Object.freeze([
      Object.freeze({ variant: 'summary', kind: 'summary', label: '汇总行（执行了命令 / 修改了文件 / 正在分析请求）', previewLabel: '执行了命令，已写入文件，修改了文件', shared: false }),
      Object.freeze({ variant: 'turn', kind: 'turn', label: '本轮汇总（已完成，用时 xx）', previewLabel: '已完成，用时 1 分 20 秒', shared: false }),
      Object.freeze({ variant: 'write', kind: 'tool', label: '写入', shared: false }),
      Object.freeze({ variant: 'edit', kind: 'tool', label: '编辑', shared: false }),
      Object.freeze({ variant: 'bash', kind: 'tool', label: '运行命令', shared: false }),
      Object.freeze({ variant: 'read', kind: 'tool', label: '读取', shared: false }),
      Object.freeze({ variant: 'search', kind: 'tool', label: '搜索', shared: false }),
      Object.freeze({ variant: 'code', kind: 'tool', label: '代码', shared: false }),
      Object.freeze({ variant: 'think', kind: 'tool', label: '思考', shared: true, sharedHint: '来自 ui-chat，不是工具行' }),
      Object.freeze({ variant: 'others', kind: 'tool', label: '工具调用 / 命令', shared: true, sharedHint: '与命令卡共用同一个值，勾选会连带给命令卡上色' }),
    ])

    const ROW_VARIANT_VALUES = new Set(ROW_VARIANTS.map((entry) => entry.variant))

    /** 查一个 variant 属于哪一类（tool / summary / turn）。未知按 tool 处理。 */
    function variantKind(variant) {
      for (const entry of ROW_VARIANTS) {
        if (entry.variant === variant) return entry.kind
      }
      return 'tool'
    }

    /**
     * 解析要高亮的过程行分类列表。
     * 非法输入（坏 JSON、未知值、非数组）一律退化成空列表，绝不抛错。
     * @param {unknown} raw - `state.rowVariants`（JSON 数组字符串）。
     * @returns {string[]} 合法的 variant 列表。
     */
    function parseRowVariants(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return []
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        return []
      }
      if (!Array.isArray(data)) return []
      const seen = new Set()
      for (const item of data) {
        if (typeof item === 'string' && ROW_VARIANT_VALUES.has(item)) seen.add(item)
      }
      return [...seen]
    }

    /**
     * 生成过程行高亮样式表。
     *
     * 三类目标、两种颜色（所以规则分段输出）：
     *
     *   工具行（绿）—— 上色的不是行本身，而是行内的图标容器 `_leading` 与标题
     *     `_title`。摘要（文件路径、`2KB +48 -0`）不带这两个类，所以不变色 ——
     *     这正是"剩下的不变"。规则锚在 `[data-disclosure-header]` 上，因为宿主的
     *     展开内容在 header 之外（兄弟节点），不锚就会渗进去。
     *
     *   汇总行（黄）——「执行了命令 / 修改了文件 / 正在分析请求」，宿主组件是
     *     ProcessGroupHeader，整行一个 `button[data-process-activity]`，
     *     图标 `color:inherit`，所以直接给 button 设色即可带着图标一起变。
     *
     *   本轮汇总（黄）——「已完成，用时 xx」，宿主组件是 TurnProcessNodeView，
     *     整行一个 `button[data-turn-process]`。
     *
     * 特异性的坑（必须连 :hover 一起写）：宿主对后两类都写了 hover 提亮规则，
     * 特异性比我们的基础规则高，不覆盖的话鼠标一移上去就掉回宿主原色。
     *   ProcessGroupHeader  .WW4l1q_title:hover                   = (0,2,0)
     *     我方              button[data-process-activity]:hover   = (0,2,1)  ✓
     *   TurnProcessNodeView ._4AI11G_root:hover:not(:disabled)    = (0,3,0)
     *     我方              button[data-turn-process]:hover:not(:disabled) = (0,3,1) ✓
     *
     * @param {object} state - 当前设置。
     * @returns {string} CSS 文本（没有选中任何分类时为空串）。
     */
    function buildRowSheet(state) {
      const picked = parseRowVariants(state && state.rowVariants)
      if (picked.length === 0) return ''
      const s = state || {}
      /* state 可能整体缺省（测试/首次挂载），所以每个字段都单独兜底。 */
      const toolColor = typeof s.rowColor === 'string' && HEX_PATTERN.test(s.rowColor) ? s.rowColor : DEFAULTS.rowColor
      const sumColor = typeof s.summaryColor === 'string' && HEX_PATTERN.test(s.summaryColor) ? s.summaryColor : DEFAULTS.summaryColor

      const blocks = []

      /* ---- 工具行（绿）---- */
      const toolVariants = picked.filter((variant) => variantKind(variant) === 'tool')
      if (toolVariants.length > 0) {
        const selectors = []
        for (const variant of toolVariants) {
          selectors.push(`[data-variant="${variant}"] [data-disclosure-header] [class*="_leading"]`)
          selectors.push(`[data-variant="${variant}"] [data-disclosure-header] [class*="_title"]`)
        }
        blocks.push(selectors.join(',\n') + `{\ncolor:var(--dmt-row-color, ${toolColor})\n}`)
      }

      /* ---- 汇总行（黄）---- */
      if (picked.includes('summary')) {
        blocks.push(
          'button[data-process-activity],\n'
          + 'button[data-process-activity]:hover{\n'
          + `color:var(--dmt-summary-color, ${sumColor})\n}`,
        )
      }

      /* ---- 本轮汇总（黄）---- */
      if (picked.includes('turn')) {
        blocks.push(
          'button[data-turn-process],\n'
          + 'button[data-turn-process]:hover:not(:disabled){\n'
          + `color:var(--dmt-summary-color, ${sumColor})\n}`,
        )
      }

      return blocks.join('\n\n')
    }

    /* ====================================================================== *
     * 一·五、自定义配色
     *
     * 用户可调的"槽位"。每个槽位是一个绝对颜色，覆盖 PALETTE / SURFACES 里对应的
     * 基础值；下游几十个设计令牌都从这两个对象派生，所以改一处会自动传导到
     * 侧栏、卡片、按钮、代码块、终端、语法高亮、正文高亮。
     *
     * 为什么用扁平 path（`surface.base`）而不是嵌套对象：
     * 存进 profile 的是 JSON 字符串，扁平结构更好校验、更好和旧版本兼容
     * （多一个未知键直接忽略，不会破坏已有配置）。
     *
     * **自定义只作用于深色外观**。浅色那套是"同色相提亮"的派生值，
     * 若把深色下挑的颜色直接搬到浅色底上，很容易变成看不见的字。
     * 所以浅色外观保持插件自带的浅色值，不受自定义影响。
     * ====================================================================== */

    const CUSTOM_SLOTS = Object.freeze([
      Object.freeze({ group: '界面底色', path: 'surface.base', label: '主背景' }),
      Object.freeze({ group: '界面底色', path: 'surface.layer1', label: '面板一层' }),
      Object.freeze({ group: '界面底色', path: 'surface.layer2', label: '面板二层' }),
      Object.freeze({ group: '界面底色', path: 'surface.layer3', label: '面板三层' }),
      Object.freeze({ group: '界面底色', path: 'surface.overlay', label: '浮层 / 菜单' }),
      Object.freeze({ group: '界面底色', path: 'surface.sidebar', label: '侧栏' }),
      Object.freeze({ group: '界面底色', path: 'surface.code', label: '代码块' }),
      Object.freeze({ group: '界面底色', path: 'surface.bubble', label: '气泡 / 输入框' }),
      Object.freeze({ group: '文字', path: 'palette.fg', label: '正文' }),
      Object.freeze({ group: '文字', path: 'palette.dim', label: '次级文字' }),
      Object.freeze({ group: '文字', path: 'palette.faintUi', label: '三级文字' }),
      Object.freeze({ group: '语法色', path: 'palette.green', label: '字符串' }),
      Object.freeze({ group: '语法色', path: 'palette.teal', label: '函数 / 标点' }),
      Object.freeze({ group: '语法色', path: 'palette.blueUi', label: '链接 / 调用' }),
      Object.freeze({ group: '语法色', path: 'palette.purple', label: '关键字' }),
      Object.freeze({ group: '语法色', path: 'palette.red', label: '错误 / 常量' }),
      Object.freeze({ group: '语法色', path: 'palette.orange', label: '数字 / 光标' }),
      Object.freeze({ group: '语法色', path: 'palette.yellow', label: '查找高亮' }),
    ])

    /** 合法槽位路径集合（用于校验，防止 profile 里手写的未知键混进来）。 */
    const CUSTOM_PATHS = new Set(CUSTOM_SLOTS.map((slot) => slot.path))

    /** 一个合法 CSS 十六进制颜色的正则。 */
    const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

    /** 配色方案上限：profile 里存的是 YAML 字符串，不设上限会越滚越大。 */
    const MAX_PRESETS = 12
    /** 方案名长度上限。 */
    const MAX_PRESET_NAME = 40

    /**
     * 解析自定义配色字符串。
     *
     * 防御式：来自 profile 的 YAML 可以被手改，任何非法输入都退化成"没有覆盖"，
     * 绝不抛错、绝不把坏值写进 CSS。
     *
     * @param {unknown} raw - `state.custom`（JSON 字符串）。
     * @returns {{palette: Record<string,string>, surface: Record<string,string>}}
     */
    function parseCustom(raw) {
      const out = { palette: {}, surface: {} }
      if (typeof raw !== 'string' || raw.trim() === '') return out
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        return out
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) return out
      for (const [path, value] of Object.entries(data)) {
        if (!CUSTOM_PATHS.has(path)) continue
        if (typeof value !== 'string' || !HEX_PATTERN.test(value)) continue
        const [group, key] = path.split('.')
        out[group][key] = value
      }
      return out
    }

    /**
     * 把槽位覆盖应用到一个基础对象上，得到"有效值"。
     * @param {object} base - PALETTE 或某个 SURFACE 变体。
     * @param {Record<string,string>} overrides - 该组的覆盖表。
     * @returns {object} 新对象（不改 base）。
     */
    function withOverrides(base, overrides) {
      const keys = Object.keys(overrides)
      if (keys.length === 0) return base
      return { ...base, ...overrides }
    }

    /**
     * 解析配色方案列表。
     * @param {unknown} raw - `state.presets`（JSON 字符串）。
     * @returns {Array<{name: string, at: number, surface: string, accent: string, custom: object}>}
     */
    function parsePresets(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return []
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        return []
      }
      if (!Array.isArray(data)) return []
      const out = []
      for (const entry of data) {
        if (entry === null || typeof entry !== 'object') continue
        if (typeof entry.name !== 'string' || entry.name.trim() === '') continue
        out.push({
          name: entry.name.slice(0, MAX_PRESET_NAME),
          at: typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0,
          surface: typeof entry.surface === 'string' ? entry.surface : 'standard',
          accent: typeof entry.accent === 'string' ? entry.accent : 'teal',
          custom: entry.custom !== null && typeof entry.custom === 'object' && !Array.isArray(entry.custom) ? entry.custom : {},
        })
        if (out.length >= MAX_PRESETS) break
      }
      return out
    }

    /**
     * 把 `{ palette, surface }` 两组覆盖序列化成存盘用的扁平 JSON 字符串。
     * 空覆盖返回空串（profile 里不写多余的 `{}`）。
     * @param {{palette: Record<string,string>, surface: Record<string,string>}} grouped - 分组覆盖表。
     * @returns {string} JSON 字符串；无覆盖时为空串。
     */
    function serializeCustom(grouped) {
      const flat = {}
      for (const group of ['palette', 'surface']) {
        const table = grouped && grouped[group]
        if (!table) continue
        for (const [key, value] of Object.entries(table)) {
          if (typeof value === 'string' && HEX_PATTERN.test(value)) flat[group + '.' + key] = value
        }
      }
      return Object.keys(flat).length === 0 ? '' : JSON.stringify(flat)
    }

    /**
     * 把任意来源的覆盖表规整成 `{ palette, surface }` 两组。
     * 接受扁平 path 形式（存盘格式）或已分组形式（方案对象里的 custom 也是扁平的，
     * 但这里对两种都容错）。
     * @param {unknown} raw - 扁平或分组覆盖表。
     * @returns {{palette: Record<string,string>, surface: Record<string,string>}}
     */
    function normalizeCustom(raw) {
      const out = { palette: {}, surface: {} }
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
      for (const [path, value] of Object.entries(raw)) {
        /* 先处理"分组对象"形式：`{ surface: { base: '#...' }, palette: {...} }`。 */
        if (path === 'palette' || path === 'surface') {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
          for (const [key, inner] of Object.entries(value)) {
            if (typeof inner === 'string' && HEX_PATTERN.test(inner)) out[path][key] = inner
          }
          continue
        }
        /* 再处理扁平 path 形式：`{ 'surface.base': '#...' }`。 */
        if (typeof value !== 'string' || !HEX_PATTERN.test(value)) continue
        const [group, key] = path.split('.')
        if (group !== 'palette' && group !== 'surface') continue
        if (!key) continue
        out[group][key] = value
      }
      return out
    }

    /**
     * 计算两个 hex 颜色的 WCAG 对比度，供设置页实时提示。
     * 只支持纯 hex（自定义配色本来就是 hex）。
     * @param {string} a - 前景色。
     * @param {string} b - 背景色。
     * @returns {number} 对比度；任一值非法时返回 0。
     */
    function contrastRatio(a, b) {
      const parse = (hex) => {
        if (typeof hex !== 'string' || !HEX_PATTERN.test(hex)) return null
        let h = hex.slice(1)
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
        return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
      }
      const rgbA = parse(a)
      const rgbB = parse(b)
      if (rgbA === null || rgbB === null) return 0
      const lum = (rgb) => {
        const channel = (value) => {
          const v = value / 255
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
      }
      const la = lum(rgbA)
      const lb = lum(rgbB)
      const hi = Math.max(la, lb)
      const lo = Math.min(la, lb)
      return (hi + 0.05) / (lo + 0.05)
    }

    /** 首屏画布色（Host 半体注入同一值，用于消除首屏闪黑）。 */
    const BOOT_BACKGROUND = '#343D46'

    /** 设置页的取值元数据（顺序即渲染顺序）。 */
    const OPTIONS = Object.freeze({
      schemeMode: Object.freeze([
        Object.freeze({ value: 'dark', label: '仅深色外观', hint: '只在界面切到深色时套用 Mariana' }),
        Object.freeze({ value: 'both', label: '深浅都套用', hint: '浅色外观也换成同色相的浅色版' }),
      ]),
      surface: Object.freeze([
        Object.freeze({ value: 'standard', label: '标准', swatch: '#343D46', hint: 'Sublime Text 原值' }),
        Object.freeze({ value: 'deep', label: '深', swatch: '#252B32', hint: '更暗，社区常用改法' }),
        Object.freeze({ value: 'dim', label: '中间', swatch: '#2B333C', hint: '两者之间' }),
      ]),
      accent: Object.freeze([
        Object.freeze({ value: 'teal', label: '青', swatch: '#5FB3B3', hint: 'Mariana 的函数色' }),
        Object.freeze({ value: 'orange', label: '橙', swatch: '#F9AE58', hint: 'Mariana 的光标色' }),
        Object.freeze({ value: 'blue', label: '蓝', swatch: '#6699CC', hint: 'Mariana 的调用色' }),
      ]),
      /* 正文高亮亮度：三档，标签与提示取自 PROSE_BOOSTS。 */
      proseBoost: Object.freeze([
        Object.freeze({ value: 'off', label: '原值', hint: 'Mariana 原版语法色' }),
        Object.freeze({ value: 'soft', label: '提亮', hint: '默认；标题 5.39:1、加粗 6.63:1、删除线 4.14:1' }),
        Object.freeze({ value: 'strong', label: '更亮', hint: '最亮一档；删除线也达 4.91:1' }),
      ]),
      /* 玻璃界面的背景来源。 */
      glassBackground: Object.freeze([
        Object.freeze({ value: 'wallpaper', label: '桌面壁纸', hint: '读取 Windows 当前壁纸铺进页面；换壁纸后自动跟着变' }),
        Object.freeze({ value: 'gradient', label: '渐变', hint: '用当前配色生成柔和光斑；壁纸读不到时也自动用这个' }),
        Object.freeze({ value: 'contour', label: '等高线', hint: '程序生成的地形等高线（移植自 dsh-theme-endfield，MIT）：强调色细线、缓慢漂移，跟配色走' }),
      ]),
      /* 背景压暗：自动档跟随表面浓度；手动档固定强度。 */
      glassVeil: Object.freeze([
        Object.freeze({ value: 'auto', label: '自动', hint: '浓度越高压得越轻（公式 0.50−0.30·α）—— 多数情况不用管' }),
        Object.freeze({ value: '0', label: '关', hint: '不压暗：壁纸多亮背景就多亮，亮壁纸下文字可能发灰' }),
        Object.freeze({ value: '20', label: '轻', hint: '固定 20% 压暗' }),
        Object.freeze({ value: '35', label: '中', hint: '固定 35% 压暗' }),
        Object.freeze({ value: '50', label: '强', hint: '固定 50%：亮壁纸也压得住' }),
      ]),
      /* 等高线漂移速度（上游验证过的档位）。 */
      contourSpeed: Object.freeze([
        Object.freeze({ value: '0', label: '静止', hint: '只画不动 —— 地形不变，零 CPU' }),
        Object.freeze({ value: '1', label: '慢', hint: '1x 漂移' }),
        Object.freeze({ value: '2', label: '标准', hint: '2x（默认）' }),
        Object.freeze({ value: '4', label: '快', hint: '4x —— 岛呼吸明显，读代码时会分心' }),
      ]),
    })

    /* ====================================================================== *
     * 二、令牌映射（纯函数，无 DOM 依赖 —— scripts/verify.mjs 直接调它）
     * ====================================================================== */

    /**
     * 把一份设置解析成 `overrideTokens` 需要的 `{ [token]: { light, dark } }`。
     *
     * 纯函数：不读 DOM、不读全局状态，同样的入参永远同样的出参。
     * 每个 token 的 light/dark 两值**总是**齐备 —— `overrideTokens` 对此有运行时
     * 校验（传裸字符串会抛"a single value goes illegible when the user switches
     * color scheme"），而浅色值缺失正是切换色系瞬间露馅的经典原因。
     *
     * @param {object} state - `{ enabled, schemeMode, surface, accent, syntax, prose, custom }`
     * @returns {Record<string, {light: string, dark: string}>}
     */
    function resolveTokens(state) {
      const custom = parseCustom(state && state.custom)
      /* 自定义配色只覆盖深色那一套；浅色保持插件自带的派生值（见 CUSTOM_SLOTS 注释）。 */
      const PALETTE = withOverrides(PALETTE_BASE, custom.palette)
      const s = withOverrides(SURFACES[state && state.surface] || SURFACES.standard, custom.surface)
      const a = ACCENTS[state && state.accent] || ACCENTS.teal
      const syntax = !state || state.syntax !== 'off'

      /* ---- 深色值 ---- */
      const dark = {
        /* 底色 */
        '--dsw-alias-bg-base': s.base,
        '--dsw-alias-bg-document-preview': s.layer1,
        '--dsw-alias-bg-document-selection': 'color-mix(in srgb, #6699CC 40%, transparent)',
        '--dsw-alias-label-document-preview': PALETTE.dim,
        '--dsw-alias-bg-layer-1': s.layer1,
        '--dsw-alias-bg-layer-2': s.layer2,
        '--dsw-alias-bg-layer-3': s.layer3,
        '--dsw-alias-bg-module-platform': '#38424C',
        '--dsw-alias-bg-multi-select': '#38424C',
        '--dsw-alias-bg-overlay': s.overlay,
        '--dsw-alias-bg-skeleton': '#D8DEE914',
        /* 遮罩：纯黑半透明与色相无关，保持宿主值 */
        '--dsw-alias-bg-mask-1': '#00000080',
        '--dsw-alias-bg-mask-2': '#0003',
        '--dsw-alias-bg-mask-3': '#0000007a',
        '--dsw-alias-bg-mask-photo': '#000000e0',
        '--dsw-alias-bg-mask-drop': '#272730b3',
        /* 边框 */
        '--dsw-alias-border-inverted': '#0000',
        '--dsw-alias-border-inverted2': '#0000',
        '--dsw-alias-border-l1': '#D8DEE90F',
        '--dsw-alias-border-l2-darkmode-thin': '#D8DEE90F',
        '--dsw-alias-border-l2': '#D8DEE91F',
        '--dsw-alias-border-l3': '#D8DEE929',
        '--dsw-alias-border-l4': '#D8DEE933',
        /* 品牌（DSH 的"反色"语义，必须保持中性） */
        '--dsw-alias-brand-primary': PALETTE.fg,
        '--dsw-alias-brand-primary-invert': PALETTE.fg,
        '--dsw-alias-brand-text': PALETTE.fg,
        '--dsw-alias-brand-primary-new-colorprimary-new-color': a.dark,
        /* 文字 */
        '--dsw-alias-label-primary': PALETTE.fg,
        '--dsw-alias-label-primary-dimmed': '#C3CBD8',
        '--dsw-alias-label-primary-bluish': '#C9D6E6',
        '--dsw-alias-label-primary-foreground': '#1B2229',
        '--dsw-alias-label-primary-inverted': '#2B333C',
        '--dsw-alias-label-secondary': PALETTE.dim,
        '--dsw-alias-label-tertiary': '#8792A2',
        '--dsw-alias-label-caption': PALETTE.faintUi,
        '--dsw-alias-label-dimmed': '#B4BCC8',
        '--dsw-alias-label-shimmer': 'color-mix(in srgb, #FFFFFF 45%, transparent)',
        '--dsw-alias-label-deep-diving': PALETTE.teal,
        '--dsw-alias-label-deep-diving-shimmer': '#92D6D6',
        '--dsw-alias-menu-icon': '#C3CBD8',
        '--dsw-alias-link': PALETTE.blueUi,
        /* 交互层 */
        '--dsw-alias-interactive-bg-hover': '#D8DEE914',
        '--dsw-alias-interactive-bg-hover-solid': s.hover,
        '--dsw-alias-interactive-bg-hover-accent': '#D8DEE929',
        '--dsw-alias-interactive-bg-hover-danger': '#EC5F6726',
        '--dsw-alias-interactive-bg-active': '#D8DEE91F',
        /* 按钮 */
        '--dsw-alias-button-contrast-fill': PALETTE.fg,
        '--dsw-alias-button-elevated-fill': s.bubble,
        '--dsw-alias-button-floating-fill': s.code,
        '--dsw-alias-button-floating-hover': '#38424C',
        '--dsw-alias-button-ghost-active-border': '#5A6773',
        '--dsw-alias-button-ghost-active-fill': s.bubble,
        '--dsw-alias-button-ghost-active-hover': s.bubbleHi,
        '--dsw-alias-button-info-fill': PALETTE.blue,
        '--dsw-alias-button-info-hover': '#7FA9D6',
        '--dsw-alias-button-primary-dimmed': '#38424C',
        '--dsw-alias-button-primary-fill': PALETTE.fg,
        '--dsw-alias-button-primary-hover': '#E6EBF2',
        /* 工具栏按钮：宿主自带灰罩，与色相无关，保持 */
        '--dsw-alias-button-tool-bar-fill': '#54555780',
        '--dsw-alias-button-tool-bar-fill-invisible': '#1f1f1f5c',
        '--dsw-alias-button-tool-bar-hover': '#54555799',
        /* Markdown / 代码 */
        '--dsw-alias-markdown-citation': s.layer1,
        '--dsw-alias-markdown-code-block': s.code,
        '--dsw-alias-markdown-code-block-banner': s.layer3,
        '--dsw-alias-markdown-code-segment-selected': s.bubble,
        '--dsw-alias-markdown-code-segment-unselected': s.code,
        '--dsw-alias-markdown-inline-code': s.bubble,
        '--dsw-alias-markdown-placeholder': s.layer2,
        '--dsw-alias-markdown-tag': s.bubble,
        /* 滚动条 */
        '--dsw-alias-scrollbar-bg-l1': '#4F5B66',
        '--dsw-alias-scrollbar-bg-l2': '#5A6773',
        '--dsw-alias-scrollbar-hover-l1': PALETTE.faint,
        '--dsw-alias-scrollbar-hover-l2': '#72808C',
        /* 状态色 */
        '--dsw-alias-state-business-primary': a.dark,
        '--dsw-alias-state-business-tertiary': a.darkSoft,
        '--dsw-alias-state-error-primary': PALETTE.red,
        '--dsw-alias-state-error-secondary': '#F27C82',
        '--dsw-alias-state-idle-primary': PALETTE.faint,
        '--dsw-alias-state-success-primary': PALETTE.green,
        '--dsw-alias-state-success-secondary': '#A9D4A4',
        '--dsw-alias-state-success-tertiary': '#26382A',
        '--dsw-alias-state-warn-primary': PALETTE.orange,
        '--dsw-alias-state-warn-secondary': PALETTE.yellow,
        '--dsw-alias-state-warn-tertiary': '#3A2E22',
        '--dsw-alias-state-warn-label': '#FAB763',
        /* diff */
        '--dsw-alias-code-diff-added': '#99C7941F',
        '--dsw-alias-code-diff-deleted': '#EC5F671F',
        '--dsw-alias-file-diff-added-bg': '#263A2B',
        '--dsw-alias-file-diff-added-gutter': '#1F2F23',
        '--dsw-alias-file-diff-added-marker': PALETTE.green,
        '--dsw-alias-file-diff-deleted-bg': '#3A2427',
        '--dsw-alias-file-diff-deleted-gutter': '#2C1B1E',
        '--dsw-alias-file-diff-deleted-marker': PALETTE.red,
        /* 浮层 */
        '--dsw-alias-switch-thumb': PALETTE.dim,
        '--dsw-alias-toast-bg': PALETTE.bg1,
        '--dsw-alias-toast-label': '#E6EBF2',
        '--dsw-alias-tooltip-bg': PALETTE.bg2,
        '--dsw-alias-tooltip-key-bg': 'color-mix(in srgb, #1D1E22, white 18%)',
        '--dsw-alias-turn-trigger-bg': s.code,
        '--dsw-alias-turn-trigger-bg-hover': '#38424C',
        '--dsw-alias-menu-group-header-fill': '#23292EF0',
        /* 菜单材质（README 明确这是共享令牌，值必须接近不透明，否则菜单文字发糊） */
        '--dsw-menu-surface-fill': '#23292EB8',
        '--dsw-specific-menu': '#23292EB8',
        /* 侧栏与气泡 */
        '--dsw-specific-sidebar-fill': s.sidebar,
        '--dsw-specific-sidebar-nav-item-active': s.bubble,
        '--dsw-specific-sidebar-nav-item-active-accent': '#5FB3B355',
        '--dsw-specific-sidebar-nav-item-hover': s.layer1,
        '--dsw-specific-bubble': s.bubble,
        '--dsw-specific-bubble-highlight': s.bubbleHi,
        '--dsw-specific-input-major': s.code,
        '--dsw-specific-login-input': s.layer3,
        '--dsw-specific-selector': s.selector,
        '--dsw-specific-tip': s.layer1,
        /* 宿主笔误补丁：终端状态栏 CSS 写的是 var(--dsw-alias-bg-l2)，
           真名是 --dsw-alias-bg-layer-2；补一个同名别名把那条规则救回来。 */
        '--dsw-alias-bg-l2': s.layer2,
      }

      /* ---- 浅色值 ---- */
      const light = {
        '--dsw-alias-bg-base': LIGHT.base,
        '--dsw-alias-bg-document-preview': LIGHT.layer1,
        '--dsw-alias-bg-document-selection': 'color-mix(in srgb, #4A7FB5 40%, transparent)',
        '--dsw-alias-label-document-preview': LIGHT.dim,
        '--dsw-alias-bg-layer-1': LIGHT.layer1,
        '--dsw-alias-bg-layer-2': LIGHT.layer2,
        '--dsw-alias-bg-layer-3': LIGHT.layer3,
        '--dsw-alias-bg-module-platform': LIGHT.layer3,
        '--dsw-alias-bg-multi-select': LIGHT.layer3,
        '--dsw-alias-bg-overlay': LIGHT.overlay,
        '--dsw-alias-bg-skeleton': '#0000000a',
        '--dsw-alias-bg-mask-1': '#0000003d',
        '--dsw-alias-bg-mask-2': '#0000001f',
        '--dsw-alias-bg-mask-3': '#0000007a',
        '--dsw-alias-bg-mask-photo': '#000000e0',
        '--dsw-alias-bg-mask-drop': '#ffffffb3',
        '--dsw-alias-border-inverted': '#0000',
        '--dsw-alias-border-inverted2': '#0000',
        '--dsw-alias-border-l1': '#0000000a',
        '--dsw-alias-border-l2-darkmode-thin': '#0000001a',
        '--dsw-alias-border-l2': '#0000001a',
        '--dsw-alias-border-l3': '#0000001f',
        '--dsw-alias-border-l4': '#00000029',
        '--dsw-alias-brand-primary': LIGHT.fg,
        '--dsw-alias-brand-primary-invert': LIGHT.fg,
        '--dsw-alias-brand-text': LIGHT.fg,
        '--dsw-alias-brand-primary-new-colorprimary-new-color': a.light,
        '--dsw-alias-label-primary': LIGHT.fg,
        '--dsw-alias-label-primary-dimmed': '#3B454F',
        '--dsw-alias-label-primary-bluish': LIGHT.fg,
        '--dsw-alias-label-primary-foreground': '#FFFFFF',
        '--dsw-alias-label-primary-inverted': '#FFFFFF',
        '--dsw-alias-label-secondary': LIGHT.dim,
        '--dsw-alias-label-tertiary': LIGHT.faint,
        '--dsw-alias-label-caption': LIGHT.caption,
        '--dsw-alias-label-dimmed': '#C7CFDA',
        '--dsw-alias-label-shimmer': 'color-mix(in srgb, #000000 30%, transparent)',
        '--dsw-alias-label-deep-diving': a.light,
        '--dsw-alias-label-deep-diving-shimmer': a.light,
        '--dsw-alias-menu-icon': '#3B454F',
        '--dsw-alias-link': LIGHT.link,
        '--dsw-alias-interactive-bg-hover': '#2631480f',
        '--dsw-alias-interactive-bg-hover-solid': LIGHT.layer2,
        '--dsw-alias-interactive-bg-hover-accent': '#26314824',
        '--dsw-alias-interactive-bg-hover-danger': '#ec13130d',
        '--dsw-alias-interactive-bg-active': '#2631481a',
        '--dsw-alias-button-contrast-fill': LIGHT.fg,
        '--dsw-alias-button-elevated-fill': '#FFFFFF',
        '--dsw-alias-button-floating-fill': '#FFFFFF',
        '--dsw-alias-button-floating-hover': LIGHT.layer2,
        '--dsw-alias-button-ghost-active-border': PALETTE.dim,
        '--dsw-alias-button-ghost-active-fill': LIGHT.layer3,
        '--dsw-alias-button-ghost-active-hover': '#DDE4EC',
        '--dsw-alias-button-info-fill': '#4A7FB5',
        '--dsw-alias-button-info-hover': '#3E6E9E',
        '--dsw-alias-button-primary-dimmed': LIGHT.layer3,
        '--dsw-alias-button-primary-fill': LIGHT.fg,
        '--dsw-alias-button-primary-hover': '#1B2229',
        '--dsw-alias-button-tool-bar-fill': '#54555780',
        '--dsw-alias-button-tool-bar-fill-invisible': '#1f1f1f5c',
        '--dsw-alias-button-tool-bar-hover': '#54555799',
        '--dsw-alias-markdown-citation': LIGHT.layer2,
        '--dsw-alias-markdown-code-block': LIGHT.code,
        '--dsw-alias-markdown-code-block-banner': LIGHT.layer3,
        '--dsw-alias-markdown-code-segment-selected': '#FFFFFF',
        '--dsw-alias-markdown-code-segment-unselected': LIGHT.layer3,
        '--dsw-alias-markdown-inline-code': LIGHT.code,
        '--dsw-alias-markdown-placeholder': LIGHT.layer3,
        '--dsw-alias-markdown-tag': LIGHT.layer3,
        '--dsw-alias-scrollbar-bg-l1': '#CFD3D6',
        '--dsw-alias-scrollbar-bg-l2': '#C0C5CE',
        '--dsw-alias-scrollbar-hover-l1': PALETTE.dim,
        '--dsw-alias-scrollbar-hover-l2': '#979DA6',
        '--dsw-alias-state-business-primary': a.light,
        '--dsw-alias-state-business-tertiary': a.lightSoft,
        '--dsw-alias-state-error-primary': '#C4464F',
        '--dsw-alias-state-error-secondary': '#D4686F',
        '--dsw-alias-state-idle-primary': '#CFD3D6',
        '--dsw-alias-state-success-primary': '#4E8A4A',
        '--dsw-alias-state-success-secondary': '#5E9C58',
        '--dsw-alias-state-success-tertiary': '#E6FAED',
        '--dsw-alias-state-warn-primary': '#C97A2B',
        '--dsw-alias-state-warn-secondary': '#E08C34',
        '--dsw-alias-state-warn-tertiary': '#FEF5E7',
        '--dsw-alias-state-warn-label': '#B36A1E',
        '--dsw-alias-code-diff-added': '#22c55e14',
        '--dsw-alias-code-diff-deleted': '#f25a5a14',
        '--dsw-alias-file-diff-added-bg': '#E6F4E7',
        '--dsw-alias-file-diff-added-gutter': '#EDF7ED',
        '--dsw-alias-file-diff-added-marker': '#01A241',
        '--dsw-alias-file-diff-deleted-bg': '#FCE6E2',
        '--dsw-alias-file-diff-deleted-gutter': '#FDECE9',
        '--dsw-alias-file-diff-deleted-marker': '#BA2723',
        '--dsw-alias-switch-thumb': '#FFFFFF',
        '--dsw-alias-toast-bg': '#38424C',
        '--dsw-alias-toast-label': '#FFFFFF',
        '--dsw-alias-tooltip-bg': '#38424C',
        '--dsw-alias-tooltip-key-bg': 'color-mix(in srgb, #38424C, white 18%)',
        '--dsw-alias-turn-trigger-bg': LIGHT.code,
        '--dsw-alias-turn-trigger-bg-hover': LIGHT.layer3,
        '--dsw-alias-menu-group-header-fill': '#F8F9FAF0',
        '--dsw-menu-surface-fill': '#F8F9FAF0',
        '--dsw-specific-menu': '#F8F9FAF0',
        '--dsw-specific-sidebar-fill': LIGHT.sidebar,
        '--dsw-specific-sidebar-nav-item-active': LIGHT.layer3,
        '--dsw-specific-sidebar-nav-item-active-accent': a.lightSoft,
        '--dsw-specific-sidebar-nav-item-hover': LIGHT.layer2,
        '--dsw-specific-bubble': LIGHT.bubble,
        '--dsw-specific-bubble-highlight': LIGHT.bubbleHi,
        '--dsw-specific-input-major': LIGHT.code,
        '--dsw-specific-login-input': LIGHT.layer3,
        '--dsw-specific-selector': LIGHT.selector,
        '--dsw-specific-tip': LIGHT.layer2,
        '--dsw-alias-bg-l2': LIGHT.layer2,
      }

      /* ---- 静态色阶（前端 CSS 有 9 处直接引用，用于文件类型图标/内联动作）---- */
      const staticTokens = {
        '--dsw-static-deepseek-500': { dark: PALETTE.teal, light: a.light },
        '--dsw-static-deepseek-450': { dark: '#7FC7C7', light: '#5A9E9E' },
        '--dsw-static-deepseek-400': { dark: '#7FC7C7', light: '#5A9E9E' },
        '--dsw-static-green-500': { dark: PALETTE.green, light: '#4E8A4A' },
        '--dsw-static-amber-400': { dark: PALETTE.yellow, light: '#E08C34' },
        '--dsw-static-amber-500': { dark: PALETTE.orange, light: '#C97A2B' },
        '--dsw-static-red-600': { dark: PALETTE.red, light: '#C4464F' },
        '--dsw-static-neutral-bluish-00': { dark: '#F7F9FB', light: '#FFFFFF' },
        '--dsw-static-neutral-bluish-300': { dark: PALETTE.dim, light: '#A7ADBA' },
      }

      /* ---- Shiki 语法色（css-variables 主题，前缀 --shiki-）---- */
      const shikiTokens = syntax
        ? {
            '--shiki-foreground': { dark: PALETTE.fg, light: LIGHT.fg },
            '--shiki-background': { dark: s.code, light: LIGHT.code },
            '--shiki-token-constant': { dark: PALETTE.orange, light: '#C97A2B' },
            '--shiki-token-string': { dark: PALETTE.green, light: '#4E8A4A' },
            '--shiki-token-comment': { dark: '#8792A2', light: '#6B7686' },
            '--shiki-token-keyword': { dark: PALETTE.purple, light: '#8A5E8A' },
            '--shiki-token-parameter': { dark: PALETTE.orange, light: '#C97A2B' },
            /* function 令牌 = Mariana 的 var(blue) #6699CC。
               Sublime Mariana 里 `support.function, support.macro` → var(blue)，
               所以 Python 内置函数（print/len/open）、LaTeX 命令（\chapter）
               都是这个蓝。（另一条规则 `entity.name.function` → var(blue5) 青
               只管「函数定义名」，Shiki 把两者合并了，取更常见的蓝。） */
            '--shiki-token-function': { dark: PALETTE.blue, light: '#3E6FA8' },
            '--shiki-token-string-expression': { dark: '#A9D4A4', light: '#3E7A3A' },
            '--shiki-token-punctuation': { dark: PALETTE.dim, light: '#5A6472' },
            '--shiki-token-link': { dark: PALETTE.blueUi, light: LIGHT.link },
            /* Shiki 的 css-variables 主题还引用这三个（用于 ```diff 代码块），
               但宿主 shiki.css 没有声明它们 —— 不补的话 diff 新增/删除行会落到
               var() 未定义的兜底色（继承正文色），看不出增删。 */
            '--shiki-token-inserted': { dark: PALETTE.green, light: '#4E8A4A' },
            '--shiki-token-deleted': { dark: PALETTE.red, light: '#C4464F' },
            '--shiki-token-changed': { dark: PALETTE.yellow, light: '#C97A2B' },
          }
        : {}

      /* ---- 合并成 { light, dark } 对；缺浅色值的回落到深色值（绝不出现单值）---- */
      const out = {}
      for (const name of Object.keys(dark)) {
        out[name] = { light: light[name] !== undefined ? light[name] : dark[name], dark: dark[name] }
      }
      for (const name of Object.keys(staticTokens)) out[name] = staticTokens[name]
      for (const name of Object.keys(shikiTokens)) out[name] = shikiTokens[name]
      /* 正文高亮的辅助令牌：与 syntax 开关解耦，由 prose 开关单独控制样式表挂载。 */
      for (const [name, pair] of Object.entries(resolveProseTokens(state))) out[name] = pair
      /* 过程行高亮色：写进令牌层，样式表用 var(--dmt-row-color, 兜底) 取。
         浅色值与深色值相同（过程行颜色是用户挑的，不该随外观变）。
         state 可能整体缺省（测试/首次挂载），所以每个字段都单独兜底。 */
      const rowColor = typeof (state && state.rowColor) === 'string' && HEX_PATTERN.test(state.rowColor)
        ? state.rowColor
        : DEFAULTS.rowColor
      out['--dmt-row-color'] = { light: rowColor, dark: rowColor }
      /* 汇总行 / 本轮汇总的颜色（黄），同上：两色系同值。 */
      const summaryColor = typeof (state && state.summaryColor) === 'string' && HEX_PATTERN.test(state.summaryColor)
        ? state.summaryColor
        : DEFAULTS.summaryColor
      out['--dmt-summary-color'] = { light: summaryColor, dark: summaryColor }
      /* Markdown 细节色：对齐 Sublime Mariana 的 markup.* 规则。 */
      out['--dmt-md-list-marker'] = { light: PALETTE.green, dark: PALETTE.green }
      out['--dmt-md-quote'] = { light: PALETTE.orange, dark: PALETTE.orange }
      out['--dmt-md-code-bg'] = { light: LIGHT.code, dark: s.layer2 }
      return out
    }

    /* ====================================================================== *
     * 二·五、正文高亮样式表（prose）
     *
     * 为什么需要单独一张表：`--shiki-*` 只被 Shiki 生成的 `<span>` 的 inline style
     * 引用，**Markdown 正文完全不消费它**。正文的颜色来自前端 CSS 里那几条固定规则
     * （下面用行内注释形式引用，避免与 JS 块注释嵌套冲突）：
     *
     *     ._markdown_xxx { color: var(--dsw-alias-label-primary) }   // 全部文字同色
     *     ._markdown_xxx strong { font-weight: 600 }                 // 只改字重，不改色
     *
     * 所以想让正文"有高亮"，只能往宿主 DOM 里加规则。
     *
     * 选择器怎么选才不随构建失效：
     *   宿主 markdown 容器是 `className: de(St.markdown, ...)`，St.markdown 是
     *   CSS Modules 生成的 `_markdown_1ypvv_5` —— 前缀 `_markdown_` 来自源文件名，
     *   **跨构建稳定**；末尾的 hash 与序号会变。所以用 `[class*="_markdown_"]`
     *   做属性子串匹配，既不写死 hash，也不会误伤其它模块。
     *
     * 为什么要排除 compact：宿主对摘要/紧凑变体显式写了
     *     ._compact_xxx pre, ._compact_xxx pre :is(code,span){color:inherit!important}
     *     ._compact_xxx a { color: inherit; text-decoration: underline dotted }
     * 它在紧凑场景**故意**要求继承色，我们的规则若命中也应该让位 ——
     * 容器上只有 compact 时有 `data-markdown-variant="compact"`，据此排除。
     * ====================================================================== */

    const PROSE_SHEET_ID = 'dsh-colorlab/prose.css'
    const ROW_SHEET_ID = 'dsh-colorlab/row.css'
    const CARD_SHEET_ID = 'dsh-colorlab/card.css'
    const MARKDOWN_SHEET_ID = 'dsh-colorlab/markdown.css'
    const LATEX_SHEET_ID = 'dsh-colorlab/latex.css'
    const SHAPE_SHEET_ID = 'dsh-colorlab/shape.css'
    const GLASS_SHEET_ID = 'dsh-colorlab/glass.css'

    /* ====================================================================== *
     * 二·六、玻璃界面：壁纸层 + 单层 alpha
     *
     * ## 这个功能的由来（重要，别再走回头路）
     *
     * 本插件曾经做过「表面不透明度 + 毛玻璃」，反复失败、最后整个回退。当时的判断是
     * 「backdrop-filter 不起作用」，其实不是 ——
     *
     * **`backdrop-filter` 只能模糊「同一张画布里、位于它背后的像素」。**
     * 窗口背后的真实桌面不在 Chromium 画布里，所以玻璃背后是空的，
     * 无论怎么调 blur 或 alpha，屏幕上都看不出变化。
     *
     * 把背景图**铺进页面最底层**之后，它就成了画布内像素，玻璃才有东西可糊。
     * 这一步不需要修改 `app.asar`，也不需要窗口透明。
     *
     * ## 分层铁律（上一轮失败的第二个原因）
     *
     * DSH 的背景是**嵌套**的，且每层都用同一个不透明色铺底：
     *
     *     .frame            background: var(--dsw-alias-bg-base)
     *       .sidebarCol     background: var(--dsw-specific-sidebar-fill)
     *       .centerCol      background: var(--dsw-alias-bg-base)
     *       .rightbarCol    background: var(--dsw-specific-sidebar-fill)
     *
     * 如果给**每一层**都加 alpha，合成后的不透明度是 a + a(1-a) + a(1-a)² …
     * —— 0.6 叠两层就是 0.84、三层 0.944，屏幕上等于完全不透明。
     *
     * 所以：**容器层全部清成透明，只在最上层三列各铺一次低 alpha。**
     * 这也是参考实现（YSDLNGF/dsh-acrylic-light）在注释里写下的同一条结论。
     *
     * ## 开关方式
     *
     * 所有规则都挂在 `html[data-dsh-glass]` 属性下。关掉 = 摘属性 + 删背景层，
     * 页面上不留任何残留样式。
     * ====================================================================== */

    /** 玻璃模式的总开关属性。摘掉它 = 完全恢复原样。 */
    const GLASS_ATTR = 'data-dsh-glass'

    /** 手绘造型的总闸属性（与玻璃互相独立）。 */
    const SHAPE_ATTR = 'data-dsh-shape'

    /** 背景层元素 id。 */
    const WALLPAPER_LAYER_ID = 'dmt-wallpaper'

    /** 壁纸路由（由 Host 半体注册）。 */
    const WALLPAPER_ROUTE = '/dsh-colorlab/wallpaper'

    /**
     * 解析 0–100 的百分比设置。
     * @param {string|number|undefined} raw - 设置值。
     * @param {number} min - 下界。
     * @param {number} max - 上界。
     * @param {number} fallback - 无法解析时的回落值。
     * @returns {number} 范围内的数值。
     */
    function parsePercent(raw, min, max, fallback) {
      if (raw === undefined || raw === null || raw === '') return fallback
      const n = Number(String(raw).trim())
      if (!Number.isFinite(n)) return fallback
      return Math.max(min, Math.min(max, n))
    }

    /**
     * hex → `rgba(r, g, b, a)`。
     * 用 rgba 而不是 8 位 hex：精度更高，也便于和 alpha 计算混合。
     * @param {string} hex - `#rgb` 或 `#rrggbb`。
     * @param {number} alpha - 0..1。
     * @returns {string} rgba() 文本；输入非法时原样返回。
     */
    function hexToRgba(hex, alpha) {
      if (typeof hex !== 'string') return hex
      let clean = hex.trim().replace('#', '')
      if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('')
      if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex
      const r = parseInt(clean.slice(0, 2), 16)
      const g = parseInt(clean.slice(2, 4), 16)
      const b = parseInt(clean.slice(4, 6), 16)
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return hex
      /* 保留两位小数：JS 浮点会算出 0.6499999999999999 这种值。 */
      const a = Math.round(Math.max(0, Math.min(1, alpha)) * 100) / 100
      return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')'
    }

    /**
     * 生成「渐变」背景：用当前表面色派生的柔和光斑。
     *
     * 只在两种情况下使用：用户显式选了「渐变」，或壁纸读不到时的兜底。
     *
     * ⚠️ 渐变的空间频率很低（一整个窗口只有两三个色斑），模糊之后还是那两三个色斑，
     * 所以**渐变永远不如真实壁纸好看** —— 它只是保证"不会露出纯色或黑屏"。
     * 真正让玻璃有效果的是照片壁纸的高频细节。
     *
     * @param {object} surfaces - 表面色。
     * @param {boolean} isDark - 深色模式。
     * @returns {string} 可直接写进 `background` 的值。
     */
    function buildGradientBackdrop(surfaces, isDark) {
      const s = surfaces || {}
      const base = s.base || (isDark ? '#343D46' : '#FFFFFF')
      const layer1 = s.layer1 || base
      const layer2 = s.layer2 || layer1
      const sidebar = s.sidebar || layer1
      const spot = (color, alpha) => hexToRgba(color, alpha)
      return 'radial-gradient(circle at 18% 12%, ' + spot(sidebar, 0.9) + ' 0%, transparent 55%),'
        + 'radial-gradient(circle at 82% 78%, ' + spot(layer2, 0.9) + ' 0%, transparent 58%),'
        + 'radial-gradient(circle at 50% 50%, ' + spot(layer1, 0.7) + ' 0%, transparent 70%),'
        + base
    }

    /** 壁纸 objectURL 缓存（避免重复 fetch 与内存泄漏）。 */
    let wallpaperObjectUrl = null
    /** 壁纸加载状态：'idle' | 'loading' | 'ready' | 'fallback'。 */
    let wallpaperStatus = 'idle'
    /** 壁纸层 DOM 元素。 */
    let wallpaperEl = null

    /**
     * 加载壁纸：fetch Host 路由 → blob → objectURL。
     *
     * 用 objectURL 而不是 base64：1MB 图转 base64 会涨到 1.37MB 字符串，
     * 而且要重新解析。
     *
     * 失败（404 / 网络错误 / Host 没有 webServer）时静默退回渐变。
     */
    /** 上一次加载用的壁纸来源签名（路径 + 来源模式）。变了就要重新拉。 */
    let wallpaperSignature = null
    /** 请求序号：用于丢弃过期响应（快速换路径时旧请求可能后到）。 */
    let wallpaperRequestSeq = 0
    /** 最后一次壁纸请求的诊断信息（设置页直接显示，省得再猜哪一步断了）。 */
    let wallpaperDiag = { url: '', status: 0, error: '', size: 0 }

    /**
     * 带壁纸路径的请求地址。
     *
     * ⚠️ 为什么要把路径放进 query，而不是让 Host 自己读配置：
     *   Host 的 config 是 apply() 那一刻的快照，设置改完它**不会更新**，
     *   于是 Host 一直用旧路径 —— 表现为「要提交第二次才显示上一次选的图」。
     *   query 参数由页面在每次请求时给出，永远是最新值。
     *
     * @param {string} customPath - 当前设置里的自选壁纸路径。
     * @returns {string} 请求 URL。
     */
    function wallpaperUrl(customPath) {
      const clean = typeof customPath === 'string' ? customPath : ''
      if (clean === '') return WALLPAPER_ROUTE
      return WALLPAPER_ROUTE + '?path=' + encodeURIComponent(clean)
    }

    function loadWallpaper(signature) {
      if (typeof fetch !== 'function' || typeof URL === 'undefined') {
        wallpaperStatus = 'fallback'
        return
      }
      /* 🔧 不能只判断 loading/ready：用户在设置里换了自选壁纸路径后，
       * 状态仍是 ready，会一直显示旧图。所以按「来源签名」判断 ——
       * 签名变了就重新拉，同一签名才短路。 */
      const sig = signature === undefined ? '' : String(signature)
      /* 同一签名已经加载好 → 跳过。 */
      if (wallpaperStatus === 'ready' && wallpaperSignature === sig) return
      /* 🔧 loading 期间换了签名，必须**继续发起新请求**。
       * 原来这里直接 return，导致"快速改两次路径只生效第一次"。
       * 用序号丢弃过期响应，避免旧请求回来覆盖新图。 */
      wallpaperSignature = sig
      wallpaperStatus = 'loading'
      const requestSeq = (wallpaperRequestSeq += 1)
      wallpaperDiag = { url: wallpaperUrl(signature), status: 0, error: '', size: 0 }
      try {
        fetch(wallpaperUrl(signature), { cache: 'no-store' })
          .then((response) => {
            wallpaperDiag.status = response.status
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.blob()
          })
          .then((blob) => {
            /* 过期响应直接丢弃（期间用户又换了路径）。 */
            if (requestSeq !== wallpaperRequestSeq) return null
            if (!blob || blob.size === 0) throw new Error('empty wallpaper')
            if (wallpaperObjectUrl !== null) {
              try {
                URL.revokeObjectURL(wallpaperObjectUrl)
              } catch {
                /* 已释放 */
              }
            }
            if (blob === null) return
            wallpaperDiag.size = blob.size
            wallpaperObjectUrl = URL.createObjectURL(blob)
            wallpaperStatus = 'ready'
            diag.glass = 'wallpaper'
            paintWallpaperLayer()
          })
          .catch((error) => {
            wallpaperDiag.error = String(error && error.message ? error.message : error)
            wallpaperStatus = 'fallback'
            wallpaperSignature = null
            diag.glass = 'gradient'
            paintWallpaperLayer()
          })
      } catch {
        wallpaperStatus = 'fallback'
        diag.glass = 'gradient'
      }
    }

    /** 当前生效的表面色与深色判定（供背景层绘制使用）。 */
    let wallpaperSurfaces = { dark: SURFACES.standard, isDark: true }

    /**
     * 压暗层的颜色（rgba 串；空串 = 不压暗）。
     *
     * ⚠️ 为什么合成进背景层的 background-image，而不是 `#root::before`
     * （2026-10-22 修正，真机验证前一轮玻璃"发灰"的直接原因之一）：
     * `#root` 被玻璃表设为 `z-index:1` —— 它自己就是一个层叠上下文。
     * 上下文**内部**的定位伪元素（z-index:0）按 CSS 绘制顺序会画在
     * 静态流内容（三列、卡片背景——层 3）**之上**。
     * 宿主大部分容器不带定位，所以 `#root::before` 的"压暗层"实际是
     * 一整页 55% 的灰纱，连文字一起压暗 —— 补上闭括号后这个 bug 才会
     * 第一次真正生效，所以必须和闭括号**一起**修，不能只补括号。
     *
     * 放进背景层（`#dmt-wallpaper` 在 `#root` 之外、之下）后，
     * 压暗只作用于「底图」，内容层完全不经过它 —— 结构上保证"压背景不压字"。
     * 背景层自身的 blur 不影响纯色渐变（单层纯色糊了还是那个色），无副作用。
     */
    let wallpaperVeil = ''

    /** 压暗层 + 背景图的合成（纯函数，方便测试）。
     *
     * ⚠️ veil 为空串时**必须**原样返回图片值：拼进 linear-gradient() 会得到
     * `linear-gradient(, ,)` 这种非法颜色，整条 background-image 一起报废。 */
    function composeBackdrop(veil, imageValue) {
      if (veil === '' || imageValue === '') return imageValue
      return 'linear-gradient(' + veil + ', ' + veil + '), ' + imageValue
    }

    /** 背景层的完整 background（渐变兜底路径用，含当前 veil）。 */
    function backdropGradient(dark, isDark, veil) {
      return composeBackdrop(veil === undefined ? wallpaperVeil : veil, buildGradientBackdrop(dark, isDark))
    }

    /**
     * 压暗层的颜色：把壁纸压到主题 base 附近，保证任何壁纸下文字对比度稳定。
     *
     * 🔧 ❸（2026-10-22）：不再是固定 0.55 —— 与「表面浓度」联动。
     * 浓度越高，列本身已经把底压得够暗，veil 就该让位（不然壁纸信号被
     * 两头吃：veil 吃一半、列吃一大半，正文只剩 ~10%）；浓度越低，
     * 文字越直接坐在壁纸上，veil 必须多干点活。
     *
     *   深色 v = 0.50 − 0.30·α   （夹取 0.15–0.45）
     *   浅色 v = 0.45 − 0.30·α   （夹取 0.15–0.40）
     *
     * 正文壁纸信号 = (1−v)(1−α)：α=0.65 → 24%，α=0.78 → 16%，
     * 旧固定 0.55 时分别是 15.8% / 9.9%。
     *
     * @param {object} surf - 当前表面色（取 base）。
     * @param {boolean} isDark - 深色模式。
     * @param {number} alpha - 表面浓度 0..1（缺省按默认 0.65）。
     * @param {string} mode - "auto"（跟随浓度的公式）| "0"（关）| "20"/"35"/"50"
     *   （手动固定百分比）。升格为设置项（2026-10-22）：压暗是"亮壁纸下
     *   文字是否发灰"的唯一旋钮，之前只能跟着 tint 走，想单独调做不到。
     * @returns {string} rgba 串；mode="0" 返回空串（不压暗）。
     */
    function glassVeilColor(surf, isDark, alpha, mode) {
      const base = (surf && surf.base) || (isDark ? '#343D46' : '#FFFFFF')
      const a = Math.max(0, Math.min(1, typeof alpha === 'number' ? alpha : 0.65))
      if (mode !== undefined && mode !== 'auto' && mode !== '') {
        const manual = Number(String(mode).trim())
        if (Number.isFinite(manual)) {
          const v = Math.max(0, Math.min(0.85, manual / 100))
          return v <= 0 ? '' : hexToRgba(base, v)
        }
      }
      const v = Math.max(0.15, Math.min(isDark ? 0.45 : 0.4, (isDark ? 0.5 : 0.45) - 0.3 * a))
      return hexToRgba(base, v)
    }

    /** 背景层 background-image 值（veil 在前、壁纸图在后；veil 空则不前置）。 */
    function backdropImage(wallpaperUrlValue) {
      return (wallpaperVeil === ''
        ? ''
        : 'linear-gradient(' + wallpaperVeil + ', ' + wallpaperVeil + '),')
        + wallpaperUrlValue
    }

    /**
     * 把背景画到背景层元素上。
     *
     * 优先级：壁纸 objectURL > 渐变。
     *
     * 🔧 压暗层（veil）合成进背景层自身的渐变（见 glassVeilColor 的注释）；
     * 每次整体重赋 `background`，浓度/配色随设置即时生效。签名守卫防重复赋值。
     */
    function paintWallpaperLayer() {
      if (wallpaperEl === null) return
      const { dark, isDark } = wallpaperSurfaces
      /* 🔧 等高线模式：底是**实色 base**（主题色地面），线画在它上面 ——
       * 不铺壁纸图也不铺渐变（线在渐变上会忽隐忽现，上游同款决定）。 */
      if (contourActive) {
        const solid = (dark && dark.base) || (isDark ? '#343D46' : '#FFFFFF')
        if (wallpaperEl.__dmtBackdrop !== solid) {
          wallpaperEl.__dmtBackdrop = solid
          wallpaperEl.style.background = solid
        }
        return
      }
      if (wallpaperStatus === 'ready' && wallpaperObjectUrl !== null) {
        /* 多层背景：压暗渐变是**第一层**（画在最上），壁纸 url 在第二层。
         * ⚠️ 渐变层只接受合法颜色 —— 必须用 backdropImage() 加 veil，
         * 否则会出现 `linear-gradient(, ,)` 这种非法值让整条 background-image 失效。
         * 各层尺寸各给一份：veil 铺满（auto），壁纸 cover。 */
        const value = backdropImage('url("' + wallpaperObjectUrl + '")')
        if (wallpaperEl.__dmtBackdrop === value) return
        wallpaperEl.__dmtBackdrop = value
        wallpaperEl.style.backgroundImage = value
        wallpaperEl.style.backgroundSize = wallpaperVeil === '' ? 'cover' : 'auto, cover'
        wallpaperEl.style.backgroundPosition = wallpaperVeil === '' ? 'center' : 'center, center'
        wallpaperEl.style.backgroundRepeat = wallpaperVeil === '' ? 'no-repeat' : 'no-repeat, no-repeat'
        wallpaperEl.style.backgroundColor = 'transparent'
        return
      }
      const gradient = backdropGradient(dark, isDark)
      if (wallpaperEl.__dmtBackdrop !== gradient) {
        wallpaperEl.__dmtBackdrop = gradient
        wallpaperEl.style.backgroundImage = 'none'
        wallpaperEl.style.background = gradient
      }
    }

    /**
     * 创建 / 移除背景层元素。
     *
     * ⚠️ 用真实 `<div>` 而不是 `body::before`：
     * 层级关系更直白（背景层 z-index 0、`#root` z-index 1），
     * 也不受伪元素与根背景绘制规则的影响。
     *
     * @param {boolean} needed - 是否需要背景层。
     */
    /** 当前生效的模糊半径（由 syncGlassSheet 写入）。 */
    let wallpaperBlur = 16
    /** 当前生效的背景饱和度（0–200，100=原样；由 syncGlassSheet 写入）。 */
    let wallpaperSat = 120

    function syncWallpaperLayer(needed, blur, sat) {
      if (typeof blur === 'number') wallpaperBlur = blur
      if (typeof sat === 'number') wallpaperSat = Math.max(0, Math.min(200, sat))
      if (typeof document === 'undefined') return
      if (typeof document.getElementById !== 'function') return
      const existing = document.getElementById(WALLPAPER_LAYER_ID)
      if (!needed) {
        if (existing !== null) {
          try {
            existing.remove()
          } catch (error) {
            note('remove wallpaper layer', error)
          }
        }
        wallpaperEl = null
        return
      }
      if (existing === null) {
        const el = document.createElement('div')
        el.id = WALLPAPER_LAYER_ID
        el.setAttribute('aria-hidden', 'true')
        /* fixed 铺满、z-index 0（在内容之下）、pointer-events none（不挡点击）。 */
        /* ⚠️ **模糊在这里做，且只做这一次。**
         *
         * 上一版把 backdrop-filter 加在三列上，结果是「只有中栏糊、侧栏右栏是实的」——
         * 因为列内部还有自己的不透明背景层，外层糊了里层照样实色。
         *
         * 把 filter 放在壁纸层自己身上，模糊的是「那张底图」本身：
         * 糊好的底图透到上层，不管上面盖多少层、什么颜色，观感都统一。
         *
         * scale 略放大，抵消 blur 在边缘产生的透明晕边（否则四边会露黑）。 */
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;'
          + 'width:100vw;height:100vh;pointer-events:none;z-index:0;overflow:hidden;'
          + 'transition:background .25s ease'
        try {
          if (typeof document.body.prepend === 'function') document.body.prepend(el)
          else document.body.insertBefore(el, document.body.firstChild)
        } catch (error) {
          note('prepend wallpaper layer', error)
          return
        }
        wallpaperEl = el
      } else {
        wallpaperEl = existing
      }
      applyWallpaperFilter()
      paintWallpaperLayer()
    }

    /**
     * 把模糊写到壁纸层上。
     *
     * ⚠️ **这是整个玻璃效果的关键**：模糊必须作用在「底图」本身，
     * 而不是上层面板的 backdrop-filter。
     *
     * 原因（上一版实测）：给三列加 backdrop-filter 后，只有中栏糊了，
     * 侧栏和右栏仍是实色 —— 因为那两列内部还有自己的不透明背景层，
     * 外层糊了、里层照样铺实色。页面里到底有多少层背景数不完，
     * 逐个枚举注定漏。
     *
     * 换成「底图自己先糊」之后，透上去的永远是同一张糊好的图，
     * 上面叠多少层都不影响「背后是糊的」这件事。
     *
     * scale 略放大抵消 blur 在边缘产生的透明晕边（否则窗口四边会露黑）。
     */
    function applyWallpaperFilter() {
      if (wallpaperEl === null) return
      /* 🔧 等高线模式不糊也不饱和：线是 1px 高频细节，糊了等于没有；
       * 线色由强调色直出，saturate 会把它改歪 —— 它的"玻璃感"来自
       * 列的 alpha 透过，不需要任何底图后处理。 */
      const blur = contourActive ? 0 : Math.max(0, Math.min(40, wallpaperBlur))
      /* 饱和度 0–200%（100 = 原样）。和 blur 一样做在**底图**上 ——
       * 一次 filter 串，全窗统一，面板上不需要各自再 sat（Win11 亚克力
       * 的 saturate 同理：调的是透过率里的世界，不是玻璃本身）。 */
      const sat = contourActive ? 100 : wallpaperSat
      const parts = []
      if (blur > 0) parts.push('blur(' + blur + 'px)')
      if (sat !== 100) parts.push('saturate(' + (sat / 100) + ')')
      const value = parts.length > 0 ? parts.join(' ') : 'none'
      if (wallpaperEl.__dmtFilter === value) return
      wallpaperEl.__dmtFilter = value
      wallpaperEl.style.filter = value
      wallpaperEl.style.transform = blur > 0 ? 'scale(1.08)' : 'none'
    }

     /**
      * ══ 玻璃浓度体系：差值上色（2026-10-22，问题 ❸ 的解）══════════
      *
      * ## 为什么旧公式必然做出"实心板"
      *
      * 宿主里**每一类浮面都有自己的涂色层**（逐条从 app.asar 实证）：
      *   变更卡片 `.kuvljq_card{background:var(--dsw-alias-bg-layer-1)}`
      *   交付卡片 `.flL80G_file{background:var(--deliverable-fill)}`
      *   计划卡片 `.KuQXFq_card{background:var(--plan-card-fill)}`
      *   用户气泡 `.cJsG2q_bubble{background:var(--dsw-specific-bubble)}`
      *   本轮汇总 `.oE-XyW_root{background:var(--dsw-alias-turn-trigger-bg,…)}`
      *   代码块   pre（Shiki 内联 var(--shiki-background)）
      *   输入卡   `.RlGAzG_card{background:var(--dsw-specific-input-major)}`
      * 而正文本身**不涂色**（`_markdown_` 无 background，字直接坐在列上）。
      * 于是从壁纸到文字：列涂 α，卡片**再**涂 α′ —— 旧公式让 α′≈α−0.18，
      * 两层连乘后卡片上的壁纸信号 = (1−v)(1−α)(1−α′) ≈ 2%，只有正文区的
      * 1/5。糊了的 2% 等于没糊 —— 这就是"卡片没有玻璃"的数学根源。
      *
      * ## 新规则：每层只补"离目标还差多少"
      *
      *   本层该涂 a = (目标合成 F − 下层合成 B) / (1 − B)
      *
      * 三档目标（F 以列合成 α 为基准）：
      *   底板（三列）      F = α                    —— 用户滑块直接控制
      *   浮层（卡片/气泡…） F = α + 0.10 (+fog 微调)  —— 略实一档、仍透
      *   代码块            F = α + 0.14             —— 要读长代码，再实一点
      * 全窗任何位置的最终合成都**收敛于目标**，不再连乘爆炸。
      * hover/active 是浮层上的第 3 层，增量 0.05/0.09，同样走差值。
      *
      * 例外（不套差值，保持直涂）：对话框/菜单那条选择器规则之外无叠加
      * （portal 父层透明，单层）；输入卡的座透明、卡本体走浮层档。
      */

    /** 三档增量（合成目标 − 列合成）。做成常量方便整体调口味。 */
    const GLASS_TIER = Object.freeze({
      float: 0.10,      /* 浮层基础增量（fog=0 时） */
      code: 0.14,       /* 代码块增量 */
      banner: 0.04,     /* 代码块横幅在代码块档上再加 */
      hover: 0.05,      /* hover 态在浮层档上再加 */
      active: 0.09,     /* active 态同理 */
      fogPer: 0.30,     /* fog 滑块（0–40%）最多再加的增量（2026-10-22 扩：0.10 观感太弱） */
    })

    /** 合成：下层不透明度 under，本层涂 a，结果不透明度。 */
    function glassComposite(under, a) {
      const u = Math.max(0, Math.min(1, under))
      return u + (1 - u) * Math.max(0, Math.min(1, a))
    }

    /**
     * 差值上色：下层已合成 base，希望最终合成 target —— 本层该涂多少。
     * target ≤ base 时返回 0；base 已到 1 时涂什么都看不见，返回 0。
     */
    function glassDeltaAlpha(base, target) {
      const b = Math.max(0, Math.min(1, base))
      const f = Math.max(b, Math.min(1, target))
      if (b >= 1) return 0
      return (f - b) / (1 - b)
    }

    /** 浮层档合成目标（列 α + 基础增量 + fog 微调）。 */
    function glassFloatTarget(alpha, fogRatio) {
      return Math.min(1, alpha + GLASS_TIER.float
        + Math.max(0, Math.min(1, fogRatio)) * GLASS_TIER.fogPer)
    }

    /**
     * 颜色预补偿（2026-10-22，「卡片/代码块/输入卡变成正文背景色」的修复）。
     *
     * 差值浓度解决了"透不透"，但制造了新问题：**颜色被下层冲淡**。
     * 列先铺 base@α，卡片再涂 C@a —— 最终显示 = a·C + (1−a)·α·base + …，
     * base 项占了 (F−α) 之外的全部权重。Mariana 各色板本就接近
     * （code #2E363F / card #2A323B / base #343D46），稀释后**全部看起来
     * 和正文同色**（用户报）。输入卡更直接：旧代码拿 surf.base 涂它。
     *
     * 解法：涂的不是 C 本身，而是**预补偿色 C'** —— 让它穿过列那层
     * base@α 的稀释之后，恰好还原成目标：
     *
     *   目标：a·C' + (1−a)·α·B = F·C
     *   代入 a = (F−α)/(1−α)，解出：
     *   C' = [ (1−α)·F·C − α·(1−F)·B ] / (F−α)
     *
     * 自检：C=B 时 C'=B（与列同色的表面不受影响）；逐通道夹取 0–255
     * （C 比 B 暗很多时补偿色可能出界，夹取 = 该处颜色权重略欠，可接受）。
     *
     * @param {string} columnColor - 下层（列）涂的色，hex。
     * @param {string} surfaceColor - 该表面"想要"的色，hex。
     * @param {number} alpha - 列浓度（下层合成不透明度）。
     * @param {number} target - 本表面合成后的目标不透明度 F。
     * @returns {string} 预补偿后的 hex。
     */
    function glassSurfaceColor(columnColor, surfaceColor, alpha, target) {
      const F = Math.max(0, Math.min(1, target))
      const a = Math.max(0, Math.min(0.999, alpha))
      if (F <= a) return surfaceColor
      const hex = (v) => Math.max(0, Math.min(255, Math.round(v)))
        .toString(16).padStart(2, '0').toUpperCase()
      const chan = (h, i) => {
        let c = String(h).trim().replace('#', '')
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
        if (!/^[0-9a-fA-F]{6}$/.test(c)) return null
        return parseInt(c.slice(i * 2, i * 2 + 2), 16)
      }
      const out = []
      for (let i = 0; i < 3; i += 1) {
        const C = chan(surfaceColor, i)
        const B = chan(columnColor, i)
        if (C === null || B === null) return surfaceColor
        out.push(hex(((1 - a) * F * C - a * (1 - F) * B) / (F - a)))
      }
      return '#' + out.join('')
    }

    /** 浮层（卡片/气泡/输入卡/行内代码）自身该涂的浓度。 */
    function glassFloatAlpha(alpha, fogRatio) {
      return glassDeltaAlpha(alpha, glassFloatTarget(alpha, fogRatio))
    }

    /**
     * 代码块浓度（令牌层与选择器层**共用**这一个公式，2026-10-22 改为差值档）。
     *
     * 为什么必须共享：`pre` 的底色有两条生效路径 ——
     *   a) 令牌 `--shiki-background` / `--dsw-alias-markdown-code-block`；
     *   b) 玻璃表 `pre{background-color:…}` 的 !important（直接压宿主规则）。
     * 两条若公式不一致，改浓度滑块会出现「横幅透、正文不透」这类分层错位。
     */
    function glassSolidAlpha(alpha) {
      return glassDeltaAlpha(alpha, Math.min(1, alpha + GLASS_TIER.code))
    }

     /**
      * 生成「整窗玻璃」令牌覆盖。
     *
     * ## 为什么需要这一步
     *
     * 只把三列设成半透明，窗口里**所有的浮层和卡片仍然是实心的** ——
     * 卡片、代码块、思考块、输入框、菜单、对话框各有自己的不透明底，
     * 它们铺在玻璃上，看起来就是「一块块不透明的板子漂浮在透明背景上」。
     *
     * 要让**整个窗口**都呈现玻璃质感，必须把这些表面令牌也换成半透明。
     *
     * ## 令牌 vs 选择器
     *
     * 优先改令牌而不是加 DOM 选择器，理由（参考实现也踩过）：
     *   - 令牌是宿主自己声明的位置，覆盖它不会碰 DOM 结构
     *   - 不会与第三方插件的类名哈希冲突
     *   - 宿主所有引用该令牌的组件一起生效，不会漏
     *
     * 之前几次失败的教训：往 DOM 上加硬选择器，既漏层又容易崩。
     *
     * @param {object} surf - 当前表面色。
     * @param {boolean} isDark - 深色模式。
     * @param {number} alpha - 基础浓度 0..1。
     * @param {number} fog - 浮层浓度 0..1（浮层需要更浓，否则读不清字）。
     * @returns {string[]} 令牌声明数组（不含 selector 包裹）。
     */
    function glassTokenDecls(surf, isDark, alpha, fog) {
      const out = []
      /* 🔧 push 升级为「颜色预补偿」语义（2026-10-22，修「卡片/代码块/
       * 输入卡变成正文背景色」）：浓度仍按差值档（调用方不变），但涂的
       * **颜色**换成预补偿色 —— 穿过列（base@α）的稀释后恰好还原成
       * 该表面自己的色。不做这步，合成后全是 base 味（Mariana 色板
       * 各色太接近，一稀释就分不出谁是谁）。
       * 基准取中栏 base：绝大多数表面坐在中栏；侧栏里的少数面板会
       * 略偏，可接受。 */
      const columnColor = surf.base || '#343D46'
      const push = (name, color, a) => {
        if (!color) return
        const aa = Math.min(1, Math.max(0, a))
        const F = glassComposite(alpha, aa)
        out.push(name + ':' + hexToRgba(glassSurfaceColor(columnColor, color, alpha, F), aa) + ' !important')
      }
      /* ══ 差值上色（2026-10-22，见上方「玻璃浓度体系」长注释）══
       *
       * 列（三列选择器规则）涂 α —— 它就是浮层下面的合成不透明度 B。
       * 本函数所有令牌都是**坐在列上的第 2 层**，一律涂"差值"：
       *   a = (目标 F − α) / (1 − α)
       * 卡片上的最终合成 = α + (1−α)·a = F，精确收敛，不再连乘爆炸。
       *
       * fog 滑块（0–40%）语义同步修正：它是浮层合成目标的**微调量**
       * （最多 +0.10），不再是"浮层自身浓度"。fog=0 → 浮层 F=α+0.10；
       * fog=40% → F=α+0.20。
       *
       * （历史：旧公式让卡片涂 α−0.18、代码块涂 α−0.10 —— 方向看似对，
       * 但"卡片自己那层的浓度"和"卡片上的最终合成"是两回事，两层连乘
       * 后卡片永远比列实，壁纸信号 2%。差值公式才是自洽的那一个。） */
      const fogRatio = Math.max(0, Math.min(1, fog / 0.4)) /* 0..1，浮层浓度滑块的归一值 */
      const layerAlpha = Math.min(1, alpha)
      /* 浮层档：卡片/气泡/菜单/输入卡/行内代码 —— 合成目标 α+0.10(+fog 微调)，
         本层涂差值。 */
      const floatTarget = glassFloatTarget(layerAlpha, fogRatio)
      const fogAlpha = glassFloatAlpha(layerAlpha, fogRatio)
      /* 代码块档：合成目标 α+0.14（读长代码，比卡片再实一点）。
         与选择器层的 `pre` 规则共用 glassSolidAlpha，见该函数注释。 */
      const solidAlpha = glassSolidAlpha(layerAlpha)
      /* hover/active：浮层之上的第 3 层，增量小、瞬态。 */
      const hoverAlpha = glassDeltaAlpha(floatTarget, Math.min(1, floatTarget + GLASS_TIER.hover))
      const activeAlpha = glassDeltaAlpha(floatTarget, Math.min(1, floatTarget + GLASS_TIER.active))

      /* ① 整页底：透明，让背景层透上来。
       *    注意这一步不改成半透明 —— 透明才能看到背景层。 */
      out.push('--dsw-alias-bg-base:transparent !important')

      /* ② 侧栏底色令牌 = transparent。
       *
       * 它同时被两处消费，必须先讲清链路才不会改坏：
       *
       *   a) 侧栏元素（_sidebarCol）与标题栏拖动区（_frame::before）铺底；
       *   b) preload 的隐藏探针：
       *        const probe = document.createElement('span')
       *        probe.style.cssText = '…background-color:var(--dsw-specific-sidebar-fill)…'
       *      然后 canvas 归一化 → IPC → mainWindow.setTitleBarOverlay({color})
       *
       * 🔧 上一版把这里改成 rgba(0.75)，结果**左侧栏的玻璃效果失效了** ——
       * 因为侧栏内部多个元素都铺这个色，alpha 叠 alpha 又变回实心。
       * 说明这个令牌必须保持 transparent，侧栏的层次由 _sidebarCol 那条规则接管。
       *
       * 那标题栏怎么办？探针走 canvas 归一化：
       *   context.fillStyle = 'transparent' → getImageData → rgba(0,0,0,0)
       * 送出的是括号形式的 rgba(...)，**能通过主进程的 validColor 正则**，
       * 于是 setTitleBarOverlay 收到全透明色，覆盖层让出窗口材质。
       * 之前「标题栏没变化」不是被拒，而是那一栏本来就该由窗口材质呈现，
       * 需要窗口开启透明材质才会真正透 —— 那是宿主窗口的事，不是页面 CSS 能做的。 */
      out.push('--dsw-specific-sidebar-fill:transparent !important')

      /* ③ 分层表面：全部走**浮层档差值**（它们都铺在列之上：卡片体、
       *    浮层面板、tooltip —— 宿主消费点实测：.kuvljq_card 用 layer-1、
       *    面板浮层用 overlay）。旧写法给它们直涂 layerAlpha(0.78)，
       *    列 0.78 + 本层 0.78 连乘 = 0.95 → 卡片上壁纸只剩 2%。 */
      const layer1 = surf.layer1 || surf.base
      const layer2 = surf.layer2 || layer1
      const layer3 = surf.layer3 || layer2
      const overlay = surf.overlay || layer2
      push('--dsw-alias-bg-layer-1', layer1, fogAlpha)
      push('--dsw-alias-bg-layer-2', layer2, fogAlpha)
      push('--dsw-alias-bg-layer-3', layer3, fogAlpha)
      push('--dsw-alias-bg-overlay', overlay, fogAlpha)

      /* ④ 浮层专名：菜单/提示/选择器/气泡/输入框 —— 同为浮层档。
       *    （旧注释说"用 fog 比 alpha 高"：在差值体系里成立 ——
       *    浮层**合成**目标确实比列高 0.10，只是本层涂的是差值。） */
      const bubble = surf.bubble || layer1
      const hover = surf.hover || layer1
      push('--dsw-specific-bubble', bubble, fogAlpha)
      push('--dsw-specific-menu', overlay, fogAlpha)
      push('--dsw-specific-tip', overlay, fogAlpha)
      push('--dsw-specific-selector', hover, fogAlpha)
      /* 输入框令牌回到半透明：挡字靠上层的强模糊，不靠涂死。 */
      push('--dsw-specific-input-major', layer1, fogAlpha)
      push('--dsw-alias-tooltip-bg', overlay, fogAlpha)

      /* ⑤ 其它背景令牌：一起半透明，否则个别组件仍是实心板。
       *    骨架/占位走各自的弱档差值（合成目标低于浮层）。 */
      /* 骨架/占位：差值体系里"合成目标低于列"数学上做不到（涂不出比
         下层更透的层），它们的视觉弱化本来就靠**颜色差**（layer1 比 base
         浅）而不是浓度差 —— 所以同用浮层档，别再叠独立弱档。 */
      /* ⑤ 其它背景令牌：一起半透明，否则个别组件仍是实心板。
       * （document-preview 不在这里 —— 它走 ⑪ 的"近实色"特例。） */
      push('--dsw-alias-bg-module-platform', layer1, fogAlpha)
      push('--dsw-alias-bg-multi-select', layer1, fogAlpha)
      push('--dsw-alias-bg-skeleton', layer1, fogAlpha)
      push('--dsw-alias-markdown-placeholder', layer2, fogAlpha)
      push('--dsw-alias-markdown-tag', layer2, fogAlpha)

      /* ⑥ 代码块：**代码块档**（合成目标 α+0.14，比卡片实一点读得清，
       *    又不至于把壁纸信号连乘吃掉）。 */
      const code = surf.code || layer2
      const solidTarget = Math.min(1, layerAlpha + GLASS_TIER.code)
      push('--dsw-alias-markdown-code-block', code, solidAlpha)
      /* 横幅：列上的第 2 层，合成目标 = 代码块档 + banner 增量。 */
      push('--dsw-alias-markdown-code-block-banner', code,
        glassDeltaAlpha(layerAlpha, Math.min(1, solidTarget + GLASS_TIER.banner)))
      /* ⚠️ 关键：Shiki 把 --shiki-background 写在 <pre> 的**内联样式**上，
       * 内联样式优先级高于任何 CSS 规则。
       * 只改 --dsw-alias-markdown-code-block 不够 —— Shiki 读的是
       * --shiki-background，它还是实色（#2E363F），所以代码块永远是不透明的。
       * 必须把它也改成半透明。 */
      push('--shiki-background', code, solidAlpha)

      /* ⑦ 代码块背景（我们自己注入的 token）。同样走预补偿（与 push 同式）。 */
      out.push('--dmt-md-code-bg:' + hexToRgba(
        glassSurfaceColor(columnColor, code, alpha, glassComposite(alpha, solidAlpha)), solidAlpha) + ' !important')
      /* ⑦b 行内代码底色（宿主真源，2026-10-22 堵漏）。
       * 宿主规则 `_markdown :not(pre)>code{background-color:var(--dsw-alias-markdown-inline-code)}`
       * 特异性 (0,2,1)，压过我们细节表的 `code{background:var(--dmt-md-code-bg)}` (0,1,1) ——
       * 行内代码实际吃的是**这个**令牌，而它的原值（resolveTokens 写成 bubble 实色）
       * 不在玻璃表里 → 玻璃开着行内代码仍是实色片。必须一起压成 rgba。
       * 浓度用 fogAlpha：行内代码只有几十 px 高，字比代码块小，透一点没关系。 */
      push('--dsw-alias-markdown-inline-code', surf.bubble || layer1, fogAlpha)

      /* ⑧ 交互态：hover / active 也要半透明，否则鼠标一上去就变实心块。
       *    它们是**浮层之上的第 3 层**（hover 铺在卡片上）—— 差值基准
       *    是浮层合成 floatTarget，不是列 α；增量小、瞬态。 */
      push('--dsw-alias-interactive-bg-hover', hover, hoverAlpha)
      push('--dsw-alias-interactive-bg-active', hover, activeAlpha)
      push('--dsw-alias-button-tool-bar-fill', layer1, fogAlpha)

      /* ⑨ 卡片填充：四个卡片组件用各自的令牌。
       * ⚠️ 真机修正（2026-10-22「卡片不受浓度影响」）：宿主把这四个变量
       * 声明在**卡片元素自己**的类上（`.kuvljq_card{--changes-fill:…}`，
       * 计划/排程卡甚至同一类声明+消费）。自定义属性**不会从 body 继承过
       * 元素的本地声明** —— 这里写在 body 的 !important 对卡片元素完全无效。
       * 真正的覆盖在 buildGlassSheet 末尾按 detectCardTargets 的检测结果
       * 逐元素写（见「卡片填充变量：写在声明元素上」一节）。body 级声明
       * 保留：它仍覆盖那些"消费但不声明"的元素（如未来新组件）。 */
      push('--changes-fill', layer2, fogAlpha)
      push('--deliverable-fill', layer2, fogAlpha)
      push('--plan-card-fill', layer2, fogAlpha)
      push('--card-fill', layer2, fogAlpha)
      /* 另外三种卡片/表面令牌（扫 app.asar 找到的，之前漏了）：
       *   settings-card-fill → agent-preset 的「智能体预设」卡片
       *   onboarding-card-fill → settings-account 的引导卡
       *   menu-surface-fill → ui-theme 的菜单表面
       * 不补它们，这几处会保持宿主不透明底，看起来是「一块没处理的板」。 */
      push('--dsw-alias-settings-card-fill', layer2, fogAlpha)
      push('--dsw-alias-onboarding-card-fill', layer2, fogAlpha)
      push('--dsw-menu-surface-fill', overlay, fogAlpha)

      /* ⑩（②#3 对齐参考插件）关掉宿主菜单/面板材质层自带的 blur(40px)。
       * 宿主原话：`--dsw-menu-backdrop-filter:blur(40px) saturate(150%)`，
       * 被 CVUQCW_panel / v1kfCW_panel::before / _material_ri079 等消费 ——
       * 我们给 [role=dialog/menu] 已经加了自己的 backdrop-filter，
       * 两层糊同一个 backdrop = 双重模糊，观感发闷（参考插件同样处理）。
       * 浮层的雾面由我们的 frostedFilter 统一负责。 */
      out.push('--dsw-menu-backdrop-filter:none !important')

      /* ⑪（②#5 对齐参考插件）文件预览卡保持**近实色**。
       * 预览区是"读小字"的地方（PDF/文本正文），用户口径：压在糊掉的
       * 壁纸上读不清。参考插件直接给实色面板底 —— 我们保留一点玻璃感，
       * 合成目标拉到 0.92（差值涂），比代码块档还实。 */
      push('--dsw-alias-bg-document-preview', layer1,
        glassDeltaAlpha(alpha, Math.min(1, alpha + 0.24)))

      return out
    }

    /**
     * 深色玻璃模式下把文字提亮。
     *
     * 理由：Mariana 的正文是 #D8DEE9（浅灰白），压在「深色玻璃 + 壁纸」上
     * 对比度会掉。参考实现实测过：深色主题下必须把 label 三档改成白/浅灰系，
     * 并把底层静态色 bluish-200/300/400/600/700 一起提亮 ——
     * 因为很多组件的 label 是引用这些静态色的，只改 label-* 会漏。
     *
     * ⚠️ 刻意**不动** bluish-00/50/1000：
     * 它们同时被背景与品牌色引用，改白会把品牌色也弄坏。
     *
     * @returns {string[]} 令牌声明数组。
     */
    function glassTextDecls() {
      return [
        '--dsw-alias-label-primary:rgb(255, 255, 255) !important',
        '--dsw-alias-label-secondary:rgb(240, 243, 247) !important',
        '--dsw-alias-label-tertiary:rgb(232, 236, 242) !important',
        '--dsw-alias-label-caption:rgb(228, 232, 238) !important',
        '--dsw-alias-label-dimmed:rgb(214, 219, 226) !important',
        '--dsw-alias-label-document-preview:rgb(228, 232, 238) !important',
        '--dsw-static-neutral-bluish-200:rgb(242, 245, 249) !important',
        '--dsw-static-neutral-bluish-300:rgb(236, 240, 245) !important',
        '--dsw-static-neutral-bluish-400:rgb(228, 232, 238) !important',
        '--dsw-static-neutral-bluish-600:rgb(228, 232, 238) !important',
        '--dsw-static-neutral-bluish-700:rgb(240, 243, 247) !important',
      ]
    }

    /**
     * 生成玻璃样式表。
     *
     * 全部规则都要求 `html[data-dsh-glass]`，所以关掉开关时它们一律不命中。
     *
     * @param {object} state - 已生效设置。
     * @param {object} surfaces - 当前深浅对应的表面色。
     * @param {boolean} isDark - 深色模式。
     * @returns {string} CSS 文本；功能关闭时为空串。
     */
    function buildGlassSheet(state, surfaces, isDark, cardTargetsForSheet) {
      const s = state || {}
      if (s.glass !== 'on') return ''
      const surf = surfaces || {}
      /* 代码色（pre 的 !important 底色与令牌层同源：code → layer2 → base）。 */
      const codeSurface = surf.code || surf.layer2 || surf.base || '#2E363F'
      const alpha = parsePercent(s.glassTint, 0, 100, 65) / 100
      const blur = parsePercent(s.glassBlur, 0, 40, 16)
      const g = 'html[' + GLASS_ATTR + '] '
      const lines = ['/* dsh-colorlab —— 玻璃界面 */']

      /* ══ 为什么模糊不放在面板上 ══════════════════════════════════════
       *
       * 上一版给三列各加 backdrop-filter，结果是「只有中栏糊了，侧栏和右栏
       * 还是实的」。原因：侧栏/右栏内部还有自己的不透明背景层，
       * 外层糊了、里层照样实色。
       *
       * 一个页面有多少层背景根本数不完，逐个加注定漏。
       * 所以模糊**只做一次，做在背景层自己身上** —— 背景层被 filter 糊过
       * 之后，就成了「已经模糊的底图」，无论上面叠多少层、什么颜色，
       * 透出来的都是同一张糊好的底。这是结构上的解法，不靠枚举选择器。
       */

      /* ① 容器清透明，让模糊后的背景透上来。 */
      lines.push('html[' + GLASS_ATTR + '],'
        + g + 'body{background:transparent !important;background-image:none !important}')
      lines.push(g + '#root{position:relative !important;z-index:1 !important;'
        + 'background:transparent !important}')

      /* ② 窗口框架与标题栏拖动区：被涂了侧栏色，必须清透明。 */
      lines.push(g + '[class*="_frame"]{background:transparent !important;'
        + 'background-image:none !important}')
      /* 🔴 回归记录（2026-10-22，「只有标题栏会变」事故的根因）：
       * 上一轮 ❼ 我一度撤掉这条 transparent、改成给 frame 整块铺
       * rgba(sidebar, α)（理由：宿主 [data-windows-titlebar] .BynINW_frame
       * 的 padding 区用侧栏色垫底，令牌透明后"没人补"）。真机三个症状全来自它：
       *   · frame 是**三列的父容器** —— 整窗先铺一层 0.78 的板，
       *     列再叠 0.78 → 合成 0.95，壁纸信号 22%→5%，浓度滑块失效
       *     （只有 ::before 顶部条是单层、还在跟着变 —— 正是用户看到的）；
       *   · 侧栏色透过中栏的半透明底渗出来 → 左栏与正栏颜色被统一；
       *   · 我顺手把顶部条改成单色侧栏色 → 两个独立颜色槽位的区分也没了。
       * 教训：**父容器一律透明，颜色只在各列自己那层涂**（单层铁律的完整版），
       * 任何"补色"都不许落在跨列容器上。frame 的 padding 区不需要补 ——
       * 顶部条（::before）本来就盖住那 40px。 */
      /* ══ 标题栏：让原生覆盖层透明，页面内的拖动区做玻璃 ══════════
       *
       * 顶部那 40px 是**两层**叠出来的：
       *
       *   1. Electron 的 titleBarOverlay（原生覆盖层）—— 颜色由
       *      preload 的隐藏探针读取 → IPC → setTitleBarOverlay 决定。
       *      只要它的 color 不透明，它就会把下面全部盖住，
       *      所以页面里怎么改都看不出变化。
       *      → 探针必须送 rgba(0,0,0,0)，让覆盖层完全透明。
       *
       *   2. .BynINW_frame::before（页面内伪元素，全宽 40px 的拖动区）——
       *      这个在页面里，**可以加 backdrop-filter**。
       *      preload 插的 Shadow DOM 菜单栏（应用/编辑按钮）本身无背景，
       *      就浮在它上面。
       *
       * 所以：覆盖层透明 + 拖动区玻璃 = 顶部和主体一样的玻璃效果。
       */
      /* ══ 顶部 40px（标题栏拖动区）：双色渐变 @ 与主体同一浓度 ══════
       *
       * 侧栏与正栏是**两个独立颜色槽位**（surface.sidebar / surface.base），
       * 顶部条横跨两者 → 必须渐变跟随。上一轮我把它改成单色侧栏色，
       * 把两个槽位的区分抹掉了（用户报"左栏被统一到正栏"的一部分），已撤回。
       * 保留的唯一改进：接缝不写死 21%，改用宿主挂在 frame 内联上的
       * 真实侧栏宽 —— 渲染代码 `"--dsh-windows-sidebar-width": cols.sidebar+"px"`
       * （仅 Windows 标题栏模式存在，缺省回落 280px），侧栏拖动变宽自动跟上。
       *
       * ⚠️ 上色**只给 ::before**；frame 容器保持 transparent（见上方 ② 的
       * 回归记录：给父容器铺色 = 壁纸信号被吃掉 + 侧栏色渗进中栏）。
       * ::before 是 absolute;inset:0 0 auto 的 40px 条，本来就盖住 frame 的
       * padding 区，不需要 frame 垫色。 */
      const stripSide = hexToRgba(surf.sidebar || surf.layer1 || surf.base, alpha)
      const stripMain = hexToRgba(surf.base || surf.layer1, alpha)
      const seam = 'var(--dsh-windows-sidebar-width, 280px)'
      lines.push(g + '[class*="_frame"]::before{'
        + 'background:linear-gradient(to right,' + stripSide + ' 0,'
        + stripSide + ' calc(' + seam + ' - 1px),'
        + stripMain + ' calc(' + seam + ' + 1px),' + stripMain + ' 100%) !important;'
        + 'backdrop-filter:blur(' + blur + 'px) saturate(120%) !important;'
        + '-webkit-backdrop-filter:blur(' + blur + 'px) saturate(120%) !important}')

      /* ③ 三列：**带 alpha 的主题色**，这是 Mariana 保住的地方。
       *
       * 这不是「透明」，而是「主题色半透明」——
       * 不同于上一版给 10%（等于把主题色丢掉），
       * 这里默认 65%，深色 Mariana 仍是主调，壁纸只透出明暗与色相变化。
       *
       * ⚠️ 三列**不加** backdrop-filter：模糊已由背景层完成，
       * 这里再加一次只会重复计算，还会引入包含块副作用。 */
      const sidebarColor = surf.sidebar || surf.layer1 || surf.base
      const centerColor = surf.base || surf.layer1
      if (sidebarColor) {
        lines.push(g + '[class*="_sidebarCol"]{'
          + 'background:' + hexToRgba(sidebarColor, alpha) + ' !important;'
          + 'border-right:.5px solid ' + hexToRgba(isDark ? '#FFFFFF' : '#0F1115', 0.06) + ' !important}')
      }
      if (centerColor) {
        lines.push(g + '[class*="_centerCol"],' + g + '[class*="_rightbarCol"]{'
          + 'background:' + hexToRgba(centerColor, alpha) + ' !important}')
      }
      /* 🔧 清掉中栏左上角的圆角（恢复原设计 —— 上一轮擅自"交还宿主"，撤回）。
       *
       * 宿主 CSS（Windows 分支）：
       *   .BynINW_centerCol { border-radius: var(--dsh-windows-content-radius) 0 0 0;
       *                       corner-shape: round }
       * 那是给标题栏让位的设计 —— 圆角处会露出底色。玻璃下 frame 是透明的，
       * 弧内露出的直接是壁纸/背景层，看起来就是「分割线有个圆角」的破洞；
       * 原设计的判断（清成直角）在玻璃模式下是对的，保留。
       * ⚠️ 这条与 ::before 的渐变缝配套：frame 透明 + 中栏直角 →
       * 顶部条与主体在列边界处左右相接、上下无缝。 */
      lines.push(g + '[class*="_centerCol"]{'
        + 'border-radius:0 !important;corner-shape:round !important}')

      /* 🔧 正文不会溢出到输入栏 / 设置面板 —— 用层叠上下文而不是涂色。
       *
       * 症状（实测）：
       *   · 输入框里能透出正文，而且那块颜色不跟「表面浓度」走；
       *   · 设置面板比正文高一级，也透出正文。
       *
       * 根因：我把 scrollBody / Dc7zOa_root / xz4KEq_root 清成 transparent，
       * 但没给它们建立**层叠上下文**。缺了它，容器内的文本会与上方的浮层
       * 参与同一套绘制顺序，于是「文字叠到输入框/面板上」。
       *
       * 解法：给滚动容器 isolation:isolate 建立独立层叠上下文 ——
       * 内部内容再怎么滚也不会绘制到容器外，同时不涂色、不挡玻璃。
       *
       * ⚠️ 不用 backdrop-filter / transform 来建上下文：
       * 它们会创建包含块，让容器内的 fixed 子元素位移（参考实现踩过）。 */
      lines.push(g + '[class*="xz4KEq_scroll"],'
        + g + '[class*="Dc7zOa_root"]{isolation:isolate !important}')

      /* ══ 浮层与输入栏：靠「模糊」挡住背后的文字，不靠涂死 ══════════
       *
       * 走过的弯路，都记在这里：
       *
       *   ① 半透明 → 正文直接透出来，能读字（用户报的问题）
       *   ② 改不透明实底 → 一整条死板色块，和周围玻璃对不上，很丑（用户报的问题）
       *
       * 两次都错，因为都只在「透 vs 不透」这一根轴上选。
       *
       * 正确的轴是**背后那几行字能不能读清**：
       *   给浮层开 backdrop-filter 并调大 —— 背后的正文被糊成光影，
       *   不再可读，但底依然是半透明的，和周围玻璃是同一套。
       *
       * 这才是毛玻璃该有的行为：玻璃后面有东西、但看不清。
       * （这也是参考实现最核心的一句：模糊是给"背后的内容"用的。）
       *
       * ⚠️ 半径要比其它玻璃**大 10px**：要压住的是文字（高频细节），
       * 普通 16px 不足以让它不可读。 */
      /* ══ 白雾浓度 ══════════════════════════════════════════════════
       *
       * 磨砂的「厚度感」来自这层极淡的白，**不是来自模糊**。
       * 模糊只能让背后的东西变糊，不会让表面显得有材质。
       *
       * 上游实测（同一位置只改这一个值）：
       *   白雾  0% → 边缘能量 0.23
       *   白雾 10% → 边缘能量 0.61
       *   白雾 28% → 边缘能量 1.03   ← 糊掉的细节被白雾重新填平
       *   白雾 50% → 边缘能量 1.37
       * 所以默认 8%（滑块可调 0–100）。
       */
      const haze = parsePercent(s.glassHaze, 0, 100, 8) / 100

      /* 白雾层：顶部稍亮、向下渐隐 —— 模拟"光从上方来"的板子。
       * 用 background-image 而不是 background-color，这样**不覆盖**
       * 底层那个半透明主题色。 */
      const hazeLayer = haze > 0
        ? 'linear-gradient(to bottom,'
          + 'rgba(255, 255, 255, ' + (haze).toFixed(3) + ') 0%,'
          + 'rgba(255, 255, 255, ' + (haze * 0.35).toFixed(3) + ') 40%,'
          + 'rgba(255, 255, 255, 0) 100%)'
        : 'none'

      /* ══ 玻璃的「边缘三件套」══════════════════════════════════════
       *
       * 照抄上游 dsh-acrylic-light 的 box-shadow 四层写法：
       *   ① inset 0 1px 0      上缘高光（光打在板子上沿）
       *   ② inset 0 -1px 0     下缘微光（厚度暗示）
       *   ③ inset 0 0 0 .5px   发丝内描边（交代"这里有一块板"的边界）
       *   ④ 0 10px 32px -10px  外投影（把它从背景里抬起来）
       *
       * 静置与聚焦的层数必须一致，浏览器才能逐层插值 —— 否则聚焦是"跳变"。 */
      const edgeLight = isDark ? '255, 255, 255' : '15, 17, 21'
      const glassShadow = [
        'inset 0 1px 0 rgba(' + edgeLight + ', 0.16)',
        'inset 0 -1px 0 rgba(' + edgeLight + ', 0.06)',
        'inset 0 0 0 0.5px rgba(' + edgeLight + ', 0.08)',
        '0 10px 32px -10px rgba(0, 0, 0, 0.18)',
      ].join(',')

      /* 白雾 + 阴影 + 描边，合成一段可复用的声明串（给浮层/卡片用）。
       * 🔧 ：末层补一圈**透明**的 3px 外环占位 —— 输入卡聚焦态会把它
       * 点亮成淡蓝环；层数一致浏览器才能逐层插值（参考插件实测：
       * 层数不一致时聚焦是"跳变"而不是"渐显"）。多一层透明阴影零成本。 */
      const glassShadow5 = glassShadow + ',0 0 0 3px rgba(120, 150, 255, 0)'
      const glassSurface = 'background-image:' + hazeLayer + ' !important;'
        + 'box-shadow:' + glassShadow5 + ' !important;'
        + 'border:0.5px solid rgba(' + edgeLight + ', 0.10) !important'

      const frosted = Math.min(40, blur + 10)
      const frostedFilter = 'backdrop-filter:blur(' + frosted + 'px) saturate(120%) !important;'
        + '-webkit-backdrop-filter:blur(' + frosted + 'px) saturate(120%) !important;'

      /* 对话框 / 菜单 / 列表：半透明 + 强模糊。
       * 🔧 差值 + 预补偿：它们浮在内容区之上（内容区合成 ≈ α），
       * 本层涂浮层档差值（再多 +0.02 的菜单可读性补偿），
       * 颜色预补偿穿过列的 base 稀释还原成 overlay 色。
       * 🔧 2026-10-22：fog 不再硬编码 0 —— 用户报"浮层浓度调了没反应"，
       * 其中一条原因就是菜单/对话框无视 fog 滑块。 */
      const overlayColor = surf.overlay || surf.layer2 || surf.base
      if (overlayColor) {
        const menuFog = Math.max(0, Math.min(1, parsePercent(s.glassFog, 0, 40, 16) / 40))
        const menuAlpha = glassDeltaAlpha(alpha, Math.min(1, glassFloatTarget(alpha, menuFog) + 0.02))
        lines.push(g + '[role="dialog"],'
          + g + '[role="menu"],'
          + g + '[role="listbox"],'
          + g + '[data-radix-popper-content-wrapper] > *{'
          + 'background-color:' + hexToRgba(
            glassSurfaceColor(surf.base || overlayColor, overlayColor, alpha, glassComposite(alpha, menuAlpha)),
            menuAlpha) + ' !important;'
          + glassSurface + ';'
          + frostedFilter
          + 'isolation:isolate !important}')
      }

      /* ══ 输入区由**两部分**组成，必须分开处理 ══════════════════════
       *
       * 用户指出的结构（这是关键，我之前一直当成一个东西）：
       *
       *   ┌─────────────────────────────────────────┐
       *   │ composerSeat（座，卡片周边那一圈）        │ ← 和背景同色
       *   │   ┌─────────────────────────────────┐   │   比正文高一层
       *   │   │ composerCard（输入卡片本体）     │   │   用来"覆盖正文"
       *   │   │  ┌───────────────────────────┐  │   │
       *   │   │  │ RlGAzG_input（文本框）    │  │   │
       *   │   │  └───────────────────────────┘  │   │
       *   │   └─────────────────────────────────┘   │
       *   └─────────────────────────────────────────┘
       *
       * 上一版把**座**也涂成 rgba(0.65)，于是那一圈变成了"蓝白色半透明片" ——
       * 用户看到的正是它。
       *
       * 正确做法：
       *   · 座 → **完全透明**，让玻璃背景直接透上来（它只需要"覆盖正文"，
       *          而这个覆盖由卡片本身承担）；同时保留强模糊糊掉背后正文。
       *   · 卡片 → 半透明玻璃（和周围一致），它才是"输入框"的那块板。
       */
      const seatColor = surf.base || (isDark ? '#343D46' : '#FFFFFF')
      /* 🔧 ④（2026-10-22，对齐 dsh-acrylic-light）：输入区从「强模糊挡字」
       * 换成「硬裁」—— JS 把 seat 抬成滚动容器的 flex 兄弟（见 syncSeatLift），
       * 聊天内容滚到底就硬断在输入卡上沿，**背后根本没有文字**，
       * 所以这里不再需要 frostedFilter。seat 保持透明 + flex:none
       * （被参考插件实测：absolute 会脱离 flex 流导致裁切失效）。 */
      lines.push(g + '[class*="Dc7zOa_composerSeat"],'
        + g + '[data-composer-seat]{'
        + 'background:transparent !important;'
        + 'background-image:none !important;'
        + 'flex:none !important;'
        + 'isolation:isolate !important}')
      /* 裁切的布局前提：content 容器 relative、seat 是它的直接 flex 子。
       * （liftSeat 把 seat 插到 scrollBody 之后，flex column 自动把
       *  scrollBody 压缩到 seat 上沿 —— 真正的硬裁。） */
      lines.push(g + '[data-conversation-content]{position:relative !important}')

      /* 🔧 2026-10-22（借鉴 dsh-theme-endfield 的 glass.md）：这里曾有一条
       * surfaceFilter（给代码块/卡片/输入卡统一加 backdrop-filter），已删。
       * 理由：① 我们的模糊只做一次、做在壁纸层 —— 这些表面背后本来就是
       * 糊好的图，再糊一遍纯浪费 GPU；② backdrop-filter 会让元素成为
       * fixed 后代的包含块，上游实测因此踩了"tooltip 坐标错乱 +
       * ResizeObserver 抖动"。"半透明但不会糊"的旧症状真正的解法是
       * 壁纸层预模糊 + 白雾三件套，不是给每块板各加一层 filter。
       * 保留 backdrop-filter 的只有：对话框/菜单（背后是活文字，糊它是
       * 功能本身）与标题栏拖动区（背后可能是正文）。 */

      /* ══ 代码块与行间代码：它们**自己带实色底**，必须先打掉 ══════════
       *
       * 实测 DOM（Console 探针，2026-10-22）：
       *
       *   代码块：
       *     div[data-code-wrap].md-code-block  bg=rgba(46,54,63,0.85) bf=blur(16px)
       *       div[data-code-block-content]      bg=transparent
       *         pre._plain_7gxqk_103            bg=rgba(46,54,63,0.85)  ← 元凶
       *
       *   行间代码：
       *     code  bg=rgba(46,54,63,0.85)  ← 元凶（它自己就是那层实色）
       *
       * 也就是说：我给外层加了模糊，但 **pre / code 自己铺着 0.85 的实色**，
       * 玻璃全被它们盖住了 —— 这就是「代码块和行间代码没有毛玻璃」的真正原因。
       *
       * 修法：把 pre / code 自己的底色**降到和玻璃同一浓度**，
       * 它们才能透出后面的模糊背景。浓度用 alpha，和其它表面一致。
       */
      /* 每个选择器都必须带总闸前缀，否则关掉玻璃后仍会生效。 */
      /* ⚠️ 不能只用 data-code-wrap —— 那是「自动换行」开关的标记，
       * 正文代码块默认**不带**它（实测渲染代码：只有开启换行时才赋这个属性）。
       *
       * 稳定的选择器（从 app.asar 的渲染代码里读出来的）：
       *   .md-code-block            字面类名，宿主直接写在 className 里
       *   [data-code-block-banner]  顶部横带
       *   [data-code-preview]       侧栏文档预览里的代码块
       *   [data-code-block-content] 内容区（侧栏）
       * 另外保留 data-code-wrap 作为补充（换行开启时也会命中，不冲突）。 */
      /* 🔧 2026-10-22（借鉴 dsh-theme-endfield 的 glass.md 教训）：**不加**
       * backdrop-filter。我们的模糊只做一次、做在壁纸层上 —— 代码块背后的
       * 东西本来就是糊好的图，再糊一遍是对已模糊像素的纯浪费（GPU），
       * 而且 backdrop-filter 会让元素成为 fixed 后代的包含块（上游实测：
       * 输入卡加模糊后，fixed 定位的 tooltip 坐标解析错乱 + ResizeObserver
       * 循环重测 → 布局抖动）。白雾/描边/阴影三件套留下，那才是"材质感"。 */
      lines.push(
        g + '.md-code-block,'
        + g + '[data-code-wrap],'
        + g + '[data-code-block-content],'
        + g + '[data-code-block-banner],'
        + g + '[data-code-preview]{'
        + glassSurface + '}')
      /* ══ pre 与 pre code 的底色：半透明代码色（2026-10-22 重写）════
       *
       * 旧版把 `pre / pre code / p code / li code / td code` 一律清成
       * transparent !important，依据是探针里 pre 铺着 rgba(46,54,63,0.85) 的
       * 「宿主实色」。**逐条查宿主 CSS 后确认那是误判**：宿主没有给 pre 铺
       * 这个色的规则 —— 0.85 来自旧浓度公式把代码块浓度夹到上限，经
       * `--shiki-background`（Shiki 写在 pre 的内联样式）生效。
       *
       * 一刀切清底的真实代价（用户报）：正文代码块**和预览代码块**都失去
       * 底色，代码直接坐在列底色上 —— 比"不够玻璃"更糟的观感问题。
       *
       * 现在的分工：
       *   · `pre` 铺半透明代码色，与令牌层共用 glassSolidAlpha 公式
       *     （!important 压过宿主规则与 Shiki 内联 var 两条路径）；
       *   · `pre code` 清透明 —— 块内不再叠第二层底；
       *   · 行间 code **不再被碰**：它的两条底色来源（宿主
       *     `_markdown :not(pre)>code` 的 --dsw-alias-markdown-inline-code、
       *     细节表的 --dmt-md-code-bg）都在令牌层压成 rgba，淡底保留且变透。 */
       /* ⚠️ 不能写 code:not(pre code) —— Selectors 3 的 :not() 只接受
        * 简单选择器，不接受后代选择器。写了整条规则会被浏览器丢弃。
        * 拆成独立规则：pre、pre code（行间 code 完全不碰，见上）。 */
      lines.push(g + 'pre{'
        + 'background-color:' + hexToRgba(
          glassSurfaceColor(centerColor, codeSurface, alpha, glassComposite(alpha, glassSolidAlpha(alpha))),
          glassSolidAlpha(alpha)) + ' !important}')
      /* pre 里的 code 不再自铺一层（底色由 pre 承担，否则叠两次）。 */
      lines.push(g + 'pre code{'
        + 'background:transparent !important;'
        + 'background-color:transparent !important;'
        + 'background-image:none !important}')
      /* 行间 code：**不清底**（2026-10-22 修正）。旧版把 p/li/td code 一并
       * 清成 transparent !important，真机症状 = 正文与预览里的行内代码淡底消失。
       * 它的底色两条来源 —— 宿主 `_markdown :not(pre)>code` 的
       * var(--dsw-alias-markdown-inline-code)、插件 markdown 细节表的
       * var(--dmt-md-code-bg) —— 两个变量都在令牌层压成 rgba，淡底自然变透。 */

      /* 卡片（四类）与气泡：它们都在玻璃之上，也该有玻璃质感。 */
      /* 卡片选择器。
       *
       * 已知四种文件/计划类卡片的类名（哈希前缀）来自 CARD_TARGETS 的检测；
       * 这里再补两类**真实类名**（从 app.asar 的 CSS Module 映射读出）：
       *   KZf9OG_card  agent-preset 的「智能体预设」卡片
       *   j_8BDW_card  approval 的审批卡
       * 用 [class*="_card"] 收尾能覆盖它们，但会误命中输入卡片
       * （RlGAzG_card 单独处理过，加 :not() 排除）。 */
      /* 每个选择器都必须单独带总闸前缀。
       * 之前用 join(',') 拼成一个串，只有第一个带前缀 ——
       * 结果关掉玻璃后其余六个仍然生效（残留污染）。 */
      const cardSelectors = [
        'kuvljq_card',
        'flL80G_file',
        'KuQXFq_card',
        'QSKnSa_card',
        'KZf9OG_card',
        'j_8BDW_card',
        'bubble',
      ].map((name) => g + '[class*="' + name + '"]').join(',')
      /* 🔧 同代码块：卡片不加 backdrop-filter（背后是已糊的壁纸层，再糊
       * 是浪费；且上游实测 filter 的包含块副作用）。三件套照给。 */
      lines.push(cardSelectors + '{' + glassSurface + '}')

      /* 输入栏卡片与 dock 跟随座的颜色，不再单独涂死。 */
      /* ══ 输入区：玻璃放在**卡片**上，不是放在整条底栏上 ═══════════════
       *
       * 实测 DOM（Console 探针，2026-10-22）：
       *   div.RlGAzG_root    995x129 @(280,693)  ← 整条底栏！
       *     div.RlGAzG_card  858x98  @(348,693)  ← 真正的输入卡片
       *       div.RlGAzG_scroll {data-input-scroll}
       *         div.RlGAzG_grow
       *           div.RlGAzG_input {data-composer-input}
       *
       * 上一版把玻璃铺在 **root** 上 —— 那是一条 995px 宽、129px 高的整幅底栏，
       * 于是用户看到「输入框旁边一坨蓝色」。
       *
       * 正确做法：root 完全透明，玻璃只给 card（858x98 那个方框）。
       * 这样玻璃的形状就是输入框的形状。
       */

      /* 整条底栏（root / stack）：透明，不要底色也不要模糊。
       * ⚠️ 曾把 [data-composer-seat] 也列在这里（backdrop-filter:none），
       * 而座**就是** .Dc7zOa_composerSeat —— 宿主渲染时两个都给
       * （`className: composerSeat, "data-composer-seat": ""` 同一元素）。
       * 后插入的同特异性规则赢，于是上面那条「透明 + 强模糊」被这条撤掉，
       * 座变纯透明 → 正文穿过输入区照样可读（真机 bug）。座只在上面单独处理。 */
      lines.push(g + '[class*="RlGAzG_root"],'
        + g + '[class*="Dc7zOa_composerStack"]{'
        + 'background:transparent !important;'
        + 'background-color:transparent !important;'
        + 'background-image:none !important;'
        + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important}')

      /* 输入卡片：玻璃铺在这里（形状=输入框）。
       * 🔧 差值档 + 颜色预补偿（2026-10-22 二修）：
       *   · 浓度：输入卡是列上的第 2 层，涂浮层差值（旧版直涂 α 连乘成实心）；
       *   · 颜色：旧版拿 surf.base 当基色 → 合成后必然 = 正文背景色（用户报）。
       *     输入卡的语义色是 input-major 令牌（宿主给它的中性底），Mariana 里
        *     对应 bubble/hover 族（比 base 亮一档的"可输入面"）。
        * 🔧 硬裁后输入卡不再需要任何 backdrop-filter（背后已无文字可糊，
        *    更下面是已糊的壁纸层）—— 见下方 2026-10-22 的包含块教训。 */
      const inputColor = surf.bubble || surf.hover || surf.layer1 || surf.base
      const inputFogRatio = Math.max(0, Math.min(1, parsePercent(s.glassFog, 0, 40, 16) / 40))
      const inputAlpha = glassFloatAlpha(alpha, inputFogRatio)
      /* 🔧 2026-10-22（dsh-theme-endfield 的 glass.md 实测教训，正是这张卡）：
       * **不加 backdrop-filter** —— filter 让卡片成为 fixed 后代的包含块，
       * 上游因此踩了"发送按钮 tooltip 坐标错乱 + ResizeObserver 抖动"。
       * 我们探针查过本宿主 tooltip 走 portal 挂 body（暂时没踩），但卡片
       * 背后本就没有可糊的东西（硬裁后文字断在卡外、更下面是已糊的壁纸），
       * 这层 filter 只剩风险没有收益 —— 删。 */
      lines.push(g + '[class*="RlGAzG_card"]{'
        + 'background-color:' + hexToRgba(
          glassSurfaceColor(seatColor, inputColor, alpha, glassComposite(alpha, inputAlpha)),
          inputAlpha) + ' !important;'
        + glassSurface + ';'
        + 'isolation:isolate !important}')

      /* ══ ②（对齐参考插件）输入卡聚焦态：描边亮一档 + 一圈极淡外环。
       * ⚠️ 阴影层数与静置态必须一致（4 层 + 外环 = 5 层，静置也要 5 层，
       * 最后一层透明）—— 否则浏览器无法逐层插值，聚焦是"跳变"不是"渐显"。 */
      lines.push(g + '[class*="RlGAzG_card"]:focus-within{'
        + 'box-shadow:' + [
          'inset 0 1px 0 rgba(' + edgeLight + ', 0.22)',
          'inset 0 -1px 0 rgba(' + edgeLight + ', 0.08)',
          'inset 0 0 0 0.5px rgba(' + edgeLight + ', 0.14)',
          '0 12px 36px -10px rgba(0, 0, 0, 0.22)',
          '0 0 0 3px rgba(120, 150, 255, 0.12)',
        ].join(',') + ' !important;'
        + 'transition:box-shadow 220ms cubic-bezier(.22,1,.36,1) !important}')
      /* 静置态补第 5 层（透明外环），保证与聚焦态逐层插值。 */
      lines.push(g + '[class*="RlGAzG_card"]{'
        + 'box-shadow:' + [
          'inset 0 1px 0 rgba(' + edgeLight + ', 0.16)',
          'inset 0 -1px 0 rgba(' + edgeLight + ', 0.06)',
          'inset 0 0 0 0.5px rgba(' + edgeLight + ', 0.08)',
          '0 10px 32px -10px rgba(0, 0, 0, 0.18)',
          '0 0 0 3px rgba(120, 150, 255, 0)',
        ].join(',') + ' !important}')

      /* 卡片内层：全透明（否则会在玻璃上再叠一层）。 */
      lines.push(g + '[class*="RlGAzG_input"],'
        + g + '[class*="RlGAzG_grow"],'
        + g + '[class*="RlGAzG_scroll"],'
        + g + '[class*="RlGAzG_dock"],'
        + g + '[class*="RlGAzG_hero"],'
        + g + '[class*="RlGAzG_accessory"],'
        + g + '[class*="RlGAzG_tools"]{'
        + 'background:transparent !important;'
        + 'background-color:transparent !important;'
        + 'background-image:none !important;'
        + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important}')

      /* ④ 主内容区内部容器：清透明，否则会把三列的 alpha 又盖回实色。
       *    ⚠️ **不含 composerSeat** —— 它在上面单独处理了。 */
      lines.push(g + '[class*="Dc7zOa_root"],'
        + g + '[class*="xz4KEq_root"],' + g + '[class*="xz4KEq_frame"],'
        + g + '[class*="xz4KEq_scroll"]{background:transparent !important;'
        + 'background-image:none !important}')

      /* ④b **整窗玻璃的关键**：把「所有表面令牌」也换成半透明。
       *
       * 只改三列时，窗口里所有卡片/代码块/思考块/输入框/菜单/对话框
       * 仍然是**实心的** —— 它们各有自己的不透明底，铺在玻璃上就成了
       * 「一块块不透明的板子浮在透明背景上」，看起来只有中栏是玻璃。
       *
       * 改令牌而不是加 DOM 选择器：令牌是宿主自己声明的位置，
       * 覆盖它不会碰 DOM 结构、不会与哈希类名冲突、宿主所有引用者一起生效。
       * 之前几轮失败的根因之一就是在 DOM 上硬贴选择器 —— 既漏层又容易崩。 */
      const fog = parsePercent(s.glassFog, 0, 40, 16) / 100
      const tokenLines = glassTokenDecls(surf, isDark, alpha, fog)
      if (tokenLines.length > 0) {
        /* 深浅两套都写：DSH 的深色块特异性更高，只写裸 body 会被压过去。 */
        /* ⚠️ 必须以 } 收尾。曾漏掉闭括号：本行起把后面的文字提亮块与压暗层
           整段吞掉（CSS 错误恢复），实测生成区 25 开 23 闭 —— 有括号平衡测试盯着。 */
        lines.push(g + 'body,' + g + 'body[data-ds-dark-theme]{'
          + tokenLines.join(';') + '}')
      }

      /* ④c 深色模式把文字提亮 —— 否则浅灰白文字压在玻璃上会发灰看不清。 */
      if (isDark) {
        const textLines = glassTextDecls()
        lines.push(g + 'body[data-ds-dark-theme]{' + textLines.join(';') + '}')
      }

      /* ⑤ 压暗层（2026-10-22 迁移）：**不再**放 `#root::before`。
       *
       * 作用不变：深色主题的文字是浅灰白，压在亮壁纸上对比度会崩；
       * 压暗层让背景无论壁纸多亮都落在固定暗度上，文字对比度才稳定。
       *
       * 位置变了：旧版放 `#root::before`（fixed、z-index:0），**在修掉
       * 缺失闭括号之前从未真正生效过**（整条被 CSS 错误恢复吞掉）。
       * 一旦生效它就会出大问题：`#root` 被本表设为 z-index:1 = 层叠上下文，
       * 上下文内部的定位伪元素会画在**静态流内容（三列、卡片、文字背景）之上**
       * —— 等于给整页蒙一层 55% 灰纱、连文字一起压暗。
       *
       * 现在合成进背景层 `#dmt-wallpaper` 自身的 background-image（第一层），
       * 物理上位于 `#root` 之外、之下 —— 只压底图、不压内容。
       * 见 glassVeilColor / backdropGradient / paintWallpaperLayer。 */

      /* 🔧 标题栏颜色：只改「探针」，不动侧栏。
       *
       * preload 会插一个隐藏 span 当探针：
       *   const probe = document.createElement('span')
       *   probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
       *     + 'background-color:var(--dsw-specific-sidebar-fill);'
       *     + 'color:var(--dsw-alias-label-primary)'
       * 然后 canvas 归一化它的颜色 → IPC → setTitleBarOverlay({color})。
       *
       * 所以标题栏的颜色**只看探针的计算色**，和侧栏元素无关。
       * 但探针读的是 var()，而那个变量被侧栏共用 ——
       * 直接改变量会像上一版那样把侧栏的玻璃弄坏（alpha 叠加变实心）。
       *
       * 解法：**只覆盖探针自己的 background-color**，用内联样式选择器命中它。
       * 探针的特征是 visibility:hidden + position:fixed，页面上没有第二个
       * 元素同时具备这两条内联样式，所以命中面极小。
       *
       * 给的颜色是带 alpha 的主题侧栏色：透明会让那一栏没有任何底色
       * （Windows 上表现为默认不透明），带 alpha 才能与窗口材质叠加。 */
      /* 原生覆盖层必须**完全透明**，才能露出页面里的玻璃拖动区。
       *
       * 探针走 canvas 归一化：fillStyle 设成 transparent 时，
       * getImageData 读回来是 rgba(0, 0, 0, 0) —— 括号形式，
       * 能通过主进程的 validColor 正则，setTitleBarOverlay 收到全透明色。 */
      const titleColor = 'transparent'
      /* 选择器必须用**内联样式里的变量名**，不能用 visibility:hidden。
       *
       * 浏览器会把 inline style 序列化成 visibility 冒号空格 hidden 的写法，
       * 所以 [style*="visibility:hidden"]（无空格）永远匹配失败 ——
       * 这正是标题栏一直没生效的原因。
       *
       * 探针的独有特征是 style 里带 var(--dsw-specific-sidebar-fill)，
       * 全页面只有它一个元素这样写。 */
      lines.push(g + '[style*="sidebar-fill"]{'
        + 'background-color:' + titleColor + ' !important}')
      /* 🔴 无障碍 @media 块已删除（2026-10-22 事故记录，别再加回来）。
       *
       * 旧版在表尾有一条 `@media (prefers-reduced-transparency: reduce)`，
       * 把三列/输入卡片/代码块钉成 88%~92% 实色。它在 Windows 上的触发
       * 条件是「设置 → 个性化 → 颜色 → 透明效果」关闭（Chromium 把
       * EnableTransparency 注册表值直接映射成这个媒体特性，见 MDN）——
       * 而那个开关多数人是当**性能选项**关的，不是无障碍诉求。
       *
       * 真机事故（用户三连报）：侧栏被统一成正栏色 / 浓度滑块完全失效 /
       * 只有标题栏跟着变。三条全部对上这个块的声明：它给三列写的是**同一个
       * solidBase**（侧栏色被抹掉）、0.88 硬编码盖过 alpha（滑块失效）、
       * 唯独不碰 ::before（只有标题栏活着）。
       * 之前它一直没炸是因为缺失闭括号把整段吞了；修好括号后它第一次
       * 完整生效 —— 潜伏雷被排雷动作引爆。
       *
       * 正确性判断：本表整体只在用户显式打开「玻璃界面」时才挂载，
       * **应用内的显式 opt-in 优先于 OS 层的启发式信号**。前庭敏感的
       * 用户关掉「玻璃界面」即可完全退出透明/模糊，这比媒体查询更直接。
       * 若将来要做无障碍支持，方向是「只去模糊、保留用户选的浓度与
       * 各列自己的颜色」，而不是整窗钉成同一个实色。 */

      /* ══ 卡片填充变量：写在**声明它的元素**上（2026-10-22 真机修正）══
       *
       * 症状（用户报）：「卡片好像不受影响，浓度调到最低也没变化」。
       * 根因（app.asar 实文）：宿主把卡片填充变量声明在**卡片元素自己**的
       * 类上 —— `.kuvljq_card{--changes-fill:var(--dsw-static-neutral-850)}`、
       * `.KuQXFq_card{--plan-card-fill:…}`、`.flL80G_root{--deliverable-fill:…}`。
       * CSS 自定义属性的继承规则：元素有本地声明就**不从 body 继承** ——
       * 玻璃表压在 body 上的 `--changes-fill:rgba(…) !important` 对卡片元素
       * 完全无效（!important 只作用于 body 自己的计算值，传不下去）。
       * 所以卡片永远是宿主实色，浓度/浮层滑块对它零作用。
       *
       * 修法：用 detectCardTargets 检测到的**真实哈希类**逐元素写
       * `.类名{--xx-fill:rgba(…) !important;--xx-hover:rgba(…) !important}`。
       * 特异性 (0,1,0)+!important 压过宿主本地声明；类名来自运行时检测，
       * 宿主重新构建哈希变了也跟上。没检测到的组（懒加载样式表还没进 DOM）
       * 由 syncCardSheet 的重试循环驱动重建 —— 本表每次 applyNow 都会重拼。
       *
       * 顺带解决 ❺：用户挑了「文件卡片颜色」(cardColor) 时，玻璃以它为
       * 基色派生 rgba —— 不再像以前那样被 body 级令牌无声覆盖。 */
      const cardFogRatio = Math.max(0, Math.min(1, fog / 0.4))
      const cardFillA = glassFloatAlpha(alpha, cardFogRatio)
      const cardHoverA = glassDeltaAlpha(alpha, Math.min(1,
        glassFloatTarget(alpha, cardFogRatio) + 0.05))
      const cardBase = HEX_PATTERN.test(String(s.cardColor || ''))
        ? s.cardColor
        : (surf.layer2 || surf.base)
      const cardHoverBase = HEX_PATTERN.test(String(s.cardColor || ''))
        ? lightenHex(s.cardColor, 0.12)
        : (surf.layer3 || surf.layer2 || surf.base)
      /* 预补偿：卡片涂在列（base@α）之上，不补偿合成后全是 base 味。 */
      const cardColumn = surf.base || cardBase
      const cardFillAdj = glassSurfaceColor(cardColumn, cardBase, alpha, glassComposite(alpha, cardFillA))
      const cardHoverAdj = glassSurfaceColor(cardColumn, cardHoverBase, alpha, glassComposite(alpha, cardHoverA))
      const sheetTargets = Array.isArray(cardTargetsForSheet) ? cardTargetsForSheet : []
      for (const target of sheetTargets) {
        if (!target || typeof target.defClass !== 'string' || target.defClass === '') continue
        if (typeof target.varName !== 'string' || target.varName === '') continue
        const hoverVar = typeof target.hoverVar === 'string' && target.hoverVar !== ''
          ? target.hoverVar
          : target.varName + '-hover'
        lines.push(g + '.' + target.defClass + '{'
          + target.varName + ':' + hexToRgba(cardFillAdj, cardFillA) + ' !important;'
          + hoverVar + ':' + hexToRgba(cardHoverAdj, cardHoverA) + ' !important}')
      }

      return lines.join('\n')
    }

    /** 玻璃样式表元素。 */
    let glassEl = null

    /* ══ 输入栏硬裁（④，移植 dsh-acrylic-light 的 liftSeat 方案）══════
     *
     * 原理：宿主结构是 body[data-conversation-content] > scrollBody + seat
     * （seat 本来就在 scrollBody **里面**：children=[Views, composerSeat]）。
     * 把 seat 抬成 scrollBody 的 flex 兄弟后，flex column 自动把 scrollBody
     * 压缩到 seat 上沿 —— 聊天文字滚动时**硬断在输入卡上沿**，不会钻到
     * 输入区背后。这替代了「透明 + 强模糊糊字」方案（用户选定）。
     *
     * ⚠️ 风险与防护（参考插件的实测教训，全部照搬）：
     *   · seat 是 React 托管节点 —— 初次移动必须推迟到首屏稳定（900ms），
     *     否则冷启动 reconciliation 中途搬 DOM → 主面板空白（它真崩过）；
     *   · 移动后 React 可能搬回去 —— MutationObserver 观察 **body**
     *     （不是具体节点：切会话/页面时子树整体重建，挂旧节点的 observer
     *     会永远失联），250ms 防抖回抬；
     *   · 不能给 seat 设 position:absolute —— 会脱离 flex 流，裁切失效；
     *   · 玻璃关闭/卸载时 restoreSeat 搬回去，不留结构改动。
     */
    let seatObserver = null
    let seatLiftTimer = null
    let seatBootGuarded = false
    let seatBootTimer = null

    function liftOneSeat(host) {
      const seat = host.querySelector('[data-conversation-content] [data-composer-seat], [data-composer-seat]')
      const scroll = host.querySelector('[data-conversation-scroll]')
      if (seat === null || scroll === null || scroll === seat) return false
      if (seat.parentElement === host) return true /* 已在正确位置 */
      scroll.insertAdjacentElement('afterend', seat)
      return true
    }

    function liftSeats() {
      if (typeof document === 'undefined') return false
      if (typeof document.querySelectorAll !== 'function') return false
      const hosts = document.querySelectorAll('[data-conversation-content]')
      let touched = false
      for (let i = 0; i < hosts.length; i += 1) {
        try {
          if (liftOneSeat(hosts[i])) touched = true
        } catch { /* 单个会话失败不影响其它 */ }
      }
      return touched
    }

    function scheduleSeatLift() {
      if (seatLiftTimer !== null) return
      seatLiftTimer = setTimeout(() => {
        seatLiftTimer = null
        try { liftSeats() } catch { /* DOM 变动中，下一轮 observer 再来 */ }
      }, 250)
      if (seatLiftTimer && typeof seatLiftTimer.unref === 'function') seatLiftTimer.unref()
    }

    function startSeatObserver() {
      if (seatObserver !== null) return
      if (typeof MutationObserver !== 'function') return
      try {
        seatObserver = new MutationObserver(() => scheduleSeatLift())
        const target = document.body !== undefined && document.body !== null
          ? document.body : document.documentElement
        if (!target) return
        seatObserver.observe(target, { childList: true, subtree: true })
      } catch {
        seatObserver = null
      }
    }

    function restoreSeats() {
      if (typeof document === 'undefined') return
      if (typeof document.querySelectorAll !== 'function') return
      const hosts = document.querySelectorAll('[data-conversation-content]')
      for (let i = 0; i < hosts.length; i += 1) {
        try {
          const scroll = hosts[i].querySelector('[data-conversation-scroll]')
          const seat = hosts[i].querySelector('[data-composer-seat]')
          if (seat !== null && scroll !== null && seat.parentElement !== scroll) {
            scroll.appendChild(seat)
          }
        } catch { /* 结构已变，随它去 */ }
      }
    }

    function stopSeatLift() {
      if (seatObserver !== null) {
        try { seatObserver.disconnect() } catch { /* 已断 */ }
        seatObserver = null
      }
      if (seatLiftTimer !== null) {
        try { clearTimeout(seatLiftTimer) } catch { /* 无 timer */ }
        seatLiftTimer = null
      }
      if (seatBootTimer !== null) {
        try { clearTimeout(seatBootTimer) } catch { /* 无 timer */ }
        seatBootTimer = null
      }
    }

    /** 玻璃开 → 确保裁切在跑；玻璃关 → 撤销结构改动。由 syncGlassSheet 调用。 */
    function syncSeatLift(on) {
      if (typeof document === 'undefined') return
      if (!on) {
        stopSeatLift()
        restoreSeats()
        return
      }
      if (!seatBootGuarded) {
        /* 冷启动保护：首屏 900ms 内不碰 React 的树（参考插件实测：
           初次渲染期间热移动 → 主面板空白）。 */
        seatBootGuarded = true
        seatBootTimer = setTimeout(() => {
          seatBootTimer = null
          try { liftSeats() } catch { /* 下一轮 observer 驱动 */ }
          startSeatObserver()
        }, 900)
        if (seatBootTimer && typeof seatBootTimer.unref === 'function') seatBootTimer.unref()
        return
      }
      startSeatObserver()
      scheduleSeatLift()
    }

    /**
     * 按当前设置维护「玻璃界面」。
     *
     * 顺序：先决定要不要 → 加/摘总闸属性 → 维护背景层 → 挂/卸样式表。
     *
     * 总闸属性放在 `<html>` 上而不是 body：#root、frame 等元素在 body 内，
     * 但只要属性在 html 上，`html[data-dsh-glass] xxx` 就能命中整页；
     * 摘掉它时所有规则同时失效，不留残留。
     */
    function syncGlassSheet() {
      if (typeof document === 'undefined') return
      const on = state.enabled !== 'off' && state.glass === 'on' && shouldApply()
      const custom = parseCustom(state && state.custom)
      const isDark = resolvedScheme() !== 'light'
      const surfaces = withOverrides(SURFACES[state && state.surface] || SURFACES.standard, custom.surface)

      /* 记录当前表面色，供背景层绘制（背景色跟随配色走）。 */
      wallpaperSurfaces = { dark: surfaces, isDark }

      /* 🔧 压暗层颜色**先算好**（在背景层建立/重绘之前）：
       * veil 现在合成进背景层自身的 background-image（见 glassVeilColor），
       * paint 时读 wallpaperVeil —— 顺序反了会画一帧没压暗的底。
       * 玻璃关掉时清空，teardown 重绘不会带上残留。
       * ❸：veil 默认与表面浓度联动；glassVeil 设置可切固定档或关。 */
      wallpaperVeil = on
        ? glassVeilColor(surfaces, isDark,
          parsePercent(state && state.glassTint, 0, 100, 65) / 100,
          state && state.glassVeil)
        : ''

      /* ⚠️ 顺序：**先建背景层，再开总闸**。
       * 反过来的话，一旦建层失败（DOM 异常），总闸已经打开、
       * 容器全透明却没有背景 → 露出 Electron 窗口黑底，就是「主面板纯黑」。
       * 先建层能保证「开了就一定有东西可看」。 */
      const blurValue = parsePercent(state && state.glassBlur, 0, 40, 16)
      const satValue = parsePercent(state && state.glassSat, 0, 200, 120)
      /* 🔧 等高线模式：背景层里铺的是 canvas（强调色细线），不是壁纸图 ——
       * 壁纸 fetch 停掉、壁纸层也不加 blur（线本身就是 1px 高频细节，
       * 糊了等于没有；它的"透过玻璃"效果由列的 alpha 天然提供）。
       * contourActive 必须在建层/画层/算 filter **之前**置位。 */
      const contourMode = on && state.glassBackground === 'contour'
      contourActive = contourMode
      syncWallpaperLayer(on, contourMode ? 0 : blurValue, satValue)
      if (contourMode) {
        wallpaperStatus = 'fallback' /* 不 fetch 壁纸；diag 走 contour 自己的语义 */
        diag.glass = 'contour'
      } else if (on && state.glassBackground !== 'gradient') {
        loadWallpaper(String(state.glassWallpaperPath || ''))
      } else if (on) {
        wallpaperStatus = 'fallback'
        diag.glass = 'gradient'
      }
      syncContourLayer(contourMode)

      /* 总闸：开就加属性，关就摘掉。 */
      try {
        if (on) document.documentElement.setAttribute(GLASS_ATTR, '')
        else document.documentElement.removeAttribute(GLASS_ATTR)
      } catch (error) {
        note('toggle glass attribute', error)
      }

      /* 🔧 传入 cardTargets：卡片填充变量要写在宿主声明它们的**哈希类**
       * 上（body 级覆盖会被元素本地声明挡住，见 buildGlassSheet 一节）。
       * applyNowOnce 里 syncCardSheet 先于本函数跑，检测结果是最新的；
       * 懒加载没跟上的组由 syncCardSheet 的重试循环再次 applyNow 重建。 */
      const css = on ? buildGlassSheet(state, surfaces, isDark, cardTargets) : ''
      if (css === '') {
        if (glassEl !== null) {
          try {
            glassEl.remove()
          } catch (error) {
            note('remove glass sheet', error)
          }
          glassEl = null
        }
        diag.glass = 'off'
        /* 玻璃关 → 撤销输入栏硬裁（seat 搬回滚动容器内，结构零改动残留）。 */
        syncSeatLift(false)
        return
      }
      try {
        if (glassEl === null) {
          glassEl = document.createElement('style')
          glassEl.dataset.plugin = 'dsh-colorlab'
          glassEl.dataset.pluginCss = GLASS_SHEET_ID
          document.head.appendChild(glassEl)
        }
        writeSheet(glassEl, css)
        if (diag.glass === 'off') diag.glass = 'on'
      } catch (error) {
        note('install glass sheet', error)
        diag.glass = 'error'
      }
      /* 玻璃开 → 启动输入栏硬裁（首屏 900ms 保护后抬 seat + 挂 observer）。 */
      syncSeatLift(true)
    }

    /* ====================================================================== *
     * 二·六二、等高线背景（glassBackground = "contour"）
     *
     * 移植自 dsh-theme-endfield（MIT，(c) yunxiiQwQ）的 src/client/20-contour.js
     * —— 只取核心管线（场 → marching squares → 缝合 → 平滑 → 去屑），刻意不带：
     *   · WebGL 后端（画布渲染器）；**worker 后端初版没搬、现已回补**（2026-10-22）：
     *     初版判断"主线程 canvas 够用"是错的 —— 每帧 18–45ms 的长任务在主线程上,
     *     连续滚动时"停→140ms 恢复→首帧长任务"正好砸在下一个手势的第一帧，
     *     真机症状=「滑动启动那一下很难受」。现在整引擎跑在 Blob-URL Worker
     *     + OffscreenCanvas 里（上游同款接线，同宿主已验证可行），主线程的
     *     rAF 只发消息；Worker 起不来时自动退回主线程路径（阶梯/降级照旧）。
     *   · 鼠标轨迹变形 —— 锦上添花，且依赖它的 prefs 体系；
     *   · ~~滚动暂停~~ **已回补**（2026-10-22 真机"滑动页面非常卡"）：
     *     初版注释写"我们的层是 fixed，不随内容滚动，没有它要解决的问题" ——
     *     判断错了。scroll-pause 防的不是"图层跟着滚"，是**滚动期间主线程
     *     必须让路**：rAF 每帧同步占 18–45ms，滚轮/平滑滚动/输入响应都在
     *     主线程排队，任务管理器看着闲（单核脉冲）但手感一顿一顿。
     * 挂载位置也不同：它没有背景层，只能挂进 _frame 并中和后代实色；我们直接
     * 铺进 #dmt-wallpaper（本来就垫在全部内容之下），那些挂载工程一条不需要。
     *
     * 算法骨架（上游注释里全是实测数据，常数原样保留）：
     *   field   = 3 条长波正弦底纹 + K 个正负混合高斯岛（有界散布，实测 1.9x）
     *   lines   = marching squares 等值线（鞍点用双线性渐近判定器）
     *   joins   = 边 id 缝合折线（零分配邻接）
     *   去屑    = 可见长度 / 闭合小环阈值 + 切点发须坍缩（deneedle）
     *   平滑    = Chaikin 角切割 ×(1..3) + 约束 Catmull-Rom 三次样条
     *   布局    = 分层抖动格 + 覆盖率验证器（accept-or-reroll，32 次上限）
     *   动画    = 相位只按名义步进 + duty-cycle 让位（防抽搐 / 防卡主线程）
     * ====================================================================== */

    const CONTOUR_FPS = 24
    const CONTOUR_PHASE_STEP = 1 / 150
    const CONTOUR_SPEED = 2 /* 上游默认档（1x/2x/4x 里的 2） */
    const CONTOUR_DUTY = 0.5
    const CONTOUR_STEP = 6 /* 平衡采样密度：1px 线条的细节点 */
    const CONTOUR_LEVELS = 20
    const CONTOUR_SPAN = 1.45 /* 电平铺在 [-SPAN, +SPAN] */
    const CONTOUR_MAX_CELLS = 60000 /* 网格单元上限：超了加粗 step，成本封顶 */
    const CONTOUR_MIN_BUMPSAMPLES = 4 /* 半径地板（格数）：低于会走样成乱线 */
    const CONTOUR_SMOOTH_FULL = 8000 /* ≤ 这些顶点：Chaikin 三遍（原样） */
    const CONTOUR_SMOOTH_LIMIT = 20000 /* ≤ 两遍，再多一遍 */
    const CONTOUR_MIN_LEN = 40 /* 可见笔画短于此 = 碎屑 */
    const CONTOUR_MIN_RING_BOX = 21 /* 一个中位线距内闭合小环 = 圆点碎屑 */
    const CONTOUR_KEEP_LEN = CONTOUR_MIN_LEN * 1.35 /* 平滑会缩路径，留余量 */
    const CONTOUR_KEEP_RING = CONTOUR_MIN_RING_BOX * 1.5
    const CONTOUR_MIN_CROSSINGS = 3 /* 每格至少要扫过 3 条电平带 */
    const CONTOUR_MIN_INK = 80 /* ink 代理下限（上游校准：≈310px 笔画/格） */
    const CONTOUR_DENSITY_ANCHOR = 640 /* 短边 ≥640px 用满密度 */

    /** mulberry32 —— 确定性 PRNG：同种子同地形，resize 重算不会洗牌。 */
    function contourRng(seed) {
      let a = seed >>> 0
      return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    /** 每次页面加载一个种子（同一次加载里所有重建共用 → resize 复现同地形）。 */
    const contourSeed = (() => {
      let s = 0
      try {
        if (typeof crypto !== 'undefined' && crypto !== null
          && typeof crypto.getRandomValues === 'function') {
          const buf = new Uint32Array(1)
          crypto.getRandomValues(buf)
          s = buf[0]
        }
      } catch { /* 沙箱没有 crypto */ }
      if (s === 0) s = ((Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0)
      return (s >>> 0) || 0x5eed4242
    })()

    /** 视口自适应密度（上游：窄窗降电平/降岛数，防"缠成一团"）。 */
    function contourStepFor(w, h) {
      let step = CONTOUR_STEP
      const cells = (s) => (Math.ceil(w / s) + 1) * (Math.ceil(h / s) + 1)
      while (step < 40 && cells(step) > CONTOUR_MAX_CELLS) step += 1
      return step
    }
    function contourDensityT(w, h) {
      return Math.max(0, Math.min(1,
        (Math.min(w, h) - 320) / (CONTOUR_DENSITY_ANCHOR - 320)))
    }
    function contourLevelsFor(w, h) {
      return Math.max(6, Math.round(10 + contourDensityT(w, h) * (CONTOUR_LEVELS - 10)))
    }
    function contourBumpsFor(w, h) {
      return Math.max(6, Math.round(10 + contourDensityT(w, h) * (22 - 10)))
    }

    /**
     * 等高线引擎（闭包状态：field / geom / paths）—— 纯计算，无 DOM，
     * 测试可以独立实例化拿 paths 断言不变量。
     */
    function createContourEngine(seedValue) {
      const seed = (seedValue >>> 0) || 1
      let f = null /* 场 + 全部 scratch */
      let geom = null /* { w, h, cols, rows, step } */
      let out = [] /* 本帧路径（Float64 平坦数组 [x0,y0,x1,y1,…] 的数组） */

      /* ---- 场求值：底纹正弦 + 有界散布高斯 + 5 遍可分离平滑 + EMA 连续化 ---- */
      const evaluate = (phase) => {
        if (f === null) return
        const { cols, rows, step, K, bx, by, ba, bs, dx, dy, F, W2 } = f
        f.boundsReady = false
        const BASE = 0.62
        for (let i = 0; i < 3; i++) {
          const fx = W2[i * 3], fy = W2[i * 3 + 1], ph = W2[i * 3 + 2] + phase * 0.11
          const amp = BASE / 3
          for (let j = 0; j < rows; j++) {
            const yb = fy * (j * step) + ph
            const sy = Math.sin(yb), cy2 = Math.cos(yb)
            const row = j * cols
            for (let c2 = 0; c2 < cols; c2++) {
              const xb = fx * (c2 * step)
              const v = Math.sin(xb) * cy2 + Math.cos(xb) * sy /* sin(a+b) 展开 */
              if (i === 0) F[row + c2] = amp * v
              else F[row + c2] += amp * v
            }
          }
        }
        for (let k = 0; k < K; k++) {
          const s = bs[k]
          const amp = s * 0.55
          const cx = bx[k] + Math.sin(phase * dx[k] + k * 1.7) * amp
          const cy = by[k] + Math.cos(phase * dy[k] + k * 2.3) * amp
          const a = ba[k]
          const inv = 1 / (2 * s * s)
          const rad = 2.6 * s /* 高斯过 2.6σ 数值上已死 → 只写自己盒内的格 */
          let i0 = Math.max(0, Math.floor((cx - rad) / step))
          let i1 = Math.min(cols - 1, Math.ceil((cx + rad) / step))
          let j0 = Math.max(0, Math.floor((cy - rad) / step))
          let j1 = Math.min(rows - 1, Math.ceil((cy + rad) / step))
          for (let j = j0; j <= j1; j++) {
            const ddy = j * step - cy
            const dy2 = ddy * ddy
            const row = j * cols
            for (let i = i0; i <= i1; i++) {
              const ddx = i * step - cx
              const q = (ddx * ddx + dy2) * inv
              if (q < 6.76) {
                let weight = Math.exp(-q)
                if (q > 4.8) {
                  const t = (q - 4.8) / (6.76 - 4.8)
                  weight *= 1 - t * t * (3 - 2 * t) /* 边缘 smoothstep 收口 */
                }
                F[row + i] += a * weight
              }
            }
          }
        }
        const smooth = f.smooth
        for (let pass = 0; pass < 5; pass++) {
          for (let j = 0; j < rows; j++) {
            const row = j * cols
            for (let i = 0; i < cols; i++) {
              const left = F[row + Math.max(0, i - 1)]
              const center = F[row + i]
              const right = F[row + Math.min(cols - 1, i + 1)]
              smooth[row + i] = (left + 2 * center + right) * 0.25
            }
          }
          for (let j = 0; j < rows; j++) {
            const row = j * cols
            const up = Math.max(0, j - 1) * cols
            const down = Math.min(rows - 1, j + 1) * cols
            for (let i = 0; i < cols; i++) {
              F[row + i] = (smooth[up + i] + 2 * smooth[row + i] + smooth[down + i]) * 0.25
            }
          }
        }
        /* EMA 连续化：鞍点跨电平会让整条路径瞬变，混合上一帧消掉这个抽搐。 */
        if (f.hasPrevious) {
          for (let i = 0; i < F.length; i++) {
            f.previous[i] = f.previous[i] * 0.65 + F[i] * 0.35
            F[i] = f.previous[i]
          }
        } else {
          f.previous.set(F)
        }
        f.hasPrevious = true
      }

      /* ---- 一个候选地形：分层抖动放岛 + 3 条长波底纹，含全部 scratch ---- */
      const buildCandidate = (w, h, salt, step) => {
        const cols = Math.ceil(w / step) + 1
        const rows = Math.ceil(h / step) + 1
        const K = contourBumpsFor(w, h)
        const rnd = contourRng((seed + salt * 0x9E3779B1) >>> 0)
        const m = Math.min(w, h)
        const bx = new Float32Array(K), by = new Float32Array(K)
        const ba = new Float32Array(K), bs = new Float32Array(K)
        const dx = new Float32Array(K), dy = new Float32Array(K)
        /* 分层：视口切成近方格点阵，每岛占一格内随机点 —— 大空片几何上不可能。
         * 格序 Fisher-Yates 洗牌：岛编号驱动幅值/半径/漂移，按行序走会把
         * "屏幕左边"和"先抽的尺寸"相关性焊死。 */
        const gx = Math.max(1, Math.round(Math.sqrt(K * (w / Math.max(1, h)))))
        const gy = Math.max(1, Math.ceil(K / gx))
        const cells = []
        for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) cells.push(i + j * gx)
        for (let i = cells.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1))
          const t = cells[i]; cells[i] = cells[j]; cells[j] = t
        }
        const spanX = 1.2 * w, spanY = 1.2 * h
        for (let k = 0; k < K; k++) {
          const cell = cells[k % cells.length]
          const ci = cell % gx
          const cj = Math.floor(cell / gx)
          bx[k] = -0.1 * w + ((ci + rnd()) / gx) * spanX
          by[k] = -0.1 * h + ((cj + rnd()) / gy) * spanY
          ba[k] = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.9) /* 峰谷混合 */
          bs[k] = Math.max(step * CONTOUR_MIN_BUMPSAMPLES, (0.05 + rnd() * 0.09) * m)
          dx[k] = rnd() * 2 - 1
          dy[k] = rnd() * 2 - 1
        }
        /* 底纹：三条跨越全幅的低幅正弦 —— 高斯之和在岛间精确归零，
         * 电平无处可交 → 大片空白暴露构造；底纹给缝隙一个持续梯度。 */
        const W2 = new Float32Array(9)
        for (let i = 0; i < 3; i++) {
          W2[i * 3] = (0.35 + rnd() * 0.5) * (Math.PI * 2) / Math.max(1, w)
          W2[i * 3 + 1] = (0.35 + rnd() * 0.5) * (Math.PI * 2) / Math.max(1, h)
          W2[i * 3 + 2] = rnd() * Math.PI * 2
        }
        const hCount = (cols - 1) * rows
        const eCount = hCount + cols * (rows - 1)
        const field = {
          cols, rows, step, K, bx, by, ba, bs, dx, dy, hCount, W2,
          F: new Float32Array(cols * rows),
          previous: new Float32Array(cols * rows),
          hasPrevious: false,
          smooth: new Float32Array(cols * rows),
          blockCols: Math.ceil((cols - 1) / 16),
          blockMin: new Float32Array(Math.ceil((cols - 1) / 16) * (rows - 1)),
          blockMax: new Float32Array(Math.ceil((cols - 1) / 16) * (rows - 1)),
          boundsReady: false,
          ex: new Float32Array(eCount),
          ey: new Float32Array(eCount),
          es: new Int32Array(eCount).fill(-1),
          n1: new Int32Array(eCount).fill(-1),
          n2: new Int32Array(eCount).fill(-1),
          seen: new Int32Array(eCount).fill(-1),
          touched: new Int32Array(eCount),
          seq: 0,
        }
        return field
      }

      /* ---- 覆盖率打分：在场上量"每格扫过几条电平带 + ink 代理"，
         * 与测试断言同一不变量 → 不合格布局在挂载前就被拒（accept-or-reroll）。 */
      const coverageScore = (cand, w, h) => {
        const prev = f
        f = cand
        evaluate(0)
        f = prev
        const { cols, rows, F } = cand
        const GX = 8, GY = 5
        const span = CONTOUR_SPAN
        const levelStep = (span * 2) / contourLevelsFor(w, h)
        let worst = Infinity
        let ok = true
        let ink = Infinity
        for (let gy = 0; gy < GY; gy++) {
          for (let gx = 0; gx < GX; gx++) {
            const i0 = Math.floor(gx * (cols - 1) / GX), i1 = Math.ceil((gx + 1) * (cols - 1) / GX)
            const j0 = Math.floor(gy * (rows - 1) / GY), j1 = Math.ceil((gy + 1) * (rows - 1) / GY)
            let mn = Infinity, mx = -Infinity
            let regionInk = 0
            for (let j = j0; j <= j1 && j < rows; j++) {
              const row = j * cols
              for (let i = i0; i <= i1 && i < cols; i++) {
                const v = F[row + i]
                if (v < mn) mn = v
                if (v > mx) mx = v
                if (j < j1 && j < rows - 1 && i < i1 && i < cols - 1) {
                  const a = v, b = F[row + i + 1]
                  const c = F[row + cols + i], d = F[row + cols + i + 1]
                  let qmn = a < b ? a : b, qmx = a > b ? a : b
                  if (c < qmn) qmn = c; if (c > qmx) qmx = c
                  if (d < qmn) qmn = d; if (d > qmx) qmx = d
                  if (qmn < -span) qmn = -span
                  if (qmx > span) qmx = span
                  if (qmx > qmn) regionInk += Math.floor(qmx / levelStep) - Math.ceil(qmn / levelStep) + 1
                }
              }
            }
            const lo = Math.max(mn, -span), hi = Math.min(mx, span)
            const crossings = hi <= lo ? 0
              : Math.floor(hi / levelStep) - Math.ceil(lo / levelStep) + 1
            if (crossings < worst) worst = crossings
            if (crossings < CONTOUR_MIN_CROSSINGS) ok = false
            if (regionInk < ink) ink = regionInk
            if (regionInk < CONTOUR_MIN_INK) ok = false
          }
        }
        return { ok, worst, ink }
      }

      /* ---- marching squares（单电平）+ 边 id 缝合 + 去屑 + 发须坍缩 ---- */
      const extractLevel = (L, sink) => {
        const { cols, rows, step, F, ex, ey, es, n1, n2, seen, touched, hCount } = f
        const st = ++f.seq
        let tn = 0
        const pt = (id, i0, j0, i1, j1) => {
          if (es[id] === st) return id
          const a = F[j0 * cols + i0]
          const b = F[j1 * cols + i1]
          let t = (L - a) / (b - a)
          if (!(t >= 0)) t = 0
          else if (t > 1) t = 1
          ex[id] = (i0 + (i1 - i0) * t) * step
          ey[id] = (j0 + (j1 - j0) * t) * step
          es[id] = st
          n1[id] = -1
          n2[id] = -1
          touched[tn++] = id
          return id
        }
        const link = (a, b) => {
          if (n1[a] < 0) n1[a] = b
          else if (n2[a] < 0) n2[a] = b
          if (n1[b] < 0) n1[b] = a
          else if (n2[b] < 0) n2[b] = a
        }
        for (let j = 0; j < rows - 1; j++) {
          const row = j * cols
          for (let i = 0; i < cols - 1; i++) {
            if (f.boundsReady && i % 16 === 0) {
              const block = j * f.blockCols + Math.floor(i / 16)
              if (L <= f.blockMin[block] || L > f.blockMax[block]) {
                i = Math.min(i + 16, cols - 1) - 1
                continue /* 整块在电平一侧：跳 16 列 */
              }
            }
            const p0 = row + i
            const p1 = p0 + 1
            const p3 = p0 + cols
            const p2 = p3 + 1
            const v0 = F[p0], v1 = F[p1], v2 = F[p2], v3 = F[p3]
            let mn = v0, mx = v0
            if (v1 < mn) mn = v1; else if (v1 > mx) mx = v1
            if (v2 < mn) mn = v2; else if (v2 > mx) mx = v2
            if (v3 < mn) mn = v3; else if (v3 > mx) mx = v3
            if (L <= mn || L > mx) continue
            const idx = (v0 > L ? 1 : 0) | (v1 > L ? 2 : 0) | (v2 > L ? 4 : 0) | (v3 > L ? 8 : 0)
            const T = () => pt(j * (cols - 1) + i, i, j, i + 1, j)
            const B = () => pt((j + 1) * (cols - 1) + i, i, j + 1, i + 1, j + 1)
            const Le = () => pt(hCount + j * cols + i, i, j, i, j + 1)
            const Ri = () => pt(hCount + j * cols + i + 1, i + 1, j, i + 1, j + 1)
            switch (idx) {
              case 1: case 14: link(T(), Le()); break
              case 2: case 13: link(T(), Ri()); break
              case 3: case 12: link(Le(), Ri()); break
              case 4: case 11: link(Ri(), B()); break
              case 6: case 9: link(T(), B()); break
              case 7: case 8: link(Le(), B()); break
              /* 歧义鞍点：双线性渐近判定器（a*c−b*d 的符号）。用格均值会把
                 对角高低区接错 → 渲染里那种长 V 形连线。 */
              case 5: {
                const saddle = (v0 - L) * (v2 - L) - (v1 - L) * (v3 - L)
                if (saddle > 0) { link(T(), Ri()); link(Le(), B()) }
                else { link(T(), Le()); link(Ri(), B()) }
                break
              }
              case 10: {
                const saddle = (v0 - L) * (v2 - L) - (v1 - L) * (v3 - L)
                if (saddle < 0) { link(T(), Le()); link(Ri(), B()) }
                else { link(T(), Ri()); link(Le(), B()) }
                break
              }
            }
          }
        }
        const walk = (start) => {
          const path = []
          let cur = start
          let prev = -1
          for (;;) {
            path.push(ex[cur], ey[cur])
            seen[cur] = st
            const a = n1[cur]
            const b = n2[cur]
            let nx = -1
            if (a >= 0 && a !== prev && seen[a] !== st) nx = a
            else if (b >= 0 && b !== prev && seen[b] !== st) nx = b
            if (nx < 0) {
              if ((a === start || b === start) && path.length > 4) path.push(ex[start], ey[start])
              break
            }
            prev = cur
            cur = nx
          }
          return path
        }
        const W = geom !== null ? geom.w : 0
        const H = geom !== null ? geom.h : 0
        const keep = (p) => {
          if (p.length < 8) return false
          let vis = 0
          let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
          let seenIn = false
          for (let k = 0; k < p.length; k += 2) {
            const x = p[k], y = p[k + 1]
            const inside = x >= 0 && x <= W && y >= 0 && y <= H
            if (inside) {
              seenIn = true
              if (x < minx) minx = x
              if (x > maxx) maxx = x
              if (y < miny) miny = y
              if (y > maxy) maxy = y
            }
            if (k >= 2) {
              const px2 = p[k - 2], py2 = p[k - 1]
              const prevIn = px2 >= 0 && px2 <= W && py2 >= 0 && py2 <= H
              if (inside && prevIn) {
                const ddx = x - px2, ddy = y - py2
                vis += Math.sqrt(ddx * ddx + ddy * ddy)
              }
            }
          }
          if (!seenIn) return false /* 全在画外：纯碎屑 */
          if (vis < CONTOUR_KEEP_LEN) return false
          /* 小闭合环 = 峰顶牛眼 → 点；同尺度的开链是"伸向画外的线"，保留。 */
          const gapx = p[0] - p[p.length - 2]
          const gapy = p[1] - p[p.length - 1]
          const closed = (gapx * gapx + gapy * gapy) < 4
          if (closed && (maxx - minx) < CONTOUR_KEEP_RING
            && (maxy - miny) < CONTOUR_KEEP_RING) return false
          return true
        }
        /* 切点发须：电平与场近乎相切处，10px 网格的线性插值画出一个
         * "出去再原路返回"的发夹（底宽 <2px，1px 笔画下只剩一根刺）。
         * 判据两条都要：底 <2px（笔画分辨不出）且折返 >90°（是回头不是转弯）。
         * 整个发须一起坍缩（顶点拉到底边中点，亚像素位移），上游实测比
         * 只删尖点更好 —— 只删尖会留下 0.83px 桩继承两次 ~78° 折返。 */
        const deneedle = (p) => {
          const n = p.length / 2
          if (n < 4) return p
          let found = false
          for (let k = 1; k < n - 1; k++) {
            const bx2 = p[(k + 1) * 2] - p[(k - 1) * 2]
            const by2 = p[(k + 1) * 2 + 1] - p[(k - 1) * 2 + 1]
            if (bx2 * bx2 + by2 * by2 >= 4) continue
            const ax = p[k * 2] - p[(k - 1) * 2]
            const ay = p[k * 2 + 1] - p[(k - 1) * 2 + 1]
            const cx = p[(k + 1) * 2] - p[k * 2]
            const cy = p[(k + 1) * 2 + 1] - p[k * 2 + 1]
            if (ax * cx + ay * cy < 0) { found = true; break }
          }
          if (!found) return p
          const gx2 = p[0] - p[(n - 1) * 2]
          const gy2 = p[1] - p[(n - 1) * 2 + 1]
          const closed = (gx2 * gx2 + gy2 * gy2) < 4
          const q = [p[0], p[1]]
          let k = 1
          while (k < n - 1) {
            const px = q[q.length - 2], py = q[q.length - 1]
            const bx3 = p[(k + 1) * 2] - px, by3 = p[(k + 1) * 2 + 1] - py
            if (bx3 * bx3 + by3 * by3 < 4) {
              const ax = p[k * 2] - px, ay = p[k * 2 + 1] - py
              const cx = p[(k + 1) * 2] - p[k * 2], cy = p[(k + 1) * 2 + 1] - p[k * 2 + 1]
              if (ax * cx + ay * cy < 0) {
                if (k + 1 < n - 1) {
                  q[q.length - 2] = (px + p[(k + 1) * 2]) / 2
                  q[q.length - 1] = (py + p[(k + 1) * 2 + 1]) / 2
                  k += 2
                  continue
                }
                k += 1 /* 末端必须存活（保端点/环闭合），只吃尖点 */
                continue
              }
            }
            q.push(p[k * 2], p[k * 2 + 1])
            k += 1
          }
          q.push(p[(n - 1) * 2], p[(n - 1) * 2 + 1])
          if (closed) {
            q[q.length - 2] = q[0]
            q[q.length - 1] = q[1]
          }
          return q
        }
        /* 开链先走（有自由端），剩下的都是环 —— 这个顺序防止环被
         * 从中间进入劈成两半。 */
        for (let k = 0; k < tn; k++) {
          const id = touched[k]
          if (seen[id] !== st && n2[id] < 0) {
            const p = deneedle(walk(id))
            if (keep(p)) sink.push(p)
          }
        }
        for (let k = 0; k < tn; k++) {
          const id = touched[k]
          if (seen[id] !== st) {
            const p = deneedle(walk(id))
            if (keep(p)) sink.push(p)
          }
        }
      }

      /* ---- 全电平提取（先做 O(cells) 块界一遍，21 个电平共用） ---- */
      const extractAll = (phase) => {
        if (f === null) return
        evaluate(phase)
        for (let j = 0; j < f.rows - 1; j++) {
          const row = j * f.cols
          for (let block = 0; block < f.blockCols; block++) {
            const begin = block * 16
            const end = Math.min(begin + 16, f.cols - 1)
            let min = Infinity, max = -Infinity
            for (let i = begin; i <= end; i++) {
              const a = f.F[row + i], b = f.F[row + f.cols + i]
              if (a < min) min = a
              if (a > max) max = a
              if (b < min) min = b
              if (b > max) max = b
            }
            const k = j * f.blockCols + block
            f.blockMin[k] = min
            f.blockMax[k] = max
          }
        }
        f.boundsReady = true
        out = []
        const levels = contourLevelsFor(geom.w, geom.h)
        const stepL = (CONTOUR_SPAN * 2) / levels
        for (let n = 0; n <= levels; n++) {
          extractLevel(-CONTOUR_SPAN + n * stepL, out)
        }
      }

      /* ---- 平滑与描边（Chaikin ×1..3 + 约束 Catmull-Rom；环先画、一笔总描） ---- */
      const smoothPath = (source) => {
        const count = source.length / 2
        if (count < 3) return source
        const closed = (source[0] - source[source.length - 2]) ** 2
          + (source[1] - source[source.length - 1]) ** 2 < 4
        let points = closed ? source.slice(0, source.length - 2) : source.slice()
        const passes = count <= CONTOUR_SMOOTH_FULL ? 3 : (count <= CONTOUR_SMOOTH_LIMIT ? 2 : 1)
        for (let pass = 0; pass < passes; pass++) {
          const n = points.length / 2
          const limit = closed ? n : n - 1
          const next = new Array(n * 4)
          let w2 = 0
          if (!closed) { next[w2++] = points[0]; next[w2++] = points[1] }
          for (let k = 0; k < limit; k++) {
            const a = k * 2
            const b = ((k + 1) % n) * 2
            const ax = points[a], ay = points[a + 1]
            const bx2 = points[b], by2 = points[b + 1]
            next[w2++] = ax * 0.75 + bx2 * 0.25
            next[w2++] = ay * 0.75 + by2 * 0.25
            next[w2++] = ax * 0.25 + bx2 * 0.75
            next[w2++] = ay * 0.25 + by2 * 0.75
          }
          if (!closed) { next[w2++] = points[points.length - 2]; next[w2++] = points[points.length - 1] }
          points = w2 === next.length ? next : next.slice(0, w2)
        }
        if (!closed) return points
        const out2 = points.slice()
        out2.push(out2[0], out2[1])
        return out2
      }

      const drawTo = (ctx, color) => {
        if (geom === null) return
        const { w, h } = geom
        const scale = (w > 0 && typeof ctx.canvas !== 'undefined' && ctx.canvas !== null
          && typeof ctx.canvas.width === 'number' && ctx.canvas.width > 0 && ctx.canvas.width !== w)
          ? ctx.canvas.width / w : 1
        if (scale !== 1 && typeof ctx.setTransform === 'function') ctx.setTransform(scale, 0, 0, scale, 0, 0)
        ctx.clearRect(0, 0, w, h)
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.lineJoin = 'round'
        const drawSmoothPath = (source) => {
          const count = source.length / 2
          if (count < 3) {
            ctx.moveTo(source[0], source[1])
            for (let k = 2; k < source.length; k += 2) ctx.lineTo(source[k], source[k + 1])
            return
          }
          const closed = (source[0] - source[source.length - 2]) ** 2
            + (source[1] - source[source.length - 1]) ** 2 < 4
          const limit = closed ? count - 1 : count
          const at = (index) => {
            const k = closed
              ? (index + limit) % limit
              : Math.max(0, Math.min(limit - 1, index))
            return k * 2
          }
          const tangentAt = (index, tan) => {
            const i = at(index)
            const p = at(index - 1)
            const n = at(index + 1)
            const cx = source[i], cy = source[i + 1]
            const inX = cx - source[p], inY = cy - source[p + 1]
            const outX = source[n] - cx, outY = source[n + 1] - cy
            let tx, ty, cap
            if (!closed && index === 0) {
              tx = outX * 0.4; ty = outY * 0.4
              cap = Math.sqrt(outX * outX + outY * outY) * 0.55
            } else if (!closed && index === limit - 1) {
              tx = inX * 0.4; ty = inY * 0.4
              cap = Math.sqrt(inX * inX + inY * inY) * 0.55
            } else {
              tx = (source[n] - source[p]) * 0.32
              ty = (source[n + 1] - source[p + 1]) * 0.32
              cap = Math.sqrt(Math.min(inX * inX + inY * inY, outX * outX + outY * outY)) * 0.62
            }
            const len2 = tx * tx + ty * ty
            if (len2 > cap * cap && len2 > 0) {
              const s = cap / Math.sqrt(len2)
              tx *= s; ty *= s
            }
            tan[0] = tx; tan[1] = ty
          }
          ctx.moveTo(source[0], source[1])
          const segments = closed ? limit : limit - 1
          const t0 = [0, 0]
          const t1 = [0, 0]
          for (let k = 0; k < segments; k++) {
            const s = at(k)
            const e = at(k + 1)
            tangentAt(k, t0)
            tangentAt(k + 1, t1)
            ctx.bezierCurveTo(
              source[s] + t0[0], source[s + 1] + t0[1],
              source[e] - t1[0], source[e + 1] - t1[1],
              source[e], source[e + 1],
            )
          }
          /* 环要 closePath：环形切线已让接缝 C1，但不标环的话 canvas 把两端
           * 平接而不是圆接（上游 issue #3 的缺陷 2）。 */
          if (closed) ctx.closePath()
        }
        const isRing = (p) => {
          const n = p.length - 2
          return n >= 2 && (p[0] - p[n]) ** 2 + (p[1] - p[n + 1]) ** 2 < 4
        }
        /* 一笔总描、环先画：closePath 的成本随已累积路径增长（实测环先画
         * 把 splice 限制在环几何内）；逐条 stroke 会把交叠处二次合成、
         * 交叉点变黑 —— 恰是"缠成一团"的观感。 */
        ctx.beginPath()
        for (let i = 0; i < out.length; i++) {
          if (isRing(out[i])) drawSmoothPath(smoothPath(out[i]))
        }
        for (let i = 0; i < out.length; i++) {
          if (!isRing(out[i])) drawSmoothPath(smoothPath(out[i]))
        }
        ctx.stroke()
      }

      return {
        /** 选一个通过覆盖率验证的布局（32 次上限，取最优）。
         * stepOverride：成本自适应降级用的粗化网格（见 contourTune）；
         * 永不低于 contourStepFor 的格数上限地板，永不超过 40。 */
        build(w, h, stepOverride) {
          const floor = contourStepFor(w, h)
          const step = Math.min(40, Math.max(floor,
            typeof stepOverride === 'number' ? stepOverride : floor))
          let best = null
          for (let attempt = 0; attempt < 32; attempt++) {
            const cand = buildCandidate(w, h, attempt, step)
            const score = coverageScore(cand, w, h)
            if (best === null || score.worst > best.score.worst
              || (score.worst === best.score.worst && score.ink > best.score.ink)) best = { cand, score }
            if (score.ok) break
          }
          f = best.cand
          geom = { w, h, cols: f.cols, rows: f.rows, step }
        },
        extract(phase) { extractAll(phase) },
        draw(ctx, color) { drawTo(ctx, color) },
        get paths() { return out },
        get geometry() { return geom },
      }
    }

    /* ---- 运行时：把引擎铺在背景层里，管尺寸、动画、暂停/恢复 ---- */

    let contourEngine = null
    let contourCanvas = null
    let contourRaf = null
    let contourRo = null
    let contourEnvOff = null
    let contourPhase = 0
    let contourLastField = -1
    let contourLastCost = 0
    let contourLoopGen = 0
    let contourSig = ''
    /** 等高线是否占用了背景层（paint/filter 都要看它）。 */
    let contourActive = false

    /* ══ 成本自适应降级（2026-10-22，真机"开等高线好卡"的修复）══════
     *
     * 上游的出厂画质（step 6px 网格）是**配着 worker/WebGL 后端**跑的
     * —— 他的文档写明：同步 canvas 画家只在 worker 拒单的兜底路径上，
     * 所以他对同步路径的实测（4.4ms/帧）用的是 step 10。我移植时搬了
     * step 6、砍了 worker（当时判断"主线程 canvas @24fps 够用"），
     * 1920×1080 实测 extract 单帧 32.7ms + 描边 ~3.8 万次 bezier ——
     * 直接把他的画质参数放进了他没验证过的执行路径，卡是真卡。
     *
     * 修法不是拍一个粗网格（好机器白亏画质），而是**按实测成本降级**：
     *   · 起步仍用 contourStepFor 的出厂值（小窗/普通屏就是 6px，画质原样）；
     *   · 动画循环里量每帧 extract+draw 的耗时，连续超预算就把 step +2
     *     重建地形（成本 ∝ 格数，step 6→10 是 2.8 倍降幅）；
     *   · 只降不升：滞回缺失时来回重建比卡更糟；resize 会重置回起步值
     *     （窗口变小本来就便宜，重新试一次好画质是合理的）；
     *   · 预算 = 帧间隔 × CONTOUR_DUTY（24fps → 41.7×0.5 ≈ 20.8ms），
     *     与上游"单帧不得超过半帧"的让位纪律同源 —— 他防的是频率，
     *     这里补防的是单帧成本本身。
     */
    /* 🔧 2026-10-22（真机"每一下滑动开头顿一次"）：旧的 20.8ms 预算错了 ——
     * 那是拿我们的 24fps 帧间隔（41.7ms）算的，但**用户的手按 60Hz 读输入**：
     * 主线程上任何一帧的任务都直接推迟下一个滚轮事件的处理。滑动起手顿
     * 一次的形态 = 动画任务恰好砸在滚动开始的那几帧。主线程路径的预算
     * 收到 8ms（半张 60Hz 帧），超了就降档；worker 路径不受此限（主线程
     * 只发消息），维持 20.8ms。 */
    const CONTOUR_MAIN_BUDGET = 8
    const CONTOUR_BUDGET_FRAMES = 3 /* 连续几帧超预算才降（防偶发抖动误伤） */
    let contourStepNow = 0 /* 0 = 未定（用起步值） */
    let contourOverBudget = 0
    let contourTuneTimer = null

    /** 一帧成本对账：超预算连续 N 帧 → step +2。
     *  🔧 重建**绝不在 rAF 回调里同步做**（32 轮验证器 = 百毫秒长任务，
     *  比它要治的卡顿严重十倍）—— 走调度阶梯，把重建推迟到空闲时刻。 */
    function contourTune(costMs) {
      if (contourEngine === null) return false
      if (costMs <= CONTOUR_MAIN_BUDGET) {
        contourOverBudget = 0
        return false
      }
      contourOverBudget += 1
      if (contourOverBudget < CONTOUR_BUDGET_FRAMES) return false
      contourOverBudget = 0
      const geometry = contourEngine.geometry
      if (geometry === null) return false
      const next = Math.min(40, geometry.step + 2)
      if (next === geometry.step) return false /* 已到地板：再快不了，靠 duty 让位 */
      contourStepNow = next
      /* 延迟到下一个宏任务重建（顺便合并连续触发）。 */
      if (contourTuneTimer !== null) return true
      contourTuneTimer = setTimeout(() => {
        contourTuneTimer = null
        if (contourEngine === null) return
        const g = contourEngine.geometry
        if (g === null) return
        contourEngine.build(g.w, g.h, contourStepNow)
        contourRefresh(true)
      }, 0)
      if (contourTuneTimer && typeof contourTuneTimer.unref === 'function') contourTuneTimer.unref()
      return true
    }

    /* ══ Worker 后端（2026-10-22 回补，真机"滑动启动那一下"的根治）══════
     *
     * 主线程路径的病根不是单帧太贵，是**贵的那一帧在主线程上**：
     * 连续滚动时"滚→停 140ms→恢复→首帧 extract+draw（18–45ms 长任务）
     * →下一个手势的第一帧排在它后面"。用户感受 = 每次重新滑起来卡一下。
     * 上游早就看穿了这点才做的 worker + OffscreenCanvas —— 我初版判断
     * "不用搬"是错的，现在搬回来。
     *
     * 接线（上游同款，一帧在途 + 最新待发合帧）：
     *   · 引擎代码用 **String(fn) 序列化**进 Blob-URL worker（无构建步骤
     *     的插件唯一能防漂移的做法：测试里 new Function 直接 eval 这份
     *     source 跑通 init/frame，函数名一改即红）；
     *   · 主线程 rAF 只算相位 + postMessage（微秒级）；worker 忙时新帧
     *     合并成"最新一帧"，绝不排队；
     *   · worker 回报每帧成本 → 同一套预算/降级（step+2 走 rebuild 消息）；
     *   · 任何一环起不来（无 Worker/OffscreenCanvas/transfer、init 报错、
     *     运行 error）→ 整层降级回主线程路径（阶梯 + contourTune 照旧），
     *     transfer 过的画布不可逆 → **重建画布元素**再走旧路。
     */
    let contourWorker = null
    let contourWorkerUrl = null
    let contourWorkerReady = false
    let contourWorkerBusy = false
    let contourWorkerPending = null /* 最新待发帧 {phase,color,recolor?} */
    let contourWorkerFailed = false
    let contourWorkerOverBudget = 0

    /** worker 侧消息泵（纯字符串拼接，测试可 eval）。 */
    function contourWorkerSource() {
      const consts = [
        ['CONTOUR_STEP', CONTOUR_STEP],
        ['CONTOUR_LEVELS', CONTOUR_LEVELS],
        ['CONTOUR_SPAN', CONTOUR_SPAN],
        ['CONTOUR_MAX_CELLS', CONTOUR_MAX_CELLS],
        ['CONTOUR_MIN_BUMPSAMPLES', CONTOUR_MIN_BUMPSAMPLES],
        ['CONTOUR_SMOOTH_FULL', CONTOUR_SMOOTH_FULL],
        ['CONTOUR_SMOOTH_LIMIT', CONTOUR_SMOOTH_LIMIT],
        ['CONTOUR_DENSITY_ANCHOR', CONTOUR_DENSITY_ANCHOR],
        ['CONTOUR_KEEP_LEN', CONTOUR_KEEP_LEN],
        ['CONTOUR_KEEP_RING', CONTOUR_KEEP_RING],
        ['CONTOUR_MIN_CROSSINGS', CONTOUR_MIN_CROSSINGS],
        ['CONTOUR_MIN_INK', CONTOUR_MIN_INK],
      ].map((kv) => 'const ' + kv[0] + ' = ' + kv[1] + ';').join('\n')
      /* 依赖顺序：被调者在前的先声明（函数声明本就提升，顺序只为可读）。 */
      const fns = [
        contourRng, contourDensityT, contourLevelsFor, contourBumpsFor,
        contourStepFor, createContourEngine,
      ].map(String).join('\n')
      const driver = [
        'let engine = null, canvas = null, ctx = null',
        'self.onmessage = (e) => {',
        '  const m = e.data',
        '  try {',
        '    if (m.op === "init" || m.op === "rebuild") {',
        '      if (m.op === "init") {',
        '        canvas = m.canvas',
        '        ctx = canvas.getContext("2d")',
        '        engine = createContourEngine(m.seed)',
        '      }',
        '      canvas.width = Math.max(1, Math.round(m.w * m.dpr))',
        '      canvas.height = Math.max(1, Math.round(m.h * m.dpr))',
        '      engine.build(m.w, m.h, m.step)',
        '      engine.extract(m.phase)',
        '      if (ctx) engine.draw(ctx, m.color)',
        '      self.postMessage({op:"ready", step: engine.geometry ? engine.geometry.step : 0})',
        '    } else if (m.op === "frame") {',
        '      const t0 = performance.now()',
        '      engine.extract(m.phase)',
        '      engine.draw(ctx, m.color)',
        '      self.postMessage({op:"done", cost: performance.now() - t0})',
        '    } else if (m.op === "recolor") {',
        '      if (engine && ctx) engine.draw(ctx, m.color)',
        '      self.postMessage({op:"done", cost: 0})',
        '    }',
        '  } catch (err) {',
        '    self.postMessage({op:"error", message: String(err && err.message ? err.message : err)})',
        '  }',
        '}',
      ].join('\n')
      return consts + '\n' + fns + '\n' + driver
    }

    function contourWorkerMsg(msg) {
      if (contourWorker === null) return
      try { contourWorker.postMessage(msg) } catch { /* 已终止 */ }
    }

    /** worker 路径的降级：成本进同一预算，超标走 rebuild 消息（无长任务风险，
     *  降的是吞吐/发热/电量）。 */
    function contourWorkerTune(costMs) {
      const budget = (1000 / CONTOUR_FPS) * CONTOUR_DUTY
      if (costMs <= budget) {
        contourWorkerOverBudget = 0
        return
      }
      contourWorkerOverBudget += 1
      if (contourWorkerOverBudget < CONTOUR_BUDGET_FRAMES) return
      contourWorkerOverBudget = 0
      const next = Math.min(40, contourWorkerStepValue() + 2)
      if (next === contourWorkerStepValue()) return
      contourWorkerStepOverride = next
      const size = contourLastSize
      if (size === null) return
      contourWorkerBusy = true
      contourWorkerMsg({
        op: 'rebuild', w: size.w, h: size.h, dpr: size.dpr, step: next,
        phase: contourPhase, color: contourStrokeColor(contourAccentHex(), resolvedScheme() !== 'light'),
      })
    }
    let contourWorkerStepOverride = 0

    function contourWorkerStepValue() {
      return contourWorkerStepOverride
    }

    /** 主线程当前该画的尺寸/dpr（worker 与 fallback 共用一份口径）。 */
    function contourViewportSize() {
      const w = Math.max(1, typeof window !== 'undefined' ? window.innerWidth : 1280)
      const h = Math.max(1, typeof window !== 'undefined' ? window.innerHeight : 800)
      const ratio = (typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
        && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1
      return { w, h, dpr: Math.min(2, ratio) }
    }

    function contourFlushPending() {
      if (contourWorker === null || contourWorkerBusy || contourWorkerPending === null) return
      const p = contourWorkerPending
      contourWorkerPending = null
      contourWorkerBusy = true
      contourWorkerMsg(p)
    }

    function contourStopWorker() {
      if (contourWorker !== null) {
        try { contourWorker.terminate() } catch { /* 已终止 */ }
        contourWorker = null
      }
      if (contourWorkerUrl !== null) {
        try { URL.revokeObjectURL(contourWorkerUrl) } catch { /* 无 URL */ }
        contourWorkerUrl = null
      }
      contourWorkerReady = false
      contourWorkerBusy = false
      contourWorkerPending = null
      contourWorkerStepOverride = 0
      contourWorkerOverBudget = 0
    }

    /**
     * 尝试把画布控制权交给 worker。成功返回 true（此后主线程不再持有可画
     * 画布）；任何前提不满足返回 false 并置 failed（调用方走主线程路径）。
     */
    function contourStartWorker() {
      if (contourWorkerFailed || contourCanvas === null || contourWorker !== null) return contourWorker !== null
      if (typeof Worker !== 'function'
        || typeof OffscreenCanvas === 'undefined'
        || typeof contourCanvas.transferControlToOffscreen !== 'function'
        || typeof Blob !== 'function'
        || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        contourWorkerFailed = true
        return false
      }
      const size = contourViewportSize()
      let url = null
      let worker = null
      try {
        url = URL.createObjectURL(new Blob([contourWorkerSource()], {type: 'text/javascript'}))
        worker = new Worker(url)
      } catch (error) {
        note('contour worker create', error)
        if (url !== null) { try { URL.revokeObjectURL(url) } catch { /* 无 */ } }
        contourWorkerFailed = true
        return false
      }
      contourWorker = worker
      contourWorkerUrl = url
      worker.onmessage = (event) => {
        const m = event.data
        if (m.op === 'ready') {
          contourWorkerReady = true
          /* 🔧 后端可见（"滑动卡一下"排查）：worker 握手成功才算真在用
           * 独立线程 —— 记进 diag，设置页副标题显示出来。 */
          diag.contour = 'worker'
          publish()
          if (typeof m.step === 'number' && m.step > 0) contourWorkerStepOverride = m.step
          contourWorkerBusy = false
          contourFlushPending()
          /* 首帧时机：挂载时的 applySwitches 早于握手（layerPainted=false
           * 不补帧、但 sig 已写）—— 这里清 sig 强制重评，静态档才不会
           * 永远空着；动画档 startLoop 自带 busy 保护，重复调用无害。 */
          contourSig = ''
          contourApplySwitches()
        } else if (m.op === 'done') {
          contourWorkerBusy = false
          if (typeof m.cost === 'number' && m.cost > 0) {
            contourLastCost = m.cost
            contourWorkerTune(m.cost)
          }
          contourFlushPending()
        } else if (m.op === 'error') {
          note('contour worker runtime', new Error(String(m.message)))
          contourFailWorker()
        }
      }
      worker.onerror = (event) => {
        note('contour worker error', new Error(String(event && event.message ? event.message : 'worker error')))
        contourFailWorker()
      }
      try {
        worker.postMessage({
          op: 'init',
          canvas: contourCanvas.transferControlToOffscreen(),
          seed: contourSeed,
          w: size.w, h: size.h, dpr: size.dpr,
          step: 0, /* 0 = 起步档 */
          phase: contourPhase,
          color: contourStrokeColor(contourAccentHex(), resolvedScheme() !== 'light'),
        })
        contourLastSize = size
        return true
      } catch (error) {
        note('contour worker init', error)
        contourFailWorker()
        return false
      }
    }

    /** worker 中途死亡：走不了回头路（transfer 不可逆），重建画布元素回主线程路径。 */
    function contourFailWorker() {
      const wasActive = contourActive
      contourStopWorker()
      contourWorkerFailed = true
      diag.contour = 'main'
      publish()
      /* 旧画布的控制权已经给了 worker —— 留着也没用。整套拆掉再重挂：
       * destroy 清空 lastSize/engine，syncContourLayer 才会走"建新画布"
       * 分支（failed 已置位 → 直接建主线程引擎 + 阶梯路径）。 */
      destroyContourLayer()
      if (wasActive) syncContourLayer(true)
    }

    function contourReducedMotion() {
      try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch {
        return false
      }
    }

    /* ══ 滚动让路（scroll-pause，2026-10-22 真机修复）══════════════
     *
     * 页面任何滚动（滚轮/触控板/拖滚动条/键盘）期间**完全停止**动画帧。
     * 关键在"完全"：不是降频 —— 降频仍会随机插进滚动的关键帧里。
     * 用捕获阶段的 scroll 监听（capture:true + passive:true）：宿主任何
     * 可滚动容器（正文流、侧栏、设置页）滚动都会冒泡到 document，
     * 一个监听覆盖全部，不需要枚举容器。
     * 停止期间相位不推进（不做"补帧"）—— 恢复后从停下的地方继续漂移，
     * 与上游的名义步进纪律一致：宁可慢放，绝不跳变。
     */
    let contourScrollPaused = false
    let contourScrollTimer = null

    function contourOnScroll() {
      if (!contourActive) return
      if (!contourScrollPaused) {
        contourScrollPaused = true
        contourStopLoop() /* 立刻让路：这一帧之后不再有动画帧 */
      }
      /* 滚动停下 140ms 后恢复。计时器每次滚动都续期（debounce tail）。 */
      if (contourScrollTimer !== null) {
        try { clearTimeout(contourScrollTimer) } catch { /* 无 timer */ }
      }
      contourScrollTimer = setTimeout(() => {
        contourScrollTimer = null
        contourScrollPaused = false
        /* 恢复前把成本对账清零：从静止到动画的第一帧必然包含 extract
         * 冷启动，不该被当成"超预算"触发降级。 */
        contourOverBudget = 0
        contourLastField = -1
        contourSig = ''
        contourApplySwitches()
      }, 140)
      if (contourScrollTimer && typeof contourScrollTimer.unref === 'function') contourScrollTimer.unref()
    }

    /**
     * 线条颜色：强调色 + 8 位 hex alpha。
     * 上游的 alpha 是"柱几乎全透"的主题里调的（存在感 ≈0.20）；我们的列要吃掉
     * (1−tint) 的透过率，所以抬到 0.55/0.70 —— tint 65 时存在感 0.55×0.35≈0.19，
     * 与上游对齐；tint 越高线越隐，正是"主题色为主"的语义。
     */
    function contourStrokeColor(accentHex, isDark) {
      const hex = typeof accentHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(accentHex.trim())
        ? accentHex.trim()
        : '#5FB3B3'
      return hex + (isDark ? '8c' : 'b3')
    }

    /** 当前漂移速度倍率（"0"=静止；非法值回落 2）。 */
    function contourSpeedValue() {
      const raw = String(state && state.contourSpeed !== undefined ? state.contourSpeed : '2')
      const n = Number(raw)
      return Number.isFinite(n) ? Math.max(0, Math.min(4, n)) : 2
    }

    function contourWantsAnim() {
      if (!contourActive) return false
      /* 🔧 速度 0 = 静止档（升格为设置项 2026-10-22）：只画一帧完整静态
       * 地形，零 rAF —— 上游的"静止/1x/2x/4x"档位里最省电的一档。 */
      if (contourSpeedValue() <= 0) return false
      if (contourReducedMotion()) return false
      if (typeof document !== 'undefined' && document.hidden === true) return false
      return true
    }

    /**
     * 对齐画布到视口；尺寸变了就**调度**重建（不在本帧算）。
     * 🔧 2026-10-22（"启动那一下很难受"的修复）：build 曾经是同步的 ——
     * 覆盖率验证器最多 32 轮全场评估 + 首次 extract/draw，一整块 45ms+
     * 砸在挂载帧上，和宿主自己的启动工作撞车。现在：
     *   · 首次挂载延迟到启动风暴之后（CONTOUR_BOOT_DELAY）；
     *   · resize 防抖（拖动窗口时不再每次 RO 回调都重建）；
     *   · 先粗后细的阶梯（见 contourRefineTick）—— 每个任务只算一档，
     *     任务之间主线程可以呼吸，输入不再排在 45ms 的长任务后面。
     */
    function contourSizeTo(delayMs) {
      if (contourCanvas === null) return
      const size = contourViewportSize()
      if (contourLastSize !== null && contourLastSize.w === size.w && contourLastSize.h === size.h) return
      const firstTime = contourLastSize === null
      contourLastSize = size
      /* 🔧 worker 活着：画布控制权已转移，主线程碰不了它 —— 尺寸变化
       * 发一条 rebuild 就完事（worker 里算，无长任务风险，也不需要阶梯）。 */
      if (contourWorker !== null) {
        contourWorkerBusy = true
        contourWorkerMsg({
          op: 'rebuild', w: size.w, h: size.h, dpr: size.dpr, step: 0, /* 0 = 起步档重测 */
          phase: contourPhase,
          color: contourStrokeColor(contourAccentHex(), resolvedScheme() !== 'light'),
        })
        contourWorkerStepOverride = 0
        contourWorkerOverBudget = 0
        return
      }
      if (contourEngine === null) return
      contourCanvas.width = Math.max(1, Math.round(size.w * size.dpr))
      contourCanvas.height = Math.max(1, Math.round(size.h * size.dpr))
      contourCanvas.style.width = size.w + 'px'
      contourCanvas.style.height = size.h + 'px'
      contourScheduleBuild(typeof delayMs === 'number'
        ? delayMs
        : firstTime ? CONTOUR_BOOT_DELAY : CONTOUR_RESIZE_DEBOUNCE)
    }

    /* ---- 阶梯构建调度器（"启动那一下很难受"的完整解）----
     * 一次 build = 覆盖率验证器最多 32 轮全场评估；一次 extract+draw =
     * 起步档 45ms。三个都是长任务，绝不能堆在挂载帧或某个 RO 回调里。
     * 阶梯把"出图"和"出好图"拆开：
     *   第 1 档（粗）：立刻有地形（~14ms），窗口不空着；
     *   中间档 → 地板档（contourStepFor）：每档一个独立任务，
     *   档间让出 ~4 帧（CONTOUR_REFINE_GAP）—— 输入永远排在"一帧动画"
     *   后面而不是排在"整场地形重建"后面。
     * 生成号（ladderGen）保证：新调度会掐死旧阶梯（连拖窗口时不会
     * 有几条阶梯同时在爬）。 */
    let contourLastSize = null
    let contourBuildTimer = null
    let contourLadderGen = 0
    const CONTOUR_BOOT_DELAY = 350 /* 首建让开宿主启动风暴（首屏渲染/字体/壁纸 fetch） */
    const CONTOUR_RESIZE_DEBOUNCE = 120 /* 拖动窗口期间的连续 RO 合并成一次重建 */
    const CONTOUR_REFINE_GAP = 70

    function contourScheduleBuild(delayMs) {
      contourLadderGen += 1
      const gen = contourLadderGen
      if (contourBuildTimer !== null) {
        try { clearTimeout(contourBuildTimer) } catch { /* 无 timer */ }
      }
      contourBuildTimer = setTimeout(() => {
        contourBuildTimer = null
        if (gen !== contourLadderGen) return
        if (contourEngine === null || contourLastSize === null) return
        const w = contourLastSize.w
        const h = contourLastSize.h
        /* 重建 = 回到起步画质重测：清成本对账与降级计数。 */
        contourStepNow = 0
        contourOverBudget = 0
        contourLastField = -1
        const floor = contourStepFor(w, h)
        const coarse = Math.max(floor, Math.min(40, Math.ceil(Math.max(w, h) / 96) * 2))
        contourLadderStage(gen, w, h, floor, coarse)
      }, delayMs)
      if (contourBuildTimer && typeof contourBuildTimer.unref === 'function') contourBuildTimer.unref()
    }

    function contourLadderStage(gen, w, h, floor, step) {
      if (gen !== contourLadderGen || contourEngine === null) return
      contourEngine.build(w, h, step)
      contourRefresh(true)
      if (step <= floor) return /* 阶梯走完：已在起步画质 */
      const mid = Math.max(floor, Math.floor((step + floor) / 2))
      const next = mid === step ? floor : mid
      contourBuildTimer = setTimeout(() => {
        contourBuildTimer = null
        contourLadderStage(gen, w, h, floor, next)
      }, CONTOUR_REFINE_GAP)
      if (contourBuildTimer && typeof contourBuildTimer.unref === 'function') contourBuildTimer.unref()
    }

    /** 当前强调色（按深浅外观取值），供等高线描边用。 */
    function contourAccentHex() {
      const key = state && typeof state.accent === 'string' && Object.prototype.hasOwnProperty.call(ACCENTS, state.accent)
        ? state.accent : 'teal'
      const entry = ACCENTS[key]
      return (resolvedScheme() !== 'light' ? entry.dark : entry.light)
    }

    /**
     * 画一帧（或请求画一帧）。
     * 🔧 worker 路径：主线程**零计算** —— frame/rebuild 都只 postMessage；
     * 静态重画（配色变了/暂停补帧）走 recolor（worker 里只 draw 不 extract）。
     * `extracted` 参数（主线程语义）在 worker 路径对应 frame-vs-recolor 的选择。
     */
    function contourRefresh(forceGeometry) {
      if (contourCanvas === null) return
      const color = contourStrokeColor(contourAccentHex(), resolvedScheme() !== 'light')
      if (contourWorker !== null) {
        if (contourWorkerBusy) {
          /* 合帧里优先保留带相位的 frame；纯重画用 pending 槽。 */
          contourWorkerPending = forceGeometry
            ? {op: 'frame', phase: contourPhase, color}
            : {op: 'recolor', color}
          return
        }
        contourWorkerBusy = true
        contourWorkerMsg(forceGeometry
          ? {op: 'frame', phase: contourPhase, color}
          : {op: 'recolor', color})
        return
      }
      if (contourEngine === null) return
      const ctx = typeof contourCanvas.getContext === 'function'
        ? contourCanvas.getContext('2d') : null
      if (ctx === null || ctx === undefined) return
      const geometry = contourEngine.geometry
      if (geometry === null) return
      if (forceGeometry) contourEngine.extract(contourPhase)
      contourEngine.draw(ctx, color)
    }

    function contourFrame() {
      const gen = contourLoopGen
      if (!contourActive || contourCanvas === null) {
        contourRaf = null
        return
      }
      if (!contourWantsAnim()) {
        contourRaf = null
        contourApplySwitches()
        return
      }
      /* 🔧 worker 心跳：主线程只推相位 + 发消息（微秒级）——
       * "每次重新滑起来卡一下"的元凶（主线程长任务）在这里被根除。
       * 节流看 worker 回报的 cost（done 消息喂 contourWorkerTune）。 */
      if (contourWorker !== null) {
        const nowW = (typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now() : Date.now()
        const intervalW = Math.max(1000 / CONTOUR_FPS, contourLastCost > 0 ? contourLastCost / CONTOUR_DUTY : 0)
        if (contourLastField < 0 || nowW - contourLastField >= intervalW) {
          contourLastField = nowW
          contourPhase += CONTOUR_PHASE_STEP * contourSpeedValue()
          contourRefresh(true) /* busy 时自动进 pending 槽（合帧） */
        }
        if (gen !== contourLoopGen) return
        contourRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(contourFrame) : null
        return
      }
      const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now() : Date.now()
      const interval = Math.max(1000 / CONTOUR_FPS, contourLastCost > 0 ? contourLastCost / CONTOUR_DUTY : 0)
      if (contourLastField < 0 || now - contourLastField >= interval) {
        /* 相位只按名义步进推进（绝不按挂钟补帧）—— 那是"抽搐"的来源；
         * 机器忙时表现为慢放，不是跳变。 */
        contourLastField = now
        contourPhase += CONTOUR_PHASE_STEP * contourSpeedValue()
        contourRefresh(true)
        const cost = ((typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now() : Date.now()) - now
        contourLastCost = cost
        /* 🔧 成本自适应降级（见 contourTune 注释）：连续超预算 → 加粗网格。
         * 重建帧本身不计时（重建是 step 变化的固有代价，一次性的）。 */
        contourTune(cost)
      }
      if (gen !== contourLoopGen) return
      contourRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(contourFrame) : null
    }

    function contourStartLoop() {
      if (contourRaf !== null) return
      if (typeof requestAnimationFrame !== 'function') return
      if (!contourWantsAnim()) return
      contourLastField = -1
      contourLoopGen += 1
      contourRaf = requestAnimationFrame(contourFrame)
    }

    function contourStopLoop() {
      contourLoopGen += 1
      if (contourRaf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(contourRaf)
      contourRaf = null
    }

    /** 动画开关（reduced-motion / 页面隐藏）与配色签名的对账。 */
    function contourApplySwitches() {
      const colorSig = contourStrokeColor(contourAccentHex(), resolvedScheme() !== 'light')
      const sig = (contourWantsAnim() ? 'a' : '-') + '|' + colorSig
      if (sig === contourSig) return
      contourSig = sig
      /* 动画刚关 / 配色刚变：补画一帧完整静态图（不留半更新帧）。
       * 主线程路径看引擎就绪；worker 路径看 ready 握手完成。 */
      const layerPainted = contourWorker !== null
        ? contourWorkerReady
        : contourEngine !== null && contourEngine.geometry !== null
      if (!sig.startsWith('a') && layerPainted) {
        contourRefresh(true)
      }
      if (sig.startsWith('a')) contourStartLoop()
      else contourStopLoop()
    }

    function destroyContourLayer() {
      contourStopLoop()
      if (diag.contour !== '') { diag.contour = ''; publish() }
      /* 🔧 worker 路径：终止 + 释放 Blob-URL。画布元素随背景层拆除，
       * 已转移的控制权随之作废 —— 重挂时新建画布再谈 worker。
       * failed 标记**保留**：这台机器的 worker 起不来，别再试第二次
       * （每次尝试都会 transfer，失败后画布就废了）。 */
      contourStopWorker()
      /* 🔧 阶梯/调度任务全部掐死：gen++ 让在途回调自我作废，timer 清掉。
       * 少了这一步，拆层后 350ms/70ms 的挂起任务会把地形建到已死的引擎上。 */
      contourLadderGen += 1
      if (contourBuildTimer !== null) {
        try { clearTimeout(contourBuildTimer) } catch { /* 无 timer */ }
        contourBuildTimer = null
      }
      contourLastSize = null
      /* 滚动让路的挂起恢复计时器一并清掉（不然销毁后 140ms 它会
       * 把动画又拉起来 —— 泄漏进已死的层）。 */
      if (contourScrollTimer !== null) {
        try { clearTimeout(contourScrollTimer) } catch { /* 无 timer */ }
        contourScrollTimer = null
      }
      contourScrollPaused = false
      if (contourRo !== null) {
        try { contourRo.disconnect() } catch { /* 已断 */ }
        contourRo = null
      }
      if (contourEnvOff !== null) {
        try { contourEnvOff() } catch { /* 已解绑 */ }
        contourEnvOff = null
      }
      if (contourCanvas !== null) {
        try { contourCanvas.remove() } catch { /* 已移除 */ }
      }
      contourCanvas = null
      contourEngine = null
      contourSig = ''
      contourPhase = 0
      contourLastField = -1
      contourLastCost = 0
    }

    /**
     * 按「背景来源 = contour」挂/卸等高线层（画布是 #dmt-wallpaper 的子元素）。
     * 由 syncGlassSheet 在建层之后调用。
     */
    function syncContourLayer(on) {
      if (typeof document === 'undefined') return
      if (!on) {
        destroyContourLayer()
        return
      }
      if (wallpaperEl === null) return /* 背景层还没建，下一轮 applyNow 再来 */
      if (contourCanvas === null) {
        const canvas = document.createElement('canvas')
        canvas.setAttribute('aria-hidden', 'true')
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
        try {
          wallpaperEl.appendChild(canvas)
        } catch (error) {
          note('mount contour canvas', error)
          return
        }
        contourCanvas = canvas
        contourPhase = 0 /* 新挂载从 0 相开始（EMA 种子的瞬变防护，上游实测） */
        contourLastField = -1
        contourSig = ''
        /* 🔧 worker 优先（见节头：主线程每帧 18–45ms 长任务是"滑动启动
         * 那一下"的元凶）。成功 → 画布控制权转移，主线程此后只发消息；
         * 失败 → failed 置位，下面的尺寸/阶梯路径原样接管。
         * 注意分支：worker 已死过（failed）就直接走主线程，别写短路
         * 条件把 engine 创建一起吞了。 */
        if (!contourWorkerFailed && contourStartWorker()) {
          /* worker 已接管画布：主线程不需要引擎实例。后端显示由 ready 回执写入。 */
        } else {
          contourEngine = createContourEngine(contourSeed)
          /* 🔧 worker 起不来（CSP 拦 blob: worker 是预期内的一种）：
           * 记成 main —— 副标题会显示，用户能看到"到底在跑哪条路"。 */
          diag.contour = 'main'
          publish()
        }
        if (typeof ResizeObserver !== 'undefined') {
          contourRo = new ResizeObserver(() => {
            /* 尺寸没变内部直接 return；变了就防抖调度（不在本帧算）。 */
            contourSizeTo()
          })
          try { contourRo.observe(wallpaperEl) } catch { /* 观察失败退到 rAF 自查 */ }
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          const onEnv = () => {
            contourSig = ''
            contourApplySwitches()
          }
          window.addEventListener('blur', onEnv)
          document.addEventListener('visibilitychange', onEnv)
          /* 🔧 滚动让路：捕获阶段一个监听覆盖页面内**所有**滚动容器
           * （scroll 不冒泡但捕获路径经过 document），passive 保证我们
           * 自己绝不成为卡顿源。 */
          const onScroll = () => contourOnScroll()
          document.addEventListener('scroll', onScroll, { capture: true, passive: true })
          contourEnvOff = () => {
            window.removeEventListener('blur', onEnv)
            document.removeEventListener('visibilitychange', onEnv)
            document.removeEventListener('scroll', onScroll, { capture: true })
          }
        }
      } else if (contourCanvas.parentNode !== wallpaperEl) {
        /* 背景层被重建过（teardown→remount）：画布跟过去。 */
        try { wallpaperEl.appendChild(contourCanvas) } catch { /* 下一轮再试 */ }
      }
      /* 尺寸对齐：内部判"变没变"，变了就延迟调度阶梯构建（不在本帧算）。
       * 阶梯每一档建完自己会 refresh，静态档（速度=静止）也照样出图。 */
      contourSizeTo()
      contourApplySwitches()
    }

    /* ====================================================================== *
     * 二·六五、手绘造型（shape）—— 抄自 dsh-maid-whale-UI，只抄机制不抄美术
     *
     * 四件便宜事（它的 #1/#3/#6/#7）：
     *   ① 不规则圆角：四角各差 1–4px → "歪歪的"手绘感（纯 CSS，零资源）；
     *   ② 纸影：硬 1px 垫影 + 软散影双层，像纸片垫在桌上（和玻璃的弥散投影
     *      是两种语言，叠加时以玻璃自己的为准 —— 见下）；
     *   ③ 悬停/聚焦微抬：translateY(-1px)；
     *   ④ 侧栏分界线：右缘一条渐变发光线（它的 #3 用九宫格画片，我们没美术，
     *      用纯渐变替代，颜色吃当前配色的边框令牌）。
     *
     * 刻意不抄的（上轮评审结论）：border-image 边框画（要美术）、全树扫描器
     * （开销与误伤）、消息形状改造（与宿主排版强耦合）、装饰件。
     *
     * 门控：`html[data-dsh-shape]` 独立总闸 —— 与玻璃开关互不依赖，
     * 关掉整表消失，零残留。数值取自它的 CSS（20/23/19/22 那组四角差）。
     * ====================================================================== */

    /** 造型表元素。 */
    let shapeEl = null

    /**
     * 生成手绘造型样式表。
     * @param {object} state - 已生效设置。
     * @param {object} surfaces - 当前深浅对应的表面色。
     * @param {boolean} isDark - 深色模式。
     * @returns {string} CSS 文本；关闭时为空串。
     */
    function buildShapeSheet(state, surfaces, isDark, shapeTargets) {
      const s = state || {}
      if (s.shape !== 'on') return ''
      const surf = surfaces || {}
      const p = 'html[' + SHAPE_ATTR + '] '
      const lines = ['/* dsh-colorlab —— 手绘造型 */']
      /* 纸影：硬垫影 + 软散影（它的 --dsw-paper-shadow 数值，颜色换成
       * 当前配色的中性投影 —— 深色下黑、浅色下它的蓝灰）。 */
      const shadowHard = isDark ? 'rgba(0, 0, 0, 0.28)' : 'rgba(92, 110, 113, 0.12)'
      const shadowSoft = isDark ? 'rgba(0, 0, 0, 0.18)' : 'rgba(55, 75, 83, 0.08)'
      const paperShadow = '1px 2px 0 ' + shadowHard + ', 2px 5px 12px ' + shadowSoft

      /* ① 不规则圆角（数值：它的 textarea/dialog/menu/treeitem 那几组）。
       *    只点名已知表面，不全树扫。 */
      lines.push(p + '[class*="RlGAzG_card"]{'
        + 'border-radius:20px 23px 19px 22px !important}')
      lines.push(p + '[role="dialog"]{'
        + 'border-radius:24px 27px 22px 25px !important}')
      lines.push(p + '[role="menu"],'
        + p + '[role="listbox"],'
        + p + '[role="combobox"]{'
        + 'border-radius:15px 18px 14px 17px !important}')
      lines.push(p + '[role="treeitem"]{'
        + 'border-radius:13px 16px 12px 15px !important}')
      lines.push(p + 'button{'
        + 'border-radius:12px 14px 11px 13px !important}')
      /* 代码块与四类卡片（卡片类名来自 detectCardTargets 的检测结果，
       * 宿主重构换哈希也跟上；没检测到时跳过，重试循环会重建本表）。 */
      lines.push(p + '.md-code-block{'
        + 'border-radius:14px 17px 13px 16px !important}')
      const shapeCards = Array.isArray(shapeTargets) ? shapeTargets : []
      for (const target of shapeCards) {
        if (!target || typeof target.defClass !== 'string' || target.defClass === '') continue
        lines.push(p + '.' + target.defClass + '{'
          + 'border-radius:14px 17px 13px 16px !important}')
      }

      /* ② 纸影：输入卡与对话框。玻璃开着时这两处已有我们自己的投影语言，
       *    不叠加 —— 造型只管圆角，影子让位给玻璃（避免双重阴影打架）。
       *    两个条件都写在 html 上（shape 开 且 glass 关）—— 每条规则
       *    都必须带 shape 总闸，这是"关掉零残留"不变量的一部分。 */
      lines.push('html[' + SHAPE_ATTR + ']:not([' + GLASS_ATTR + ']) [class*="RlGAzG_card"],'
        + 'html[' + SHAPE_ATTR + ']:not([' + GLASS_ATTR + ']) [role="dialog"]{'
        + 'box-shadow:' + paperShadow + ' !important}')

      /* ③ 悬停/聚焦微抬。transform 是合成层动画，代价可忽略。 */
      lines.push(p + 'button:hover:not(:disabled){transform:translateY(-1px)}')
      lines.push(p + '[class*="RlGAzG_card"]:focus-within{'
        + 'transform:translateY(-1px)}')
      lines.push(p + 'button,'
        + p + '[class*="RlGAzG_card"]{'
        + 'transition:transform 130ms ease, box-shadow 220ms ease, border-color 130ms ease}')

      /* ④ 侧栏分界线：它的做法是九宫格画片右缘；我们用纯渐变 ——
       *    侧栏列的 border-right 换成一条"中间亮、两端渐隐"的发光线。
       *    颜色：深色下白 @ 高亮段 12%，浅色下它的墨蓝 @ 14%。 */
      const lineColor = isDark ? '255, 255, 255' : '72, 112, 132'
      lines.push(p + '[class*="_sidebarCol"]{'
        + 'border-right:0 !important}')
      lines.push(p + '[class*="_sidebarCol"]::after{'
        + 'content:"" !important;position:absolute !important;'
        + 'top:12px !important;bottom:12px !important;right:0 !important;width:1px !important;'
        + 'background:linear-gradient(to bottom,'
        + 'rgba(' + lineColor + ', 0) 0%,'
        + 'rgba(' + lineColor + ', 0.22) 18%,'
        + 'rgba(' + lineColor + ', 0.30) 50%,'
        + 'rgba(' + lineColor + ', 0.22) 82%,'
        + 'rgba(' + lineColor + ', 0) 100%) !important;'
        + 'pointer-events:none !important}')
      /* sidebarCol 得是定位元素，::after 才贴得住（宿主它本来就是 flex 列，
       * 未必有 position —— 补 relative，无副作用）。 */
      lines.push(p + '[class*="_sidebarCol"]{position:relative !important}')

      return lines.join('\n')
    }

    /**
     * 按当前设置挂/卸手绘造型表（独立于玻璃总闸）。
     * @returns {boolean} 是否生效（状态条用）。
     */
    function syncShapeSheet() {
      if (typeof document === 'undefined') return false
      const on = state.enabled !== 'off' && state.shape === 'on' && shouldApply()
      const custom = parseCustom(state && state.custom)
      const isDark = resolvedScheme() !== 'light'
      const surfaces = withOverrides(SURFACES[state && state.surface] || SURFACES.standard, custom.surface)
      try {
        if (on) document.documentElement.setAttribute(SHAPE_ATTR, '')
        else document.documentElement.removeAttribute(SHAPE_ATTR)
      } catch (error) {
        note('toggle shape attribute', error)
      }
      const css = on ? buildShapeSheet(state, surfaces, isDark, cardTargets) : ''
      if (css === '') {
        if (shapeEl !== null) {
          try {
            shapeEl.remove()
          } catch (error) {
            note('remove shape sheet', error)
          }
          shapeEl = null
        }
        diag.shape = 'off'
        return false
      }
      try {
        if (shapeEl === null) {
          shapeEl = document.createElement('style')
          shapeEl.dataset.plugin = 'dsh-colorlab'
          shapeEl.dataset.pluginCss = SHAPE_SHEET_ID
          document.head.appendChild(shapeEl)
        }
        writeSheet(shapeEl, css)
        diag.shape = 'on'
      } catch (error) {
        note('install shape sheet', error)
        diag.shape = 'error'
      }
      return true
    }


    /* ====================================================================== *
     * 二·七、LaTeX 代码块：让配色回到 Sublime 的样子
     *
     * 做法是把**两边的 scope 表**拉平对照（不是看截图猜颜色）：
     *
     *   Sublime `LaTeX.sublime-syntax` / `TeX.sublime-syntax`
     *     \bi \zh  → support.function.general.latex   → Mariana: support.function → #6699CC 蓝
     *     \ 反斜杠 → punctuation.definition.backslash  → Mariana: punctuation.definition → #5FB4B4 青
     *     { }      → punctuation.definition.arguments  → #5FB4B4 青
     *     $ … $    → punctuation.definition.string.*   → #5FB4B4 青
     *     数学命令  → keyword.other.math.greek/…       → Mariana: keyword → #C695C6 紫
     *     数学数字  → constant.numeric                 → #F9AE58 橙
     *     数学标识符→ variable.other.math              → 无色（继承正文）
     *
     *   Shiki 的 LaTeX 语法 + css-variables 主题
     *     support.function.*                       → function   → #6699CC 蓝 ✓
     *     punctuation.definition.arguments.*       → punctuation→ 灰 ✗（应青）
     *     punctuation.definition.function.tex（\）  → 无规则 → 继承 ✗（应青）
     *     punctuation.section.embedded.*.math（$）  → 无规则 → 继承 ✗（应青）
     *     constant.character.math.tex（数学命令）   → 无规则 → 继承 ✗（应紫）
     *     整个 $…$ 块外层套了 `support.class.math.block.*` → 匹配主题的 `support` 规则
     *                                              → 整块 constant → 全橙 ✗（Sublime 是紫命令+白标识符）
     *
     * 所以 LaTeX 的偏色有两个来源：
     *   1. 数学块被 `support` 规则整块染成 constant（橙）；
     *   2. 括号 / 反斜杠 / `$` 这些 punctuation.definition 落到灰或无色。
     *
     * Shiki 的令牌是**按 scope 前缀**归并的（一个 scope 只能落一个令牌，一个令牌只能
     * 一个颜色），而 Sublime 是按 scope 精确上色 —— 所以不可能 1:1。能做的是把
     * **LaTeX 块内**的这两个令牌改成 Sublime 对应色，其它语言不受影响：
     *
     *   constant    → #C695C6 紫（数学命令压过数学数字：命令远比裸数字常见）
     *   punctuation → #5FB4B4 青（`punctuation.definition` 在 Mariana 里就是青）
     *
     * 为什么必须**按块**而不是全局：全局把 constant 改紫会让 Python/JS 的数字也变紫，
     * 而 Sublime 里 constant.numeric 是橙。只有 LaTeX 需要这个偏移。
     * ====================================================================== */

    /** LaTeX 代码块的标记类名（运行时打在 `<pre class="shiki">` 上）。 */
    /** LaTeX 代码块的标记类名（运行时打在 `<pre class="shiki">` 上）。 */
    const LATEX_BLOCK_CLASS = 'dmt-latex'

    /**
     * 我们自己的渲染层类名。
     *
     * 为什么用「兄弟层」而不是直接改写宿主的 DOM：宿主的代码块有两条渲染路径 ——
     *   流式：React 自己管 `<pre><code>`
     *   静态：`<div dangerouslySetInnerHTML={{__html: Shiki输出}}>`（文件预览走这条）
     * 前一条里 React 持有 text 节点引用，改写会让它更新到已脱离的节点上、
     * 流式输出就卡住。所以**一行不动宿主的节点**：把它 `display:none`，
     * 在同一个 `<pre>` 里追加我们自己的 `<code>`。宿主照常更新它的隐藏副本，
     * 我们靠观察器发现内容变了就重画。
     */
    const TEX_LAYER_CLASS = 'dmt-tex-layer'

    /** 被隐藏的宿主 `<code>` 挂的类。 */
    const TEX_HIDDEN_CLASS = 'dmt-tex-hidden'

    /* @dsh-tex-assets:start —— 由 tools/embed-tex-assets.mjs 生成，请勿手改。
     改动请改 tools/ 下的真源，然后重新运行：node tools/embed-tex-assets.mjs */

    /* Sublime LaTeX/TeX 语法（编译自 LaTeX.sublime-syntax + TeX.sublime-syntax）。
       体积较大，所以放在工厂函数末尾，不占前面的可读性。 */
    const TEX_GRAMMAR = {"scope":"text.tex.latex","extends":"text.tex","contexts":{"prototype":[{"include":"comments"}],"main":[{"include":"latex"},{"include":"packages"},{"include":"macros"},{"include":"controls"},{"include":"character-codes"},{"include":"braces"},{"include":"boxes"},{"include":"block-math"},{"include":"inline-math"},{"include":"registers"},{"include":"tex-constants"},{"include":"general-constants"},{"include":"general-commands"}],"comments":[{"match":"%.*$\\n?","scope":"comment.line.percentage.tex"},{"include":"merge-conflict-markers"}],"merge-conflict-markers":[{"match":"^(<{7})(?:\\s+(\\S.*?))?$\\n?","scope":"meta.block.conflict.begin.diff","captures":{"1":"punctuation.section.block.begin.diff","2":"entity.name.section.diff"}},{"match":"^(>{7})(?:\\s+(\\S.*?))?$\\n?","scope":"meta.block.conflict.end.diff","captures":{"1":"punctuation.section.block.end.diff","2":"entity.name.section.diff"}},{"match":"^(\\|{7}|={7})(?:\\s+(\\S.*?))?$\\n?","scope":"meta.block.conflict.separator.diff","captures":{"1":"punctuation.section.block.diff","2":"entity.name.section.diff"}}],"braces":[{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","push":"brace-group-body"}],"brace-group-begin":[{"meta_include_prototype":false},{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","pop":1}],"brace-group-body":[{"meta_scope":"meta.group.brace.tex"},{"include":"brace-group-end"},{"include":"main"}],"brace-group-end":[{"match":"\\}","scope":"punctuation.definition.group.brace.end.tex","pop":1}],"boxes":[{"match":"((\\\\)[hvmf]box)\\s*(\\{)","captures":{"1":"support.function.box.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_scope': 'meta.function.box.latex'}","{'include': 'brace-group-end'}","{'include': 'main'}"]},{"match":"((\\\\)(?:framebox|makebox))\\b","captures":{"1":"support.function.box.latex","2":"punctuation.definition.backslash.latex"},"push":["box-meta","argument","optional-arguments"]},{"match":"((\\\\)parbox)\\b","captures":{"1":"support.function.box.latex","2":"punctuation.definition.backslash.latex"},"push":["box-meta","argument","argument","optional-arguments"]},{"match":"((\\\\)raisebox)\\b","captures":{"1":"support.function.box.latex","2":"punctuation.definition.backslash.latex"},"push":["box-meta","argument","optional-arguments"]}],"box-body":[{"meta_scope":"meta.function.box.tex"},{"include":"brace-group-end"},{"include":"main"}],"character-codes":[{"match":"(\\\\)(?:cat|math|uc|lc|del|sf)code(?![A-Za-z@])","scope":"keyword.control.character-code.tex","captures":{"1":"punctuation.definition.backslash.tex"},"push":["character-code-meta","character-code-value","tex-assignment","character-code-number"]}],"character-code-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.character-code.tex"},{"include":"immediately-pop"}],"character-code-number":[{"include":"tex-simple-integer"},{"include":"else-pop"},{"include":"paragraph-pop"}],"character-code-assignment":[{"match":"=","scope":"keyword.operator.assignment.tex","pop":1},{"include":"else-pop"},{"include":"paragraph-pop"}],"character-code-value":[{"include":"tex-simple-integer"},{"include":"else-pop"},{"include":"paragraph-pop"}],"controls":[{"match":"(\\\\)ifcase(?![A-Za-z@])","scope":"keyword.control.conditional.switch.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)or(?![A-Za-z@])","scope":"keyword.control.conditional.case.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)loop(?![A-Za-z@])","scope":"keyword.control.loop.do-while.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)repeat(?![A-Za-z@])","scope":"keyword.control.loop.end.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)expandafter(?![A-Za-z@])","scope":"keyword.control.flow.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)if(?:cat|dim|eof|false|hbox|hmode|inner|mmode|num|odd|true|undefined|vbox|vmode|void|x)?(?![A-Za-z@])","scope":"keyword.control.conditional.if.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)else(?![A-Za-z@])","scope":"keyword.control.conditional.else.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)fi(?![A-Za-z@])","scope":"keyword.control.conditional.end.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)input(?![A-Za-z@])","scope":"meta.function.input.tex keyword.control.input.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)relax(?![A-Za-z@])","scope":"keyword.control.flow.relax.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"general-commands":[{"include":"begin-end-commands"},{"match":"(\\\\)[A-Za-z@]+","scope":"support.function.general.latex","captures":{"1":"punctuation.definition.backslash.latex"}}],"general-constants":[{"match":"(\\\\\\\\)(?:(\\[)\\s*-?((?:[0-9]|\\.)*)\\s*(\\w*)\\s*(\\]))?","captures":{"1":"constant.character.newline.latex","2":"punctuation.definition.group.bracket.begin.newline.latex","3":"constant.numeric.newline.latex","4":"keyword.other.newline.latex","5":"punctuation.definition.group.bracket.begin.newline.latex"}},{"match":"\\\\\\\\","scope":"constant.character.newline.tex"},{"match":"&","scope":"constant.character.ampersand.tex"},{"match":"~","scope":"constant.character.space.tex"},{"include":"escaped-character"}],"escaped-character":[{"match":"(\\\\)[^A-Za-z@]","scope":"constant.character.escape.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"tex-constants":[{"match":"(\\\\)(?:(?:pre)?tolerance|[hv]badness|(?:doublehyphen|finalhyphen|adj)demerits|looseness|pausing|holdinginserts|language|uchyph|lefthyphenmin|righthyphenmin|globaldefs|maxdeadcycles|hangafter|fam|mag|(?:escape|defaulthyphen|defaultskew|endline|newline)char|delimiterfactor|time|day|month|year|showboxbreadth|showboxdepth|errorcontextlines|[hv]fuzz|overfullrule|[hv]size|maxdepth|splitmaxdepth|boxmaxdepth|lineskiplimit|delimitershortfall|nulldelimiterspace|scriptspace|mathsurround|predisplaysize|displaywidth|displayindent|parindent|hangindent|[hv]offset|(?:small|med|big)skipamount|normallineskiplimit|jot|(?:baseline|line|par|(?:above|below)display(?:short)?|left|right|top|splittop|tab|space|xspace|parfill|(?:thin|med|thick)mu|normalbaseline|normalline|hide)skip|tracing(?:online|macros|stats|paragraphs|pages|output|lostchars|commands|restores)|(?:line|hyphen|exhyphen|binop|rel|club|widow|displaywidow|broken|predisplay|postdisplay|interline|floating|output|inter(?:display|footnote)line)penalty|maxdimen|centering|p@|z@|z@skip|voidb@x|magstephalf|magstep\\d|@ne|tw@|thr@@|sixt@@n|@cclv|@cclvi|@m|@M|@MM|m@ne|count@|dimen@|dimen@i|dimen@ii|skip@|toks@|insc@unt|allocationnumber)(?![A-Za-z@])","scope":"support.function.tex","captures":{"1":"punctuation.definition.backslash.tex"},"push":["tex-dimension-value","tex-assignment"]},{"match":"(\\\\)(?:(?:thin|negthin|en)space|enskip|q?quad|(?:small|med|big)skip|[lr]q|[lr]brack|space|empty|null)(?![A-Za-z@])","scope":"support.function.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"registers":[{"include":"register-allocations"},{"include":"register-definitions"}],"register-allocations":[{"match":"(\\\\)new(?:box|count|dimen|muskip|skip|toks)(?![A-Za-z@])","scope":"keyword.declaration.register.tex storage.modifier.register.tex","captures":{"1":"punctuation.definition.backslash.tex"},"push":"register-allocation-identifier"}],"register-allocation-identifier":[{"meta_scope":"meta.register.tex"},{"match":"(?=\\{)","set":["register-allocation-wrapped-identifier","brace-group-begin"]},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])","scope":"entity.name.constant.tex","captures":{"1":"punctuation.definition.backslash.tex"},"pop":1},{"include":"paragraph-pop"},{"include":"else-pop"}],"register-allocation-wrapped-identifier":[{"meta_scope":"meta.register.tex meta.group.brace.tex"},{"include":"brace-group-end"},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])","scope":"entity.name.constant.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"register-definitions":[{"match":"(\\\\)((?:box|count|dimen|muskip|skip|toks))(?![A-Za-z@])","captures":{"1":"punctuation.definition.backslash.tex","2":"storage.type.tex"},"push":["tex-dimension-value","tex-assignment","register-definition-identifier"]}],"register-definition-identifier":[{"meta_scope":"meta.register.tex"},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])","scope":"support.function.general.tex","captures":{"1":"punctuation.definition.backslash.tex"},"pop":1},{"include":"tex-simple-integer"},{"include":"paragraph-pop"},{"include":"else-pop"}],"tex-simple-integer":[{"match":"([+-]?)\\s*\\d+","scope":"meta.number.integer.decimal.tex constant.numeric.value.tex","captures":{"1":"keyword.operator.arithmetic.tex"},"pop":1},{"match":"([+-]?)\\s*\"(?:[0-9A-F])+","scope":"meta.number.integer.hexadecimal.tex constant.numeric.value.tex","captures":{"1":"keyword.operator.arithmetic.tex"},"pop":1},{"match":"([+-]?)\\s*'[0-7]+","scope":"meta.number.integer.octal.tex constant.numeric.value.tex","captures":{"1":"keyword.operator.arithmetic.tex"},"pop":1},{"match":"([+-]?)\\s*(`)(\\\\)?((?:\\^\\^(?:(?:[0-9a-f])(?:[0-9a-f])|.))|.)","scope":"meta.number.integer.tex constant.numeric.value.tex","captures":{"1":"keyword.operator.arithmetic.tex","2":"keyword.operator.tex","3":"punctuation.definition.backslash.tex","4":"constant.character.tex"},"pop":1}],"tex-assignment":[{"match":"=","scope":"keyword.operator.assignment.tex","pop":1},{"include":"else-pop"},{"include":"paragraph-pop"}],"tex-dimension-value":[{"match":"(-?)(?:\\d+(\\.)\\d*|(\\.)\\d+)","scope":"constant.numeric.value.tex","captures":{"1":"keyword.operator.arithmetic.tex","2":"punctuation.separator.decimal.tex","3":"punctuation.separator.decimal.tex"},"set":["tex-dimension-glue","tex-dimension-decimal-float"]},{"match":"(-?)\\d+","scope":"constant.numeric.value.tex","captures":{"1":"keyword.operator.arithmetic.tex"},"set":["tex-dimension-glue","tex-dimension-decimal-integer"]},{"match":"(`)(\\\\)?((?:\\^\\^(?:(?:[0-9a-f])(?:[0-9a-f])|.))|.)","captures":{"1":"keyword.operator.tex","2":"punctuation.definition.backslash.tex","3":"constant.character.tex"},"set":["tex-dimension-glue","tex-dimension-decimal-integer"]},{"include":"else-pop"},{"include":"paragraph-pop"}],"tex-dimension-glue":[{"match":"(?:plus|minus)(?![A-Za-z@])","scope":"keyword.operator.arithmetic.tex","set":"tex-dimension-value"},{"include":"else-pop"},{"include":"paragraph-pop"}],"tex-dimension-decimal-float":[{"meta_scope":"meta.number.float.decimal.tex"},{"include":"tex-dimension-suffix"}],"tex-dimension-decimal-integer":[{"meta_scope":"meta.number.integer.decimal.tex"},{"include":"tex-dimension-suffix"}],"tex-dimension-suffix":[{"match":"(?:pt|pc|bp|in|cm|mm|dd|cc|sp|ex|em|fil|fill|filll|mu)","scope":"constant.numeric.suffix.tex","pop":1},{"include":"else-pop"},{"include":"paragraph-pop"}],"macros":[{"match":"(\\\\)[gex]?def(?![A-Za-z@])","scope":"keyword.declaration.function.tex storage.modifier.definition.tex","captures":{"1":"punctuation.definition.backslash.tex"},"push":"def-function-expect-identifier"},{"match":"(\\\\)(?:outer|long|global)(?![A-Za-z@])","scope":"storage.modifier.definition.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"include":"latex-newcommand-macros"},{"include":"xparse-newcommand-macros"}],"def-function-expect-identifier":[{"meta_scope":"meta.function.tex"},{"match":"(?=\\\\)","set":"def-function-identifier"},{"include":"paragraph-pop"},{"include":"else-pop"}],"def-function-identifier":[{"meta_scope":"meta.function.identifier.tex"},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])","scope":"entity.name.definition.tex","captures":{"1":"punctuation.definition.backslash.tex"},"set":"def-function-parameters"},{"include":"paragraph-pop"},{"include":"else-pop"}],"def-function-parameters":[{"meta_content_scope":"meta.function.parameters.tex"},{"match":"(?=\\{)","set":["def-function-body-meta","macro-braces-begin"]},{"match":"(\\#)[0-9]","scope":"variable.parameter.tex","captures":{"1":"punctuation.definition.variable.tex"}},{"include":"escaped-character"},{"include":"paragraph-pop"}],"def-function-body-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.body.tex"},{"include":"immediately-pop"}],"macro-braces":[{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","push":"macro-braces-body"}],"macro-braces-begin":[{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","set":"macro-braces-body"}],"macro-braces-end":[{"match":"\\}","scope":"punctuation.definition.group.brace.end.tex","pop":1}],"macro-braces-body":[{"meta_scope":"meta.group.brace.tex"},{"include":"macro-braces-end"},{"include":"macro-braces-content"}],"macro-braces-content":[{"include":"macro-braces"},{"include":"macro-placeholders"},{"include":"controls"},{"include":"registers"},{"include":"math-builtin"},{"include":"tex-constants"},{"include":"general-constants"},{"include":"general-commands"}],"macro-placeholders":[{"match":"(#+)(\\d)","scope":"variable.parameter.tex","captures":{"1":"punctuation.definition.placeholder.tex","2":"meta.number.integer.decimal.tex constant.numeric.value.tex"}}],"inline-math":[{"match":"\\$","scope":"string.other.math.tex punctuation.definition.string.begin.tex","push":"inline-math-dollar-body"},{"include":"inline-math-parens"},{"include":"inline-math-ensuremath"}],"inline-math-dollar-body":[{"meta_scope":"meta.environment.math.inline.dollar.tex"},{"meta_content_scope":"markup.math.inline"},{"include":"inline-math-dollar-end"},{"include":"math-content"}],"inline-math-dollar-end":[{"match":"\\$","scope":"string.other.math.tex punctuation.definition.string.end.tex","pop":1}],"block-math":[{"match":"\\$\\$","scope":"string.other.math.tex punctuation.definition.string.begin.tex","push":"block-math-dollar-body"},{"include":"block-math-brackets"},{"include":"block-math-begin-end-command"}],"block-math-dollar-body":[{"meta_scope":"meta.environment.math.block.dollar.tex"},{"meta_content_scope":"markup.math.block"},{"include":"block-math-dollar-end"},{"include":"math-content"}],"block-math-dollar-end":[{"match":"\\$\\$","scope":"string.other.math.tex punctuation.definition.string.end.tex","pop":1}],"math-content":[{"match":"(?=\\})","pop":1},{"include":"verb"},{"include":"text-decorators"},{"include":"references"},{"include":"begin-end-commands"},{"include":"math-builtin"},{"include":"math-brackets"},{"include":"math-braces"},{"include":"boxes"},{"include":"math-commands"},{"include":"math-operators"},{"include":"math-variables"},{"include":"math-numbers"},{"include":"general-constants"}],"math-builtin":[{"include":"math-greeks"},{"include":"math-functions"},{"include":"math-relations"},{"include":"math-largeops"},{"include":"math-binops"},{"include":"math-symbols"},{"include":"math-accents"},{"include":"math-arrows"},{"include":"math-delimiters"}],"math-greeks":[{"match":"(\\\\)(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|o|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![A-Za-z@])","scope":"keyword.other.math.greek.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-functions":[{"match":"(\\\\)(?:arccos|cos|csc|exp|ker|limsup|min|sinh|arcsin|cosh|deg|gcd|lg|ln|Pr|sup|arctan|cot|det|hom|lim|log|sec|tan|arg|coth|dim|inf|liminf|max|sin|tan|pmod|bmod)(?![A-Za-z@])","scope":"keyword.other.math.function.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-relations":[{"match":"(\\\\)(?:leq|lq|geq|ge|equiv|prec|succ|sim|preceq|succeq|simeq|ll|gg|subset|supset|approx|subseteq|supseteq|cong|sqsubseteq|sqsupseteq|bowtie|in|notin|ne|ni|owns|vdash|dashv|models|smile|mid|doteq|frown|parallel|perp|propto)(?![A-Za-z@])","scope":"keyword.other.math.relation.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-largeops":[{"match":"(\\\\)(?:sum|prod|coprod|int|oint|bigcap|bigcup|bigsqcup|bigvee|bigwedge|bigodot|bigotimes|bigoplus|biguplus)(?![A-Za-z@])","scope":"keyword.other.math.large-operator.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-binops":[{"match":"(\\\\)(?:pm|mp|setminus|cdot|times|ast|star|diamond|circ|bullet|div|cap|cup|uplus|sqcap|sqcup|triangleleft|triangleright|wr|bigcirc|bigtriangleup|bigtriangledown|vee|lor|wedge|land|oplus|ominus|otimes|oslash|odot|dagger|ddagger|amalg)(?![A-Za-z@])","scope":"keyword.other.math.binary-operator.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-symbols":[{"match":"(\\\\)(?:aleph|hbar|imath|jmath|ell|wp|Re|Im|partial|infty|prime|emptyset|nabla|surd|top|bot|\\||angle|triangle|backslash|forall|exists|neg|lnot|flat|natural|sharp|clubsuit|diamondsuit|heartsuit|spadesuit)(?![A-Za-z@])","scope":"keyword.other.math.symbol.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-accents":[{"match":"(\\\\)(?:hat|widehat|check|tilde|widetilde|acute|grave|dot|ddot|breve|bar|vec)(?![A-Za-z@])","scope":"keyword.other.math.accent.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-arrows":[{"match":"(\\\\)(?:leftarrow|gets|longleftarrow|Leftarrow|Longleftarrow|rightarrow|to|longrightarrow|Rightarrow|Longrightarrow|leftrightarrow|longleftrightarrow|Leftrightarrow|Longleftrightarrow|mapsto|longmapsto|hookleftarrow|hookrightarrow|uparrow|Uparrow|downarrow|Downarrow|updownarrow|Updownarrow|nearrow|searrow|nwarrow|swarrow)(?![A-Za-z@])","scope":"keyword.other.math.arrow.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-delimiters":[{"match":"(\\\\)(?:lbrack|lbrace|langle|rbrack|rbrace|rangle|vert|lfloor|lceil|Vert|rfloor|rceil)(?![A-Za-z@])","scope":"keyword.other.math.delimiter.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-commands":[{"match":"(\\\\)[A-Za-z@]+","scope":"support.function.math.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-operators":[{"match":"[<>]=?|=","scope":"keyword.operator.comparison.tex"},{"match":"[-+*/!]","scope":"keyword.operator.arithmetic.tex"},{"match":"_","scope":"punctuation.separator.subscript.tex"},{"match":"\\^","scope":"punctuation.separator.superscript.tex"}],"math-braces":[{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","push":"math-brace-group-body"}],"math-brace-group-body":[{"meta_scope":"meta.group.brace.tex"},{"include":"brace-group-end"},{"include":"math-content"}],"math-brackets":[{"match":"\\(","scope":"punctuation.section.parens.begin.tex"},{"match":"\\)","scope":"punctuation.section.parens.end.tex"},{"match":"\\[","scope":"punctuation.section.brackets.begin.tex"},{"match":"\\]","scope":"punctuation.section.brackets.end.tex"},{"match":"(\\\\){","scope":"punctuation.section.braces.begin.tex constant.character.escape.tex","captures":{"1":"punctuation.definition.backslash.tex"}},{"match":"(\\\\)}","scope":"punctuation.section.braces.end.tex constant.character.escape.tex","captures":{"1":"punctuation.definition.backslash.tex"}}],"math-numbers":[{"match":"\\d*(\\.)\\d+","scope":"meta.number.float.decimal.tex constant.numeric.value.tex","captures":{"1":"punctuation.separator.decimal.tex"}},{"match":"\\d+","scope":"meta.number.integer.decimal.tex constant.numeric.value.tex"}],"math-variables":[{"match":"[A-Za-z]+","scope":"variable.other.math.tex markup.italic.math.tex"}],"else-pop":[{"match":"(?=\\S)","pop":1}],"immediately-pop":[{"match":"","pop":1}],"paragraph-pop":[{"match":"^(?=\\s*$)","pop":1}],"unmatched-brace-pop":[{"match":"(?=})","pop":1}],"latex":[{"include":"preamble"},{"include":"structure"},{"include":"includes"},{"include":"sections"},{"include":"text-decorators"},{"include":"footnote"},{"include":"references"},{"include":"verbatim"},{"include":"verb"},{"include":"url"},{"include":"graphics"},{"include":"lists"}],"general-optional-arguments":[{"match":"\\[","scope":"punctuation.definition.group.bracket.begin.latex","push":["{'meta_scope': 'meta.group.bracket.latex'}","{'match': '\\\\]', 'scope': 'punctuation.definition.group.bracket.end.latex', 'pop': 1}","{'include': 'general-constants'}","{'include': 'general-commands'}","{'include': 'braces'}","{'match': '[A-Za-z[:digit:]-]*(?=\\\\s*\\\\=)', 'scope': 'variable.parameter.bracket.latex'}"]}],"argument-brace":[{"meta_scope":"meta.group.brace.tex"},{"match":"\\}","scope":"punctuation.definition.group.brace.end.tex","pop":1},{"include":"main"}],"argument":[{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","set":"argument-brace"},{"include":"else-pop"}],"optional-arguments":[{"include":"general-optional-arguments"},{"include":"else-pop"}],"latex-newcommand-macros":[{"match":"(\\\\)(?:new|renew|provide)command(?:\\*|(?![A-Za-z@]))","scope":"keyword.declaration.function.latex storage.modifier.newcommand.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["latex-newcommand-definition","latex-newcommand-optarg","latex-newcommand-argspec","latex-newcommand-commandname"]},{"match":"(\\\\)DeclareMathOperator(?:\\*|(?![A-Za-z@]))","scope":"support.function.declare-math-operator.latex storage.modifier.newcommand.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["latex-newcommand-definition","latex-newcommand-commandname"]}],"latex-newcommand-argspec":[{"match":"\\[","scope":"punctuation.definition.group.bracket.begin.latex","push":"latex-newcommand-argspec-body"},{"include":"paragraph-pop"},{"include":"else-pop"}],"latex-newcommand-argspec-body":[{"clear_scopes":1},{"meta_scope":"meta.function.parameters.latex"},{"match":"\\]","scope":"punctuation.definition.group.bracket.end.latex","pop":2},{"match":"\\d+\\b","scope":"meta.number.integer.decimal.latex constant.numeric.value.latex"},{"include":"general-constants"},{"include":"general-commands"},{"include":"macro-braces"}],"latex-newcommand-optarg":[{"match":"\\[","scope":"punctuation.definition.group.bracket.begin.latex","push":"latex-newcommand-optarg-body"},{"include":"paragraph-pop"},{"include":"else-pop"}],"latex-newcommand-optarg-body":[{"clear_scopes":1},{"meta_scope":"meta.function.parameters.default-value.latex"},{"match":"\\]","scope":"punctuation.definition.group.bracket.end.latex","pop":2},{"include":"general-constants"},{"include":"general-commands"},{"include":"macro-braces"}],"latex-newcommand-commandname":[{"match":"(?=\\{)","set":["latex-newcommand-wrapped-commandname","brace-group-begin"]},{"match":"(?=\\\\)","set":"latex-newcommand-bare-commandname"},{"include":"paragraph-pop"},{"include":"else-pop"}],"latex-newcommand-bare-commandname":[{"clear_scopes":1},{"meta_scope":"meta.function.identifier.latex"},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])","scope":"entity.name.newcommand.latex","captures":{"1":"punctuation.definition.backslash.latex"},"pop":1},{"include":"paragraph-pop"},{"include":"else-pop"}],"latex-newcommand-wrapped-commandname":[{"clear_scopes":1},{"meta_scope":"meta.function.identifier.latex"},{"include":"brace-group-end"},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])","scope":"entity.name.newcommand.latex","captures":{"1":"punctuation.definition.backslash.latex"}}],"latex-newcommand-definition":[{"meta_scope":"meta.function.latex"},{"match":"(?=\\{)","set":["def-function-body-meta","macro-braces-begin"]},{"match":"(?=\\\\)","set":"latex-newcommand-expression"},{"include":"paragraph-pop"},{"include":"else-pop"}],"latex-newcommand-expression":[{"meta_scope":"meta.function.body.latex"},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])","scope":"support.function.general.latex","captures":{"1":"punctuation.definition.backslash.latex"},"pop":1},{"match":"\\S\\b","scope":"constant.character.escape.latex","captures":{"1":"punctuation.definition.backslash.latex"},"pop":1},{"include":"paragraph-pop"},{"include":"else-pop"}],"xparse-newcommand-macros":[{"match":"(\\\\)(?:(?:New|Renew|Provide|Declare)(:?Expandable)?DocumentCommand)(?![A-Za-z@])","scope":"keyword.declaration.function.latex storage.modifier.newcommand.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["latex-newcommand-definition","xparse-newcommand-argspec","latex-newcommand-commandname"]}],"xparse-newcommand-argspec":[{"match":"(?=\\{)","set":["xparse-newcommand-argspec-body","brace-group-begin"]},{"include":"paragraph-pop"},{"include":"else-pop"}],"xparse-newcommand-argspec-body":[{"clear_scopes":1},{"meta_scope":"meta.function.parameters.latex"},{"include":"brace-group-end"},{"include":"macro-braces"},{"include":"xparse-newcommand-single-argspec"},{"include":"general-constants"},{"include":"general-commands"},{"include":"paragraph-pop"}],"xparse-newcommand-single-argspec":[{"match":"[+!]","scope":"storage.modifier.latex"},{"match":"[movsb]","scope":"storage.type.latex"},{"match":"t","scope":"storage.type.latex","push":"xparse-newcommand-args-token"},{"match":"[rd]","scope":"storage.type.latex","push":["xparse-newcommand-args-token","xparse-newcommand-args-token"]},{"match":"[RD]","scope":"storage.type.latex","push":["xparse-newcommand-optarg-value","xparse-newcommand-args-token","xparse-newcommand-args-token"]},{"match":"O","scope":"storage.type.latex","push":"xparse-newcommand-optarg-value"},{"match":"e","scope":"storage.type.latex","push":"xparse-newcommand-args-token"},{"match":"E","scope":"storage.type.latex","push":["xparse-newcommand-optarg-value","xparse-newcommand-args-token"]},{"match":">","scope":"storage.modifier.latex"}],"xparse-newcommand-args-token":[{"meta_include_prototype":false},{"include":"unmatched-brace-pop"},{"match":"(?=\\{)","set":["xparse-newcommand-args-wrapped-token","brace-group-begin"]},{"match":"(?=\\S)","set":"xparse-newcommand-args-bare-token"},{"include":"paragraph-pop"}],"xparse-newcommand-args-bare-token":[{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])(?![A-Za-z@])","scope":"constant.other.token.latex","captures":{"1":"punctuation.definition.backslash.latex"},"pop":1},{"match":"\\S","scope":"constant.character.latex constant.other.token.latex","pop":1},{"include":"paragraph-pop"}],"xparse-newcommand-args-wrapped-token":[{"meta_scope":"meta.group.brace.tex"},{"include":"brace-group-end"},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])(?![A-Za-z@])","scope":"constant.other.token.latex","captures":{"1":"punctuation.definition.backslash.latex"}},{"match":"\\S","scope":"constant.character.latex constant.other.token.latex"}],"xparse-newcommand-optarg-value":[{"meta_include_prototype":false},{"include":"unmatched-brace-pop"},{"match":"(?=\\{)","set":["xparse-newcommand-optarg-wrapped-value","brace-group-begin"]},{"match":"(?=\\S)","set":"xparse-newcommand-optarg-bare-value"},{"include":"paragraph-pop"}],"xparse-newcommand-optarg-bare-value":[{"clear_scopes":1},{"meta_scope":"meta.function.parameters.default-value.latex"},{"match":"(\\\\)(?:[A-Za-z@]+|[^A-Za-z@])(?![A-Za-z@])","scope":"support.function.latex","captures":{"1":"punctuation.definition.backslash.latex"},"pop":1},{"match":"\\S","pop":1},{"include":"paragraph-pop"}],"xparse-newcommand-optarg-wrapped-value":[{"clear_scopes":1},{"meta_scope":"meta.function.parameters.default-value.latex meta.group.brace.tex"},{"include":"brace-group-end"},{"include":"macro-braces-content"}],"box-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.box.latex"},{"include":"immediately-pop"}],"preamble":[{"match":"(\\\\)documentclass\\b","scope":"meta.preamble.documentclass.latex keyword.control.preamble.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["{'meta_content_scope': 'meta.preamble.documentclass.latex'}","{'include': 'general-optional-arguments'}","{'match': '\\\\{', 'scope': 'punctuation.definition.group.brace.begin.tex', 'set': [{'meta_scope': 'meta.preamble.documentclass.latex meta.group.brace.tex'}, {'include': 'brace-group-end'}, {'match': '[A-Za-z[:digit:]-]', 'scope': 'support.class.latex'}]}","{'include': 'immediately-pop'}"]},{"match":"(\\\\)usepackage\\b","scope":"meta.preamble.usepackage.latex keyword.control.preamble.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["{'meta_content_scope': 'meta.preamble.usepackage.latex'}","{'include': 'general-optional-arguments'}","{'match': '\\\\{', 'scope': 'punctuation.definition.group.brace.begin.tex', 'set': [{'meta_scope': 'meta.preamble.usepackage.latex meta.group.brace.tex'}, {'include': 'brace-group-end'}, {'match': '[A-Za-z[:digit:]-]*', 'scope': 'support.class.latex'}]}","{'include': 'immediately-pop'}"]}],"includes":[{"match":"((\\\\)(?:include|includeonly))(\\{)","scope":"meta.function.include.latex","captures":{"1":"keyword.control.include.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_scope': 'meta.include.latex'}","{'include': 'brace-group-end'}"]}],"sections":[{"match":"((\\\\)(?:(?:sub){0,2}section|(?:sub)?paragraph|chapter|part|addpart|addchap|addsec|minisec)(?:\\*)?)(?:(\\[)([^\\[]*?)(\\]))?(\\{)","captures":{"1":"support.function.section.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"entity.name.section.latex","5":"punctuation.definition.group.brace.end.tex","6":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_scope': 'meta.section.latex'}","{'meta_content_scope': 'entity.name.section.latex'}","{'include': 'brace-group-end'}","{'include': 'main'}"]}],"structure":[{"match":"((\\\\)(?:frontmatter|mainmatter|backmatter|appendix|printindex))\\b","captures":{"1":"keyword.control.latex","2":"punctuation.definition.backslash.latex"}}],"verbatim":[{"match":"((\\\\)begin)(\\{)\\s*((?:[vV]erbatim|alltt)\\*?)\\s*(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_include_prototype': False}","{'meta_scope': 'meta.environment.verbatim.verbatim.latex'}","{'meta_content_scope': 'markup.raw.verbatim.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)\\\\s*(\\\\4)\\\\s*(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.begin.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}"]}],"lists":[{"match":"((\\\\)begin)(\\{)\\s*(itemize\\*?)\\s*(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_scope': 'meta.environment.list.itemize.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)\\\\s*(\\\\4)\\\\s*(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.begin.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}","{'include': 'main'}"]},{"match":"((\\\\)begin)(\\{)\\s*(enumerate\\*?)\\s*(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_scope': 'meta.environment.list.enumerate.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)\\\\s*(\\\\4)\\\\s*(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.begin.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}","{'include': 'main'}"]},{"match":"((\\\\)begin)(\\{)\\s*(list\\*?)\\s*(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_scope': 'meta.environment.list.list.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)\\\\s*(\\\\4)\\\\s*(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.begin.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}","{'include': 'main'}"]},{"match":"((\\\\)begin)(\\{)\\s*(description\\*?)\\s*(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_scope': 'meta.environment.list.description.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)\\\\s*(\\\\4)\\\\s*(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.begin.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}","{'include': 'main'}"]}],"inline-math-ensuremath":[{"match":"(\\\\)ensuremath(?![A-Za-z@])","scope":"meta.function.ensuremath.latex support.function.ensuremath.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":"inline-math-ensuremath-begin"}],"inline-math-ensuremath-begin":[{"meta_content_scope":"meta.function.ensuremath.latex"},{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","set":"inline-math-ensuremath-body"},{"include":"paragraph-pop"}],"inline-math-ensuremath-body":[{"meta_scope":"meta.function.ensuremath.latex meta.group.brace.tex"},{"meta_content_scope":"meta.environment.math.inline.ensuremath.latex markup.math.inline"},{"include":"brace-group-end"},{"include":"math-content"}],"inline-math-parens":[{"match":"\\\\\\(","scope":"string.other.math.latex punctuation.definition.string.begin.latex","push":"inline-math-parens-body"}],"inline-math-parens-body":[{"meta_scope":"meta.environment.math.inline.paren.latex"},{"meta_content_scope":"markup.math.inline"},{"include":"inline-math-parens-end"},{"include":"math-content"}],"inline-math-parens-end":[{"match":"\\\\\\)","scope":"string.other.math.latex punctuation.definition.string.end.latex","pop":1}],"block-math-begin-end-command":[{"match":"((\\\\)begin)(\\{)\\s*((?:align|alignat|aligned|alignedat|displaymath|eqnarray|equation|flalign|gather|gathered|math|multline|x?xalignat|split|dmath|dseries|dgroup|darray|dsuspend)\\*?)\\s*(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":"block-math-begin-end-command-body"},{"match":"((\\\\)begin)\\s*(\\{)\\s*(IEEEeqnarray\\*?)\\s*(\\})(?:\\s*(\\{)\\s*([A-Za-z@]+)\\s*(\\}))?","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex","6":"punctuation.definition.group.brace.begin.tex","7":"variable.parameter.function.latex","8":"punctuation.definition.group.brace.end.tex"},"push":"block-math-begin-end-command-body"}],"block-math-begin-end-command-body":[{"meta_content_scope":"meta.environment.math.block.latex markup.math.block"},{"include":"block-math-begin-end-command-end"},{"include":"math-content"}],"block-math-begin-end-command-end":[{"match":"((\\\\)end)(\\{)\\s*(\\4)\\s*(\\})","captures":{"1":"support.function.end.latex keyword.control.flow.end.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"pop":1}],"block-math-brackets":[{"match":"\\\\\\[","scope":"string.other.math.latex punctuation.definition.string.begin.latex","push":"block-math-brackets-body"}],"block-math-brackets-body":[{"meta_scope":"meta.environment.math.block.bracket.latex"},{"meta_content_scope":"markup.math.block"},{"include":"block-math-brackets-end"},{"include":"math-content"}],"block-math-brackets-end":[{"match":"\\\\\\]","scope":"string.other.math.latex punctuation.definition.string.end.latex","pop":1}],"graphics":[{"match":"((\\\\)includegraphics)\\b","captures":{"1":"support.function.includegraphics.latex","2":"punctuation.definition.backslash.latex"},"push":["includegraphics-meta","argument","optional-arguments"]}],"includegraphics-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.includegraphics.latex"},{"include":"immediately-pop"}],"url":[{"match":"((\\\\)(?:url|href|path))(\\{)([^}]*)(\\})","scope":"meta.function.link.url.latex","captures":{"1":"support.function.url.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"markup.underline.link.latex","5":"punctuation.definition.group.brace.end.tex"}}],"verb":[{"match":"((\\\\)verb)(\\W)","captures":{"1":"support.function.verb.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.verb.latex"},"push":["{'meta_include_prototype': False}","{'meta_scope': 'meta.environment.verbatim.verb.latex'}","{'meta_content_scope': 'markup.raw.verb.latex'}","{'match': '\\\\3', 'scope': 'punctuation.definition.verb.latex', 'pop': 1}"]}],"text-decorators":[{"include":"text-normal-select-font-family"},{"include":"text-normal-select-font-shape"},{"include":"text-normal-select-font-weight"},{"match":"(\\\\)textnormal(?![A-Za-z@])","scope":"support.function.textnormal.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textnormal-meta","text-normal-body","expect-text-markup-open-brace"]},{"match":"((\\\\)text)(\\{)","captures":{"1":"support.function.text.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex"},"push":"text-body"},{"match":"((\\\\)underline)(\\{)","captures":{"1":"support.function.text.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex"},"push":"text-underline-body"}],"text-body":[{"meta_scope":"meta.function.text.latex"},{"include":"brace-group-end"},{"include":"main"}],"text-underline-body":[{"meta_scope":"meta.function.underline.latex"},{"meta_content_scope":"markup.underline.other.latex"},{"include":"brace-group-end"},{"include":"main"}],"text-normal-select-font-family":[{"match":"(\\\\)textrm(?![A-Za-z@])","scope":"support.function.textrm.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textrm-meta","text-normal-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textsf(?![A-Za-z@])","scope":"support.function.textsf.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textsf-meta","text-normal-body","expect-text-markup-open-brace"]},{"match":"(\\\\)texttt(?![A-Za-z@])","scope":"support.function.texttt.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["texttt-meta","texttt-body","expect-text-markup-open-brace"]}],"text-normal-select-font-shape":[{"match":"(\\\\)textup(?![A-Za-z@])","scope":"support.function.textup.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textup-meta","text-normal-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textit(?![A-Za-z@])","scope":"support.function.textit.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textit-meta","text-italic-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textsl(?![A-Za-z@])","scope":"support.function.textsl.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textsl-meta","text-italic-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textsc(?![A-Za-z@])","scope":"support.function.textsc.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textsc-meta","texttt-body","expect-text-markup-open-brace"]},{"match":"(\\\\)emph(?![A-Za-z@])","scope":"support.function.emph.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["emph-meta","text-italic-body","expect-text-markup-open-brace"]}],"text-normal-select-font-weight":[{"match":"(\\\\)textbf(?![A-Za-z@])","scope":"support.function.textbf.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textbf-meta","text-bold-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textmd(?![A-Za-z@])","scope":"support.function.textmd.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textmd-meta","text-normal-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textlf(?![A-Za-z@])","scope":"support.function.textlf.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textlf-meta","text-normal-body","expect-text-markup-open-brace"]}],"text-normal-body":[{"include":"brace-group-end"},{"include":"main"}],"text-bold-body":[{"include":"brace-group-end"},{"include":"text-bold-select-font-family"},{"include":"text-bold-select-font-shape"},{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","push":"text-bold-brace-group-body"},{"include":"main"},{"match":".[^\\\\{}%$~&#_^]*","scope":"markup.bold.latex"}],"text-bold-select-font-family":[{"match":"(\\\\)textrm(?![A-Za-z@])","scope":"support.function.textrm.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textrm-meta","text-bold-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textsf(?![A-Za-z@])","scope":"support.function.textsf.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textsf-meta","text-bold-body","expect-text-markup-open-brace"]},{"match":"(\\\\)texttt(?![A-Za-z@])","scope":"support.function.texttt.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["texttt-meta","texttt-body","expect-text-markup-open-brace"]}],"text-bold-select-font-shape":[{"match":"(\\\\)textup(?![A-Za-z@])","scope":"support.function.textup.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textup-meta","text-bold-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textit(?![A-Za-z@])","scope":"support.function.textit.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textit-meta","text-it-and-bf-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textsl(?![A-Za-z@])","scope":"support.function.textsl.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textsl-meta","text-it-and-bf-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textsc(?![A-Za-z@])","scope":"support.function.textsc.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textsc-meta","texttt-body","expect-text-markup-open-brace"]},{"match":"(\\\\)emph(?![A-Za-z@])","scope":"support.function.emph.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["emph-meta","text-it-and-bf-body","expect-text-markup-open-brace"]}],"text-bold-brace-group-body":[{"meta_scope":"meta.group.brace.tex"},{"include":"brace-group-end"},{"include":"text-bold-body"}],"text-italic-body":[{"include":"brace-group-end"},{"include":"text-italic-select-font-family"},{"include":"text-italic-select-font-weight"},{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","push":"text-italic-brace-group-body"},{"match":"(\\\\)emph(?![A-Za-z@])","scope":"support.function.emph.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["emph-meta","text-normal-body","brace-group-begin"]},{"include":"main"},{"match":".[^\\\\{}%$~&#_^]*","scope":"markup.italic.latex"}],"text-italic-select-font-family":[{"match":"(\\\\)textrm(?![A-Za-z@])","scope":"support.function.textrm.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textrm-meta","text-italic-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textsf(?![A-Za-z@])","scope":"support.function.textsf.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textsf-meta","text-italic-body","expect-text-markup-open-brace"]},{"match":"(\\\\)texttt(?![A-Za-z@])","scope":"support.function.texttt.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["texttt-meta","texttt-body","expect-text-markup-open-brace"]}],"text-italic-select-font-weight":[{"match":"(\\\\)textbf(?![A-Za-z@])","scope":"support.function.textbf.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textbf-meta","text-it-and-bf-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textmd(?![A-Za-z@])","scope":"support.function.textmd.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textmd-meta","text-italic-body","expect-text-markup-open-brace"]},{"match":"(\\\\)textlf(?![A-Za-z@])","scope":"support.function.textlf.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["textlf-meta","text-italic-body","expect-text-markup-open-brace"]}],"text-italic-brace-group-body":[{"meta_scope":"meta.group.brace.tex"},{"include":"brace-group-end"},{"include":"text-italic-body"}],"text-it-and-bf-body":[{"include":"brace-group-end"},{"include":"main"},{"match":".[^\\\\{}%$~&#_^]*","scope":"markup.bold.latex markup.italic.latex"}],"texttt-body":[{"include":"brace-group-end"},{"include":"main"},{"match":".[^\\\\{}%$~&#_^]*","scope":"markup.raw.inline.latex"}],"expect-text-markup-open-brace":[{"include":"brace-group-begin"},{"match":"(?=\\S)","pop":3}],"textnormal-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textnormal.latex"},{"include":"immediately-pop"}],"textbf-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textbf.latex"},{"include":"immediately-pop"}],"textmd-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textmd.latex"},{"include":"immediately-pop"}],"textlf-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textlf.latex"},{"include":"immediately-pop"}],"textsf-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textsf.latex"},{"include":"immediately-pop"}],"textup-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textup.latex"},{"include":"immediately-pop"}],"textsc-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textsc.latex"},{"include":"immediately-pop"}],"textrm-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textrm.latex"},{"include":"immediately-pop"}],"textit-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textit.latex"},{"include":"immediately-pop"}],"texttt-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.texttt.latex"},{"include":"immediately-pop"}],"textsl-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.textsl.latex"},{"include":"immediately-pop"}],"emph-meta":[{"meta_include_prototype":false},{"meta_scope":"meta.function.emph.latex"},{"include":"immediately-pop"}],"footnote":[{"match":"((\\\\)footnote(?:text)?)\\b","captures":{"1":"support.function.footnote.latex","2":"punctuation.definition.backslash.latex"},"push":["{'meta_scope': 'meta.function.footnote.latex'}","{'include': 'general-optional-arguments'}","{'match': '\\\\{', 'scope': 'punctuation.definition.group.brace.begin.tex', 'set': [{'meta_scope': 'meta.function.footnote.latex meta.group.brace.tex'}, {'meta_content_scope': 'markup.italic.footnote.latex'}, {'include': 'brace-group-end'}, {'include': 'main'}]}","{'match': '(?=\\\\S)', 'pop': 1}"]},{"match":"((\\\\)footnotemark)\\b","captures":{"1":"support.function.footnote.latex","2":"punctuation.definition.backslash.latex"},"push":"optional-arguments"}],"references":[{"match":"(\\\\)(?:(?:[aA]uto|foot|[pP]aren|[sS]mart|super|[tT]ext)cites?|[Cc]ites?|footcitetexts?|[cC]ite(?:author)|cite(?:title|year|date)|citeurl|(?:[aA]|no|full|footfull)cites?|[vV]olcites?|(?:[pPfFsStTaA]|ft)volcites?|(?:[pPf]?n|N)otecite|[aA]cite|[cC]ite(?:t|p|alt|alp|text|yearpar))\\b\\*?","scope":"support.function.cite.latex keyword.other.cite.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["{'meta_scope': 'meta.function.citation.latex'}","{'include': 'general-optional-arguments'}","{'match': '\\\\{', 'scope': 'punctuation.definition.group.brace.begin.tex', 'push': [{'meta_scope': 'meta.group.brace.tex'}, {'match': '[a-zA-Z0-9\\\\.:/*!^_-]+', 'scope': 'constant.other.citation.latex'}, {'include': 'brace-group-end'}]}","{'match': '', 'pop': 1}"]},{"match":"((\\\\)(?:eq|c?page|[vV]|auto|name|[cC])?ref\\*?)\\b","captures":{"1":"support.function.reference.latex keyword.other.reference.latex","2":"punctuation.definition.backslash.latex"},"push":["{'meta_scope': 'meta.function.reference.latex'}","{'include': 'general-optional-arguments'}","{'match': '\\\\{', 'scope': 'punctuation.definition.group.brace.begin.tex', 'set': [{'meta_scope': 'meta.function.reference.latex meta.group.brace.tex'}, {'match': '[a-zA-Z0-9\\\\.:/*!^_-]+', 'scope': 'constant.other.reference.latex'}, {'include': 'brace-group-end'}]}","{'match': '', 'pop': 1}"]},{"match":"((\\\\)label)(\\{)","captures":{"1":"support.function.label.latex storage.type.label.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_scope': 'meta.function.label.latex'}","{'match': '[a-zA-Z0-9\\\\.:/*!^_-]+', 'scope': 'entity.name.label.latex'}","{'include': 'brace-group-end'}"]}],"begin-end-commands":[{"match":"((\\\\)begin)(\\{)\\s*(\\w*)\\*?\\s*(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'include': 'general-optional-arguments'}","{'match': '', 'pop': 1}"]},{"match":"((\\\\)end)(\\{)\\s*(\\w*)\\*?\\s*(\\})","captures":{"1":"support.function.end.latex keyword.control.flow.end.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"}}],"packages":[{"include":"pkglistings"},{"include":"minted"},{"include":"pkgcomment"},{"include":"beamer"},{"include":"pkgarray"}],"pkglistings":[{"match":"(\\\\)lstinline\\b","scope":"meta.environment.verbatim.lstinline.latex support.function.lstinline.latex","captures":{"1":"punctuation.definition.backslash.latex"},"push":["{'meta_include_prototype': False}","{'meta_content_scope': 'meta.environment.verbatim.lstinline.latex'}","{'include': 'general-optional-arguments'}","{'match': '\\\\{', 'scope': 'punctuation.definition.group.brace.begin.tex', 'set': [{'meta_include_prototype': False}, {'meta_scope': 'meta.environment.verbatim.lstinline.latex meta.group.brace.tex'}, {'meta_content_scope': 'markup.raw.verb.latex'}, {'include': 'brace-group-end'}]}","{'match': '(\\\\W)', 'scope': 'punctuation.definition.verb.latex', 'set': [{'meta_include_prototype': False}, {'meta_scope': 'meta.environment.verbatim.lstinline.latex'}, {'meta_content_scope': 'markup.raw.verb.latex'}, {'match': '\\\\1', 'scope': 'punctuation.definition.verb.latex', 'pop': 1}]}"]},{"match":"((\\\\)begin)(\\{)(lstlisting)(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_include_prototype': False}","{'meta_scope': 'meta.environment.verbatim.lstlisting.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)(lstlisting)(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.end.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}","{'include': 'general-optional-arguments'}","{'match': '.*(%\\\\s*(?i:c))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.c', 'embed_scope': 'meta.environment.embedded.c.latex source.c.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:cpp|c\\\\+\\\\+))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.c++', 'embed_scope': 'meta.environment.embedded.c++.latex source.c++.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:haskell|hs))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.haskell', 'embed_scope': 'meta.environment.embedded.haskell.latex source.haskell.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:java))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.java', 'embed_scope': 'meta.environment.embedded.java.latex source.java.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:html))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:text.html.basic', 'embed_scope': 'meta.environment.embedded.html.latex source.html.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:tex|latex))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:text.tex.latex', 'embed_scope': 'meta.environment.embedded.latex.latex source.latex.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:lisp))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.lisp', 'embed_scope': 'meta.environment.embedded.lisp.latex source.lisp.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:lua))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.lua', 'embed_scope': 'meta.environment.embedded.lua.latex source.lua.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:perl))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.perl', 'embed_scope': 'meta.environment.embedded.perl.latex source.perl.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:php))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.php', 'embed_scope': 'meta.environment.embedded.php.latex source.php.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:python|py))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.python', 'embed_scope': 'meta.environment.embedded.python.latex source.python.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:r))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.r', 'embed_scope': 'meta.environment.embedded.r.latex source.r.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:ruby))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.ruby', 'embed_scope': 'meta.environment.embedded.ruby.latex source.ruby.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:sh|shell|bash ))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.shell', 'embed_scope': 'meta.environment.embedded.shell.latex source.shell.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:sql|mysql|ddl|dml))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.sql', 'embed_scope': 'meta.environment.embedded.sql.latex source.sql.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:xml))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:text.xml', 'embed_scope': 'meta.environment.embedded.xml.latex source.xml.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '.*(%\\\\s*(?i:yaml))$', 'captures': {1: 'comment.line.percentage.latex'}, 'embed': 'scope:source.yaml', 'embed_scope': 'meta.environment.embedded.yaml.latex source.yaml.embedded', 'escape': '(?=\\\\\\\\end\\\\{lstlisting\\\\})'}","{'match': '', 'push': [{'meta_scope': 'meta.environment.embedded.generic.latex markup.raw.verb.latex'}, {'match': '(?=\\\\\\\\end\\\\{lstlisting\\\\})', 'pop': 1}]}"]}],"minted":[{"include":"minted-env"},{"include":"mint"}],"minted-env":[{"match":"((\\\\)begin)(\\{)(minted)(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_include_prototype': False}","{'meta_scope': 'meta.environment.verbatim.minted.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)(minted)(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.end.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}","{'include': 'general-optional-arguments'}","{'match': '(\\\\{)(c)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.c', 'embed_scope': 'meta.environment.embedded.c.latex source.c.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(cpp|c\\\\+\\\\+)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.c++', 'embed_scope': 'meta.environment.embedded.c++.latex source.c++.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(diff)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.diff', 'embed_scope': 'meta.environment.embedded.diff.latex source.diff.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(go|golang)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.go', 'embed_scope': 'meta.environment.embedded.go.latex source.go.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(haskell|hs)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.haskell', 'embed_scope': 'meta.environment.embedded.haskell.latex source.haskell.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(html)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:text.html.basic', 'embed_scope': 'meta.environment.embedded.html.latex text.html.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(java)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.java', 'embed_scope': 'meta.environment.embedded.java.latex source.java.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(javascript|js)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.js', 'embed_scope': 'meta.environment.embedded.js.latex source.js.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(json)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.json', 'embed_scope': 'meta.environment.embedded.json.latex source.json.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(tex|latex)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:text.tex.latex', 'embed_scope': 'meta.environment.embedded.latex.latex text.tex.latex.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(lisp)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.lisp', 'embed_scope': 'meta.environment.embedded.lisp.latex source.lisp.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(lua)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.lua', 'embed_scope': 'meta.environment.embedded.lua.latex source.lua.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(obj(?:ective\\\\-|)c)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.objc', 'embed_scope': 'meta.environment.embedded.objc.latex source.objc.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(obj(?:ective\\\\-|)c\\\\+\\\\+)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.objc++', 'embed_scope': 'meta.environment.embedded.objc++.latex source.objc++.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(perl)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.perl', 'embed_scope': 'meta.environment.embedded.perl.latex source.perl.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(php)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.php', 'embed_scope': 'meta.environment.embedded.php.latex source.php.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(python|py)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.python', 'embed_scope': 'meta.environment.embedded.python.latex source.python.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(r)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.r', 'embed_scope': 'meta.environment.embedded.r.latex source.r.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(ruby)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.ruby', 'embed_scope': 'meta.environment.embedded.ruby.latex source.ruby.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(sh|shell|bash )(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.shell', 'embed_scope': 'meta.environment.embedded.shell.latex source.shell.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(sql|mysql|ddl|dml)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.sql', 'embed_scope': 'meta.environment.embedded.sql.latex source.sql.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(xml)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:text.xml', 'embed_scope': 'meta.environment.embedded.xml.latex text.xml.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '(\\\\{)(yaml)(\\\\})', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex'}, 'embed': 'scope:source.yaml', 'embed_scope': 'meta.environment.embedded.yaml.latex source.yaml.embedded', 'escape': '(?=\\\\\\\\end\\\\{minted\\\\})'}","{'match': '', 'push': [{'meta_scope': 'meta.environment.embedded.generic.latex markup.raw.verb.latex'}, {'match': '(?=\\\\\\\\end\\\\{minted\\\\})', 'pop': 1}]}"]}],"mint":[{"match":"((\\\\)mint)\\b|((\\\\)mintinline)\\b","captures":{"1":"support.function.mint.latex","2":"punctuation.definition.backslash.latex","3":"support.function.mintinline.latex","4":"punctuation.definition.backslash.latex"},"push":["{'meta_scope': 'meta.environment.verbatim.minted.latex'}","{'include': 'general-optional-arguments'}","{'match': '(\\\\{)(c)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.c', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.c.latex source.c.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(cpp|c\\\\+\\\\+)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.c++', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.c++.latex source.c++.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(diff)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.diff', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.diff.latex source.diff.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(go|golang)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.go', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.go.latex source.go.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(haskell|hs)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.haskell', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.haskell.latex source.haskell.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(html)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:text.html.basic', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.html.latex text.html.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(java)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.java', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.java.latex source.java.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(javascript|js)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.js', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.js.latex source.js.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(json)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.json', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.json.latex source.json.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(tex|latex)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:text.tex.latex', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.latex.latex text.tex.latex.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(lisp)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.lisp', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.lisp.latex source.lisp.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(lua)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.lua', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.lua.latex source.lua.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(obj(?:ective\\\\-|)c)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.objc', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.objc.latex source.objc.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(obj(?:ective\\\\-|)c\\\\+\\\\+)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.objc++', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.objc++.latex source.objc++.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(perl)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.perl', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.perl.latex source.perl.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(php)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.php', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.php.latex source.php.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(python|py)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.python', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.python.latex source.python.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(r)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.r', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.r.latex source.r.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(ruby)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.ruby', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.ruby.latex source.ruby.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(sh|shell|bash )(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.shell', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.shell.latex source.shell.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(sql|mysql|ddl|dml)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.sql', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.sql.latex source.sql.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(xml)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:text.xml', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.xml.latex text.xml.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '(\\\\{)(yaml)(\\\\})((\\\\{)|(\\\\W))', 'scope': 'meta.environment.verbatim.minted.latex', 'captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'variable.parameter.function.latex', 3: 'punctuation.definition.group.brace.end.tex', 5: 'punctuation.definition.group.brace.begin.tex', 6: 'punctuation.definition.verb.latex'}, 'embed': 'scope:source.yaml', 'embed_scope': 'meta.environment.verbatim.minted.latex meta.environment.embedded.yaml.latex source.yaml.embedded', 'escape': '(\\\\})|(\\\\4)', 'escape_captures': {1: 'punctuation.definition.group.brace.begin.tex', 2: 'punctuation.definition.verb.latex'}}","{'match': '', 'pop': 1}"]}],"pkgcomment":[{"match":"^(\\\\)comment\\b","captures":{"0":"punctuation.definition.comment.start.latex","1":"punctuation.definition.backslash.latex"},"push":["{'meta_scope': 'meta.environment.comment.latex comment.block.command.comment.latex'}","{'match': '^(\\\\\\\\)endcomment\\\\b', 'captures': {0: 'punctuation.definition.comment.end.latex', 1: 'punctuation.definition.backslash.latex'}, 'pop': 1}"]},{"match":"((\\\\)begin)(\\{)\\s*(comment)\\s*(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_scope': 'meta.environment.comment.latex'}","{'meta_content_scope': 'comment.block.environment.comment.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)\\\\s*(comment)\\\\s*(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.end.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}"]}],"beamer":[{"match":"((\\\\)begin)(\\{)(frame)(\\})","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex"},"push":["{'meta_scope': 'meta.environment.frame.latex'}","{'match': '((\\\\\\\\)end)(\\\\{)(frame)(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.end.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}","{'include': 'frametitles'}","{'include': 'main'}"]}],"frametitles":[{"match":"((\\\\)frametitle)(\\{)(.*)(\\})","scope":"meta.function.frametitle.latex","captures":{"1":"support.function.frametitle.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"entity.name.function.frame.latex","5":"punctuation.definition.group.brace.end.tex"}}],"pkgarray":[{"match":"((\\\\)newcolumntype)(?:(\\{)((?:\\\\[A-Za-z@]+)|(?:[A-Za-z@]))(\\}))(?:(\\[)(?:[^\\]]*)(\\]))*(\\{)","captures":{"1":"support.function.newcolumntype.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"support.function.latex entity.name.newcolumntype.latex","5":"punctuation.definition.group.brace.end.tex","6":"punctuation.definition.group.bracket.begin.latex","7":"punctuation.definition.group.bracket.end.latex","8":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_include_prototype': False}","{'meta_scope': 'meta.function.newcolumntype.latex'}","{'include': 'brace-group-end'}","{'include': 'array-preamble'}"]},{"match":"((\\\\)begin)(\\{)(tabular)(\\})(?:(\\[)(?:b|c|t)(\\]))?(?=\\s*\\{)","captures":{"1":"support.function.begin.latex keyword.control.flow.begin.latex","2":"punctuation.definition.backslash.latex","3":"punctuation.definition.group.brace.begin.tex","4":"variable.parameter.function.latex","5":"punctuation.definition.group.brace.end.tex","6":"punctuation.definition.group.bracket.begin.latex","7":"punctuation.definition.group.bracket.end.latex"},"push":["{'meta_scope': 'meta.environment.tabular.latex'}","{'match': '\\\\{', 'scope': 'meta.function.column-spec.latex punctuation.definition.group.brace.begin.tex', 'set': [{'meta_content_scope': 'meta.environment.tabular.latex meta.function.column-spec.latex'}, {'include': 'array-preamble'}, {'match': '\\\\}', 'scope': 'meta.function.column-spec.latex punctuation.definition.group.brace.end.tex', 'set': [{'meta_scope': 'meta.environment.tabular.latex'}, {'match': '((\\\\\\\\)end)(\\\\{)(tabular)(\\\\})', 'captures': {1: 'support.function.end.latex keyword.control.flow.end.latex', 2: 'punctuation.definition.backslash.latex', 3: 'punctuation.definition.group.brace.begin.tex', 4: 'variable.parameter.function.latex', 5: 'punctuation.definition.group.brace.end.tex'}, 'pop': 1}, {'include': 'main'}]}]}"]}],"array-preamble":[{"match":"\\{","scope":"punctuation.definition.group.brace.begin.tex","push":["{'include': 'brace-group-end'}","{'include': 'general-constants'}","{'include': 'general-commands'}","{'include': 'array-preamble'}"]},{"match":"l|r|c","scope":"keyword.other.column-type.latex"},{"match":"(?:p|m|b)(?=\\s*\\{)","scope":"support.function.parbox-column.latex","push":["[{'meta_scope': 'meta.function.parbox-column.latex'}, {'match': '', 'pop': 1}]","argument"]},{"match":"(>)\\s*(\\{)","captures":{"1":"support.function.insert-before-column.latex","2":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_scope': 'meta.function.before-column-decl.latex'}","{'include': 'brace-group-end'}","{'include': 'general-constants'}","{'include': 'general-commands'}","{'include': 'macro-braces'}"]},{"match":"(<)\\s*(\\{)","captures":{"1":"support.function.insert-after-column.latex","2":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_scope': 'meta.function.after-column-decl.latex'}","{'include': 'brace-group-end'}","{'include': 'general-constants'}","{'include': 'general-commands'}","{'include': 'macro-braces'}"]},{"match":"\\|","scope":"keyword.operator.inter-column-line.latex"},{"match":"(@)\\s*(\\{)","captures":{"1":"support.function.inter-column-nospace.latex","2":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_scope': 'meta.function.inter-column-decl.latex'}","{'include': 'brace-group-end'}","{'include': 'general-constants'}","{'include': 'general-commands'}","{'include': 'macro-braces'}"]},{"match":"(!)\\s*(\\{)","captures":{"1":"support.function.inter-column.latex","2":"punctuation.definition.group.brace.begin.tex"},"push":["{'meta_scope': 'meta.function.inter-column-decl.latex'}","{'include': 'brace-group-end'}","{'include': 'general-constants'}","{'include': 'general-commands'}","{'include': 'macro-braces'}"]},{"match":"(\\*)\\s*(\\{)","captures":{"1":"support.function.insert-repeated.latex","2":"meta.function.insert-repeated-count.latex punctuation.definition.group.brace.begin.tex"},"push":["{'meta_content_scope': 'meta.function.insert-repeated-count.latex'}","{'match': '\\\\d+', 'scope': 'constant.numeric.array-count.latex'}","{'include': 'general-commands'}","{'match': '\\\\}', 'scope': 'meta.function.insert-repeated-count.latex punctuation.definition.group.brace.end.tex', 'set': [{'match': '\\\\{', 'scope': 'meta.function.insert-repeated-content.latex punctuation.definition.group.brace.begin.tex', 'set': [{'meta_content_scope': 'meta.function.insert-repeated-content.latex'}, {'include': 'array-preamble'}, {'match': '\\\\}', 'scope': 'meta.function.insert-repeated-content.latex punctuation.definition.group.brace.end.tex', 'pop': 1}]}, {'match': '', 'pop': 1}]}"]}]}}

    /* Mariana 的 scope → 颜色规则（编译自 Mariana.sublime-color-scheme）。 */
    const TEX_COLORS = {"foreground":"#D8DEE9","background":"#303841","rules":[{"sel":[{"path":["comment"],"exclude":null},{"path":["punctuation.definition.comment"],"exclude":null}],"fg":"#A6ACB9"},{"sel":[{"path":["string"],"exclude":null}],"fg":"#99C794"},{"sel":[{"path":["meta.mapping.key","string"],"exclude":["meta.mapping.key","meta","meta","|","meta.mapping.key","meta.mapping.key","string"]}],"fg":"#5FB4B4"},{"sel":[{"path":["punctuation.definition"],"exclude":["punctuation.definition.numeric.base"]}],"fg":"#5FB4B4"},{"sel":[{"path":["constant.numeric"],"exclude":null}],"fg":"#F9AE58"},{"sel":[{"path":["storage.type.numeric"],"exclude":null}],"fg":"#C695C6","fs":"italic"},{"sel":[{"path":["constant.language"],"exclude":null}],"fg":"#EC5F66","fs":"italic"},{"sel":[{"path":["constant.character"],"exclude":null},{"path":["constant.other"],"exclude":null}],"fg":"#C695C6"},{"sel":[{"path":["variable.member"],"exclude":null}],"fg":"#EC5F66"},{"sel":[{"path":["keyword"],"exclude":["keyword.operator"]},{"path":["keyword.operator.word"],"exclude":null}],"fg":"#C695C6"},{"sel":[{"path":["keyword.operator"],"exclude":null}],"fg":"#F97B58"},{"sel":[{"path":["punctuation.separator"],"exclude":null},{"path":["punctuation.terminator"],"exclude":null}],"fg":"#A6ACB9"},{"sel":[{"path":["punctuation.section"],"exclude":null}],"fg":"#FFFFFF"},{"sel":[{"path":["punctuation.accessor"],"exclude":null}],"fg":"#A6ACB9"},{"sel":[{"path":["punctuation.definition.annotation"],"exclude":null}],"fg":"#5FB4B4"},{"sel":[{"path":["variable.other.dollar.only.js"],"exclude":null},{"path":["variable.other.object.dollar.only.js"],"exclude":null},{"path":["variable.type.dollar.only.js"],"exclude":null},{"path":["support.class.dollar.only.js"],"exclude":null}],"fg":"#5FB4B4"},{"sel":[{"path":["storage"],"exclude":null}],"fg":"#EC5F66"},{"sel":[{"path":["storage.type"],"exclude":null}],"fg":"#C695C6","fs":"italic"},{"sel":[{"path":["entity.name.function"],"exclude":null}],"fg":"#5FB4B4"},{"sel":[{"path":["entity.name"],"exclude":[["entity.name.section","entity.name.tag","entity.name.label"]]}],"fg":"#F9AE58"},{"sel":[{"path":["entity.other.inherited-class"],"exclude":null}],"fg":"#5FB4B4","fs":"italic"},{"sel":[{"path":["variable.parameter"],"exclude":null}],"fg":"#F9AE58"},{"sel":[{"path":["variable.language"],"exclude":null}],"fg":"#EC5F66","fs":"italic"},{"sel":[{"path":["entity.name.tag"],"exclude":null}],"fg":"#EC5F66"},{"sel":[{"path":["entity.other.attribute-name"],"exclude":null}],"fg":"#C695C6"},{"sel":[{"path":["variable.function"],"exclude":null},{"path":["variable.annotation"],"exclude":null}],"fg":"#6699CC"},{"sel":[{"path":["support.function"],"exclude":null},{"path":["support.macro"],"exclude":null}],"fg":"#6699CC","fs":"italic"},{"sel":[{"path":["support.constant"],"exclude":null}],"fg":"#C695C6","fs":"italic"},{"sel":[{"path":["support.type"],"exclude":null},{"path":["support.class"],"exclude":null}],"fg":"#6699CC","fs":"italic"},{"sel":[{"path":["invalid"],"exclude":null}],"fg":"#F7F7F7","bg":"var(red)"},{"sel":[{"path":["invalid.deprecated"],"exclude":null}],"fg":"#F7F7F7","bg":"var(orange2)"},{"sel":[{"path":["entity.name.tag.yaml"],"exclude":null}],"fg":"#5FB4B4"},{"sel":[{"path":["source.yaml","string.unquoted"],"exclude":null}],"fg":"#D8DEE9"},{"sel":[{"path":["markup.heading"],"exclude":null}],"fs":"bold"},{"sel":[{"path":["markup.heading","punctuation.definition.heading"],"exclude":null}],"fg":"#F97B58"},{"sel":[{"path":["markup.heading.1","punctuation.definition.heading"],"exclude":null}],"fg":"#EC5F66"},{"sel":[{"path":["string.other.link"],"exclude":null},{"path":["markup.underline.link"],"exclude":null}],"fg":"#6699CC"},{"sel":[{"path":["markup.bold"],"exclude":null}],"fs":"bold"},{"sel":[{"path":["markup.italic"],"exclude":null}],"fs":"italic"},{"sel":[{"path":["markup.underline"],"exclude":null}],"fs":"underline"},{"sel":[{"path":["markup.italic","markup.bold","|","markup.bold","markup.italic"],"exclude":null}],"fs":"bold italic"},{"sel":[{"path":["markup.underline","markup.bold","|","markup.bold","markup.underline"],"exclude":null}],"fs":"bold underline"},{"sel":[{"path":["markup.underline","markup.italic","|","markup.italic","markup.underline"],"exclude":null}],"fs":"italic underline"},{"sel":[{"path":["markup.bold","markup.italic","markup.underline","|","markup.bold","markup.underline","markup.italic","|","markup.italic","markup.bold","markup.underline","|","markup.italic","markup.underline","markup.bold","|","markup.underline","markup.bold","markup.italic","|","markup.underline","markup.italic","markup.bold"],"exclude":null}],"fs":"bold italic underline"},{"sel":[{"path":["punctuation.definition.thematic-break"],"exclude":null}],"fg":"#F9AE58"},{"sel":[{"path":["markup.list.numbered.bullet"],"exclude":null}],"fg":"#99C794"},{"sel":[{"path":["markup.quote","punctuation.definition.blockquote"],"exclude":null},{"path":["markup.list","punctuation.definition.list_item"],"exclude":null}],"fg":"#F9AE58"},{"sel":[{"path":["markup.raw"],"exclude":null}],"bg":"color(var(blue2) alpha(0.38))"},{"sel":[{"path":["markup.raw.inline"],"exclude":null}],"bg":"color(var(blue2) alpha(0.5))"},{"sel":[{"path":[["text punctuation.definition.italic","text punctuation.definition.bold"]],"exclude":null}],"fg":"#C695C6"},{"sel":[{"path":["meta.diff"],"exclude":null},{"path":["meta.diff.header"],"exclude":null}],"fg":"#C695C6"},{"sel":[{"path":["markup.deleted"],"exclude":null}],"fg":"#EC5F66"},{"sel":[{"path":["markup.inserted"],"exclude":null}],"fg":"#99C794"},{"sel":[{"path":["markup.changed"],"exclude":null}],"fg":"#F9AE58"},{"sel":[{"path":["support.type.property-name"],"exclude":null}],"fg":"#D8DEE9"},{"sel":[{"path":["constant.numeric.line-number.match"],"exclude":null}],"fg":"#EC5F66"},{"sel":[{"path":["message.error"],"exclude":null}],"fg":"#EC5F66"},{"sel":[{"path":["message.warning"],"exclude":null}],"fg":"#EE932B"},{"sel":[{"path":["message.info"],"exclude":null}],"fg":"#6699CC"},{"sel":[{"path":["diff.deleted"],"exclude":null}],"bg":"hsla(357, 45%, 60%, 0.15)"},{"sel":[{"path":["diff.deleted.char"],"exclude":null}],"bg":"hsla(357, 60%, 60%, 0.30)"},{"sel":[{"path":["diff.inserted"],"exclude":null}],"bg":"hsla(180, 45%, 60%, 0.15)"},{"sel":[{"path":["diff.inserted.char"],"exclude":null}],"bg":"hsla(180, 60%, 60%, 0.30)"}]}

    /* ---- 分词器（真源：tools/tex-tokenizer.mjs）---- */

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
function tokenize(text, grammar) {
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

    /* ---- 配色器（真源：tools/tex-colors.mjs）---- */

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
function makeColorizer(scheme) {
  const rules = scheme.rules || []
  const fallbackFg = scheme.foreground || '#D8DEE9'
  /* 同一个 scope 栈在一份文档里会重复成千上万次（每个数字、每个标识符都是同一套
     scope），而求一次要过全部 63 条规则。实测这是**渲染的主要开销**：
     200 行文档 9692 个 token，配色 216ms、分词只有 42ms。
     按 scope 栈缓存后，实际求值次数从「token 数」降到「不同的 scope 组合数」（几十）。 */
  const memo = new Map()

  return function styleOf(scopes) {
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return { fg: fallbackFg, fs: '', score: 0, rule: -1 }
    }
    const key = scopes.join('\u0000')
    const cached = memo.get(key)
    if (cached !== undefined) return cached
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
    const out = {
      fg: bestFg === null ? fallbackFg : bestFg,
      fs: bestFs,
      score: bestDepth,
      rule: bestRule,
    }
    memo.set(key, out)
    return out
  }
}

    /* @dsh-tex-assets:end */

    /* ---- 判定「这一块该不该走 LaTeX 渲染」 --------------------------------- */

    /** 语言名是这几个的才走 LaTeX 渲染。 */
    const LATEX_LANGS = new Set(['latex', 'tex', 'ltx'])

    /**
     * 读代码块的**语言名** —— 宿主已经写在块左上角的横幅里了。
     *
     * 文件预览时它就是**文件后缀**推出来的语言，对话里的代码块则来自 ``` 后面的标注；
     * 两种横幅变体（普通 / 带工具栏）都带 `data-code-block-banner`，语言名是里面
     * 第一个 `span`。
     *
     * @param {Element} pre - 代码块。
     * @returns {string|null} 归一化后的语言名；读不到返回 null。
     */
    function blockLanguageOf(pre) {
      if (pre === null || pre === undefined) return null
      let host = null
      try {
        host = typeof pre.closest === 'function' ? pre.closest('.md-code-block') : null
      } catch {
        host = null
      }
      if (host === null || host === undefined) host = pre.parentElement
      for (let hop = 0; hop < 4 && host !== null && host !== undefined; hop += 1) {
        if (typeof host.querySelector === 'function') {
          let banner = null
          try {
            banner = host.querySelector('[data-code-block-banner]')
          } catch {
            banner = null
          }
          if (banner !== null && banner !== undefined) {
            let span = null
            try {
              span = banner.querySelector('span')
            } catch {
              span = null
            }
            const raw = String(span !== null && span !== undefined ? span.textContent : '').trim().toLowerCase()
            /* 宿主认不出语言时会显示「代码」这类**说明文字**，那不是语言名。
               要求是纯 ASCII 语言标签，否则当读不到处理。 */
            if (raw === '' || raw === 'code' || !/^[a-z0-9+#._-]+$/.test(raw)) return null
            return raw
          }
        }
        host = host.parentElement
      }
      return null
    }

    /**
     * 这一块该不该走我们自己的 LaTeX 渲染。
     *
     * **只认宿主声明的语言名，读不到就不碰。** 早先还加了一套「猜内容特征」的兜底，
     * 结果是 js / yaml / json 被正则量词 `\d{4}` `\w{2}` 打中、ps1 被
     * `"C:\Users\$env:USERNAME"` 打中，全被按 LaTeX 上色 —— 猜不如读。
     * 读不到语言名时退回 Shiki 的普通高亮，这是可接受的代价。
     *
     * @param {Element} pre - 代码块。
     * @returns {boolean}
     */
    function shouldRenderLatex(pre) {
      const lang = blockLanguageOf(pre)
      return lang !== null && LATEX_LANGS.has(lang)
    }

    /** 取「宿主原本的 `<code>`」的文本 —— 不能算上我们自己的渲染层。 */
    function texSourceOf(pre) {
      let code = null
      const kids = pre.children
      if (kids !== undefined && kids !== null) {
        for (let i = 0; i < kids.length; i += 1) {
          const el = kids[i]
          if (el === null || el === undefined || el.tagName !== 'CODE') continue
          if (el.classList !== undefined && el.classList !== null
            && el.classList.contains(TEX_LAYER_CLASS)) continue
          code = el
          break
        }
      }
      return (code === null ? pre : code).textContent
    }

    /* ---- 渲染：分词 → 配色 → HTML ---------------------------------------- */

    /** 配色器（配色规则是个大对象，首次用到才建）。 */
    let texStyleOf = null

    /** scope 栈 → `{fg, fs}`。 */
    function texStyleOfScopes(scopes) {
      if (texStyleOf === null) texStyleOf = makeColorizer(TEX_COLORS)
      return texStyleOf(scopes)
    }

    const TEX_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

    /** HTML 转义。 */
    function escHtml(s) {
      return s.replace(/[&<>]/g, (c) => TEX_ESCAPE[c])
    }

    /** Mariana 的 `font_style` → 内联 CSS 片段。 */
    function fontStyleCss(fs) {
      if (typeof fs !== 'string' || fs === '') return ''
      const parts = fs.split(/\s+/)
      let css = ''
      if (parts.indexOf('italic') !== -1) css += ';font-style:italic'
      if (parts.indexOf('bold') !== -1) css += ';font-weight:700'
      if (parts.indexOf('underline') !== -1) css += ';text-decoration:underline'
      return css
    }

    /**
     * 把一段 LaTeX 渲染成 Shiki 那种结构的 HTML：
     * 每个逻辑行一个 `<span class="line">`（宿主的行号是靠 `.line` 上的
     * CSS 计数器画的，所以这个类名必须留着），行间用换行文本节点。
     *
     * @param {string} text - 原文。
     * @returns {string} HTML。
     */
    function renderTexHtml(text) {
      const { tokens } = tokenize(text, TEX_GRAMMAR)
      const out = []
      let line = []
      const flush = () => {
        out.push('<span class="line">' + line.join('') + '</span>')
        line = []
      }
      for (let i = 0; i < tokens.length; i += 1) {
        const tk = tokens[i]
        const piece = text.slice(tk.start, tk.end)
        const st = texStyleOfScopes(tk.scopes)
        const style = 'color:' + st.fg + fontStyleCss(st.fs)
        const parts = piece.split('\n')
        for (let p = 0; p < parts.length; p += 1) {
          if (p > 0) {
            flush()
            out.push('\n')
          }
          if (parts[p] !== '') {
            line.push('<span style="' + style + '">' + escHtml(parts[p]) + '</span>')
          }
        }
      }
      flush()
      return out.join('')
    }

    /**
     * 保证这一块有一个渲染好的层，且内容与原文一致。
     *
     * 用**原文内容**当「要不要重画」的判据 —— 早先版本用「子元素数 + 文本长度」，
     * 重渲染后这两个数不变，于是永远跳过、类补不回来。
     *
     * @param {Element} pre - 代码块。
     * @param {string} srcText - 宿主原本的文本。
     */
    function syncTexLayer(pre, srcText) {
      let layer = pre.__dmtTexLayer
      if (layer === undefined || layer === null || layer.isConnected === false) {
        layer = document.createElement('code')
        layer.className = TEX_LAYER_CLASS
        /* 把宿主原本的 <code> 藏起来（它仍在 DOM 里、React 照常更新，只是不显示） */
        const kids = pre.children
        if (kids !== undefined && kids !== null) {
          for (let i = 0; i < kids.length; i += 1) {
            const el = kids[i]
            if (el !== null && el !== undefined && el.tagName === 'CODE'
              && el.classList !== undefined && !el.classList.contains(TEX_LAYER_CLASS)) {
              try {
                el.classList.add(TEX_HIDDEN_CLASS)
              } catch {
                /* classList 不可用 */
              }
            }
          }
        }
        try {
          pre.appendChild(layer)
        } catch (error) {
          note('append tex layer', error)
          return
        }
        pre.__dmtTexLayer = layer
        pre.__dmtTexSrc = undefined
      }
      if (pre.__dmtTexSrc === srcText && layer.__dmtTexHtml !== undefined) return
      const html = renderTexHtml(srcText)
      if (layer.__dmtTexHtml !== html) {
        layer.__dmtTexHtml = html
        try {
          layer.innerHTML = html
        } catch (error) {
          note('paint tex layer', error)
          return
        }
      }
      pre.__dmtTexSrc = srcText
    }

    /** 撤掉渲染层，恢复宿主原本的显示。 */
    function disposeTexLayer(pre) {
      const layer = pre.__dmtTexLayer
      if (layer !== undefined && layer !== null) {
        try {
          layer.remove()
        } catch (error) {
          note('remove tex layer', error)
        }
        pre.__dmtTexLayer = null
      }
      pre.__dmtTexSrc = undefined
      const kids = pre.children
      if (kids === undefined || kids === null) return
      for (let i = 0; i < kids.length; i += 1) {
        const el = kids[i]
        if (el !== null && el !== undefined && el.classList !== undefined
          && el.classList.contains(TEX_HIDDEN_CLASS)) {
          try {
            el.classList.remove(TEX_HIDDEN_CLASS)
          } catch {
            /* classList 不可用 */
          }
        }
      }
    }

    /**
     * LaTeX 块的样式表：只需要把宿主的副本藏起来。
     *
     * （渲染层的颜色是写在内联 style 上的，不依赖样式表；
     * 早先那套「覆盖 --shiki-token-*」现在用不到了 —— 我们自己就是着色器。）
     */
    function buildLatexSheet() {
      return 'pre.' + LATEX_BLOCK_CLASS + ' .' + TEX_HIDDEN_CLASS + '{display:none}'
    }


    /* ====================================================================== *
     * 二·六、Markdown 的细节着色
     *
     * 背景：Shiki 的 `css-variables` 主题只给少数几个 markdown scope 映射了
     * 令牌，剩下的**继承正文色**：
     *
     *   markup.heading.markdown   → 只有 fontStyle（bold），无颜色
     *   markup.bold.markdown       → 只有 fontStyle（bold），无颜色
     *   markup.italic.markdown     → 只有 fontStyle（italic），无颜色
     *   markup.inline             → token-string（绿）
     *   meta.link.inline.markdown → token-link（蓝）
     *
     * 而 Sublime 的 Mariana 按 scope 上色，这几处**有颜色**：
     *
     *   punctuation.definition.heading          → var(red2)  红
     *   markup.quote punctuation.definition.blockquote → var(orange) 橙
     *   markup.list punctuation.definition.list_item   → var(orange) 橙
     *   markup.list.numbered.bullet            → var(green) 绿
     *   markup.raw.inline                      → 蓝灰背景
     *
     * 所以在预览 .md 文件时，`#` 标题符号、`>` 引用符号、列表符号都是白的，
     * 与 Sublime 不一致。
     *
     * 怎么补：Shiki 的 markdown token span **没有**对应的 `--shiki-token-*`
     * 变量（它们根本没被映射），所以不能靠改 CSS 变量 —— 只能直接用 CSS
     * 选择器给这些 span 上色。Shiki 的 span 是平铺的（没有 scope 类名），
     * 但宿主的 markdown 容器有稳定的 `_markdown_` 前缀（来自源文件名），
     * 而 Shiki 给 markdown 的 span 会带上 `style="color: var(--shiki-token-*)"`
     * 或纯文本 —— 没法直接区分。
     *
     * 换个思路：**按内容特征**挑出这些符号。Shiki 给 markdown 的标点符号
     * 保留了原文，所以可以用选择器 + 文本匹配不到 —— CSS 做不到。
     *
     * 最终方案：直接用**宿主 markdown 容器里的结构选择器**。宿主渲染 markdown
     * 用的是 marked + 自己的 renderer，标题的 `#` 是 `punctuation.definition.heading`
     * scope 生成的 span（Shiki 输出的）。这些 span 没有类名，但它们在
     * `pre.shiki` 之外 —— 在**行内 markdown**（对话正文）里，宿主是用
     * CSS 规则给 `.markdown h1` 之类的元素上色的，不走 Shiki。
     *
     * 所以：只有**代码块形式的 markdown**（```markdown 围栏）走 Shiki，
     * 而**行内 markdown**（对话正文、预览面板）走宿主的 CSS。
     * 宿主那部分的规则我们改不了（不 fork 宿主），只能靠覆盖。
     * ====================================================================== */

    /**
     * Markdown 细节着色规则表。
     *
     * 只做宿主**当前没有**、而 Sublime Mariana **有**的三处。
     * 选择器用宿主 markdown 容器的 `_markdown_` 前缀（来自源文件名，跨构建稳定，
     * 与正文高亮用的是同一套锚点）+ 结构选择器。
     *
     * 宿主现状 vs Sublime Mariana：
     *   li::marker    宿主 `--dsw-alias-label-secondary`（灰） → Mariana `var(green)`
     *   blockquote    宿主只有左边框，文字是正文色          → Mariana `var(orange)`
     *   code（行内）  宿主无背景                            → Mariana 蓝灰底
     *
     * 标题 h1-h6 已经是粗体、继承正文色 —— 与 Mariana 的 `markup.heading`
     * （bold + 继承）一致，不动。
     */
    const MARKDOWN_RULES = Object.freeze([
      /* 列表符号 —— Mariana 的 var(green)。 */
      { selector: 'li::marker', decl: 'color:var(--dmt-md-list-marker)' },
      /* 引用正文 —— Mariana 的 var(orange)。 */
      { selector: 'blockquote', decl: 'color:var(--dmt-md-quote)' },
      /* 行内代码 —— Mariana 的 markup.raw.inline 蓝灰底。 */
      { selector: 'code', decl: 'background:var(--dmt-md-code-bg)' },
    ])

    /**
     * 生成 Markdown 细节样式表。
     *
     * 用 `--dmt-md-*` 自定义变量而不是写死颜色，这样跟着主题变。
     *
     * 容器选择器与正文高亮同一套锚点（`[class*="_markdown_"]`，前缀来自宿主
     * 源文件名、跨构建稳定），但**排除紧凑变体** —— 紧凑摘要区是宿主
     * 刻意压缩的展示，不该被主题细节干扰。
     *
     * 优先级说明：这些规则与「正文高亮」那套规则会同时命中同一个元素
     * （比如 `li::marker`）。两张样式表都挂在 `<head>`，后插入的赢 ——
     * markdown 样式表在 syncMarkdownSheet 里挂得比 prose 晚，所以 markdown
     * 的细节色覆盖正文高亮的对应色。这是刻意的：正文高亮是「对话正文」的
     * 增强，markdown 细节是「对齐 Sublime」的基础层，后者不该被前者盖掉。
     *
     * @returns {string} CSS 文本。
     */
    function buildMarkdownSheet() {
      const root = '[class*="_markdown_"]:not([data-markdown-variant="compact"])'
      const chunks = []
      for (const rule of MARKDOWN_RULES) {
        chunks.push(root + ' ' + rule.selector + '{' + rule.decl + '}')
      }
      return chunks.join('\n')
    }

    /**
     * 文件卡片的两组目标。
     *
     * 宿主里有两个**独立组件**都会渲染文件卡片，各自定义自己的底色变量：
     *
     *   1. `ChangedFiles`（"已编辑 N 个文件"卡片）：在 `.<hash>_card` 上定义
     *      `--changes-fill` / `--changes-hover`，由 `.<hash>_header` 消费 —— 表现为
     *      卡片**头部横带**。
     *   2. `Deliverables`（"交付文件"卡片）：在 `.<hash>_root` 上定义
     *      `--deliverable-fill` / `--deliverable-hover`，由 `.<hash>_file` 消费 ——
     *      表现为**整张卡片底色**（没有独立横带）。
     *
     * 两组的类名前缀每次构建都变，不能写死，所以运行时从 CSSOM 里找
     * "哪条规则定义了这个变量"（detectCardTargets）。
     */
    const CARD_TARGETS = Object.freeze([
      Object.freeze({ varName: '--changes-fill', hoverVar: '--changes-hover', defClass: '_card' }),
      Object.freeze({ varName: '--deliverable-fill', hoverVar: '--deliverable-hover', defClass: '_root' }),
      /* ui-plan 的「计划」卡片（`PlanPreview.module.css`）。它有自己的变量名，
         而且**变量与背景在同一个类上**（不像 Deliverables 是 root 定义、file 消费）。
         早先只覆盖前两种，于是「计划」卡片一直是宿主的中性灰。 */
      Object.freeze({ varName: '--plan-card-fill', hoverVar: '--plan-card-hover', defClass: '_card' }),
      /* ui-schedule 的排程卡片（`ScheduleCreateCard.module.css`），同样是卡片底色语义。 */
      Object.freeze({ varName: '--card-fill', hoverVar: '--card-hover', defClass: '_card' }),
    ])

    /**
     * 生成文件卡片底色的覆盖规则。
     *
     * 背景：文件卡片的底色不走 `--dsw-alias-*` 令牌，而是定义在**哈希类**上的
     * 专属变量（`--changes-fill` / `--deliverable-fill`），值来自宿主中性灰 ——
     * 所以它是整张卡片上唯一不跟主题的一块。
     *
     * 特异性：宿主有两条竞争规则 —— `.x{…}` (0,1,0) 和
     * `body[data-ds-dark-theme] .x{…}` (0,2,1)。这里把类写三遍 (0,3,0)，
     * 两条都压过，且不用 `!important`（保留宿主以后加更具体规则时的退路）。
     *
     * @param {object} state - 已生效设置（不是草稿）。
     * @param {Array<{defClass:string,varName:string,hoverVar:string}>} targets -
     *   检测到的目标组；空数组表示还没检测到。
     * @returns {string} CSS 文本；未启用或没挑颜色时为空串。
     */
    function buildCardSheet(state, targets) {
      const s = state || {}
      if (!Array.isArray(targets) || targets.length === 0) return ''
      /* 空串 = 跟随宿主（中性灰）；非法值同样视为未设置。 */
      if (typeof s.cardColor !== 'string' || !HEX_PATTERN.test(s.cardColor)) return ''
      const fill = s.cardColor
      /* 悬停色 = 朝白提亮一档，跟宿主"hover 更亮"的方向一致。 */
      const hover = lightenHex(fill, 0.12)
      const chunks = []
      for (const target of targets) {
        if (!target || typeof target.defClass !== 'string' || target.defClass === '') continue
        if (typeof target.varName !== 'string' || target.varName === '') continue
        const hoverVar = typeof target.hoverVar === 'string' && target.hoverVar !== ''
          ? target.hoverVar
          : target.varName + '-hover'
        const triple = '.' + target.defClass
        chunks.push(
          triple + ',' + triple + triple + triple + '{\n'
          + target.varName + ':' + fill + ';\n'
          + hoverVar + ':' + hover + '\n}',
        )
      }
      return chunks.join('\n')
    }

    /**
     * 运行时找出卡片的类名：扫描所有样式表，找**内容里定义了目标变量**
     * 的那条规则，取它的类选择器。
     *
     * 不猜前缀、不写死哈希 —— 宿主重新构建哈希变了也能跟上。
     * 跨域样式表读 cssRules 会抛，逐个 try 跳过。
     *
     * @returns {Array<{defClass:string,varName:string,hoverVar:string}>} 检测到的目标组。
     */
    function detectCardTargets() {
      if (typeof document === 'undefined') return []
      /* CSSStyleSheet 是类数组（没有 Symbol.iterator），必须用下标遍历 ——
         for...of 在真实浏览器和测试替身里都会抛。 */
      const sheets = document.styleSheets
      if (!sheets || typeof sheets.length !== 'number') return []
      const found = []
      for (let s = 0; s < sheets.length; s += 1) {
        const sheet = sheets[s]
        if (!sheet) continue
        let rules
        try {
          rules = sheet.cssRules
        } catch {
          continue /* 跨域或不可读 */
        }
        if (!rules || typeof rules.length !== 'number') continue
        for (let r = 0; r < rules.length; r += 1) {
          const rule = rules[r]
          if (!rule) continue
          /* ⚡ 用 rule.style.getPropertyValue 而不是 rule.cssText：
             宿主注入了 160 张样式表、约 2179 条规则，读 cssText 会把每一条
             规则都**序列化**成字符串（纯为了一次 includes 判断），实测这是
             启动时的一次可观开销。getPropertyValue 直接问声明块，不序列化。 */
          const style = rule.style
          const canQuery = style !== undefined && style !== null && typeof style.getPropertyValue === 'function'
          const selector = rule.selectorText || ''
          for (const target of CARD_TARGETS) {
            if (found.some((entry) => entry.varName === target.varName)) continue
            const has = canQuery
              ? style.getPropertyValue(target.varName) !== ''
              /* 老浏览器 / 测试替身：退回文本匹配。 */
              : (rule.cssText || '').includes(target.varName)
            if (!has) continue
            /* 类名后缀是宿主 CSS Module 的约定（_card / _root），但前缀哈希每次构建都变。
               所以只固定后缀，不固定前缀。 */
            const suffix = target.defClass
            const match = new RegExp('\\.([a-zA-Z0-9]+' + suffix + ')\\b').exec(selector || rule.cssText || '')
            if (match !== null) {
              found.push({ defClass: match[1], varName: target.varName, hoverVar: target.hoverVar })
            }
          }
        }
      }
      return found
    }

    /**
     * 生成正文高亮样式表。
     *
     * 所有颜色都写成 `var(--dmt-prose-*, <Mariana 兜底>)`：既让正文跟着设置里的
     * 背景变体/强调色联动（那两个令牌由 resolveTokens 写进 body），又保证即使
     * 令牌没写进去也有正确颜色（不依赖执行顺序）。
     *
     * 强度分级是刻意的：Mariana 的语法色是给等宽代码用的，直接套到正文的
     * 加粗/斜体上会太花。这里只用三档：结构色（标题/引用/列表标记）+ 强调色
     * （加粗/行内代码）+ 中性色（正文/斜体），保证正文仍然"安静"。
     *
     * @returns {string} CSS 文本。
     */
    function buildProseSheet() {
      /* 容器选择器：只匹配 markdown 根，且排除紧凑变体。 */
      const root = '[class*="_markdown_"]:not([data-markdown-variant="compact"])'
      const rules = [
        /* 标题：用 Mariana 的 teal（函数色）做结构色，与代码块的函数名同族。 */
        `${root} :is(h1,h2,h3,h4,h5,h6){color:var(--dmt-prose-heading, #5FB3B3)}`,
        /* 加粗：暖色锚点，和 Mariana 的"数字/光标橙"呼应，但不刺眼。 */
        `${root} strong{color:var(--dmt-prose-strong, #F9AE58);font-weight:600}`,
        /* 斜体：中性次级色，避免和加粗抢注意力。 */
        `${root} em{color:var(--dmt-prose-em, #A7ADBA);font-style:italic}`,
        /* 行内代码：字符串绿（Mariana 里代码内联片段常用绿）。 */
        `${root} :not(pre) > code{color:var(--dmt-prose-code, #99C794)}`,
        /* 列表标记：次级色，弱于正文。 */
        `${root} li::marker{color:var(--dmt-prose-marker, #5FB3B3)}`,
        /* 引用块：左侧竖线换成强调色，文字降一级。 */
        `${root} blockquote{border-left-color:var(--dmt-prose-quote-border, #5FB3B3)}`,
        `${root} blockquote :is(p,li){color:var(--dmt-prose-quote, #A7ADBA)}`,
        /* 链接：保持 Mariana 蓝，加下划线让它在正文里可辨识。 */
        `${root} a{color:var(--dmt-prose-link, #80AAD5)}`,
        /* 表格表头：结构色。 */
        `${root} :is(th){color:var(--dmt-prose-heading, #5FB3B3)}`,
        /* 删除线（~~text~~）：Mariana 的 red。 */
        `${root} del{color:var(--dmt-prose-del, #EC5F67)}`,
        /* 分割线：让它在 Mariana 底色上看得见。 */
        `${root} hr{border-color:var(--dsw-alias-border-l3, #D8DEE929)}`,
        /* 任务列表勾选框：强调色。 */
        `${root} input[type="checkbox"]{accent-color:var(--dsw-alias-state-business-primary, #5FB3B3)}`,
      ]
      return rules.join('\n')
    }

    /**
     * 正文高亮亮度档位。t 是"朝白色插值"的比例（0 = 原值）。
     *
     * 只提亮**深色值**：浅色外观的 prose 色是深字浅底，朝白插值会*降低*对比度，
     * 所以浅色档原样不动。数值来自实测（在 #343D46 上算 WCAG 对比度）：
     *   off    标题 4.51 / 加粗 5.90 / 删除线 3.36
     *   soft   标题 5.39 / 加粗 6.63 / 删除线 4.14   ← 默认，全部角色都上升
     *   strong 标题 6.11 / 加粗 7.23 / 删除线 4.91   ← 最亮，删除线也过 4.5
     * soft 档下"次级文字与正文"的层次距离仍有 1.41:1，不会把正文和背景糊成一片。
     */
    const PROSE_BOOSTS = Object.freeze({
      off: Object.freeze({ t: 0, label: '原值', hint: 'Mariana 原版语法色' }),
      soft: Object.freeze({ t: 0.18, label: '提亮', hint: '默认；全部角色对比度上升' }),
      strong: Object.freeze({ t: 0.32, label: '更亮', hint: '最亮一档，删除线也达 4.5:1' }),
    })

    /**
     * 把 hex 颜色朝白色插值（线性 sRGB 空间，通道各自向 255 靠拢）。
     * @param {string} hex - `#rgb` 或 `#rrggbb`。
     * @param {number} t - 插值比例 0..1。
     * @returns {string} 提亮后的 hex（大写）；输入非法时原样返回。
     */
    function lightenHex(hex, t) {
      if (typeof hex !== 'string' || !HEX_PATTERN.test(hex) || !(t > 0)) return hex
      let body = hex.slice(1)
      if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2]
      const channels = [0, 2, 4].map((i) => parseInt(body.slice(i, i + 2), 16))
      const out = channels.map((v) => Math.round(v + (255 - v) * t))
      return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
    }

    /**
     * 正文高亮的可调色槽位。`key` 对应 `proseColors` JSON 里的键，
     * `token` 是最终写进 body 的 CSS 变量；`fallbackDark` 是"未自定义"时
     * 从色板/亮度派生的默认值来源（供设置页显示"当前生效值"）。
     */
    const PROSE_COLOR_SLOTS = Object.freeze([
      Object.freeze({ key: 'heading', token: '--dmt-prose-heading', label: '标题 / 表头' }),
      Object.freeze({ key: 'strong', token: '--dmt-prose-strong', label: '加粗' }),
      Object.freeze({ key: 'em', token: '--dmt-prose-em', label: '斜体' }),
      Object.freeze({ key: 'code', token: '--dmt-prose-code', label: '行内代码' }),
      Object.freeze({ key: 'marker', token: '--dmt-prose-marker', label: '列表标记' }),
      Object.freeze({ key: 'quote', token: '--dmt-prose-quote', label: '引用文字' }),
      Object.freeze({ key: 'quoteBorder', token: '--dmt-prose-quote-border', label: '引用竖线' }),
      Object.freeze({ key: 'link', token: '--dmt-prose-link', label: '链接' }),
      Object.freeze({ key: 'del', token: '--dmt-prose-del', label: '删除线' }),
    ])
    const PROSE_COLOR_KEYS = new Set(PROSE_COLOR_SLOTS.map((slot) => slot.key))

    /**
     * 解析正文颜色覆盖（`state.proseColors`，扁平 JSON）。
     * 与 parseCustom 同样的防御：坏输入退化成"没有覆盖"。
     * @param {unknown} raw - JSON 字符串。
     * @returns {Record<string,string>} 合法的 `{ key: '#hex' }`。
     */
    function parseProseColors(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return {}
      let data
      try {
        data = JSON.parse(raw)
      } catch {
        return {}
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) return {}
      const out = {}
      for (const [key, value] of Object.entries(data)) {
        if (!PROSE_COLOR_KEYS.has(key)) continue
        if (typeof value !== 'string' || !HEX_PATTERN.test(value)) continue
        out[key] = value
      }
      return out
    }

    /**
     * 正文高亮用到的辅助令牌（写进 body，供上面的样式表 var() 取用）。
     * 与 `--shiki-*` 分开命名，这样"关掉代码高亮"不会连带关掉正文高亮。
     *
     * 注意：这里也要吃自定义配色 —— 否则用户把"正文"调成浅灰、正文高亮却还用
     * 原始 Mariana 色，两边会打架。所以深色值统一从 `PALETTE_BASE + 覆盖` 取。
     *
     * 亮度档位只作用于深色值（浅色是深字浅底，朝白插值会降低对比度）。
     *
     * `proseColors` 是**最终覆盖层**：用户手挑的颜色不再叠加亮度提亮
     * （挑色时看到什么就是什么，所见即所得）。
     *
     * @param {object} state - 当前设置。
     * @returns {Record<string, {light: string, dark: string}>}
     */
    function resolveProseTokens(state) {
      const custom = parseCustom(state && state.custom)
      const base = withOverrides(PALETTE_BASE, custom.palette)
      const a = ACCENTS[state && state.accent] || ACCENTS.teal
      const t = (PROSE_BOOSTS[state && state.proseBoost] || PROSE_BOOSTS.off).t
      const p = t > 0
        ? {
            teal: lightenHex(base.teal, t),
            orange: lightenHex(base.orange, t),
            dim: lightenHex(base.dim, t),
            green: lightenHex(base.green, t),
            blueUi: lightenHex(base.blueUi, t),
            red: lightenHex(base.red, t),
          }
        : base
      const derived = {
        heading: p.teal,
        strong: p.orange,
        em: p.dim,
        code: p.green,
        marker: a.dark,
        quote: p.dim,
        quoteBorder: a.dark,
        link: p.blueUi,
        del: p.red,
      }
      const lightDefaults = {
        heading: '#3E8E8E',
        strong: '#C97A2B',
        em: LIGHT.dim,
        code: '#4E8A4A',
        marker: a.light,
        quote: LIGHT.dim,
        quoteBorder: a.light,
        link: LIGHT.link,
        del: '#C4464F',
      }
      const picked = parseProseColors(state && state.proseColors)
      const out = {}
      for (const slot of PROSE_COLOR_SLOTS) {
        /* 手挑色优先，且原样使用（不再叠加亮度）。 */
        const dark = Object.prototype.hasOwnProperty.call(picked, slot.key) ? picked[slot.key] : derived[slot.key]
        out[slot.token] = { dark, light: lightDefaults[slot.key] }
      }
      return out
    }

    /* ====================================================================== *
     * 三、设置页样式（全部用 --dsw-alias-*，所以它自己也跟着 Mariana 变）
     * ====================================================================== */

    const SHEET_ID = 'dsh-colorlab/page.css'
    const SHEET = `
.dmt-root{display:flex;flex-direction:column;gap:20px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dmt-head{display:flex;flex-direction:column;gap:6px}
.dmt-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dmt-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
/* 🔧 页面整理（2026-10-22）：dmt-status / dmt-chip / dmt-dot 三组样式随
 * 芯片行退役 —— 诊断改用 dmt-diagLine（隐身式，见页头注释）。 */
.dmt-row{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dmt-rowText{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;padding-right:24px}
.dmt-rowTitle{font-size:14px;color:var(--dsw-alias-label-primary)}
.dmt-rowHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dmt-switch{position:relative;flex:none;width:42px;height:24px;border-radius:999px;border:none;cursor:pointer;padding:0;background:var(--dsw-alias-state-idle-primary);transition:background var(--ds-transition-duration) var(--ds-ease-in-out)}
.dmt-switch[aria-pressed="true"]{background:var(--dsw-alias-state-business-primary)}
.dmt-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb);transition:transform var(--ds-transition-duration) var(--ds-ease-in-out)}
.dmt-switch[aria-pressed="true"]::after{transform:translateX(18px)}
.dmt-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dmt-seg{display:inline-flex;flex:none;gap:2px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2)}
.dmt-segBtn{border:none;cursor:pointer;padding:5px 12px;border-radius:calc(var(--dsw-radius-md) - 2px);font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:transparent}
.dmt-segBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmt-segBtn[aria-pressed="true"]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
.dmt-swatches{display:flex;flex:none;gap:8px}
.dmt-swatch{position:relative;width:44px;height:44px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l4);cursor:pointer;padding:0;overflow:hidden}
.dmt-swatch[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1.5px var(--dsw-alias-label-primary) inset}
.dmt-swatchLabel{position:absolute;inset:auto 0 0 0;font-size:10px;line-height:14px;text-align:center;color:#fff;background:#00000080}
.dmt-notice{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dmt-noticeText{flex:1;min-width:0}
.dmt-btn{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:6px 12px;cursor:pointer;flex:none}
.dmt-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dmt-btn[data-variant="primary"]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.dmt-palette{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
.dmt-card{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);min-width:0}
.dmt-chipSwatch{width:18px;height:18px;border-radius:var(--dsw-radius-xs);border:.5px solid var(--dsw-alias-border-l4);flex:none}
.dmt-cardText{display:flex;flex-direction:column;min-width:0}
.dmt-cardName{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-cardHex{font-family:var(--ds-font-family-code);font-size:11px;line-height:15px;color:var(--dsw-alias-label-caption);text-transform:uppercase}
.dmt-preview{margin:0;padding:12px 14px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-markdown-code-block);border:.5px solid var(--dsw-alias-border-l2);font-family:var(--ds-font-family-code);font-size:12px;line-height:20px;overflow-x:auto;white-space:pre}
/* 正文高亮预览：故意用与真实正文同一套选择器结构，保证"所见即所得"。
   这里不能依赖宿主的 _markdown_ 哈希类名，所以单独声明一份等价的类。 */
.dmt-prosePreview{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2)}
.dmt-proseLabel{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);letter-spacing:.02em}
.dmt-proseBody{min-width:0;font-size:13px;line-height:21px;color:var(--dsw-alias-label-primary)}
.dmt-proseBody h4{margin:0 0 6px;font-size:14px;font-weight:600}
.dmt-proseBody p{margin:0 0 6px}
.dmt-proseBody ul{margin:0 0 6px;padding-left:20px}
.dmt-proseBody blockquote{margin:0;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l3)}
.dmt-proseBody blockquote p{margin:0}
.dmt-proseBody code{font-family:var(--ds-font-family-code);font-size:12px;background:var(--dsw-alias-markdown-inline-code);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xs);padding:0 4px}
.dmt-proseBody a{color:var(--dsw-alias-link);text-decoration:none}
/* 开：套用正文高亮配色（与 buildProseSheet 的取值保持一致） */
.dmt-prosePreview[data-prose="on"] .dmt-proseBody h4{color:var(--dmt-prose-heading, #5FB3B3)}
.dmt-prosePreview[data-prose="on"] .dmt-proseBody strong{color:var(--dmt-prose-strong, #F9AE58)}
.dmt-prosePreview[data-prose="on"] .dmt-proseBody em{color:var(--dmt-prose-em, #A7ADBA)}
.dmt-prosePreview[data-prose="on"] .dmt-proseBody code{color:var(--dmt-prose-code, #99C794)}
.dmt-prosePreview[data-prose="on"] .dmt-proseBody li::marker{color:var(--dmt-prose-marker, #5FB3B3)}
.dmt-prosePreview[data-prose="on"] .dmt-proseBody blockquote{border-left-color:var(--dmt-prose-quote-border, #5FB3B3)}
.dmt-prosePreview[data-prose="on"] .dmt-proseBody blockquote p{color:var(--dmt-prose-quote, #A7ADBA)}
.dmt-prosePreview[data-prose="on"] .dmt-proseBody a{color:var(--dmt-prose-link, #80AAD5)}
/* 自定义配色 */
.dmt-custom{display:flex;flex-direction:column;gap:10px}
.dmt-customGroup{display:flex;flex-direction:column;gap:6px}
.dmt-customGroupTitle{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);letter-spacing:.04em}
.dmt-fold{border:1px solid var(--dsw-alias-border-l4);border-radius:8px;padding:0 12px;margin:10px 0;background:var(--dsw-alias-bg-layer-1)}
.dmt-foldSummary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);user-select:none}
.dmt-foldSummary::-webkit-details-marker{display:none}
.dmt-foldSummary::before{content:'▸';font-size:10px;color:var(--dsw-alias-label-caption);transition:transform .12s ease}
.dmt-fold[open]>summary::before{transform:rotate(90deg)}
.dmt-foldSummary:hover{color:var(--dsw-alias-label-primary)}
.dmt-foldMeta{font-size:11px;color:var(--dsw-alias-label-caption);margin-left:auto}
.dmt-fold[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l4)}
.dmt-foldBody{padding:4px 0 12px}
.dmt-diagLine{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);padding:2px 0 6px}
.dmt-diagText{color:var(--dsw-alias-label-caption)}
.dmt-diagText[data-warn=1]{color:#FAC863}
.dmt-groupHead{margin:18px 0 4px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l4)}
.dmt-groupTitle{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary);letter-spacing:.02em}
.dmt-groupSub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.dmt-customGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 10px}
.dmt-slot{display:flex;align-items:center;gap:8px;min-width:0}
.dmt-slotSwatch{position:relative;flex:none;width:26px;height:26px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l4);overflow:hidden;cursor:pointer;padding:0;background:transparent}
.dmt-slotSwatch input{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);border:none;padding:0;cursor:pointer;background:transparent;opacity:0}
.dmt-slotText{display:flex;flex-direction:column;min-width:0;flex:1}
.dmt-slotLabel{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-slotHex{font-family:var(--ds-font-family-code);font-size:11px;line-height:15px;color:var(--dsw-alias-label-caption);text-transform:uppercase;border:none;background:transparent;padding:0;width:100%;color:var(--dsw-alias-label-caption);outline:none}
.dmt-slotHex:focus{color:var(--dsw-alias-label-primary)}
.dmt-slotReset{border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-caption);font-size:14px;line-height:1;padding:2px 4px;border-radius:var(--dsw-radius-xs);flex:none}
.dmt-slotReset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dmt-warn{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary)}
/* 配色方案 */
.dmt-presets{display:flex;flex-direction:column;gap:8px}
.dmt-presetList{display:flex;flex-direction:column;gap:4px}
.dmt-preset{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2)}
.dmt-presetDots{display:flex;gap:3px;flex:none}
.dmt-presetDot{width:10px;height:10px;border-radius:50%;corner-shape:round;border:.5px solid var(--dsw-alias-border-l4)}
.dmt-presetName{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-presetMeta{font-size:11px;color:var(--dsw-alias-label-caption);flex:none}
.dmt-presetActions{display:flex;gap:4px;flex:none}
.dmt-miniBtn{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:16px;padding:3px 8px;cursor:pointer;flex:none}
.dmt-miniBtn:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dmt-miniBtn[data-danger="true"]:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
/* 文件卡片预览：复刻宿主 ChangedFiles 的结构 —— 卡片底 + 头部横带（--changes-fill）
   + 图标衬底 + 标题/统计。头部色走容器内联变量，草稿只盖预览，不碰全局。 */
.dmt-cardPreview{display:flex;flex-direction:column;gap:8px}
.dmt-cardDemo{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);overflow:hidden;min-width:0}
.dmt-cardDemoHead{display:flex;align-items:center;gap:10px;padding:8px 10px;height:60px;box-sizing:border-box;background:var(--changes-fill,#212123);color:var(--dsw-alias-label-primary)}
/* 交付文件卡片（宿主 Deliverables）：没有横带，整张卡片底色就是 --deliverable-fill。 */
.dmt-deliverDemo{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--deliverable-fill,#212123);display:flex;align-items:center;gap:10px;padding:8px 10px;height:60px;box-sizing:border-box;min-width:0;color:var(--dsw-alias-label-primary)}
.dmt-deliverDemoIcon{width:40px;height:40px;flex:none;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:color-mix(in srgb, var(--dsw-static-neutral-00) 5%, transparent);display:grid;place-items:center;font-size:18px}
.dmt-deliverDemoBody{display:flex;flex-direction:column;flex:1;min-width:0}
.dmt-deliverDemoName{font-size:13px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-deliverDemoDesc{font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-cardDemoLabel{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption)}
.dmt-cardDemoTile{width:40px;height:40px;flex:none;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:color-mix(in srgb, var(--dsw-static-neutral-00) 5%, transparent);display:grid;place-items:center;font-size:18px}
.dmt-cardDemoTitles{display:flex;flex-direction:column;flex:1;min-width:0}
.dmt-cardDemoTitle{font-size:13px;font-weight:500;line-height:20px}
.dmt-cardDemoStat{display:flex;gap:6px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code)}
.dmt-cardDemoAdded{color:var(--dsw-alias-state-success-primary)}
.dmt-cardDemoDeleted{color:var(--dsw-alias-state-error-primary)}
.dmt-cardDemoRow{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:.5px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);min-width:0}
.dmt-cardDemoPath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-cardDemoCounts{font-family:var(--ds-font-family-code);font-size:11px;flex:none}
.dmt-saveRow{display:flex;gap:8px;align-items:center}
.dmt-saveInput{flex:1;min-width:0;font:inherit;font-size:13px;padding:6px 10px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);outline:none}
.dmt-saveInput:focus{border-color:var(--dsw-alias-state-business-primary)}
.dmt-saveInput::placeholder{color:var(--dsw-alias-label-caption)}
.dmt-empty{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);padding:6px 2px}
/* 过程行高亮 */
.dmt-colorInput{width:56px;height:30px;padding:2px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);cursor:pointer;flex:none}
.dmt-checkGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 10px}
.dmt-checkGroup{display:flex;flex-direction:column;gap:6px}
.dmt-checkGroupTitle{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);letter-spacing:.04em}
.dmt-check{display:flex;align-items:center;gap:7px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;min-width:0}
.dmt-check input{accent-color:var(--dsw-alias-state-business-primary);margin:0;flex:none;cursor:pointer}
.dmt-checkSwatch{width:12px;height:12px;border-radius:3px;border:1px solid var(--dsw-alias-border-l4);flex:none}
.dmt-check[data-shared="true"] .dmt-checkSwatch{border-style:dashed}
.dmt-checkTag{font-size:9px;line-height:12px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-caption);flex:none}
/* 预览：结构复刻宿主的 ToolRow（data-variant + data-disclosure-header +
   _leading / _title 类名），所以真实样式表会直接命中它。 */
.dmt-rowPreview{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2)}
.dmt-rowItem{display:flex;flex-direction:column}
.dmt-rowHeader{display:block}
.dmt-row{display:flex;align-items:center;gap:0;font-size:13px;line-height:24px;color:var(--dsw-alias-label-secondary);min-width:0}
.dmt-rowIcon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:16px;flex:none;font-size:12px}
.dmt-rowTitle{font-weight:400;flex:none}
.dmt-rowSep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}
.dmt-rowSummary{font-size:13px;line-height:24px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto}
/* 汇总行 / 本轮汇总的预览：宿主这两类整行就是一个 button，图标 color:inherit，
   所以 button 上设色即可带着图标与文字一起变。 */
.dmt-rowButton{display:flex;align-items:center;gap:6px;width:100%;min-width:0;border:0;background:0 0;padding:0;font:inherit;font-size:13px;line-height:24px;text-align:left;cursor:pointer;color:var(--dsw-alias-label-tertiary)}
.dmt-rowLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmt-footer{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}
/* 草稿条：有未应用的颜色改动时出现 */
.dmt-draftBar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-state-warn-primary)}
.dmt-draftText{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}
.dmt-sliderRow{display:inline-flex;align-items:center;gap:10px;flex:none}
.dmt-slider{width:132px;height:20px;accent-color:var(--dsw-alias-state-business-primary,#5FB3B3);cursor:pointer}
.dmt-sliderValue{min-width:46px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dmt-slider[disabled]{opacity:.45;cursor:default}
.dmt-pathInput{box-sizing:border-box;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px}
.dmt-pathInput::placeholder{color:var(--dsw-alias-label-tertiary)}
`

    /* ====================================================================== *
     * 四、运行时：把设置翻译成令牌叠加层
     * ====================================================================== */

    /**
     * 把 CSS 写进 `<style>`，但**只在内容真的变了时才写**。
     *
     * 为什么必须这样（实测的启动变慢主因）：给 `<style>.textContent` 赋值会让
     * 浏览器**重新解析整张样式表并触发一次全文档样式重算** —— 哪怕内容一个字
     * 都没变。而 `applyNow()` 在启动期会被反复调用：
     *
     *   1. `apply()` 里立即一次；
     *   2. 每次 `theme/change` 事件；
     *   3. **等待 `form` 服务时的 250ms 重试**（`bindWhenReady` 最多 120 轮 ≈ 30 秒）
     *      —— 第 3 条以前每 250ms 就把四五张表全部重写一遍。
     *
     * 缓存挂在元素自己身上（`__dmtCss`），所以元素被移除重建后会自动重新写入。
     *
     * @param {HTMLStyleElement|null} el - 目标 style 元素。
     * @param {string} css - 期望内容。
     */
    function writeSheet(el, css) {
      if (el === null) return
      if (el.__dmtCss === css) return
      el.__dmtCss = css
      el.textContent = css
    }

    /** 极简可订阅 store（不引第三方状态库）。 */
    function createStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          snapshot = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              note('store listener', error)
            }
          }
        },
      }
    }

    /** 诊断信息只进 console 与 DOM 属性，绝不打断主题渲染。 */
    function note(where, error) {
      try {
        // eslint-disable-next-line no-console
        console.warn('[dsh-colorlab] ' + where, error)
      } catch {
        /* 无 console 的宿主 */
      }
    }

    const state = { ...DEFAULTS }
    const store = createStore({ ...DEFAULTS, status: initialStatus() })
    const diag = { theme: 'pending', form: 'pending', scheme: 'unknown', applied: 0, channel: 'none', prose: 'off', row: 'off', card: 'off', markdown: 'off', latex: 0, glass: 'off', shape: 'off', contour: '' }

    /**
     * 未确认的颜色改动；空对象 = 无草稿。
     * 声明在这里是因为 publish 会读它（见"四·五、草稿"一节的说明）。
     */
    let draft = {}

    function initialStatus() {
      return { theme: 'pending', form: 'pending', scheme: 'unknown', applied: 0, channel: 'none', prose: 'off', row: 'off', card: 'off', shape: 'off' }
    }

    /**
     * 上一次 publish 出去的内容签名。
     * 内容没变就不 `store.set` —— `set` 会换掉快照引用，让设置页的
     * `useSyncExternalStore` 重渲染一次。
     */
    let lastPublishSignature = null

    /**
     * 把内部诊断对象摊成 store 快照。
     * 快照 = 已生效值 + 草稿覆盖（控件与预览显示草稿），外加 `draftFields`
     * 告诉界面"有哪些字段还没应用"。
     *
     * ⚡ 内容完全一致时直接返回：`applyNow()` 在启动期等 `form` 服务时会每 250ms
     * 被调一次，而它每次都调 `publish()` —— 没有这个守卫就是「设置页每 250ms
     * 重渲染一次」。也顺带保证快照引用稳定（React 要求没变时引用不变）。
     */
    function publish() {
      const payload = { ...state, ...draft, draftFields: Object.keys(draft), status: { ...diag } }
      const signature = JSON.stringify(payload)
      if (signature === lastPublishSignature) return
      lastPublishSignature = signature
      store.set(payload)
    }

    /** 应用后的清理句柄（overrideTokens 的 disposer 或回退 style 的移除函数）。 */
    let releaseLayer = null
    /** 当前通过哪条通道生效，用于避免两条同时写。 */
    let channel = 'none'
    /** 回退通道插入的 <style> 元素。 */
    let fallbackEl = null
    /**
     * 上一次成功推给 `overrideTokens` 的令牌签名。
     * 内容一致时跳过重复推送（见 applyNow 里的说明）。
     */
    let lastTokenSignature = null
    /** 缓存的 theme 服务句柄。 */
    let themeService = null

    /**
     * 解析出的外观是否为深色。
     * @returns {'light'|'dark'|'unknown'}
     */
    function resolvedScheme() {
      try {
        const snapshot = themeService !== null ? themeService.getTheme() : undefined
        const scheme = snapshot && snapshot.active && snapshot.active.colorScheme
        if (scheme === 'dark' || scheme === 'light') return scheme
      } catch (error) {
        note('resolvedScheme', error)
      }
      /* theme 服务拿不到时退回媒体查询：至少能判断系统级深浅。 */
      try {
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        }
      } catch {
        /* 无 window */
      }
      return 'unknown'
    }

    /** 当前设置是否应当在界面上生效。 */
    function shouldApply() {
      if (state.enabled === 'off') return false
      if (state.schemeMode === 'both') return true
      const scheme = resolvedScheme()
      /* 判断不出来时按"该套用"处理：Mariana 是深色主题，误套用比不生效更容易被发现。 */
      return scheme !== 'light'
    }

    /**
     * 「插件已关闭」的总闸属性（与 Host 半体 `index.js` 里的同名常量一致）。
     *
     * 宿主半体注入的首屏画布色是**烤进 HTML** 的，页面加载后撤不掉。它外面套了
     * `html:not([data-dsh-colorlab-off])` 当总闸，这里负责开合：
     *
     *   - 启用中 → 移除属性（首屏色生效）
     *   - 关掉「启用」/ 插件被卸载 → 打上属性（首屏色立刻失效，底色回宿主默认）
     *
     * 没有这一步，用户关掉插件后就会出现"高亮没了、但界面底色还是 Mariana"。
     */
    const DISABLED_ATTR = 'data-dsh-colorlab-off'

    /** 按当前开关状态维护总闸属性。 */
    function syncDisabledMarker() {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (root === undefined || root === null) return
      try {
        if (state.enabled === 'off') {
          if (typeof root.setAttribute === 'function') root.setAttribute(DISABLED_ATTR, '')
        } else if (typeof root.removeAttribute === 'function') {
          root.removeAttribute(DISABLED_ATTR)
        }
      } catch (error) {
        note('sync disabled marker', error)
      }
    }

    /** 正文高亮样式表元素（独立于主题通道，由 prose 开关单独控制）。 */
    let proseEl = null

    /** Markdown 细节样式表元素（独立于 prose 开关 —— 对齐 Sublime 的基础层）。 */
    let markdownEl = null

    /**
     * 按当前设置挂上或卸下正文高亮样式表。
     *
     * 与主题通道解耦：正文高亮是"往宿主 DOM 加规则"，不是令牌叠加，
     * 所以它自己判断 `enabled` / `prose` / 外观模式三个条件。
     */
    function syncProseSheet() {
      if (typeof document === 'undefined') return
      const wanted = state.enabled !== 'off' && state.prose !== 'off' && shouldApply()
      if (!wanted) {
        if (proseEl !== null) {
          try {
            proseEl.remove()
          } catch (error) {
            note('remove prose sheet', error)
          }
          proseEl = null
        }
        diag.prose = 'off'
        return
      }
      try {
        if (proseEl === null) {
          proseEl = document.createElement('style')
          proseEl.dataset.plugin = 'dsh-colorlab'
          proseEl.dataset.pluginCss = PROSE_SHEET_ID
          document.head.appendChild(proseEl)
        }
        writeSheet(proseEl, buildProseSheet())
        diag.prose = 'on'
      } catch (error) {
        note('install prose sheet', error)
        diag.prose = 'error'
      }
    }

    /**
     * 按当前设置挂上或卸下 Markdown 细节样式表。
     *
     * 与正文高亮**解耦**：正文高亮是「对话正文」的增强（可关），
     * Markdown 细节是「对齐 Sublime Mariana 的 markup 规则」的基础层
     * （预览 .md 文件、对话里的 markdown 都该有），不随 prose 开关消失。
     */
    function syncMarkdownSheet() {
      if (typeof document === 'undefined') return
      const wanted = state.enabled !== 'off' && shouldApply()
      if (!wanted) {
        if (markdownEl !== null) {
          try {
            markdownEl.remove()
          } catch (error) {
            note('remove markdown sheet', error)
          }
          markdownEl = null
        }
        diag.markdown = 'off'
        return
      }
      try {
        if (markdownEl === null) {
          markdownEl = document.createElement('style')
          markdownEl.dataset.plugin = 'dsh-colorlab'
          markdownEl.dataset.pluginCss = MARKDOWN_SHEET_ID
          document.head.appendChild(markdownEl)
        }
        writeSheet(markdownEl, buildMarkdownSheet())
        diag.markdown = 'on'
      } catch (error) {
        note('install markdown sheet', error)
        diag.markdown = 'error'
      }
    }

    /** 过程行高亮样式表元素（独立于主题通道与正文高亮）。 */
    let rowEl = null

    /* ---- LaTeX 块标记：样式表 + 观察器 ---------------------------------- */

    /** LaTeX 覆盖样式表元素。 */
    let latexEl = null
    /** 观察器与合帧定时器（代码块是滚动时才渲染的）。 */
    let latexObserver = null
    let latexRescanTimer = null

    /**
     * 把 LaTeX 块的标记同步到 DOM，并维护覆盖样式表。
     *
     * 代码块是**动态渲染**的（滚动到旧消息才插进 DOM），所以不能只在设置变更时扫一遍；
     * 观察器会在 DOM 变化时合帧重扫。
     */
    function syncLatexSheet() {
      if (typeof document === 'undefined') return
      const wanted = state.enabled !== 'off' && shouldApply() && state.syntax !== 'off'
      if (wanted) ensureLatexObserver()
      else disposeLatexObserver()

      let blocks = []
      try {
        blocks = document.querySelectorAll('pre.shiki')
      } catch {
        blocks = []
      }
      let count = 0
      for (let i = 0; i < blocks.length; i += 1) {
        const pre = blocks[i]
        if (!pre || !pre.classList) continue
        const marked = pre.classList.contains(LATEX_BLOCK_CLASS)
        /* 判据用**宿主原本的文本**，不能算上我们自己的渲染层（否则文本翻倍） */
        const srcText = texSourceOf(pre)
        if (shouldRenderLatex(pre)) {
          count += 1
          if (!marked) {
            try {
              pre.classList.add(LATEX_BLOCK_CLASS)
            } catch {
              /* classList 不可用 */
            }
          }
          /* 渲染成我们自己的层（原层隐藏但保留，React 照常更新它）。
             `syncTexLayer` 内部按**原文内容**判断要不要重画 —— 早先用
             「子元素数 + 文本长度」，重渲染后这两个数不变，于是永远跳过、
             样式补不回来。 */
          syncTexLayer(pre, srcText)
        } else if (marked) {
          try {
            pre.classList.remove(LATEX_BLOCK_CLASS)
          } catch {
            /* 同上 */
          }
          disposeTexLayer(pre)
        }
      }
      diag.latex = count

      if (!wanted || count === 0) {
        if (latexEl !== null) {
          try {
            latexEl.remove()
          } catch (error) {
            note('remove latex sheet', error)
          }
          latexEl = null
        }
        return
      }
      try {
        if (latexEl === null) {
          latexEl = document.createElement('style')
          latexEl.dataset.plugin = 'dsh-colorlab'
          latexEl.dataset.pluginCss = LATEX_SHEET_ID
          document.head.appendChild(latexEl)
        }
        writeSheet(latexEl, buildLatexSheet())
      } catch (error) {
        note('install latex sheet', error)
        diag.latex = 'error'
      }
    }

    /**
     * 合帧重扫：DOM 一次变动可能带进很多节点，合并成一次。
     *
     * 用 50ms 而不是更大的值：代码块「先无色 → Shiki 普通高亮 → 我们的 LaTeX 高亮」
     * 这个三跳本身不可避免，但**我们这一跳的延迟要尽量小**。重扫本身很便宜
     * （内容没变时 `syncTexLayer` 直接返回），短去抖不会带来负担。
     */
    function scheduleLatexRescan() {
      if (latexRescanTimer !== null) return
      if (typeof setTimeout !== 'function') return
      latexRescanTimer = setTimeout(() => {
        latexRescanTimer = null
        syncLatexSheet()
      }, 50)
      if (latexRescanTimer && typeof latexRescanTimer.unref === 'function') latexRescanTimer.unref()
    }

    /** 装上观察器（幂等）。只听 childList，改 class 不会自激。 */
    function ensureLatexObserver() {
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return
      if (latexObserver !== null) return
      try {
        latexObserver = new MutationObserver(() => scheduleLatexRescan())
        latexObserver.observe(document.body, { childList: true, subtree: true })
      } catch {
        latexObserver = null
      }
    }

    /** 拆掉观察器与定时器。 */
    function disposeLatexObserver() {
      if (latexObserver !== null) {
        try {
          latexObserver.disconnect()
        } catch {
          /* 已断开 */
        }
        latexObserver = null
      }
      if (latexRescanTimer !== null) {
        try {
          clearTimeout(latexRescanTimer)
        } catch {
          /* 无 timer */
        }
        latexRescanTimer = null
      }
    }

    /** 卡片覆盖样式表元素 + 检测到的卡片类名（null = 还没检测到，稍后重试）。 */
    let cardEl = null
    let cardTargets = undefined
    let cardRetryTimer = null
    /** 重试有界：卡片组件（ui-deliverables）可能被禁用，不能每秒轮询到天荒地老。 */
    const CARD_RETRY_MAX = 60
    let cardRetryCount = 0
    /**
     * 上次扫描时看到的样式表数量。
     *
     * ⚡ 只在数量**变了**的时候才重扫。宿主注入了 160 张样式表 / 约 2179 条规则，
     * 而等待 ui-deliverables 出现的重试是每秒一次、最多 60 次 —— 每次都全量扫一遍
     * 就是 60 次无谓遍历。数量没变就说明没有新表进来，不可能有新发现。
     */
    let cardScanSheetCount = -1

    /**
     * 按当前设置挂上或卸下文件卡片头部覆盖样式表。
     * 卡片类名要等 ui-deliverables 的样式表进 DOM 才检测得到；检测不到时
     * 有界重试（syncCardSheet 会在每次 applyNow 再试一次，另有定时器兜底）。
     */
    /**
     * 合并两轮检测结果（按 `varName` 去重，保留先找到的）。
     *
     * 宿主分批注入样式表，所以要能把「这轮新找到的」并进「上轮的」，
     * 而不是覆盖 —— 覆盖会把先找到的那组丢掉。
     *
     * @param {Array|undefined} prev - 上轮结果。
     * @param {Array} found - 本轮结果。
     * @returns {Array} 合并后的结果。
     */
    function mergeCardTargets(prev, found) {
      const merged = Array.isArray(prev) ? prev.slice() : []
      const list = Array.isArray(found) ? found : []
      for (let i = 0; i < list.length; i += 1) {
        if (!merged.some((entry) => entry.varName === list[i].varName)) merged.push(list[i])
      }
      return merged
    }

    /**
     * 是否**找齐**了全部卡片组件。
     *
     * ⚠️ 判据是「≥ CARD_TARGETS 的条数」，不是「非空」。早先用非空判定，
     * 于是第一轮只找到一个就再也不重试 —— 表现是「已编辑」卡片有色、
     * 「交付文件」卡片一直没色。
     *
     * @param {Array|undefined} targets - 检测结果。
     * @returns {boolean}
     */
    function cardTargetsComplete(targets) {
      return Array.isArray(targets) && targets.length >= CARD_TARGETS.length
    }

    function syncCardSheet() {
      if (typeof document === 'undefined') return
      /* ⚠️ **要「全找齐」而不是「找到一个」。**
         宿主是**分批**注入样式表的：第一轮往往只找得到 ChangedFiles 的
         `--changes-fill`，Deliverables 的 `--deliverable-fill` 晚一步才进 DOM。
         早先的判据是「检测结果非空即算成功」，于是找到一个就再也不重试 ——
         表现就是「已编辑」卡片有色、而「交付文件」卡片一直没色。
         现在按 CARD_TARGETS 的总数判定，且有新样式表进来就合并重扫。 */
      const total = CARD_TARGETS.length
      let have = Array.isArray(cardTargets) ? cardTargets.length : 0
      if (have < total) {
        const sheets = document.styleSheets
        const count = sheets !== undefined && sheets !== null && typeof sheets.length === 'number'
          ? sheets.length
          : -1
        if (count !== cardScanSheetCount) {
          cardScanSheetCount = count
          cardTargets = mergeCardTargets(cardTargets, detectCardTargets())
          have = cardTargets.length
        }
      }
      const css = buildCardSheet(state, cardTargets)
      const wanted = state.enabled !== 'off' && shouldApply() && css !== ''
      if (!wanted) {
        if (cardEl !== null) {
          try {
            cardEl.remove()
          } catch (error) {
            note('remove card sheet', error)
          }
          cardEl = null
        }
        /* 用户挑了色但一组类名都还没找到 = pending（下面安排重试），否则 = off。 */
        const pickedColor = HEX_PATTERN.test(state.cardColor)
        const applied = Array.isArray(cardTargets) && cardTargets.length > 0
        diag.card = !pickedColor ? 'off' : applied ? 'off' : 'pending'
        /* 找齐了就清零计数（下次用户再挑色时重试预算是满的）。 */
        if (cardTargetsComplete(cardTargets)) cardRetryCount = 0
        /* 🔧 重试触发条件扩展（2026-10-22）：不只是"用户挑了卡片色" ——
         * 玻璃开着时，buildGlassSheet 也要用检测结果给卡片写元素级覆盖
         * （宿主把 --*-fill 声明在卡片元素上，body 级压不住）。
         * 晚到的懒加载样式表同样得有人把检测补全。 */
        const glassWantsTargets = state.enabled !== 'off' && state.glass === 'on' && shouldApply()
        if ((pickedColor || glassWantsTargets) && !cardTargetsComplete(cardTargets)
          && cardRetryTimer === null && !disposed && cardRetryCount < CARD_RETRY_MAX) {
          cardRetryTimer = setTimeout(() => {
            cardRetryTimer = null
            cardRetryCount += 1
            applyNow()
          }, 1000)
          if (cardRetryTimer && typeof cardRetryTimer.unref === 'function') cardRetryTimer.unref()
        }
        return
      }
      try {
        if (cardEl === null) {
          cardEl = document.createElement('style')
          cardEl.dataset.plugin = 'dsh-colorlab'
          cardEl.dataset.pluginCss = CARD_SHEET_ID
          document.head.appendChild(cardEl)
        }
        writeSheet(cardEl, css)
        diag.card = 'on'
      } catch (error) {
        note('install card sheet', error)
        diag.card = 'error'
      }
    }

    /**
     * 按当前设置挂上或卸下过程行高亮样式表。
     *
     * 与正文高亮同样的三条件门控：主开关、自己的开关、外观模式。
     * 另外"没选中任何分类"也等于关 —— 这时不挂空表，省一个节点。
     */
    function syncRowSheet() {
      if (typeof document === 'undefined') return
      const css = state.rowHighlight !== 'off' ? buildRowSheet(state) : ''
      const wanted = state.enabled !== 'off' && shouldApply() && css !== ''
      if (!wanted) {
        if (rowEl !== null) {
          try {
            rowEl.remove()
          } catch (error) {
            note('remove row sheet', error)
          }
          rowEl = null
        }
        diag.row = state.rowHighlight === 'off' ? 'off' : css === '' ? 'none' : 'off'
        return
      }
      try {
        if (rowEl === null) {
          rowEl = document.createElement('style')
          rowEl.dataset.plugin = 'dsh-colorlab'
          rowEl.dataset.pluginCss = ROW_SHEET_ID
          document.head.appendChild(rowEl)
        }
        writeSheet(rowEl, css)
        diag.row = 'on'
      } catch (error) {
        note('install row sheet', error)
        diag.row = 'error'
      }
    }

    /** 卸掉当前生效的通道，回到宿主原样。 */
    function teardown() {
      if (releaseLayer !== null) {
        try {
          releaseLayer()
        } catch (error) {
          note('teardown override', error)
        }
        releaseLayer = null
      }
      if (fallbackEl !== null) {
        try {
          fallbackEl.remove()
        } catch (error) {
          note('teardown style', error)
        }
        fallbackEl = null
      }
      channel = 'none'
      diag.channel = 'none'
      diag.applied = 0
      /* 层已摘掉，签名一并作废 —— 否则下次 applyNow 会以为层还装着而跳过重装。 */
      lastTokenSignature = null
    }

    /** 回退通道：注入一条样式表直接改令牌。 */
    function installFallback(tokens) {
      if (typeof document === 'undefined') return false
      try {
        if (fallbackEl === null) {
          fallbackEl = document.createElement('style')
          fallbackEl.dataset.plugin = 'dsh-colorlab'
          document.head.appendChild(fallbackEl)
        }
        const pick = (mode) =>
          Object.keys(tokens)
            .map((name) => name + ':' + tokens[name][mode] + ';')
            .join('')
        /* 深色规则用 body[data-ds-dark-theme]（0,1,1）压过宿主的同名规则：
           特异性打平后靠"后插入的源序"取胜。浅色规则用 body 同理。
           --shiki-* 在宿主里声明于 :root，body 上的值对 body 后代更近，直接胜出。 */
        fallbackEl.textContent =
          'body[data-ds-dark-theme]{' + pick('dark') + '}\n' +
          'body:not([data-ds-dark-theme]){' + pick('light') + '}'
        channel = 'style'
        diag.channel = 'style'
        diag.applied = Object.keys(tokens).length
        return true
      } catch (error) {
        note('installFallback', error)
        return false
      }
    }

    /**
     * `applyNow` 的重入标记。
     *
     * ⚠️ **这不是防御性代码，是修一个真实爆栈**（真机控制台抓到的）：
     *
     *   applyNow → overrideTokens → 宿主 publish() → **同步** emit `theme/change`
     *   → 我们的监听器 → applyNow → overrideTokens → …… 无限递归，
     *   最终在 `JSON.stringify(tokens)` 处 `RangeError: Maximum call stack size exceeded`。
     *
     * 注意「内容签名」那条守卫**救不了**：签名是在 `overrideTokens` **返回之后**才赋值的，
     * 而 emit 发生在它**内部**，所以重入时的比对永远拿不到新签名。
     *
     * 正确做法是直接拒绝重入 —— 自己刚推的层不需要再响应一次自己触发的事件。
     */
    let applying = false

    /**
     * 重新计算并应用一次。
     * 幂等：重复调用只是替换同一来源的叠加层（overrideTokens 对同 source 是整层替换）。
     *
     * 出口统一：先决定主题通道，再在函数末尾一次性同步两张注入式样式表
     * （正文 + 过程行）。之前每个 return 前各调一次，加分支就会漏一次。
     */
    function applyNow() {
      if (applying) return
      applying = true
      try {
        applyNowOnce()
      } finally {
        applying = false
      }
    }

    /** `applyNow` 的实际工作体（外层只负责防重入）。 */
    function applyNowOnce() {
      const tokens = resolveTokens(state)
      diag.scheme = resolvedScheme()
      /* 总闸：先把"关掉了没"反映到 html 属性上，Host 半体注入的首屏底色才知道要不要让位。 */
      syncDisabledMarker()

      if (!shouldApply()) {
        teardown()
      } else if (themeService !== null && typeof themeService.overrideTokens === 'function') {
        /* 内容签名：层已装且令牌完全一致时跳过。
           `overrideTokens` 每次调用都会让宿主的 ThemePresenter 重建令牌表并把
           结果逐条写成 body 内联变量（整页重算）—— 启动期等 form 服务的 250ms
           重试会把同一份令牌推几十遍，纯属白烧。
           只在"层确实装着 + 内容没变"时跳过，所以 teardown 后仍会正常重装。 */
        const signature = JSON.stringify(tokens)
        if (channel === 'override' && releaseLayer !== null && signature === lastTokenSignature) {
          diag.applied = Object.keys(tokens).length
        } else {
          /* 首选：官方扩展点。同 source 再次调用即整层替换，不需要先 teardown。 */
          try {
            const disposer = themeService.overrideTokens('dsh-colorlab', tokens)
            if (releaseLayer !== null && channel === 'override') {
              /* 旧层已被同 source 的新层顶掉，旧 disposer 现在是 no-op；丢掉引用即可。 */
              releaseLayer = null
            }
            if (fallbackEl !== null) {
              try {
                fallbackEl.remove()
              } catch (error) {
                note('remove fallback after override', error)
              }
              fallbackEl = null
            }
            releaseLayer = disposer
            channel = 'override'
            diag.channel = 'override'
            diag.applied = Object.keys(tokens).length
            lastTokenSignature = signature
          } catch (error) {
            note('overrideTokens', error)
            diag.theme = 'override-failed'
            /* 扩展点抛错：立刻转回退通道，不留"半生效"状态。 */
            if (installFallback(tokens)) {
              /* installFallback 已设 diag.channel/applied */
            }
          }
        }
      } else if (installFallback(tokens)) {
        /* 回退：样式表通道。 */
      } else {
        diag.theme = 'unavailable'
      }

      /* 注入式样式表统一在这里同步（无论走了哪条通道）。
         顺序有意义：markdown 细节表要挂在 prose 之后，这样它的规则
         能盖住正文高亮对同一元素的着色（markdown 是基础层）。 */
      syncProseSheet()
      syncMarkdownSheet()
      syncRowSheet()
      syncCardSheet()
      syncLatexSheet()
      syncGlassSheet()
      /* 手绘造型在玻璃之后：它的纸影规则要看玻璃开没开（html:not([data-dsh-glass])）。 */
      syncShapeSheet()
      publish()
    }

    /** 改动设置：更新内存态 → 立即应用 → 尽力写盘。 */
    function update(patch, persist) {
      Object.assign(state, patch)
      applyNow()
      publish()
      if (persist) persistNow()
    }

    /* ====================================================================== *
     * 四·五、草稿（颜色输入的"先预览后应用"）
     *
     * 为什么必须有这一层：`applyNow()` 会重建 148 个令牌并经 ThemePresenter
     * 写成 body 的内联变量 —— 那是**整页重算**；`persistNow()` 还要往 profile
     * 的 YAML 写一次盘。取色器拖动时 onChange 每帧都触发、hex 输入每补全一次
     * 合法值就触发，全走这条路就是"动一下卡很久"。
     *
     * 所以颜色类输入一律先进草稿：只更新 store（React 重渲染设置页，约 350 个
     * 节点，微秒级），预览容器用**内联 CSS 变量**局部覆盖 —— 内联变量只作用于
     * 该子树，全局令牌一个字节都不动。点「应用更改」才真的 applyNow + 写盘。
     *
     * 离散开关（启用/套用范围/背景变体/强调色/各高亮开关/分类勾选）仍然即时生效：
     * 它们一次点击就结束，不存在连续触发，且即时反馈更好用。
     * ====================================================================== */

    /** 预览用的合并态：草稿盖在已生效设置之上。 */
    function previewState() {
      return Object.keys(draft).length === 0 ? state : { ...state, ...draft }
    }

    /** 记一笔草稿（不应用、不写盘）。同字段重复写 = 覆盖上一笔。 */
    function updateDraft(patch) {
      draft = { ...draft, ...patch }
      publish()
    }

    /** 确认草稿：并入正式态 → 全局应用一次 → 写盘一次。 */
    function commitDraft() {
      const patch = draft
      if (Object.keys(patch).length === 0) return
      draft = {}
      Object.assign(state, patch)
      applyNow()
      persistNow()
    }

    /** 丢弃草稿，回到已生效的值。 */
    function cancelDraft() {
      if (Object.keys(draft).length === 0) return
      draft = {}
      publish()
    }

    /**
     * 玻璃滑块专用：即时应用 + 防抖写盘（2026-10-22，对齐参考插件的调参体验）。
     *
     * 为什么不进草稿：草稿机制是为取色器"每帧触发"设计的；range 滑块一次
     * 拖动几十个事件、每个事件 applyNow 只是重建一次玻璃表（毫秒级），
     * 但草稿让"拖完看不到效果"（设置页里没有玻璃预览区，fog 的预览
     * 就是整个界面本身）—— 用户报"调了没反应"。
     * 写盘按 400ms 防抖合并，一次拖动只落一次 YAML。
     */
    let glassPersistTimer = null
    function updateGlassNow(patch) {
      Object.assign(state, patch)
      applyNow()
      publish()
      if (glassPersistTimer !== null) {
        try { clearTimeout(glassPersistTimer) } catch { /* 无 timer */ }
      }
      glassPersistTimer = setTimeout(() => {
        glassPersistTimer = null
        persistNow()
      }, 400)
      if (glassPersistTimer && typeof glassPersistTimer.unref === 'function') glassPersistTimer.unref()
    }

    /* ====================================================================== *
     * 五、持久化：profile 的 configForms（命名空间 = profile 行 id）
     * ====================================================================== */

    /** 候选命名空间。真实 ns 是 `entry.options.id`（profile 行 id）——不带 `include:`。 */
    const ENTRY_CANDIDATES = ['mariana-theme', 'include:mariana-theme']

    let form = null
    let formUnsubscribe = null
    let bound = false
    let disposed = false
    let retryTimer = null
    let attempts = 0
    /**
     * 自己已发出、还没落地的写次数。>0 期间 adopt 整体跳过，
     * 防止宿主镜像的中间态（写之前）把新值倒回去。
     */
    let pendingWrites = 0

    /** 从 describe 镜像里读宿主真正服务的命名空间。 */
    function listServedNamespaces(forms) {
      try {
        if (typeof forms.describe !== 'function') return []
        const describe = forms.describe()
        if (!describe || typeof describe.getSnapshot !== 'function') return []
        const snapshot = describe.getSnapshot()
        const namespaces = snapshot && snapshot.view && Array.isArray(snapshot.view.namespaces) ? snapshot.view.namespaces : []
        return namespaces.map((entry) => entry && entry.ns).filter((ns) => typeof ns === 'string')
      } catch {
        return []
      }
    }

    /** 取一个真正就绪的表单（`get()` 对任何 ns 都返回 lazy view，必须看 status）。 */
    function acquireForm(ctx) {
      let forms
      try {
        forms = ctx.configForms
      } catch {
        forms = undefined
      }
      if (forms === undefined || forms === null) {
        try {
          forms = ctx.get('configForms')
        } catch {
          forms = undefined
        }
      }
      if (forms === undefined || forms === null || typeof forms.get !== 'function') return null

      const served = listServedNamespaces(forms).filter((ns) => ns === 'mariana-theme' || ns.endsWith('mariana-theme'))
      const candidates = served.length > 0 ? served : ENTRY_CANDIDATES
      for (const ns of candidates) {
        try {
          const candidate = forms.get(ns)
          if (!candidate || typeof candidate.getSnapshot !== 'function') continue
          const snapshot = candidate.getSnapshot()
          if (snapshot && snapshot.status === 'ready') return candidate
        } catch {
          /* 下一个候选 */
        }
      }
      return null
    }

    /**
     * 从表单快照里读回宿主值，覆盖内存态。
     *
     * **自己的写还没落地时必须整体跳过**。这是"改完颜色过一会儿自己弹回旧配置"
     * 的根因：`form.mutate()` 是异步的，而宿主共享镜像的任何更新（重连、别的命名空间
     * 写盘触发的 document-updated）都会回调订阅 —— 那一刻镜像里**还是写之前的值**，
     * 不挡住就会把刚提交的设置倒回去。官方 ui-theme 对同一问题用的是同一招
     * （pendingWrites 计数 + 落盘后再 adopt）。
     */
    function adopt(snapshot) {
      if (pendingWrites > 0) return
      try {
        const value = snapshot && snapshot.value
        if (!value || typeof value !== 'object') return
        let changed = false
        for (const field of Object.keys(DEFAULTS)) {
          const next = value[field]
          if (typeof next === 'string' && next !== state[field]) {
            state[field] = next
            changed = true
          }
        }
        if (changed) applyNow()
        diag.form = 'ready'
        publish()
      } catch (error) {
        note('adopt', error)
      }
    }

    /**
     * 把当前设置写回 profile。失败只标注状态，不影响主题。
     *
     * 两个曾经的坑（"保存方案后再调整会自己弹回"的根因）：
     *
     *   1. **整批写会被一颗坏字段拖死**。原来每次把全部 DEFAULTS 字段打包成一次
     *      mutate；宿主对整批做校验，任何一个字段被拒（例如 presets 超长、
     *      或某字段值被 Host 侧规则拒绝）就**整批失败** —— 于是"保存方案"看似
     *      成功（界面变了），实际一个字段都没落盘，下一次镜像回推就把旧值倒回来。
     *      现在只写**与宿主快照不同的字段**（正常情况 1~2 个），坏字段只影响自己。
     *   2. **写失败必须可见**。原来 catch 只打 console；现在状态条显示「写入被拒」，
     *      并且失败的字段留在待写集合里，下次 persist 自动重试。
     */
    function persistNow() {
      if (form === null) {
        diag.form = 'memory'
        publish()
        return
      }
      /* 只写与宿主已知快照不同的字段。宿主没给过值的字段（首次）按 DEFAULTS 比对。 */
      let hostValue = {}
      try {
        const snapshot = typeof form.getSnapshot === 'function' ? form.getSnapshot() : null
        hostValue = (snapshot && snapshot.status === 'ready' && snapshot.value) || hostValue
      } catch {
        /* 读不到就全按需要写 */
      }
      const ops = []
      for (const field of Object.keys(DEFAULTS)) {
        const current = state[field]
        const known = Object.prototype.hasOwnProperty.call(hostValue, field) ? hostValue[field] : DEFAULTS[field]
        if (current !== known) ops.push({ op: 'set', path: [field], value: current })
      }
      /* 全等：没有任何要写的，直接标 ready。 */
      if (ops.length === 0) {
        diag.form = 'ready'
        publish()
        return
      }
      pendingWrites += 1
      const settle = (ok) => {
        pendingWrites = Math.max(0, pendingWrites - 1)
        diag.form = ok ? 'ready' : 'rejected'
        /* 刻意**不**在这里立刻 adopt：mutate 的 promise 落定时宿主镜像未必已经
           更新，抢先 adopt 反而可能把旧值读回来（就是"弹回旧配置"的现象）。
           写成功后宿主会推 document-updated，那时 pendingWrites 已归零，
           订阅回调里的 adopt 自然拿到新值；宿主不再推说明值没变，state 保持即可。 */
        publish()
      }
      try {
        if (typeof form.mutate === 'function') {
          const result = form.mutate(ops)
          if (result && typeof result.then === 'function') {
            result.then(() => settle(true)).catch((error) => {
              note('form.mutate', error)
              settle(false)
            })
          } else {
            settle(true)
          }
          return
        }
        if (typeof form.set === 'function') {
          for (const op of ops) form.set(op.path[0], op.value)
          settle(true)
          return
        }
      } catch (error) {
        note('persist', error)
      }
      settle(false)
    }

    /** 有界重试：等 theme / slots / configForms 就绪。 */
    function bindWhenReady(ctx, attempt) {
      if (disposed) return
      attempts = attempt

      /* 1) theme 服务：主题生效的关键路径。 */
      if (themeService === null) {
        let candidate
        try {
          candidate = ctx.theme
        } catch {
          candidate = undefined
        }
        if (candidate === undefined || candidate === null) {
          try {
            candidate = ctx.get('theme')
          } catch {
            candidate = undefined
          }
        }
        if (candidate !== undefined && candidate !== null && typeof candidate.getTheme === 'function') {
          themeService = candidate
          diag.theme = typeof candidate.overrideTokens === 'function' ? 'override' : 'read-only'
          /* 订阅 ui-theme 自己的 ctx：这是唯一保证能收到 theme/change 的注册点
             （事件是在 ui-theme 的 ctx 上 emit 的）。订阅与退订都包在 ctx.effect 里，
             插件卸载时自动解绑，不会漏。 */
          const emitter = candidate.ctx !== undefined && candidate.ctx !== null && typeof candidate.ctx.on === 'function'
            ? candidate.ctx
            : ctx
          try {
            ctx.effect(() => {
              const off = emitter.on('theme/change', () => {
                applyNow()
              })
              return () => {
                if (typeof off === 'function') off()
              }
            }, 'mariana-theme: theme/change listener')
          } catch (error) {
            note('subscribe theme/change', error)
          }
        }
      }

      /* 2) configForms：持久化通道。 */
      if (form === null) {
        const candidate = acquireForm(ctx)
        if (candidate !== null) {
          form = candidate
          diag.form = 'ready'
          try {
            if (typeof form.subscribe === 'function') {
              formUnsubscribe = form.subscribe(() => {
                try {
                  adopt(form.getSnapshot())
                } catch (error) {
                  note('form subscribe', error)
                }
              })
            }
          } catch (error) {
            note('form subscribe', error)
          }
          try {
            adopt(form.getSnapshot())
          } catch (error) {
            note('adopt initial', error)
          }
        }
      }

      /* 3) 立刻按当前已知信息应用一次（theme 可能已就绪）。 */
      if (themeService !== null || attempt === 0) applyNow()

      /* 4) 还没齐就再等一轮；有界（约 30 秒），绝不静默放弃。 */
      const needTheme = themeService === null
      const needForm = form === null
      if ((needTheme || needForm) && attempt < 120) {
        retryTimer = setTimeout(() => bindWhenReady(ctx, attempt + 1), 250)
        if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref()
      } else if (needTheme) {
        diag.theme = 'unavailable'
        publish()
      } else if (needForm) {
        diag.form = 'memory'
        publish()
      }
    }

    /* ====================================================================== *
     * 六、设置页
     * ====================================================================== */

    /** 一行文字 + 右侧控件的布局。 */
    function Row(props) {
      return h(
        'div',
        { className: 'dmt-row' },
        h(
          'div',
          { className: 'dmt-rowText' },
          h('div', { className: 'dmt-rowTitle' }, props.title),
          props.hint ? h('div', { className: 'dmt-rowHint' }, props.hint) : null,
        ),
        props.children,
      )
    }

    /** 开关。 */
    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'dmt-switch',
        role: 'switch',
        'aria-pressed': props.on ? 'true' : 'false',
        'aria-label': props.label,
        onClick: props.onToggle,
      })
    }

    /**
     * 滑块 + 数值显示。
     *
     * 用原生 `<input type="range">`：键盘可达、读屏可读、不需要额外 JS。
     * 拖动时只写草稿（和其它控件一致），点「应用更改」才落到全局。
     */
    function Slider(props) {
      const disabled = props.disabled === true
      return h(
        'span',
        { className: 'dmt-sliderRow' },
        h('input', {
          type: 'range',
          className: 'dmt-slider',
          min: String(props.min),
          max: String(props.max),
          step: String(props.step === undefined ? 1 : props.step),
          value: String(props.value),
          disabled,
          'aria-label': props.label,
          onChange: (event) => props.onChange(Number(event.target.value)),
        }),
        h('span', { className: 'dmt-sliderValue' }, props.value + (props.suffix === undefined ? '' : props.suffix)),
      )
    }

    /** 分段选择。 */
    function Segmented(props) {
      return h(
        'div',
        { className: 'dmt-seg', role: 'group', 'aria-label': props.label },
        props.options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dmt-segBtn',
              'aria-pressed': props.value === option.value ? 'true' : 'false',
              title: option.hint,
              onClick: () => props.onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    /** 色块选择。 */
    function Swatches(props) {
      return h(
        'div',
        { className: 'dmt-swatches', role: 'group', 'aria-label': props.label },
        props.options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'dmt-swatch',
              'aria-pressed': props.value === option.value ? 'true' : 'false',
              title: option.label + ' · ' + option.swatch,
              style: { background: option.swatch },
              onClick: () => props.onChange(option.value),
            },
            h('span', { className: 'dmt-swatchLabel' }, option.label),
          ),
        ),
      )
    }

    /** 状态芯片。 */
    /** 🔧 页头诊断行（2026-10-22 页面整理）：旧的 Chip 芯片行退役 ——
     * 一切正常时诊断行整体隐身，异常时才以 dmt-diagLine 出现。 */

    /**
     * 折叠块（原生 <details>，零 JS）—— 设置页整理（2026-10-22）：
     * 低频内容（正文预览+9槽、18 自定义槽、玻璃高级档）收起来，
     * 标题行给一句状态摘要，不展开也知道里面是什么状态。
     */
    function Fold(props) {
      return h(
        'details',
        { className: 'dmt-fold' },
        h('summary', { className: 'dmt-foldSummary' },
          props.label,
          props.summary ? h('span', { className: 'dmt-foldMeta' }, props.summary) : null),
        props.children,
      )
    }

    /** 🔧 整理后的页头诊断行：玻璃链路状态不再占整行，渲染期记到这里。 */
    let glassStatusLine = ''

    /**
     * 分组标题（2026-10-22 页面整理）：全站统一这一种 —— 旧版一半用
     * dmt-head 大标题、一半用 dmt-customGroup 小签，视觉是两套语言。
     */
    function GroupHead(props) {
      return h(
        'div',
        { className: 'dmt-groupHead' },
        h('div', { className: 'dmt-groupTitle' }, props.title),
        props.sub ? h('div', { className: 'dmt-groupSub' }, props.sub) : null,
      )
    }

    /** 色板预览里的一个色卡。 */
    function PaletteCard(props) {
      return h(
        'div',
        { className: 'dmt-card' },
        h('span', { className: 'dmt-chipSwatch', style: { background: props.hex } }),
        h(
          'span',
          { className: 'dmt-cardText' },
          h('span', { className: 'dmt-cardName' }, props.name),
          h('span', { className: 'dmt-cardHex' }, props.hex),
        ),
      )
    }

    const PREVIEW_CODE = [
      '// Mariana · Sublime Text',
      'const palette = {',
      '  background: "#343D46",',
      '  foreground: "#D8DEE9",',
      '  accent: "#F9AE58",',
      '}',
      '',
      'function highlight(token) {',
      '  return token === "string" ? 42 : null',
      '}',
    ].join('\n')

    /* ---------- 自定义配色：单个槽位 ---------- */

    /**
     * 一个颜色槽位：色块（原生 color input）+ 可编辑的 hex + 重置按钮。
     *
     * 用原生 `<input type="color">` 而不是自绘取色器：它自带系统取色面板
     * （吸管、色轮、预设），跨平台可用，且不引入任何依赖。
     * hex 文本框允许手输/粘贴，方便从别处抄色值。
     */
    function ColorSlot(props) {
      const { label, path, value, isCustom, onPick, onReset } = props
      /* 显示当前生效值；被覆盖时加个标记。 */
      const display = value || '#000000'
      const [draft, setDraft] = React.useState(String(display).toUpperCase())
      const [syncedFrom, setSyncedFrom] = React.useState(display)
      if (syncedFrom !== display) {
        setSyncedFrom(display)
        setDraft(String(display).toUpperCase())
      }
      return h(
        'div',
        { className: 'dmt-slot', 'data-slot': path },
        h(
          'label',
          { className: 'dmt-slotSwatch', style: { background: display }, title: '点击选择颜色' },
          h('input', {
            type: 'color',
            value: HEX_PATTERN.test(display) ? (display.length === 4 ? '#' + display[1] + display[1] + display[2] + display[2] + display[3] + display[3] : display) : '#000000',
            'aria-label': label + ' 颜色',
            onChange: (event) => onPick(event.target.value),
          }),
        ),
        h(
          'span',
          { className: 'dmt-slotText' },
          h('span', { className: 'dmt-slotLabel' }, label + (isCustom ? ' ·' : '')),
          h('input', {
            className: 'dmt-slotHex',
            value: draft,
            spellCheck: false,
            'aria-label': label + ' 十六进制值',
            onChange: (event) => {
              const next = event.target.value
              setDraft(next)
              /* 只在完整合法时提交，避免打到一半就把界面刷成黑色。 */
              if (HEX_PATTERN.test(next.trim())) onPick(next.trim().toUpperCase())
            },
            onBlur: () => setDraft(String(display).toUpperCase()),
          }),
        ),
        isCustom
          ? h(
              'button',
              {
                type: 'button',
                className: 'dmt-slotReset',
                title: '恢复此槽位为默认值',
                'aria-label': '重置 ' + label,
                onClick: onReset,
              },
              '↺',
            )
          : null,
      )
    }

    /* ---------- 配色方案：一行 ---------- */

    /** 一条已保存的配色方案。 */
    function PresetRow(props) {
      const { preset, active, onApply, onDelete } = props
      const colors = presetPreviewColors(preset)
      return h(
        'div',
        { className: 'dmt-preset', 'data-preset': preset.name },
        h(
          'span',
          { className: 'dmt-presetDots' },
          colors.map((hex, index) => h('span', { key: index, className: 'dmt-presetDot', style: { background: hex } })),
        ),
        h('span', { className: 'dmt-presetName', title: preset.name }, preset.name),
        h('span', { className: 'dmt-presetMeta' }, preset.at > 0 ? formatWhen(preset.at) : ''),
        h(
          'span',
          { className: 'dmt-presetActions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dmt-miniBtn',
              'data-variant': active ? 'primary' : undefined,
              disabled: active,
              title: active ? '当前正在使用' : '载入这套配色',
              onClick: () => onApply(preset),
            },
            active ? '使用中' : '载入',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dmt-miniBtn',
              'data-danger': 'true',
              title: '删除这套配色',
              onClick: () => onDelete(preset),
            },
            '删除',
          ),
        ),
      )
    }

    /**
     * 一条方案在列表里显示的小色点（背景 / 正文 / 强调 / 关键字 / 字符串）。
     * 只做近似展示：自定义槽位会覆盖，但不去完整重算所有令牌。
     */
    function presetPreviewColors(preset) {
      const surface = SURFACES[preset.surface] || SURFACES.standard
      const custom = preset.custom && typeof preset.custom === 'object' ? preset.custom : {}
      const pick = (path, fallback) => (typeof custom[path] === 'string' && HEX_PATTERN.test(custom[path]) ? custom[path] : fallback)
      return [
        pick('surface.base', surface.base),
        pick('palette.fg', PALETTE_BASE.fg),
        (ACCENTS[preset.accent] || ACCENTS.teal).dark,
        pick('palette.purple', PALETTE_BASE.purple),
        pick('palette.green', PALETTE_BASE.green),
      ]
    }

    /** 时间戳 → "刚刚 / N 分钟前 / MM-DD HH:mm"。 */
    function formatWhen(at) {
      if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return ''
      const delta = Date.now() - at
      if (delta < 60_000) return '刚刚'
      if (delta < 3_600_000) return Math.floor(delta / 60_000) + ' 分钟前'
      if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + ' 小时前'
      const date = new Date(at)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** 设置页主体。 */
    function MarianaSettingsPage() {
      /* 设置页样式表在这里按需安装（启动路径不碰它）。幂等，重复渲染只插一次。 */
      ensurePageStyles()
      const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const status = snapshot.status || initialStatus()
      const isDark = status.scheme === 'dark'
      const hiddenByScheme = snapshot.enabled !== 'off' && snapshot.schemeMode === 'dark' && status.scheme === 'light'

      const setField = (field) => (value) => update({ [field]: value }, true)
      const toggle = (field) => () => update({ [field]: state[field] === 'off' ? 'on' : 'off' }, true)

      /* 🔧 页头诊断行（整理后）：玻璃链路只在**真出事**时算 bad ——
       * 开了关不掉表（error）、或开着却根本没建层（off 态但开关在 on）。
       * 一切正常时留空，诊断行整体隐身。 */
      glassStatusLine = status.glass === 'error'
        ? 'bad'
        : !hiddenByScheme && snapshot.glass === 'on' && snapshot.enabled !== 'off' && status.glass === 'off'
          ? 'bad'
          : ''

      const paletteRows = [
        ['背景 bg0', PALETTE.bg0],
        ['侧栏 bg1', PALETTE.bg1],
        ['面板 bg2', PALETTE.bg2],
        ['正文', PALETTE.fg],
        ['次级', PALETTE.dim],
        ['三级', PALETTE.faint],
        ['字符串', PALETTE.green],
        ['函数', PALETTE.teal],
        ['调用', PALETTE.blue],
        ['关键字', PALETTE.purple],
        ['常量', PALETTE.red],
        ['数字', PALETTE.orange],
        ['高亮', PALETTE.yellow],
        ['选区', SURFACES[snapshot.surface] ? SURFACES[snapshot.surface].bubble : PALETTE.bg0],
      ]

      /* ---- 自定义配色：当前覆盖表与生效值 ---- */
      const custom = parseCustom(snapshot.custom)
      const effectivePalette = withOverrides(PALETTE_BASE, custom.palette)
      const effectiveSurface = withOverrides(SURFACES[snapshot.surface] || SURFACES.standard, custom.surface)
      const customCount = Object.keys(custom.palette).length + Object.keys(custom.surface).length

      /** 取某个槽位当前生效的 hex 值。 */
      const slotValue = (path) => {
        const [group, key] = path.split('.')
        if (group === 'palette') return effectivePalette[key]
        return effectiveSurface[key]
      }
      /** 取某个槽位的默认（未自定义）值。 */
      const slotDefault = (path) => {
        const [group, key] = path.split('.')
        if (group === 'palette') return PALETTE_BASE[key]
        return (SURFACES[snapshot.surface] || SURFACES.standard)[key]
      }

      /** 改一个槽位：写进 custom JSON。**只进草稿**，应用前不动全局令牌。 */
      const setSlot = (path, hex) => {
        const next = { ...custom.palette, ...custom.surface }
        /* 与默认值相同就删掉这个覆盖，保持 custom 精简。 */
        if (String(hex).toUpperCase() === String(slotDefault(path)).toUpperCase()) delete next[path]
        else next[path] = hex
        /* 重新按组拆开（parseCustom 会做合法性过滤）。 */
        const grouped = { palette: {}, surface: {} }
        for (const [key, value] of Object.entries(next)) {
          const [group, field] = key.split('.')
          if (group === 'palette' || group === 'surface') grouped[group][field] = value
        }
        updateDraft({ custom: serializeCustom(grouped) })
      }

      /** 重置一个槽位。 */
      const resetSlot = (path) => setSlot(path, slotDefault(path))

      /* ---- 正文高亮颜色：手挑色 + 派生默认 ----
         snapshot 已经是"已生效 + 草稿"的合并态（publish 里合并），
         所以这里全部基于 snapshot 计算，编辑时看到的即草稿。 */
      const prosePicked = parseProseColors(snapshot.proseColors)
      /** 不含手挑色时的派生值（跟随色板 / 强调色 / 亮度档）。 */
      const proseDerived = resolveProseTokens({ ...snapshot, proseColors: '' })
      const proseEffective = resolveProseTokens(snapshot)
      const proseCustomCount = Object.keys(prosePicked).length
      /** 改一个正文颜色槽：与派生默认相同则删覆盖；只进草稿，不动全局。 */
      const setProseColor = (key, token, hex) => {
        const next = { ...prosePicked }
        if (String(hex).toUpperCase() === String(proseDerived[token].dark).toUpperCase()) delete next[key]
        else next[key] = hex
        updateDraft({ proseColors: Object.keys(next).length === 0 ? '' : JSON.stringify(next) })
      }
      const resetProseColor = (key, token) => setProseColor(key, token, proseDerived[token].dark)

      /* 预览容器的**局部**变量：草稿色只盖在预览子树上，全局令牌一个字节不动。
         注入的样式表都写成 var(--dmt-*, 兜底)，所以容器内联变量天然优先。 */
      const previewVars = { '--dmt-row-color': snapshot.rowColor, '--dmt-summary-color': snapshot.summaryColor }
      /* 卡片底色：挑了色才覆盖预览的 --changes-fill / --deliverable-fill；
         空串保持宿主默认观感。两种卡片共用同一个颜色。 */
      if (HEX_PATTERN.test(snapshot.cardColor)) {
        previewVars['--changes-fill'] = snapshot.cardColor
        previewVars['--deliverable-fill'] = snapshot.cardColor
      }
      for (const slot of PROSE_COLOR_SLOTS) previewVars[slot.token] = proseEffective[slot.token].dark

      /* 草稿条：snapshot.draftFields 由 publish 合并进快照。 */
      const draftFields = Array.isArray(snapshot.draftFields) ? snapshot.draftFields : []
      const DRAFT_FIELD_LABELS = { custom: '自定义配色', proseColors: '正文颜色', rowColor: '工具行颜色', summaryColor: '汇总行颜色', cardColor: '卡片头部' }
      const draftFieldLabel = (field) => DRAFT_FIELD_LABELS[field] || field

      /* ---- 过程行高亮：当前选中的分类 ---- */
      const rowVariantList = parseRowVariants(snapshot.rowVariants)
      /** 勾选/取消一个分类，写回 JSON 数组。 */
      const toggleVariant = (variant) => {
        const next = rowVariantList.includes(variant)
          ? rowVariantList.filter((entry) => entry !== variant)
          : [...rowVariantList, variant]
        update({ rowVariants: JSON.stringify(next) }, true)
      }
      /** 预览行里的摘要文案（按分类给个像样的例子）。 */
      const summaryFor = (variant) => {
        if (variant === 'write') return 'C:\\path\\to\\file.js 2KB  +48 -0'
        if (variant === 'edit') return 'C:\\path\\to\\file.js  1KB  +8 -0'
        if (variant === 'bash') return 'Run the test suite  ● 退出码 1'
        if (variant === 'read') return 'config.yaml 12KB'
        if (variant === 'search') return 'mariana 12 个结果'
        if (variant === 'code') return 'python -c "print(1)"'
        if (variant === 'think') return 'The class name has a hash prefix…'
        return '执行了命令，已写入文件'
      }

      /* ---- 配色方案 ---- */
      const presets = parsePresets(snapshot.presets)
      const [presetName, setPresetName] = React.useState('')
      /** 当前配色是否与某个已保存方案一致（用于显示"使用中"）。 */
      const currentSignature = JSON.stringify({ s: snapshot.surface, a: snapshot.accent, c: custom })
      const activePresetName = (() => {
        for (const preset of presets) {
          const sig = JSON.stringify({ s: preset.surface, a: preset.accent, c: normalizeCustom(preset.custom) })
          if (sig === currentSignature) return preset.name
        }
        return null
      })()

      /** 保存当前配色为一套方案（同名覆盖）。 */
      const savePreset = (name) => {
        const trimmed = String(name || '').trim().slice(0, MAX_PRESET_NAME)
        if (trimmed === '') return
        const entry = {
          name: trimmed,
          at: Date.now(),
          surface: snapshot.surface,
          accent: snapshot.accent,
          custom: { ...custom.palette, ...custom.surface },
        }
        const rest = presets.filter((preset) => preset.name !== trimmed)
        const next = [entry, ...rest].slice(0, MAX_PRESETS)
        update({ presets: JSON.stringify(next) }, true)
        setPresetName('')
      }

      /** 载入一套方案。 */
      const applyPreset = (preset) => {
        const grouped = normalizeCustom(preset.custom)
        update(
          {
            surface: preset.surface,
            accent: preset.accent,
            custom: serializeCustom(grouped),
          },
          true,
        )
      }

      /** 删除一套方案。 */
      const deletePreset = (preset) => {
        const next = presets.filter((entry) => entry.name !== preset.name)
        update({ presets: JSON.stringify(next) }, true)
      }

      /* 正文对比度提示：自定义把正文/背景调糊了要立刻说。 */
      const bodyContrast = contrastRatio(effectivePalette.fg, effectiveSurface.base)
      const contrastWarning =
        bodyContrast > 0 && bodyContrast < 4.5
          ? `正文与背景对比度只有 ${bodyContrast.toFixed(2)}:1（建议 ≥ 7:1），可能看不清`
          : ''

      return h(
        'div',
        { className: 'dmt-root' },
        h(
          'div',
          { className: 'dmt-head' },
          h('div', { className: 'dmt-title' }, 'ColorLab 配色方案'),
          h(
            'div',
            { className: 'dmt-sub' },
            '内置 Sublime Text 的 Mariana 配色作为默认预设，并提供可调整的配色引擎：设计令牌（底色、文字、边框、状态色）、代码块语法高亮、正文高亮与终端底色。',
          ),
        ),

        /* 状态行（2026-10-22 整理）：一切正常时**完全隐身**——这五行芯片是
         * "设置页消失"排查期的产物，健康时纯噪音。任何一环异常才出现，
         * 且直接说人话（哪个坏了、什么后果）。
         * ⚠️ 启动瞬态（pending/none/unknown）不算异常 —— 第一帧就闪一条
         * 黄字反而像坏了。只有"落定后的坏"才显示。 */
        (status.channel === 'style' || status.channel === 'none'
          || status.form === 'memory' || status.form === 'absent'
          || (status.theme !== 'pending' && status.applied === 0)
          || status.prose === 'error'
          || glassStatusLine === 'bad')
          ? h(
            'div',
            { className: 'dmt-diagLine' },
            h('span', {
              className: 'dmt-diagText',
              'data-warn': '1',
            },
            (status.channel === 'style' || status.channel === 'none')
              ? '主题通道异常（' + channelLabel(status.channel) + '）；' : '',
            (status.theme !== 'pending' && status.applied === 0) ? '未覆盖任何令牌；' : '',
            status.prose === 'error' ? '正文样式表挂载异常；' : '',
            (status.form === 'memory' || status.form === 'absent')
              ? '改动只在本次会话生效（读不到 profile 配置）；' : '',
            glassStatusLine === 'bad' ? '背景层未建立，玻璃不会生效；' : '',
          ),
        )
          : null,

        /* 浅色外观 + 仅深色模式的提示。 */
        hiddenByScheme
          ? h(
              'div',
              { className: 'dmt-notice' },
              h(
                'span',
                { className: 'dmt-noticeText' },
                '当前外观是浅色，而「仅深色外观」模式下 Mariana 不会套用。切到深色，或把模式改成「深浅都套用」。',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dmt-btn',
                  'data-variant': 'primary',
                  onClick: () => {
                    try {
                      if (themeService !== null) themeService.setTheme('dark')
                    } catch (error) {
                      note('setTheme', error)
                    }
                  },
                },
                '切换到深色',
              ),
            )
          : null,

        /* 启用 */
        h(GroupHead, { title: '主题', sub: 'Mariana 底色与强调色；改动即时生效' }),
        h(
          Row,
          { title: '启用 ColorLab', hint: '关闭后立即回退为宿主默认配色，设置保持不变' },
          h(Switch, { on: snapshot.enabled !== 'off', label: '启用 ColorLab', onToggle: toggle('enabled') }),
        ),

        /* 外观模式 */
        h(
          Row,
          { title: '套用范围', hint: 'Mariana 是深色主题；浅色外观下可只做同色相提亮' },
          h(Segmented, {
            label: '套用范围',
            value: snapshot.schemeMode,
            options: OPTIONS.schemeMode,
            onChange: setField('schemeMode'),
          }),
        ),

        /* 背景变体 */
        h(
          Row,
          { title: '背景变体', hint: '标准 = Sublime 原值；深 = ST3 早期 tmTheme 的一档' },
          h(Swatches, {
            label: '背景变体',
            value: snapshot.surface,
            options: OPTIONS.surface,
            onChange: setField('surface'),
          }),
        ),

        /* 强调色 */
        h(
          Row,
          { title: '强调色', hint: '只影响业务态高亮与品牌点缀，不动正文与按钮反色' },
          h(Swatches, {
            label: '强调色',
            value: snapshot.accent,
            options: OPTIONS.accent,
            onChange: setField('accent'),
          }),
        ),

        /* 代码高亮 */
        h(GroupHead, { title: '代码与正文', sub: '语法色板、Markdown 正文层次与调色' }),
        h(
          Row,
          { title: '代码高亮色板', hint: '覆盖 Shiki 的 --shiki-* 变量：关键字紫、字符串绿、数字橙' },
          h(Switch, { on: snapshot.syntax !== 'off', label: '代码高亮色板', onToggle: toggle('syntax') }),
        ),

        /* 正文高亮 */
        h(
          Row,
          {
            title: '正文高亮',
            hint: '给对话正文加颜色层次：标题青、加粗橙、行内代码绿、列表标记与引用竖线强调色。关掉则正文全部同色',
          },
          h(Switch, { on: snapshot.prose !== 'off', label: '正文高亮', onToggle: toggle('prose') }),
        ),

        /* 正文高亮亮度：三档。关掉正文高亮时这行没意义，但仍然可改（下次打开生效）。 */
        h(
          Row,
          {
            title: '正文高亮亮度',
            hint: '在 Mariana 原色基础上朝白提亮，只作用于深色外观；浅色外观是深字浅底，提亮反而看不清，所以不动',
          },
          h(Segmented, {
            label: '正文高亮亮度',
            value: snapshot.proseBoost,
            options: OPTIONS.proseBoost,
            onChange: setField('proseBoost'),
          }),
        ),

        /* 整理：预览 + 正文颜色 9 槽是"调一次就不动"的内容，收进折叠块；
           摘要直接报状态，不展开也知道里面是什么。 */
        h(
          Fold,
          {
            label: '正文调色（预览 + 9 槽位）',
            summary: proseCustomCount === 0
              ? '全部跟随派生'
              : '已手挑 ' + String(proseCustomCount) + ' 个',
          },

          /* 正文高亮预览：直接展示开关效果。草稿色只走容器内联变量（局部覆盖），
             不碰全局令牌 —— 应用前这里先变，全局等「应用更改」。 */
          h(
            'div',
            { className: 'dmt-prosePreview', 'data-prose': snapshot.prose === 'off' ? 'off' : 'on', style: previewVars },
            h('div', { className: 'dmt-proseLabel' }, snapshot.prose === 'off' ? '正文高亮：关' : '正文高亮：开'),
            h(
              'div',
              { className: 'dmt-proseBody' },
              h('h4', null, '这是一个四级标题'),
              h(
                'p',
                null,
                '正文里有',
                h('strong', null, '加粗文字'),
                '、',
                h('em', null, '斜体文字'),
                '、行内代码 ',
                h('code', null, 'const answer = 42'),
                '，还有',
                h('a', { href: '#', onClick: (event) => event.preventDefault() }, '一个链接'),
                '。',
              ),
              h(
                'ul',
                null,
                h('li', null, '列表项一'),
                h('li', null, '列表项二'),
              ),
              h('blockquote', null, h('p', null, '这是引用块，左侧竖线用强调色。')),
            ),
          ),

          /* 正文颜色：9 个槽位。取色器/输入框只写草稿（预览即时、全局不动），
             页脚的「应用更改」才重建令牌并写盘。 */
          h(
            'div',
            { className: 'dmt-custom' },
            h(
              'div',
              { className: 'dmt-customGrid' },
              PROSE_COLOR_SLOTS.map((slot) => {
                const effective = proseEffective[slot.token].dark
                const isCustom = Object.prototype.hasOwnProperty.call(prosePicked, slot.key)
                return h(ColorSlot, {
                  key: slot.key,
                  label: slot.label,
                  path: 'prose.' + slot.key,
                  value: effective,
                  isCustom,
                  onPick: (hex) => setProseColor(slot.key, slot.token, hex),
                  onReset: () => resetProseColor(slot.key, slot.token),
                })
              }),
            ),
          ),
        ),

        /* ---- 过程行高亮 ---- */
        h(GroupHead, {
          title: '过程行',
          sub: '给「写入 / 编辑 / 运行命令」等过程条目的图标和标签上色，摘要与展开内容不变',
        }),
        h(
          Row,
          { title: '启用过程行高亮', hint: '关掉后过程条目全部回到宿主原色' },
          h(Switch, {
            on: snapshot.rowHighlight !== 'off',
            label: '启用过程行高亮',
            onToggle: toggle('rowHighlight'),
          }),
        ),
        h(
          Row,
          { title: '工具行颜色', hint: '单条工具调用（写入 / 编辑 / 运行命令…）的图标与标签。改动先进预览，点「应用更改」才生效' },
          h('input', {
            className: 'dmt-colorInput',
            type: 'color',
            value: HEX_PATTERN.test(snapshot.rowColor) ? snapshot.rowColor : DEFAULTS.rowColor,
            'aria-label': '工具行颜色',
            onChange: (event) => updateDraft({ rowColor: event.target.value }),
          }),
        ),
        h(
          Row,
          { title: '汇总行颜色', hint: '聚合标题（执行了命令 / 修改了文件 / 已完成，用时…）整行与图标' },
          h('input', {
            className: 'dmt-colorInput',
            type: 'color',
            value: HEX_PATTERN.test(snapshot.summaryColor) ? snapshot.summaryColor : DEFAULTS.summaryColor,
            'aria-label': '汇总行颜色',
            onChange: (event) => updateDraft({ summaryColor: event.target.value }),
          }),
        ),
        /* 文件卡片底色（「已编辑 N 个文件」和「交付文件」两种卡）。空 = 跟随宿主中性灰。 */
        h(
          Row,
          {
            title: '文件卡片颜色',
            /* 卡片底色（「已编辑 N 个文件」的头部横带 + 「交付文件」「计划」「排程」三种卡片的整张底色）。
           空 = 跟随宿主中性灰。 */
        hint: '「已编辑 N 个文件」卡片的头部横带，以及「交付文件」「计划」「排程」卡片的整张底色；默认跟随宿主中性灰，挑色后覆盖（悬停色自动提亮一档）',
          },
          h(
            'span',
            { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', flex: 'none' } },
            h('input', {
              className: 'dmt-colorInput',
              type: 'color',
              value: HEX_PATTERN.test(snapshot.cardColor) ? snapshot.cardColor : (SURFACES[snapshot.surface] || SURFACES.standard).layer2,
              'aria-label': '文件卡片颜色',
              onChange: (event) => updateDraft({ cardColor: event.target.value }),
            }),
            HEX_PATTERN.test(snapshot.cardColor)
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dmt-slotReset',
                    title: '恢复跟随默认',
                    'aria-label': '重置文件卡片颜色',
                    onClick: () => updateDraft({ cardColor: '' }),
                  },
                  '↺',
                )
              : null,
          ),
        ),
        /* 卡片预览：结构复刻宿主 ChangedFiles（头部横带走 --changes-fill）。
           容器挂 previewVars，草稿的卡片色只盖这棵子树。 */
        h(
          'div',
          { className: 'dmt-cardPreview', style: previewVars },
          h(
            'div',
            { className: 'dmt-cardDemo' },
            h(
              'div',
              { className: 'dmt-cardDemoHead' },
              h('span', { className: 'dmt-cardDemoTile' }, '</>'),
              h(
                'span',
                { className: 'dmt-cardDemoTitles' },
                h('span', { className: 'dmt-cardDemoTitle' }, '已编辑 3 个文件'),
                h(
                  'span',
                  { className: 'dmt-cardDemoStat' },
                  h('span', { className: 'dmt-cardDemoAdded' }, '+206'),
                  h('span', { className: 'dmt-cardDemoDeleted' }, '-14'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dmt-cardDemoRow' },
              h('span', { className: 'dmt-cardDemoPath' }, '~/.dsh/plugins/dsh-colorlab/client.js'),
              h('span', { className: 'dmt-cardDemoCounts' }, h('span', { className: 'dmt-cardDemoAdded' }, '+61 '), h('span', { className: 'dmt-cardDemoDeleted' }, '-12')),
            ),
          ),
          /* 交付文件卡片：宿主 Deliverables 组件，没有横带，整张卡片底色就是 --deliverable-fill。 */
          h('div', { className: 'dmt-cardDemoLabel' }, '交付文件'),
          h(
            'div',
            { className: 'dmt-deliverDemo' },
            h('span', { className: 'dmt-deliverDemoIcon' }, '📄'),
            h(
              'span',
              { className: 'dmt-deliverDemoBody' },
              h('span', { className: 'dmt-deliverDemoName' }, 'report.md'),
              h('span', { className: 'dmt-deliverDemoDesc' }, 'Markdown · 12 KB'),
            ),
          ),
        ),
        /* 分类按 kind 分组：汇总类用黄，工具行用绿 —— 色块直接显示各自的颜色。 */
        ['汇总行', '工具行'].map((groupLabel) => {
          const wantKind = groupLabel === '汇总行' ? ['summary', 'turn'] : ['tool']
          const entries = ROW_VARIANTS.filter((entry) => wantKind.includes(entry.kind))
          if (entries.length === 0) return null
          return h(
            'div',
            { className: 'dmt-checkGroup', key: groupLabel },
            h('div', { className: 'dmt-checkGroupTitle' }, groupLabel),
            h(
              'div',
              { className: 'dmt-checkGrid' },
              entries.map((entry) => {
                const on = rowVariantList.includes(entry.variant)
                const swatchColor = entry.kind === 'tool' ? snapshot.rowColor : snapshot.summaryColor
                return h(
                  'label',
                  {
                    key: entry.variant,
                    className: 'dmt-check',
                    'data-shared': entry.shared ? 'true' : undefined,
                    title: entry.shared ? entry.sharedHint : undefined,
                  },
                  h('input', {
                    type: 'checkbox',
                    checked: on,
                    onChange: () => toggleVariant(entry.variant),
                  }),
                  h('span', {
                    className: 'dmt-checkSwatch',
                    style: {
                      background: on ? swatchColor : 'transparent',
                      borderColor: on ? swatchColor : 'var(--dsw-alias-border-l4)',
                    },
                  }),
                  h('span', null, entry.label),
                  entry.shared ? h('span', { className: 'dmt-checkTag' }, '共用') : null,
                )
              }),
            ),
          )
        }),
        /* 预览：两类分别复刻宿主的真实结构，所以**同一张样式表**会命中它们。
           - 汇总类：`button[data-process-activity]` / `button[data-turn-process]`，
             整行设色、图标 color:inherit。
           - 工具行：`[data-variant]` + `data-disclosure-header` + `_leading`/`_title`
             类名；摘要不带这两个类，所以不变色。 */
        h(
          'div',
          { className: 'dmt-rowPreview', style: previewVars },
          rowVariantList.length === 0 && snapshot.rowHighlight !== 'off'
            ? h('div', { className: 'dmt-empty' }, '没勾选任何条目 —— 现在不会给任何过程行上色。')
            : null,
          ROW_VARIANTS.filter((entry) => rowVariantList.includes(entry.variant)).map((entry) => {
            if (entry.kind === 'summary') {
              return h(
                'button',
                {
                  key: entry.variant,
                  type: 'button',
                  className: 'dmt-rowButton',
                  'data-process-activity': 'commands',
                },
                h('span', { className: 'dmt-rowIcon' }, '›'),
                h('span', null, entry.previewLabel || entry.label),
              )
            }
            if (entry.kind === 'turn') {
              return h(
                'button',
                {
                  key: entry.variant,
                  type: 'button',
                  className: 'dmt-rowButton',
                  'data-turn-process': 'turn-1',
                  'data-turn-process-messages': 3,
                },
                h('span', { className: 'dmt-rowLabel' }, entry.previewLabel || '已完成，用时 1 分 20 秒'),
              )
            }
            return h(
              'div',
              { key: entry.variant, 'data-variant': entry.variant, className: 'dmt-rowItem' },
              h('div', { 'data-disclosure-header': true, className: 'dmt-rowHeader' },
                h('div', { className: 'dmt-row' },
                  h('span', { className: 'dmt-rowIcon _leading' }, '✎'),
                  h('span', { className: 'dmt-rowTitle _title' }, entry.label),
                  h('span', { className: 'dmt-rowSep' }, '·'),
                  h('span', { className: 'dmt-rowSummary' }, summaryFor(entry.variant)),
                ),
              ),
            )
          }),
        ),
        rowVariantList.some((v) => v === 'others' || v === 'think')
          ? h(
              'div',
              { className: 'dmt-warn' },
              '⚠ ' + (rowVariantList.includes('others')
                ? '「工具调用 / 命令」这个值和命令卡共用，勾选会连带给命令卡上色。'
                : '') + (rowVariantList.includes('others') && rowVariantList.includes('think') ? ' ' : '') + (rowVariantList.includes('think')
                  ? '「思考」来自 ui-chat 的推理行，不是工具行。'
                  : ''),
            )
          : null,

        /* ---- 玻璃界面（原「透明与壁纸」，2026-10-22 页面整理）----------- *
         * 玻璃的原理：把一张背景铺进页面最底层，它就成了「画布内像素」，
         * 上面的 backdrop-filter 才有东西可糊。只靠 CSS 糊不到桌面壁纸 ——
         * 那张图在 Chromium 画布之外，永远采不到。
         * 整理决策：核心五档常显（开关/来源/浓度/浮层/模糊），其余
         *（压暗、饱和度、白雾、自选壁纸）收进「高级」；壁纸状态不再占
         * 整行，改成来源行下面的一句动态副标题。 */
        h(
          GroupHead,
          {
            title: '玻璃界面',
            sub: snapshot.glass === 'off'
              ? '关闭状态 —— 打开后可调背景与浓度'
              : status.glass === 'contour'
                ? '等高线背景 · ' + (status.contour === 'worker'
                  ? '独立线程渲染'
                  : status.contour === 'main'
                    ? '主线程渲染（worker 被拦截，已按低预算自动降档）'
                    : '准备中…')
                : status.glass === 'wallpaper'
                  ? '壁纸已加载'
                  : status.glass === 'gradient'
                    ? (snapshot.glassBackground === 'gradient' ? '渐变背景' : '壁纸读取中／失败，暂用渐变')
                    : '正在读取壁纸…',
          },
        ),

        /* 玻璃界面：总开关。关掉即恢复完全不透明，且移除背景层。 */
        h(
          Row,
          {
            title: '玻璃界面',
            hint: '让面板、浮层与输入框变成半透明玻璃，透出背后的壁纸。关闭后恢复完全不透明。',
          },
          h(Switch, { on: snapshot.glass !== 'off', label: '玻璃界面', onToggle: toggle('glass') }),
        ),

        /* 背景来源：桌面壁纸 / 渐变 / 等高线。 */
        h(
          Row,
          {
            title: '背景来源',
            hint: '「桌面壁纸」读取 Windows 当前壁纸；「渐变」用配色生成光斑；「等高线」程序生成地形线（移植自 dsh-theme-endfield）。取不到壁纸时自动用渐变。',
          },
          h(Segmented, {
            label: '背景来源',
            value: snapshot.glassBackground,
            options: OPTIONS.glassBackground,
            onChange: setField('glassBackground'),
          }),
        ),

        /* 表面浓度：三列的 alpha。只在玻璃开启时可调。
           🔧 玻璃滑块走「即时应用 + 防抖写盘」，不进草稿 —— 它们的效果
           就在整个界面上，草稿反而"拖了看不到"（用户报）。 */
        h(
          Row,
          {
            title: '表面浓度',
            hint: '三列的底色浓度。100% = 原生 Mariana；越低壁纸越明显，但主题色会被冲淡。建议 60–85。即时生效。',
          },
          h(Slider, {
            label: '表面浓度',
            min: 0,
            max: 100,
            value: parsePercent(snapshot.glassTint, 0, 100, 65),
            suffix: '%',
            disabled: snapshot.glass === 'off',
            onChange: (next) => updateGlassNow({ glassTint: String(next) }),
          }),
        ),

        /* 浮层浓度：菜单/提示/输入框等。
           🔧 语义 = 浮层合成目标在「比底板 +10%」之上再加的量（最多 +30%）。 */
        h(
          Row,
          {
            title: '浮层浓度',
            hint: '卡片、菜单、气泡、输入框比底板「实」多少。0 = 只实一档（10%），40 = 实三档（40%）。太低浮层会和底板分不开。即时生效。',
          },
          h(Slider, {
            label: '浮层浓度',
            min: 0,
            max: 40,
            value: parsePercent(snapshot.glassFog, 0, 40, 16),
            suffix: '%',
            disabled: snapshot.glass === 'off',
            onChange: (next) => updateGlassNow({ glassFog: String(next) }),
          }),
        ),

        /* 模糊半径。 */
        h(
          Row,
          {
            title: '模糊半径',
            hint: '玻璃背后的模糊半径。0 = 不模糊。即时生效。',
          },
          h(Slider, {
            label: '模糊半径',
            min: 0,
            max: 40,
            value: parsePercent(snapshot.glassBlur, 0, 40, 16),
            suffix: 'px',
            disabled: snapshot.glass === 'off',
            onChange: (next) => updateGlassNow({ glassBlur: String(next) }),
          }),
        ),

        /* 「高级」折叠（2026-10-22 页面整理）：压暗/饱和度/白雾/自选壁纸
         * 都是稳态下不常动的档 —— 收起来，摘要行显示当前取值。 */
        h(
          Fold,
          {
            label: '高级',
            summary: '压暗 ' + (snapshot.glassVeil === 'auto' ? '自动'
              : snapshot.glassVeil === '0' ? '关'
                : ({ '20': '轻', '35': '中', '50': '强' })[snapshot.glassVeil] || snapshot.glassVeil)
              + ' · 饱和 ' + parsePercent(snapshot.glassSat, 0, 200, 120) + '%'
              + ' · 白雾 ' + parsePercent(snapshot.glassHaze, 0, 100, 8) + '%',
          },

          /* 背景压暗。 */
          h(
            Row,
            {
              title: '背景压暗',
              hint: '把壁纸压暗一档，保证亮壁纸下文字不发灰。「自动」跟随表面浓度（浓度高→压得轻）；固定档不随浓度变；「关」原样透出。',
            },
            h(Segmented, {
              label: '背景压暗',
              value: snapshot.glassVeil,
              options: OPTIONS.glassVeil,
              onChange: setField('glassVeil'),
            }),
          ),

          /* 背景饱和度：和模糊一样做在底图上，全窗一次生效。 */
          h(
            Row,
            {
              title: '背景饱和度',
              hint: '透过玻璃看到的色彩浓度：0 = 完全灰阶，100 = 原样，200 = 翻倍。等高线模式不作用（线色由强调色直出）。即时生效。',
            },
            h(Slider, {
              label: '背景饱和度',
              min: 0,
              max: 200,
              value: parsePercent(snapshot.glassSat, 0, 200, 120),
              suffix: '%',
              disabled: snapshot.glass === 'off',
              onChange: (next) => updateGlassNow({ glassSat: String(next) }),
            }),
          ),

          /* 白雾浓度：磨砂的"厚度感"来自这层薄白，不是来自模糊。 */
          h(
            Row,
            {
              title: '白雾浓度',
              hint: '表面那层极淡的白，负责"厚度感"。0% 只剩模糊、缺少材质感；超过 30% 会把背后的模糊盖平。',
            },
            h(Slider, {
              label: '白雾浓度',
              min: 0,
              max: 100,
              value: parsePercent(snapshot.glassHaze, 0, 100, 8),
              suffix: '%',
              disabled: snapshot.glass === 'off',
              onChange: (next) => updateGlassNow({ glassHaze: String(next) }),
            }),
          ),

          /* 自选壁纸路径：只在「桌面壁纸」来源下出现（其余模式它是死行）。
             用文本输入而不是文件选择器 —— 浏览器沙箱拿不到真实绝对路径
             （input[type=file] 只给文件名），而 Host 侧需要绝对路径去读文件。 */
          snapshot.glassBackground !== 'contour'
            ? h(
              Row,
              {
                title: '自选壁纸',
                hint: '填本机图片的完整路径（如 D:\\pics\\bg.jpg），留空则跟随系统桌面壁纸。支持 jpg / png / webp。点「应用更改」生效。',
              },
              h('input', {
                type: 'text',
                className: 'dmt-pathInput',
                style: { flex: 'none', width: '260px' },
                placeholder: '跟随系统壁纸',
                value: snapshot.glassWallpaperPath,
                'aria-label': '自选壁纸路径',
                spellcheck: false,
                onChange: (event) => updateDraft({ glassWallpaperPath: event.target.value }),
              }),
            )
            : null,
        ),

        /* 等高线漂移速度：只在「背景来源 = 等高线」时看得见。 */
        snapshot.glassBackground === 'contour'
          ? h(
            Row,
            {
              title: '等高线速度',
              hint: '地形的漂移档位。「静止」只画一帧、零开销；越快岛呼吸越明显，读长文时可能分心。',
            },
            h(Segmented, {
              label: '等高线速度',
              value: snapshot.contourSpeed,
              options: OPTIONS.contourSpeed,
              onChange: setField('contourSpeed'),
            }),
          )
          : null,

        /* ---- 手绘造型 ------------------------------------------------------
         * 灵感来自 dsh-maid-whale-UI 的纸面主题：不规则圆角 + 纸影 +
         * 悬停微抬 + 侧栏发光分界线。纯 CSS 零资源，与玻璃界面互相独立。 */
        h(GroupHead, { title: '手绘造型', sub: '纸面风格的圆角与投影，独立于玻璃界面' }),

        h(
          Row,
          {
            title: '手绘造型',
            hint: '面板与控件的圆角四角各差一点（手绘感），卡片加纸片式双层投影，按钮悬停微抬，侧栏右缘换成渐隐发光线。与玻璃界面互相独立，默认关。',
          },
          h(Switch, { on: snapshot.shape === 'on', label: '手绘造型', onToggle: toggle('shape') }),
        ),

        /* ---- 自定义配色 ---- */
        h(GroupHead, {
          title: '自定义配色',
          sub: '逐槽覆盖 Mariana 默认值（只影响深色外观）；改回默认自动清除覆盖',
        }),
        contrastWarning !== ''
          ? h('div', { className: 'dmt-warn' }, '⚠ ' + contrastWarning)
          : null,
        h(
          Fold,
          {
            label: '完整调色板（18 槽）',
            summary: customCount === 0 ? '全部默认' : '已自定义 ' + String(customCount) + ' 个',
          },
          h(
            'div',
            { className: 'dmt-custom' },
            ['界面底色', '文字', '语法色'].map((group) => {
            const slots = CUSTOM_SLOTS.filter((slot) => slot.group === group)
            if (slots.length === 0) return null
            return h(
              'div',
              { className: 'dmt-customGroup', key: group },
              h('div', { className: 'dmt-customGroupTitle' }, group),
              h(
                'div',
                { className: 'dmt-customGrid' },
                slots.map((slot) => {
                  const [slotGroup, key] = slot.path.split('.')
                  const isCustom = slotGroup === 'palette' ? custom.palette[key] !== undefined : custom.surface[key] !== undefined
                  return h(ColorSlot, {
                    key: slot.path,
                    label: slot.label,
                    path: slot.path,
                    value: slotValue(slot.path),
                    isCustom,
                    onPick: (hex) => setSlot(slot.path, hex),
                    onReset: () => resetSlot(slot.path),
                  })
                }),
              ),
            )
          }),
        ),

        ),

        /* ---- 配色方案保存 / 载入 ---- */
        h(GroupHead, {
          title: '配色方案',
          sub: `把当前背景变体 + 强调色 + 自定义槽位存成一套方案，随时载入。最多 ${MAX_PRESETS} 套。`,
        }),
        h(
          'div',
          { className: 'dmt-presets' },
          h(
            'div',
            { className: 'dmt-saveRow' },
            h('input', {
              className: 'dmt-saveInput',
              value: presetName,
              placeholder: '给当前配色起个名字，例如「夜蓝」「低对比」',
              maxLength: MAX_PRESET_NAME,
              'aria-label': '配色方案名称',
              onChange: (event) => setPresetName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') savePreset(presetName)
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dmt-btn',
                'data-variant': 'primary',
                disabled: String(presetName).trim() === '' || presets.length >= MAX_PRESETS,
                title: presets.length >= MAX_PRESETS ? `最多 ${MAX_PRESETS} 套，先删一套` : '保存当前配色',
                onClick: () => savePreset(presetName),
              },
              '保存',
            ),
          ),
          presets.length === 0
            ? h('div', { className: 'dmt-empty' }, '还没有保存的方案。调好颜色后在上面起个名字点「保存」。')
            : h(
                'div',
                { className: 'dmt-presetList' },
                presets.map((preset) =>
                  h(PresetRow, {
                    key: preset.name,
                    preset,
                    active: preset.name === activePresetName,
                    onApply: applyPreset,
                    onDelete: deletePreset,
                  }),
                ),
              ),
        ),

        /* 色板预览 */
        h(
          'div',
          { className: 'dmt-palette' },
          paletteRows.map(([name, hex]) => h(PaletteCard, { key: name, name, hex })),
        ),

        h('pre', { className: 'dmt-preview' }, PREVIEW_CODE),

        /* ---- 草稿条：颜色类改动先进这里 ----
           有草稿时预览已变、全局未变；点「应用更改」才重建令牌并写盘一次。
           这是修"每动一下卡很久"的关键：拖动取色器不再触发整页重算。 */
        draftFields.length > 0
          ? h(
              'div',
              { className: 'dmt-draftBar' },
              h(
                'span',
                { className: 'dmt-draftText' },
                `${draftFields.length} 项颜色改动待应用（${draftFields.map(draftFieldLabel).join('、')}），现在只影响预览`,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dmt-btn',
                  'data-variant': 'primary',
                  onClick: () => commitDraft(),
                },
                '应用更改',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dmt-btn',
                  onClick: () => cancelDraft(),
                },
                '放弃',
              ),
            )
          : null,

        h(
          'div',
          { className: 'dmt-footer' },
          h(
            'button',
            {
              type: 'button',
              className: 'dmt-btn',
              onClick: () => {
                /* 恢复默认配色与开关，但**保留已保存的方案** —— 那是用户的资产，
                   不该被"恢复默认"连带删掉。先丢草稿，避免旧草稿盖住默认值。 */
                cancelDraft()
                update(
                  {
                    enabled: DEFAULTS.enabled,
                    schemeMode: DEFAULTS.schemeMode,
                    surface: DEFAULTS.surface,
                    accent: DEFAULTS.accent,
                    syntax: DEFAULTS.syntax,
                    prose: DEFAULTS.prose,
                    custom: DEFAULTS.custom,
                    proseColors: DEFAULTS.proseColors,
                    rowColor: DEFAULTS.rowColor,
                    summaryColor: DEFAULTS.summaryColor,
                  },
                  true,
                )
              },
            },
            '恢复默认配色',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dmt-btn',
              onClick: () => {
                applyNow()
                publish()
              },
            },
            '重新应用',
          ),
        ),
      )
    }

    function channelLabel(value) {
      if (value === 'override') return 'override'
      if (value === 'style') return 'style'
      return 'none'
    }

    /* 🔧 页面整理：formLabel 随芯片行退役 —— 诊断行直接写人话文案。 */

    /* ====================================================================== *
     * 七、插件入口
     * ====================================================================== */

    /**
     * 只挂一份设置页样式表；重复调用只插一次。
     *
     * ⚡ 为什么改成**延迟安装**：这张表 15 KB，只被设置页自己用。以前在
     * `apply()` 里启动时就插进 DOM，等于每次启动都白解析一遍 15 KB CSS
     * 并触发一次样式重算 —— 而用户多数时候根本不会打开设置页。
     * 现在由 `MarianaSettingsPage` 在**首次渲染时**调用，启动路径完全不碰它。
     */
    let pageStyleEl = null

    function ensurePageStyles() {
      if (typeof document === 'undefined') return
      if (pageStyleEl !== null) return
      try {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-colorlab'
        tag.dataset.pluginCss = SHEET_ID
        tag.textContent = SHEET
        document.head.appendChild(tag)
        pageStyleEl = tag
      } catch (error) {
        note('install page styles', error)
      }
    }

    /**
     * 等 slots 就绪再注册设置页。
     * 实测教训（与 dsh-font-probe 一致）：bundle 可能在 `slots` 服务安装**之前**
     * 就加载了，`ctx.get('slots')` 拿到 undefined。主题本身不需要任何服务所以一直
     * 正常，设置页却会静默地从未注册。所以这里改为有界重试，而不是指望加载顺序。
     */
    function registerSectionWhenReady(ctx, attempt) {
      if (disposed) return
      let slots
      try {
        const direct = ctx.slots
        if (direct !== undefined && direct !== null && typeof direct.inject === 'function') slots = direct
      } catch {
        /* 服务尚未安装 */
      }
      if (slots === undefined) {
        try {
          const viaGet = ctx.get('slots')
          if (viaGet !== undefined && viaGet !== null && typeof viaGet.inject === 'function') slots = viaGet
        } catch {
          /* 服务尚未安装 */
        }
      }

      if (slots === undefined) {
        if (attempt < 120) {
          const timer = setTimeout(() => registerSectionWhenReady(ctx, attempt + 1), 250)
          if (timer && typeof timer.unref === 'function') timer.unref()
        } else {
          note('slots', new Error('等待 slots 服务超时；设置页未注册（主题不受影响）'))
        }
        return
      }

      try {
        ctx.effect(
          () =>
            slots.inject('settings.section', () =>
              slots.register(
                { name: 'settings.section', id: 'mariana-theme', order: 37, label: 'ColorLab' },
                MarianaSettingsPage,
              ),
            ),
          'mariana-theme: settings section',
        )
        try {
          document.documentElement.setAttribute('data-dsh-colorlab', 'registered')
        } catch {
          /* 无 DOM */
        }
      } catch (error) {
        note('slots.inject', error)
      }
    }

    return {
      /* 空数组 + 有界重试：主题不依赖任何服务就能生效，设置页与服务晚到也不会丢。 */
      inject: [],
      apply(ctx) {
        if (disposed) return

        /* ⚠️ **设置页注册必须放在主题应用之前，且主题失败不许影响它。**
         *
         * 原来这里第一行是裸的 `applyNow()`，而 `applyNow` 只有 try/finally、
         * **没有 catch** —— 它一旦抛错，异常会穿出 `apply`，后面的
         * `registerSectionWhenReady` 就永远不执行，表现为「设置里整个 ColorLab
         * 分区消失」。主题出问题最多是没配色，绝不该让设置项一起消失。
         */
        if (!bound) {
          bound = true
          bindWhenReady(ctx, 0)
          /* 设置页样式表不在这里装 —— 由 MarianaSettingsPage 首次渲染时按需安装，
             启动路径省掉一次 15 KB 的 CSS 解析（见 ensurePageStyles）。 */
          registerSectionWhenReady(ctx, 0)
          /* 下面的 teardown effect 与 bound 同寿，只会注册一次。 */
          ctx.effect(
            () => () => {
              disposed = true
              bound = false
              if (retryTimer !== null) {
                try {
                  clearTimeout(retryTimer)
                } catch {
                  /* 无 timer */
                }
              }
              retryTimer = null
              /* 玻璃滑块的防抖写盘：卸载时若有挂起的，立刻落一次再走。 */
              if (glassPersistTimer !== null) {
                try { clearTimeout(glassPersistTimer) } catch { /* 无 timer */ }
                glassPersistTimer = null
                try { persistNow() } catch { /* 卸载中写失败无所谓 */ }
              }
              try {
                if (typeof formUnsubscribe === 'function') formUnsubscribe()
              } catch {
                /* 已解绑 */
              }
              formUnsubscribe = null
              form = null
              themeService = null
              teardown()
              /* 两张注入式样式表都必须一起摘掉，否则禁用插件后正文/过程行仍是我们的配色。 */
              if (proseEl !== null) {
                try {
                  proseEl.remove()
                } catch (error) {
                  note('teardown prose sheet', error)
                }
                proseEl = null
              }
              diag.prose = 'off'
              if (rowEl !== null) {
                try {
                  rowEl.remove()
                } catch (error) {
                  note('teardown row sheet', error)
                }
                rowEl = null
              }
              diag.row = 'off'
              if (cardRetryTimer !== null) {
                try {
                  clearTimeout(cardRetryTimer)
                } catch {
                  /* 无 timer */
                }
                cardRetryTimer = null
              }
              if (cardEl !== null) {
                try {
                  cardEl.remove()
                } catch (error) {
                  note('teardown card sheet', error)
                }
                cardEl = null
              }
              diag.card = 'off'
              if (markdownEl !== null) {
                try {
                  markdownEl.remove()
                } catch (error) {
                  note('teardown markdown sheet', error)
                }
                markdownEl = null
              }
              diag.markdown = 'off'
              /* 玻璃界面：摘总闸属性 + 移除背景层 + 卸样式表，三样都要做，
                 否则禁用插件后页面仍是半透明、背景层还留着一张壁纸。 */
              try {
                document.documentElement.removeAttribute(GLASS_ATTR)
              } catch {
                /* 无 DOM */
              }
              if (glassEl !== null) {
                try {
                  glassEl.remove()
                } catch (error) {
                  note('teardown glass sheet', error)
                }
                glassEl = null
              }
              diag.glass = 'off'
              /* 等高线：先停循环/断观察器（画布随背景层一起消失，但 rAF 不
                 停就是泄漏 —— 对着已脱离的 canvas 每帧重算 21 层等值线）。 */
              contourActive = false
              syncContourLayer(false)
              syncWallpaperLayer(false)
              /* 卸载：停掉输入栏硬裁的 observer 并把 seat 搬回 React 的树里 ——
                 留着不改回来，宿主下次渲染会对着已脱离的节点更新。 */
              syncSeatLift(false)
              if (wallpaperObjectUrl !== null) {
                try {
                  URL.revokeObjectURL(wallpaperObjectUrl)
                } catch {
                  /* 已释放 */
                }
                wallpaperObjectUrl = null
              }
              wallpaperStatus = 'idle'
              /* 手绘造型：摘表 + 摘总闸（与玻璃互相独立，各自清各自的）。 */
              if (shapeEl !== null) {
                try {
                  shapeEl.remove()
                } catch (error) {
                  note('teardown shape sheet', error)
                }
                shapeEl = null
              }
              diag.shape = 'off'
              try {
                document.documentElement.removeAttribute(SHAPE_ATTR)
              } catch {
                /* 无 DOM */
              }
              disposeLatexObserver()
              if (latexEl !== null) {
                try {
                  latexEl.remove()
                } catch (error) {
                  note('teardown latex sheet', error)
                }
                latexEl = null
              }
              diag.latex = 0
              /* 去掉打在代码块上的标记，否则下次启用时残留。 */
              try {
                const markedBlocks = document.querySelectorAll('pre.' + LATEX_BLOCK_CLASS)
                for (let i = 0; i < markedBlocks.length; i += 1) {
                  try {
                    markedBlocks[i].classList.remove(LATEX_BLOCK_CLASS)
                  } catch {
                    /* classList 不可用 */
                  }
                  disposeTexLayer(markedBlocks[i])
                }
              } catch {
                /* 无 DOM */
              }
              if (pageStyleEl !== null) {
                try {
                  pageStyleEl.remove()
                } catch (error) {
                  note('teardown page styles', error)
                }
                pageStyleEl = null
              }
              try {
                /* 卸载后客户端不再运行，所以必须在这里就把总闸关上 ——
                   否则 Host 半体烤进 HTML 的首屏底色会一直留在页面上。 */
                document.documentElement.setAttribute(DISABLED_ATTR, '')
              } catch {
                /* 无 DOM */
              }
              try {
                document.documentElement.removeAttribute('data-dsh-colorlab')
              } catch {
                /* 无 DOM */
              }
            },
            'mariana-theme: teardown',
          )
        }

        /* 主题：不依赖任何服务，立即按默认值生效一次（首屏就是 Mariana）。
           **放在设置页注册之后**，且失败只记录、不向外抛 ——
           主题出问题最多是没配色，绝不该让设置项一起消失。
           （原来这里是裸的 `applyNow()` 在最前面，而它没有 catch，
             抛错就会让后面的 registerSectionWhenReady 永远不执行。） */
        try {
          applyNow()
        } catch (error) {
          note('applyNow', error)
        }

        /* ══ ⑥（对齐参考插件的 glass() API）控制台实时调参入口 ══════
         *
         * 为什么需要：调浓度/雾面/模糊这类数值，走设置页要"拖滑块→
         * 看效果→再拖回来"，试错成本高；DevTools 里一行就能试。
         * 改动走 updateGlassNow —— 即时应用 + 防抖写盘，和设置页滑块
         * 同一条路，调满意了值自然落进 profile，不需要重启。
         *
         *   colorlab()                       看当前全部设置
         *   colorlab({ glassTint: '70' })    改一项或多项（字符串值）
         *   colorlab.glass()                 只看玻璃相关字段
         *   colorlab.reset()                 玻璃字段回默认（其它不动）
         *   colorlab.defaults()              看默认值
         */
        try {
          const api = (patch) => {
            if (patch === undefined) return { ...state }
            const clean = {}
            for (const key of Object.keys(patch)) {
              if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
                clean[key] = String(patch[key])
              }
            }
            updateGlassNow(clean)
            return { ...state }
          }
          api.glass = () => {
            const out = {}
            for (const key of Object.keys(DEFAULTS)) {
              if (key === 'glass' || key.startsWith('glass')) out[key] = state[key]
            }
            return out
          }
          api.reset = () => {
            const back = {}
            for (const key of Object.keys(DEFAULTS)) {
              if (key === 'glass' || key.startsWith('glass')) back[key] = DEFAULTS[key]
            }
            updateGlassNow(back)
            return { ...state }
          }
          api.defaults = () => ({ ...DEFAULTS })
          window.colorlab = api
        } catch {
          /* window 不可写（罕见沙箱）—— 没有控制台入口不影响任何功能 */
        }
      },
      /* 供 scripts/*.test.mjs 直接调用的纯函数与常量（不参与运行时）。 */
      __test: {
        PALETTE,
        SURFACES,
        ACCENTS,
        LIGHT,
        DEFAULTS,
        OPTIONS,
        BOOT_BACKGROUND,
        SHEET_ID,
        DISABLED_ATTR,
        MarianaSettingsPage,
        writeSheet,
        update,
        PROSE_SHEET_ID,
        ROW_SHEET_ID,
        CUSTOM_SLOTS,
        CUSTOM_PATHS,
        MAX_PRESETS,
        ROW_VARIANTS,
        ROW_VARIANT_VALUES,
        PROSE_BOOSTS,
        PROSE_COLOR_SLOTS,
        PROSE_COLOR_KEYS,
        parseProseColors,
        CARD_SHEET_ID,
        GLASS_SHEET_ID,
        GLASS_ATTR,
        SHAPE_SHEET_ID,
        SHAPE_ATTR,
        buildShapeSheet,
        WALLPAPER_LAYER_ID,
        WALLPAPER_ROUTE,
        buildGlassSheet,
        buildGradientBackdrop,
        createContourEngine,
        contourStrokeColor,
        contourStepFor,
        contourLevelsFor,
        contourBumpsFor,
        contourWorkerSource,
        CONTOUR_MIN_CROSSINGS,
        CONTOUR_MIN_INK,
        glassVeilColor,
        composeBackdrop,
        backdropGradient,
        glassSolidAlpha,
        glassFloatAlpha,
        glassFloatTarget,
        glassDeltaAlpha,
        glassComposite,
        glassSurfaceColor,
        GLASS_TIER,
        getWallpaperDiag: () => wallpaperDiag,
        hexToRgba,
        parsePercent,
        CARD_TARGETS,
        buildCardSheet,
        detectCardTargets,
        mergeCardTargets,
        cardTargetsComplete,
        MARKDOWN_SHEET_ID,
        MARKDOWN_RULES,
        buildMarkdownSheet,
        LATEX_SHEET_ID,
        LATEX_BLOCK_CLASS,
        TEX_LAYER_CLASS,
        TEX_HIDDEN_CLASS,
        shouldRenderLatex,
        blockLanguageOf,
        LATEX_LANGS,
        texSourceOf,
        buildLatexSheet,
        renderTexHtml,
        syncTexLayer,
        disposeTexLayer,
        texStyleOfScopes,
        tokenize,
        makeColorizer,
        TEX_GRAMMAR,
        TEX_COLORS,
        lightenHex,
        resolveTokens,
        resolveProseTokens,
        buildProseSheet,
        buildRowSheet,
        parseRowVariants,
        parseCustom,
        serializeCustom,
        normalizeCustom,
        parsePresets,
        contrastRatio,
      },
    }
  },
})
