// dsh-logout-button — browser half.
//
// DSH Web 的登录态是 HttpOnly cookie（`dsh-auth-*`，一年有效），页面 JS 删不掉，
// 宿主也没给 logout 入口。这里只做两件事：
//
//   1. 在会话页头部的 utilities 里放一个 28px「退出」图标按钮（和「导出日志」
//      「定时任务」同一排），顺手就能点；
//   2. 在 设置 → 通用 里放一行带说明的「退出登录」，找不到图标时也有入口。
//
// 真正的删除动作在宿主一半（`lib/index.js` 的 POST /__logout）：浏览器把请求
// 发过去，服务端回 Set-Cookie 删除指令，然后页面重新加载，回到 401 门。
//
// 只清 cookie，不动 localStorage / IndexedDB —— 草稿、主题、会话列表都不该被
// 一次退出带走。

window.__ModuleLoader__.load({
  id: 'dsh-logout-button',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    /** 服务端删除路由；部署在根路径下，所以用 origin + 绝对路径。 */
    var LOGOUT_PATH = '/__logout'
    /** 自定义头：和宿主路由的校验一致，跨站表单带不了这个头。 */
    var LOGOUT_HEADER = 'x-dsh-logout'
    /** 插件样式标签 id，热挂载时保持幂等。 */
    var STYLE_ID = 'dsh-logout-button-style'
    /** 确认文案。 */
    var CONFIRM_TEXT = '退出登录？\n\n会清除这个浏览器里的登录 cookie；重新进入需要带 token 的链接。'

    var CSS = [
      // 头部图标按钮：与宿主 utilities 里的同排按钮同尺寸。
      '.dsh-logout-icon{box-sizing:border-box;width:28px;height:28px;padding:0;margin-left:4px;border:0;',
      'border-radius:28px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none;',
      'display:inline-flex;align-items:center;justify-content:center}',
      '.dsh-logout-icon:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-logout-icon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}',
      '.dsh-logout-icon svg{flex:none}',
      // 设置行：与「开发者工具」那类设置项同样的排版。
      '.dsh-logout-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;',
      'border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.dsh-logout-row-title{font-size:14px;line-height:20px}',
      '.dsh-logout-row-desc{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px;',
      'max-width:520px}',
      '.dsh-logout-action{box-sizing:border-box;flex:none;height:32px;padding:0 12px;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-primary);',
      'font-size:13px;cursor:pointer}',
      '.dsh-logout-action:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-logout-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}',
    ].join('')

    /** Inline SVG：门 + 向外的箭头，和「退出登录」的语义一致。 */
    var LOGOUT_ICON = React.createElement(
      'svg',
      { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': 'true', focusable: 'false' },
      React.createElement('path', {
        d: 'M6.6 2.6H4.1c-.9 0-1.6.7-1.6 1.6v7.6c0 .9.7 1.6 1.6 1.6h2.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.3',
        strokeLinecap: 'round',
      }),
      React.createElement('path', {
        d: 'm10.2 5.2 3 2.8-3 2.8M13 8H6.2',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.3',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    )

    /** 幂等注入样式（热挂载可能重复执行）。 */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      if (document.head !== null && document.head !== undefined) document.head.appendChild(style)
    }

    /** 一个请求只发一次；网络慢时按钮不会被点出第二次。 */
    var pending = false

    /**
     * 确认后调用宿主路由，然后整页重载（重载即命中 401 门）。
     * 失败时把错误留在页面上，不假装已经退出。
     */
    function runLogout() {
      if (pending) return
      var confirmed = true
      try {
        confirmed = window.confirm(CONFIRM_TEXT)
      } catch (error) {
        // confirm 被环境限制时按「确认」处理：用户点按钮本来就是要退出。
        confirmed = true
      }
      if (confirmed !== true) return
      pending = true
      var request = {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {},
      }
      request.headers[LOGOUT_HEADER] = '1'
      fetch(window.location.origin + LOGOUT_PATH, request)
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response
        })
        .then(function () {
          window.location.replace('/')
        })
        .catch(function (error) {
          pending = false
          try {
            window.alert('退出失败：' + (error && error.message ? error.message : error))
          } catch (ignored) {
            /* alert 不可用时至少让状态可查 */
          }
          try {
            console.warn('[dsh-logout-button] 退出失败', error)
          } catch (ignored) {
            /* console 不可用 */
          }
        })
    }

    /** 会话页头部 utilities 里的图标按钮。 */
    function HeaderLogoutButton() {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-logout-icon',
          title: '退出登录',
          'aria-label': '退出登录',
          onClick: runLogout,
        },
        LOGOUT_ICON,
      )
    }

    /** 设置 → 通用 里的整行入口。 */
    function SettingsLogoutRow() {
      return React.createElement(
        'div',
        { className: 'dsh-logout-row' },
        React.createElement(
          'div',
          null,
          React.createElement('div', { className: 'dsh-logout-row-title' }, '退出登录'),
          React.createElement(
            'div',
            { className: 'dsh-logout-row-desc' },
            '清除这个浏览器的登录 cookie，回到未登录状态；重新进入需要带 token 的链接。',
          ),
        ),
        React.createElement(
          'button',
          { type: 'button', className: 'dsh-logout-action', onClick: runLogout },
          '退出登录',
        ),
      )
    }

    /**
     * 注册一个插槽条目；宿主热挂载留下的旧占用不该拖垮另一处入口。
     * @param ctx - client root context。
     * @param name - 插槽名。
     * @param order - 同插槽内的排序。
     * @param Component - 要渲染的组件。
     * @returns 反注册函数，或空函数。
     */
    function take(ctx, name, order, Component) {
      try {
        return ctx.slots.register({ name: name, id: 'logout-button', order: order }, Component)
      } catch (error) {
        try {
          console.warn('[dsh-logout-button] 插槽 ' + name + ' 注册失败', error)
        } catch (ignored) {
          /* console 不可用 */
        }
        return function noop() {}
      }
    }

    /**
     * 挂载插件。
     * @param ctx - browser Cordis context。
     */
    function apply(ctx) {
      ensureStyle()
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return
      if (typeof ctx.effect !== 'function') return
      ctx.effect(
        function () {
          return ctx.slots.inject('conversation.session.header.utilities', function () {
            return take(ctx, 'conversation.session.header.utilities', 40, HeaderLogoutButton)
          })
        },
        'dsh-logout-button: header button',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('settings.general.item', function () {
            return take(ctx, 'settings.general.item', 40, SettingsLogoutRow)
          })
        },
        'dsh-logout-button: settings row',
      )
    }

    exports.inject = ['slots']
    exports.apply = apply
    /** 测试缝：让 Node 侧能在没有 DOM 的情况下跑一遍「确认 → 请求 → 重载」。 */
    exports.logoutForTest = runLogout
    return module.exports
  },
})
