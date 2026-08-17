import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import type { MedicineBatch, MovementType } from "../types";

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysUntil(isoDate: string): number {
  const today = new Date(`${todayISO()}T00:00:00`);
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function formatISO(isoDate: string): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

export function isExpired(batch: MedicineBatch): boolean {
  return batch.quantityRemaining > 0 && batch.expiryDate < todayISO();
}

export function isExpiringSoon(
  batch: MedicineBatch,
  warningDays: number,
): boolean {
  return (
    !isExpired(batch) &&
    batch.quantityRemaining > 0 &&
    daysUntil(batch.expiryDate) <= warningDays
  );
}

export function batchDisplayStatus(
  batch: MedicineBatch,
  warningDays: number,
): "IN_STOCK" | "EXPIRING" | "EXPIRED" | "DEPLETED" {
  if (batch.quantityRemaining <= 0) return "DEPLETED";
  if (batch.expiryDate < todayISO()) return "EXPIRED";
  if (daysUntil(batch.expiryDate) <= warningDays) return "EXPIRING";
  return "IN_STOCK";
}

export async function getFefoBatches(
  medicineId: string,
): Promise<MedicineBatch[]> {
  const today = todayISO();
  const batches = await pharmaDb.medicineBatches
    .where("medicineId")
    .equals(medicineId)
    .toArray();
  return batches
    .filter((b) => b.quantityRemaining > 0 && b.expiryDate >= today)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

export async function getTotalQuantity(medicineId: string): Promise<number> {
  const batches = await getFefoBatches(medicineId);
  return batches.reduce((sum, b) => sum + b.quantityRemaining, 0);
}

export interface BatchAdjustResult {
  batch: MedicineBatch;
  movementId: string;
}

export async function adjustBatch(
  batch: MedicineBatch,
  movementType: MovementType,
  quantity: number,
  direction: "ADD" | "REMOVE",
  performedBy: string,
  reason?: string,
  unitConversion?: number,
): Promise<BatchAdjustResult> {
  const baseQty = Math.round(quantity * (unitConversion ?? 1));
  const signed = direction === "ADD" ? baseQty : -baseQty;
  const newRemaining = Math.max(0, batch.quantityRemaining + signed);
  const status =
    newRemaining === 0
      ? "DEPLETED"
      : movementType === "EXPIRY"
        ? "EXPIRED"
        : "ACTIVE";

  await pharmaDb.medicineBatches.update(batch.id, {
    quantityRemaining: newRemaining,
    status,
    updatedAt: now(),
  });

  const movementId = uid();
  await pharmaDb.stockMovements.add({
    id: movementId,
    medicineId: batch.medicineId,
    batchId: batch.id,
    movementType,
    quantity: signed,
    performedBy,
    reason,
    createdAt: now(),
  });

  const updated = (await pharmaDb.medicineBatches.get(batch.id))!;
  return { batch: updated, movementId };
}

export interface ReceiveStockInput {
  medicineId: string;
  supplierId?: string;
  batchNumber: string;
  serialNumber?: string;
  manufacturingDate?: string;
  expiryDate: string;
  quantity: number;
  purchasePrice: number;
  sellingPrice: number;
  performedBy: string;
  unitId?: string;
  unitName?: string;
  unitConversion?: number;
}

export async function receiveStock(
  input: ReceiveStockInput,
): Promise<MedicineBatch> {
  const baseQty = Math.round(input.quantity * (input.unitConversion ?? 1));
  const existing = await pharmaDb.medicineBatches
    .where("medicineId")
    .equals(input.medicineId)
    .and(
      (b) =>
        b.batchNumber === input.batchNumber &&
        b.expiryDate === input.expiryDate &&
        b.quantityRemaining > 0,
    )
    .first();

  const timestamp = now();
  let batchId: string;

  if (existing) {
    batchId = existing.id;
    await pharmaDb.medicineBatches.update(existing.id, {
      supplierId: input.supplierId ?? existing.supplierId,
      serialNumber: input.serialNumber ?? existing.serialNumber,
      manufacturingDate:
        input.manufacturingDate ?? existing.manufacturingDate,
      purchasePrice: input.purchasePrice,
      sellingPrice: input.sellingPrice,
      unitId: input.unitId ?? existing.unitId,
      unitName: input.unitName ?? existing.unitName,
      unitConversion: input.unitConversion ?? existing.unitConversion,
      quantityReceived: existing.quantityReceived + baseQty,
      quantityRemaining: existing.quantityRemaining + baseQty,
      status: "ACTIVE",
      updatedAt: timestamp,
    });
  } else {
    batchId = uid();
    await pharmaDb.medicineBatches.add({
      id: batchId,
      medicineId: input.medicineId,
      supplierId: input.supplierId,
      batchNumber: input.batchNumber,
      serialNumber: input.serialNumber,
      manufacturingDate: input.manufacturingDate,
      expiryDate: input.expiryDate,
      purchasePrice: input.purchasePrice,
      sellingPrice: input.sellingPrice,
      quantityReceived: baseQty,
      quantityRemaining: baseQty,
      status: "ACTIVE",
      unitId: input.unitId,
      unitName: input.unitName,
      unitConversion: input.unitConversion,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await pharmaDb.stockMovements.add({
    id: uid(),
    medicineId: input.medicineId,
    batchId,
    movementType: "PURCHASE",
    quantity: baseQty,
    referenceType: "receiving",
    performedBy: input.performedBy,
    reason: `Received batch ${input.batchNumber}`,
    createdAt: timestamp,
  });

  return (await pharmaDb.medicineBatches.get(batchId))!;
}

export async function writeOffExpired(performedBy: string): Promise<number> {
  const today = todayISO();
  const expired = await pharmaDb.medicineBatches
    .filter((b) => b.quantityRemaining > 0 && b.expiryDate < today)
    .toArray();

  for (const batch of expired) {
    await pharmaDb.medicineBatches.update(batch.id, {
      quantityRemaining: 0,
      status: "EXPIRED",
      updatedAt: now(),
    });
    await pharmaDb.stockMovements.add({
      id: uid(),
      medicineId: batch.medicineId,
      batchId: batch.id,
      movementType: "EXPIRY",
      quantity: -batch.quantityRemaining,
      performedBy,
      reason: `Expired on ${batch.expiryDate}`,
      createdAt: now(),
    });
  }

  return expired.length;
}

export interface FefoAllocation {
  batchId: string;
  baseQuantity: number;
  costPrice: number;
}

export interface DeductStockOptions {
  performedBy: string;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  timestamp?: number;
}

export async function deductStockFefo(
  medicineId: string,
  baseQuantity: number,
  opts: DeductStockOptions,
): Promise<FefoAllocation[]> {
  const dateKey = todayISO();
  const timestamp = opts.timestamp ?? now();

  const available = (await pharmaDb.medicineBatches
    .where("medicineId")
    .equals(medicineId)
    .toArray())
    .filter((b) => b.quantityRemaining > 0 && b.expiryDate >= dateKey)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  const totalAvailable = available.reduce(
    (sum, b) => sum + b.quantityRemaining,
    0,
  );
  if (totalAvailable < baseQuantity) {
    throw new Error(
      `Insufficient stock: need ${baseQuantity} base units, available ${totalAvailable}.`,
    );
  }

  const allocations: FefoAllocation[] = [];
  let remaining = baseQuantity;

  for (const batch of available) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.quantityRemaining);
    const newRemaining = batch.quantityRemaining - take;
    await pharmaDb.medicineBatches.update(batch.id, {
      quantityRemaining: newRemaining,
      status: newRemaining === 0 ? "DEPLETED" : "ACTIVE",
      updatedAt: timestamp,
    });
    await pharmaDb.stockMovements.add({
      id: uid(),
      medicineId,
      batchId: batch.id,
      movementType: "SALE",
      quantity: -take,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
      performedBy: opts.performedBy,
      reason: opts.reason,
      createdAt: timestamp,
    });
    allocations.push({
      batchId: batch.id,
      baseQuantity: take,
      costPrice: batch.purchasePrice,
    });
    remaining -= take;
  }

  return allocations;
}
