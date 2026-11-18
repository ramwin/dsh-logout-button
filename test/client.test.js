/**
 * 浏览器一半的冒烟测试：在 Node 里假装 `window.__ModuleLoader__`，跑一遍
 * factory + apply，再静态渲染两个组件，确认插槽注册和标记没写错。
 *
 * React 从 web profile 的 pnpm 虚拟仓库里取（插件运行时由宿主的 module
 * system 提供 react，所以本包本身不声明依赖）。找不到就跳过，不让 CI 环境
 * 因为缺宿主依赖而红。
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

const PROFILE = join(process.env.HOME ?? '', '.dsh/profiles/web/node_modules/.pnpm')

/** 在 pnpm 虚拟仓库里找 `name@version` 目录下的真实包入口。 */
function findPackage(name) {
  if (!existsSync(PROFILE)) return undefined
  const prefix = `${name.replace('/', '+')}@`
  const entry = readdirSync(PROFILE).find((row) => row.startsWith(prefix))
  if (entry === undefined) return undefined
  const root = join(PROFILE, entry, 'node_modules', name)
  return existsSync(join(root, 'index.js')) || existsSync(join(root, 'package.json')) ? root : undefined
}

const reactRoot = findPackage('react')
const serverRoot = findPackage('react-dom')

test('浏览器一半注册两个插槽并能渲染', { skip: reactRoot === undefined || serverRoot === undefined }, async () => {
  const require = createRequire(import.meta.url)
  const React = require(reactRoot)
  const { renderToStaticMarkup } = require(join(serverRoot, 'server.js'))

  const registered = []
  /** 记录 factory 的极简 loader。 */
  const captured = []
  globalThis.window = {
    __ModuleLoader__: {
      load(registration) {
        captured.push(registration)
      },
    },
  }
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
  }

  await import('../lib/client.js')

  assert.equal(captured.length, 1)
  assert.equal(captured[0].id, 'dsh-logout-button')

  const exports = captured[0].factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`unexpected require(${specifier})`)
  })
  assert.deepEqual(exports.inject, ['slots'])

  const ctx = {
    effect(run) {
      const dispose = run()
      assert.equal(typeof dispose, 'function')
      return dispose
    },
    slots: {
      inject(name, run) {
        return run()
      },
      register(options, Component) {
        registered.push({ options, Component })
        return () => {}
      },
    },
  }
  exports.apply(ctx)

  assert.equal(registered.length, 2)
  assert.deepEqual(
    registered.map((row) => row.options.name).sort(),
    ['conversation.session.header.utilities', 'settings.general.item'],
  )
  for (const row of registered) {
    assert.equal(row.options.id, 'logout-button')
  }

  const header = renderToStaticMarkup(React.createElement(registered[0].Component))
  assert.match(header, /dsh-logout-icon/)
  assert.match(header, /aria-label="退出登录"/)
  assert.match(header, /<svg/)

  const row = renderToStaticMarkup(React.createElement(registered[1].Component))
  assert.match(row, /dsh-logout-row/)
  assert.match(row, /退出登录/)
  assert.match(row, /带 token 的链接/)
})
