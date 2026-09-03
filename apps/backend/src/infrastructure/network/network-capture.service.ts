import * as fs from 'fs';
import * as path from 'path';
import type { BrowserContext, Page } from 'playwright';
import { BrowserPool } from '../browser/browser-pool.js';
import { PlaywrightStealthFactory } from '../browser/playwright-stealth.factory.js';
import { FingerprintGenerator } from '../fingerprints/fingerprint-generator.js';
import { OddsNetworkInterceptor, type CapturedPayload } from './odds-interceptor.js';
import { env } from '../config/environment.js';

// Patrones específicos para KickerTech (Stake) — deben capturarse aunque no contengan /api/
export const KICKER_PATTERNS: RegExp[] = [
  /kickertech/i,
  /odds\.kickertech/i,
  /kicker/i,
  /sb\/api/i,
  /sportsbook\/odds/i,
  /market/i,
  /event/i,
  /websbkt/i,
  /events-by-path/i,
  /prematch-by-tournaments/i,
  /cache\/115/i,
];

export const BROAD_CAPTURE_PATTERNS: RegExp[] = [
  /\/api\//i,
  /\/graphql/i,
  /odds/i,
  /market/i,
  /sport/i,
  /event/i,
  /\.json/i,
  ...KICKER_PATTERNS,
];

/**
 * Navega con stealth y captura todas las respuestas JSON de red que matcheen los
 * patrones indicados. Reutilizado por el script de debug y por el endpoint
 * POST /api/debug/capture para evitar duplicar la lógica de Playwright.
 */
export async function captureNetworkPayloads(
  targetUrl: string,
  patterns: RegExp[] = BROAD_CAPTURE_PATTERNS,
): Promise<CapturedPayload[]> {
  const browser = await BrowserPool.getInstance().acquireBrowser();
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const stealthLevel = 'paranoid' as const;
    const fingerprint = FingerprintGenerator.generate(stealthLevel);
    context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel);
    page = await context.newPage();
    await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

    const interceptor = new OddsNetworkInterceptor(patterns);
    interceptor.attach(page);

    await page
      .goto(targetUrl, { waitUntil: 'networkidle', timeout: env.browserTimeoutMs })
      .catch((err: any) => console.warn('⚠️ captureNetworkPayloads goto:', err.message));

    await page.waitForTimeout(7000);

    return interceptor.getCaptured();
  } finally {
    // Captura de diagnóstico temporal: útil si count=0 (bloqueo, login, captcha, etc.)
    try {
      if (page) {
        const dir = path.resolve(process.cwd(), 'debug');
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, 'betplay-check.png') }).catch(() => {});
        const info: Record<string, unknown> = {};
        info.title = await page.title().catch(() => '(sin titulo)');
        info.finalUrl = page.url();
        const html = await page.content().catch(() => '');
        info.htmlLength = html.length;
        info.htmlHead = html.slice(0, 1500);
        fs.writeFileSync(path.join(dir, 'betplay-check.json'), JSON.stringify(info, null, 2), 'utf-8');
        if (html) fs.writeFileSync(path.join(dir, 'betplay-check.html'), html, 'utf-8');
      }
    } catch {
      // ignorar fallos de diagnóstico
    }
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    await BrowserPool.getInstance().releaseBrowser(browser, false);
  }
}
