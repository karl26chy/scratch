import * as fs from 'fs';
import * as path from 'path';
import type { BookmakerOdd } from '../domain/types/surebet.types.js';

// Bookmakers conocidos por nombre — cualquier otro se guarda dinámicamente
// bajo su propio slug (derivado del nombre) en vez de perderse o mezclarse
// incorrectamente con otra casa (bug previo: todo lo no reconocido cala como "wplay").
const KNOWN_BOOKMAKERS = ['wplay', 'stake', 'betplay'] as const;

interface PersistedOdds {
  books: Record<string, BookmakerOdd[]>;
  timestamp: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'odds.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function slugify(bookmaker: string): string {
  const lower = bookmaker.trim().toLowerCase();
  const known = KNOWN_BOOKMAKERS.find((k) => lower.includes(k));
  if (known) return known;
  return lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
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
      return { books: {}, timestamp: new Date().toISOString() };
    }
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as any;
      // Compatibilidad con el formato viejo { wplay: [...], stake: [...] }
      if (parsed.books && typeof parsed.books === 'object') {
        return { books: parsed.books, timestamp: parsed.timestamp || new Date().toISOString() };
      }
      const books: Record<string, BookmakerOdd[]> = {};
      for (const key of Object.keys(parsed)) {
        if (key === 'timestamp') continue;
        if (Array.isArray(parsed[key])) books[key] = parsed[key];
      }
      return { books, timestamp: parsed.timestamp || new Date().toISOString() };
    } catch {
      return { books: {}, timestamp: new Date().toISOString() };
    }
  }

  private saveRaw(data: PersistedOdds): void {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  public saveWplayOdds(odds: BookmakerOdd[]): void {
    this.saveOddsForSlug('wplay', odds);
  }

  public saveStakeOdds(odds: BookmakerOdd[]): void {
    this.saveOddsForSlug('stake', odds);
  }

  public saveOddsForBookmaker(bookmaker: string, odds: BookmakerOdd[]): void {
    if (!odds || odds.length === 0) {
      console.warn(`⚠️ [OddsPersistence] Intento de guardar 0 cuotas para '${bookmaker}'. Se conserva intacto el archivo en disco.`);
      return;
    }
    const slug = bookmaker ? slugify(bookmaker) : this.detectSlugFromSample(odds);
    this.saveOddsForSlug(slug, odds);
  }

  private detectSlugFromSample(odds: BookmakerOdd[]): string {
    const sample = odds[0]?.bookmaker;
    return sample ? slugify(sample) : 'unknown';
  }

  private saveOddsForSlug(slug: string, odds: BookmakerOdd[]): void {
    const current = this.loadRaw();
    current.books[slug] = odds;
    current.timestamp = new Date().toISOString();
    this.saveRaw(current);
    console.log(`💾 [OddsPersistence] ${slug} guardado: ${odds.length} odds`);
  }

  public loadOdds(): PersistedOdds {
    return this.loadRaw();
  }

  public getAllOdds(): BookmakerOdd[] {
    const data = this.loadRaw();
    return Object.values(data.books).flat();
  }

  public clear(): void {
    this.saveRaw({ books: {}, timestamp: new Date().toISOString() });
  }

  public getStats(): { total: number; timestamp: string; byBookmaker: Record<string, number>; wplay: number; stake: number; betplay: number } {
    const data = this.loadRaw();
    const byBookmaker: Record<string, number> = {};
    let total = 0;
    for (const [slug, list] of Object.entries(data.books)) {
      byBookmaker[slug] = list.length;
      total += list.length;
    }
    return {
      total,
      timestamp: data.timestamp,
      byBookmaker,
      // Compatibilidad con consumidores existentes (SurebetPage, surebet.controller)
      wplay: byBookmaker.wplay || 0,
      stake: byBookmaker.stake || 0,
      betplay: byBookmaker.betplay || 0,
    };
  }
}
