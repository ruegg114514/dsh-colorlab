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
    const LATEX_BLOCK_CLASS = 'dmt-latex'

    /** LaTeX 块内要覆盖的令牌 → Mariana 对应色。 */
    const LATEX_TOKEN_OVERRIDES = Object.freeze({
      '--shiki-token-constant': '#C695C6', /* Mariana var(pink)：keyword.other.math.* 的紫 */
      '--shiki-token-punctuation': '#5FB4B4', /* Mariana var(blue5)：punctuation.definition 的青 */
    })

    /**
     * 判定一个代码块是不是 LaTeX。
     *
     * 宿主 Shiki 的输出是 `<pre class="shiki css-variables">`，**pre 上没有语言名**
     * （`codeToHtml` 只加 `class="shiki <themeName>"`，宿主也没把 lang 写进 DOM）。
     * 所以只能看内容特征。
     *
     * 判据：出现 LaTeX 特有的命令形状。用几个高区分度的模式，避免把 C/JS 里的
     * `\n`、反斜杠续行误判成 LaTeX。
     *
     * @param {Element} pre - 代码块容器。
     * @returns {boolean}
     */
    function isLatexBlock(pre) {
      if (!pre || typeof pre.textContent !== 'string') return false
      const text = pre.textContent
      if (text.length === 0) return false
      /* 高区分度：这些在别的语言里几乎不会出现 */
      if (/\\(?:begin|end)\s*\{[A-Za-z*]+\}/.test(text)) return true
      if (/\\(?:documentclass|usepackage|section|subsection|chapter|label|ref|cite)\b/.test(text)) return true
      /* 数学 + 反斜杠命令（`$...\alpha...$`）：要求 $ 与 \cmd 同时出现 */
      if (/\$[^$]*\\[A-Za-z]+[^$]*\$/.test(text)) return true
      /* 多个 `\cmd{` 形式（自定义宏，如 \bi \zh{...}） */
      const macroBraces = text.match(/\\[A-Za-z@]+\s*\{/g)
      if (macroBraces !== null && macroBraces.length >= 2) return true
      return false
    }

    /** 生成 LaTeX 块的令牌覆盖样式表。 */
    function buildLatexSheet() {
      const decls = Object.keys(LATEX_TOKEN_OVERRIDES)
        .map((name) => name + ':' + LATEX_TOKEN_OVERRIDES[name])
        .join(';')
      return 'pre.' + LATEX_BLOCK_CLASS + '{' + decls + '}'
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
.dmt-status{display:flex;flex-wrap:wrap;gap:6px 8px;font-size:12px;line-height:18px}
.dmt-chip{display:inline-flex;align-items:center;gap:5px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;padding:2px 9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.dmt-dot{width:6px;height:6px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-caption);flex:none}
.dmt-dot[data-state="ok"]{background:var(--dsw-alias-state-success-primary)}
.dmt-dot[data-state="warn"]{background:var(--dsw-alias-state-warn-primary)}
.dmt-dot[data-state="bad"]{background:var(--dsw-alias-state-error-primary)}
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
    const diag = { theme: 'pending', form: 'pending', scheme: 'unknown', applied: 0, channel: 'none', prose: 'off', row: 'off', card: 'off', markdown: 'off', latex: 0 }

    /**
     * 未确认的颜色改动；空对象 = 无草稿。
     * 声明在这里是因为 publish 会读它（见"四·五、草稿"一节的说明）。
     */
    let draft = {}

    function initialStatus() {
      return { theme: 'pending', form: 'pending', scheme: 'unknown', applied: 0, channel: 'none', prose: 'off', row: 'off', card: 'off' }
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
        if (isLatexBlock(pre)) {
          count += 1
          if (!marked) {
            try {
              pre.classList.add(LATEX_BLOCK_CLASS)
            } catch {
              /* classList 不可用 */
            }
          }
        } else if (marked) {
          try {
            pre.classList.remove(LATEX_BLOCK_CLASS)
          } catch {
            /* 同上 */
          }
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

    /** 合帧重扫：DOM 一次变动可能带进很多节点，合并成一次。 */
    function scheduleLatexRescan() {
      if (latexRescanTimer !== null) return
      if (typeof setTimeout !== 'function') return
      latexRescanTimer = setTimeout(() => {
        latexRescanTimer = null
        syncLatexSheet()
      }, 120)
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
    function syncCardSheet() {
      if (typeof document === 'undefined') return
      if (cardTargets === undefined) {
        const sheets = document.styleSheets
        const count = sheets !== undefined && sheets !== null && typeof sheets.length === 'number'
          ? sheets.length
          : -1
        if (count !== cardScanSheetCount) {
          cardScanSheetCount = count
          cardTargets = detectCardTargets()
        } else {
          /* 样式表没有增减 → 上轮的结论仍然成立，不必再扫。 */
          cardTargets = []
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
        /* 用户挑了色但类名还没检测到 = pending（下面安排重试），否则 = off。 */
        const pickedColor = HEX_PATTERN.test(state.cardColor)
        const detected = Array.isArray(cardTargets) && cardTargets.length > 0
        diag.card = !pickedColor ? 'off' : !detected ? 'pending' : 'off'
        /* 检测成功过就清零计数（下次用户再挑色时重试预算是满的）。 */
        if (detected) cardRetryCount = 0
        if (diag.card === 'pending' && cardRetryTimer === null && !disposed && cardRetryCount < CARD_RETRY_MAX) {
          cardRetryTimer = setTimeout(() => {
            cardRetryTimer = null
            cardRetryCount += 1
            cardTargets = undefined /* 强制重新检测 */
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
    function Chip(props) {
      return h(
        'span',
        { className: 'dmt-chip', title: props.title },
        h('span', { className: 'dmt-dot', 'data-state': props.state || 'idle' }),
        props.text,
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

        /* 状态行：把"到底有没有生效"摊在页面上，排查时不用开控制台。 */
        h(
          'div',
          { className: 'dmt-status' },
          h(Chip, {
            text: '主题通道 ' + channelLabel(status.channel),
            state: status.channel === 'override' ? 'ok' : status.channel === 'style' ? 'warn' : 'bad',
            title: 'override = 走官方 overrideTokens 扩展点；style = 回退样式表；none = 当前未生效',
          }),
          h(Chip, {
            text: '已覆盖 ' + String(status.applied) + ' 个令牌',
            state: status.applied > 0 ? 'ok' : 'bad',
          }),
          h(Chip, {
            text: '正文高亮 ' + (status.prose === 'on' ? '开' : status.prose === 'error' ? '异常' : '关'),
            state: status.prose === 'on' ? 'ok' : status.prose === 'error' ? 'bad' : 'warn',
            title: 'on = 正文样式表已挂载；off = 正文与宿主默认同色',
          }),
          h(Chip, {
            text: '外观 ' + (status.scheme === 'unknown' ? '未知' : status.scheme === 'dark' ? '深色' : '浅色'),
            state: status.scheme === 'unknown' ? 'warn' : 'ok',
          }),
          h(Chip, {
            text: '配置 ' + formLabel(status.form),
            state: status.form === 'ready' ? 'ok' : status.form === 'memory' ? 'warn' : 'bad',
            title: 'ready = 改动会写回 profile；memory = 只在本次会话生效',
          }),
        ),

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
          { className: 'dmt-head' },
          h('div', { className: 'dmt-title' }, '正文颜色'),
          h(
            'div',
            { className: 'dmt-sub' },
            proseCustomCount === 0
              ? '默认跟随色板与亮度档派生；点色块可逐个手挑（只影响深色外观）。'
              : `已手挑 ${proseCustomCount} 个；其余跟随派生。手挑色不再叠加亮度提亮。`,
          ),
        ),
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

        /* ---- 过程行高亮 ---- */
        h(
          'div',
          { className: 'dmt-head' },
          h('div', { className: 'dmt-title' }, '过程行高亮'),
          h(
            'div',
            { className: 'dmt-sub' },
            '给会话里的「写入 / 编辑 / 运行命令」这类过程条目的图标和标签上色，摘要与展开内容不变。',
          ),
        ),
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
            hint: '「已编辑 N 个文件」卡片的头部横带，以及「交付文件」卡片的整张底色；默认跟随宿主中性灰，挑色后覆盖（悬停色自动提亮一档）',
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

        /* ---- 自定义配色 ---- */
        h(
          'div',
          { className: 'dmt-head' },
          h('div', { className: 'dmt-title' }, '自定义配色'),
          h(
            'div',
            { className: 'dmt-sub' },
            customCount === 0
              ? '改任意一个槽位即可覆盖 Mariana 默认值；改回默认会自动清除该覆盖。只影响深色外观。'
              : `已自定义 ${customCount} 个槽位。只影响深色外观；浅色外观保持插件自带值。`,
          ),
        ),
        contrastWarning !== ''
          ? h('div', { className: 'dmt-warn' }, '⚠ ' + contrastWarning)
          : null,
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

        /* ---- 配色方案保存 / 载入 ---- */
        h(
          'div',
          { className: 'dmt-head' },
          h('div', { className: 'dmt-title' }, '配色方案'),
          h(
            'div',
            { className: 'dmt-sub' },
            `把当前背景变体 + 强调色 + 自定义槽位存成一套方案，随时载入。最多 ${MAX_PRESETS} 套。`,
          ),
        ),
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

    function formLabel(value) {
      if (value === 'ready') return '已连接'
      if (value === 'memory') return '仅内存'
      if (value === 'rejected') return '被拒绝'
      return '等待中'
    }

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

        /* 主题：不依赖任何服务，立即按默认值生效一次（首屏就是 Mariana）。 */
        applyNow()

        if (!bound) {
          bound = true
          bindWhenReady(ctx, 0)
          /* 设置页样式表不在这里装 —— 由 MarianaSettingsPage 首次渲染时按需安装，
             启动路径省掉一次 15 KB 的 CSS 解析（见 ensurePageStyles）。 */
          registerSectionWhenReady(ctx, 0)

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
        CARD_TARGETS,
        buildCardSheet,
        detectCardTargets,
        MARKDOWN_SHEET_ID,
        MARKDOWN_RULES,
        buildMarkdownSheet,
        LATEX_SHEET_ID,
        LATEX_BLOCK_CLASS,
        LATEX_TOKEN_OVERRIDES,
        isLatexBlock,
        buildLatexSheet,
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
