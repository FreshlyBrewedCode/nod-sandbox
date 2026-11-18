import { phrases } from "./phrases";

/** Ranks results that contain a quoted phrase verbatim first, then by how many of the query's words they hold. */
export function rank(query: string, results: string[]): string[] {
  const parts = phrases(query);
  const quoted = parts.filter((p) => p.includes(" "));
  const exact = (r: string) => quoted.some((p) => r.toLowerCase().includes(p.toLowerCase()));
  const hits = (r: string) => parts.filter((p) => r.toLowerCase().includes(p.toLowerCase())).length;
  const byHits = (a: string, b: string) => hits(b) - hits(a);
  return [...results.filter(exact).sort(byHits), ...results.filter((r) => !exact(r)).sort(byHits)];
}
