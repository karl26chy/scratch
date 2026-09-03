import { ScraperService } from '../services/scraper.service.js';
import { registerAllAdapters } from '../infrastructure/network/adapters/index.js';

async function testStakeNetwork() {
  console.log('🧪 TEST: STAKE NETWORK INTERCEPTOR');
  console.log('='.repeat(50));

  // Registrar adapters (necesario cuando se ejecuta fuera del server)
  registerAllAdapters();
  console.log('✅ Adapters registrados');

  const scraper = new ScraperService();

  // Usamos selectores dummy: si el interceptor de red funciona, deben ignorarse y devolver odds de KickerTech
  // Si no hay payloads de red, caerá a DOM y probablemente dará 0 matches (Stake es CSR)
  const result = await scraper.scrapeWithCustomSelectors({
    url: 'https://stake.com.co/deportes/football',
    selectors: {
      events: '[id*="table-list"] > li:first-child',
      homeTeam: '.KambiBC-event-participants__name-participant-name:first-child',
      awayTeam: '.KambiBC-event-participants__name-participant-name:last-child',
      oddsHome: '.KambiBC-betty-outcome:first-child',
      oddsDraw: '.KambiBC-betty-outcome:nth-child(2)',
      oddsAway: '.KambiBC-betty-outcome:last-child',
    },
    useProxy: false,
    timeoutMs: 30000,
    sessionId: 'test-stake-network',
  });

  console.log('📊 Resultado:');
  console.log(`  success: ${result.success}`);
  console.log(`  source: ${(result as any).source}`);
  console.log(`  oddsCount: ${(result as any).oddsCount}`);
  console.log(`  htmlSize: ${(result as any).htmlSize}`);
  console.log(`  bookmaker: ${(result as any).bookmaker}`);
  console.log(`  totalMatches: ${result.totalMatches}`);
  console.log(`  durationMs: ${result.durationMs}ms`);
  console.log(`  proxyUsed: ${result.proxyUsed}`);
  if ((result as any).error) console.log(`  error: ${(result as any).error}`);

  if (result.matches && result.matches.length > 0) {
    console.log(`\n✅ ${result.matches.length} partidos capturados vía ${(result as any).source}`);
    console.log('\n📋 Primeros 3 partidos:');
    result.matches.slice(0, 3).forEach((m: any, i: number) => {
      console.log(`  [${i}] ${m.homeTeam} vs ${m.awayTeam}`);
      console.log(`      1: ${m.oddsHome} | X: ${m.oddsDraw} | 2: ${m.oddsAway} ${m.eventName ? `(${m.eventName})` : ''}`);
    });
    // Validar que las cuotas son decimales válidas
    const invalid = result.matches.filter((m: any) => !m.oddsHome || !m.oddsDraw || !m.oddsAway);
    if (invalid.length === 0) console.log('\n✅ Todas las cuotas 1X2 presentes');
    else console.log(`\n⚠️ ${invalid.length} partidos con cuotas incompletas`);
  } else {
    console.log('\n⚠️ 0 matches — puede ser DOM fallback sin Kicker payloads o selector inválido');
    if ((result as any).source === 'network' && (result as any).oddsCount === 0) {
      console.log('   → Interceptor capturó payloads pero adapter dio 0 odds (revisar stake-kicker.adapter)');
    } else if ((result as any).source === 'dom') {
      console.log('   → Cayó a DOM (no hay adapter o 0 payloads). Stake es CSR, espera network.');
    }
  }

  // Verificar también el endpoint normal /api/scrape (no custom) para comparar
  console.log('\n🔍 Comparando con executeSingleScrape (network puro)...');
  const single = await scraper.executeSingleScrape({
    url: 'https://stake.com.co/deportes/football',
    useProxy: false,
    captureScreenshot: false,
  } as any);
  console.log(`  single source: ${single.source} oddsCount: ${(single.extractedData as any)?.oddsCount} status: ${single.status}`);
  if ((single.extractedData as any)?.bookmakerOdds) {
    console.log(`  bookmakerOdds: ${(single.extractedData as any).bookmakerOdds.length}`);
    console.log(`  ejemplo:`, JSON.stringify((single.extractedData as any).bookmakerOdds.slice(0, 2), null, 2).slice(0, 800));
  }

  console.log('\n✅ Test completado');
  process.exit(0);
}

testStakeNetwork().catch((e) => {
  console.error('❌ Error test', e);
  process.exit(1);
});
