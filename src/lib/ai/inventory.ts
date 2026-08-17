import { todayISO } from "../stock";
import { round2 } from "../sales";
import type { AssistantContext } from "../assistant";
import type { MedicineBatch, ReorderSuggestion } from "../../types";

export const REORDER_WINDOW_DAYS = 30;
export const REORDER_COVER_DAYS = 30;
export const REORDER_STOCKOUT_DAYS = 30;
export const MAX_REORDER_SUGGESTIONS = 8;

export function computeUsageByMedicine(
  ctx: AssistantContext,
  windowDays = REORDER_WINDOW_DAYS,
): Map<string, number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffTs = cutoff.getTime();
  const soldBySale = new Map<string, boolean>();
  for (const s of ctx.sales) {
    if (s.status === "COMPLETED" && s.saleDate >= cutoffTs) {
      soldBySale.set(s.id, true);
    }
  }
  const usageByMedicine = new Map<string, number>();
  for (const item of ctx.saleItems) {
    if (!soldBySale.has(item.saleId)) continue;
    usageByMedicine.set(
      item.medicineId,
      (usageByMedicine.get(item.medicineId) ?? 0) + item.quantity,
    );
  }
  return usageByMedicine;
}

export function buildReorderSuggestions(
  ctx: AssistantContext,
): ReorderSuggestion[] {
  const today = todayISO();
  const stockByMedicine = new Map<string, number>();
  const latestBatchByMedicine = new Map<string, MedicineBatch>();
  for (const b of ctx.batches) {
    if (b.quantityRemaining > 0 && b.expiryDate >= today) {
      stockByMedicine.set(
        b.medicineId,
        (stockByMedicine.get(b.medicineId) ?? 0) + b.quantityRemaining,
      );
    }
    const prev = latestBatchByMedicine.get(b.medicineId);
    if (!prev || b.createdAt > prev.createdAt) {
      latestBatchByMedicine.set(b.medicineId, b);
    }
  }

  const usageByMedicine = computeUsageByMedicine(ctx);

  const supplierName = new Map(
    ctx.suppliers.map((s) => [s.id, s.name] as const),
  );
  const results: ReorderSuggestion[] = [];

  for (const med of ctx.medicines) {
    if (med.status !== "ACTIVE") continue;
    const stock = stockByMedicine.get(med.id) ?? 0;
    const units30 = usageByMedicine.get(med.id) ?? 0;
    const dailyUsage = round2(units30 / REORDER_WINDOW_DAYS);
    const daysToOut =
      dailyUsage > 0 && stock > 0 ? Math.floor(stock / dailyUsage) : null;

    const needsReorder =
      stock === 0 ||
      (med.reorderLevel > 0 && stock <= med.reorderLevel) ||
      (daysToOut !== null && daysToOut <= REORDER_STOCKOUT_DAYS);
    if (!needsReorder) continue;

    const target = Math.max(
      Math.ceil(dailyUsage * REORDER_COVER_DAYS),
      med.reorderLevel * 2,
    );
    const recommendedQty = Math.max(0, Math.ceil(target - stock));
    if (recommendedQty <= 0) continue;

    const latest = latestBatchByMedicine.get(med.id);
    const supplierId = latest?.supplierId;
    results.push({
      medicineId: med.id,
      medicineName: med.name,
      currentStock: stock,
      dailyUsage,
      daysToOut,
      recommendedQty,
      supplierId,
      supplierName: supplierId ? supplierName.get(supplierId) : undefined,
      lastUnitCost: latest?.purchasePrice,
      unit: med.unit,
    });
  }

  const score = (r: ReorderSuggestion): number => {
    if (r.currentStock === 0) return 0;
    if (r.daysToOut === null) return 3;
    if (r.daysToOut <= 7) return 1;
    return 2;
  };
  results.sort((a, b) => {
    const s = score(a) - score(b);
    if (s !== 0) return s;
    if (a.currentStock === 0 && b.currentStock !== 0) return -1;
    if (a.currentStock !== 0 && b.currentStock === 0) return 1;
    const da = a.daysToOut ?? Number.POSITIVE_INFINITY;
    const db = b.daysToOut ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.currentStock - b.currentStock;
  });

  return results.slice(0, MAX_REORDER_SUGGESTIONS);
}
