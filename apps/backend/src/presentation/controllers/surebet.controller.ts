import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SurebetCalculatorService } from '../../services/surebet-calculator.service.js';

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
  totalStake: z.number().positive().default(1000),
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
}
