/**
 * dsh-logout-button — host half.
 *
 * DSH Web 的登录态是「`dsh-auth-<hash>` 签名 cookie，一年有效」，它是
 * `HttpOnly` 的，页面 JS 删不掉；宿主也没有 logout 路由。这个插件补上唯一缺的
 * 那一块：一个只做一件事的 HTTP 路由，让服务端替浏览器把 cookie 删掉。
 *
 * 职责范围：
 *   1. `POST /__logout` —— 把本次请求里出现的**所有** cookie 都发一遍删除
 *      （名字从请求的 `Cookie` 头里读，所以不需要复刻 DSH 的 cookie 命名规则）；
 *   2. 附带 `Clear-Site-Data: "cookies"`，让支持该头的浏览器把 HttpOnly
 *      cookie、Domain cookie（例如反向代理发的免密 cookie）一并清掉；
 *   3. 只清 cookie，不碰 localStorage / IndexedDB：草稿、主题这些不是凭证。
 *
 * 为什么不用 `/api`：`/api` 与静态兜底都过了连接鉴权层，插件注册的具名路由
 * 则不会。这里正是要「有 cookie 也能访问、访问后把 cookie 删掉」，所以挂在
 * 根路径下，并用一个自定义头挡住跨站表单（跨站请求带不了自定义头）。
 *
 * 安全边界：这个路由不带认证。未登录的人调用它只会得到一堆「删一个不存在的
 * cookie」的响应，没有信息泄露；能清掉的只有调用者自己浏览器里的 cookie。
 *
 * @module dsh-logout-button
 */

/** Cordis 插件名，必须与 cordis.patch.yml 的 id 一致。 */
export const name = 'logout-button'

/** 需要的宿主服务：只有 webServer，用来注册路由。 */
export const inject = ['webServer']

/** 路由路径：一个不会和 DSH 自身路由、SPA 客户端路由撞车的短名字。 */
export const LOGOUT_PATH = '/__logout'

/** 客户端必须带上的请求头，用来把跨站表单挡在门外。 */
export const LOGOUT_HEADER = 'x-dsh-logout'

/** 合法的 cookie-name token（RFC 6265）。 */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** 删除 cookie 用的过期时间：1970 年，任何浏览器都会立即丢弃。 */
const EPOCH = new Date(0).toUTCString()

/**
 * 从 `Cookie` 请求头里取出所有 cookie 名（去重、保序、跳过非法名）。
 * @param header - 原始 `Cookie` 头，可能缺失。
 * @returns cookie 名列表；没有头时是空数组。
 */
export function cookieNames(header) {
  if (typeof header !== 'string' || header === '') return []
  const names = []
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    const candidate = (at === -1 ? segment : segment.slice(0, at)).trim()
    if (candidate === '' || names.includes(candidate)) continue
    if (!COOKIE_NAME.test(candidate)) continue
    names.push(candidate)
  }
  return names
}

/**
 * 为每个 cookie 名生成一条删除用的 `Set-Cookie`。
 *
 * 删除只看 name + path + domain：属性（HttpOnly / Secure / SameSite）不必与
 * 原 cookie 一致，这也是唯一能删掉 `HttpOnly` cookie 的办法（由服务端下发）。
 * @param header - 原始 `Cookie` 请求头。
 * @returns `Set-Cookie` 值列表。
 */
export function clearCookieHeaders(header) {
  return cookieNames(header).map((name) => `${name}=; Path=/; Max-Age=0; Expires=${EPOCH}`)
}

/**
 * 校验一个 POST 是否来自本站页面。
 *
 * 自定义头把跨站表单挡掉；`Origin` 存在时还要求它和 `Host` 同源，防住
 * 反向代理配错时代理层引入的第三方源。
 * @param req - 原始请求。
 * @returns 是否放行。
 */
export function sameOriginLogout(req) {
  if (req.headers[LOGOUT_HEADER] !== '1') return false
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin === undefined || origin === '') return true
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** 回一个短 JSON；全部路由分支共用。 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/**
 * 路由处理器：删 cookie，返回结果。
 * @param req - 原始请求。
 * @param res - 原始响应，归本处理器独占。
 */
export function logoutHandler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
    res.end('method not allowed\n')
    return
  }
  if (!sameOriginLogout(req)) {
    sendJson(res, 403, { ok: false, error: 'logout requires a same-origin POST' })
    return
  }

  const names = cookieNames(req.headers.cookie)
  const headers = {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    // 支持该头的浏览器：连 HttpOnly / Domain cookie（反向代理的免密 cookie）
    // 一起清掉。不支持（例如 Safari）就靠上面的逐名删除。
    'clear-site-data': '"cookies"',
  }
  if (names.length > 0) headers['set-cookie'] = clearCookieHeaders(req.headers.cookie)

  const body = JSON.stringify({ ok: true, cleared: names })
  headers['content-type'] = 'application/json; charset=utf-8'
  headers['content-length'] = Buffer.byteLength(body)
  res.writeHead(200, headers)
  res.end(body)
}

/**
 * 注册路由。
 * @param ctx - 宿主 Cordis 上下文。
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: LOGOUT_PATH, handler: logoutHandler }),
    'dsh-logout-button: POST /__logout',
  )
}
