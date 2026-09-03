import { FingerprintGenerator } from '../infrastructure/fingerprints/fingerprint-generator.js';

async function testFingerprint() {
  console.log('🇨🇴 TEST FINGERPRINT CO');
  console.log('='.repeat(40));

  const fingerprint = FingerprintGenerator.generate('paranoid', 'CO');

  console.log('📋 Fingerprint generado:');
  console.log(`  Locale: ${fingerprint.locale}`);
  console.log(`  Timezone: ${(fingerprint as any).timezoneId ?? (fingerprint as any).timezone}`);
  console.log(`  TimezoneId: ${fingerprint.timezoneId}`);
  console.log(`  User-Agent: ${fingerprint.userAgent}`);
  console.log(`  Viewport: ${fingerprint.viewport.width}x${fingerprint.viewport.height}`);
  console.log(`  Platform: ${fingerprint.platform}`);
  console.log(`  DeviceMemory: ${fingerprint.deviceMemory}`);
  console.log(`  HardwareConcurrency: ${fingerprint.hardwareConcurrency}`);

  // Validación
  const isCO = fingerprint.locale.includes('es-CO') && fingerprint.timezoneId === 'America/Bogota';
  console.log(`\n${isCO ? '✅' : '❌'} Validación CO: ${isCO ? 'OK - es-CO / America/Bogota' : 'FALLÓ'}`);

  // Test adicional: generar varios para ver consistencia
  console.log('\n🔁 Generando 3 fingerprints CO adicionales:');
  for (let i = 0; i < 3; i++) {
    const fp = FingerprintGenerator.generate('paranoid', 'CO');
    console.log(`  [${i + 1}] ${fp.locale} / ${fp.timezoneId} / ${fp.userAgent.slice(0, 50)}...`);
  }

  // Test DE vs CO comparativa
  console.log('\n🔍 Comparativa DE vs CO:');
  const deFp = FingerprintGenerator.generate('paranoid', 'DE');
  console.log(`  DE: ${deFp.locale} / ${deFp.timezoneId}`);
  console.log(`  CO: ${fingerprint.locale} / ${fingerprint.timezoneId}`);
}

testFingerprint().catch((e) => {
  console.error('❌ Error test', e);
  process.exit(1);
});
