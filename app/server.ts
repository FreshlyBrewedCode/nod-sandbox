import { normalise } from "../modules/search/query";

export function handle(path: string): string {
  if (path.startsWith("/search/")) return `results for ${normalise(path.slice(8))}`;
  return "not found: try /search/<words>";
}

export function health(): string {
  return "ok";
}

export function logSlow(path: string, ms: number): void {
  if (ms > 300) console.warn(`slow request ${path}: ${ms} ms`);
}
