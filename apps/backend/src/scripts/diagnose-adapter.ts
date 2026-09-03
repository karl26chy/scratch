import { SiteAdapterRegistry } from '../infrastructure/network/adapter-registry.js';
import { registerAllAdapters } from '../infrastructure/network/adapters/index.js';

async function diagnoseAdapter() {
  console.log('🔍 DIAGNÓSTICO DE ADAPTERS');
  console.log('='.repeat(50));

  // 1. Registrar adapters
  registerAllAdapters();
  const registry = SiteAdapterRegistry.getInstance();

  // 2. Listar todos los dominios registrados
  const domains = registry.getAllDomains();
  console.log('📋 Dominios registrados:');
  if (domains.length === 0) {
    console.log('  (ninguno)');
  } else {
    domains.forEach((d) => console.log(`  - ${d}`));
  }
  console.log(`\n🔍 Total adapters: ${domains.length}`);
  console.log(`🔍 list(): ${registry.list().map((a) => a.domain).join(', ') || '(vacío)'}`);

  // 3. Probar URL específica
  const testUrls = [
    'https://stake.com.co/deportes/football',
    'https://stake.com.co/',
    'https://www.stake.com.co/',
    'https://stake.com.co',
    'https://www.stake.com.co/deportes/football?foo=bar',
  ];

  for (const url of testUrls) {
    const adapter = registry.getForUrl(url);
    console.log(`\n${url}:`);
    console.log(`  Adapter: ${adapter ? `✅ ${adapter.domain}` : '❌ No encontrado'}`);
    if (adapter) {
      console.log(`  Patrones: ${adapter.urlPatterns.length} -> ${adapter.urlPatterns.slice(0, 3).map((r) => r.source).join(', ')}`);
    }
  }

  // 4. Verificar que el adapter de Stake está registrado
  const stakeAdapter = registry.getForDomain('stake.com.co');
  console.log(`\n✅ Stake adapter (getForDomain): ${stakeAdapter ? `Registrado (${stakeAdapter.domain})` : '❌ NO REGISTRADO'}`);

  const stakeViaUrl = registry.getForUrl('https://stake.com.co/deportes/football');
  console.log(`✅ Stake adapter (getForUrl): ${stakeViaUrl ? `Encontrado (${stakeViaUrl.domain})` : '❌ NO ENCONTRADO'}`);

  // 5. Test normalización con www y subdominios
  console.log('\n🔍 Test normalización:');
  const normTests = [
    { url: 'https://www.stake.com.co/', expected: true },
    { url: 'https://m.stake.com.co/', expected: true },
    { url: 'https://stake.com.co', expected: true },
    { url: 'https://bet365.com', expected: false },
  ];
  for (const t of normTests) {
    const a = registry.getForUrl(t.url);
    const ok = !!a === t.expected ? '✅' : '❌';
    console.log(`  ${ok} ${t.url} -> ${a ? a.domain : 'null'} (esperado ${t.expected ? 'encontrado' : 'null'})`);
  }

  console.log('\n' + '='.repeat(50));
  if (stakeAdapter && stakeViaUrl) {
    console.log('✅ DIAGNÓSTICO OK: Stake adapter correctamente registrado y resoluble por URL');
  } else {
    console.log('❌ DIAGNÓSTICO FALLIDO: Revisar registro en adapters/index.ts y adapter-registry.ts');
  }
}

diagnoseAdapter().catch((e) => {
  console.error('❌ Error diagnóstico', e);
  process.exit(1);
});
