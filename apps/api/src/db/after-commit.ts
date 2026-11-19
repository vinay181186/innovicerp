// ADR-309 — run a callback after the request's write transaction commits.
//
// withUserContext and dayTx (the two places that open a write transaction)
// run inside withAfterCommit. afterCommit() queues into the OUTERMOST open
// scope, so a savepoint or a nested call still waits for the real commit. A
// throw (rollback) drops the queue. Outside any scope — or after the scope has
// closed (a stray un-awaited promise) — the callback runs at once.
// No database or logger import here, so unit tests can load it.
import { AsyncLocalStorage } from 'node:async_hooks';

interface Scope {
  queue: Array<() => unknown>;
  open: boolean;
}

const scopes = new AsyncLocalStorage<Scope>();

export type AfterCommitErrorSink = (err: unknown) => void;

/** Run `fn` once the surrounding write transaction has committed (never on
 *  rollback). A thrown error or rejected promise goes to the scope's sink and
 *  never reaches the request. */
export function afterCommit(fn: () => unknown): void {
  const scope = scopes.getStore();
  if (scope?.open) scope.queue.push(fn);
  else void runSafely(fn, undefined);
}

/** Wrap a transaction: `run` resolves = committed → drain the queue. Nested
 *  calls join the outer scope, which drains after the outer commit. */
export async function withAfterCommit<T>(
  run: () => Promise<T>,
  onError?: AfterCommitErrorSink,
): Promise<T> {
  const outer = scopes.getStore();
  if (outer?.open) return run();
  const scope: Scope = { queue: [], open: true };
  let result: T;
  try {
    result = await scopes.run(scope, run);
  } finally {
    scope.open = false;
  }
  const queued = scope.queue.splice(0);
  for (const fn of queued) await runSafely(fn, onError);
  return result;
}

async function runSafely(fn: () => unknown, onError: AfterCommitErrorSink | undefined) {
  try {
    await fn();
  } catch (err) {
    onError?.(err);
  }
}
