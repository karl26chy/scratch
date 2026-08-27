#!/usr/bin/env tsx
/**
 * Verificación del sistema de proxies residenciales rotativos
 * Genera reporte diagnóstico para confirmar que el error de conexión está resuelto.
 * 
 * Uso:
 *   npm run dev --workspace=@stealth-scraper/backend
 *   tsx src/scripts/verify-proxy.ts
 *   tsx src/scripts/verify-proxy.ts --json
 */

import { env } from '../infrastructure/config/environment.js';
import { ProxyRotator } from '../infrastructure/proxies/proxy-rotator.js';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const pinnacleTest = args.includes('--pinnacle') || args.includes('--real');

function maskSecret(val?: string): string {
  if (!val) return '(vacío)';
  if (val.length <= 4) return '****';
  return val.substring(0, 3) + '****' + val.substring(val.length - 2);
}

function printSection(title: string, lines: string[]) {
  if (jsonOutput) return;
  console.log(`\n=== ${title} ===`);
  lines.forEach((l) => console.log(l));
}

async function main() {
  const rotator = ProxyRotator.getInstance();
  const health = rotator.getHealthReport();
  const proxies = rotator.getAllProxies();

  const report = {
    timestamp: new Date().toISOString(),
    env: {
      proxyEnabled: env.proxy.enabled,
      provider: env.proxy.provider,
      listUrl: env.proxy.listUrl ? `${env.proxy.listUrl.substring(0, 60)}${env.proxy.listUrl.length > 60 ? '...' : ''}` : '(vacío)',
      hasUsername: !!env.proxy.username,
      hasPassword: !!env.proxy.password,
      hasApiKey: !!env.proxy.apiKey,
      testUrl: env.proxy.testUrl,
      headless: env.headlessMode,
      timeoutMs: env.browserTimeoutMs,
    },
    pool: health,
    proxies: proxies.map((p) => ({
      id: p.id,
      server: p.server,
      protocol: p.protocol,
      hasAuth: !!(p.username && p.password),
      failsCount: p.failsCount,
      lastUsedAt: p.lastUsedAt,
      health: p.health,
    })),
    diagnosis: [] as string[],
    nextSteps: [] as string[],
  };

  // Diagnóstico
  if (!env.proxy.enabled) {
    report.diagnosis.push('❌ PROXY_ENABLED=false -> Sistema usa IP doméstica directa. Pinnacle bloqueará.');
    report.nextSteps.push('Setea PROXY_ENABLED=true y PROXY_LIST_URL="http://user:pass@host:port,http://user2:pass@host2:port"');
    report.nextSteps.push('Proveedor recomendado: Webshare (10 proxies gratis) -> https://www.webshare.io/');
  } else if (health.total === 0) {
    report.diagnosis.push('❌ PROXY_ENABLED=true pero pool vacío (0 proxies).');
    report.diagnosis.push(`   PROXY_LIST_URL actual: ${maskSecret(env.proxy.listUrl)}`);
    report.nextSteps.push('Formato esperado: "http://proxy.webshare.io:80,http://proxy.webshare.io:81" o "socks5://user:pass@host:1080"');
    report.nextSteps.push('Alternativa JSON: \'["http://host:8000","socks5://host:1080"]\'');
    if (!env.proxy.username || !env.proxy.password) {
      report.nextSteps.push('Si tu proveedor requiere auth global, setea PROXY_USERNAME y PROXY_PASSWORD');
    }
  } else if (health.available === 0) {
    report.diagnosis.push('⚠️ Todos los proxies en cooldown (fallos consecutivos >=3).');
    report.nextSteps.push('Espera 5m (cooldown) o rota manualmente: POST /api/scrapers/proxies/rotate {sessionId}');
  } else {
    report.diagnosis.push(`✅ Pool operativo: ${health.available}/${health.total} proxies disponibles vía ${health.provider}`);
    report.diagnosis.push('   Cada request usa proxy rotativo con sticky-session por bookmaker (aislamiento 100%).');
  }

  // Métricas de rendimiento
  const performance = (health as any).performance || { avgLatencyMs: 0, totalRequests: 0, totalSuccesses: 0, globalSuccessRate: 0, bestProxy: null };
  if (!jsonOutput && health.total > 0) {
    printSection('MÉTRICAS DE RENDIMIENTO', [
      `  Avg Latency: ${performance.avgLatencyMs}ms`,
      `  Total Requests: ${performance.totalRequests}`,
      `  Total Successes: ${performance.totalSuccesses}`,
      `  Global Success Rate: ${(performance.globalSuccessRate * 100).toFixed(1)}%`,
      `  Best Proxy: ${performance.bestProxy ? `${performance.bestProxy.server} (success ${(performance.bestProxy.successRate * 100).toFixed(1)}%, ${performance.bestProxy.avgLatencyMs}ms)` : 'N/A'}`,
    ]);
    const perfDetails = (rotator as any).getPerformanceMetrics ? (rotator as any).getPerformanceMetrics() : [];
    if (perfDetails.length > 0) {
      console.log('  Detalle por proxy:');
      perfDetails.slice(0, 5).forEach((m: any) => {
        console.log(`    - ${m.server}: ${m.successRate ? (m.successRate * 100).toFixed(1) : '0.0'}% success, avg ${m.avgLatencyMs}ms, req ${m.totalRequests}, CD=${m.inCooldown ? 'sí' : 'no'}`);
      });
    }
  }

  // Test de conectividad por proxy
  if (proxies.length > 0) {
    printSection('Test de conectividad (validación formato)', []);
    for (const p of proxies.slice(0, 3)) {
      const res = await rotator.testProxyConnectivity(p);
      const line = res.success ? `✅ ${p.server} (${p.protocol}) OK latency=${res.latencyMs}ms` : `❌ ${p.server} FAIL: ${res.error}`;
      if (!jsonOutput) console.log(line);
      report.diagnosis.push(line);
    }
    if (proxies.length > 3 && !jsonOutput) console.log(`... y ${proxies.length - 3} más (usa GET /proxies/health para ver todos)`);
  }

  // Prueba real con Pinnacle (requiere --pinnacle)
  if (pinnacleTest) {
    printSection('PRUEBA REAL PINNACLE', ['  Lanzando scrape real a https://www.pinnacle.com ...']);
    try {
      const { ScraperService } = await import('../services/scraper.service.js');
      const svc = new ScraperService();
      const pinnacleUrl = 'https://www.pinnacle.com/en/odds/match/soccer';
      const start = Date.now();
      const result = await svc.executeSingleScrape({
        url: pinnacleUrl,
        useProxy: env.proxy.enabled,
        captureScreenshot: false,
        timeoutMs: 20000,
      });
      const elapsed = Date.now() - start;
      const statusLine = `  Pinnacle status=${result.status} code=${result.statusCode} title="${result.pageTitle?.substring(0, 60)}" duration=${elapsed}ms proxy=${result.stealthMetrics.proxyUsed} antiBotBypass=${result.stealthMetrics.bypassedAntiBot} captcha=${(result.extractedData as any)?.captchaDetected ? (result.extractedData as any)?.captchaType : 'no'}`;
      if (!jsonOutput) console.log(statusLine);
      report.diagnosis.push(statusLine);
      if (result.status === 'SUCCESS' || result.status === 'DOM_STRUCTURE_CHANGED') {
        report.diagnosis.push('✅ Pinnacle accesible → proxy funcional, error de conexión resuelto');
      } else if (result.status === 'BLOCKED') {
        report.diagnosis.push('❌ Pinnacle BLOCKED → proxy insuficiente o IP aún bloqueada');
        report.nextSteps.push('Prueba rotación: usa otro proxy o proveedor residencial premium (BrightData/Oxylabs)');
      } else {
        report.diagnosis.push(`⚠️ Pinnacle ERROR: ${JSON.stringify(result.extractedData)}`);
      }
      // @ts-ignore
      report.pinnacleTest = { url: pinnacleUrl, status: result.status, elapsedMs: elapsed, result: jsonOutput ? result : undefined };
    } catch (err: any) {
      const line = `  ❌ Pinnacle probe falló: ${err.message}`;
      if (!jsonOutput) console.log(line);
      report.diagnosis.push(line);
    }
  } else if (!jsonOutput && health.available > 0) {
    console.log('\n  Tip: usa --pinnacle para prueba real contra Pinnacle (requiere browser + proxy)');
  }

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printSection('CONFIGURACIÓN PROXY (env)', [
    `  PROXY_ENABLED=${env.proxy.enabled}`,
    `  PROXY_PROVIDER=${env.proxy.provider}`,
    `  PROXY_LIST_URL=${maskSecret(env.proxy.listUrl)} ${env.proxy.listUrl ? `(${health.total} proxies parseados)` : ''}`,
    `  PROXY_USERNAME=${maskSecret(env.proxy.username)}`,
    `  PROXY_PASSWORD=${env.proxy.password ? '****' : '(vacío)'}`,
    `  PROXY_API_KEY=${env.proxy.apiKey ? '****' : '(vacío)'}`,
    `  PROXY_TEST_URL=${env.proxy.testUrl}`,
  ]);

  printSection('POOL DE PROXIES', [
    `  Total: ${health.total}`,
    `  Disponibles: ${health.available}`,
    `  En cooldown: ${health.inCooldown}`,
    `  Detalle:`,
    ...proxies.map((p) => `    - ${p.id} | ${p.server} | ${p.protocol} | auth=${!!(p.username && p.password)} | fails=${p.failsCount} | health=${JSON.stringify(p.health)}`),
    ...(proxies.length === 0 ? ['    (vacío - configura PROXY_LIST_URL)'] : []),
  ]);

  printSection('DIAGNÓSTICO', report.diagnosis.map((d) => `  ${d}`));

  printSection('PRÓXIMOS PASOS', report.nextSteps.map((s, i) => `  ${i + 1}. ${s}`));

  printSection('ENDPOINTS DE VERIFICACIÓN', [
    '  GET  /api/health              -> incluye proxy.healthReport',
    '  GET  /api/scrapers/proxies/health -> diagnóstico completo',
    '  POST /api/scrapers/proxies/test   -> {proxyId?} test conectividad',
    '  POST /api/scrapers/proxies/rotate -> {sessionId} rotación forzada',
    '  POST /api/scrapers/run       -> {url, useProxy:true} scrape con proxy',
  ]);

  printSection('EJEMPLO WEBshare', [
    '  1. Registra https://www.webshare.io/ (10 proxies gratis)',
    '  2. Copia Proxy List -> formato "p.webshare.io:80:user:pass"',
    '  3. Convierte a: "http://user:pass@p.webshare.io:80,http://user:pass@p.webshare.io:81"',
    '  4. .env: PROXY_ENABLED=true',
    '          PROXY_LIST_URL="http://user:pass@p.webshare.io:80,http://user:pass@p.webshare.io:81,..."',
    '          PROXY_PROVIDER=webshare',
    '  5. Reinicia: docker compose up --build  o  npm run dev',
    '  6. Verifica: curl http://localhost:4000/api/scrapers/proxies/health',
  ]);

  console.log('\n' + (health.available > 0 ? '✅ SISTEMA PROXY FUNCIONAL' : '⚠️  SISTEMA PROXY REQUIERE CONFIGURACIÓN') + '\n');
}

main().catch((err) => {
  console.error('Error verificando proxies:', err);
  process.exit(1);
});
