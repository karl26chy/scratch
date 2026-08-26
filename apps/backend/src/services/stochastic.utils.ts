/**
 * Stochastic distribution utilities for human behavioral emulation
 * Uses Gaussian/Normal distributions (Box-Muller) and Uniform random models
 */

export class StochasticUtils {
  /**
   * Generates a pseudo-random floating-point number within a uniform distribution [min, max]
   */
  public static uniform(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  /**
   * Generates a pseudo-random integer within a uniform distribution [min, max]
   */
  public static uniformInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Generates a random number following a Normal (Gaussian) distribution
   * using the Box-Muller transform to emulate human reaction times.
   *
   * @param mean Center of the bell curve (e.g. 1200ms)
   * @param stdDev Standard deviation (e.g. 250ms)
   * @param min Optional lower bound cutoff
   * @param max Optional upper bound cutoff
   */
  public static gaussian(mean: number, stdDev: number, min?: number, max?: number): number {
    let u1 = 0;
    let u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();

    // Box-Muller transformation
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    let result = z0 * stdDev + mean;

    if (min !== undefined && result < min) result = min;
    if (max !== undefined && result > max) result = max;

    return result;
  }

  /**
   * Asynchronous delay with stochastic jitter based on Gaussian reaction model
   */
  public static async stochasticDelay(meanMs = 1200, stdDevMs = 300, minMs = 400): Promise<number> {
    const delay = Math.round(this.gaussian(meanMs, stdDevMs, minMs));
    await new Promise((resolve) => setTimeout(resolve, delay));
    return delay;
  }

  /**
   * Asynchronous delay with uniform distribution
   */
  public static async uniformDelay(minMs = 800, maxMs = 2500): Promise<number> {
    const delay = this.uniformInt(minMs, maxMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return delay;
  }
}
