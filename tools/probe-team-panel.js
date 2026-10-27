/* ============================================================
 * ColorLab 队友面板探针
 *
 * 用法：
 *   1. 先**点开**那个队友/编队面板（让它保持显示）
 *   2. F12 → Console，粘贴本文件全部内容，回车
 *   3. 把输出整段复制回来
 *
 * 面板有 role="dialog"，理论上早该被玻璃规则命中。
 * 这个探针查的是：到底命中了哪条规则、被谁覆盖了、
 * 还是元素压根不在我们样式表的管辖范围内。
 * ============================================================ */
(function probeTeamPanel() {
  const log = (...a) => console.log(...a)

  /* 找面板：三个特征任选其一 */
  const el = document.querySelector('[data-team-panel]')
    || document.querySelector('[class*="_panel"][role="dialog"]')
    || [...document.querySelectorAll('[role="dialog"]')].find((n) => {
      const cs = getComputedStyle(n)
      return cs.position === 'fixed' && n.getBoundingClientRect().width > 200
    })

  log('%c=== 0. 元素定位 ===', 'font-weight:bold;color:#5FB3B3')
  if (!el) {
    log('%c没找到面板元素 —— 请先点开它再运行本脚本', 'color:#EC5F67;font-weight:bold')
    log('所有 role=dialog 元素：')
    document.querySelectorAll('[role="dialog"]').forEach((n) => {
      const r = n.getBoundingClientRect()
      log('  ' + String(n.className || '').slice(0, 70) + '  ' + Math.round(r.width) + 'x' + Math.round(r.height))
    })
    return
  }
  log('  找到：' + String(el.className).slice(0, 90))
  log('  role = ' + el.getAttribute('role') + '   data-team-panel = ' + el.hasAttribute('data-team-panel'))
  log('  祖先链上有 html[data-dsh-glass]：' + !!el.closest('html[data-dsh-glass]'))
  log('  挂载点（parentElement）：' + el.parentElement.tagName + '.' + String(el.parentElement.className || '').slice(0, 50))

  const cs = getComputedStyle(el)
  log('')
  log('%c=== 1. 计算样式（关键三项）===', 'font-weight:bold;color:#5FB3B3')
  log('  background-color : ' + cs.backgroundColor)
  log('  background-image : ' + cs.backgroundImage.slice(0, 90))
  log('  backdrop-filter  : ' + (cs.backdropFilter || cs.webkitBackdropFilter || 'none'))
  log('  box-shadow       : ' + (cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 70)))
  log('  border           : ' + cs.border)
  log('  opacity          : ' + cs.opacity)
  log('  position / z     : ' + cs.position + ' / ' + cs.zIndex)

  /* 背后到底有什么：backdrop-filter 需要元素背后有可采样的像素 */
  const r = el.getBoundingClientRect()
  const cx = Math.round(r.left + r.width / 2)
  const cy = Math.round(r.top + r.height / 2)
  const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map((n) => {
    const s = getComputedStyle(n)
    return n.tagName + '.' + String(n.className || '').split(' ')[0]
      + ' [bg=' + s.backgroundColor + (s.backdropFilter && s.backdropFilter !== 'none' ? ' blur' : '') + ']'
  })
  log('')
  log('%c=== 2. 面板中心点下的元素堆叠（backdrop 能采到什么）===', 'font-weight:bold;color:#5FB3B3')
  stack.forEach((s, i) => log('  [' + i + '] ' + s))

  log('')
  log('%c=== 3. 我们的玻璃表里，哪些规则命中这个元素 ===', 'font-weight:bold;color:#5FB3B3')
  let matched = 0
  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i]
    const owner = sheet.ownerNode
    const mine = !!(owner && owner.dataset && owner.dataset.plugin === 'dsh-colorlab')
    let rules
    try { rules = sheet.cssRules } catch { continue }
    if (!rules) continue
    for (let j = 0; j < rules.length; j++) {
      const rule = rules[j]
      const sel = rule.selectorText
      if (!sel || !rule.style) continue
      let hit = false
      try { hit = el.matches(sel) } catch { continue }
      if (!hit) continue
      matched++
      const bg = rule.style.getPropertyValue('background-color')
      const bf = rule.style.getPropertyValue('backdrop-filter')
      log('  ' + (mine ? '[ColorLab]' : '[其它]') + ' ' + sel.slice(0, 110))
      if (bg) log('        background-color: ' + bg)
      if (bf) log('        backdrop-filter : ' + bf)
    }
  }
  if (matched === 0) log('%c  没有任何规则命中它', 'color:#EC5F67')

  log('')
  log('%c=== 4. ColorLab 玻璃表状态 ===', 'font-weight:bold;color:#5FB3B3')
  const sheets = [...document.querySelectorAll('style[data-plugin="dsh-colorlab"]')]
  log('  我们的样式表数量: ' + sheets.length)
  sheets.forEach((n) => log('    data-plugin-css = ' + n.dataset.pluginCss + '   规则数 = ' + (n.sheet ? n.sheet.cssRules.length : '?')))
  const glass = sheets.find((n) => /glass/.test(n.dataset.pluginCss || ''))
  if (glass && glass.sheet) {
    let dialogRule = null
    for (const rule of glass.sheet.cssRules) {
      if (rule.selectorText && rule.selectorText.includes('role="dialog"')) { dialogRule = rule; break }
    }
    log('  玻璃表含 [role=dialog] 规则: ' + (dialogRule ? '是' : '否'))
    if (dialogRule) log('    ' + dialogRule.style.getPropertyValue('background-color'))
    const popoverRules = [...glass.sheet.cssRules].filter((r) =>
      r.selectorText && /_panel|preview|float/.test(r.selectorText) && !r.selectorText.includes('role='))
    log('  浮层类名规则 ' + popoverRules.length + ' 条:')
    popoverRules.forEach((r) => log('    ' + r.selectorText.slice(0, 120)))
  }
  log('')
  log('%c把以上全部输出复制回来', 'color:#5FB3B3;font-weight:bold')
})()
