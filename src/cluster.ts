/**
 * 클러스터 모드 — 다중 API 서버 (선택적)
 *
 * 사용: CLUSTER_MODE=1 node dist/index.js
 * 기본: 싱글 프로세스 (CLUSTER_MODE 미설정)
 *
 * 코어 수만큼 Worker 포크. 각 Worker는 독립된 서버 인스턴스.
 * JSON 모드에서는 파일 I/O 충돌 위험이 있으므로 MySQL 권장.
 */
import cluster from 'node:cluster';
import { cpus } from 'node:os';
import { logger } from './shared/logger.js';

const CLUSTER_ENABLED = process.env.CLUSTER_MODE === '1' || process.env.CLUSTER_MODE === 'true';

/**
 * 메인 프로세스: Worker 포크
 * Worker 프로세스: false 반환 → 이후 index.ts에서 서버 시작
 *
 * 사용법: index.ts 상단에서 `if (startCluster()) process.exit(0);`
 */
export function startCluster(): boolean {
  if (!CLUSTER_ENABLED || !cluster.isPrimary) return false;

  const numCPUs = parseInt(process.env.CLUSTER_WORKERS || '') || cpus().length;
  logger.info({ workers: numCPUs, event: 'cluster_start' }, `Starting cluster with ${numCPUs} workers`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn({ pid: worker.process.pid, code, signal, event: 'worker_exit' }, `Worker ${worker.process.pid} died`);
    // 자동 재시작 (1초 대기)
    setTimeout(() => cluster.fork(), 1000);
  });

  cluster.on('online', (worker) => {
    logger.info({ pid: worker.process.pid, event: 'worker_online' }, `Worker ${worker.process.pid} online`);
  });

  return true; // 메인 프로세스는 여기서 종료
}

export { CLUSTER_ENABLED };
