import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

const source = await fs.readFile(new URL('../integrations/embedded-workbench.js', import.meta.url), 'utf8')
const { createWorkbench } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

function setup(requestTicket = async () => ({ ticket: 'test-ticket' })) {
  const listeners = new Map()
  const timers = new Map()
  const intervals = new Map()
  const messages = []
  const errors = []
  let navigations = 0
  const child = { postMessage: (data, origin) => messages.push({ data, origin }) }
  const frame = {
    style: {}, contentWindow: child, removed: false,
    set src(value) { this.url = value; navigations += 1 },
    remove() { this.removed = true },
  }
  globalThis.window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type) },
    setTimeout: (callback) => { timers.set(callback, callback); return callback },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback) => { intervals.set(callback, callback); return callback },
    clearInterval: (id) => intervals.delete(id),
  }
  globalThis.document = { createElement: () => frame }
  const instance = createWorkbench({ container: { appendChild() {} }, origin: 'https://image.example.test', keyId: 1, requestTicket, onError: (error) => errors.push(error) })
  return { instance, frame, child, messages, errors, timers, intervals, listeners,
    get navigations() { return navigations },
    receive: (data, origin = 'https://image.example.test', sourceWindow = child) => listeners.get('message')?.({ data, origin, source: sourceWindow }),
  }
}

test('票据只交给正确来源和当前 iframe，重复握手不重复签发', async () => {
  let calls = 0
  const ctx = setup(async () => { calls += 1; return { ticket: 'test-ticket' } })
  const ready = { type: 'mazal-image-ready', nonce: 'a'.repeat(32) }
  await ctx.receive(ready, 'https://attacker.example.test')
  await ctx.receive(ready, undefined, {})
  assert.equal(calls, 0)
  await ctx.receive(ready)
  await ctx.receive(ready)
  assert.equal(calls, 1)
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].origin, 'https://image.example.test')
  assert.equal(ctx.frame.url, 'https://image.example.test/?embed=mazal')
  assert.ok(!ctx.frame.url.includes('ticket'))
  ctx.instance.destroy()
})

test('未握手时只重载两次，成功后停止计时并在离开页面时清理', async () => {
  const ctx = setup()
  const tick = [...ctx.intervals.values()][0]
  for (let i = 0; i < 8; i += 1) tick()
  assert.equal(ctx.navigations, 3)
  assert.equal(ctx.intervals.size, 0)
  await ctx.receive({ type: 'mazal-image-connected' })
  assert.equal(ctx.timers.size, 0)
  ctx.instance.destroy()
  assert.equal(ctx.listeners.size, 0)
  assert.equal(ctx.frame.removed, true)
})

test('销毁后迟到的票据不会传给子页面', async () => {
  let resolve
  const ctx = setup(() => new Promise((done) => { resolve = done }))
  const pending = ctx.receive({ type: 'mazal-image-ready', nonce: 'b'.repeat(32) })
  ctx.instance.destroy()
  resolve({ ticket: 'late-test-ticket' })
  await pending
  assert.equal(ctx.messages.length, 0)
  assert.equal(ctx.intervals.size, 0)
  assert.equal(ctx.timers.size, 0)
})

test('已连接的子页面刷新后签发新票据，同一握手仍只签发一次', async () => {
  let calls = 0
  const ctx = setup(async () => ({ ticket: 'ticket-' + (++calls) }))
  await ctx.receive({ type: 'mazal-image-ready', nonce: 'a'.repeat(32) })
  await ctx.receive({ type: 'mazal-image-connected' })
  await ctx.receive({ type: 'mazal-image-ready', nonce: 'a'.repeat(32) })
  assert.equal(calls, 1)
  await ctx.receive({ type: 'mazal-image-ready', nonce: 'b'.repeat(32) })
  assert.equal(calls, 2)
  assert.equal(ctx.messages[1].data.nonce, 'b'.repeat(32))
  assert.equal(ctx.timers.size, 1)
  await ctx.receive({ type: 'mazal-image-connected' })
  assert.equal(ctx.timers.size, 0)
  ctx.instance.destroy()
})

test('刷新期间旧握手的迟到失败不覆盖新连接', async () => {
  let fail
  let calls = 0
  const ctx = setup(() => ++calls === 1 ? new Promise((resolve, reject) => { fail = reject }) : Promise.resolve({ ticket: 'new-ticket' }))
  const first = ctx.receive({ type: 'mazal-image-ready', nonce: 'a'.repeat(32) })
  await ctx.receive({ type: 'mazal-image-ready', nonce: 'b'.repeat(32) })
  await ctx.receive({ type: 'mazal-image-connected' })
  fail(new Error('old request failed'))
  await first
  assert.equal(ctx.messages.length, 1)
  assert.equal(ctx.messages[0].data.ticket, 'new-ticket')
  assert.deepEqual(ctx.errors, [])
  assert.equal(ctx.timers.size, 0)
  ctx.instance.destroy()
})
