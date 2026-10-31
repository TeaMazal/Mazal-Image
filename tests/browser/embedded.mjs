import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'

const main = new URL(process.env.MI_TEST_MAIN_URL || 'http://127.0.0.1:8340')
const drawing = new URL(process.env.MI_TEST_DRAW_URL || 'http://127.0.0.1:8341')
for (const url of [main, drawing]) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only loopback mock sites are allowed')
}
const engine = process.env.MI_TEST_BROWSER || 'chromium'
assert.ok(['chromium', 'msedge', 'firefox'].includes(engine))
const destination = path.resolve(process.env.MI_TEST_ARTIFACTS || fileURLToPath(new URL('../../artifacts/browser', import.meta.url)))
await fs.mkdir(destination, { recursive: true })
const report = { browser: engine, checks: [], pageErrors: [], passed: false }
const launch = engine === 'firefox' ? firefox : chromium
const browser = await launch.launch({ headless: true, ...(engine === 'msedge' ? { channel: 'msedge' } : {}) })
report.browserVersion = browser.version()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.route('**/*', (route) => {
  const url = new URL(route.request().url())
  return [main.origin, drawing.origin].includes(url.origin) || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort()
})
let currentPage
async function check(name, run) {
  const start = Date.now()
  await run()
  report.checks.push({ name, milliseconds: Date.now() - start })
  console.log('PASS ' + name)
}
async function ready(page) {
  await page.frameLocator('iframe').getByRole('navigation', { name: '用户工作台导航' }).waitFor({ timeout: 20000 })
  await page.locator('#status').filter({ hasText: '已连接' }).waitFor()
}
function observe(page) {
  page.on('pageerror', (error) => report.pageErrors.push(String(error)))
  currentPage = page
}
try {
  const info = await context.request.get(new URL('/test-counts', main).href)
  const before = await info.json()
  assert.equal(before.mock, true, 'Refusing generation: this is not the isolated mock gateway')
  const standalone = await context.newPage()
  observe(standalone)
  await check('独立页登录并建立 Service Worker 缓存', async () => {
    await standalone.goto(drawing.href)
    await standalone.getByRole('textbox', { name: '主站 API 密钥', exact: true }).fill('mock-customer-key')
    await standalone.getByRole('button', { name: '进入绘图工作区', exact: true }).click()
    await standalone.getByRole('navigation', { name: '用户工作台导航' }).waitFor()
    await standalone.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await standalone.reload()
    await standalone.getByRole('navigation', { name: '用户工作台导航' }).waitFor()
    assert.ok(await standalone.evaluate(() => !!navigator.serviceWorker.controller))
  })
  const page = await context.newPage()
  observe(page)
  await check('缓存预热后的嵌入首次连接', async () => { await page.goto(main.href); await ready(page) })
  await check('主站整页连续刷新 5 次', async () => {
    for (let i = 0; i < 5; i++) { await page.reload(); await ready(page) }
  })
  await check('仅刷新绘图子页面连续 3 次', async () => {
    for (let i = 0; i < 3; i++) {
      const frame = page.frames().find((item) => item.url() === drawing.origin + '/?embed=mazal')
      assert.ok(frame)
      await frame.goto(frame.url())
      await ready(page)
    }
  })
  await check('手动重新连接 2 次', async () => {
    for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: '重新连接', exact: true }).click(); await ready(page) }
  })
  await check('子页面迟到加载时有界重连恢复', async () => {
    let failed = false
    const matcher = drawing.origin + '/?embed=mazal'
    await page.route(matcher, (route) => {
      if (!failed) { failed = true; return route.abort('connectionfailed') }
      return route.fallback()
    })
    await page.getByRole('button', { name: '重新连接', exact: true }).click()
    await ready(page)
    assert.equal(failed, true)
    await page.unroute(matcher)
  })
  const prompt = 'E2E slow ' + engine + ' ' + Date.now()
  let submissions = 0
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/api/image-tasks/generations')) submissions++ })
  await check('生成中刷新恢复且不重复提交', async () => {
    const frame = page.frameLocator('iframe')
    await frame.locator('[contenteditable="true"]').fill(prompt)
    const accepted = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/image-tasks/generations') && response.ok())
    await frame.getByRole('button', { name: '生成 1 张图片', exact: true }).click()
    await accepted
    await page.reload()
    await ready(page)
    await page.frameLocator('iframe').getByRole('button', { name: '查看生成图片：' + prompt, exact: true }).locator('img').waitFor({ timeout: 20000 })
    assert.equal(submissions, 1)
    for (let i = 0; i < 2; i++) { await page.reload(); await ready(page) }
    const after = await (await context.request.get(new URL('/test-counts', main).href)).json()
    assert.equal(after.generation - before.generation, 1)
    report.mockGenerations = after.generation - before.generation
    report.browserSubmissions = submissions
  })
  await check('嵌入不持久化密钥且 URL 不含票据', async () => {
    const frame = page.frames().find((item) => item.url() === drawing.origin + '/?embed=mazal')
    assert.ok(frame)
    const stored = await frame.evaluate(() => ({ local: localStorage.getItem('mazal-image-key'), session: sessionStorage.getItem('mazal-image-key') }))
    assert.equal(stored.local, null)
    assert.equal(stored.session, null)
    assert.equal(page.url(), main.href)
  })
  await page.screenshot({ path: path.join(destination, engine + '-embedded.png') })
  await check('独立页作品保留及余额显示', async () => {
    currentPage = standalone
    await standalone.reload()
    await standalone.getByRole('button', { name: /余额 \$12\.3456/ }).waitFor()
    await standalone.getByRole('button', { name: '作品画廊', exact: true }).click()
    await standalone.getByRole('button', { name: '查看作品：' + prompt, exact: true }).locator('img[data-image-id]').waitFor()
    await standalone.screenshot({ path: path.join(destination, engine + '-standalone.png') })
  })
  await check('手机宽度首次进入和刷新', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    currentPage = page
    await page.reload()
    await ready(page)
    const frame = page.frames().find((item) => item.url() === drawing.origin + '/?embed=mazal')
    const dimensions = await frame.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }))
    assert.ok(dimensions.document <= dimensions.width + 1, 'Mobile workbench overflows horizontally')
    await page.screenshot({ path: path.join(destination, engine + '-mobile.png') })
  })
  assert.deepEqual(report.pageErrors, [])
  report.passed = true
} catch (error) {
  report.error = String(error)
  await currentPage?.screenshot({ path: path.join(destination, engine + '-failure.png') }).catch(() => {})
  throw error
} finally {
  await fs.writeFile(path.join(destination, engine + '-report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
