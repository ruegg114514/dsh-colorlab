#!/usr/bin/env node
/**
 * 等高线背景测试 —— 移植自 dsh-theme-endfield（MIT）的核心管线。
 *
 * 引擎是纯计算（无 DOM），所以 marching squares 的几何不变量可以离线断言：
 *   A. 确定性：同种子同尺寸 → 逐字节相同的路径（resize 不洗地形的前提）
 *   B. 覆盖率：8×5 网格每格都有线穿过（accept-or-reroll 验证器的效果）
 *   C. 去屑：没有碎屑路径（可见长度 / 小环阈值生效）
 *   D. 环闭合：闭合路径首尾重合（closePath 的判据依赖它）
 *   E. 视口自适应：窄窗降密度（step/levels/bumps 单调）
 *   F. 描边色：8 位 hex、深浅两档、非法输入回落
 *   G. draw 管线：假 ctx 数一遍 moveTo/bezier/stroke，一笔总描
 *   H. 接线：OPTIONS 第三项 / 背景层互斥 / blur 归零 / teardown 停循环
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(condition, label, detail) {
  if (condition) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function loadPlugin() {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: { load: (d) => { captured = d } },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  }
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const fakeRequire = (id) => {
    if (id === 'react') {
      return {
        createElement: (...a) => ({ args: a }), Fragment: 'f',
        useSyncExternalStore: (s, g) => g(), useState: (v) => [v, () => {}],
      }
    }
    throw new Error('unexpected require: ' + id)
  }
  new Function('window', 'document', 'require', 'setTimeout', source)(
    fakeWindow, undefined, fakeRequire, () => ({ unref() {} }),
  )
  if (captured === null) throw new Error('client.js 没有注册 bundle')
  return captured.factory(fakeRequire)
}

const t = loadPlugin().__test
const src = readFileSync(join(root, 'client.js'), 'utf8')
const { createContourEngine, contourStrokeColor, contourStepFor, contourLevelsFor, contourBumpsFor } = t

const W = 1280
const H = 800

/** 路径的可见长度（画布内部分）。 */
const visibleLength = (p, w, h) => {
  let vis = 0
  for (let k = 2; k < p.length; k += 2) {
    const x = p[k], y = p[k + 1]
    const px = p[k - 2], py = p[k - 1]
    const inside = x >= 0 && x <= w && y >= 0 && y <= h
    const prevInside = px >= 0 && px <= w && py >= 0 && py <= h
    if (inside && prevInside) vis += Math.hypot(x - px, y - py)
  }
  return vis
}

console.log('')
console.log('dsh-colorlab 等高线测试')
console.log('─'.repeat(60))

/* A. 确定性 */
console.log('  A. 确定性')
{
  const e1 = createContourEngine(0xBADF00D)
  const e2 = createContourEngine(0xBADF00D)
  e1.build(W, H)
  e2.build(W, H)
  e1.extract(0)
  e2.extract(0)
  const s1 = JSON.stringify(e1.paths.map((p) => Array.from(p)))
  const s2 = JSON.stringify(e2.paths.map((p) => Array.from(p)))
  check(s1 === s2, '同种子 → 逐字节相同的地形（resize 复现的前提）')
  const e3 = createContourEngine(0x1234ABCD)
  e3.build(W, H)
  e3.extract(0)
  check(JSON.stringify(e3.paths.map((p) => Array.from(p))) !== s1, '不同种子 → 不同地形')
}

/* B/C/D. 覆盖率 + 去屑 + 环闭合（用同一个构建结果） */
console.log('  B. 覆盖率 / C. 去屑 / D. 环闭合')
{
  const engine = createContourEngine(0x5EED4242)
  engine.build(W, H)
  engine.extract(0)
  const paths = engine.paths
  check(paths.length > 40, '路径数量合理（21 电平 × 多条）', String(paths.length))
  /* B：8×5 网格每格至少有一条可见穿线 */
  const GX = 8, GY = 5
  let emptyCells = 0
  for (let gy = 0; gy < GY; gy++) {
    for (let gx = 0; gx < GX; gx++) {
      const x0 = gx * W / GX, x1 = (gx + 1) * W / GX
      const y0 = gy * H / GY, y1 = (gy + 1) * H / GY
      let ink = 0
      for (const p of paths) {
        for (let k = 2; k < p.length; k += 2) {
          const x = p[k], y = p[k + 1]
          const px = p[k - 2], py = p[k - 1]
          if ((x >= x0 && x < x1 && y >= y0 && y < y1)
            || (px >= x0 && px < x1 && py >= y0 && py < y1)) ink += Math.hypot(x - px, y - py)
        }
      }
      if (ink < 20) emptyCells += 1
    }
  }
  check(emptyCells === 0, '8×5 覆盖率网格无空格（验证器生效）', emptyCells + ' 空格')
  /* C：无碎屑 —— 每条路径可见长度 ≥ 40px（keep 阈值） */
  const specks = paths.filter((p) => visibleLength(p, W, H) < 39)
  check(specks.length === 0, '无碎屑路径（可见长度全部 ≥40px）', specks.length + ' 条')
  /* D：环首尾重合 */
  let rings = 0, brokenRings = 0
  for (const p of paths) {
    const n = p.length - 2
    if (n >= 2 && (p[0] - p[n]) ** 2 + (p[1] - p[n + 1]) ** 2 < 4) {
      rings += 1
      if (p[0] !== p[n] || p[1] !== p[n + 1]) brokenRings += 1
    }
  }
  check(rings > 0, '存在闭合环（岛）', rings + ' 条')
  check(brokenRings === 0, '环的重复顶点精确（closePath 判据成立）')
  /* 顶点都在画布附近（-0.1..1.1 over-scan + 岛半径）*/
  let far = 0
  for (const p of paths) {
    for (let k = 0; k < p.length; k += 2) {
      if (p[k] < -W * 0.3 || p[k] > W * 1.3 || p[k + 1] < -H * 0.3 || p[k + 1] > H * 1.3) far += 1
    }
  }
  check(far === 0, '无离谱顶点（全在 over-scan 范围内）', far + ' 个')
}

/* E. 视口自适应 */
console.log('  E. 视口自适应')
{
  /* 🔧 2026-10-23：CONTOUR_MAX_CELLS 60000 → 24000（1080p 的 6 万格上限
   * 从来没生效过，等于最常见的分辨率永远拿到最贵档）。 */
  check(contourStepFor(1280, 800) === 7, '桌面 1280×800 → step 7（24000 格上限生效）', String(contourStepFor(1280, 800)))
  check(contourStepFor(1920, 1080) === 10, '1080p → step 10（这才是成本封顶的真正目的）', String(contourStepFor(1920, 1080)))
  check(contourStepFor(4000, 2400) > 6, '超大窗 step 加粗（成本封顶）', String(contourStepFor(4000, 2400)))
  check(contourLevelsFor(1280, 800) === 20, '桌面 20 电平')
  check(contourLevelsFor(360, 700) < contourLevelsFor(1280, 800), '窄窗电平更少')
  check(contourBumpsFor(1280, 800) === 22, '桌面 22 岛')
  check(contourBumpsFor(360, 700) < 22, '窄窗岛更少')
}

/* E2. 成本自适应降级（真机"开等高线好卡"的回归锁） */
console.log('  E2. 成本降级')
{
  /* build 接受 step 覆盖：粗化生效、不得低于起步地板、封顶 40 */
  const e = createContourEngine(0xFEED0001)
  e.build(1920, 1080, 12)
  check(e.geometry.step === 12, 'step 覆盖生效（降级路径可用）', String(e.geometry.step))
  e.build(1920, 1080, 2)
  check(e.geometry.step === contourStepFor(1920, 1080),
    '覆盖值低于起步时钳回地板（画质下限）', String(e.geometry.step))
  e.build(1920, 1080, 999)
  check(e.geometry.step === 40, '封顶 40（再粗就不是地形了）', String(e.geometry.step))
  /* 降级后地形仍然通过覆盖率验证（粗网格不是把验证器关掉） */
  e.build(1920, 1080, 10)
  e.extract(0)
  check(e.paths.length > 30, 'step=10 仍有完整地形', String(e.paths.length) + ' 条')
  /* 接线：帧成本对账 + 连续超预算 + step+2 重建 + resize 重置 */
  check(/contourTune\(cost\)/.test(src) && /geometry\.step \+ 2/.test(src),
    '动画循环量 extract+draw 全成本，超预算 step+2 重建')
  check(/CONTOUR_BUDGET_FRAMES/.test(src), '连续 N 帧超预算才降（防偶发抖动误伤）')
  /* 🔧 2026-10-23：降档值必须**跨重建保留**。旧写法在 contourScheduleBuild 里
   * contourStepNow = 0，于是降完立刻被 resize/阶梯拉回最贵档。
   * 注意这条是负向锁（正向匹配 `contourStepNow = 0` 会命中 `let contourStepNow = 0`
   * 声明行，变成什么都不锁的空断言）。 */
  check(!/function contourScheduleBuild[\s\S]{0,900}contourStepNow = 0/.test(src),
    '重建/resize 不再清零降档档位（学到的档位跨 resize 保留）')
  check(/contourStepNow > 0 \? contourStepNow : floor/.test(src),
    '阶梯终点 = max(出厂地板, 学到的降档值)（降级成果不被 resize 抹掉）')
  check(/Math\.min\(40, Math\.max\(floor/.test(src),
    '地板/封顶钳制（覆盖值不许击穿起步网格）')

  /* 🔧 2026-10-23：新增 8 个可调项（设置页「等高线高级」折叠块）。
   * 这一组锁的是「设置真的能传到引擎」—— 光有 UI 不接线是最容易漏的。 */
  {
    /* 1. 地形密度：三档必须真的改变网格步长。 */
    const eFine = createContourEngine(0x1234), eCoarse = createContourEngine(0x1234)
    eFine.setLook({ maxCells: 40000 })
    eCoarse.setLook({ maxCells: 14000 })
    eFine.build(1920, 1080)
    eCoarse.build(1920, 1080)
    check(eFine.geometry.step < eCoarse.geometry.step,
      '地形密度：细档的 step 比粗档小（密度真的影响网格）',
      'fine=' + eFine.geometry.step + ' coarse=' + eCoarse.geometry.step)

    /* 2. 层数：12 层和 30 层必须产生不同数量的路径。 */
    const eFew = createContourEngine(0x5678), eMany = createContourEngine(0x5678)
    eFew.setLook({ levelsWanted: 12 }); eFew.build(1280, 800); eFew.extract(0)
    eMany.setLook({ levelsWanted: 30 }); eMany.build(1280, 800); eMany.extract(0)
    check(eMany.paths.length > eFew.paths.length,
      '密集程度：30 层的路径比 12 层多',
      'few=' + eFew.paths.length + ' many=' + eMany.paths.length)

    /* 3. 起伏幅度：改振幅必须真的改变几何。 */
    const eFlat = createContourEngine(0x9ABC), eHilly = createContourEngine(0x9ABC)
    eFlat.setLook({ relief: 0.4 }); eFlat.build(1024, 768); eFlat.extract(0)
    eHilly.setLook({ relief: 1.6 }); eHilly.build(1024, 768); eHilly.extract(0)
    check(JSON.stringify(eFlat.paths) !== JSON.stringify(eHilly.paths),
      '地形起伏：不同幅度产生不同地形几何')

    /* 4. 漂移幅度 0 时地形完全静止（相位推进也不再改几何）。 */
    const eStill = createContourEngine(0xDEF0)
    eStill.setLook({ drift: 0 })
    eStill.build(800, 600); eStill.extract(0)
    const a0 = JSON.stringify(eStill.paths)
    eStill.extract(1.7)
    check(JSON.stringify(eStill.paths) === a0,
      '漂移幅度 0：相位推进后地形几何完全不变')

    /* 5. 线条粗细 / 浓度 / 自定义色 走 drawTo 与 contourStrokeColor。 */
    const dctx = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {},
      closePath() {}, stroke() {}, setTransform() {}, strokeStyle: '', lineWidth: -1, lineJoin: '',
      canvas: { width: 800, height: 600 } }
    const eW = createContourEngine(0x1111)
    eW.setLook({ lineWidth: 2 })
    eW.build(800, 600); eW.extract(0); eW.draw(dctx, '#5FB3B38c')
    check(dctx.lineWidth === 2, '线条粗细：档位真的写进 ctx.lineWidth', String(dctx.lineWidth))

    /* 6. setSeed 必须换地形（「换一张地形」按钮的底层）。 */
    const eSeed = createContourEngine(0x2222)
    eSeed.build(640, 480); eSeed.extract(0)
    const before = JSON.stringify(eSeed.paths)
    eSeed.setSeed(0x999999); eSeed.build(640, 480); eSeed.extract(0)
    check(JSON.stringify(eSeed.paths) !== before, 'setSeed 换种子 → 换一张地形')

    /* 7. 接线检查：worker 消息带 look/seed，主线程走 setLook。 */
    check(/look: contourLookNow\(\)/.test(src), 'worker 消息带 look（观感档位能进 worker）')
    check(/contourEngine\.setLook\(contourLookNow\(\)\)/.test(src),
      '主线程每帧推 look 进引擎')
    check(/engine\.setLook\(m\.look\)/.test(src), 'worker 侧消费 look')
    check(/function contourReroll/.test(src) && /contourSeed = contourNewSeed\(\)/.test(src),
      '「换一张地形」重掷种子并重建')
  }

  /* 🔧 2026-10-23（用户报"分布相关设置要重新加载才生效"）：
   * 观感签名必须把分布档位算进去，否则 contourApplySwitches 直接 return，
   * 改了密度/层数/起伏/漂移既不重建也不重画，只能刷新页面。 */
  {
    check(/function contourLookSig\(\)/.test(src), '有独立的观感签名函数')
    /* 签名里必须真的含这几个档位（否则改了不触发重画）。 */
    const sigFn = src.slice(src.indexOf('function contourLookSig'), src.indexOf('function contourLookSig') + 600)
    for (const key of ['relief', 'drift', 'levelsWanted', 'maxCells', 'lineWidth']) {
      check(sigFn.includes('l.' + key), '观感签名包含 ' + key + '（改了会重画/重建）')
    }
    check(/const lookSig = contourLookSig\(\)/.test(src)
      && /'\|' \+ colorSig \+ '\|' \+ lookSig/.test(src),
      'contourApplySwitches 的签名里带上了观感档位')
    check(/function contourApplyLook\(\)/.test(src), '有观感变更处理函数')
    check(/const needsRebuild = prevMax !== String\(l\.maxCells\)/.test(src),
      '只有密度（网格上限）变了才重建，其余只重画（省掉几十毫秒 build）')
    check(/contourLookRebuildTimer = setTimeout[\s\S]{0,300}CONTOUR_LOOK_DEBOUNCE/.test(src),
      '重建走防抖（拖滑块连续触发只建最后一次）')
    check(/contourLastField = -1\s*\n\s*contourRefresh\(true\)/.test(src),
      '纯观感变更：重置节流并立即重画一帧')
  }

  /* 🔧 2026-10-23：Chaikin 遍数按「是否动画」分开（动画 1 / 静止 2）。 */
  {
    const es = createContourEngine(0xBEEF)
    check(es.smooth === 1, '引擎默认动画态 Chaikin 1 遍（省光栅）', String(es.smooth))
    check(es.setSmooth(2) === 2 && es.smooth === 2, '静止态可切回 2 遍（保画质）')
    es.setSmooth(999)
    check(es.smooth === 3, 'setSmooth 钳制到 0..3', String(es.smooth))
  }

  /* 🔧 2026-10-23：候选 scratch 跨 attempt 复用 —— 必须仍然逐字节确定，
   * 且两个引擎不能串味（否则"同种子确定性"这条从此测不出回归）。 */
  {
    const ed = createContourEngine(0xDEADBEE)
    ed.build(1024, 768)
    ed.extract(0)
    const once = JSON.stringify(ed.paths.map((p) => Array.from(p)))
    ed.build(1024, 768)
    ed.extract(0)
    check(JSON.stringify(ed.paths.map((p) => Array.from(p))) === once,
      '同一引擎重复 build → 逐字节相同（scratch 复用无残留状态）')
    check(ed.paths.length > 20, 'scratch 复用后地形仍有完整路径', String(ed.paths.length) + ' 条')
    const ea = createContourEngine(0x1111), eb = createContourEngine(0x2222)
    ea.build(640, 480); eb.build(640, 480)
    ea.extract(0); eb.extract(0)
    check(JSON.stringify(ea.paths.map((p) => Array.from(p)))
      !== JSON.stringify(eb.paths.map((p) => Array.from(p))),
      '两个引擎互不串味（scratch 是每引擎闭包，不是模块级共享）')
  }
  check(/const ensureField = /.test(src) && /f\.F\.fill\(0\)/.test(src),
    '候选复用 scratch：每轮只重写参数 + 清场，不再每轮分配数 MB')
  check(/appliedSalt !== bestSalt/.test(src),
    'best 布局在循环后重放（scratch 只有一个，不能持有候选引用）')
  check(/if \(contourReducedKnown\) return contourReducedValue/.test(src),
    'reduced-motion 查询结果被缓存（不再每帧 matchMedia）')
}

/* F. 描边色 */
console.log('  F. 描边色')
{
  check(contourStrokeColor('#5FB3B3', true) === '#5FB3B38c', '深色 = 强调色 + 55% alpha')
  check(contourStrokeColor('#5FB3B3', false) === '#5FB3B3b3', '浅色 = 强调色 + 70% alpha')
  check(contourStrokeColor('garbage', true) === '#5FB3B38c', '非法色回落 teal')
  check(contourStrokeColor('#F9AE58', true) === '#F9AE588c', '橙强调色跟随')
}

/* G. draw 管线（假 ctx） */
console.log('  G. 描边管线')
{
  const engine = createContourEngine(0xABCD0123)
  engine.build(W, H)
  engine.extract(0)
  const calls = { moveTo: 0, lineTo: 0, bezier: 0, closePath: 0, stroke: 0, beginPath: 0, clear: 0 }
  const fakeCtx = {
    canvas: { width: W, height: H },
    setTransform() {}, clearRect() { calls.clear += 1 },
    beginPath() { calls.beginPath += 1 },
    moveTo() { calls.moveTo += 1 },
    lineTo() { calls.lineTo += 1 },
    bezierCurveTo() { calls.bezier += 1 },
    closePath() { calls.closePath += 1 },
    stroke() { calls.stroke += 1 },
    set strokeStyle(v) { this._s = v }, get strokeStyle() { return this._s },
    set lineWidth(v) { this._w = v }, get lineWidth() { return this._w },
    set lineJoin(v) { this._j = v }, get lineJoin() { return this._j },
  }
  engine.draw(fakeCtx, '#5FB3B38c')
  check(calls.stroke === 1, '一笔总描（stroke 恰好 1 次 → 交叠不变黑）', String(calls.stroke))
  check(calls.bezier > 100, '平滑生效（三次样条段数量可观）', String(calls.bezier))
  check(calls.beginPath === 1, '单一路径累积')
  check(calls.clear === 1, '每帧先清屏')
  check(fakeCtx._s === '#5FB3B38c', '描边色传入生效')
}

/* H. 接线（源码级） */
console.log('  H. 接线')
{
  check(src.includes("value: 'contour'"), 'OPTIONS.glassBackground 有第三选项')
  check(/state\.glassBackground === 'contour'/.test(src), 'syncGlassSheet 识别 contour 模式')
  check(/const blur = contourActive \? 0 : Math\.max/.test(src), 'contour 模式壁纸层不加 blur')
  check(/if \(contourActive\) \{[\s\S]{0,200}style\.background = solid/.test(src),
    'contour 模式背景层铺实色 base（线画在它上面）')
  check(/syncContourLayer\(false\)[\s\S]{0,80}syncWallpaperLayer\(false\)/.test(src),
    'teardown 先停等高线（rAF 不泄漏）再拆背景层')
  check(/function destroyContourLayer/.test(src) && /contourRo\.disconnect/.test(src),
    'destroy 停循环 + 断 ResizeObserver')
  check(/window\.addEventListener\('blur'/.test(src) && /visibilitychange/.test(src),
    '失焦/隐藏暂停动画（上游的省电纪律）')
  /* 🔧 滚动让路的最终裁决（用户：滑动必须丝滑，优先级高于背景动画）：
   * 主线程路径滚动期间**完全停帧**（零任务=物理上不可能卡）；
   * 降频方案（150ms 仍插 6fps 任务）被真机否决。 */
  check(/document\.addEventListener\('scroll', onScroll, \{ capture: true, passive: true \}\)/.test(src),
    '滚动监听：捕获+passive 覆盖页面内所有滚动容器')
  check(/contourScrollPaused = true\s*\n\s*contourStopLoop\(\)/.test(src),
    '主线程路径：滚动一开始就停循环（丝滑优先）')
  check(/function contourOnScroll\(\) \{[\s\S]{0,300}if \(contourWorker !== null\) return/.test(src),
    'worker 路径：滚动完全不干预（动画照常漂移）')
  check(/}, 140\)/.test(src) && /contourScrollTimer = setTimeout/.test(src),
    '停滚 140ms 后恢复（此刻没有手势在抢主线程）')
  check(/destroyContourLayer[\s\S]{0,1800}contourScrollTimer = null/.test(src),
    '销毁时清挂起的恢复计时器')
  /* 🔧 2026-10-23：滚动恢复不再清零超预算计数 —— 否则"边读边滚"的用户
   * 永远凑不满连续 3 帧，永远停在最贵档（这是"开着等高线一直卡"的根因之一）。 */
  check(!/function contourOnScroll[\s\S]{0,1200}contourOverBudget = 0/.test(src),
    '滚动恢复不清零超预算计数（否则降级永不收敛）')
  check(/contourPhase \+= CONTOUR_PHASE_STEP \* contourSpeedValue\(\)/.test(src),
    '相位只按名义步进（防抽搐），速度是用户档位（静止/1/2/4）')
  check(/if \(contourSpeedValue\(\) <= 0\) return false/.test(src),
    '速度=静止 档：零 rAF，只画一帧')
  check(/CONTOUR_DUTY/.test(src) && /contourLastCost/.test(src),
    'duty-cycle 让位（忙时慢放不卡主线程）')

  /* 🔧 真机"每一下滑动开头顿一次"（静止档不顿 → 罪在动画任务本身）：
   * 主线程路径的预算必须是 60Hz 尺度（用户的手按 60Hz 读输入），
   * 不是 24fps 尺度；降级重建绝不能在 rAF 回调里同步跑。 */
  check(/CONTOUR_MAIN_BUDGET = 8/.test(src),
    '主线程动画预算 = 8ms（半张 60Hz 帧），不是旧的 20.8ms')
  check(/if \(costMs <= CONTOUR_MAIN_BUDGET\)/.test(src),
    'contourTune 用主线程预算判超')
  /* 🔧 2026-10-23：setTimeout(fn, 0) 只是把长任务挪到下一个立即执行的宏任务，
   * 从来不是"空闲"。改用 requestIdleCallback（带 typeof 守卫 + setTimeout 兜底）。 */
  check(/requestIdleCallback/.test(src) && /typeof requestIdleCallback === 'function'/.test(src),
    '降级重建推迟到空闲回调（带 typeof 守卫，旧 Chromium / Node 测试环境兜底）')
  check(/contourScheduleIdle\([\s\S]{0,200}contourEngine\.build/.test(src),
    '空闲重建里才跑 32 轮验证器（不在 rAF 回调里）')
  check(/diag\.contour = 'worker'/.test(src) && /diag\.contour = 'main'/.test(src),
    '后端可见：worker 握手/main 回落都记进 diag（副标题显示，不再盲猜）')
  check(/status\.contour === 'worker'/.test(src) && /主线程渲染/.test(src),
    '设置页副标题报告实际后端')

  /* 🔧 真机"启动那一下很难受"的回归锁：建层帧不许做全场计算。 */
  check(/CONTOUR_BOOT_DELAY = 350/.test(src),
    '首建延迟让开启动风暴（首屏渲染/字体/壁纸 fetch）')
  check(/CONTOUR_RESIZE_DEBOUNCE = 120/.test(src),
    'resize 防抖（拖动窗口不再每次 RO 回调都重建）')
  check(/contourLadderStage[\s\S]{0,700}contourEngine\.build\(w, h, [\w$.()\s]+\)/.test(src)
    && /contourRefresh\(true\)/.test(src),
    '阶梯每档独立任务：建一档画一档，任务之间主线程可呼吸')
  check(/gen !== contourLadderGen/.test(src),
    '生成号掐死旧阶梯（连拖窗口不会几条阶梯同时爬）')
  check(/destroyContourLayer[\s\S]{0,700}contourLadderGen \+= 1/.test(src),
    '销毁时阶梯全部停摆（在途回调自我作废 + timer 清除）')
  check(!/function contourSizeTo\(delayMs\) \{[\s\S]{0,900}contourEngine\.build/.test(src),
    'contourSizeTo 不再同步 build（挂载帧零全场计算）')
}

/* I. Worker 后端（source 字符串 eval 驱动 —— 真机同一条消息泵） */
console.log('  I. Worker 后端')
{
  const source = t.contourWorkerSource()
  check(typeof source === 'string' && source.length > 20000, 'source 生成（引擎代码序列化进 worker）',
    String(source.length) + ' 字符')
  check(source.includes('const CONTOUR_STEP = 6') && source.includes('self.onmessage'),
    '常数注入 + 消息泵存在')
  check(!source.includes('undefined,') && !/\bNaN\b/.test(source),
    '注入的常数里没有 undefined/NaN（kv 表漂移会静默毁掉 worker）')
  check(source.includes('function createContourEngine') || source.includes('createContourEngine(seedValue)'),
    '引擎函数体被带进 source（String(fn) 序列化生效）')

  /* 假 worker 环境：fake self 收消息、假 OffscreenCanvas 数绘制调用。 */
  const out = []
  const draws = { stroke: 0, clear: 0 }
  const fakeCtx = {
    setTransform() {}, clearRect() { draws.clear += 1 }, beginPath() {}, moveTo() {}, lineTo() {},
    bezierCurveTo() {}, closePath() {}, stroke() { draws.stroke += 1 },
    strokeStyle: '', lineWidth: 0, lineJoin: '',
  }
  const fakeCanvas = { width: 0, height: 0, getContext: () => fakeCtx }
  const fakeSelf = { postMessage: (m) => out.push(m) }
  const runner = new Function('self', 'performance', source)
  runner(fakeSelf, { now: () => Date.now() })

  /* init → ready，并且真画了一帧 */
  fakeSelf.onmessage({ data: {
    op: 'init', canvas: fakeCanvas, seed: 0xBADF00D,
    w: 800, h: 600, dpr: 1, step: 0, phase: 0, color: '#5FB3B38c',
  } })
  const ready = out.find((m) => m.op === 'ready')
  check(ready !== undefined, 'init → ready', out.map((m) => m.op).join(','))
  check(ready !== undefined && ready.step === 6, 'step:0 → 起步档 6', ready ? String(ready.step) : 'n/a')
  check(draws.stroke === 1 && draws.clear === 1, 'init 即出图（一帧 draw）',
    'stroke ' + draws.stroke + ' / clear ' + draws.clear)

  /* frame → done + 成本回报 */
  out.length = 0
  fakeSelf.onmessage({ data: { op: 'frame', phase: 0.013, color: '#5FB3B38c' } })
  const done = out.find((m) => m.op === 'done')
  check(done !== undefined && typeof done.cost === 'number' && done.cost >= 0,
    'frame → done（cost 回报进主线程预算对账）', done ? done.cost.toFixed(1) + 'ms' : 'n/a')
  check(draws.stroke === 2, 'frame 又画一帧')

  /* recolor：只画不提取（cost 0 不污染降级对账） */
  out.length = 0
  fakeSelf.onmessage({ data: { op: 'recolor', color: '#F9AE588c' } })
  const doneR = out.find((m) => m.op === 'done')
  check(doneR !== undefined && doneR.cost === 0, 'recolor → done cost:0（不触发降级）')

  /* rebuild（尺寸/降级共用）：step 显式给档 */
  out.length = 0
  fakeSelf.onmessage({ data: { op: 'rebuild', w: 1200, h: 700, dpr: 1, step: 10, phase: 0.1, color: '#5FB3B38c' } })
  const ready2 = out.find((m) => m.op === 'ready')
  check(ready2 !== undefined && ready2.step === 10, 'rebuild step:10 → 回报实际档位',
    ready2 ? String(ready2.step) : 'n/a')

  /* 非法路径：未 init 就 frame → 引擎是 null，抽帧抛错必须被 catch
   * 成 error 消息回报（worker 静默死亡是最难查的故障）。 */
  const out2 = []
  const fakeSelf2 = { postMessage: (m) => out2.push(m) }
  const runner2 = new Function('self', 'performance', source)
  runner2(fakeSelf2, { now: () => Date.now() })
  fakeSelf2.onmessage({ data: { op: 'frame', phase: 0, color: '#5FB3B38c' } })
  check(out2.some((m) => m.op === 'error'), '未 init 就 frame → error 回报（主线程据此降级）',
    out2.map((m) => m.op).join(','))
  check(/worker\.postMessage\(\{[\s\S]{0,900}\}, \[offscreen\]\)/.test(src),
    'init 消息带 transfer 列表（OffscreenCanvas 不 transfer 会 DataCloneError —— 真机"worker 被拦截"的真凶）')
  check(!/canvas: contourCanvas\.transferControlToOffscreen\(\)/.test(src),
    '不许回到"transfer 结果只放消息体"的旧写法')
}

console.log('')
if (failures > 0) {
  console.log(`✗ ${failures} 项失败`)
  process.exit(1)
}
console.log('✓ 全部通过')
