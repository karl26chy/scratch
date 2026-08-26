import { BrowserFingerprint, StealthLevel } from '../../domain/types/scraper.types.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

const WEBGL_CONFIGS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Apple', renderer: 'Apple M2 Pro' },
];

export class FingerprintGenerator {
  public static generate(level: StealthLevel = 'advanced'): BrowserFingerprint {
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const randomViewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    const randomWebGL = WEBGL_CONFIGS[Math.floor(Math.random() * WEBGL_CONFIGS.length)];
    const isMac = randomUA.includes('Macintosh');

    return {
      userAgent: randomUA,
      viewport: randomViewport,
      deviceScaleFactor: level === 'paranoid' ? 2 : 1,
      isMobile: false,
      hasTouch: false,
      locale: 'en-US,en;q=0.9,es;q=0.8',
      timezoneId: 'America/New_York',
      platform: isMac ? 'MacIntel' : 'Win32',
      webGlVendor: randomWebGL.vendor,
      webGlRenderer: randomWebGL.renderer,
      hardwareConcurrency: level === 'paranoid' ? 16 : 8,
      deviceMemory: 8,
    };
  }
}
