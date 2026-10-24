/* ============================================================
 * ColorLab 浮层检测状态检查
 *
 * 用法：DevTools 控制台粘贴运行，把输出复制回来。
 *
 * 它检查：
 *   A. 我们注入的样式表里，浮层规则到底长什么样
 *   B. 那个浮层元素的实际计算样式
 *   C. contain 是否被成功解除
 * ============================================================ */
(function check() {
  const log = (...a) => console.log(...a)

  log('%c=== A. 我们注入的浮层规则 ===', 'font-weight:bold;color:#5FB3B3')

  let found = 0
  for (let s = 0; s < document.styleSheets.length; s++) {
    const sheet = document.styleSheets[s]
    let rules
    try { rules = sheet.cssRules } catch { continue }
    if (!rules) continue
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r]
      const sel = rule.selectorText || ''
      if (sel.includes('_preview_') || sel.includes('xpvNua') || sel.includes('_float_')) {
        found++
        log('  样式表#' + s)
        log('    选择器: ' + sel.slice(0, 200))
        log('    声明  : ' + (rule.cssText || '').slice(0, 240))
        log('')
      }
    }
  }
  if (found === 0) log('  %c没有找到任何浮层规则', 'color:#EC5F67')

  log('')
  log('%c=== B. 找 xpvNua_preview 元素 ===', 'font-weight:bold;color:#5FB3B3')

  const els = document.querySelectorAll('[class*="preview"]')
  let hit = 0
  for (const el of els) {
    const cls = String(el.className || '')
    if (!/preview/i.test(cls)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    /* 只关心有尺寸的（可见的） */
    if (r.width < 20 || r.height < 10) continue
    hit++
    log('  [' + hit + '] ' + Math.round(r.width) + 'x' + Math.round(r.height) + '  ' + cls.slice(0, 120))
    log('      background-color : ' + cs.backgroundColor)
    log('      backdrop-filter  : ' + (cs.backdropFilter || cs.webkitBackdropFilter || 'none'))
    log('      contain          : ' + (cs.contain || 'none'))
    log('      父元素 contain   : ' + (() => {
      const p = el.parentElement
      return p ? getComputedStyle(p).contain : '(无父)'
    })())
    log('      父元素 class     : ' + (() => {
      const p = el.parentElement
      return p ? String(p.className || '').slice(0, 100) : '(无)'
    })())
    log('')
  }
  if (hit === 0) log('  %c没找到可见的 preview 元素 —— 先把悬浮窗打开', 'color:#F9AE58')

  log('')
  log('%c=== C. 诊断 ===', 'font-weight:bold;color:#5FB3B3')
  if (found === 0) {
    log('%c我们的浮层规则根本没注入 → detectPopoverClasses() 没检测到类名', 'color:#EC5F67')
  } else if (hit > 0) {
    const el = [...document.querySelectorAll('[class*="preview"]')].find((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 20 && r.height > 10 && /preview/i.test(String(e.className || ''))
    })
    if (el) {
      const cs = getComputedStyle(el)
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none'
      const pContain = el.parentElement ? getComputedStyle(el.parentElement).contain : ''
      log('  浮层 backdrop-filter = ' + bf)
      log('  父元素 contain       = ' + pContain)
      if (bf === 'none') {
        log('%c  → 规则没命中这个元素，或 contain 仍在阻断', 'color:#EC5F67')
      } else if (pContain && pContain !== 'none') {
        log('%c  → backdrop-filter 有值但父元素 contain 仍在，模糊被阻断', 'color:#F9AE58')
      } else {
        log('%c  → 看起来正常', 'color:#99C794')
      }
    }
  }
  log('')
  log('%c把上面全部输出复制回来', 'color:#5FB3B3;font-weight:bold')
})()
