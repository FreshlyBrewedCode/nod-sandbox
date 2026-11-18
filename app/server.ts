import { normalise } from "../modules/search/query";

export function handle(path: string, requestId = crypto.randomUUID()): string {
  console.info(`request ${requestId} ${path}`);
  if (path.startsWith("/search/")) return `results for ${normalise(path.slice(8))}`;
  return "not found: try /search/<words>";
}

export function health(): string {
  return "ok";
}
