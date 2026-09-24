import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Origen de un scraping: 'global' cuando lo dispara el módulo Scraping Global, 'module' cuando lo dispara la página
 * dedicada de una casa. Se propaga por AsyncLocalStorage a través de todos los `await` del scraping, así los
 * ~12 puntos donde el servicio guarda cuotas no necesitan recibir el origen como parámetro.
 */
export type ScrapeOrigin = 'global' | 'module';

const storage = new AsyncLocalStorage<{ origin: ScrapeOrigin }>();

export function runWithScrapeOrigin<T>(origin: ScrapeOrigin, fn: () => Promise<T>): Promise<T> {
  return storage.run({ origin }, fn);
}

export function currentScrapeOrigin(): ScrapeOrigin {
  return storage.getStore()?.origin ?? 'module';
}
