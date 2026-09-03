import fs from 'fs';
import path from 'path';

async function analyzeStakePayloads() {
  console.log('🔍 ANALIZANDO PAYLOADS DE STAKE');
  console.log('='.repeat(50));

  // 1. Leer payloads capturados - probar varias rutas
  const possiblePaths = [
    'debug/stake-captured-payloads.json',
    'apps/backend/debug/stake-captured-payloads.json',
    path.resolve(process.cwd(), 'debug/stake-captured-payloads.json'),
    path.resolve(process.cwd(), 'apps/backend/debug/stake-captured-payloads.json'),
  ];

  let payloadsPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      payloadsPath = p;
      break;
    }
  }

  if (!payloadsPath) {
    console.log('❌ No se encontró stake-captured-payloads.json');
    console.log('Rutas probadas:', possiblePaths);
    // Intentar listar debug
    try {
      const debugDir = fs.existsSync('debug') ? 'debug' : path.resolve(process.cwd(), 'debug');
      console.log('Contenido debug:', fs.readdirSync(debugDir).slice(0, 10));
    } catch {}
    return;
  }

  console.log(`📂 Archivo: ${payloadsPath}`);
  const raw = fs.readFileSync(payloadsPath, 'utf8');
  const payloads = JSON.parse(raw);
  console.log(`📦 Total payloads: ${payloads.length}`);

  // 2. Filtrar por URL events-by-path
  const eventPayloads = payloads.filter((p: any) => p.url && p.url.includes('events-by-path'));
  console.log(`⚽ Event payloads (events-by-path): ${eventPayloads.length}`);

  const prematchPayloads = payloads.filter((p: any) => p.url && p.url.includes('prematch'));
  console.log(`🏆 Prematch payloads: ${prematchPayloads.length}`);

  const allKicker = payloads.filter((p: any) => /websbkt|kicker|events-by-path|prematch|cache\/115/i.test(p.url));
  console.log(`🎯 Kicker-related payloads: ${allKicker.length}`);

  // Mostrar todos los URLs capturados para diagnóstico
  console.log('\n📋 URLs capturadas:');
  payloads.slice(0, 15).forEach((p: any, i: number) => {
    console.log(`  [${i}] ${p.status || 200} ${p.url.slice(0, 120)} | keys: ${Object.keys(p.json || p.body || {}).slice(0, 5).join(',')}`);
  });

  // 3. Mostrar estructura de un payload con eventos
  // Buscar primero payload con main_odds, luego cualquier con events
  let sample: any = null;
  for (const p of payloads) {
    const data = p.json || (p.body ? (typeof p.body === 'string' ? JSON.parse(p.body) : p.body) : null);
    if (data && data.events && Array.isArray(data.events) && data.events.length > 0 && data.events[0]?.main_odds) {
      sample = p;
      break;
    }
  }
  if (!sample) {
    // Fallback a cualquier con events
    sample = payloads.find((p: any) => {
      const d = p.json || p.body;
      const data = typeof d === 'string' ? (() => { try { return JSON.parse(d); } catch { return null; } })() : d;
      return data && data.events && data.events.length > 0;
    }) || eventPayloads[0];
  }

  if (sample) {
    console.log('\n📋 Estructura del payload (sample con eventos):');
    console.log(`  URL: ${sample.url}`);
    console.log(`  Status: ${sample.status || 200}`);
    const data = sample.json || (typeof sample.body === 'string' ? JSON.parse(sample.body) : sample.body);
    if (data) {
      console.log('  Keys:', Object.keys(data));
      if (data.events) {
        console.log(`  Eventos: ${Array.isArray(data.events) ? data.events.length : Object.keys(data.events).length}`);
        if (Array.isArray(data.events) && data.events.length > 0) {
          const event = data.events[0];
          console.log('  Primer evento keys:', Object.keys(event));
          if (event.main_odds) console.log('  main_odds keys:', Object.keys(event.main_odds));
          if (event.main_odds?.main) {
            const mainKeys = Object.keys(event.main_odds.main);
            console.log(`  main_odds.main keys: ${mainKeys.slice(0, 5).join(',')} (${mainKeys.length} total)`);
            const firstOdd = (event.main_odds.main as any)[mainKeys[0]];
            console.log('  Primer odd:', JSON.stringify(firstOdd, null, 2).substring(0, 500));
          }
          if (event.teams) console.log('  teams:', event.teams);
          if (event.tournament_name) console.log('  tournament:', event.tournament_name);
          console.log('  Evento completo (trunc):', JSON.stringify(event, null, 2).substring(0, 800));
        }
      }
      if (data.data?.events) console.log(`  data.events: ${data.data.events.length}`);
      if (data.items) console.log(`  items: ${data.items.length}`);
    }
  } else {
    console.log('\n⚠️ No se encontró payload con events/main_odds. Revisando payloads con body/json:');
    payloads.slice(0, 3).forEach((p: any, i: number) => {
      const d = p.json || p.body;
      console.log(`  [${i}] url=${p.url.slice(0,80)} hasJson=${!!p.json} hasBody=${!!p.body} keys=${Object.keys(d||{}).slice(0,5)}`);
      if (d) console.log(`      sample: ${JSON.stringify(d).substring(0, 300)}`);
    });
  }

  // 4. Resumen para adapter
  console.log('\n✅ Resumen para adapter:');
  const withMainOdds = payloads.filter((p: any) => {
    const d = p.json || p.body;
    const data = typeof d === 'string' ? (() => { try { return JSON.parse(d); } catch { return null; } })() : d;
    return data?.events?.[0]?.main_odds;
  });
  console.log(`  Payloads con main_odds.main: ${withMainOdds.length}`);

  const withMarkets = payloads.filter((p: any) => {
    const d = p.json || p.body;
    const data = typeof d === 'string' ? (() => { try { return JSON.parse(d); } catch { return null; } })() : d;
    return data?.events?.[0]?.markets;
  });
  console.log(`  Payloads con markets: ${withMarkets.length}`);

  const wsPayloads = payloads.filter((p: any) => p.url.includes('fews.stake') || p.url.includes('scws'));
  console.log(`  WS payloads: ${wsPayloads.length}`);
}

analyzeStakePayloads().catch((e) => {
  console.error('❌ Error', e);
  process.exit(1);
});
