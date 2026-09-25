import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { SurebetCalculatorService } from '../../services/surebet-calculator.service.js';
import { OddsPersistenceService } from '../../services/odds-persistence.service.js';

const BookmakerOddSchema = z.object({
  bookmaker: z.string().min(1, 'El nombre de la casa de apuestas es obligatorio'),
  eventName: z.string().min(1, 'El nombre del evento es obligatorio'),
  sport: z.enum(['football', 'tennis', 'basketball', 'table_tennis']).default('football'),
  marketType: z.enum(['1X2', 'MONEYLINE_2WAY', 'OVER_UNDER_2_5', 'BOTH_TEAMS_SCORE']).default('1X2'),
  selection: z.string().min(1, 'La selección es obligatoria'),
  odd: z.number().positive('La cuota debe ser un número positivo mayor a 1.0'),
  url: z.string().url().optional(),
});

const AnalyzeSurebetsSchema = z.object({
  totalStake: z.number().positive().default(1000000), // COP
  minProfitMargin: z.number().min(-10).default(0),
  oddsData: z.array(BookmakerOddSchema).optional(),
});

export class SurebetController {
  private surebetService = SurebetCalculatorService.getInstance();

  /**
   * POST /api/surebets/analyze or POST /api/v1/surebets/analyze
   */
  public analyzeSurebets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = AnalyzeSurebetsSchema.parse(req.body);

      let odds = validated.oddsData;
      if (!odds || odds.length === 0) {
        const liveOpps = this.surebetService.getLiveOpportunities(validated.totalStake);
        res.status(200).json({
          success: true,
          data: {
            opportunities: liveOpps.filter((o) => o.profitMarginPercentage >= validated.minProfitMargin),
            analyzedEventsCount: liveOpps.length,
            surebetsFoundCount: liveOpps.filter((o) => o.isSurebet).length,
            highestProfitMargin: liveOpps.length > 0 ? liveOpps[0].profitMarginPercentage : 0,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const result = this.surebetService.analyzeOdds(
        odds,
        validated.totalStake,
        validated.minProfitMargin
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/surebets/live-opportunities or GET /api/v1/surebets/live-opportunities
   */
  public getLiveOpportunities = (req: Request, res: Response): void => {
    const totalStake = parseFloat(req.query.totalStake as string) || 1000;
    const opportunities = this.surebetService.getLiveOpportunities(totalStake);

    res.status(200).json({
      success: true,
      data: {
        opportunities,
        totalCount: opportunities.length,
        timestamp: new Date().toISOString(),
      },
    });
  };

  /**
   * GET /api/surebets/calculate — Tarea 2: calcula surebets desde persistencia (wplay+stake)
   */
  public calculate = (req: Request, res: Response): void => {
    const totalStake = parseFloat(req.query.totalStake as string) || 1000;
    const minProfit = parseFloat(req.query.minProfit as string) || 0;
    const persisted = this.surebetService.getAllPersistedOdds();
    // Deduplicar idéntico a getLiveOpportunities por bookmaker+eventName+selection+marketType
    const seen = new Set<string>();
    const deduped: typeof persisted = [];
    for (const o of persisted) {
      const key = `${o.bookmaker}:${o.eventName}:${o.selection}:${o.marketType}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(o);
      }
    }
    const result = this.surebetService.analyzeOdds(deduped, totalStake, minProfit);

    // Antigüedad de lo guardado por casa y deporte: lo que supera el TTL se ignoró en el cálculo.
    const nowMs = Date.now();
    const fresh = new Map<string, { bookmaker: string; sport: string; count: number; newestMs: number }>();
    for (const o of deduped) {
      const t = o.timestamp ? new Date(o.timestamp).getTime() : NaN;
      if (isNaN(t)) continue;
      const k = `${o.bookmaker}|${o.sport}`;
      const cur = fresh.get(k);
      if (cur) {
        cur.count++;
        cur.newestMs = Math.max(cur.newestMs, t);
      } else {
        fresh.set(k, { bookmaker: o.bookmaker, sport: o.sport, count: 1, newestMs: t });
      }
    }
    const freshness = [...fresh.values()].map((f) => ({
      bookmaker: f.bookmaker,
      sport: f.sport,
      count: f.count,
      ageMinutes: Math.round((nowMs - f.newestMs) / 60000),
      stale: nowMs - f.newestMs > SurebetCalculatorService.ODDS_TTL_MS,
    }));
    // Guardar histórico
    this.saveHistory(result);
    const stats = OddsPersistenceService.getInstance().getStats('global');
    res.status(200).json({
      success: true,
      data: {
        ...result,
        stats,
        freshness,
        source: 'global',
        ttlMinutes: SurebetCalculatorService.ODDS_TTL_MS / 60000,
        sources: { wplay: stats.wplay, stake: stats.stake, betplay: stats.betplay, bwin: stats.bwin, rushbet: stats.rushbet, betsson: stats.betsson, total: stats.total, byBookmaker: stats.byBookmaker },
      },
    });
  };

  /**
   * GET /api/surebets/history — histórico
   */
  public history = (_req: Request, res: Response): void => {
    const historyFile = path.resolve(process.cwd(), 'data/surebets-history.json');
    if (!fs.existsSync(historyFile)) {
      res.status(200).json({ success: true, data: [] });
      return;
    }
    try {
      const raw = fs.readFileSync(historyFile, 'utf-8');
      const data = JSON.parse(raw);
      res.status(200).json({ success: true, data });
    } catch {
      res.status(200).json({ success: true, data: [] });
    }
  };

  /**
   * POST /api/surebets/refresh — fuerza recálculo
   */
  public refresh = (req: Request, res: Response): void => {
    const totalStake = parseFloat((req.body?.totalStake as string) || (req.query.totalStake as string)) || 1000;
    const result = this.surebetService.getLiveOpportunities(totalStake);
    // También calcular con persistencia
    const persisted = this.surebetService.getAllPersistedOdds();
    const calc = this.surebetService.analyzeOdds(persisted, totalStake);
    this.saveHistory(calc);
    res.status(200).json({
      success: true,
      data: {
        opportunities: result,
        totalCount: result.length,
        persistedCalc: calc,
        timestamp: new Date().toISOString(),
      },
    });
  };

  private saveHistory(result: any): void {
    try {
      const historyFile = path.resolve(process.cwd(), 'data/surebets-history.json');
      const dir = path.dirname(historyFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let history: any[] = [];
      if (fs.existsSync(historyFile)) {
        try {
          history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
          if (!Array.isArray(history)) history = [];
        } catch {}
      }
      history.unshift({ timestamp: new Date().toISOString(), surebetsFoundCount: result.surebetsFoundCount, highestProfitMargin: result.highestProfitMargin, opportunities: result.opportunities.slice(0, 5) });
      if (history.length > 50) history = history.slice(0, 50);
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
    } catch {}
  }
}
