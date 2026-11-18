export interface Invoice {
  id: string;
  cents: number;
  currency: "EUR" | "USD";
}

export function total(invoices: Invoice[]): number {
  return invoices.reduce((sum, i) => sum + i.cents, 0);
}
