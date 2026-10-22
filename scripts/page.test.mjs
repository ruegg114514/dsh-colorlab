#!/usr/bin/env node
/**
 * dsh-colorlab 设置页渲染测试。
 *
 * 用真的 React（如果 profile 里有）或一个最小替身，把 MarianaSettingsPage 渲染一遍，
 * 确认：能产出元素树、控件数量正确、点击回调能改设置并写盘。
 *
 * 用法：node scripts/page.test.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * 极简 React 替身：`createElement` 按 React 的契约把 children 放进 `props.children`，
 * 并**保留函数引用**（不转成字符串），这样 expand 才能真的把组件展开。
 */
function createFakeReact() {
  return {
    createElement: (type, props, ...children) => {
      const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
      return {
        type,
        props: { ...(props || {}), children: flat.length === 1 ? flat[0] : flat },
      }
    },
    Fragment: 'Fragment',
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
  }
}

/** 递归展开函数组件，得到纯结构树（深度有界，避免无限递归）。 */
function expand(node, depth = 0) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (depth > 32) return { type: 'MAX_DEPTH', props: {}, children: [] }
  if (Array.isArray(node)) return node.map((child) => expand(child, depth + 1))
  const { type, props } = node
  if (typeof type === 'function') {
    return expand(type(props), depth + 1)
  }
  const children = props.children === undefined ? [] : Array.isArray(props.children) ? props.children : [props.children]
  return {
    type: typeof type === 'string' ? type : String(type),
    props,
    children: children.map((child) => expand(child, depth + 1)),
  }
}

/** 收集所有节点的 type，用于计数。 */
function collect(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children || []) collect(child, out)
  return out
}

const results = []
function check(ok, name, detail) {
  results.push({ ok, name, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

function main() {
  console.log('')
  console.log('dsh-colorlab 设置页渲染测试')
  console.log('─'.repeat(52))

  /* 载入插件，抓取工厂内部注册的组件：通过一次 apply 把 slots.register 的组件截获。 */
  const created = []
  const head = {
    children: [],
    appendChild(node) {
      this.children.push(node)
      node.parentNode = this
      return node
    },
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node)
      node.parentNode = null
    },
  }
  const document = {
    head,
    documentElement: { attributes: {}, setAttribute() {}, removeAttribute() {} },
    createElement: (tag) => ({
      tagName: tag,
      dataset: {},
      style: {},
      textContent: '',
      parentNode: null,
      setAttribute() {},
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this)
      },
    }),
  }

  let captured = null
  const fakeWindow = {
    __ModuleLoader__: { load: (definition) => { captured = definition } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }
  let ReactImpl = null
  const fakeRequire = (id) => {
    if (id === 'react') return ReactImpl
    throw new Error('unexpected require: ' + id)
  }

  /* 先给一个占位 React，只为让 bundle 求值（此时不渲染）。 */
  ReactImpl = createFakeReact()
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const run = new Function('window', 'document', 'require', 'setTimeout', 'clearTimeout', 'console', source)
  run(fakeWindow, document, fakeRequire, () => ({ unref() {} }), () => {}, console)
  const exports = captured.factory(fakeRequire)

  /* 用假 slots 截获设置页组件。 */
  let pageComponent = null
  const slots = {
    inject: (name, factory) => factory(),
    register: (meta, component) => {
      if (meta.name === 'settings.section') {
        pageComponent = component
        created.push(meta)
      }
      return () => {}
    },
  }

  const layers = new Map()
  const theme = {
    ctx: { on: () => () => {} },
    getTheme: () => ({ preference: 'dark', active: { id: 'dark', colorScheme: 'dark', tokens: {} }, revision: 1 }),
    setTheme() {},
    overrideTokens: (source, tokens) => {
      const record = { tokens }
      layers.set(source, record)
      return () => layers.delete(source)
    },
  }

  const effects = []
  const ctx = {
    slots,
    theme,
    effect: (factory) => effects.push(factory()),
    on: () => () => {},
    get: (name) => (name === 'slots' ? slots : name === 'theme' ? theme : undefined),
  }
  exports.apply(ctx)

  check(pageComponent !== null, '设置页组件已注册到 settings.section')
  check(created.length === 1 && created[0].id === 'mariana-theme', '设置页 id = mariana-theme', created[0] ? created[0].id : 'n/a')
  check(created[0] && created[0].label === 'ColorLab', '设置页 label = ColorLab', created[0] ? created[0].label : 'n/a')
  check(created[0] && typeof created[0].order === 'number', '设置页有排序值', created[0] ? String(created[0].order) : 'n/a')

  if (pageComponent === null) {
    console.log('')
    console.log('✗ 无法继续渲染测试')
    process.exit(1)
  }

  /* 现在换成能真正展开的 React 替身，渲染一次。 */
  ReactImpl = createFakeReact()
  let tree = null
  let threw = null
  try {
    tree = expand({ type: pageComponent, props: {}, children: [] })
  } catch (error) {
    threw = error
  }
  check(threw === null, '设置页渲染不抛异常', threw ? threw.message : '')
  if (threw !== null) {
    console.log('')
    console.log(`✗ 1 项失败`)
    process.exit(1)
  }

  const nodes = collect(tree)
  const byClass = new Map()
  for (const node of nodes) {
    const cls = node.props && node.props.className
    if (typeof cls === 'string') byClass.set(cls, (byClass.get(cls) || 0) + 1)
  }

  check(nodes.length > 30, '渲染出足够多的节点', String(nodes.length))
  check((byClass.get('dmt-root') || 0) === 1, '根节点 .dmt-root 存在')
  /* 🔧 2026-10-22 页面整理后的新不变量：
   * 六个分组统一用 GroupHead（主题/代码与正文/过程行/玻璃界面/手绘造型/自定义配色/配色方案 = 7）。
   * 旧的五行芯片诊断退役 —— 正常时诊断行完全隐身（这里默认状态全绿，应为 0）。 */
  check((byClass.get('dmt-groupTitle') || 0) === 7, '七个分组标题（统一 GroupHead 样式）', String(byClass.get('dmt-groupTitle') || 0))
  check((byClass.get('dmt-diagLine') || 0) === 0, '一切正常 → 诊断行隐身')
  check((byClass.get('dmt-chip') || 0) === 0, '旧芯片行已退役')
  check((byClass.get('dmt-fold') || 0) >= 3, '折叠块 ≥3（正文调色 / 玻璃高级 / 完整调色板）', String(byClass.get('dmt-fold') || 0))
  check((byClass.get('dmt-row') || 0) >= 4, '设置行 ≥ 4 个', String(byClass.get('dmt-row') || 0))
  check((byClass.get('dmt-switch') || 0) >= 2, '开关 ≥ 2 个（启用 + 代码高亮）', String(byClass.get('dmt-switch') || 0))
  /* 两个分段选择：套用范围（2 项）+ 正文高亮亮度（3 项） */
  check((byClass.get('dmt-seg') || 0) === 4, '分段选择 4 个（套用范围 + 背景来源 + 压暗 + 正文亮度；等高线速度是条件渲染不计）', String(byClass.get('dmt-seg') || 0))
  check((byClass.get('dmt-swatch') || 0) === 6, '色块 6 个（3 背景 + 3 强调）', String(byClass.get('dmt-swatch') || 0))
  check((byClass.get('dmt-card') || 0) === 14, '色板预览 14 张卡', String(byClass.get('dmt-card') || 0))
  check((byClass.get('dmt-preview') || 0) === 1, '代码样例存在')
  check((byClass.get('dmt-prosePreview') || 0) === 1, '正文高亮预览存在')
  check((byClass.get('dmt-proseBody') || 0) === 1, '正文高亮预览正文存在')
  check((byClass.get('dmt-footer') || 0) === 1, '页脚按钮组存在')
  check((byClass.get('dmt-notice') || 0) === 0, '深色外观下不显示"切到深色"提示')

  /* 过程行高亮区块：两个颜色选择器（工具行绿 / 汇总行黄）+ 两个分类组 */
  check((byClass.get('dmt-colorInput') || 0) === 3, '颜色选择器 3 个（工具行 + 汇总行 + 卡片头部）', String(byClass.get('dmt-colorInput') || 0))
  check((byClass.get('dmt-checkGroup') || 0) === 2, '过程行分类分 2 组', String(byClass.get('dmt-checkGroup') || 0))
  check((byClass.get('dmt-checkGrid') || 0) === 2, '过程行分类网格 2 个', String(byClass.get('dmt-checkGrid') || 0))
  /* 10 个分类复选框（summary/turn + 8 个工具行） */
  check((byClass.get('dmt-check') || 0) === 10, '过程行分类 10 个', String(byClass.get('dmt-check') || 0))
  check((byClass.get('dmt-rowPreview') || 0) === 1, '过程行预览容器存在')
  /* 默认勾 5 项 = 3 工具行 + 2 汇总类，各按自己的宿主结构渲染 */
  check((byClass.get('dmt-rowItem') || 0) === 3, '默认预览 3 个工具行', String(byClass.get('dmt-rowItem') || 0))
  check((byClass.get('dmt-rowButton') || 0) === 2, '默认预览 2 个汇总行按钮', String(byClass.get('dmt-rowButton') || 0))
  /* 预览必须复刻宿主结构：data-variant + data-disclosure-header + _leading/_title */
  const previewItems = nodes.filter((node) => node.props && node.props.className === 'dmt-rowItem')
  check(previewItems.length === 3, '拿到 3 个预览行节点')
  if (previewItems.length === 3) {
    check(previewItems[0].props['data-variant'] === 'write', '第一行 data-variant=write', previewItems[0].props['data-variant'])
    const inner = collect(previewItems[0])
    const header = inner.find((node) => node.props && node.props['data-disclosure-header'] === true)
    check(header !== undefined, '预览行内有 data-disclosure-header（与宿主同构）')
    const innerClasses = inner.map((node) => String((node.props && node.props.className) || ''))
    check(innerClasses.some((c) => c.includes('_leading')), '预览行有 _leading 图标容器')
    check(innerClasses.some((c) => c.includes('_title')), '预览行有 _title 标题')
    /* 摘要不能带 _leading/_title，否则会被误上色 */
    const summary = inner.find((node) => node.props && node.props.className === 'dmt-rowSummary')
    check(summary !== undefined, '预览行有摘要节点')
    if (summary !== undefined) {
      const cls = String(summary.props.className)
      check(!cls.includes('_leading') && !cls.includes('_title'), '摘要不带 _leading/_title（不会被上色）', cls)
    }
  }

  /* 自定义配色 + 正文颜色共用同一套槽位组件：18 + 9 = 27 */
  check((byClass.get('dmt-custom') || 0) === 2, '颜色容器 2 个（正文颜色 + 自定义配色）', String(byClass.get('dmt-custom') || 0))
  check((byClass.get('dmt-customGroup') || 0) === 3, '调色板内小分组 3 个（界面底色/文字/语法色；玻璃/手绘已改 GroupHead）', String(byClass.get('dmt-customGroup') || 0))
  check((byClass.get('dmt-customGroupTitle') || 0) === 3, '3 个小分组标题')
  check((byClass.get('dmt-slot') || 0) === 27, '颜色槽位 27 个（18 自定义 + 9 正文）', String(byClass.get('dmt-slot') || 0))
  check((byClass.get('dmt-slotSwatch') || 0) === 27, '27 个取色按钮', String(byClass.get('dmt-slotSwatch') || 0))
  check((byClass.get('dmt-slotHex') || 0) === 27, '27 个 hex 输入框', String(byClass.get('dmt-slotHex') || 0))
  /* 正文颜色槽位按 data-slot 前缀区分 */
  const proseSlots = nodes.filter((node) => node.props && typeof node.props['data-slot'] === 'string' && node.props['data-slot'].startsWith('prose.'))
  check(proseSlots.length === 9, '正文颜色槽位 9 个', String(proseSlots.length))
  /* 无草稿时不出现草稿条 */
  check((byClass.get('dmt-draftBar') || 0) === 0, '无草稿时不显示草稿条')

  /* 配色方案区块 */
  check((byClass.get('dmt-presets') || 0) === 1, '配色方案容器存在')
  check((byClass.get('dmt-saveRow') || 0) === 1, '保存行存在')
  check((byClass.get('dmt-saveInput') || 0) === 1, '方案名输入框存在')
  check((byClass.get('dmt-empty') || 0) === 1, '无方案时显示空态提示')
  check((byClass.get('dmt-presetList') || 0) === 0, '无方案时不渲染列表')

  /* 正文高亮预览里必须包含各元素，否则"预览"名不副实。 */
  const proseBody = nodes.find((node) => node.props && node.props.className === 'dmt-proseBody')
  check(proseBody !== undefined, '正文高亮预览容器存在')
  if (proseBody !== undefined) {
    const proseNodes = collect(proseBody)
    const proseTypes = proseNodes.map((node) => node.type)
    for (const tag of ['h4', 'p', 'strong', 'em', 'code', 'ul', 'li', 'blockquote', 'a']) {
      check(proseTypes.includes(tag), `正文预览包含 <${tag}>`)
    }
  }
  /* 预览的 data-prose 反映当前开关状态。 */
  const prosePreview = nodes.find((node) => node.props && node.props.className === 'dmt-prosePreview')
  check(prosePreview !== undefined && prosePreview.props['data-prose'] === 'on', '正文预览 data-prose=on')

  /* 浅色外观下应出现提示 + 切换按钮。
     必须用**全新的一份 bundle 实例**：apply 内部的 bound 标志是模块级的，
     同一个实例第二次 apply 不会重复注册设置页（这是刻意的，防止重复挂载）。 */
  const lightTheme = {
    ...theme,
    getTheme: () => ({ preference: 'light', active: { id: 'light', colorScheme: 'light', tokens: {} }, revision: 2 }),
  }
  let lightPage = null
  {
    let captured2 = null
    const fakeWindow2 = {
      __ModuleLoader__: { load: (definition) => { captured2 = definition } },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    }
    ReactImpl = createFakeReact()
    const source2 = readFileSync(join(root, 'client.js'), 'utf8')
    const run2 = new Function('window', 'document', 'require', 'setTimeout', 'clearTimeout', 'console', source2)
    run2(fakeWindow2, document, fakeRequire, () => ({ unref() {} }), () => {}, console)
    const exports2 = captured2.factory(fakeRequire)
    const slots2 = {
      inject: (name, factory) => factory(),
      register: (meta, component) => {
        if (meta.name === 'settings.section') lightPage = component
        return () => {}
      },
    }
    const ctx2 = {
      slots: slots2,
      theme: lightTheme,
      /* 必须真的执行工厂：设置页的注册就包在 ctx.effect 里。 */
      effect: (factory) => {
        factory()
      },
      on: () => () => {},
      get: (name) => (name === 'slots' ? slots2 : name === 'theme' ? lightTheme : undefined),
    }
    exports2.apply(ctx2)
  }

  check(lightPage !== null, '浅色场景下设置页组件已注册')
  if (lightPage !== null) {
    const lightTree = expand({ type: lightPage, props: {}, children: [] })
    const lightNodes = collect(lightTree)
    const lightByClass = new Map()
    for (const node of lightNodes) {
      const cls = node.props && node.props.className
      if (typeof cls === 'string') lightByClass.set(cls, (lightByClass.get(cls) || 0) + 1)
    }
    check((lightByClass.get('dmt-notice') || 0) === 1, '浅色 + 仅深色模式 → 出现提示条')
    check((lightByClass.get('dmt-chip') || 0) === 0, '旧芯片行已退役（浅色场景）')
    /* 浅色 + 仅深色：channel=none 是**预期**（上面已有蓝色提示条负责说这事），
     * 诊断行不该重复报警 —— "该生效却是 none"才算坏。 */
    check((lightByClass.get('dmt-diagLine') || 0) === 0, '浅色+仅深色 → 诊断行不重复报警（提示条负责）')
    /* 提示条里的按钮是"切换到深色"，必须真的能调到 setTheme。 */
    const notice = lightNodes.find((node) => node.props && node.props.className === 'dmt-notice')
    check(notice !== undefined, '提示条节点存在')
  }

  /* ---- 交互：点开关必须真的改设置并写盘 ---- */
  {
    const writes = []
    let captured3 = null
    const fakeWindow3 = {
      __ModuleLoader__: { load: (definition) => { captured3 = definition } },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    }
    ReactImpl = createFakeReact()
    const source3 = readFileSync(join(root, 'client.js'), 'utf8')
    const run3 = new Function('window', 'document', 'require', 'setTimeout', 'clearTimeout', 'console', source3)
    run3(fakeWindow3, document, fakeRequire, () => ({ unref() {} }), () => {}, console)
    const exports3 = captured3.factory(fakeRequire)

    const darkTheme3 = {
      ctx: { on: () => () => {} },
      getTheme: () => ({ preference: 'dark', active: { id: 'dark', colorScheme: 'dark', tokens: {} }, revision: 1 }),
      setTheme() {},
      /* 计数 overrideTokens 调用次数：草稿机制的核心承诺是"拖动期间零全局重建"。 */
      overrideCalls: 0,
      overrideTokens() {
        this.overrideCalls += 1
        return () => {}
      },
    }
    const hostValue = {
      enabled: 'on',
      schemeMode: 'dark',
      surface: 'standard',
      accent: 'teal',
      syntax: 'on',
      prose: 'on',
      proseBoost: 'soft',
      proseColors: '',
      custom: '',
      presets: '',
      rowHighlight: 'on',
      rowColor: '#7EE787',
      summaryColor: '#FAC863',
      rowVariants: '["write","edit","bash","summary","turn"]',
    }
    const form = {
      getSnapshot: () => ({ status: 'ready', value: hostValue }),
      subscribe: () => () => {},
      mutate(ops) {
        writes.push(ops)
        return Promise.resolve()
      },
    }
    const forms = {
      describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'mariana-theme' }] } }) }),
      get: (ns) => (ns === 'mariana-theme' ? form : { getSnapshot: () => ({ status: 'unavailable' }) }),
    }
    let page3 = null
    const slots3 = {
      inject: (name, factory) => factory(),
      register: (meta, component) => {
        if (meta.name === 'settings.section') page3 = component
        return () => {}
      },
    }
    const ctx3 = {
      slots: slots3,
      theme: darkTheme3,
      configForms: forms,
      effect: (factory) => {
        factory()
      },
      on: () => () => {},
      get: (name) => (name === 'slots' ? slots3 : name === 'theme' ? darkTheme3 : name === 'configForms' ? forms : undefined),
    }
    exports3.apply(ctx3)
    check(page3 !== null, '写盘场景：设置页已注册')

    if (page3 !== null) {
      const tree3 = expand({ type: page3, props: {}, children: [] })
      const nodes3 = collect(tree3)
      /* 找第一个开关（"启用"），点它。 */
      const toggle = nodes3.find((node) => node.props && node.props.className === 'dmt-switch')
      check(toggle !== undefined, '写盘场景：找到启用开关')
      if (toggle !== undefined) {
        const before = writes.length
        toggle.props.onClick()
        check(writes.length === before + 1, '点开关触发一次 mutate 写盘', `writes ${before} → ${writes.length}`)
        const ops = writes[writes.length - 1] || []
        const enabledOp = ops.find((op) => op.path && op.path[0] === 'enabled')
        check(enabledOp !== undefined && enabledOp.value === 'off', '写盘内容：enabled → off', enabledOp ? enabledOp.value : 'n/a')
        /* 差量写盘：只有 enabled 与宿主快照不同 → 恰好 1 个 op。
           （旧版每次打包全部字段，任何一个被拒就整批失败 → "保存后再调整弹回"。） */
        check(ops.length === 1, '一次写盘只带差异字段（差量）', String(ops.length))
      }

      /* 改背景变体：点 "deep" 色块。 */
      const swatches = nodes3.filter((node) => node.props && node.props.className === 'dmt-swatch')
      check(swatches.length === 6, '写盘场景：6 个色块')
      if (swatches.length === 6) {
        const before = writes.length
        /* 前三个是背景变体：standard / deep / dim */
        swatches[1].props.onClick()
        check(writes.length === before + 1, '点背景色块触发写盘')
        const ops = writes[writes.length - 1] || []
        const surfaceOp = ops.find((op) => op.path && op.path[0] === 'surface')
        check(surfaceOp !== undefined && surfaceOp.value === 'deep', '写盘内容：surface → deep', surfaceOp ? surfaceOp.value : 'n/a')
      }

      /* 改套用范围：点 "深浅都套用"。分段按钮总数 = 2（套用范围）+ 3（正文亮度）= 5。
         顺序由 OPTIONS 决定：前两个是 schemeMode，后三个是 proseBoost。 */
      const segButtons = nodes3.filter((node) => node.props && node.props.className === 'dmt-segBtn')
      check(segButtons.length === 13, '写盘场景：13 个分段按钮（2 套用范围 + 3 背景来源 + 5 压暗 + 3 正文亮度）', String(segButtons.length))
      if (segButtons.length >= 5) {
        /* 🔧 按 label 找按钮，不按位置下标 —— 下标依赖设置页渲染顺序，
         * 加一个分段组就会全体漂移。fake react 把 children 收进 props.children。 */
        const byLabel = (txt) => segButtons.find((node) => node.props && node.props.children === txt)
        const bothBtn = byLabel('深浅都套用')
        const before = writes.length
        bothBtn.props.onClick()
        check(writes.length === before + 1, '点分段按钮触发写盘')
        const ops = writes[writes.length - 1] || []
        const modeOp = ops.find((op) => op.path && op.path[0] === 'schemeMode')
        check(modeOp !== undefined && modeOp.value === 'both', '写盘内容：schemeMode → both', modeOp ? modeOp.value : 'n/a')

        /* 亮度档位：点 "更亮"（proseBoost=soft 是默认，strong 是"最亮"）。 */
        const beforeBoost = writes.length
        byLabel('更亮').props.onClick()
        check(writes.length === beforeBoost + 1, '点亮度档位触发写盘')
        const boostOps = writes[writes.length - 1] || []
        const boostOp = boostOps.find((op) => op.path && op.path[0] === 'proseBoost')
        check(boostOp !== undefined && boostOp.value === 'strong', '写盘内容：proseBoost → strong', boostOp ? boostOp.value : 'n/a')

        /* 点 "原值" 应写 proseBoost=off。 */
        byLabel('原值').props.onClick()
        const offOp = (writes[writes.length - 1] || []).find((op) => op.path && op.path[0] === 'proseBoost')
        check(offOp !== undefined && offOp.value === 'off', '写盘内容：proseBoost → off', offOp ? offOp.value : 'n/a')

        /* 背景来源第三项：点 "等高线" 应写 glassBackground=contour。 */
        byLabel('等高线').props.onClick()
        const contourOp = (writes[writes.length - 1] || []).find((op) => op.path && op.path[0] === 'glassBackground')
        check(contourOp !== undefined && contourOp.value === 'contour', '写盘内容：glassBackground → contour',
          contourOp ? contourOp.value : 'n/a')
      }

      /* 正文高亮开关：点它必须写 prose 字段。 */
      const switches3 = nodes3.filter((node) => node.props && node.props.className === 'dmt-switch')
      check(switches3.length === 6, '写盘场景：6 个开关（启用/代码高亮/正文高亮/过程行高亮/玻璃界面/手绘造型）', String(switches3.length))
      const proseSwitch = switches3.find((node) => node.props['aria-label'] === '正文高亮')
      check(proseSwitch !== undefined, '写盘场景：找到正文高亮开关')
      if (proseSwitch !== undefined) {
        const before = writes.length
        proseSwitch.props.onClick()
        check(writes.length === before + 1, '点正文高亮开关触发写盘')
        const ops = writes[writes.length - 1] || []
        const proseOp = ops.find((op) => op.path && op.path[0] === 'prose')
        check(proseOp !== undefined && proseOp.value === 'off', '写盘内容：prose → off', proseOp ? proseOp.value : 'n/a')
      }

      /* ---- 过程行高亮：开关 / 颜色 / 分类勾选 ---- */
      const rowSwitch = switches3.find((node) => node.props['aria-label'] === '启用过程行高亮')
      check(rowSwitch !== undefined, '写盘场景：找到过程行开关')
      if (rowSwitch !== undefined) {
        const before = writes.length
        rowSwitch.props.onClick()
        check(writes.length === before + 1, '点过程行开关触发写盘')
        const ops = writes[writes.length - 1] || []
        const op = ops.find((entry) => entry.path && entry.path[0] === 'rowHighlight')
        check(op !== undefined && op.value === 'off', '写盘内容：rowHighlight → off', op ? op.value : 'n/a')
      }
      /* ---- 颜色输入走草稿：改动**不**即时写盘（修"每动一下卡很久"的回归锁）---- */
      const colorInputs = nodes3.filter((node) => node.props && node.props.className === 'dmt-colorInput')
      check(colorInputs.length === 3, '写盘场景：3 个颜色选择器', String(colorInputs.length))
      const toolColorInput = colorInputs.find((node) => node.props['aria-label'] === '工具行颜色')
      check(toolColorInput !== undefined, '写盘场景：找到工具行颜色选择器')
      if (toolColorInput !== undefined) {
        const before = writes.length
        /* 基线 = 初始 apply 的那一次重建；拖动期间计数不应再增加。 */
        const baseline = darkTheme3.overrideCalls
        toolColorInput.props.onChange({ target: { value: '#00FF88' } })
        toolColorInput.props.onChange({ target: { value: '#00FF99' } })
        toolColorInput.props.onChange({ target: { value: '#00FFAA' } })
        check(writes.length === before, '连拖 3 次工具行颜色：零写盘（草稿机制）', `writes ${before} → ${writes.length}`)
        check(darkTheme3.overrideCalls === baseline, '连拖 3 次：拖动期间零全局令牌重建', `baseline=${baseline} now=${darkTheme3.overrideCalls}`)
      }
      /* 重新展开组件：store 已带草稿 → 草稿条出现。 */
      const draftTree = expand({ type: page3, props: {}, children: [] })
      const draftNodes = collect(draftTree)
      const draftBar = draftNodes.find((node) => node.props && node.props.className === 'dmt-draftBar')
      check(draftBar !== undefined, '有草稿时草稿条出现')
      if (draftBar !== undefined) {
        const draftButtons = collect(draftBar).filter((node) => node.type === 'button')
        const applyBtn = draftButtons.find((node) => String(node.props.children) === '应用更改')
        const cancelBtn = draftButtons.find((node) => String(node.props.children) === '放弃')
        check(applyBtn !== undefined, '草稿条有「应用更改」')
        check(cancelBtn !== undefined, '草稿条有「放弃」')
        /* 先验放弃：草稿清空、不写盘。 */
        const before = writes.length
        /* 重新展开拿最新闭包里的按钮回调 */
        const tree2 = expand({ type: page3, props: {}, children: [] })
        const bar2 = collect(tree2).find((node) => node.props && node.props.className === 'dmt-draftBar')
        const cancel2 = collect(bar2).find((node) => node.type === 'button' && String(node.props.children) === '放弃')
        cancel2.props.onClick()
        check(writes.length === before, '点放弃：不写盘')
        const tree3 = expand({ type: page3, props: {}, children: [] })
        const bar3 = collect(tree3).find((node) => node.props && node.props.className === 'dmt-draftBar')
        check(bar3 === undefined, '放弃后草稿条消失')
        /* 再改一次并应用。 */
        const toolInput3 = collect(tree3)
          .filter((node) => node.props && node.props.className === 'dmt-colorInput')
          .find((node) => node.props['aria-label'] === '工具行颜色')
        toolInput3.props.onChange({ target: { value: '#00FF88' } })
        const tree4 = expand({ type: page3, props: {}, children: [] })
        const bar4 = collect(tree4).find((node) => node.props && node.props.className === 'dmt-draftBar')
        const apply4 = collect(bar4).find((node) => node.type === 'button' && String(node.props.children) === '应用更改')
        const beforeApply = writes.length
        const applyBaseline = darkTheme3.overrideCalls
        apply4.props.onClick()
        check(writes.length === beforeApply + 1, '点应用更改：恰好一次写盘', `writes ${beforeApply} → ${writes.length}`)
        const ops = writes[writes.length - 1] || []
        const op = ops.find((entry) => entry.path && entry.path[0] === 'rowColor')
        check(op !== undefined && op.value === '#00FF88', '应用后写盘内容：rowColor → #00FF88', op ? op.value : 'n/a')
        /* 应用触发 ≤1 次重建（本场景 enabled 已被前面的开关关掉，
           applyNow 走 teardown 不重建；关键承诺是"绝不因拖动重建 N 次"）。 */
        check(darkTheme3.overrideCalls <= applyBaseline + 1, '应用后重建次数 ≤1（拖动不放大重建）', `before=${applyBaseline} now=${darkTheme3.overrideCalls}`)
      }
      /* ---- 卡片底色：也走草稿，且空串 = 跟随默认 ---- */
      {
        const treeC1 = expand({ type: page3, props: {}, children: [] })
        const cardInput = collect(treeC1)
          .filter((node) => node.props && node.props.className === 'dmt-colorInput')
          .find((node) => node.props['aria-label'] === '文件卡片颜色')
        check(cardInput !== undefined, '写盘场景：找到卡片颜色选择器')
        if (cardInput !== undefined) {
          const before = writes.length
          cardInput.props.onChange({ target: { value: '#3B454F' } })
          check(writes.length === before, '卡片颜色改动：零写盘（草稿）')
          /* 预览容器应拿到 --changes-fill / --deliverable-fill 草稿色
             （挂在 .dmt-cardPreview 上，卡片元素继承）。 */
          const treeC2 = expand({ type: page3, props: {}, children: [] })
          const preview = collect(treeC2).find((node) => node.props && node.props.className === 'dmt-cardPreview')
          check(preview !== undefined, '卡片预览容器存在')
          const style = preview && preview.props.style
          check(
            style !== undefined && style['--changes-fill'] === '#3B454F',
            '草稿色只进预览容器（--changes-fill）',
            style ? String(style['--changes-fill']) : 'n/a',
          )
          check(
            style !== undefined && style['--deliverable-fill'] === '#3B454F',
            '草稿色也覆盖交付文件卡片（--deliverable-fill）',
            style ? String(style['--deliverable-fill']) : 'n/a',
          )
          /* 两种卡片的预览结构都在（改动文件=横带，交付文件=整卡底色）。 */
          const head = collect(treeC2).find((node) => node.props && node.props.className === 'dmt-cardDemoHead')
          const deliver = collect(treeC2).find((node) => node.props && node.props.className === 'dmt-deliverDemo')
          check(head !== undefined && head.props.style === undefined, '头部元素无内联样式（继承容器变量）')
          check(deliver !== undefined, '交付文件卡片预览存在')
          /* 应用：写 cardColor。 */
          const barC = collect(treeC2).find((node) => node.props && node.props.className === 'dmt-draftBar')
          check(barC !== undefined, '卡片颜色进草稿条')
          if (barC !== undefined) {
            const applyC = collect(barC).find((node) => node.type === 'button' && String(node.props.children) === '应用更改')
            const beforeApply = writes.length
            applyC.props.onClick()
            check(writes.length === beforeApply + 1, '应用卡片颜色：一次写盘')
            const ops = writes[writes.length - 1] || []
            const op = ops.find((entry) => entry.path && entry.path[0] === 'cardColor')
            check(op !== undefined && op.value === '#3B454F', '写盘内容：cardColor → #3B454F', op ? op.value : 'n/a')
          }
        }
      }
      /* 勾选一个分类必须写回 rowVariants JSON 数组。
         渲染顺序 = 汇总组（summary, turn）+ 工具组（write, edit, bash, read, …），
         所以索引 5 是 read（默认未勾）。 */
      const checkboxes = nodes3.filter(
        (node) => node.type === 'input' && node.props.type === 'checkbox',
      )
      check(checkboxes.length === 10, '写盘场景：10 个分类复选框', String(checkboxes.length))
      if (checkboxes.length === 10) {
        const before = writes.length
        checkboxes[5].props.onChange({})
        check(writes.length === before + 1, '勾选分类触发写盘')
        const ops = writes[writes.length - 1] || []
        const op = ops.find((entry) => entry.path && entry.path[0] === 'rowVariants')
        check(op !== undefined, '写盘内容含 rowVariants')
        if (op !== undefined) {
          const list = JSON.parse(op.value)
          check(Array.isArray(list) && list.includes('read'), 'rowVariants 里加入 read', op.value)
          check(list.includes('write') && list.includes('edit') && list.includes('bash'), '原有工具行勾选保留', op.value)
          check(list.includes('summary') && list.includes('turn'), '原有汇总类勾选保留', op.value)
        }

        /* 取消汇总行（索引 0）应把 summary 从数组里移除。 */
        checkboxes[0].props.onChange({})
        const offOp = (writes[writes.length - 1] || []).find((entry) => entry.path && entry.path[0] === 'rowVariants')
        check(offOp !== undefined, '取消勾选也写盘')
        if (offOp !== undefined) {
          const list = JSON.parse(offOp.value)
          check(!list.includes('summary'), 'rowVariants 里移除 summary', offOp.value)
          check(list.includes('turn'), 'turn 不受影响', offOp.value)
        }
      }

      /* ---- 颜色槽位（自定义 + 正文）统一走草稿 ----
         渲染顺序：正文颜色在前（9 个 prose.*），自定义配色在后（18 个）。
         用 data-slot 选，不依赖索引。 */
      const slots = nodes3.filter((node) => node.props && node.props.className === 'dmt-slot')
      check(slots.length === 27, '写盘场景：27 个槽位（9 正文 + 18 自定义）', String(slots.length))
      const bgSlot = slots.find((node) => node.props['data-slot'] === 'surface.base')
      check(bgSlot !== undefined, '找到主背景槽位（surface.base）')
      if (bgSlot !== undefined) {
        const swatch = collect(bgSlot).find((node) => node.type === 'input' && node.props.type === 'color')
        check(swatch !== undefined, '主背景槽位有 color input')
        if (swatch !== undefined) {
          const before = writes.length
          const beforeOverride = darkTheme3.overrideCalls
          swatch.props.onChange({ target: { value: '#0a0d10' } })
          swatch.props.onChange({ target: { value: '#0b0e12' } })
          check(writes.length === before, '自定义槽位连改 2 次：零写盘（草稿）')
          check(darkTheme3.overrideCalls === beforeOverride, '自定义槽位连改 2 次：零全局重建')
          /* 应用草稿：custom 字段落盘一次。 */
          const treeA = expand({ type: page3, props: {}, children: [] })
          const barA = collect(treeA).find((node) => node.props && node.props.className === 'dmt-draftBar')
          check(barA !== undefined, '自定义槽位改动也进草稿条')
          if (barA !== undefined) {
            const applyA = collect(barA).find((node) => node.type === 'button' && String(node.props.children) === '应用更改')
            applyA.props.onClick()
            check(writes.length === before + 1, '应用后写盘一次')
            const ops = writes[writes.length - 1] || []
            const customOp = ops.find((op) => op.path && op.path[0] === 'custom')
            check(customOp !== undefined, '写盘内容含 custom 字段')
            if (customOp !== undefined) {
              let parsed = null
              try { parsed = JSON.parse(customOp.value) } catch { parsed = null }
              check(parsed !== null && parsed['surface.base'] === '#0b0e12', 'custom 里写入最后一次的值', parsed ? String(parsed['surface.base']) : 'n/a')
            }
          }
        }

        /* hex 文本框：输入完整合法值才进草稿；全程不写盘。 */
        const hexInput = collect(bgSlot).find((node) => node.type === 'input' && node.props.className === 'dmt-slotHex')
        check(hexInput !== undefined, '主背景槽位有 hex 输入框')
        if (hexInput !== undefined) {
          const before = writes.length
          hexInput.props.onChange({ target: { value: '#12' } })
          hexInput.props.onChange({ target: { value: '#1234' } })
          check(writes.length === before, 'hex 输入全程零写盘（草稿机制）')
          hexInput.props.onChange({ target: { value: '#123456' } })
          check(writes.length === before, 'hex 完整也只是进草稿，仍不写盘')
          /* 清掉这笔草稿，避免污染后面的断言。 */
          const treeC = expand({ type: page3, props: {}, children: [] })
          const barC = collect(treeC).find((node) => node.props && node.props.className === 'dmt-draftBar')
          if (barC !== undefined) {
            const cancelC = collect(barC).find((node) => node.type === 'button' && String(node.props.children) === '放弃')
            cancelC.props.onClick()
            check(writes.length === before, '放弃草稿：全程零写盘', `writes=${writes.length}`)
          }
        }
      }

      /* 正文颜色槽位：prose.heading 存在且走同一套草稿路径。 */
      const headingSlot = slots.find((node) => node.props['data-slot'] === 'prose.heading')
      check(headingSlot !== undefined, '找到正文标题颜色槽位（prose.heading）')
      if (headingSlot !== undefined) {
        const hSwatch = collect(headingSlot).find((node) => node.type === 'input' && node.props.type === 'color')
        check(hSwatch !== undefined, '正文标题槽位有 color input')
        if (hSwatch !== undefined) {
          const before = writes.length
          const beforeOverride = darkTheme3.overrideCalls
          hSwatch.props.onChange({ target: { value: '#FF8800' } })
          check(writes.length === before, '正文颜色改动：零写盘（草稿）')
          check(darkTheme3.overrideCalls === beforeOverride, '正文颜色改动：零全局重建')
          const treeD = expand({ type: page3, props: {}, children: [] })
          const barD = collect(treeD).find((node) => node.props && node.props.className === 'dmt-draftBar')
          check(barD !== undefined, '正文颜色进草稿条')
          if (barD !== undefined) {
            const applyD = collect(barD).find((node) => node.type === 'button' && String(node.props.children) === '应用更改')
            applyD.props.onClick()
            check(writes.length === before + 1, '应用正文颜色：一次写盘')
            const ops = writes[writes.length - 1] || []
            const pcOp = ops.find((op) => op.path && op.path[0] === 'proseColors')
            check(pcOp !== undefined, '写盘内容含 proseColors')
            if (pcOp !== undefined) {
              let parsed = null
              try { parsed = JSON.parse(pcOp.value) } catch { parsed = null }
              check(parsed !== null && parsed.heading === '#FF8800', 'proseColors.heading 落盘', parsed ? String(parsed.heading) : 'n/a')
            }
          }
        }
      }

      /* ---- 配色方案：输入名字 + 保存 ---- */
      const saveInput = nodes3.find((node) => node.props && node.props.className === 'dmt-saveInput')
      check(saveInput !== undefined, '写盘场景：找到方案名输入框')
      const saveBtn = nodes3.find(
        (node) => node.type === 'button' && node.props.className === 'dmt-btn' && String(node.props.children) === '保存',
      )
      check(saveBtn !== undefined, '写盘场景：找到保存按钮')
      if (saveBtn !== undefined) {
        /* 名字为空时按钮必须 disabled，点了也不能写盘。 */
        check(saveBtn.props.disabled === true, '方案名为空时保存按钮禁用')
        const before = writes.length
        saveBtn.props.onClick()
        check(writes.length === before, '空名字点保存不写盘')
      }
    }
  }

  /* ---- 已有方案时：渲染列表、载入、删除 ---- */
  {
    const writes = []
    let captured4 = null
    const fakeWindow4 = {
      __ModuleLoader__: { load: (definition) => { captured4 = definition } },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    }
    ReactImpl = createFakeReact()
    const source4 = readFileSync(join(root, 'client.js'), 'utf8')
    const run4 = new Function('window', 'document', 'require', 'setTimeout', 'clearTimeout', 'console', source4)
    run4(fakeWindow4, document, fakeRequire, () => ({ unref() {} }), () => {}, console)

    /* 关键：让 bundle 用上能记住 useState 的 React，否则 setPresetName 无效。 */
    const savedPresets = [
      { name: '夜蓝', at: 1700000000000, surface: 'deep', accent: 'blue', custom: { 'palette.fg': '#E0E8F0' } },
      { name: '低对比', at: 1700000001000, surface: 'dim', accent: 'orange', custom: {} },
    ]
    const hostValue = {
      enabled: 'on',
      schemeMode: 'dark',
      surface: 'standard',
      accent: 'teal',
      syntax: 'on',
      prose: 'on',
      custom: '',
      presets: JSON.stringify(savedPresets),
    }
    const form = {
      getSnapshot: () => ({ status: 'ready', value: hostValue }),
      subscribe: () => () => {},
      mutate(ops) {
        writes.push(ops)
        return Promise.resolve()
      },
    }
    const forms = {
      describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'mariana-theme' }] } }) }),
      get: (ns) => (ns === 'mariana-theme' ? form : { getSnapshot: () => ({ status: 'unavailable' }) }),
    }
    const theme4 = {
      ctx: { on: () => () => {} },
      getTheme: () => ({ preference: 'dark', active: { id: 'dark', colorScheme: 'dark', tokens: {} }, revision: 1 }),
      setTheme() {},
      overrideTokens: () => () => {},
    }
    let page4 = null
    const slots4 = {
      inject: (name, factory) => factory(),
      register: (meta, component) => {
        if (meta.name === 'settings.section') page4 = component
        return () => {}
      },
    }
    const ctx4 = {
      slots: slots4,
      theme: theme4,
      configForms: forms,
      effect: (factory) => { factory() },
      on: () => () => {},
      get: (name) => (name === 'slots' ? slots4 : name === 'theme' ? theme4 : name === 'configForms' ? forms : undefined),
    }
    captured4.factory(fakeRequire).apply(ctx4)
    check(page4 !== null, '方案场景：设置页已注册')

    if (page4 !== null) {
      const tree4 = expand({ type: page4, props: {}, children: [] })
      const nodes4 = collect(tree4)
      const byClass4 = new Map()
      for (const node of nodes4) {
        const cls = node.props && node.props.className
        if (typeof cls === 'string') byClass4.set(cls, (byClass4.get(cls) || 0) + 1)
      }
      check((byClass4.get('dmt-presetList') || 0) === 1, '有方案时渲染列表')
      check((byClass4.get('dmt-preset') || 0) === 2, '渲染 2 条方案', String(byClass4.get('dmt-preset') || 0))
      check((byClass4.get('dmt-empty') || 0) === 0, '有方案时不显示空态')
      check((byClass4.get('dmt-presetDot') || 0) === 10, '每条方案 5 个色点 × 2', String(byClass4.get('dmt-presetDot') || 0))

      /* 点「载入」应写回 surface / accent / custom 三个字段。 */
      const loadBtns = nodes4.filter(
        (node) => node.type === 'button' && node.props.className === 'dmt-miniBtn' && String(node.props.children) === '载入',
      )
      check(loadBtns.length === 2, '2 个「载入」按钮', String(loadBtns.length))
      if (loadBtns.length > 0) {
        const before = writes.length
        loadBtns[0].props.onClick()
        check(writes.length === before + 1, '点载入触发写盘')
        const ops = writes[writes.length - 1] || []
        const surfaceOp = ops.find((op) => op.path && op.path[0] === 'surface')
        const accentOp = ops.find((op) => op.path && op.path[0] === 'accent')
        const customOp = ops.find((op) => op.path && op.path[0] === 'custom')
        check(surfaceOp !== undefined && surfaceOp.value === 'deep', '载入写回 surface=deep', surfaceOp ? surfaceOp.value : 'n/a')
        check(accentOp !== undefined && accentOp.value === 'blue', '载入写回 accent=blue', accentOp ? accentOp.value : 'n/a')
        check(customOp !== undefined && JSON.parse(customOp.value)['palette.fg'] === '#E0E8F0', '载入写回自定义覆盖')
      }

      /* 点「删除」应把该方案从 presets 里移除。 */
      const deleteBtns = nodes4.filter(
        (node) => node.type === 'button' && node.props.className === 'dmt-miniBtn' && String(node.props.children) === '删除',
      )
      check(deleteBtns.length === 2, '2 个「删除」按钮', String(deleteBtns.length))
      if (deleteBtns.length > 0) {
        const before = writes.length
        deleteBtns[0].props.onClick()
        check(writes.length === before + 1, '点删除触发写盘')
        const ops = writes[writes.length - 1] || []
        const presetOp = ops.find((op) => op.path && op.path[0] === 'presets')
        check(presetOp !== undefined, '写盘内容含 presets 字段')
        if (presetOp !== undefined) {
          const remaining = JSON.parse(presetOp.value)
          check(Array.isArray(remaining) && remaining.length === 1, '删除后只剩 1 套方案', String(remaining.length))
          check(remaining[0].name === '低对比', '删掉的是第一条（夜蓝）', remaining[0] ? remaining[0].name : 'n/a')
        }
      }
    }
  }

  /* ---- 防回弹：写未落地时宿主推旧快照，不得倒灌新值 ----
     这是用户报的 bug："保存一个方案之后再调整它，会时不时自己加载回原来的配置"。
     竞态：mutate 的 promise 还没 resolve，宿主镜像的任何更新（重连/别的命名空间
     写盘）都触发订阅 → 旧实现直接 adopt(旧快照) 把刚提交的值倒回去。
     修复：pendingWrites > 0 期间 adopt 整体跳过。 */
  {
    let captured5 = null
    const fakeWindow5 = {
      __ModuleLoader__: { load: (definition) => { captured5 = definition } },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    }
    ReactImpl = createFakeReact()
    const source5 = readFileSync(join(root, 'client.js'), 'utf8')
    const run5 = new Function('window', 'document', 'require', 'setTimeout', 'clearTimeout', 'console', source5)
    run5(fakeWindow5, document, fakeRequire, () => ({ unref() {} }), () => {}, console)
    const exports5 = captured5.factory(fakeRequire)

    const theme5 = {
      ctx: { on: () => () => {} },
      getTheme: () => ({ preference: 'dark', active: { id: 'dark', colorScheme: 'dark', tokens: {} }, revision: 1 }),
      setTheme() {},
      overrideTokens: () => () => {},
    }
    /* 宿主快照：surface 还停在 standard（旧值）。 */
    const hostValue5 = {
      enabled: 'on',
      schemeMode: 'dark',
      surface: 'standard',
      accent: 'teal',
      syntax: 'on',
      prose: 'on',
      proseBoost: 'soft',
      proseColors: '',
      custom: '',
      presets: '',
      rowHighlight: 'on',
      rowColor: '#7EE787',
      summaryColor: '#FAC863',
      rowVariants: '["write","edit","bash","summary","turn"]',
    }
    let notifyHostUpdate = null
    let resolveMutate = null
    /** 已发出但还没"落地"的写：resolve 时才并进宿主快照（真实宿主的顺序）。 */
    let inflightOps = []
    const form5 = {
      getSnapshot: () => ({ status: 'ready', value: { ...hostValue5 } }),
      subscribe(handler) {
        notifyHostUpdate = handler
        return () => {}
      },
      /* 返回一个**不立即 resolve** 的 promise，模拟写还在路上；
         此刻宿主镜像保持旧值 —— 这正是旧代码 adopt 出 bug 的窗口。 */
      mutate(ops) {
        inflightOps = ops
        return new Promise((resolve) => {
          resolveMutate = () => {
            for (const op of inflightOps) {
              if (op.op === 'set' && Array.isArray(op.path)) hostValue5[op.path[0]] = op.value
            }
            resolve()
          }
        })
      },
    }
    const forms5 = {
      describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'mariana-theme' }] } }) }),
      get: (ns) => (ns === 'mariana-theme' ? form5 : { getSnapshot: () => ({ status: 'unavailable' }) }),
    }
    let page5 = null
    const slots5 = {
      inject: (name, factory) => factory(),
      register: (meta, component) => {
        if (meta.name === 'settings.section') page5 = component
        return () => {}
      },
    }
    const ctx5 = {
      slots: slots5,
      theme: theme5,
      configForms: forms5,
      effect: (factory) => { factory() },
      on: () => () => {},
      get: (name) => (name === 'slots' ? slots5 : name === 'theme' ? theme5 : name === 'configForms' ? forms5 : undefined),
    }
    exports5.apply(ctx5)
    check(page5 !== null, '防回弹场景：设置页已注册')
    check(typeof notifyHostUpdate === 'function', '防回弹场景：宿主订阅已建立')

    if (page5 !== null && typeof notifyHostUpdate === 'function') {
      /* 0. 宿主侧新增一套方案并推一次更新 → 插件 adopt 到 presets。 */
      const savedPresets5 = [{ name: '夜蓝', at: 1700000000000, surface: 'deep', accent: 'blue', custom: {} }]
      hostValue5.presets = JSON.stringify(savedPresets5)
      notifyHostUpdate()
      /* 1. 载入"夜蓝"方案（surface=deep）→ mutate 发出，promise 未落地。 */
      const tree5 = expand({ type: page5, props: {}, children: [] })
      const loadBtn = collect(tree5).find(
        (node) => node.type === 'button' && node.props.className === 'dmt-miniBtn' && String(node.props.children) === '载入',
      )
      check(loadBtn !== undefined, '防回弹场景：找到载入按钮')
      if (loadBtn !== undefined) {
        loadBtn.props.onClick()
        /* 背景变体是色块（dmt-swatch），不是分段按钮；aria-pressed 反映当前值。 */
        const pressedDeep = () => {
          const tree = expand({ type: page5, props: {}, children: [] })
          const swatches = collect(tree).filter((node) => node.props && node.props.className === 'dmt-swatch')
          /* 前三个是背景变体：standard / deep / dim（title 以标签开头）。 */
          const deep = swatches.find((node) => String(node.props.title || '').startsWith('深 '))
          return deep ? deep.props['aria-pressed'] : 'n/a'
        }
        /* 2. 写还在路上时，宿主推一次更新（旧实现会在这里 adopt 把 surface 倒回 standard）。 */
        notifyHostUpdate()
        check(pressedDeep() === 'true', '写未落地 + 宿主推旧快照：surface 保持 deep（不回弹）', String(pressedDeep()))
        /* 3. promise 落地后再推一次 → 此时宿主快照已是新值，adopt 应安静通过。 */
        if (resolveMutate !== null) resolveMutate()
        notifyHostUpdate()
        check(pressedDeep() === 'true', '写落地后：值稳定为 deep', String(pressedDeep()))
      }
    }
    /* ctx5 是手写字面量，没有 dispose；本场景只验竞态，不留全局句柄需要回收。 */
  }

  const failed = results.filter((result) => !result.ok)
  console.log('─'.repeat(52))
  if (failed.length > 0) {
    console.log(`✗ ${failed.length}/${results.length} 项失败`)
    process.exit(1)
  }
  console.log(`✓ ${results.length} 项全部通过`)
}

main()
