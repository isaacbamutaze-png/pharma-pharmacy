import { daysUntil, formatISO } from "../stock";
import { round2 } from "../sales";
import { computeUsageByMedicine } from "./inventory";
import type { AssistantContext } from "../assistant";
import type { ExpiryRiskItem } from "../../types";

export const EXPIRY_WINDOW_DAYS = 90;
export const EXPIRY_SEVERE_DAYS = 30;
export const MAX_EXPIRY_ITEMS = 8;

export function buildExpiryIntelligence(
  ctx: AssistantContext,
): ExpiryRiskItem[] {
  const usageByMedicine = computeUsageByMedicine(ctx);
  const supplierName = new Map(
    ctx.suppliers.map((s) => [s.id, s.name] as const),
  );

  const items: ExpiryRiskItem[] = [];
  for (const b of ctx.batches) {
    if (b.quantityRemaining <= 0) continue;
    const days = daysUntil(b.expiryDate);
    if (days < 0 || days > EXPIRY_WINDOW_DAYS) continue;

    const dailyUsage = round2((usageByMedicine.get(b.medicineId) ?? 0) / 30);
    const sellThrough =
      dailyUsage > 0 ? Math.round(dailyUsage * days) : 0;
    const likelyLeftover = Math.max(0, b.quantityRemaining - sellThrough);
    const atRisk = likelyLeftover > 0;

    const severity = atRisk
      ? days <= EXPIRY_SEVERE_DAYS
        ? "SEVERE"
        : "WATCH"
      : "HEALTHY";

    const actions: string[] = [];
    if (atRisk) {
      actions.push(
        "Prioritize dispensing of this batch where clinically appropriate",
      );
      if (days <= EXPIRY_SEVERE_DAYS) {
        actions.push("Avoid new purchases until this stock clears");
        if (b.supplierId && supplierName.get(b.supplierId)) {
          actions.push(
            `Contact ${supplierName.get(b.supplierId)} about return or exchange`,
          );
        }
      }
      actions.push("Review the purchasing plan for this medicine");
    }

    items.push({
      batchId: b.id,
      medicineId: b.medicineId,
      medicineName: ctx.medicines.find((m) => m.id === b.medicineId)?.name ?? "Unknown",
      batchNumber: b.batchNumber,
      expiryDate: b.expiryDate,
      days,
      quantity: b.quantityRemaining,
      dailyUsage,
      sellThrough,
      likelyLeftover,
      atRisk,
      severity,
      costAtRisk: atRisk ? round2(likelyLeftover * b.purchasePrice) : 0,
      suggestedActions: actions,
      supplierName: b.supplierId ? supplierName.get(b.supplierId) : undefined,
    });
  }

  const severityRank = { SEVERE: 0, WATCH: 1, HEALTHY: 2 } as const;
  items.sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    if (a.days !== b.days) return a.days - b.days;
    return b.costAtRisk - a.costAtRisk;
  });

  return items.slice(0, MAX_EXPIRY_ITEMS);
}

export function formatExpiryDate(iso: string): string {
  return formatISO(iso);
}
