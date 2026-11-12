import { pharmaDb } from "../db";
import { adjustBatch } from "./stock";
import { uid, now } from "./utils";
import type { StockTake, StockTakeItem } from "../types";

/**
 * Stock taking (blueprint 5.4): count -> submit -> admin approves -> adjustments.
 * Unapproved counts never touch stock. Approved variances are applied as
 * ADJUSTMENT movements with a reason and an approver, never as "set stock = N".
 */

export interface TakeProgress {
  total: number;
  counted: number;
  withVariance: number;
  netVariance: number;
}

export function takeProgress(items: StockTakeItem[]): TakeProgress {
  const counted = items.filter((i) => i.physicalQty !== undefined);
  const withVar = counted.filter((i) => (i.variance ?? 0) !== 0);
  return {
    total: items.length,
    counted: counted.length,
    withVariance: withVar.length,
    netVariance: withVar.reduce((n, i) => n + (i.variance ?? 0), 0),
  };
}

export async function createStockTake(
  createdBy: string,
  note?: string,
): Promise<StockTake> {
  const open = await pharmaDb.stockTakes
    .where("status")
    .anyOf("COUNTING", "SUBMITTED")
    .count();
  if (open > 0) {
    throw new Error(
      "Finish or reject the open stock take first. Only one can run at a time so counts do not conflict.",
    );
  }
  const [batches, medicines, total] = await Promise.all([
    pharmaDb.medicineBatches.toArray(),
    pharmaDb.medicines.toArray(),
    pharmaDb.stockTakes.count(),
  ]);
  const names = new Map(medicines.map((m) => [m.id, m.name] as const));
  // Controlled drugs are reconciled in the Controlled Drug Register (dual
  // authorization), never through a general stock take.
  const controlled = new Set(
    medicines.filter((m) => m.controlCategory === "CDR").map((m) => m.id),
  );
  const counted = batches
    .filter((b) => b.quantityRemaining > 0 && !controlled.has(b.medicineId))
    .sort((a, b) =>
      (names.get(a.medicineId) ?? "").localeCompare(names.get(b.medicineId) ?? ""),
    );
  if (counted.length === 0) throw new Error("There is no stock to count yet.");

  const take: StockTake = {
    id: uid(),
    takeNumber: `ST-${new Date().getFullYear()}-${String(total + 1).padStart(4, "0")}`,
    status: "COUNTING",
    note: note?.trim() || undefined,
    createdBy,
    createdAt: now(),
  };
  const items: StockTakeItem[] = counted.map((b) => ({
    id: uid(),
    stockTakeId: take.id,
    medicineId: b.medicineId,
    medicineName: names.get(b.medicineId) ?? "Unknown medicine",
    batchId: b.id,
    batchNumber: b.batchNumber,
    expiryDate: b.expiryDate,
    systemQty: b.quantityRemaining,
  }));
  await pharmaDb.transaction(
    "rw",
    [pharmaDb.stockTakes, pharmaDb.stockTakeItems],
    async () => {
      await pharmaDb.stockTakes.add(take);
      await pharmaDb.stockTakeItems.bulkAdd(items);
    },
  );
  return take;
}

export async function saveCount(
  itemId: string,
  physicalQty: number | undefined,
  reason?: string,
): Promise<void> {
  const item = await pharmaDb.stockTakeItems.get(itemId);
  if (!item) return;
  const take = await pharmaDb.stockTakes.get(item.stockTakeId);
  if (!take || take.status !== "COUNTING") {
    throw new Error("This stock take is no longer open for counting.");
  }
  if (physicalQty !== undefined && (!Number.isInteger(physicalQty) || physicalQty < 0)) {
    throw new Error("Enter a whole number of units, zero or more.");
  }
  await pharmaDb.stockTakeItems.update(itemId, {
    physicalQty,
    variance: physicalQty === undefined ? undefined : physicalQty - item.systemQty,
    reason: reason?.trim() || undefined,
  });
}

export async function submitStockTake(takeId: string): Promise<void> {
  const take = await pharmaDb.stockTakes.get(takeId);
  if (!take || take.status !== "COUNTING") throw new Error("Not open for counting.");
  const items = await pharmaDb.stockTakeItems.where("stockTakeId").equals(takeId).toArray();
  const p = takeProgress(items);
  if (p.counted === 0) throw new Error("Count at least one item before submitting.");
  const missing = items.filter(
    (i) => i.physicalQty !== undefined && (i.variance ?? 0) !== 0 && !i.reason,
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} item(s) with a difference need a reason (e.g. Damaged, Lost, Counting error).`,
    );
  }
  await pharmaDb.stockTakes.update(takeId, { status: "SUBMITTED", submittedAt: now() });
}

export async function approveStockTake(
  takeId: string,
  approverId: string,
): Promise<{ adjusted: number }> {
  let adjusted = 0;
  await pharmaDb.transaction(
    "rw",
    [
      pharmaDb.stockTakes,
      pharmaDb.stockTakeItems,
      pharmaDb.medicineBatches,
      pharmaDb.stockMovements,
      pharmaDb.auditLogs,
    ],
    async () => {
      const take = await pharmaDb.stockTakes.get(takeId);
      if (!take || take.status !== "SUBMITTED") {
        throw new Error("Only a submitted stock take can be approved.");
      }
      const items = await pharmaDb.stockTakeItems.where("stockTakeId").equals(takeId).toArray();
      for (const item of items) {
        const variance = item.variance ?? 0;
        if (item.physicalQty === undefined || variance === 0) continue;
        const batch = await pharmaDb.medicineBatches.get(item.batchId);
        if (!batch) continue;
        // Apply the DIFFERENCE, so sales made while counting are not overwritten.
        const before = batch.quantityRemaining;
        const reason = `Stock take ${take.takeNumber}: ${item.reason ?? "count variance"}`;
        const result = await adjustBatch(
          batch,
          "ADJUSTMENT",
          Math.abs(variance),
          variance > 0 ? "ADD" : "REMOVE",
          approverId,
          reason,
        );
        // adjustBatch resets status to ACTIVE; an expired batch must stay expired.
        if (batch.status === "EXPIRED" && result.batch.quantityRemaining > 0) {
          await pharmaDb.medicineBatches.update(batch.id, { status: "EXPIRED" });
        }
        await pharmaDb.auditLogs.add({
          id: uid(),
          userId: approverId,
          action: "STOCK_TAKE_ADJUST",
          entityType: "medicineBatches",
          entityId: batch.id,
          oldValues: { quantityRemaining: before, medicine: item.medicineName, batch: item.batchNumber },
          newValues: {
            quantityRemaining: result.batch.quantityRemaining,
            reason,
            stockTake: take.takeNumber,
          },
          createdAt: now(),
        });
        adjusted++;
      }
      await pharmaDb.stockTakes.update(takeId, {
        status: "APPROVED",
        approvedBy: approverId,
        approvedAt: now(),
      });
    },
  );
  return { adjusted };
}

export async function rejectStockTake(
  takeId: string,
  approverId: string,
  reason: string,
): Promise<void> {
  const take = await pharmaDb.stockTakes.get(takeId);
  if (!take || (take.status !== "SUBMITTED" && take.status !== "COUNTING")) {
    throw new Error("This stock take is already closed.");
  }
  await pharmaDb.stockTakes.update(takeId, {
    status: "REJECTED",
    approvedBy: approverId,
    approvedAt: now(),
    rejectedReason: reason.trim() || "Rejected",
  });
}
