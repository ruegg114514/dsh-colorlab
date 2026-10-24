/* ============================================================
 * ColorLab 浮层诊断脚本
 *
 * 用法：
 *   1. 在 DSH 里把「右侧历史记录」的悬浮窗打开并保持显示
 *   2. DevTools 控制台（Ctrl+Shift+I → Console）粘贴运行
 *   3. 把输出复制回来
 *
 * 它检查三件事：
 *   A. 那个浮层元素到底有没有被我们的规则命中
 *   B. 我们的样式表里有没有 hovercard 规则
 *   C. 计算样式里 backdrop-filter / background 的实际值
 * ============================================================ */
(function diagnose() {
  const log = (...a) => console.log(...a)

  log('%c=== A. 找出所有 hovercard 浮层 ===', 'font-weight:bold;color:#5FB3B3')

  /* 宿主的 HoverCard 卡片类名是 _card_<hash>_<n>，且带 --dsw-hovercard-bg */
  const candidates = []
  for (const el of document.querySelectorAll('div,section,aside')) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed') continue
    const r = el.getBoundingClientRect()
    if (r.width < 60 || r.height < 30) continue
    const cls = String(el.className || '')
    const hv = cs.getPropertyValue('--dsw-hovercard-bg').trim()
    const bg = cs.backgroundColor
    const bf = cs.backdropFilter || cs.webkitBackdropFilter
    candidates.push({
      el,
      cls: cls.slice(0, 100),
      rect: Math.round(r.width) + 'x' + Math.round(r.height),
      hv,
      bg,
      bf,
      isCard: /_card_/.test(cls),
    })
  }

  const cards = candidates.filter((c) => c.isCard)
  log('找到 ' + cards.length + ' 个 _card_ 固定浮层')
  cards.forEach((c, i) => {
    log('')
    log('  [' + i + '] ' + c.rect + '  class=' + c.cls)
    log('      --dsw-hovercard-bg = ' + (c.hv || '(空)'))
    log('      background-color   = ' + c.bg)
    log('      backdrop-filter    = ' + c.bf)
  })

  log('')
  log('%c=== B. 我们的样式表里有 hovercard 规则吗 ===', 'font-weight:bold;color:#5FB3B3')

  let found = 0
  for (let s = 0; s < document.styleSheets.length; s++) {
    const sheet = document.styleSheets[s]
    let rules
    try { rules = sheet.cssRules } catch { continue }
    if (!rules) continue
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r]
      const sel = rule.selectorText || ''
      if (sel.includes('_card_') || sel.includes('hovercard')) {
        found++
        log('  样式表#' + s + '  ' + sel)
        log('    ' + (rule.cssText || '').slice(0, 220))
      }
    }
  }
  if (found === 0) log('  %c没有找到任何 hovercard 规则', 'color:#EC5F67')

  log('')
  log('%c=== C. 我们的玻璃样式表标识 ===', 'font-weight:bold;color:#5FB3B3')
  for (let s = 0; s < document.styleSheets.length; s++) {
    const sheet = document.styleSheets[s]
    const owner = sheet.ownerNode
    if (!owner) continue
    const id = owner.id || owner.getAttribute('data-dsh-glass-sheet') || ''
    if (id || String(owner.tagName) === 'STYLE') {
      let n = 0
      try { n = sheet.cssRules ? sheet.cssRules.length : 0 } catch {}
      log('  样式表#' + s + '  id=' + (id || '(无)') + '  rules=' + n)
    }
  }

  log('')
  log('%c=== D. 直接测一下：给第一个 _card_ 强制加模糊，看有没有变化 ===', 'font-weight:bold;color:#5FB3B3')
  if (cards.length > 0) {
    const el = cards[0].el
    el.style.setProperty('background', 'rgba(31,36,40,0.71)', 'important')
    el.style.setProperty('backdrop-filter', 'blur(26px) saturate(120%)', 'important')
    el.style.setProperty('-webkit-backdrop-filter', 'blur(26px) saturate(120%)', 'important')
    log('  已给 [0] 强制设置。看那个浮层现在有模糊吗？')
    log('  %c如果现在有模糊 → 说明我们的规则没注入到页面',
      'color:#99C794')
    log('  %c如果现在还是没模糊 → 说明这个元素本身不该用 backdrop-filter（背后没有可模糊的内容）',
      'color:#F9AE58')
  } else {
    log('  没有 _card_ 浮层可测 —— 先把悬浮窗打开')
  }
  log('')
  log('%c把上面全部输出复制回来', 'color:#5FB3B3;font-weight:bold')
})()
