import { phrases } from "./phrases";

/** Ranks results that contain a quoted phrase verbatim first. */
export function rank(query: string, results: string[]): string[] {
  const quoted = phrases(query).filter((p) => p.includes(" "));
  const exact = (r: string) => quoted.some((p) => r.toLowerCase().includes(p.toLowerCase()));
  return [...results.filter(exact), ...results.filter((r) => !exact(r))];
}
