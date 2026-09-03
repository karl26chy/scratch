import * as fs from 'fs';
import * as path from 'path';
import { BrowserPool } from '../infrastructure/browser/browser-pool.js';
import { PlaywrightStealthFactory } from '../infrastructure/browser/playwright-stealth.factory.js';
import { FingerprintGenerator } from '../infrastructure/fingerprints/fingerprint-generator.js';
import { captureNetworkPayloads } from '../infrastructure/network/network-capture.service.js';
import { env } from '../infrastructure/config/environment.js';

const DISCOVER_WAIT_MS = 7000;

interface ResponseMeta {
  url: string;
  method: string;
  contentType: string;
  status: number;
  size: number;
}

async function debugCapture(targetUrl: string): Promise<void> {
  console.log(`🔍 DEBUG CAPTURE — ${targetUrl}`);
  console.log('='.repeat(50));

  const captured = await captureNetworkPayloads(targetUrl);
  console.log(`✅ Payloads JSON capturados: ${captured.length}`);

  const host = new URL(targetUrl).hostname.replace(/[^a-z0-9]/gi, '_');
  const outDir = path.resolve(process.cwd(), 'debug');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${host}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ url: targetUrl, captured }, null, 2), 'utf-8');

  console.log(`💾 Volcado en: ${outFile}`);
  captured.slice(0, 10).forEach((p, i) => {
    console.log(`  [${i}] ${p.url}`);
  });
}

/**
 * MODO DISCOVERY (--discover): registra TODAS las respuestas de la página sin
 * filtrar por content-type ni patrón, guardando solo metadatos (sin body) en
 * debug/betplay-all-responses.json para identificar el endpoint real de cuotas.
 */
async function discoverResponses(targetUrl: string): Promise<ResponseMeta[]> {
  const browser = await BrowserPool.getInstance().acquireBrowser();
  let context: any = null;
  let page: any = null;

  try {
    const stealthLevel = 'paranoid' as const;
    const fingerprint = FingerprintGenerator.generate(stealthLevel);
    context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel);
    page = await context.newPage();
    await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

    const metas: ResponseMeta[] = [];
    page.on('response', (response: any) => {
      const headers = response.headers();
      const cl = headers['content-length'];
      metas.push({
        url: response.url(),
        method: response.request().method(),
        contentType: headers['content-type'] || '',
        status: response.status(),
        size: cl ? parseInt(cl, 10) : 0,
      });
    });

    await page
      .goto(targetUrl, { waitUntil: 'networkidle', timeout: env.browserTimeoutMs })
      .catch((err: any) => console.warn('⚠️ discover goto:', err.message));

    await page.waitForTimeout(DISCOVER_WAIT_MS);
    return metas;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    await BrowserPool.getInstance().releaseBrowser(browser, false);
  }
}

const args = process.argv.slice(2);
const discover = args.includes('--discover');
const url = args.find((a) => a.startsWith('http'));

if (!url) {
  console.error('❌ Falta la URL. Uso:');
  console.error('   tsx src/scripts/debug-capture.ts <URL>');
  console.error('   tsx src/scripts/debug-capture.ts --discover <URL>');
  process.exit(1);
}

if (discover) {
  console.log(`🔎 DISCOVERY MODE — ${url} (espera ${DISCOVER_WAIT_MS}ms post-networkidle)`);
  console.log('='.repeat(60));

  discoverResponses(url)
    .then((metas) => {
      const outDir = path.resolve(process.cwd(), 'debug');
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, 'betplay-all-responses.json');
      fs.writeFileSync(outFile, JSON.stringify(metas, null, 2), 'utf-8');
      console.log(`💾 ${metas.length} respuestas -> ${outFile}`);

      const EXCLUDED = /(text\/html|text\/css|application\/(java)?script|image\/|font\/|application\/font)/i;
      const URL_HINT = /gateway|feed|\/api\/|v1\/|v2\/|graphql|bff|backend/i;

      const candidates = metas.filter((m) => {
        const ct = m.contentType.toLowerCase();
        const isDataLike = ct !== '' && !EXCLUDED.test(ct);
        const urlHint = URL_HINT.test(m.url);
        return isDataLike || urlHint;
      });

      console.log(`\n🎯 Candidatos a datos: ${candidates.length} / ${metas.length} total`);
      candidates.slice(0, 200).forEach((m, i) => {
        console.log(`[${i}] ${m.method} ${m.status} ${m.contentType || '(sin content-type)'} ${m.size}b  ${m.url}`);
      });
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en discovery:', err);
      process.exit(1);
    });
} else {
  debugCapture(url)
    .catch((err) => {
      console.error('❌ Error:', err);
      process.exit(1);
    })
    .finally(() => process.exit(0));
}
