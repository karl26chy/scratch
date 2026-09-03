import * as fs from 'fs';
import * as path from 'path';

async function analyzeStakeData() {
  console.log('📊 ANALIZANDO DATOS DE STAKE');
  console.log('='.repeat(50));

  const debugDir = path.resolve(process.cwd(), 'debug');
  const responsesPath = path.join(debugDir, 'stake-kicker-responses.json');
  const allPath = path.join(debugDir, 'stake-all-responses.json');
  const wsPath = path.join(debugDir, 'stake-ws-frames.json');

  // 1. Leer respuestas capturadas por discovery (URLs)
  if (!fs.existsSync(responsesPath)) {
    console.log('❌ No se encontró stake-kicker-responses.json');
    console.log(`   Buscando en ${responsesPath}`);
    if (fs.existsSync(allPath)) {
      console.log('ℹ️ Existe stake-all-responses.json, analizando ese...');
      const all = JSON.parse(fs.readFileSync(allPath, 'utf8'));
      const responses = all.responses || all;
      console.log(`📦 Total de respuestas: ${responses.length}`);
      const eventResponses = responses.filter((r: any) =>
        r.url.includes('events-by-path') ||
        r.url.includes('prematch') ||
        r.url.includes('sports-payout') ||
        r.url.includes('websbkt'),
      );
      console.log(`⚽ Respuestas con eventos (por URL): ${eventResponses.length}`);
      eventResponses.slice(0, 10).forEach((r: any) => console.log(`  - ${r.status} ${r.url.slice(0, 120)}`));
    }
    return;
  }

  const responses = JSON.parse(fs.readFileSync(responsesPath, 'utf8'));

  console.log(`📦 Total de respuestas kicker: ${responses.length}`);

  // 2. Filtrar respuestas con datos de eventos
  const eventResponses = responses.filter((r: any) =>
    r.url.includes('events-by-path') ||
    r.url.includes('prematch') ||
    r.url.includes('sports-payout'),
  );

  console.log(`⚽ Respuestas con eventos: ${eventResponses.length}`);

  // 3. Mostrar estructura de una respuesta
  if (eventResponses.length > 0) {
    const sample = eventResponses[0];
    console.log('\n📋 Ejemplo de respuesta:');
    console.log(`  URL: ${sample.url}`);
    console.log(`  Status: ${sample.status}`);
    console.log(`  Content-Type: ${sample.contentType}`);

    // Intentar parsear el body (si está guardado)
    if ((sample as any).body) {
      try {
        const data = JSON.parse((sample as any).body);
        console.log('  Estructura:', Object.keys(data));
        if ((data as any).events) {
          console.log(`  Eventos: ${(data as any).events.length}`);
          if ((data as any).events.length > 0) {
            console.log('  Primer evento:', JSON.stringify((data as any).events[0], null, 2).substring(0, 800));
          }
        }
        if ((data as any).data) {
          console.log('  Data keys:', Object.keys((data as any).data));
        }
      } catch (e) {
        console.log('  Body no es JSON válido', (e as any).message);
      }
    } else {
      console.log('  ℹ️ Body no guardado en este archivo (solo URLs). Revisar captura con payloads).');
      console.log('  Tip: ejecutar captureNetworkPayloads para obtener bodies JSON completos.');
    }
  }

  // 4. Buscar capturas con bodies reales (OddsNetworkInterceptor)
  const payloadsPath = path.join(debugDir, 'stake-captured-payloads.json');
  if (fs.existsSync(payloadsPath)) {
    console.log('\n📦 Payloads capturados con bodies (OddsNetworkInterceptor):');
    const payloads = JSON.parse(fs.readFileSync(payloadsPath, 'utf8'));
    console.log(`  Total payloads: ${payloads.length}`);
    payloads.slice(0, 3).forEach((p: any, i: number) => {
      console.log(`\n  [${i}] ${p.url.slice(0, 100)}`);
      console.log(`      Keys: ${Object.keys(p.json || {}).join(', ').slice(0, 200)}`);
      const str = JSON.stringify(p.json).slice(0, 600);
      console.log(`      Preview: ${str}...`);
    });
  } else {
    console.log('\nℹ️ No existe stake-captured-payloads.json (generar con captureNetworkPayloads)');
  }

  // 5. Buscar WebSocket frames
  console.log('\n🔌 Buscando frames de WebSocket...');
  if (fs.existsSync(allPath)) {
    const all = JSON.parse(fs.readFileSync(allPath, 'utf8'));
    const wsEvents = all.wsEvents || [];
    console.log(`  WebSocket frames: ${wsEvents.length}`);
    wsEvents.slice(0, 5).forEach((w: any, i: number) => {
      console.log(`  [${i}] ${w.type} ${w.url.slice(0, 80)} ${w.payload ? w.payload.slice(0, 150) : ''}`);
    });
    // Buscar sports-payout en WS
    const payoutFrames = wsEvents.filter((w: any) => w.payload && w.payload.includes('sports-payout'));
    console.log(`  sports-payout frames: ${payoutFrames.length}`);
    if (payoutFrames.length > 0) {
      console.log(`  Ejemplo payout: ${payoutFrames[0].payload.slice(0, 800)}`);
    }
  } else {
    const wsFrames = responses.filter((r: any) => r.url.includes('socket.io'));
    console.log(`  WebSocket frames (por URL): ${wsFrames.length}`);
  }

  // 6. Intentar leer HTML dump para ver si hay datos embebidos
  const htmlFiles = fs.readdirSync(debugDir).filter((f) => f.startsWith('stake') && f.endsWith('.html'));
  if (htmlFiles.length > 0) {
    console.log(`\n📄 HTML dumps: ${htmlFiles.join(', ')}`);
  }
}

analyzeStakeData().catch((e) => {
  console.error('Error analyze', e);
  process.exit(1);
});
