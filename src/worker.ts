/**
 * Worker Thread — CPU 집약적 작업 offload (선택적)
 *
 * 사용: ENABLE_WORKER=1 환경변수 설정 시 활성화.
 * 기본: 메인 스레드에서 동기 처리.
 *
 * 현재 지원:
 * - bcrypt hash (회원가입 시 password hashing)
 */
import { parentPort } from 'node:worker_threads';

// Worker 모드: parentPort가 있으면 Worker 스레드로 실행됨
if (parentPort) {
  parentPort.on('message', async (msg: { type: string; data: unknown }) => {
    try {
      if (msg.type === 'bcrypt_hash') {
        const { password, rounds } = msg.data as { password: string; rounds: number };
        const { hash } = await import('bcryptjs');
        const result = await hash(password, rounds);
        parentPort!.postMessage({ type: 'result', id: (msg.data as any).id, result });
      } else if (msg.type === 'bcrypt_compare') {
        const { password, hash: hashStr } = msg.data as { password: string; hash: string };
        const { compare } = await import('bcryptjs');
        const result = await compare(password, hashStr);
        parentPort!.postMessage({ type: 'result', id: (msg.data as any).id, result });
      } else {
        parentPort!.postMessage({ type: 'error', message: `Unknown type: ${msg.type}` });
      }
    } catch (err) {
      parentPort!.postMessage({ type: 'error', message: (err as Error).message });
    }
  });
}

// 메인 스레드 인터페이스
let _worker: any = null;

async function getWorker(): Promise<any> {
  if (!_worker) {
    const { Worker } = await import('node:worker_threads');
    _worker = new Worker(new URL(import.meta.url));
  }
  return _worker;
}

let _msgId = 0;
const _callbacks = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

async function sendToWorker(type: string, data: Record<string, unknown>): Promise<unknown> {
  const id = ++_msgId;
  return new Promise((resolve, reject) => {
    _callbacks.set(id, { resolve, reject });
    getWorker().then((w) => {
      if (!_callbacks.has(id)) return; // 이미 타임아웃
      w.postMessage({ type, data: { ...data, id } });
      // 30초 타임아웃
      setTimeout(() => {
        if (_callbacks.has(id)) {
          _callbacks.delete(id);
          reject(new Error('Worker timeout'));
        }
      }, 30000);
    }).catch(reject);
  });
}

/** Worker 사용 가능 여부 */
const WORKER_ENABLED = process.env.ENABLE_WORKER === '1' || process.env.ENABLE_WORKER === 'true';

export function isWorkerEnabled(): boolean {
  return WORKER_ENABLED;
}

/** bcrypt hash (Worker 또는 메인 스레드) */
export async function hashPassword(password: string, rounds: number): Promise<string> {
  if (!WORKER_ENABLED) {
    const { hash } = await import('bcryptjs');
    return hash(password, rounds);
  }
  return (await sendToWorker('bcrypt_hash', { password, rounds })) as string;
}

/** bcrypt compare (Worker 또는 메인 스레드) */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (!WORKER_ENABLED) {
    const { compare } = await import('bcryptjs');
    return compare(password, hash);
  }
  return (await sendToWorker('bcrypt_compare', { password, hash })) as boolean;
}
