import type { BillingPlanPrice } from "./api";

export function period(price: BillingPlanPrice) {
  const unit = price.billingInterval === "month" ? "mes" : "año";
  return price.billingIntervalCount === 1
    ? `Cada ${unit}`
    : `Cada ${price.billingIntervalCount} ${price.billingInterval === "month" ? "meses" : "años"}`;
}
export function featureValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Incluido" : "No incluido";
  if (value === null || value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
