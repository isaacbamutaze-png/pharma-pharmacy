import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import type { Medicine, MedicineUnit } from "../types";

export function toBaseQuantity(
  unit: Pick<MedicineUnit, "conversionToBase">,
  quantity: number,
): number {
  return Math.round(quantity * unit.conversionToBase);
}

export function fromBaseQuantity(
  unit: Pick<MedicineUnit, "conversionToBase">,
  baseQuantity: number,
): number {
  if (!unit.conversionToBase) return baseQuantity;
  return baseQuantity / unit.conversionToBase;
}

export async function getMedicineUnits(
  medicineId: string,
): Promise<MedicineUnit[]> {
  return pharmaDb.medicineUnits
    .where("medicineId")
    .equals(medicineId)
    .sortBy("sortOrder");
}

export async function getDefaultUnit(
  medicineId: string,
): Promise<MedicineUnit | undefined> {
  const units = await getMedicineUnits(medicineId);
  return (
    units.find((u) => u.isDefault) ??
    units.find((u) => u.isBase) ??
    units[0]
  );
}

export async function getBaseUnit(
  medicineId: string,
): Promise<MedicineUnit | undefined> {
  const units = await getMedicineUnits(medicineId);
  return units.find((u) => u.isBase) ?? units[0];
}

export async function getUnitById(
  unitId: string,
): Promise<MedicineUnit | undefined> {
  return pharmaDb.medicineUnits.get(unitId);
}

export async function ensureBaseUnit(
  medicine: Pick<Medicine, "id" | "unit" | "baseUnit" | "sellingPrice">,
): Promise<MedicineUnit> {
  const existing = await getBaseUnit(medicine.id);
  if (existing) return existing;

  const unitName = medicine.baseUnit || medicine.unit || "Unit";
  const unitCode =
    unitName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "UNIT";

  const unit: MedicineUnit = {
    id: uid(),
    medicineId: medicine.id,
    unitName,
    unitCode,
    conversionToBase: 1,
    sellingPrice: medicine.sellingPrice,
    canSell: true,
    canPurchase: true,
    isDefault: true,
    isBase: true,
    sortOrder: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  await pharmaDb.medicineUnits.add(unit);
  return unit;
}

let unitsDone = false;
let unitsHealing = false;

export async function ensureBaseUnitsForAll(): Promise<number> {
  if (unitsDone) return 0;
  if (unitsHealing) return 0;
  unitsHealing = true;
  try {
    const medicines = await pharmaDb.medicines.toArray();
    let created = 0;
    for (const med of medicines) {
      if (await getBaseUnit(med.id)) continue;
      await ensureBaseUnit(med);
      created += 1;
    }
    unitsDone = true;
    return created;
  } finally {
    unitsHealing = false;
  }
}
