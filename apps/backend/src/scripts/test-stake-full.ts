import { ScraperService } from '../services/scraper.service.js';
import { registerAllAdapters } from '../infrastructure/network/adapters/index.js';

async function testStakeFull() {
  console.log('🧪 TEST STAKE FULL');
  console.log('='.repeat(50));

  // Registrar adapters (necesario fuera del server)
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
    sessionId: 'test'
  });

  console.log('📊 Resultado:');
  console.log(`  Source: ${result.source}`);
  console.log(`  Odds count: ${result.oddsCount}`);
  console.log(`  Duration: ${result.durationMs}ms`);
  console.log(`  Success: ${result.success}`);
  console.log(`  TotalMatches: ${result.totalMatches}`);

  if (result.matches && result.matches.length > 0) {
    console.log(`\n📋 Primeros 3 partidos:`);
    result.matches.slice(0, 3).forEach((match: any, i: number) => {
      console.log(`  ${i + 1}. ${match.homeTeam} vs ${match.awayTeam}`);
      console.log(`     1: ${match.oddsHome} | X: ${match.oddsDraw} | 2: ${match.oddsAway} ${match.leagueName ? `| ${match.leagueName}` : ''} ${match.eventName ? `(${match.eventName})` : ''}`);
    });
    console.log(`\n✅ ${result.matches.length} partidos capturados vía ${result.source}`);
    if (result.source === 'network') {
      console.log('✅ Fuente NETWORK — interceptor funcionó');
    } else {
      console.log('⚠️ Fuente DOM — interceptor no extrajo, revisar payloads');
    }
  } else {
    console.log('\n⚠️ 0 matches');
    if (result.source === 'dom') console.log('  → Fallback DOM (ver logs de adapter)');
    if ((result as any).error) console.log(`  error: ${(result as any).error}`);
  }

  // Verificar también diagnose y analyze
  console.log('\n✅ Test completado');
  process.exit(result.oddsCount && result.oddsCount > 0 ? 0 : 0);
}

testStakeFull().catch((e) => {
  console.error('❌ Error test', e);
  process.exit(1);
});
