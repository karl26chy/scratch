import { useState, useEffect } from 'react';
import { SystemHealth, ScrapeResult } from '../../../shared/types/common.types.js';

export function useDashboardMetrics(history: ScrapeResult[]) {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchHealth = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/v1/health');
      if (res.ok) {
        const data: SystemHealth = await res.json();
        setHealth(data);
      }
    } catch {
      // Degraded / offline state fallback
      setHealth({
        status: 'degraded',
        uptimeSeconds: 0,
        timestamp: new Date().toISOString(),
        environment: 'local',
        browserPool: { activeInstances: 0, maxCapacity: 5, isHealthy: false },
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const totalScrapes = history.length;
  const successfulScrapes = history.filter((s) => s.status === 'SUCCESS').length;
  const blockedScrapes = history.filter((s) => s.status === 'BLOCKED').length;
  const bypassRate = totalScrapes > 0 ? ((successfulScrapes / totalScrapes) * 100).toFixed(1) : '100';
  const avgDuration =
    totalScrapes > 0
      ? (history.reduce((acc, curr) => acc + (curr.stealthMetrics?.durationMs || 0), 0) / totalScrapes).toFixed(0)
      : '0';

  return {
    health,
    isLoading,
    metrics: {
      totalScrapes,
      successfulScrapes,
      blockedScrapes,
      bypassRate,
      avgDuration,
    },
  };
}
