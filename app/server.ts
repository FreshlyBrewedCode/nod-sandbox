import { normalise } from "../modules/search/query";

export function handle(path: string, requestId = crypto.randomUUID()): string {
  console.info(`request ${requestId} ${path}`);
  if (path.startsWith("/search/")) return `results for ${normalise(path.slice(8))}`;
  return "not found: try /search/<words>";
}

const started = Date.now();

export function health(): string {
  return `ok, up ${Math.round((Date.now() - started) / 1000)} s`;
}

export function logSlow(path: string, ms: number): void {
  if (ms > 300) console.warn(`slow request ${path}: ${ms} ms`);
}
