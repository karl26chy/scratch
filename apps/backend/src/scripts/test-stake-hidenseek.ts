import { ScraperService } from '../services/scraper.service.js';
import { registerAllAdapters } from '../infrastructure/network/adapters/index.js';

async function testStakeHidenseek() {
  console.log('🧪 TEST STAKE CON HIDENSEEK');
  console.log('='.repeat(50));

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
    useProxy: false,
    timeoutMs: 60000,
    sessionId: 'test-hidenseek',
  });

  console.log('\n📊 RESULTADO:');
  console.log(`  Source: ${result.source}`);
  console.log(`  Odds count: ${result.oddsCount}`);
  console.log(`  Matches: ${result.matches?.length || 0}`);
  console.log(`  Duration: ${result.durationMs}ms`);
  console.log(`  Proxy: ${result.proxyUsed}`);

  if (result.matches && result.matches.length > 0) {
    console.log('\n📋 Primer partido:');
    const m: any = result.matches[0];
    console.log(`  ${m.homeTeam} vs ${m.awayTeam}`);
    console.log(`  1: ${m.oddsHome}`);
    console.log(`  X: ${m.oddsDraw}`);
    console.log(`  2: ${m.oddsAway}`);
    if (m.eventName) console.log(`  Event: ${m.eventName}`);
    if (result.source === 'network') {
      console.log('\n✅ Source NETWORK — hidenseek funcionó');
    } else {
      console.log('\n⚠️ Source DOM — revisar logs hidenseek');
    }
  } else {
    console.log('\n⚠️ 0 matches');
    if ((result as any).error) console.log(`  error: ${(result as any).error}`);
  }

  // Verificación final
  if (result.source === 'network' && (result.oddsCount || 0) > 0) {
    console.log('\n✅ TEST PASADO — odds >0 con network');
  } else {
    console.log('\n⚠️ TEST: network no devolvió odds, fallback DOM (revisar hidenseek logs)');
  }

  process.exit(0);
}

testStakeHidenseek().catch((e) => {
  console.error('❌ Error test', e);
  process.exit(1);
});
