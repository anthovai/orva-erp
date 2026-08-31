import fs from 'node:fs'
import path from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { createLogger } from '@open-mercato/shared/lib/logger'

/**
 * Server-side PDF by printing the app's own preview screen in headless
 * Chromium.
 *
 * Why a browser rather than a PDF library: the templates are already HTML +
 * Tailwind and render Thai correctly. A second renderer (react-pdf, pdfkit)
 * would mean maintaining two versions of every template — and getting Thai
 * text shaping right, where tone marks stack over vowels over consonants, is
 * exactly what Chromium's text engine already does and a PDF primitive
 * library does not. Printing the same URL the operator previewed guarantees
 * the file matches the screen.
 *
 * `puppeteer-core` ships no browser. Resolution order:
 *   1. ORVA_PDF_BROWSER_PATH — what a production image should set
 *   2. the Chromium Playwright already downloaded for integration tests (dev)
 *   3. a system Chrome install
 * When none is found the caller gets a clear 503 rather than a stack trace.
 */

const logger = createLogger('orva_documents').child({ component: 'pdf' })

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrowserUnavailableError'
  }
}

function playwrightChromium(): string | null {
  const home = process.env.LOCALAPPDATA || process.env.HOME || ''
  const roots = [
    path.join(home, 'ms-playwright'),
    path.join(home, '.cache', 'ms-playwright'),
  ]
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    // newest build wins; the folder name carries the revision
    const builds = fs
      .readdirSync(root)
      .filter((name) => name.startsWith('chromium-'))
      .sort()
      .reverse()
    for (const build of builds) {
      const candidates = [
        path.join(root, build, 'chrome-win', 'chrome.exe'),
        path.join(root, build, 'chrome-linux', 'chrome'),
        path.join(root, build, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ]
      const found = candidates.find((candidate) => fs.existsSync(candidate))
      if (found) return found
    }
  }
  return null
}

const SYSTEM_CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

export function resolveBrowserExecutable(): string {
  const configured = process.env.ORVA_PDF_BROWSER_PATH
  if (configured) {
    if (!fs.existsSync(configured)) {
      throw new BrowserUnavailableError(
        `ORVA_PDF_BROWSER_PATH points at ${configured}, which does not exist`,
      )
    }
    return configured
  }
  const fromPlaywright = playwrightChromium()
  if (fromPlaywright) return fromPlaywright
  const fromSystem = SYSTEM_CHROME.find((candidate) => fs.existsSync(candidate))
  if (fromSystem) return fromSystem
  throw new BrowserUnavailableError(
    'No Chromium found for PDF rendering. Set ORVA_PDF_BROWSER_PATH to a Chromium executable.',
  )
}

export type RenderPdfOptions = {
  /** Absolute URL of the preview screen to print. */
  url: string
  /**
   * Session cookie so the print page loads as the requesting user. Omitted
   * for the token-scoped customer page, which authenticates by its own URL
   * and must never be printed with a staff session attached.
   */
  authToken?: string
  /** Cookie domain — the app host. */
  host: string
  /** Locale cookie so the sheet prints in the operator's language. */
  locale?: string
}

export async function renderDocumentPdf({ url, authToken, host, locale }: RenderPdfOptions): Promise<Uint8Array> {
  const executablePath = resolveBrowserExecutable()
  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    // The preview screen is behind auth; hand Chromium the caller's own
    // session rather than minting a second credential path.
    const cookies = [
      ...(authToken
        ? [{ name: 'auth_token', value: authToken, domain: host, path: '/', httpOnly: true, secure: false }]
        : []),
      ...(locale ? [{ name: 'locale', value: locale, domain: host, path: '/', httpOnly: false, secure: false }] : []),
    ]
    if (cookies.length) await browser.setCookie(...cookies)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
    // the sheet renders after its data fetch resolves
    await page.waitForSelector('[data-document-sheet="true"]', { timeout: 30_000 })
    await page.emulateMediaType('print')
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    })
  } catch (error) {
    if (error instanceof BrowserUnavailableError) throw error
    logger.error('PDF render failed', { url, err: error instanceof Error ? error.message : String(error) })
    throw error
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

/** `ใบกำกับภาษี-QT-2026-0001.pdf`, safe for a Content-Disposition header. */
export function pdfFileName(headingTh: string, documentNumber: string): string {
  const base = `${headingTh}-${documentNumber || 'document'}`.replace(/[\\/:*?"<>|]/g, '-')
  return `${base}.pdf`
}
