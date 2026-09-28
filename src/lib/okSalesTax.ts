/** Oklahoma combined sales tax on STORE PRODUCTS only.
 * Tuition enrollment never uses this. Shipping is excluded from the tax base.
 */

export const OK_SALES_TAX_RATE = 0.1;

export function isOklahomaState(state: string | null | undefined): boolean {
  const normalized = (state ?? "").trim().toUpperCase();
  return normalized === "OK" || normalized === "OKLAHOMA";
}

/**
 * Ship-to is taxed when the destination state is Oklahoma.
 * Local pickup is always an Oklahoma sale: the only pickup location is
 * MCA's office at 2300 NW 32nd Street, Newcastle, OK 73065.
 */
export function shouldApplyOklahomaStoreTax(input: {
  fulfillment: "ship" | "pickup";
  addressState?: string | null;
}): boolean {
  if (input.fulfillment === "pickup") return true;
  return isOklahomaState(input.addressState);
}

export function oklahomaProductTaxCents(productSubtotalCents: number): number {
  if (productSubtotalCents <= 0) return 0;
  return Math.round(productSubtotalCents * OK_SALES_TAX_RATE);
}
