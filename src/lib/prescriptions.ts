import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import { completeSale, round2 } from "./sales";
import { fullName } from "./patients";
import { registerMovement } from "./controlled";
import {
  isBlockingResult,
  recordSafetyChecks,
  runSafetyChecks,
  type SafetyOverrideInput,
} from "./safety";
import type {
  DispensingRecord,
  Medicine,
  PaymentMethod,
  Prescription,
  PrescriptionItem,
} from "../types";

export type PrescriptionStatus = Prescription["status"];

export function prescriptionStatusTone(
  status: PrescriptionStatus,
): "green" | "red" | "amber" | "slate" {
  switch (status) {
    case "DISPENSED":
      return "green";
    case "CANCELLED":
      return "red";
    default:
      return "amber";
  }
}

export function formatDoctorName(name?: string): string {
  if (!name) return "—";
  const trimmed = name.trim();
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
}

/** Auto-generated, permanent, never-reused per year: RX-YYYY-NNNNN */
export async function nextPrescriptionNumber(): Promise<string> {
  const prefix = `RX-${new Date().getFullYear()}-`;
  const all = await pharmaDb.prescriptions.toArray();
  let max = 0;
  for (const p of all) {
    if (!p.prescriptionNumber.startsWith(prefix)) continue;
    const n = Number(p.prescriptionNumber.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

export interface PrescriptionLineInput {
  medicineId: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  quantity: number;
  instructions?: string;
}

export interface CreatePrescriptionInput {
  patientId: string;
  admissionId?: string;
  doctorName?: string;
  doctorLicense?: string;
  note?: string;
  items: PrescriptionLineInput[];
  createdBy?: string;
}

export async function createPrescription(
  input: CreatePrescriptionInput,
): Promise<Prescription> {
  if (!input.patientId) throw new Error("Patient is required.");
  if (input.items.length === 0) throw new Error("Add at least one medicine.");
  for (const it of input.items) {
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
      throw new Error("Each line needs a quantity greater than 0.");
    }
  }

  const patient = await pharmaDb.patients.get(input.patientId);
  if (!patient) throw new Error("Patient not found.");

  const medicineDetails = new Map<
    string,
    { name: string; strength?: string }
  >();
  for (const it of input.items) {
    const m = await pharmaDb.medicines.get(it.medicineId);
    if (!m) throw new Error("A selected medicine no longer exists.");
    medicineDetails.set(it.medicineId, {
      name: m.name,
      strength: m.strength,
    });
  }

  const timestamp = now();
  const prescription: Prescription = {
    id: uid(),
    prescriptionNumber: await nextPrescriptionNumber(),
    patientId: patient.id,
    patientName: fullName(patient),
    admissionId: input.admissionId,
    doctorName: input.doctorName?.trim() || undefined,
    doctorLicense: input.doctorLicense?.trim() || undefined,
    prescribedDate: timestamp,
    status: "PENDING",
    note: input.note?.trim() || undefined,
    createdBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const items: PrescriptionItem[] = input.items.map((it) => {
    const detail = medicineDetails.get(it.medicineId);
    return {
      id: uid(),
      prescriptionId: prescription.id,
      medicineId: it.medicineId,
      medicineName: detail?.name ?? "Unknown medicine",
      strength: detail?.strength,
      dosage: it.dosage?.trim() || undefined,
      frequency: it.frequency?.trim() || undefined,
      duration: it.duration?.trim() || undefined,
      quantity: it.quantity,
      instructions: it.instructions?.trim() || undefined,
      dispensedQty: 0,
      createdAt: timestamp,
    };
  });

  await pharmaDb.transaction(
    "rw",
    [pharmaDb.prescriptions, pharmaDb.prescriptionItems, pharmaDb.auditLogs],
    async () => {
      await pharmaDb.prescriptions.add(prescription);
      await pharmaDb.prescriptionItems.bulkAdd(items);
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: input.createdBy ?? "N/A",
        action: "CREATE",
        entityType: "prescription",
        entityId: prescription.id,
        newValues: {
          prescriptionNumber: prescription.prescriptionNumber,
          patientName: prescription.patientName,
        },
        createdAt: timestamp,
      });
    },
  );

  return prescription;
}

export async function cancelPrescription(
  prescriptionId: string,
  actorId?: string,
): Promise<void> {
  const p = await pharmaDb.prescriptions.get(prescriptionId);
  if (!p) throw new Error("Prescription not found.");
  if (p.status !== "PENDING") {
    throw new Error("Only pending prescriptions can be cancelled.");
  }
  const timestamp = now();
  await pharmaDb.prescriptions.update(prescriptionId, {
    status: "CANCELLED",
    updatedAt: timestamp,
  });
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: actorId ?? "N/A",
    action: "CANCEL",
    entityType: "prescription",
    entityId: prescriptionId,
    oldValues: { status: "PENDING" },
    newValues: { status: "CANCELLED" },
    createdAt: timestamp,
  });
}

export interface DispenseInput {
  prescriptionId: string;
  paymentMethod: PaymentMethod;
  cashierId: string;
  cashierName?: string;
  pharmacistId?: string;
  pharmacistName?: string;
  safetyOverrides?: SafetyOverrideInput[];
}

const WALLET_ONLY = new Set<PaymentMethod>([
  "CASH",
  "CREDIT",
  "OTHER",
]);

/**
 * Dispenses a prescription: creates a COMPLETED sale (stock deducted FEFO,
 * payment recorded), writes dispensing records per line, and links the
 * prescription to the sale/invoice. Gateway payments (mobile money, bank,
 * card, PayPal) are intentionally routed through the POS payment flow where
 * provider confirmation is verified; Cash/Credit/Other dispense inline.
 */
export async function dispensePrescription(
  input: DispenseInput,
): Promise<{ prescription: Prescription; invoiceNumber: string }> {
  const prescription = await pharmaDb.prescriptions.get(input.prescriptionId);
  if (!prescription) throw new Error("Prescription not found.");
  if (prescription.status !== "PENDING") {
    throw new Error("Prescription is not pending for dispensing.");
  }

  const items = await pharmaDb.prescriptionItems
    .where("prescriptionId")
    .equals(prescription.id)
    .toArray();
  if (items.length === 0) throw new Error("Prescription has no items.");

  const patient = await pharmaDb.patients.get(prescription.patientId);
  if (!patient) throw new Error("Patient not found.");

  const method = input.paymentMethod;
  if (!WALLET_ONLY.has(method)) {
    throw new Error(
      "Online payments (mobile money, bank, card, PayPal) require provider confirmation. Use Cash or Credit, or complete the payment from POS.",
    );
  }

  const priceOf = new Map<string, number>();
  const medicineOf = new Map<string, Medicine>();
  for (const it of items) {
    const m = await pharmaDb.medicines.get(it.medicineId);
    if (!m) throw new Error(`Medicine not found for ${it.medicineName}.`);
    priceOf.set(it.medicineId, m.sellingPrice);
    medicineOf.set(it.medicineId, m);
  }

  const cdrItems = items.filter(
    (it) => medicineOf.get(it.medicineId)?.controlCategory === "CDR",
  );
  if (cdrItems.length > 0 && !input.pharmacistId) {
    throw new Error(
      "This prescription contains a controlled medicine (CDR). An authorized pharmacist must authorize the dispensing.",
    );
  }

  const safetyResults = await runSafetyChecks({
    patientId: prescription.patientId,
    medicineIds: items.map((it) => it.medicineId),
    prescriptionId: prescription.id,
  });
  const overrides = input.safetyOverrides ?? [];
  const overrideTypes = new Set(overrides.map((o) => o.checkType));
  const blocking = safetyResults.filter(
    (r) => isBlockingResult(r) && !overrideTypes.has(r.checkType),
  );
  if (blocking.length > 0) {
    throw new Error(
      `Safety block: ${blocking[0].detail} Authorize the override with a reason to continue.`,
    );
  }

  const lines = items.map((it) => ({
    medicineId: it.medicineId,
    quantity: it.quantity,
    unitPrice: priceOf.get(it.medicineId) ?? 0,
  }));
  const total = round2(
    lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
  );

  const sale = await completeSale({
    lines,
    customerName: fullName(patient),
    customerPhone: patient.phone,
    discount: 0,
    taxRate: 0,
    payments: [{ method, amount: total, currency: "UGX" }],
    cashierId: input.cashierId,
    cashierName: input.cashierName,
    note: `Prescription ${prescription.prescriptionNumber}`,
  });

  const saleItems = await pharmaDb.saleItems
    .where("saleId")
    .equals(sale.id)
    .toArray();
  const batchIdsByMedicine = new Map<string, string[]>();
  for (const si of saleItems) {
    batchIdsByMedicine.set(
      si.medicineId,
      si.batches.map((b) => b.batchId),
    );
  }

  const timestamp = now();
  const records: DispensingRecord[] = items.map((it) => ({
    id: uid(),
    prescriptionId: prescription.id,
    prescriptionItemId: it.id,
    saleId: sale.id,
    medicineId: it.medicineId,
    medicineName: it.medicineName,
    batchIds: batchIdsByMedicine.get(it.medicineId) ?? [],
    qty: it.quantity,
    dispensedBy: input.cashierId,
    dispensedByName: input.cashierName,
    dispensedAt: timestamp,
  }));

  await pharmaDb.transaction(
    "rw",
    [
      pharmaDb.prescriptions,
      pharmaDb.prescriptionItems,
      pharmaDb.dispensingRecords,
      pharmaDb.auditLogs,
      pharmaDb.controlledDrugRegister,
      pharmaDb.safetyAlertChecks,
      pharmaDb.medicines,
      pharmaDb.medicineBatches,
    ],
    async () => {
      await pharmaDb.dispensingRecords.bulkAdd(records);
      for (const it of items) {
        await pharmaDb.prescriptionItems.update(it.id, {
          dispensedQty: it.quantity,
        });
      }
      await pharmaDb.prescriptions.update(prescription.id, {
        status: "DISPENSED",
        saleId: sale.id,
        invoiceNumber: sale.invoiceNumber,
        updatedAt: timestamp,
      });
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: input.cashierId,
        action: "DISPENSE",
        entityType: "prescription",
        entityId: prescription.id,
        oldValues: { status: "PENDING" },
        newValues: {
          status: "DISPENSED",
          invoiceNumber: sale.invoiceNumber,
          amount: total,
        },
        createdAt: timestamp,
      });

      for (const it of cdrItems) {
        const batchIds = batchIdsByMedicine.get(it.medicineId) ?? [];
        for (const { batchId, qty } of splitAcrossBatches(it.quantity, batchIds)) {
          await registerMovement({
            medicineId: it.medicineId,
            batchId,
            transactionType: "DISPENSED",
            quantity: qty,
            patientId: prescription.patientId,
            prescriptionId: prescription.id,
            prescriberName: prescription.doctorName,
            pharmacistId: input.pharmacistId ?? input.cashierId,
            pharmacistName:
              input.pharmacistName ?? input.cashierName ?? "Authorized pharmacist",
            reason: `Dispensed via ${prescription.prescriptionNumber}`,
          });
        }
      }

      await recordSafetyChecks({
        patientId: prescription.patientId,
        prescriptionId: prescription.id,
        results: safetyResults,
        overrides,
        actorId: input.pharmacistId ?? input.cashierId,
        actorName: input.pharmacistName ?? input.cashierName,
      });
    },
  );

  return { prescription: prescription, invoiceNumber: sale.invoiceNumber };
}

function splitAcrossBatches(
  quantity: number,
  batchIds: string[],
): Array<{ batchId: string; qty: number }> {
  if (batchIds.length === 0) return [];
  if (batchIds.length === 1) return [{ batchId: batchIds[0], qty: quantity }];
  const result: Array<{ batchId: string; qty: number }> = [];
  let remaining = quantity;
  const per = Math.floor(quantity / batchIds.length);
  batchIds.forEach((b, i) => {
    const qty = i === batchIds.length - 1 ? remaining : per;
    remaining -= qty;
    result.push({ batchId: b, qty });
  });
  return result;
}
