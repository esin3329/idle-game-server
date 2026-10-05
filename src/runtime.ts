import { AsyncLocalStorage } from 'node:async_hooks';

export interface AiQueue {
  send(message: { readonly runId: string }): Promise<unknown>;
}

const runtime = new AsyncLocalStorage<{ readonly queue?: AiQueue }>();

export function withRuntime<T>(queue: AiQueue | undefined, callback: () => Promise<T>): Promise<T> {
  return runtime.run({ queue }, callback);
}

export function getAiQueue(): AiQueue | undefined {
  return runtime.getStore()?.queue;
}
