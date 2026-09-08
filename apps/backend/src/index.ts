import { createServer } from './presentation/server.js';
import { env } from './infrastructure/config/environment.js';
import { BrowserPool } from './infrastructure/browser/browser-pool.js';
import { registerAllAdapters } from './infrastructure/network/adapters/index.js';
import { ProxyRotator } from './infrastructure/proxies/proxy-rotator.js';

registerAllAdapters();

const app = createServer();

// Auto-reload proxies from Webshare API on startup (async, non-blocking)
if (env.proxy.enabled && env.proxy.apiKey) {
  ProxyRotator.getInstance().reloadFromRemote()
    .then(() => {
      const count = ProxyRotator.getInstance().getProxyCount();
      console.log(`🌐 [ProxyRotator] Pool remoto cargado desde Webshare: ${count} proxies activos`);
    })
    .catch((err) => {
      console.warn(`⚠️ [ProxyRotator] No se pudo recargar desde Webshare (usando lista estática del .env): ${err?.message}`);
    });
}

const server = app.listen(env.port, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Stealth Scraper Backend running at http://localhost:${env.port}`);
  console.log(`🛡️  Stealth Architecture: Enabled (Default: ${env.defaultStealthLevel})`);
  console.log(`🌐 Allowed Frontend Origin: ${env.frontendOrigin}`);
  console.log(`=======================================================`);
});

// Graceful shutdown handling
const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    await BrowserPool.getInstance().shutdown();
    console.log('Browser pool closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
