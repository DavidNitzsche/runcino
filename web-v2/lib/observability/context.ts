/**
 * lib/observability/context.ts · Node-only request context.
 *
 * `AsyncLocalStorage` threads the correlation id (and a little request
 * metadata) through a request's async call graph without prop-drilling it
 * into every DB/upstream call site. NODE RUNTIME ONLY — `middleware.ts`
 * (Edge) must never import this file; it imports `./constants` instead.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestObservabilityContext {
  correlationId: string;
  routePath: string;
  method: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestObservabilityContext>();

export function runWithRequestContext<T>(
  ctx: RequestObservabilityContext,
  fn: () => T,
): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestObservabilityContext | undefined {
  return storage.getStore();
}

/** Convenience accessor for call sites that only need the id (e.g. a
 *  DB/upstream wrapper tagging an error with "which request was this"). */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
