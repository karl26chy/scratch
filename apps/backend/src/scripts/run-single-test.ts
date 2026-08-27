import { config } from 'dotenv';
config();

import { SingleTestService } from '../services/single-test.service.js';
import { env } from '../infrastructure/config/environment.js';

async function runSingleTest() {
  console.log('🧪 INICIANDO PRUEBA ÚNICA CON IP DOMÉSTICA');
  console.log('='.repeat(60));

  // 1. VERIFICAR CONFIGURACIÓN
  if (!env.singleTest.enabled) {
    console.error('❌ SINGLE_TEST_MODE no está activado');
    console.log('💡 Configura en .env: SINGLE_TEST_MODE=true');
    process.exit(1);
  }

  if (!env.singleTest.allowDirectIP) {
    console.error('❌ ALLOW_DIRECT_IP no está activado');
    console.log('💡 Configura en .env: ALLOW_DIRECT_IP=true');
    process.exit(1);
  }

  console.log('✅ Configuración de prueba única verificada');
  console.log(`📊 Ejecuciones permitidas: ${env.singleTest.maxExecutions}`);

  // 2. EJECUTAR PRUEBA
  try {
    const testService = SingleTestService.getInstance();

    // URL de prueba (usa un sitio menos restrictivo primero)
    const testUrl = process.env.TEST_URL || 'https://www.livescore.com';

    console.log(`🎯 URL de prueba: ${testUrl}`);
    console.log('⏳ Ejecutando... (5 segundos para cancelar)');

    const result = await testService.executeSingleTest(testUrl);

    console.log('\n📊 RESULTADO DE PRUEBA:');
    console.log(`  ✅ Éxito: ${result.success}`);
    console.log(`  🌐 IP usada: ${result.ip}`);
    console.log(`  📄 Título: ${result.title}`);
    console.log(`  🔢 Ejecución #${result.executionCount}`);

    console.log('\n⚠️  IMPORTANTE:');
    console.log('  1. Desactiva SINGLE_TEST_MODE en .env');
    console.log('  2. Vuelve a la configuración normal con proxies');
    console.log('  3. NO hagas más pruebas con IP doméstica');
    console.log('  Ejecuta: npm run test:single:disable');
  } catch (error: any) {
    console.error('❌ Error en prueba única:', error.message);
    process.exit(1);
  }
}

runSingleTest();
