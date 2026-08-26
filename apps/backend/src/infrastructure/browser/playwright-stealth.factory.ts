import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, Page } from 'playwright';
import { BrowserFingerprint, StealthLevel } from '../../domain/types/scraper.types.js';
import { env } from '../config/environment.js';

// Apply the stealth evasion plugin to playwright-extra
chromium.use(stealthPlugin());

export class PlaywrightStealthFactory {
  /**
   * Launch a hardened Chromium browser instance with anti-automation flags
   */
  public static async launchBrowser(proxyServer?: string): Promise<Browser> {
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certificate-errors',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-accelerated-2d-canvas',
      '--no-zygote',
      '--no-first-run',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=es-ES,es,en-US,en',
    ];

    return await chromium.launch({
      headless: env.headlessMode,
      args: launchArgs,
      proxy: proxyServer ? { server: proxyServer } : undefined,
    });
  }

  /**
   * Create an isolated browser context injected with spoofed fingerprints
   * Ensures 100% thread/task isolation to prevent cookie/cache contamination
   */
  public static async createContext(
    browser: Browser,
    fingerprint: BrowserFingerprint,
    _stealthLevel: StealthLevel = 'paranoid',
    proxyServer?: string
  ): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent: fingerprint.userAgent,
      viewport: fingerprint.viewport,
      deviceScaleFactor: fingerprint.deviceScaleFactor,
      isMobile: fingerprint.isMobile,
      hasTouch: fingerprint.hasTouch,
      locale: fingerprint.locale,
      timezoneId: fingerprint.timezoneId,
      permissions: ['geolocation', 'notifications'],
      colorScheme: 'dark',
      proxy: proxyServer ? { server: proxyServer } : undefined,
      extraHTTPHeaders: {
        'Accept-Language': fingerprint.locale,
        'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': `"${fingerprint.platform}"`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    return context;
  }

  /**
   * Inject evasive client scripts into page context before any script on the target loads
   */
  public static async applyInPageEvasions(page: Page, fingerprint: BrowserFingerprint): Promise<void> {
    await page.addInitScript((fp) => {
      // 1. Mask navigator.webdriver and automation flags
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        const proto = Object.getPrototypeOf(navigator);
        if (proto && 'webdriver' in proto) {
          delete proto.webdriver;
        }
      } catch {
        // Fallback
      }

      // 2. Hardware Concurrency & Device Memory spoofing
      try {
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => fp.hardwareConcurrency || 8,
        });
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => fp.deviceMemory || 8,
        });
      } catch {
        // Fallback
      }

      // 3. Platform spoofing
      try {
        Object.defineProperty(navigator, 'platform', {
          get: () => fp.platform || 'Win32',
        });
      } catch {
        // Fallback
      }

      // 4. WebGL Vendor & Renderer spoofing
      try {
        const getParameterProxy = function (this: WebGLRenderingContext | WebGL2RenderingContext, parameter: number) {
          // UNMASKED_VENDOR_WEBGL = 0x9245 (37445)
          if (parameter === 37445) {
            return fp.webGlVendor || 'Google Inc. (NVIDIA)';
          }
          // UNMASKED_RENDERER_WEBGL = 0x9246 (37446)
          if (parameter === 37446) {
            return fp.webGlRenderer || 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
          }
          return (this as unknown as { __origGetParameter: (p: number) => unknown }).__origGetParameter(parameter);
        };

        if (typeof WebGLRenderingContext !== 'undefined') {
          const proto = WebGLRenderingContext.prototype as unknown as Record<string, unknown>;
          proto.__origGetParameter = proto.getParameter;
          proto.getParameter = getParameterProxy;
        }
        if (typeof WebGL2RenderingContext !== 'undefined') {
          const proto = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
          proto.__origGetParameter = proto.getParameter;
          proto.getParameter = getParameterProxy;
        }
      } catch {
        // Fallback
      }

      // 5. Chrome runtime mock with proper structure
      try {
        (window as unknown as { chrome: unknown }).chrome = {
          app: {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          },
          runtime: {
            OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
            OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
            PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
            RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
          },
        };
      } catch {
        // Fallback
      }

      // 6. Clean CDP and Automation leakage identifiers
      try {
        const win = window as unknown as Record<string, unknown>;
        for (const key of Object.keys(win)) {
          if (key.match(/^cdc_[a-zA-Z0-9]/)) {
            delete win[key];
          }
        }
      } catch {
        // Fallback
      }

      // 7. Mock realistic Plugins & MimeTypes
      try {
        const fakePlugins = [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        ];
        Object.defineProperty(navigator, 'plugins', {
          get: () => fakePlugins,
        });
      } catch {
        // Fallback
      }

      // 8. Languages & Permissions API emulation
      try {
        Object.defineProperty(navigator, 'languages', {
          get: () => ['es-ES', 'es', 'en-US', 'en'],
        });

        if (navigator.permissions && navigator.permissions.query) {
          const origQuery = navigator.permissions.query;
          navigator.permissions.query = (parameters: PermissionDescriptor) =>
            parameters.name === 'notifications'
              ? Promise.resolve({ state: 'denied', onchange: null } as unknown as PermissionStatus)
              : origQuery(parameters);
        }
      } catch {
        // Fallback
      }
    }, fingerprint);
  }
}
