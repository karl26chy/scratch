import { env } from '../infrastructure/config/environment.js';
import { chromium } from 'playwright';

export class SingleTestService {
  private static instance: SingleTestService;
  private executionCount = 0;

  static getInstance(): SingleTestService {
    if (!this.instance) {
      this.instance = new SingleTestService();
    }
    return this.instance;
  }

  async executeSingleTest(url: string): Promise<any> {
    // 1. VERIFICAR QUE ES PRUEBA ÚNICA
    if (!env.singleTest.enabled) {
      throw new Error('❌ Modo prueba única no activado');
    }

    // 2. CONTADOR DE EJECUCIONES
    this.executionCount++;
    if (this.executionCount > env.singleTest.maxExecutions) {
      throw new Error(`❌ Límite de ${env.singleTest.maxExecutions} ejecución(es) alcanzado`);
    }

    if (!env.singleTest.allowDirectIP) {
      throw new Error('❌ ALLOW_DIRECT_IP no está activado - IP doméstica bloqueada');
    }

    // 3. ADVERTENCIA ENORME EN CONSOLA
    console.log('='.repeat(80));
    console.log('⚠️  PRUEBA ÚNICA CON IP DOMÉSTICA - EJECUCIÓN #' + this.executionCount);
    console.log('🔴 ESTA ES LA ÚNICA EJECUCIÓN PERMITIDA');
    console.log('🔴 DESPUÉS DE ESTA PRUEBA, DESACTIVA SINGLE_TEST_MODE');
    console.log('='.repeat(80));

    // 4. ESPERA DE SEGURIDAD (5 segundos para cancelar)
    console.log('⏳ Presiona Ctrl+C para cancelar (5 segundos)...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 5. EJECUTAR SCRAPING CON IP DIRECTA
    try {
      console.log('🚀 Iniciando scraping con IP doméstica...');

      const browser = await chromium.launch({
        headless: false, // Visible para ver qué pasa
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });

      const page = await browser.newPage();

      // Verificar IP
      try {
        await page.goto('https://api.ipify.org?format=json', { timeout: 15000, waitUntil: 'domcontentloaded' });
        const ip = await page.textContent('body');
        console.log('🌐 IP doméstica:', ip);
      } catch {
        console.log('🌐 IP doméstica: no se pudo verificar (continuando)');
      }

      // Scraping real
      console.log('🎯 Intentando cargar:', url);
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      const title = await page.title();
      console.log('📄 Título:', title);

      // Screenshot
      try {
        await page.screenshot({ path: `single-test-${Date.now()}.png` });
        console.log('📸 Screenshot guardado');
      } catch {
        console.log('📸 Screenshot falló (continuando)');
      }

      await browser.close();

      console.log('✅ PRUEBA ÚNICA COMPLETADA');
      console.log('🔴 RECUERDA: DESACTIVAR SINGLE_TEST_MODE AHORA');
      console.log('🔒 Ejecuta: npm run test:single:disable');

      const ipText = 'IP doméstica directa';
      return {
        success: true,
        ip: ipText,
        title,
        url,
        executionCount: this.executionCount,
      };
    } catch (error: any) {
      console.error('❌ Error en prueba única:', error.message);
      throw error;
    }
  }

  getExecutionCount(): number {
    return this.executionCount;
  }

  reset(): void {
    this.executionCount = 0;
  }
}
