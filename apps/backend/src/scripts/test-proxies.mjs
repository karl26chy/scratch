import 'dotenv/config';
import { chromium } from 'playwright';

const rawList = process.env.PROXY_LIST_URL || '';
const proxies = rawList
  ? rawList.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

async function testProxy(pUrl) {
  const url = new URL(pUrl);
  const server = `${url.protocol}//${url.host}`;
  const username = url.username;
  const password = url.password;

  const t0 = Date.now();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      proxy: { server, username, password }
    });
    const context = await browser.newContext({
      locale: 'es-CO',
      timezoneId: 'America/Bogota'
    });
    const page = await context.newPage();
    const res = await page.goto('https://stake.com.co/deportes/football', { waitUntil: 'domcontentloaded', timeout: 12000 });
    const title = await page.title();
    const dt = Date.now() - t0;
    console.log(`✅ [${server}] OK (${dt}ms) - Title: "${title.slice(0, 35)}"`);
    await browser.close();
    return { server, ok: true, dt, title };
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    const dt = Date.now() - t0;
    console.log(`❌ [${server}] FAIL (${dt}ms): ${e.message.slice(0, 50)}`);
    return { server, ok: false, dt, error: e.message };
  }
}

async function runAll() {
  console.log('Testing all 10 proxies against stake.com.co...');
  for (const p of proxies) {
    await testProxy(p);
  }
}

runAll();
