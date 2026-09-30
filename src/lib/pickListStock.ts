/** Stock shown on a pick line.
 * A missing inventory row stays null and is not backordered.
 * A tracked quantity of 0 stays 0 and is backordered. Do not turn 0 into null.
 */
export function trackedStock(sum: number | null | undefined): {
  quantityOnHand: number | null;
  backordered: boolean;
} {
  if (sum == null || Number.isNaN(sum)) {
    return { quantityOnHand: null, backordered: false };
  }
  return { quantityOnHand: sum, backordered: sum <= 0 };
}
