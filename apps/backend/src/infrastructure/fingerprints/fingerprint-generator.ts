import { BrowserFingerprint, StealthLevel } from '../../domain/types/scraper.types.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1200 },
  { width: 1680, height: 1050 },
];

const WEBGL_CONFIGS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Apple', renderer: 'Apple M1' },
  { vendor: 'Apple', renderer: 'Apple M2 Pro' },
  { vendor: 'Google Inc. (Qualcomm)', renderer: 'Adreno (TM) 640' },
];

const LOCALES = [
  { locale: 'es-ES,es;q=0.9,en;q=0.8', timezone: 'Europe/Madrid' },
  { locale: 'en-US,en;q=0.9,es;q=0.8', timezone: 'America/New_York' },
  { locale: 'de-DE,de;q=0.9,en;q=0.8', timezone: 'Europe/Berlin' },
  { locale: 'fr-FR,fr;q=0.9,en;q=0.8', timezone: 'Europe/Paris' },
  { locale: 'en-GB,en;q=0.9', timezone: 'Europe/London' },
  { locale: 'pt-BR,pt;q=0.9,en;q=0.8', timezone: 'America/Sao_Paulo' },
];

const COUNTRY_LOCALE_MAP: Record<string, { locale: string; timezone: string }> = {
  US: { locale: 'en-US,en;q=0.9', timezone: 'America/New_York' },
  ES: { locale: 'es-ES,es;q=0.9,en;q=0.8', timezone: 'Europe/Madrid' },
  DE: { locale: 'de-DE,de;q=0.9,en;q=0.8', timezone: 'Europe/Berlin' },
  GB: { locale: 'en-GB,en;q=0.9', timezone: 'Europe/London' },
  FR: { locale: 'fr-FR,fr;q=0.9', timezone: 'Europe/Paris' },
  BR: { locale: 'pt-BR,pt;q=0.9', timezone: 'America/Sao_Paulo' },
};

export class FingerprintGenerator {
  public static generate(level: StealthLevel = 'advanced', proxyCountry?: string): BrowserFingerprint {
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const randomViewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    const randomWebGL = WEBGL_CONFIGS[Math.floor(Math.random() * WEBGL_CONFIGS.length)];
    const isMac = randomUA.includes('Macintosh');
    const isFirefox = randomUA.includes('Firefox');

    // Rotación de locale/timezone alineada con país del proxy si disponible
    let localeEntry = LOCALES[Math.floor(Math.random() * LOCALES.length)];
    if (proxyCountry && COUNTRY_LOCALE_MAP[proxyCountry]) {
      // 70% usa locale del país del proxy para coherencia IP ↔ fingerprint
      if (Math.random() < 0.7) localeEntry = COUNTRY_LOCALE_MAP[proxyCountry] as any;
    }

    // hardwareConcurrency y deviceMemory con variación humana
    const hwConcurrencyOptions = [4, 8, 12, 16];
    const deviceMemoryOptions = [4, 8, 16, 32];

    return {
      userAgent: randomUA,
      viewport: randomViewport,
      deviceScaleFactor: level === 'paranoid' ? (Math.random() > 0.5 ? 2 : 1) : 1,
      isMobile: false,
      hasTouch: false,
      locale: localeEntry.locale,
      timezoneId: localeEntry.timezone,
      platform: isMac ? 'MacIntel' : isFirefox ? 'Win32' : 'Win32',
      webGlVendor: randomWebGL.vendor,
      webGlRenderer: randomWebGL.renderer,
      hardwareConcurrency: hwConcurrencyOptions[Math.floor(Math.random() * hwConcurrencyOptions.length)],
      deviceMemory: deviceMemoryOptions[Math.floor(Math.random() * deviceMemoryOptions.length)],
    };
  }

  /**
   * Genera fingerprint determinístico por sessionId (útil para sticky session consistente)
   */
  public static generateForSession(sessionId: string, level: StealthLevel = 'paranoid', proxyCountry?: string): BrowserFingerprint {
    // Simple hash para selección estable pero aún rotada por sesión
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
    const uaIdx = hash % USER_AGENTS.length;
    const vpIdx = (hash >>> 4) % VIEWPORTS.length;
    const webIdx = (hash >>> 8) % WEBGL_CONFIGS.length;
    const fp = this.generate(level, proxyCountry);
    fp.userAgent = USER_AGENTS[uaIdx];
    fp.viewport = VIEWPORTS[vpIdx];
    fp.webGlVendor = WEBGL_CONFIGS[webIdx].vendor;
    fp.webGlRenderer = WEBGL_CONFIGS[webIdx].renderer;
    return fp;
  }
}
