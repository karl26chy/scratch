const API_BASE = 'http://localhost:4000/api';

export interface RegisteredAdapter {
  domain: string;
  patternCount: number;
}

export interface AdapterCheck {
  domain: string;
  hasAdapter: boolean;
  adapter: RegisteredAdapter | null;
}

export interface CaptureResponse {
  success: boolean;
  url: string;
  count: number;
  captured: unknown[];
}

export const AdaptersApi = {
  async list(): Promise<RegisteredAdapter[]> {
    const res = await fetch(`${API_BASE}/adapters`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.adapters || [];
  },

  async check(domain: string): Promise<AdapterCheck> {
    const res = await fetch(`${API_BASE}/adapters?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async capture(url: string): Promise<CaptureResponse> {
    const res = await fetch(`${API_BASE}/debug/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Error al capturar el tráfico de red');
    }
    return json;
  },
};
