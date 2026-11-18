# dsh-logout-button

DeepSeek Harness Web 的「退出登录」按钮。

DSH Web 的登录态是**一年有效的 `HttpOnly` 签名 cookie**（`dsh-auth-*`），
页面里的 JS 删不掉它，宿主也没有 logout 路由。这个插件补上两半：

- **宿主一半**：`POST /__logout`，把本次请求携带的每个 cookie 都下发一遍删除
  （`Set-Cookie: name=; Max-Age=0; Path=/`），并附
  `Clear-Site-Data: "cookies"`；
- **浏览器一半**：会话页头部放一个 28px 图标按钮，设置 → 通用 里放一行带说明的
  入口。点一下 → 确认 → 请求宿主路由 → 整页重载 → 回到 401 门。

只清 cookie，不动 `localStorage` / `IndexedDB`：草稿、主题、历史都不该被一次
退出带走。

## 为什么需要它

```text
浏览器 ──Basic 密码──> nginx ──> dsh web ──(dsh-auth-* cookie)──> 页面
```

`dsh web` 的 token 登录只认 cookie，源码里没有 logout / revoke 路由。共享电脑
（例如公司电脑）上开完会话后想退出，只能手动清站点数据——这正是这个插件替你
点的那个按钮。

## 它能清掉什么，清不掉什么

| 层 | 能清吗 | 说明 |
|---|---|---|
| `dsh-auth-*` cookie | ✅ | 由服务端下发删除，HttpOnly 也不影响 |
| nginx 的免密 cookie（若有） | ✅ | 只要它在请求的 `Cookie` 头里；Chrome / Firefox 还会因 `Clear-Site-Data` 清掉 Domain cookie |
| nginx Basic 密码缓存 | ❌ | 这是浏览器的 HTTP auth cache，服务器管不到；要彻底清需要关闭浏览器或清站点数据 |

所以退出后，同一台机器上再访问会停在 401 门（Basic 也许还免密，但 DSH 的
cookie 已经没了）；要「连 Basic 一起退」，仍然需要清站点数据或关浏览器。

## 安装（web profile）

两种挂法，二选一：

**A. 作为 bundle（推荐给别的机器 / 发布用）** —— 在 profile 的
`package.json` 里加依赖和 bundles 条目：

```json
{
  "dependencies": { "dsh-logout-button": "link:/path/to/dsh-logout-button" },
  "dsh": { "profile": { "bundles": ["dsh-logout-button"] } }
}
```

**B. 只用 profile patch（本机现状，改完立即生效）** —— 加依赖，再在
`~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: logout-button
      name: 'dsh-logout-button'
```

```bash
# 链接进 profile
cd ~/.dsh/profiles/web
dsh plugin --profile web install

# 本机（patchReload: live）不用重启：改完 cordis.patch.yml 宿主会热加载
# 其它机器（没有 live reload）重启一次 web 服务：
#   sudo launchctl kickstart -k system/<your-dsh-launchd-label>
```

页面刷新后，会话头部右侧多一个「退出」图标；设置 → 通用 里多一行「退出登录」。

## 接口

`POST /__logout`，必须带请求头 `x-dsh-logout: 1`（跨站表单带不了自定义头）。
`Origin` 存在时要求它与 `Host` 同源。

```bash
curl -i -X POST http://127.0.0.1:3082/__logout \
  -H 'x-dsh-logout: 1' \
  -H 'Cookie: dsh-auth-abc=1; other=2'
# HTTP/1.1 200
# clear-site-data: "cookies"
# set-cookie: dsh-auth-abc=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT
# set-cookie: other=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT
# {"ok":true,"cleared":["dsh-auth-abc","other"]}
```

## 测试

```bash
node --test test/*.test.js
```

## License

MIT
