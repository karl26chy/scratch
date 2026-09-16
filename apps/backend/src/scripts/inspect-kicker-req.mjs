import 'dotenv/config';
import { chromium } from 'playwright';

const proxyServer = process.env.PROXY_TEST_SERVER || 'http://31.59.20.176:6754';
const proxyUsername = process.env.PROXY_USERNAME;
const proxyPassword = process.env.PROXY_PASSWORD;

async function inspectHeaders() {
  const proxyConfig = proxyUsername && proxyPassword
    ? { server: proxyServer, username: proxyUsername, password: proxyPassword }
    : undefined;

  const browser = await chromium.launch({
    headless: true,
    proxy: proxyConfig
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });
  const page = await context.newPage();

  let reqUrl = '';
  let reqHeaders = null;

  page.on('request', req => {
    const u = req.url();
    if (u.includes('events-by-path.json') && !reqHeaders) {
      reqUrl = u;
      reqHeaders = req.headers();
      console.log('>> CAPTURED REQUEST TO events-by-path:');
      console.log('URL:', reqUrl);
      console.log('HEADERS:', JSON.stringify(reqHeaders, null, 2));
    }
  });

  page.on('response', async res => {
    const u = res.url();
    if (u.includes('events-by-path.json')) {
      console.log('>> RESPONSE FROM events-by-path:', res.status());
      if (res.status() !== 200) {
        console.log('Response body:', await res.text());
      }
    }
  });

  console.log('Navigating to football...');
  await page.goto('https://stake.com.co/deportes/football', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(15000);

  // Probar fetch desde in-page con diferentes opciones
  const testResults = await page.evaluate(async (url) => {
    if (!url) return { error: 'No url captured' };
    const tests = {};
    
    // Test 1: exact captured URL as is (sin date extra)
    try {
      const r1 = await fetch(url);
      tests.exactUrl = { status: r1.status, ok: r1.ok };
    } catch (e) {
      tests.exactUrl = { error: e.message };
    }

    // Test 2: tennis with same hidenseek
    try {
      const tennisUrl = url.replace('path=football', 'path=tennis');
      const r2 = await fetch(tennisUrl);
      const j2 = r2.ok ? await r2.json() : null;
      tests.tennis = { status: r2.status, events: j2?.events?.length };
    } catch (e) {
      tests.tennis = { error: e.message };
    }

    return tests;
  }, reqUrl);

  console.log('In-page test results:', JSON.stringify(testResults, null, 2));
  await browser.close();
}

inspectHeaders().catch(console.error);
