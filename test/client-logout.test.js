/**
 * 浏览器一半的退出流程测试：没有 DOM 也能跑，靠替身覆盖 confirm / fetch /
 * location。和 client.test.js 分开成两个文件，因为模块级的
 * `window.__ModuleLoader__` 在同一个进程里只会被读取一次。
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

const PROFILE = join(process.env.HOME ?? '', '.dsh/profiles/web/node_modules/.pnpm')

/** 在 pnpm 虚拟仓库里找 react 的包目录。 */
function findPackage(name) {
  if (!existsSync(PROFILE)) return undefined
  const prefix = `${name.replace('/', '+')}@`
  const entry = readdirSync(PROFILE).find((row) => row.startsWith(prefix))
  if (entry === undefined) return undefined
  const root = join(PROFILE, entry, 'node_modules', name)
  return existsSync(join(root, 'package.json')) ? root : undefined
}

const reactRoot = findPackage('react')

test('退出流程：确认后 POST 到 /__logout，成功才重载', { skip: reactRoot === undefined }, async () => {
  const require = createRequire(import.meta.url)
  const React = require(reactRoot)
  const captured = []
  globalThis.window = {
    location: { origin: 'https://dsh.example.com', replace: () => {} },
    __ModuleLoader__: { load: (registration) => captured.push(registration) },
  }
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
  }
  await import('../lib/client.js')
  const exports = captured[0].factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`unexpected require(${specifier})`)
  })

  /** 重置全局替身，返回可断言的记录。 */
  function harness({ confirm = true, ok = true } = {}) {
    const calls = { fetched: [], replaced: [], alerts: [] }
    globalThis.window.confirm = () => confirm
    globalThis.window.alert = (text) => calls.alerts.push(text)
    globalThis.window.location.replace = (url) => calls.replaced.push(url)
    globalThis.fetch = async (url, init) => {
      calls.fetched.push({ url, init })
      return { ok }
    }
    return calls
  }

  // 取消确认：不发请求
  let calls = harness({ confirm: false })
  exports.logoutForTest()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(calls.fetched.length, 0)

  // 失败：不重载，给出错误（成功那条放最后：成功后流程假定页面会重载）
  calls = harness({ ok: false })
  exports.logoutForTest()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(calls.replaced.length, 0)
  assert.equal(calls.alerts.length, 1)

  // 确认：POST + 自定义头，成功后 replace('/')
  calls = harness()
  exports.logoutForTest()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(calls.fetched.length, 1)
  assert.equal(calls.fetched[0].url, 'https://dsh.example.com/__logout')
  assert.equal(calls.fetched[0].init.method, 'POST')
  assert.equal(calls.fetched[0].init.headers['x-dsh-logout'], '1')
  assert.equal(calls.fetched[0].init.credentials, 'same-origin')
  assert.deepEqual(calls.replaced, ['/'])
})
