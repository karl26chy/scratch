import 'dotenv/config';
import { BrowserPool } from '../infrastructure/browser/browser-pool.js';
import { PlaywrightStealthFactory } from '../infrastructure/browser/playwright-stealth.factory.js';
import { FingerprintGenerator } from '../infrastructure/fingerprints/fingerprint-generator.js';

const proxyServer = process.env.PROXY_TEST_SERVER || 'http://38.154.185.97:6370';
const proxyUsername = process.env.PROXY_USERNAME;
const proxyPassword = process.env.PROXY_PASSWORD;

async function testAllCalls() {
  const proxyConfig = proxyUsername && proxyPassword
    ? { server: proxyServer, username: proxyUsername, password: proxyPassword }
    : undefined;

  const browser = await BrowserPool.getInstance().acquireBrowser(proxyConfig);
  const fp = FingerprintGenerator.generate('paranoid', 'CO');
  fp.timezoneId = 'America/Bogota';
  fp.locale = 'es-CO,es;q=0.9,en;q=0.8';

  const context = await PlaywrightStealthFactory.createContext(browser, fp, 'paranoid', proxyConfig);

  const page = await context.newPage();
  await PlaywrightStealthFactory.applyInPageEvasions(page, fp);

  page.on('response', res => {
    const u = res.url();
    if (u.includes('websbkt') || u.includes('stake.com.co') || u.includes('kicker')) {
      console.log(`[${res.status()}] ${u.slice(0, 100)}`);
    }
  });

  console.log('Navigating to football...');
  await page.goto('https://stake.com.co/deportes/football', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(6000);

  const title = await page.title();
  console.log('Page Title:', title);

  const html = await page.content();
  console.log('HTML length:', html.length);
  console.log('Contains kickertech?:', html.includes('kickertech') || html.includes('websbkt'));

  await page.close();
  await context.close();
  await browser.close();
}

testAllCalls();
