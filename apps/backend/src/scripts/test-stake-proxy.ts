import { ScraperService } from '../services/scraper.service.js';
import { registerAllAdapters } from '../infrastructure/network/adapters/index.js';
import { env } from '../infrastructure/config/environment.js';
import { ProxyRotator } from '../infrastructure/proxies/proxy-rotator.js';

async function testStakeWithProxy() {
  console.log('🧪 TEST STAKE CON PROXY');
  console.log('='.repeat(50));
  console.log(`🌐 PROXY_ENABLED: ${env.proxy.enabled}`);
  console.log(`🌐 PROXY_PROVIDER: ${env.proxy.provider}`);
  console.log(`🌐 PROXY_LIST_URL: ${env.proxy.listUrl || '(vacío)'}`);
  console.log(`🌐 PROXY_USERNAME: ${env.proxy.username ? '***' : '(vacío)'}`);

  const rotator = ProxyRotator.getInstance();
  const health = rotator.getHealthReport();
  console.log(`📊 Proxy health: total=${health.total} available=${health.available} inCooldown=${health.inCooldown}`);
  console.log(`📊 Proxies: ${rotator.getAllProxies().map(p => p.server).join(', ') || '(ninguno — IP directa)'}`);

  registerAllAdapters();
  const scraper = new ScraperService();

  const result = await scraper.scrapeWithCustomSelectors({
    url: 'https://stake.com.co/deportes/football',
    selectors: {
      events: 'div',
      homeTeam: 'div',
      awayTeam: 'div',
      oddsHome: 'div',
      oddsDraw: 'div',
      oddsAway: 'div',
    },
    useProxy: true,
    timeoutMs: 60000,
    sessionId: 'test-proxy',
  });

  console.log(`\n📊 RESULTADO:`);
  console.log(`  Source: ${result.source}`);
  console.log(`  Odds count: ${result.oddsCount}`);
  console.log(`  Matches: ${result.matches?.length || 0}`);
  console.log(`  Duration: ${result.durationMs}ms`);
  console.log(`  ProxyUsed: ${result.proxyUsed}`);

  if (result.matches && result.matches.length > 0) {
    const m: any = result.matches[0];
    console.log(`\n📋 Primer partido: ${m.homeTeam} vs ${m.awayTeam} | 1:${m.oddsHome} X:${m.oddsDraw} 2:${m.oddsAway}`);
  }

  if (result.source === 'network' && (result.oddsCount || 0) > 0) {
    console.log('\n✅ TEST PASADO — network con proxy');
  } else {
    console.log('\n⚠️ TEST: network no devolvió odds — revisar proxy o 406. Fallback DOM usado.');
    if (!health.available) console.log('⚠️ Sin proxies disponibles — configura PROXY_LIST_URL con IPs residenciales Webshare');
  }

  process.exit(0);
}

testStakeWithProxy().catch((e) => {
  console.error('❌ Error test', e);
  process.exit(1);
});
