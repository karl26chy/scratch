import { config } from 'dotenv';
config();

import { ScraperService } from '../services/scraper.service.js';

async function testCustomSelectors() {
  console.log('🧪 PROBANDO SELECTORES PERSONALIZADOS');
  console.log('='.repeat(60));

  const scraper = new ScraperService();

  // Ejemplo: BetPlay (selectores reales deben ser inspeccionados con DevTools)
  // Usa https://www.livescore.com como sitio de prueba más permisivo si BetPlay bloquea
  const testUrl = process.env.TEST_URL || 'https://www.livescore.com';

  console.log(`🎯 URL: ${testUrl}`);
  console.log('⚠️  Reemplaza selectores con valores reales inspeccionados en DevTools');

  const selectors: Record<string, string> = {
    events: 'div[data-testid="event-row"], .match-card, .event-row',
    homeTeam: '.team-home, [data-home], .participant-name:first-child',
    awayTeam: '.team-away, [data-away], .participant-name:last-child',
    oddsHome: '.odds-1, .price:first-child',
    oddsDraw: '.odds-x, .price:nth-child(2)',
    oddsAway: '.odds-2, .price:last-child',
    matchTime: '.match-time, .event-time',
    leagueName: '.league-name, .tournament',
  };

  console.log('📋 Selectores:', selectors);

  const result = await scraper.scrapeWithCustomSelectors({
    url: testUrl,
    selectors,
    useProxy: false,
    timeoutMs: 30000,
    sessionId: 'test_custom',
  });

  console.log('📊 Resultado:', JSON.stringify(result, null, 2));
  if (result.success) {
    console.log(`✅ ${result.totalMatches} partidos extraídos en ${result.durationMs}ms`);
  } else {
    console.log(`❌ Error: ${result.error}`);
  }
}

testCustomSelectors().catch((e) => {
  console.error('Fatal', e);
  process.exit(1);
});
