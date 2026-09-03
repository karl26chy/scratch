import type { BookmakerOdd } from './surebet.types.js';
import type { CapturedPayload } from '../../infrastructure/network/odds-interceptor.js';

export interface SiteOddsAdapter {
  /** Dominio principal, p.ej. 'bet365.com' (usado para matchear por hostname). */
  domain: string;

  /** Patrones de URL de las APIs internas del sitio que transportan las cuotas. */
  urlPatterns: RegExp[];

  /** Transforma los payloads capturados de red en cuotas normalizadas. */
  extract(payloads: CapturedPayload[]): BookmakerOdd[];
}
