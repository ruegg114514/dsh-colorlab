/**
 * dsh-colorlab — Host 半体。
 *
 * 名字说明：包名从 `dsh-colorlab` 改为 `dsh-colorlab`，因为插件早已不只是
 * 一份 Mariana 配色——它是一个带设置面板的配色引擎，Mariana 只是出厂预设。
 * 但 SETTINGS_ENTRY（profile 行 id / 设置命名空间）**故意保持 `mariana-theme` 不变**：
 * 改它会让所有用户已存的 18 个自定义颜色和配色方案全部孤儿化。
 * 名字是装饰，id 是承重墙。
 *
 * 形状对齐官方模板（`cordis-plugin-development/templates/decoration/`）：
 *   "type": "module"  +  `export function apply() {}`
 *
 * 这个形状不是可选的。写成 CommonJS 的 `module.exports = { name }`（没有 apply）
 * 会让该行 **enabled: true 但 fiberPhase: null** —— fiber 从未实例化、行不进
 * loader 活树，client-modules 扫描时看不到它，浏览器启动图里没有它，
 * `window.__ModuleLoader__.load` 永远不执行，主题自然不生效，而且**不报错**。
 *
 * 这里额外导出 `Config`：DSH 读 loader 条目的 `Config` 并据此投射出设置表单，
 * 客户端半体再通过命名空间把改动写回 profile（命名空间 = profile 行 id）。
 *
 * ---- Host 半体只做一件事 ----
 * 在 `webserver/index-inject` 里补一条样式，把「插件加载前」的画布色从宿主默认的
 * `#151517` 改成 Mariana 的 `#343D46`，消除首屏闪黑。
 *
 * 为什么要 Host 侧：首屏那段 CSS 由 `@deepseek-ai/dsh-client-ui-theme` 的 Host 半体
 * 在 `webserver/index-inject` 里注入（`{prepend:true}`），浏览器插件那时还没加载，
 * 拿不到这段时机。选择器用 `body[data-ds-dark-theme]`（0,1,1）压过宿主的
 * `body`（0,0,1），所以不依赖注入顺序；且只在解析出的外观为深色时命中，
 * 用户停留在浅色外观时这段样式完全不生效。
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * profile 里的行 id；DSH 的 configForms 就是按它取表单。
 *
 * 保持 `mariana-theme`（包名已改为 dsh-colorlab，但这里不能跟着改）：
 * 它同时是设置项的命名空间，改名会让所有已存的颜色覆盖与配色方案变成孤儿。
 */
const SETTINGS_ENTRY = 'mariana-theme'

/** 与客户端半体的默认值保持一致（client.js 的 DEFAULTS）。 */
const FIELD_DEFAULTS = {
  /* "on" | "off" —— 主开关。 */
  enabled: 'on',
  /* "dark"（只在外观为深色时套用）| "both"（深浅都套用）。 */
  schemeMode: 'dark',
  /* "standard" | "deep" | "dim" —— 背景变体。 */
  surface: 'standard',
  /* "teal" | "orange" | "blue" —— 强调色。 */
  accent: 'teal',
  /* "on" | "off" —— Shiki 代码高亮色板。 */
  syntax: 'on',
  /* "on" | "off" —— 正文高亮（给 Markdown 对话正文加颜色层次）。 */
  prose: 'on',
  /* "off"（Mariana 原值）| "soft"（提亮一档，默认）| "strong"（再亮一档）。 */
  proseBoost: 'soft',
  /* 正文高亮颜色：JSON，`{"heading":"#5FB3B3","strong":"#F9AE58",...}`；空 = 跟随色板/亮度派生。 */
  proseColors: '',
  /* 自定义配色：扁平 JSON，`{"surface.base":"#343D46","palette.fg":"#D8DEE9"}`；空串 = 无覆盖。 */
  custom: '',
  /* 已保存的配色方案：JSON 数组 `[{name, at, surface, accent, custom}]`；空串 = 无。 */
  presets: '',
  /* 过程行高亮开关。 */
  rowHighlight: 'on',
  /* 工具行高亮色（图标 + 标签）。默认亮绿，在 #343D46 上 7.19:1。 */
  rowColor: '#7EE787',
  /* 汇总行 / 本轮汇总高亮色。默认亮黄（Mariana 的查找高亮色），在 #343D46 上 7.10:1。 */
  summaryColor: '#FAC863',
  /* 卡片底色：「已编辑 N 个文件」的头部横带 + 「交付文件」「计划」「排程」卡片的整张底色。
     空串 = 跟随宿主中性灰。 */
  cardColor: '',
  /* 表面不透明度 0–100。100 = 不透明；调低后表面半透明，宿主窗口的原生亚克力材质透出来。 */
  surfaceOpacity: '100',
  /* 毛玻璃：'on' / 'off'。给页面内层叠表面加 backdrop-filter。 */
  glass: 'off',
  /* 毛玻璃模糊半径（0–40 px）。 */
  glassBlur: '16',
  /* 毛玻璃饱和度（100–220 %）。 */
  glassSaturate: '120',
  /* 要高亮哪些过程行：JSON 数组，值是 ROW_VARIANTS 里的 variant。 */
  rowVariants: '["write","edit","bash","summary","turn"]',
}

/** 首屏画布色（standard 变体的 base）。客户端随后会用真实设置覆盖。 */
const BOOT_BACKGROUND = '#343D46'

/**
 * 候选解析锚点。
 *
 * `schemastery` 不在插件自己的 node_modules 里：桌面端把它装在 `app.asar` 内部的
 * `dsh/node_modules/@deepseek-ai/schemastery`，profile 的 node_modules 里**没有**它
 * （实测：从 profile 目录 `createRequire` 解析会 MODULE_NOT_FOUND）。
 * 所以按"最可能命中"的顺序收集锚点：
 *
 *   1. 进程参数里指向 `app.asar` 的路径（Electron 主进程会把 host 入口与 app 根
 *      都放进 argv；Electron 打过 asar 补丁的 fs 能从 asar 内部解析模块）；
 *   2. 从 `process.execPath` 推出的 `<exeDir>\resources\app.asar\dsh`；
 *   3. `DSH_PROFILE_DIR`（某些部署会把 schemastery 提升到 profile）；
 *   4. 插件自身路径上的 profiles 段；
 *   5. 插件自身（最后兜底）。
 */
function configRequireAnchors() {
  const anchors = []
  const push = (value) => {
    if (typeof value !== 'string' || value.length === 0) return
    const norm = value.replace(/[\\/]+$/, '')
    if (norm !== '' && !anchors.includes(norm)) anchors.push(norm)
  }

  /* 1. argv 里任何含 app.asar 的路径：取其所在目录，以及 app.asar 下的 dsh 目录。 */
  for (const value of [process.argv0, ...(process.argv || [])]) {
    if (typeof value !== 'string') continue
    const hit = /^(.*?app\.asar)/.exec(value)
    if (hit !== null) {
      push(hit[1] + '/dsh')
      push(hit[1] + '/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib')
      push(hit[1])
    }
    const profileHit = /[\\/]profiles[\\/][^\\/]+/.exec(value)
    if (profileHit !== null) push(value.slice(0, profileHit.index + profileHit[0].length))
  }

  /* 2. 从可执行文件位置推 app.asar。 */
  try {
    const exeDir = process.execPath.replace(/[\\/][^\\/]+$/, '')
    push(exeDir + '/resources/app.asar/dsh')
    push(exeDir + '/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib')
  } catch {
    /* 无 execPath（罕见） */
  }

  /* 3/4. profile 与插件自身。 */
  push(process.env.DSH_PROFILE_DIR)

  const selfDir = fileURLToPath(new URL('.', import.meta.url))
  const selfHit = /[\\/]profiles[\\/][^\\/]+/.exec(selfDir)
  if (selfHit !== null) push(selfDir.slice(0, selfHit.index + selfHit[0].length))

  push(selfDir)
  return anchors
}

/**
 * 从宿主 realm 懒加载 schemastery。
 * 找不到就返回 undefined —— 那样条目投射不出设置表单，但主题覆盖本身照常工作
 * （客户端用内存默认值）。这样"设置页没出来"不会连累"主题没生效"。
 */
function loadSchemaBuilder() {
  for (const anchor of configRequireAnchors()) {
    let req
    try {
      req = createRequire(anchor + '/package.json')
    } catch {
      continue
    }
    for (const id of ['@deepseek-ai/schemastery', 'schemastery']) {
      try {
        const mod = req(id)
        const z = mod && mod.default ? mod.default : mod
        if (z && typeof z.object === 'function' && typeof z.string === 'function') return z
      } catch {
        /* 下一个候选 */
      }
    }
  }
  return undefined
}

function buildConfig() {
  const z = loadSchemaBuilder()
  if (z === undefined) return undefined

  /**
   * 构造一个可写字段。
   *
   * **`.volatile()` 是必需的，不是装饰。** `@deepseek-ai/dsh-settings` 的
   * `write()` 开头就是 `const form = volatileForm(schema); if (form === void 0) throw`
   * 然后每个字段路径还要过 `isVolatilePath(schema, path)`。也就是说**只有
   * meta.volatile 为真的字段能经这条路径写盘**。普通 `z.string()` 的字段不可写 ——
   * 表现是界面能改、主题立即生效，但 profile 的 cordis.patch.yml 永远不更新，
   * 而且错误被 remote 层吞掉，前端连一句报错都看不到。
   *
   * `.default()` 和 `.volatile()` 都按能力探测，缺哪个就跳过哪个。
   */
  const str = (fallback) => {
    let field = z.string()
    if (typeof field.default === 'function') field = field.default(fallback)
    if (typeof field.volatile === 'function') field = field.volatile()
    return field
  }

  return z.object({
    enabled: str(FIELD_DEFAULTS.enabled),
    schemeMode: str(FIELD_DEFAULTS.schemeMode),
    surface: str(FIELD_DEFAULTS.surface),
    accent: str(FIELD_DEFAULTS.accent),
    syntax: str(FIELD_DEFAULTS.syntax),
    prose: str(FIELD_DEFAULTS.prose),
    proseBoost: str(FIELD_DEFAULTS.proseBoost),
    proseColors: str(FIELD_DEFAULTS.proseColors),
    custom: str(FIELD_DEFAULTS.custom),
    presets: str(FIELD_DEFAULTS.presets),
    rowHighlight: str(FIELD_DEFAULTS.rowHighlight),
    rowColor: str(FIELD_DEFAULTS.rowColor),
    summaryColor: str(FIELD_DEFAULTS.summaryColor),
    cardColor: str(FIELD_DEFAULTS.cardColor),
    surfaceOpacity: str(FIELD_DEFAULTS.surfaceOpacity),
    glass: str(FIELD_DEFAULTS.glass),
    glassBlur: str(FIELD_DEFAULTS.glassBlur),
    glassSaturate: str(FIELD_DEFAULTS.glassSaturate),
    rowVariants: str(FIELD_DEFAULTS.rowVariants),
  })
}

const Config = buildConfig()

/**
 * 「插件已关闭」的总闸属性。
 *
 * 客户端半体在 `syncDisabledMarker()` 里维护它（两个半体跑在不同运行时、
 * 不能互相 import，所以这个字面量两边各写一份，改的时候要一起改）。
 */
const DISABLED_ATTR = 'data-dsh-colorlab-off'

export { Config, SETTINGS_ENTRY, FIELD_DEFAULTS, BOOT_BACKGROUND, DISABLED_ATTR }

/**
 * 首屏样式：只在外观解析为深色时命中，压过宿主 ui-theme 的默认 `body` 画布色。
 * 不用 `!important` —— 提高特异性就够了，也避免压掉后续客户端写下的 inline 值。
 *
 * ⚠️ **为什么外面套一层 `html:not([data-dsh-colorlab-off])`**：
 * 这条样式是经 `webserver/index-inject` **烤进 HTML** 的，页面加载后**撤不掉**。
 * 而「启用」是客户端运行时的开关（改完不刷新页面），所以以前用户把插件关掉后，
 * `body` 的画布色仍然是 Mariana 的 `#343D46` —— 表现就是"高亮没了，底色却不回"。
 *
 * 加一个属性选择器当**总闸**：页面刚加载时 `html` 上没有这个属性 → 首屏色照常
 * 生效（不闪黑）；客户端一旦看到「启用」被关掉，就往 `html` 上打这个属性 →
 * 这条规则立刻失效，底色回到宿主默认。
 */
function bootStyle() {
  return [
    `html:not([${DISABLED_ATTR}]) body[data-ds-dark-theme]{`,
    `background-color:${BOOT_BACKGROUND};`,
    `--dsh-boot-bg:${BOOT_BACKGROUND}`,
    `}`,
  ].join('')
}

/**
 * 读一个配置字段的当前值。
 *
 * cordis 的 `apply(ctx, config)` 里，`.volatile()` 字段在部分内核版本上是响应式
 * 引用（`config.field.get()`），在另一些版本上是普通值。两种都读，读不到就用默认值 ——
 * 首屏色是否注入不该因为读配置的方式不同而失败。
 * @param config - `apply` 收到的第二个参数。
 * @param field - 字段名。
 * @returns 当前值；读不到时返回该字段的默认值。
 */
function readField(config, field) {
  const fallback = FIELD_DEFAULTS[field]
  if (config === undefined || config === null) return fallback
  let value
  try {
    value = config[field]
  } catch {
    return fallback
  }
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      value = value.get()
    } catch {
      return fallback
    }
  }
  return typeof value === 'string' && value !== '' ? value : fallback
}

/**
 * Host 插件体：注入首屏画布色。没有 webserver（TUI / headless）时该事件不会发生，
 * 这里也就什么都不做 —— 不留任何副作用。
 * @param ctx Host plugin context.
 * @param config Validated live plugin config.
 */
export function apply(ctx, config) {
  ctx.on('webserver/index-inject', (table) => {
    /* 用户显式关掉开关时不注入，首屏保持宿主原色。 */
    if (readField(config, 'enabled') === 'off') return
    table.push({ kind: 'style', text: bootStyle() })
  })
}
