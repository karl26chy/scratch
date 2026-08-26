import { Browser } from 'playwright';
import { PlaywrightStealthFactory } from './playwright-stealth.factory.js';
import { env } from '../config/environment.js';

export class BrowserPool {
  private static instance: BrowserPool;
  private primaryBrowser: Browser | null = null;
  private activeBorrowCount = 0;

  private constructor() {}

  public static getInstance(): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool();
    }
    return BrowserPool.instance;
  }

  public async acquireBrowser(proxyServer?: string): Promise<Browser> {
    // If a custom proxy is required for this specific request, launch an isolated instance
    if (proxyServer) {
      return await PlaywrightStealthFactory.launchBrowser(proxyServer);
    }

    if (!this.primaryBrowser || !this.primaryBrowser.isConnected()) {
      this.primaryBrowser = await PlaywrightStealthFactory.launchBrowser();
    }

    this.activeBorrowCount++;
    return this.primaryBrowser;
  }

  public async releaseBrowser(browser: Browser, isCustomProxy: boolean = false): Promise<void> {
    if (isCustomProxy) {
      await browser.close().catch(() => {});
      return;
    }

    this.activeBorrowCount = Math.max(0, this.activeBorrowCount - 1);
  }

  public getStats() {
    return {
      activeBorrowCount: this.activeBorrowCount,
      maxCapacity: env.maxConcurrentBrowsers,
      isConnected: this.primaryBrowser ? this.primaryBrowser.isConnected() : false,
    };
  }

  public async shutdown(): Promise<void> {
    if (this.primaryBrowser) {
      await this.primaryBrowser.close().catch(() => {});
      this.primaryBrowser = null;
    }
  }
}
