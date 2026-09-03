import type { Page, Response } from 'playwright';

export interface CapturedPayload {
  url: string;
  json: unknown;
  timestamp: string;
}

export class OddsNetworkInterceptor {
  private captured: CapturedPayload[] = [];
  private urlPatterns: RegExp[];
  private responseHandler?: (response: Response) => Promise<void>;

  constructor(urlPatterns: RegExp[] = []) {
    this.urlPatterns = urlPatterns;
  }

  public setUrlPatterns(patterns: RegExp[]): void {
    this.urlPatterns = patterns;
  }

  public attach(page: Page): void {
    this.responseHandler = async (response: Response) => {
      try {
        const requestUrl = response.url();
        if (!this.matchesPatterns(requestUrl)) return;

        const contentType = response.headers()['content-type'] || '';
        if (!contentType.toLowerCase().includes('application/json')) return;

        const json = await response.json().catch(() => null);
        if (json === null) return;

        this.captured.push({
          url: requestUrl,
          json,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // respuestas no parseables se ignoran
      }
    };
    page.on('response', this.responseHandler);
  }

  public detach(page: Page): void {
    if (this.responseHandler) {
      page.off('response', this.responseHandler);
      this.responseHandler = undefined;
    }
  }

  public getCaptured(): CapturedPayload[] {
    return [...this.captured];
  }

  public clear(): void {
    this.captured = [];
  }

  private matchesPatterns(url: string): boolean {
    if (this.urlPatterns.length === 0) return true;
    return this.urlPatterns.some((re) => re.test(url));
  }
}
