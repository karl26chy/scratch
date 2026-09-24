import { SiteAdapterRegistry } from '../adapter-registry.js';
import type { SiteOddsAdapter } from '../../../domain/types/site-adapter.js';
import { stakeKickerAdapter } from './stake-kicker.adapter.js';
import { betplayKambiAdapter } from './betplay-kambi.adapter.js';
import { bwinAdapter } from './bwin.adapter.js';
import { rushbetKambiAdapter } from './rushbet-kambi.adapter.js';

/**
 * Registra todos los adapters de sitio en el SiteAdapterRegistry.
 * Llamar una sola vez en el arranque del backend (ver src/index.ts).
 */
export function registerAllAdapters(): void {
  const registry = SiteAdapterRegistry.getInstance();

  registry.register(stakeKickerAdapter);
  registry.register(betplayKambiAdapter);
  registry.register(bwinAdapter);
  registry.register(rushbetKambiAdapter);

  // ✅ Verificar registro
  console.log('🔍 Adapters registrados:');
  console.log(registry.getAllDomains());
  const stakeAdapter = registry.getForDomain('stake.com.co');
  console.log(`✅ Stake adapter registrado: ${stakeAdapter ? 'Sí' : 'No'}`);
  if (stakeAdapter) {
    console.log(`✅ Stake adapter:`, stakeAdapter.domain);
  } else {
    console.warn('⚠️ Stake adapter NO registrado');
  }

  void registry as unknown as SiteOddsAdapter;
}
