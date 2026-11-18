/**
 * 单元测试：cookie 名解析、删除头生成、同源校验。
 * 运行：node --test test/
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  LOGOUT_HEADER,
  clearCookieHeaders,
  cookieNames,
  logoutHandler,
  sameOriginLogout,
} from '../lib/index.js'

test('cookieNames 按 ; 拆分、去重、跳过非法名', () => {
  assert.deepEqual(cookieNames('a=1; b=2'), ['a', 'b'])
  assert.deepEqual(cookieNames('a=1; a=2'), ['a'])
  assert.deepEqual(cookieNames('a=1;;b=2'), ['a', 'b'])
  assert.deepEqual(cookieNames('dsh-auth-abc=xx==; theme=dark'), ['dsh-auth-abc', 'theme'])
  assert.deepEqual(cookieNames('bad name=1; good=2'), ['good'])
  assert.deepEqual(cookieNames(''), [])
  assert.deepEqual(cookieNames(undefined), [])
})

test('clearCookieHeaders 为每个 cookie 生成一条过期的 Set-Cookie', () => {
  const headers = clearCookieHeaders('dsh-auth-abc=value; other=1')
  assert.equal(headers.length, 2)
  assert.match(headers[0], /^dsh-auth-abc=; Path=\/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT$/)
  assert.match(headers[1], /^other=; Path=\/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT$/)
  assert.deepEqual(clearCookieHeaders(undefined), [])
})

test('sameOriginLogout 要求自定义头，且 Origin 与 Host 同源', () => {
  const base = { headers: { host: 'dsh.example.com', [LOGOUT_HEADER]: '1' } }
  assert.equal(sameOriginLogout(base), true)
  assert.equal(sameOriginLogout({ headers: { ...base.headers, origin: 'https://dsh.example.com' } }), true)
  assert.equal(sameOriginLogout({ headers: { ...base.headers, origin: 'https://evil.example.com' } }), false)
  assert.equal(sameOriginLogout({ headers: { ...base.headers, origin: 'not a url' } }), false)
  assert.equal(sameOriginLogout({ headers: { host: 'dsh.example.com' } }), false)
})

/** 最小的响应替身：记录状态、头和 body。 */
function responseRecorder() {
  const record = { status: undefined, headers: undefined, body: '' }
  return {
    record,
    writeHead(status, headers) {
      record.status = status
      record.headers = headers
    },
    end(body) {
      record.body = body ?? ''
    },
  }
}

test('POST /__logout 删除所有 cookie 并要求重载', () => {
  const res = responseRecorder()
  logoutHandler(
    {
      method: 'POST',
      headers: {
        host: 'dsh.example.com',
        [LOGOUT_HEADER]: '1',
        origin: 'https://dsh.example.com',
        cookie: 'dsh-auth-abc=1; nginx_pass=2',
      },
    },
    res,
  )
  assert.equal(res.record.status, 200)
  assert.deepEqual(JSON.parse(res.record.body), { ok: true, cleared: ['dsh-auth-abc', 'nginx_pass'] })
  assert.equal(res.record.headers['clear-site-data'], '"cookies"')
  assert.equal(res.record.headers['set-cookie'].length, 2)
  assert.match(res.record.headers['set-cookie'][0], /^dsh-auth-abc=;/)
})

test('没有 cookie 的 POST 也成功，只是没东西可删', () => {
  const res = responseRecorder()
  logoutHandler({ method: 'POST', headers: { [LOGOUT_HEADER]: '1' } }, res)
  assert.equal(res.record.status, 200)
  assert.deepEqual(JSON.parse(res.record.body), { ok: true, cleared: [] })
  assert.equal(res.record.headers['set-cookie'], undefined)
})

test('非 POST 返回 405，跨站请求返回 403', () => {
  const notAllowed = responseRecorder()
  logoutHandler({ method: 'GET', headers: {} }, notAllowed)
  assert.equal(notAllowed.record.status, 405)
  assert.equal(notAllowed.record.headers.allow, 'POST')

  const forbidden = responseRecorder()
  logoutHandler({ method: 'POST', headers: { host: 'dsh.example.com' } }, forbidden)
  assert.equal(forbidden.record.status, 403)
})
