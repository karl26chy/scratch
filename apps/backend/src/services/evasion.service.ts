import { Page } from 'playwright';
import { StochasticUtils } from './stochastic.utils.js';

export class EvasionService {
  /**
   * Inject stochastic Gaussian human latency (mean ~1.2s with natural jitter)
   */
  public static async humanDelay(meanMs = 1200, stdDevMs = 300, minMs = 450): Promise<number> {
    return await StochasticUtils.stochasticDelay(meanMs, stdDevMs, minMs);
  }

  /**
   * Inject quick uniform jitter (e.g. between micro-actions)
   */
  public static async microJitter(minMs = 80, maxMs = 280): Promise<number> {
    return await StochasticUtils.uniformDelay(minMs, maxMs);
  }

  /**
   * Simulate realistic human mouse movements on page using organic trajectories
   */
  public static async simulateOrganicMouseTrajectories(page: Page): Promise<void> {
    try {
      const viewport = page.viewportSize() || { width: 1280, height: 800 };
      const waypointsCount = StochasticUtils.uniformInt(2, 5);

      for (let i = 0; i < waypointsCount; i++) {
        const targetX = Math.round(StochasticUtils.uniform(80, viewport.width - 80));
        const targetY = Math.round(StochasticUtils.uniform(80, viewport.height - 80));
        const steps = StochasticUtils.uniformInt(12, 28);

        await page.mouse.move(targetX, targetY, { steps });
        await this.microJitter(100, 350);
      }
    } catch {
      // Non-blocking in case page closed or navigating
    }
  }

  /**
   * Simulate realistic human progressive smooth scrolling with acceleration/deceleration & reading pauses
   */
  public static async simulateNaturalSmoothScroll(page: Page, totalScrollPasses = 3): Promise<void> {
    try {
      for (let pass = 0; pass < totalScrollPasses; pass++) {
        const targetDeltaY = StochasticUtils.uniformInt(200, 550);
        const subSteps = StochasticUtils.uniformInt(4, 8);
        const stepDelta = Math.round(targetDeltaY / subSteps);

        for (let s = 0; s < subSteps; s++) {
          // Quadratic easing variation
          const jitter = StochasticUtils.uniform(-5, 10);
          await page.mouse.wheel(0, stepDelta + jitter);
          await StochasticUtils.uniformDelay(40, 110);
        }

        // Reading pause simulating human eye scan
        if (Math.random() > 0.4) {
          await StochasticUtils.stochasticDelay(600, 180, 250);
        }
      }
    } catch {
      // Non-blocking
    }
  }

  /**
   * Simula comportamiento humano avanzado combinando mouse, scroll y delays estocásticos
   */
  public static async simulateAdvancedHumanBehavior(page: Page): Promise<void> {
    try {
      // Secuencia aleatoria: 30% solo mouse, 20% solo scroll, 50% ambos
      const roll = Math.random();
      if (roll < 0.3) {
        await this.simulateOrganicMouseTrajectories(page);
        await this.microJitter(200, 500);
      } else if (roll < 0.5) {
        await this.simulateNaturalSmoothScroll(page, 2 + Math.floor(Math.random() * 2));
      } else {
        await this.simulateOrganicMouseTrajectories(page);
        await this.microJitter(150, 300);
        await this.simulateNaturalSmoothScroll(page, 1 + Math.floor(Math.random() * 2));
        // Hover aleatorio sobre elementos visibles (human curiosity)
        await this.simulateRandomHover(page);
      }
      // Typing delay simulation if input exists
      await this.humanDelay(400 + Math.random() * 600, 150, 250);
    } catch {
      // Non-blocking
    }
  }

  private static async simulateRandomHover(page: Page): Promise<void> {
    try {
      const hoverable = await page.$$eval('a, button, [role="button"]', (els) =>
        els.slice(0, 5).map((e) => {
          const rect = e.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })
      ).catch(() => []);
      if (hoverable.length > 0) {
        const target = hoverable[Math.floor(Math.random() * hoverable.length)];
        if (target && target.x > 0 && target.y > 0) {
          await page.mouse.move(target.x, target.y, { steps: 10 + Math.floor(Math.random() * 10) }).catch(() => {});
          await StochasticUtils.uniformDelay(200, 600);
        }
      }
    } catch {
      // Non-blocking
    }
  }

  /**
   * Detecta y reporta presencia de captcha para métricas / rotación proxy
   */
  public static detectCaptchaType(html: string): 'recaptcha' | 'hcaptcha' | 'turnstile' | 'datadome' | 'perimeterx' | 'generic' | null {
    const lower = html.toLowerCase();
    if (lower.includes('recaptcha') || lower.includes('g-recaptcha')) return 'recaptcha';
    if (lower.includes('hcaptcha') || lower.includes('h-captcha')) return 'hcaptcha';
    if (lower.includes('turnstile') || lower.includes('challenges.cloudflare.com')) return 'turnstile';
    if (lower.includes('datadome')) return 'datadome';
    if (lower.includes('perimeterx') || lower.includes('px-cloud.net')) return 'perimeterx';
    if (lower.includes('captcha')) return 'generic';
    return null;
  }

  /**
   * Estrategia ante captcha: log + rotación proxy (no solve automático, requiere 2captcha si se integra)
   */
  public static handleCaptchaDetected(html: string, proxyId?: string): { detected: boolean; type: string | null; action: string } {
    const type = this.detectCaptchaType(html);
    if (!type) return { detected: false, type: null, action: 'none' };
    const action = 'rotate_proxy_and_retry';
    console.warn(`[EvasionService] Captcha detectado: ${type}. Proxy ${proxyId || 'unknown'} marcado para rotación.`);
    return { detected: true, type, action };
  }

  /**
   * Comprehensive signature analyzer for anti-bot barriers (Cloudflare, Datadome, PerimeterX, Turnstile, Akamai)
   */
  public static isAntibotChallenge(html: string, title: string, statusCode?: number): boolean {
    const lowerHtml = html.toLowerCase();
    const lowerTitle = title.toLowerCase();

    // 1. HTTP Status Code indicators
    if (statusCode === 403 || statusCode === 503 || statusCode === 429) {
      if (
        lowerHtml.includes('cloudflare') ||
        lowerHtml.includes('cf-chl-bypass') ||
        lowerHtml.includes('turnstile') ||
        lowerHtml.includes('datadome') ||
        lowerHtml.includes('perimeterx') ||
        lowerHtml.includes('human verification') ||
        lowerHtml.includes('access denied') ||
        lowerHtml.includes('challenge-form') ||
        lowerHtml.includes('recaptcha') ||
        lowerHtml.includes('hcaptcha')
      ) {
        return true;
      }
    }

    // 2. Title and DOM heuristics
    const blockedTitles = [
      'just a moment',
      'attention required',
      'security check',
      'ddos-guard',
      'shield square',
      'bot verification',
      'access denied',
      'captcha',
    ];

    if (blockedTitles.some((bt) => lowerTitle.includes(bt))) {
      return true;
    }

    // 3. Script signatures in HTML body
    if (
      lowerHtml.includes('challenges.cloudflare.com/turnstile') ||
      lowerHtml.includes('ct.captcha-delivery.com/c.js') ||
      lowerHtml.includes('px-cloud.net') ||
      lowerHtml.includes('akamai-bot')
    ) {
      return true;
    }

    return false;
  }
}
