/* ============================================================
 * ColorLab 浮层自动捕获脚本
 *
 * 为什么需要它：悬浮窗是「悬停 800ms 后出现、鼠标移开就消失」的，
 * 没法一边悬停一边去控制台跑脚本。所以这个脚本会**持续监控 15 秒**，
 * 自动记录所有短暂出现过的浮层元素。
 *
 * 用法：
 *   1. 复制全部内容，粘到 DevTools 控制台，回车
 *   2. 脚本开始监控（控制台会显示「开始监控」）
 *   3. 立刻回到界面，把鼠标悬停在「右侧历史记录」那个条目上，
 *      等悬浮窗出现，再停留 2 秒
 *   4. 等控制台打印出结果（15 秒后自动结束）
 *   5. 把输出复制回来
 * ============================================================ */
(function captureFloats() {
  const seen = new Map()
  const t0 = Date.now()
  const DURATION = 15000

  function snapshot(el) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName,
      cls: String(el.className || '').slice(0, 160),
      role: el.getAttribute('role') || '(none)',
      pos: cs.position,
      z: cs.zIndex,
      w: Math.round(r.width),
      h: Math.round(r.height),
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 70),
      hv: cs.getPropertyValue('--dsw-hovercard-bg').trim(),
      bf: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      radius: cs.borderRadius,
      shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow.slice(0, 70),
      opacity: cs.opacity,
      transform: cs.transform === 'none' ? '' : cs.transform,
      parentCls: String((el.parentElement && el.parentElement.className) || '').slice(0, 100),
    }
  }

  function scan() {
    for (const el of document.querySelectorAll('div,section,aside,ul')) {
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue
      const r = el.getBoundingClientRect()
      if (r.width < 60 || r.height < 25) continue
      /* 只关心「自己带底色」的 —— 纯定位容器不算浮层。 */
      const hasOwnBg = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
        || (cs.backgroundImage && cs.backgroundImage !== 'none')
        || cs.getPropertyValue('--dsw-hovercard-bg').trim() !== ''
      if (!hasOwnBg) continue
      const key = el.tagName + '|' + String(el.className || '') + '|' + Math.round(r.width) + 'x' + Math.round(r.height)
      if (!seen.has(key)) {
        seen.set(key, { count: 0, sample: snapshot(el), el })
      }
      seen.get(key).count += 1
    }
  }

  console.log('%c[ColorLab] 开始监控 15 秒 —— 现在去悬停「右侧历史记录」', 'color:#5FB3B3;font-weight:bold')

  const timer = setInterval(scan, 200)
  scan()

  setTimeout(function () {
    clearInterval(timer)
    scan()

    const list = [...seen.values()].sort((a, b) => b.count - a.count)

    console.log('')
    console.log('%c=== 捕获到 ' + list.length + ' 种浮层 ===', 'font-weight:bold;font-size:14px')
    console.log('')

    list.forEach(function (item, i) {
      const s = item.sample
      console.log('[' + i + '] 出现 ' + item.count + ' 次  ' + s.tag + '  ' + s.w + 'x' + s.h)
      console.log('    class      : ' + s.cls)
      console.log('    role       : ' + s.role + '   z-index=' + s.z + '   opacity=' + s.opacity)
      console.log('    position   : ' + s.pos)
      console.log('    background : ' + s.bg + (s.bgImg ? '  +img:' + s.bgImg : ''))
      console.log('    hovercard  : ' + (s.hv || '(无)'))
      console.log('    backdrop   : ' + s.bf)
      console.log('    radius     : ' + s.radius)
      if (s.shadow) console.log('    shadow     : ' + s.shadow)
      if (s.transform) console.log('    transform  : ' + s.transform)
      console.log('    parent     : ' + (s.parentCls || '(无 class)'))
      console.log('')
    })

    console.log('%c--- 诊断结论 ---', 'font-weight:bold')
    const withHv = list.filter(function (x) { return x.sample.hv !== '' })
    if (withHv.length === 0) {
      console.log('%c没有捕获到任何带 --dsw-hovercard-bg 的元素。', 'color:#F9AE58')
      console.log('说明：那个悬浮窗不是 HoverCard 渲染的，或者监控期间它没出现过。')
      console.log('请确认「右侧历史记录」那个浮层确实打开了，然后重跑本脚本。')
    } else {
      console.log('捕获到 ' + withHv.length + ' 个 HoverCard 元素：')
      withHv.forEach(function (x) {
        console.log('  ' + x.sample.cls)
        console.log('    当前 --dsw-hovercard-bg = ' + x.sample.hv)
        console.log('    当前 backdrop-filter    = ' + x.sample.bf)
      })
      console.log('')
      console.log('%c如果 hovercard 值已经是 rgba(...) 半透明，说明玻璃规则生效了。',
        'color:#99C794')
      console.log('%c如果 backdrop 仍是 none，说明背景半透明了但模糊没生效。',
        'color:#F9AE58')
    }

    /* 暴露到全局，方便二次检查。 */
    window.__colorlabFloats = list.map(function (x) { return x.sample })
    console.log('')
    console.log('%c明细已存到 window.__colorlabFloats，把上面输出复制回来', 'color:#5FB3B3;font-weight:bold')
  }, DURATION)
})()
