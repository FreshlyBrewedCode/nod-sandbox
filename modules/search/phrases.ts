/** Splits a query into words and "quoted phrases". */
export function phrases(query: string): string[] {
  return [...query.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}
