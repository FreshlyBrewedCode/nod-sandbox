export interface Invoice {
  id: string;
  cents: number;
  currency: "EUR" | "USD";
}

/** Sums invoices; amounts are whole cents, so no rounding happens here. */
export function total(invoices: Invoice[]): number {
  return invoices.reduce((sum, i) => sum + Math.round(i.cents), 0);
}
