import { chromium, Browser } from 'playwright';

export class BrowserFactory {
  private static instance: BrowserFactory;
  private browser: Browser | null = null;

  static getInstance(): BrowserFactory {
    if (!this.instance) {
      this.instance = new BrowserFactory();
    }
    return this.instance;
  }

  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    try {
      console.log('🚀 Lanzando navegador...');

      const launchOptions: any = {
        headless: process.env.HEADLESS_MODE !== 'false',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-infobars',
          '--window-position=0,0',
          '--ignore-certificate-errors',
        ],
      };

      this.browser = await chromium.launch(launchOptions);
      console.log('✅ Navegador lanzado correctamente');
      return this.browser;
    } catch (error: any) {
      console.error('❌ Error lanzando navegador:', error.message);
      console.log('💡 Ejecuta: npx playwright install chromium');
      throw error;
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      console.log('✅ Navegador cerrado');
    }
  }
}
