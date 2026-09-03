import * as fs from 'fs';
import * as path from 'path';
import type { BookmakerOdd } from '../domain/types/surebet.types.js';

interface PersistedOdds {
  wplay: BookmakerOdd[];
  stake: BookmakerOdd[];
  timestamp: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'odds.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export class OddsPersistenceService {
  private static instance: OddsPersistenceService;

  public static getInstance(): OddsPersistenceService {
    if (!OddsPersistenceService.instance) {
      OddsPersistenceService.instance = new OddsPersistenceService();
    }
    return OddsPersistenceService.instance;
  }

  private loadRaw(): PersistedOdds {
    ensureDataDir();
    if (!fs.existsSync(DATA_FILE)) {
      return { wplay: [], stake: [], timestamp: new Date().toISOString() };
    }
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedOdds;
      return {
        wplay: Array.isArray(parsed.wplay) ? parsed.wplay : [],
        stake: Array.isArray(parsed.stake) ? parsed.stake : [],
        timestamp: parsed.timestamp || new Date().toISOString(),
      };
    } catch {
      return { wplay: [], stake: [], timestamp: new Date().toISOString() };
    }
  }

  private saveRaw(data: PersistedOdds): void {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  public saveWplayOdds(odds: BookmakerOdd[]): void {
    const current = this.loadRaw();
    current.wplay = odds;
    current.timestamp = new Date().toISOString();
    this.saveRaw(current);
    console.log(`💾 [OddsPersistence] Wplay guardado: ${odds.length} odds`);
  }

  public saveStakeOdds(odds: BookmakerOdd[]): void {
    const current = this.loadRaw();
    current.stake = odds;
    current.timestamp = new Date().toISOString();
    this.saveRaw(current);
    console.log(`💾 [OddsPersistence] Stake guardado: ${odds.length} odds`);
  }

  public saveOddsForBookmaker(bookmaker: string, odds: BookmakerOdd[]): void {
    const lower = bookmaker.toLowerCase();
    if (lower.includes('wplay')) {
      this.saveWplayOdds(odds);
    } else if (lower.includes('stake')) {
      this.saveStakeOdds(odds);
    } else {
      // Fallback: detectar por URL si viene
      this.saveGeneric(odds);
    }
  }

  private saveGeneric(odds: BookmakerOdd[]): void {
    if (odds.length === 0) return;
    const sample = odds[0]?.bookmaker?.toLowerCase() || '';
    if (sample.includes('wplay')) this.saveWplayOdds(odds);
    else if (sample.includes('stake')) this.saveStakeOdds(odds);
    else {
      // Si no se puede detectar, guardar como wplay por defecto y log
      console.warn('[OddsPersistence] Bookmaker no reconocido, guardando como wplay genérico');
      this.saveWplayOdds(odds);
    }
  }

  public loadOdds(): PersistedOdds {
    return this.loadRaw();
  }

  public getAllOdds(): BookmakerOdd[] {
    const data = this.loadRaw();
    return [...data.wplay, ...data.stake];
  }

  public clear(): void {
    this.saveRaw({ wplay: [], stake: [], timestamp: new Date().toISOString() });
  }

  public getStats(): { wplay: number; stake: number; total: number; timestamp: string } {
    const data = this.loadRaw();
    return { wplay: data.wplay.length, stake: data.stake.length, total: data.wplay.length + data.stake.length, timestamp: data.timestamp };
  }
}
