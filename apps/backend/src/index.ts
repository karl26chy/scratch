import { createServer } from './presentation/server.js';
import { env } from './infrastructure/config/environment.js';
import { BrowserPool } from './infrastructure/browser/browser-pool.js';
import { registerAllAdapters } from './infrastructure/network/adapters/index.js';

registerAllAdapters();

const app = createServer();

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
