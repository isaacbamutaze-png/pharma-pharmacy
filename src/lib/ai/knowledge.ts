import { todayISO } from "../stock";
import { round2 } from "../sales";
import type { AssistantContext } from "../assistant";
import type {
  KnowledgeInteraction,
  MedicineKnowledgeProfile,
} from "../../types";

export function findMedicineProfile(
  ctx: AssistantContext,
  query: string,
): MedicineKnowledgeProfile | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const hay = (m: { name: string; genericName?: string; strength?: string }) =>
    `${m.name} ${m.genericName ?? ""} ${m.strength ?? ""}`.toLowerCase();

  const matched =
    ctx.medicines.find((m) => hay(m).includes(q)) ??
    ctx.medicines.find((m) =>
      q
        .split(/\s+/)
        .filter((t) => t.length > 2)
        .some((t) => hay(m).includes(t)),
    );
  if (!matched) return null;

  const today = todayISO();
  let stockTotal = 0;
  let stockBatches = 0;
  let stockValueCost = 0;
  let stockValueSale = 0;
  const supplierById = new Map(ctx.suppliers.map((s) => [s.id, s.name]));
  const supplierCost = new Map<string, number>();
  const supplierLatest = new Map<string, number>();
  for (const batch of ctx.batches) {
    if (batch.medicineId !== matched.id || batch.quantityRemaining <= 0) continue;
    if (batch.expiryDate >= today) {
      stockTotal += batch.quantityRemaining;
      stockBatches += 1;
      stockValueCost += batch.quantityRemaining * batch.purchasePrice;
      stockValueSale += batch.quantityRemaining * batch.sellingPrice;
    }
    if (batch.supplierId) {
      const latest = supplierLatest.get(batch.supplierId);
      if (latest === undefined || batch.createdAt > latest) {
        supplierLatest.set(batch.supplierId, batch.createdAt);
        supplierCost.set(batch.supplierId, batch.purchasePrice);
      }
    }
  }

  const medById = new Map(ctx.medicines.map((m) => [m.id, m.name]));
  const interactions: KnowledgeInteraction[] = [];
  for (const d of ctx.drugInteractions) {
    if (d.medicineAId === matched.id) {
      interactions.push({
        otherMedicineName: medById.get(d.medicineBId) ?? "Unknown",
        severity: d.severity,
        detail: d.detail,
      });
    } else if (d.medicineBId === matched.id) {
      interactions.push({
        otherMedicineName: medById.get(d.medicineAId) ?? "Unknown",
        severity: d.severity,
        detail: d.detail,
      });
    }
  }

  const warnings = ctx.medicineWarnings
    .filter((w) => w.medicineId === matched.id)
    .map((w) => ({ type: w.warningType, message: w.message, severity: w.severity }));

  const barcodes = ctx.medicineBarcodes
    .filter((bc) => bc.medicineId === matched.id)
    .map((bc) => bc.barcode);

  return {
    medicineId: matched.id,
    name: matched.name,
    genericName: matched.genericName,
    strength: matched.strength,
    therapeuticCategory: matched.therapeuticCategory,
    controlCategory: matched.controlCategory,
    prescriptionRequired: matched.prescriptionRequired,
    unit: matched.unit,
    sellingPrice: matched.sellingPrice,
    stockTotal,
    stockBatches,
    stockValueCost: round2(stockValueCost),
    stockValueSale: round2(stockValueSale),
    suppliers: [...supplierCost.entries()].map(([id, lastUnitCost]) => ({
      name: supplierById.get(id) ?? "Unknown",
      lastUnitCost,
    })),
    interactions,
    warnings,
    barcodes,
    source:
      "Grounded in PHARMA's stored knowledge data (interaction and warning rules) plus your inventory and supplier records — not generated from general knowledge.",
  };
}
