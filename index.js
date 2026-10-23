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
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ====================================================================== *
 * 壁纸路由
 *
 * ## 为什么必须有这一步
 *
 * 页面里的 `backdrop-filter` 只能模糊「同一张画布里、位于它背后的像素」。
 * **窗口背后的真实桌面不在 Chromium 的画布里**，所以 CSS 永远采不到它 ——
 * 无论怎么调 blur，毛玻璃背后都是空的，看起来就是「开了没变化」。
 *
 * 解法：把壁纸**作为一张图铺进页面最底层**，它就成了画布内像素，
 * 上面的玻璃才有东西可糊。这条路线**不需要修改 app.asar，也不需要窗口透明**。
 *
 * ## 为什么用 HTTP 路由
 *
 * 插件宿主跑在独立的 Node 进程里，和页面渲染进程不共享内存。
 * 页面拿不到宿主的文件读取能力，只能通过 webServer 注册的路由同源 fetch。
 * （页面跑在 dsh-app:// 协议下，`file://` 会被安全策略拦掉，走 HTTP 才通。）
 *
 * ## 壁纸来源
 *
 * 1. `%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper`
 *    —— Windows 固定的当前壁纸缓存，路径不变、换壁纸时内容自动更新。
 * 2. 注册表 `HKCU\Control Panel\Desktop` 的 `Wallpaper` 值 —— 仅作兜底：
 *    Wallpaper Engine 之类的工具会把它指向过期/不存在的文件。
 * ====================================================================== */

/** 壁纸路由。页面用同源 fetch 取。 */
const WALLPAPER_ROUTE = '/dsh-colorlab/wallpaper'

/* 壁纸大小不再设上限。
 *
 * 原先卡了 12 MB，理由是「正常壁纸约 1 MB」。但高分辨率壁纸（4K / 多显示器
 * 拼接）轻松超过这个数，被拒绝时只表现为「壁纸状态：使用渐变背景」，
 * 用户根本不知道是自己那张图太大。
 *
 * 现在只拒绝「空文件」这种明确异常，大小交给浏览器自己的解码能力判断。 */

/**
 * 按优先级列出壁纸候选路径。
 * @returns {string[]} 可能存在的壁纸文件路径。
 */
/**
 * 清洗用户填的路径。
 *
 * Windows 资源管理器的「复制为路径」会把路径带引号复制，
 * 用户粘进来就成了 双引号+路径+双引号 的形式。
 * 首尾的引号是值的一部分，直接当路径用必然找不到文件。
 * 这里统一剥掉，并且支持重复粘贴（剥多层）。
 *
 * @param {string} raw - 用户填写的原始值。
 * @returns {string} 清洗后的路径；空串表示未指定。
 */
function cleanPath(raw) {
  if (typeof raw !== "string") return ""
  let value = raw.trim()
  for (let i = 0; i < 3; i += 1) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === String.fromCharCode(34) && last === String.fromCharCode(34))
      || (first === String.fromCharCode(39) && last === String.fromCharCode(39))) {
      value = value.slice(1, -1).trim()
    } else {
      break
    }
  }
  return value
}

function wallpaperCandidates(customPath) {
  const out = []
  const custom = cleanPath(customPath)
  const appData = process.env.APPDATA

  /* 自选壁纸优先，但**不独占**。
   * 上一版写成「有自选值就只试它」，结果用户填了个无效路径
   * （Windows 复制来的带引号路径），整条壁纸彻底失效 ——
   * 表现为「连桌面壁纸都识别不到，只剩渐变」。
   * 正确行为：自选优先，读不到就回退到系统壁纸。 */
  if (custom !== "") out.push(custom)

  if (appData) {
    out.push(join(appData, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper'))
  }
  try {
    const text = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'Wallpaper'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    })
    const match = /Wallpaper\s+REG_SZ\s+(.+)/.exec(text)
    if (match !== null) out.push(match[1].trim())
  } catch {
    /* 读不到注册表就只用 TranscodedWallpaper */
  }
  return out
}

/**
 * 按魔数嗅探图片 MIME。
 * @param {Buffer} bytes - 文件字节。
 * @returns {string} MIME；无法识别时返回 'application/octet-stream'。
 */
function detectImageMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42) return 'image/webp'
  return 'application/octet-stream'
}

/** 缓存：壁纸约 1MB，没必要每个请求都重读盘；按 mtime 失效。 */
let wallpaperCache = { mtime: 0, bytes: null, mime: 'image/jpeg' }

/**
 * 读取当前壁纸（带缓存）。
 * @returns {{bytes: Buffer, mime: string}|null} 读不到时返回 null。
 */
function readWallpaper(customPath) {
  for (const path of wallpaperCandidates(customPath)) {
    try {
      if (!existsSync(path)) continue
      const stats = statSync(path)
      /* 只排除空文件与非普通文件。大小不设上限（4K / 多屏壁纸会超 12MB）。 */
      if (!stats.isFile() || stats.size === 0) continue

      /* 缓存键带上路径：换壁纸（或改设置后指向别的文件）必须立刻生效，
         不能只比 mtime —— 两个文件可能 mtime 相同。 */
      if (wallpaperCache.bytes !== null && wallpaperCache.mtime === stats.mtimeMs
        && wallpaperCache.path === path) {
        return wallpaperCache
      }

      const bytes = readFileSync(path)
      const mime = detectImageMime(bytes)
      if (mime === 'application/octet-stream') continue

      wallpaperCache = { mtime: stats.mtimeMs, bytes, mime, path }
      return wallpaperCache
    } catch {
      /* 换下一个候选 */
    }
  }
  return null
}

/**
 * 注册壁纸路由。
 *
 * 没有 webServer（TUI / headless profile）时静默跳过 —— 页面侧会自动
 * 退回「渐变」背景，不会黑屏，也不影响主题本身。
 *
 * @param {object} ctx - Host plugin context.
 */
function registerWallpaperRoute(ctx, getCustomPath) {
  try {
    ctx.inject(['webServer'], (hostCtx) => {
      const dispose = hostCtx.webServer.register({
        kind: 'exact',
        path: WALLPAPER_ROUTE,
        handler: (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { allow: 'GET, HEAD' })
            response.end()
            return
          }
          /* 🔧 路径优先从 query 取。
           *
           * 页面每次请求都带上当前的 glassWallpaperPath（见 client.js 的
           * wallpaperUrl）。这比读 Host 的 config 可靠 —— config 是 apply()
           * 时的快照，设置改动后不会更新，会导致「要提交第二次才显示上一次的图」。
           *
           * query 里没有时才回落到 config（兼容旧请求 / 直接访问路由）。 */
          let queryPath = ''
          try {
            const requestUrl = new URL(request.url, 'http://localhost')
            const raw = requestUrl.searchParams.get('path')
            if (typeof raw === 'string' && raw !== '') queryPath = raw
          } catch {
            /* URL 解析失败就回落到 config */
          }
          const configured = typeof getCustomPath === 'function' ? getCustomPath() : ''
          const found = readWallpaper(queryPath !== '' ? queryPath : configured)
          if (found === null) {
            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            response.end('wallpaper not found')
            return
          }
          response.writeHead(200, {
            'content-type': found.mime,
            'content-length': String(found.bytes.length),
            /* 用户随时可能换壁纸，不让浏览器长缓存。 */
            'cache-control': 'no-cache',
          })
          if (request.method === 'HEAD') {
            response.end()
            return
          }
          response.end(found.bytes)
        },
      })
      /* 插件卸载时注销路由，避免重复注册。 */
      if (typeof ctx.on === 'function') {
        ctx.on('dispose', () => {
          try {
            if (typeof dispose === 'function') dispose()
          } catch {
            /* 已注销 */
          }
        })
      }
    })
  } catch (error) {
    /* 拿不到 webServer 就降级：页面用渐变兜底，不影响主题。 */
    try {
      console.warn('[dsh-colorlab] 壁纸路由未注册：', error?.message ?? error)
    } catch {
      /* console 不可用 */
    }
  }
}


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
  /* 要高亮哪些过程行：JSON 数组，值是 ROW_VARIANTS 里的 variant。 */
  rowVariants: '["write","edit","bash","summary","turn"]',
  /* "on" | "off" —— 玻璃界面总开关：面板/浮层/输入框变半透明，透出背后的背景层。 */
  glass: 'on',
  /* "wallpaper"（读 Windows 当前桌面壁纸）| "gradient"（用当前配色生成的柔和光斑）。 */
  glassBackground: 'wallpaper',
  /* 三列底色浓度百分比 0–100。越高越接近原生 Mariana（主题色越保得住），
     越低壁纸越明显。默认 65：既能透出壁纸的明暗，又让 #343D46 仍是主调。 */
  glassTint: '65',
  /* 浮层（菜单/提示/输入框/气泡）雾面浓度百分比 0–40。 */
  glassFog: '16',
  /* 玻璃背后的模糊半径 0–40 px。 */
  glassBlur: '16',
  /* 白雾浓度 0–100。磨砂的「厚度感」来自这层薄白，不是来自模糊。
     上游实测：0% 边缘能量 0.23、8% → 0.61（平衡点）、28% → 1.03（会盖平模糊）。 */
  glassHaze: '8',
  /* 自选壁纸的绝对路径；空串 = 跟随系统桌面壁纸。
     指向本机图片文件时优先使用它，Host 会校验存在性与大小。 */
  glassWallpaperPath: '',
  /* 背景压暗："auto" | "0" | "20" | "35" | "50"（固定百分比）。 */
  glassVeil: 'auto',
  /* 背景饱和度 0–200%（100 = 原样）。 */
  glassSat: '120',
  /* 等高线漂移速度："0" 静止 | "1" | "2" | "4"。 */
  contourSpeed: '2',
  /* ---- 等高线高级（2026-10-23）：观感/画质旋钮，全部收在设置页折叠块里。 ---- */
  /* 线条浓度（不透明度）0–100，默认 55。 */
  contourInk: '55',
  /* 线条粗细 px："1" | "1.5" | "2"。 */
  contourWidth: '1',
  /* 动画帧率："4" 省电 | "8" 标准 | "15" 流畅。 */
  contourFps: '8',
  /* 地形密度（画质↔流畅度）："fine" 细 | "normal" 中 | "coarse" 粗。 */
  contourDensity: 'normal',
  /* 等高线层数 12–30，默认 20。 */
  contourLevels: '20',
  /* 地形起伏幅度 40–160（%），默认 100。 */
  contourRelief: '100',
  /* 漂移幅度 0–200（%），默认 100。 */
  contourDrift: '100',
  /* 线条颜色：空串 = 跟随强调色；否则 #RRGGBB。 */
  contourColor: '',
  /* 高程标注 "on" | "off"（只在「速度 = 静止」时生效，动画档有 fillText 成本）。 */
  contourLabels: 'off',
  /* "on" | "off" —— 手绘造型（不规则圆角 + 纸影 + 悬停微抬 + 分界线）。
     灵感与数值来自 dsh-maid-whale-UI 的纸面主题（只抄机制不抄美术），
     与玻璃界面独立，默认关。 */
  shape: 'off',
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
 * 诊断文件（借鉴 dsh-theme-endfield 的做法，2026-10-22）。
 *
 * 背景：`loadSchemaBuilder()` 全锚点落空时，表现是**设置页整个消失且不报错**
 * （条目投射不出表单，主题照常生效）—— 这是我们最难查的故障模式，
 * DESIGN.md 里记过"错误被 remote 层吞掉，前端连一句报错都看不到"。
 *
 * 做法：探测失败时往 profile 目录写 `colorlab-diagnostic.json`，记录
 * 试过的每个锚点、每个模块 id 的具体报错；成功时把它删掉。
 * 下次"设置页没了"，文件直接说明死在哪一步，不用再猜。
 */
const DIAGNOSTIC_FILE = 'colorlab-diagnostic.json'

function diagnosticDir() {
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    return process.env.DSH_PROFILE_DIR
  }
  const haystacks = [
    ...(process.argv || []).filter((v) => typeof v === 'string'),
    fileURLToPath(import.meta.url),
  ]
  for (const value of haystacks) {
    const hit = /^(.*?[\\/]profiles[\\/][^\\/]+)/.exec(value)
    if (hit !== null) return hit[1]
  }
  /* 兜底：插件自己的目录（测试环境会走到这里）。 */
  return fileURLToPath(new URL('.', import.meta.url))
}

function writeDiagnostic(trail) {
  try {
    writeFileSync(join(diagnosticDir(), DIAGNOSTIC_FILE), JSON.stringify({
      at: new Date().toISOString(),
      plugin: 'dsh-colorlab',
      reason: trail.reason,
      anchors: trail.anchors,
      hint: '设置表单投射失败：DSH 读不到 schemastery 或 schema 构造抛错。'
        + '主题本身不受影响（客户端用内存默认值）。检查 anchors 里哪个环节是 ok:false。',
    }, null, 2), 'utf8')
  } catch {
    /* 诊断本身写不了就算了，绝不让它把插件带崩 */
  }
}

function clearDiagnostic() {
  try {
    rmSync(join(diagnosticDir(), DIAGNOSTIC_FILE), { force: true })
  } catch {
    /* 没有文件 / 删不掉 —— 无所谓 */
  }
}

/**
 * 从宿主 realm 懒加载 schemastery。
 * 找不到就返回 undefined —— 那样条目投射不出设置表单，但主题覆盖本身照常工作
 * （客户端用内存默认值）。这样"设置页没出来"不会连累"主题没生效"。
 * 失败时把逐锚点的轨迹写进诊断文件（见 writeDiagnostic）。
 */
function loadSchemaBuilder() {
  const trail = { reason: 'no-anchor-resolved', anchors: [] }
  for (const anchor of configRequireAnchors()) {
    const entry = { anchor, requireOk: false, attempts: [] }
    trail.anchors.push(entry)
    let req
    try {
      req = createRequire(anchor + '/package.json')
      entry.requireOk = true
    } catch (error) {
      entry.error = String(error && error.code ? error.code : error)
      continue
    }
    for (const id of ['@deepseek-ai/schemastery', 'schemastery']) {
      const attempt = { id, ok: false }
      entry.attempts.push(attempt)
      try {
        const mod = req(id)
        const z = mod && mod.default ? mod.default : mod
        if (z && typeof z.object === 'function' && typeof z.string === 'function') {
          attempt.ok = true
          return { z, trail }
        }
        attempt.ok = true
        attempt.shapeMismatch = true
      } catch (error) {
        attempt.error = String(error && error.message ? error.message : error)
      }
    }
  }
  return { z: undefined, trail }
}

function buildConfig() {
  const loaded = loadSchemaBuilder()
  const z = loaded.z
  if (z === undefined) {
    /* 全锚点落空：写诊断文件（这是"设置页消失"的唯一可查证据）。 */
    writeDiagnostic(loaded.trail)
    return undefined
  }

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

  /* schema 构造本身也可能抛（宿主 schemastery 版本缺 object/string 之外的
     链式能力时）—— 同样落进诊断，别让"设置页消失"再当一次哑故障。 */
  try {
    const config = z.object({
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
      rowVariants: str(FIELD_DEFAULTS.rowVariants),
      glass: str(FIELD_DEFAULTS.glass),
      glassBackground: str(FIELD_DEFAULTS.glassBackground),
      glassTint: str(FIELD_DEFAULTS.glassTint),
      glassFog: str(FIELD_DEFAULTS.glassFog),
      glassBlur: str(FIELD_DEFAULTS.glassBlur),
      glassHaze: str(FIELD_DEFAULTS.glassHaze),
      glassWallpaperPath: str(FIELD_DEFAULTS.glassWallpaperPath),
    glassVeil: str(FIELD_DEFAULTS.glassVeil),
    glassSat: str(FIELD_DEFAULTS.glassSat),
    contourSpeed: str(FIELD_DEFAULTS.contourSpeed),
      contourInk: str(FIELD_DEFAULTS.contourInk),
      contourWidth: str(FIELD_DEFAULTS.contourWidth),
      contourFps: str(FIELD_DEFAULTS.contourFps),
      contourDensity: str(FIELD_DEFAULTS.contourDensity),
      contourLevels: str(FIELD_DEFAULTS.contourLevels),
      contourRelief: str(FIELD_DEFAULTS.contourRelief),
      contourDrift: str(FIELD_DEFAULTS.contourDrift),
      contourColor: str(FIELD_DEFAULTS.contourColor),
      contourLabels: str(FIELD_DEFAULTS.contourLabels),
      shape: str(FIELD_DEFAULTS.shape),
    })
    /* 成功：清掉上一次失败留下的诊断（文件在 = 现在仍有问题，语义保持单一）。 */
    clearDiagnostic()
    return config
  } catch (error) {
    loaded.trail.reason = 'schema-build-threw'
    loaded.trail.error = String(error && error.message ? error.message : error)
    writeDiagnostic(loaded.trail)
    return undefined
  }
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

  /* 壁纸路由：给「玻璃界面」提供被模糊的那张底图。
     传入读配置的闭包 —— 用户在设置里换了自选壁纸路径后，
     下一次请求就会用新路径，不需要重启。 */
  registerWallpaperRoute(ctx, () => readField(config, 'glassWallpaperPath'))
}
