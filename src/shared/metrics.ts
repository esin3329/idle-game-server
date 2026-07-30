/**
 * 메트릭 수집 — 요청 수, 오류율, 응답 시간
 *
 * in-memory 카운터 + 히스토그램. 프로세스 재시작 시 초기화.
 * GET /metrics 로 조회, 미들웨어로 자동 수집.
 */

// ─── 카운터 ──────────────────────────────────────────

const counters: Record<string, number> = {};
const statusCounters: Record<string, number> = {};
const pathCounters: Record<string, number> = {};
const durationBuckets = [10, 50, 100, 200, 500, 1000, 3000, 10000]; // ms
const durationHistogram: Record<string, number> = {};

/** 요청 메트릭 기록 */
export function recordRequest(path: string, status: number, durationMs: number): void {
  counters['requests_total'] = (counters['requests_total'] || 0) + 1;

  const statusGroup = `${Math.floor(status / 100)}xx`;
  statusCounters[statusGroup] = (statusCounters[statusGroup] || 0) + 1;

  const normPath = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
  pathCounters[normPath] = (pathCounters[normPath] || 0) + 1;

  // 응답 시간 버킷
  for (const bucket of durationBuckets) {
    if (durationMs <= bucket) {
      const key = `duration_le_${bucket}`;
      durationHistogram[key] = (durationHistogram[key] || 0) + 1;
      break;
    }
  }
}

/** 현재 메트릭 스냅샷 반환 */
export function getMetrics(): Record<string, unknown> {
  const requestsTotal = counters['requests_total'] || 0;
  const errorsTotal = (statusCounters['5xx'] || 0) + (statusCounters['4xx'] || 0);
  const errorRate = requestsTotal > 0 ? ((errorsTotal / requestsTotal) * 100).toFixed(2) + '%' : '0%';

  return {
    requests: { total: requestsTotal },
    errors: { total: errorsTotal, rate: errorRate },
    statusCodes: { ...statusCounters },
    responseTime: {
      histogram: { ...durationHistogram },
      buckets: durationBuckets,
    },
    topPaths: Object.entries(pathCounters)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reduce((acc, [k, v]) => { (acc as Record<string, number>)[k] = v; return acc; }, {} as Record<string, number>),
    timestamp: new Date().toISOString(),
  };
}

/** 카운터 리셋 (테스트용) */
export function resetMetrics(): void {
  Object.keys(counters).forEach((k) => delete counters[k]);
  Object.keys(statusCounters).forEach((k) => delete statusCounters[k]);
  Object.keys(pathCounters).forEach((k) => delete pathCounters[k]);
  Object.keys(durationHistogram).forEach((k) => delete durationHistogram[k]);
}
