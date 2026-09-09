import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * Every Orva screen opens, and the sidebar can be walked in any order.
 *
 * Two different failures, two different tests:
 *
 * 1. A screen throws on first render — an API shape it did not expect, an
 *    empty tenant with no settings row, a seeded record it assumed. Loading
 *    each URL directly, with a real session against the production build,
 *    catches those.
 *
 * 2. Two screens share a React Query key but cache different shapes, so the
 *    second screen reads the first screen's data — "allAccounts.filter is not
 *    a function" on the expenses screen after visiting vendor bills. That only
 *    happens on client-side navigation, when the cache survives between
 *    screens; a URL load can never reproduce it. So this walks the whole
 *    sidebar by clicking, forward and then backward, and fails on the first
 *    screen that throws. Forward and backward together cover every ordered
 *    pair: whatever any screen leaves in the cache, every other screen has to
 *    render on top of it at least once.
 *
 * Both tests fail on any client-side error, which is the point: a screen that
 * renders while throwing in the console is not working. Harness fixtures in an
 * ephemeral database; the session cookie is carried explicitly because the
 * ephemeral app is a production build (.ai/lessons.md →
 * ephemeral-integration-env-gotchas).
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }

// Logged by the fetch layer for responses a screen handles on purpose (a 404
// for a settings row that does not exist yet, a 409 the UI surfaces). Only
// unexpected errors count.
const BENIGN_CONSOLE = /Failed to load resource|status of 4\d\d/i

async function login(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<string> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value.split(';')[0])
    .join('; ')
  expect(cookie, 'login must set a session cookie').not.toBe('')
  await anonymous.dispose()
  return cookie
}

/** A signed-in browser, in Thai: the tenant is Thai and so is every label. */
async function signedInBrowser(browser: Browser, baseURL: string | undefined, cookie: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } })
  const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
  await context.addCookies(
    [...cookie.split('; '), 'locale=th'].map((pair) => {
      const index = pair.indexOf('=')
      return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: host, path: '/', secure: false }
    }),
  )
  return context
}

/** Collects anything the page throws or logs as an error while we walk it. */
function watch(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (BENIGN_CONSOLE.test(text)) return
    problems.push(`console: ${text}`)
  })
  return problems
}

/**
 * The production build swaps a crashed route for Next's error boundary. The
 * text is the only reliable signal there is — the dev overlay does not exist
 * in a production build.
 */
async function crashedText(page: Page): Promise<string | null> {
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
  return /Application error|Unhandled Runtime Error|client-side exception/i.test(body) ? body.slice(0, 300) : null
}

/**
 * Every static Orva backend page, read from the module tree so a page added
 * tomorrow is walked without anyone remembering to list it. Dynamic routes
 * (`[id]`) need a record and are covered by their own module's specs.
 */
function orvaBackendPages(): string[] {
  // The runner starts Playwright from the repo root; the spec is ESM, so no __dirname.
  const modulesDir = join(process.cwd(), 'src', 'modules')
  const pages: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path, `${prefix}/${name}`)
      else if (name === 'page.tsx') pages.push(prefix)
    }
  }
  for (const moduleId of readdirSync(modulesDir)) {
    if (!moduleId.startsWith('orva')) continue
    const backend = join(modulesDir, moduleId, 'backend')
    if (!statSync(backend, { throwIfNoEntry: false })?.isDirectory()) continue
    walk(backend, '/backend')
  }
  return [...new Set(pages)].filter((url) => !url.includes('[')).sort()
}

/** Opens every collapsed sidebar group so each link is clickable. */
async function expandSidebar(page: Page): Promise<void> {
  const sidebar = page.locator('nav[data-testid="sidebar"]')
  await expect(sidebar).toBeVisible({ timeout: 30_000 })
  const toggles = sidebar.locator('button[aria-expanded="false"]')
  for (let i = (await toggles.count()) - 1; i >= 0; i--) await toggles.nth(i).click().catch(() => undefined)
}

/**
 * "Rendered" here means the main region is on screen and one more animation
 * frame has passed. Not `networkidle`: the shell keeps an event stream open,
 * so the network never goes idle and every wait would run to its timeout.
 */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(400)
}

/**
 * Two overlays stop a click from reaching the sidebar: the cookie banner, and
 * the "unsaved changes" guard a create form raises when it is left. Neither is
 * a defect of the screen being walked, so both are answered and the walk goes
 * on — the guard with its confirm button, which is what the operator presses.
 */
async function clearOverlays(page: Page): Promise<void> {
  const cookies = page.getByRole('button', { name: /ยอมรับคุกกี้|Accept/ }).first()
  if (await cookies.isVisible().catch(() => false)) await cookies.click({ timeout: 5_000 }).catch(() => undefined)
  const leave = page.getByRole('dialog').getByRole('button', { name: /^(ยืนยัน|Confirm|Leave)$/ }).first()
  if (await leave.isVisible().catch(() => false)) await leave.click({ timeout: 5_000 }).catch(() => undefined)
}

test.describe('every screen opens (screens smoke)', () => {
  test.setTimeout(15 * 60_000)
  let cookie: string

  test.beforeAll(async ({ playwright, baseURL }) => {
    cookie = await login(playwright, baseURL)
  })

  test('every static Orva backend page renders without a client-side error', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)
    const pages = orvaBackendPages()
    expect(pages.length, 'the module tree must contain Orva pages').toBeGreaterThan(30)

    const failures: string[] = []
    for (const url of pages) {
      const before = problems.length
      await page.goto(url)
      await settled(page)
      await clearOverlays(page)
      const crashed = await crashedText(page)
      const fresh = problems.slice(before)
      if (crashed || fresh.length) failures.push(`${url}\n  ${crashed ?? ''}${fresh.map((p) => `\n  ${p}`).join('')}`)
    }
    console.log(`[smoke] ${pages.length} pages loaded, ${failures.length} with problems`)
    expect(failures, 'pages that threw on load').toEqual([])
    await context.close()
  })

  test('the sidebar can be walked forward and backward without a screen throwing', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto('/backend')
    await settled(page)
    await clearOverlays(page)
    await expandSidebar(page)
    // Only the screens that run Orva code share Orva's cache keys, so the walk
    // covers the Orva pages the sidebar lists (plus home); upstream-only pages
    // are opened by the URL test above.
    const orvaPages = new Set(orvaBackendPages())
    const hrefs = [...new Set(
      await page.locator('nav[data-testid="sidebar"] a[href^="/backend"]').evaluateAll((links) =>
        links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
      ),
    )].filter((href) => href && href !== '/backend' && orvaPages.has(href.split('?')[0]))
    expect(hrefs.length, 'the sidebar must list Orva screens to walk').toBeGreaterThan(10)

    const failures: string[] = []
    const walkTo = async (href: string, pass: string) => {
      const before = problems.length
      const started = Date.now()
      await clearOverlays(page)
      const link = page.locator(`nav[data-testid="sidebar"] a[href="${href}"]`).first()
      if (!(await link.isVisible().catch(() => false))) await expandSidebar(page)
      await link.scrollIntoViewIfNeeded().catch(() => undefined)
      try {
        await link.click({ timeout: 10_000 })
      } catch (error) {
        failures.push(`${pass} → ${href}\n  could not click the sidebar link: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
        return
      }
      await page.waitForTimeout(300)
      await clearOverlays(page)
      await page.waitForURL((url) => url.pathname === href, { timeout: 10_000 }).catch(() => undefined)
      await settled(page)
      console.log(`[smoke] ${pass} ${href} ${Date.now() - started}ms`)
      const crashed = await crashedText(page)
      const fresh = problems.slice(before)
      if (crashed || fresh.length) failures.push(`${pass} → ${href}\n  ${crashed ?? ''}${fresh.map((p) => `\n  ${p}`).join('')}`)
    }
    for (const href of hrefs) await walkTo(href, 'forward')
    for (const href of [...hrefs].reverse()) await walkTo(href, 'backward')

    console.log(`[smoke] sidebar walked ${hrefs.length} links twice, ${failures.length} problems`)
    expect(failures, 'screens that threw after client-side navigation').toEqual([])
    await context.close()
  })
})
