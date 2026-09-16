import 'dotenv/config';
import { chromium } from 'playwright';

const proxyServer = process.env.PROXY_TEST_SERVER || 'http://31.59.20.176:6754';
const proxyUsername = process.env.PROXY_USERNAME;
const proxyPassword = process.env.PROXY_PASSWORD;

async function testKicker() {
  console.log('Testing KickerTech network calls and in-page fetch...');
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

  const kickerRequests = [];
  page.on('request', req => {
    const u = req.url();
    if (u.includes('websbkt') || u.includes('kicker') || u.includes('events-by-path')) {
      kickerRequests.push(u);
      console.log('>> REQ:', u);
    }
  });

  page.on('response', async res => {
    const u = res.url();
    if (u.includes('events-by-path')) {
      const json = await res.json().catch(() => null);
      console.log('EVENTS-BY-PATH URL:', u);
      console.log('EVENTS-BY-PATH KEYS:', Object.keys(json || {}));
      console.log('is events array?:', Array.isArray(json?.events));
      console.log('events count:', json?.events?.length);
      console.log('sample event:', JSON.stringify(json?.events?.[0] || {}).slice(0, 200));
    }
  });

  let capturedHs = '';
  let endpointBase = 'https://pre-115o-sp.websbkt.com/cache/115/es/co/America-Bogota/events-by-path.json';

  page.on('request', req => {
    const u = req.url();
    if (u.includes('hidenseek=')) {
      const match = u.match(/hidenseek=([^&]+)/);
      if (match && !capturedHs) {
        capturedHs = decodeURIComponent(match[1]);
        console.log('CAPTURED HS:', capturedHs);
      }
    }
    if (u.includes('events-by-path.json')) {
      endpointBase = u.split('?')[0];
      console.log('DETECTED BASE FROM events-by-path:', endpointBase);
    } else if (u.includes('prematch-left-menu.json')) {
      endpointBase = u.replace('prematch-left-menu.json', 'events-by-path.json').split('?')[0];
      console.log('DETECTED BASE FROM prematch-left-menu:', endpointBase);
    }
  });

  console.log('Navigating to football...');
  await page.goto('https://stake.com.co/deportes/football', { waitUntil: 'domcontentloaded', timeout: 35000 });
  console.log('Waiting 15s for full hydration...');
  await page.waitForTimeout(15000);

  // Now test in-page fetch for all 4 sports!
  const evalResult = await page.evaluate(async ({ hs, base }) => {
    const sports = ['football', 'tennis', 'basketball', 'table-tennis'];
    const results = {};
    for (const s of sports) {
      const testUrl = `${base}?path=${s}&date=2026-09-11&hidenseek=${encodeURIComponent(hs)}`;
      try {
        const res = await fetch(testUrl, { headers: { Accept: 'application/json' } });
        const json = await res.json();
        results[s] = {
          status: res.status,
          events: Array.isArray(json?.events) ? json.events.length : 0,
        };
      } catch (err) {
        results[s] = { error: err.message };
      }
    }
    return { results, baseUsed: base };
  }, { hs: capturedHs, base: endpointBase });

  console.log('\n--- 4 SPORTS FETCH RESULT ---');
  console.log(JSON.stringify(evalResult, null, 2));

  await browser.close();
}

testKicker().catch(console.error);
