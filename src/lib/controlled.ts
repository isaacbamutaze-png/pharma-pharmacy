import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import type {
  ControlledDrugCount,
  ControlledDrugRegisterEntry,
  ControlRequisition,
  Medicine,
  RegisterTransactionType,
} from "../types";

export function isControlled(medicine?: Medicine | null): boolean {
  return medicine?.controlCategory === "CDR";
}

export function controlCategoryLabel(
  category?: Medicine["controlCategory"],
): string {
  return category === "CDR" ? "Controlled / Restricted (CDR)" : "General";
}

export function registerTypeTone(
  type: RegisterTransactionType,
): "green" | "red" | "amber" | "slate" {
  switch (type) {
    case "RECEIVED":
    case "RETURNED":
    case "REQUISITION_RECEIVE":
      return "green";
    case "DISPENSED":
    case "DESTROYED":
    case "REQUISITION_ISSUE":
      return "red";
    default:
      return "amber";
  }
}

function qtySign(type: RegisterTransactionType): number {
  switch (type) {
    case "RECEIVED":
    case "RETURNED":
    case "REQUISITION_RECEIVE":
      return 1;
    default:
      return -1;
  }
}

function requiresDualAuth(type: RegisterTransactionType): boolean {
  return type === "DESTROYED" || type === "ADJUSTMENT";
}

export async function nextRegisterEntryNumber(): Promise<string> {
  const prefix = `CDR-${new Date().getFullYear()}-`;
  const all = await pharmaDb.controlledDrugRegister.toArray();
  let max = 0;
  for (const e of all) {
    if (!e.entryNumber.startsWith(prefix)) continue;
    const n = Number(e.entryNumber.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

export async function nextCountNumber(): Promise<string> {
  const prefix = `CT-${new Date().getFullYear()}-`;
  const all = await pharmaDb.controlledDrugCounts.toArray();
  let max = 0;
  for (const c of all) {
    if (!c.countNumber.startsWith(prefix)) continue;
    const n = Number(c.countNumber.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

export async function nextRequisitionNumber(): Promise<string> {
  const prefix = `RQ-${new Date().getFullYear()}-`;
  const all = await pharmaDb.controlRequisitions.toArray();
  let max = 0;
  for (const r of all) {
    if (!r.requisitionNumber.startsWith(prefix)) continue;
    const n = Number(r.requisitionNumber.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

/** Running register balance for a batch from its full movement history. */
export async function registerBalance(batchId: string): Promise<number> {
  const entries = await pharmaDb.controlledDrugRegister
    .where("batchId")
    .equals(batchId)
    .sortBy("recordedAt");
  return entries.length > 0 ? entries[entries.length - 1].balanceAfter : 0;
}

export interface RegisterMovementInput {
  medicineId: string;
  batchId: string;
  transactionType: RegisterTransactionType;
  quantity: number;
  patientId?: string;
  prescriptionId?: string;
  prescriberName?: string;
  pharmacistId: string;
  pharmacistName: string;
  secondAuthorizerId?: string;
  secondAuthorizerName?: string;
  reason: string;
}

/**
 * Writes a single Controlled Drug Register movement against a batch's running
 * balance. No register entry can take a batch negative. Disposal and balance
 * adjustments always require a second authorized approver.
 */
export async function registerMovement(
  input: RegisterMovementInput,
): Promise<ControlledDrugRegisterEntry> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Register quantity must be greater than 0.");
  }
  if (!input.reason?.trim()) {
    throw new Error("A reason is required for every register movement.");
  }
  if (!input.pharmacistId) {
    throw new Error("An authorized pharmacist must record the movement.");
  }
  if (
    requiresDualAuth(input.transactionType) &&
    (!input.secondAuthorizerId || !input.secondAuthorizerName)
  ) {
    throw new Error(
      `${input.transactionType} requires a second authorized approver (dual authorization).`,
    );
  }
  if (input.secondAuthorizerId === input.pharmacistId) {
    throw new Error(
      "The second approver must be a different authorized user.",
    );
  }

  const medicine = await pharmaDb.medicines.get(input.medicineId);
  if (!medicine) throw new Error("Medicine not found.");
  if (!isControlled(medicine)) {
    throw new Error(
      `${medicine.name} is not classified as a controlled medicine.`,
    );
  }
  const batch = await pharmaDb.medicineBatches.get(input.batchId);
  if (!batch) throw new Error("Batch not found.");

  const previousEntries = await pharmaDb.controlledDrugRegister
    .where("batchId")
    .equals(input.batchId)
    .sortBy("recordedAt");
  const openingBalance =
    previousEntries.length > 0
      ? previousEntries[previousEntries.length - 1].balanceAfter
      : 0;
  const delta = qtySign(input.transactionType) * input.quantity;
  const balanceAfter = round2(openingBalance + delta);
  if (balanceAfter < 0) {
    throw new Error(
      `Insufficient controlled balance for batch ${batch.batchNumber}: balance is ${openingBalance}.`,
    );
  }

  const timestamp = now();
  const entry: ControlledDrugRegisterEntry = {
    id: uid(),
    entryNumber: await nextRegisterEntryNumber(),
    medicineId: input.medicineId,
    batchId: input.batchId,
    transactionType: input.transactionType,
    openingBalance,
    quantity: input.quantity,
    balanceAfter,
    patientId: input.patientId,
    prescriptionId: input.prescriptionId,
    prescriberName: input.prescriberName,
    pharmacistId: input.pharmacistId,
    pharmacistName: input.pharmacistName,
    secondAuthorizerId: input.secondAuthorizerId,
    secondAuthorizerName: input.secondAuthorizerName,
    reason: input.reason.trim(),
    recordedAt: timestamp,
  };

  await pharmaDb.transaction(
    "rw",
    [pharmaDb.controlledDrugRegister, pharmaDb.auditLogs],
    async () => {
      await pharmaDb.controlledDrugRegister.add(entry);
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: input.pharmacistId,
        action: "REGISTER_MOVEMENT",
        entityType: "controlledDrugRegister",
        entityId: entry.id,
        newValues: {
          entryNumber: entry.entryNumber,
          batchId: input.batchId,
          transactionType: input.transactionType,
          quantity: input.quantity,
          balanceAfter,
          reason: entry.reason,
          secondAuthorizerId: input.secondAuthorizerId,
        },
        createdAt: timestamp,
      });
    },
  );

  return entry;
}

export interface DisposeInput {
  medicineId: string;
  batchId: string;
  quantity: number;
  reason: string;
  witnessedBy?: string;
  pharmacistId: string;
  pharmacistName: string;
  secondAuthorizerId: string;
  secondAuthorizerName: string;
}

export async function disposeControlled(
  input: DisposeInput,
): Promise<ControlledDrugRegisterEntry> {
  return registerMovement({
    medicineId: input.medicineId,
    batchId: input.batchId,
    transactionType: "DESTROYED",
    quantity: input.quantity,
    pharmacistId: input.pharmacistId,
    pharmacistName: input.pharmacistName,
    secondAuthorizerId: input.secondAuthorizerId,
    secondAuthorizerName: input.secondAuthorizerName,
    reason: input.witnessedBy
      ? `${input.reason} (witnessed by ${input.witnessedBy})`
      : input.reason,
  });
}

export interface AdjustInput {
  medicineId: string;
  batchId: string;
  delta: number;
  reason: string;
  pharmacistId: string;
  pharmacistName: string;
  secondAuthorizerId: string;
  secondAuthorizerName: string;
}

/** Balance adjustment (e.g. found during reconciliation). Never a raw stock edit. */
export async function adjustControlled(
  input: AdjustInput,
): Promise<ControlledDrugRegisterEntry> {
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new Error("Adjustment delta cannot be zero.");
  }
  const abs = Math.abs(input.delta);
  const sign = input.delta > 0 ? 1 : -1;
  return registerMovement({
    medicineId: input.medicineId,
    batchId: input.batchId,
    transactionType: "ADJUSTMENT",
    quantity: abs,
    pharmacistId: input.pharmacistId,
    pharmacistName: input.pharmacistName,
    secondAuthorizerId: input.secondAuthorizerId,
    secondAuthorizerName: input.secondAuthorizerName,
    reason: `${input.reason} (delta ${sign > 0 ? "+" : "-"}${abs})`,
  });
}

export interface ReconcileInput {
  medicineId: string;
  batchId: string;
  countedBalance: number;
  countedBy: string;
  countedByName: string;
  notes?: string;
}

export async function reconcileControlled(
  input: ReconcileInput,
): Promise<ControlledDrugCount> {
  if (!Number.isFinite(input.countedBalance) || input.countedBalance < 0) {
    throw new Error("Counted balance must be 0 or more.");
  }
  const registerBalanceNow = await registerBalance(input.batchId);
  const variance = round2(registerBalanceNow - input.countedBalance);
  const timestamp = now();
  const count: ControlledDrugCount = {
    id: uid(),
    countNumber: await nextCountNumber(),
    medicineId: input.medicineId,
    batchId: input.batchId,
    countedBalance: input.countedBalance,
    registerBalance: registerBalanceNow,
    variance,
    status: variance === 0 ? "MATCH" : "VARIANCE",
    countedBy: input.countedBy,
    countedByName: input.countedByName,
    notes: input.notes?.trim() || undefined,
    countedAt: timestamp,
  };

  await pharmaDb.transaction(
    "rw",
    [pharmaDb.controlledDrugCounts, pharmaDb.auditLogs],
    async () => {
      await pharmaDb.controlledDrugCounts.add(count);
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: input.countedBy,
        action: variance === 0 ? "RECONCILE" : "RECONCILE_VARIANCE",
        entityType: "controlledDrugCount",
        entityId: count.id,
        newValues: {
          countNumber: count.countNumber,
          batchId: input.batchId,
          registerBalance: registerBalanceNow,
          countedBalance: input.countedBalance,
          variance,
        },
        createdAt: timestamp,
      });
    },
  );

  return count;
}

export interface RequisitionInput {
  type: ControlRequisition["type"];
  medicineId: string;
  batchId: string;
  quantity: number;
  fromLocation?: string;
  toLocation?: string;
  pharmacistId: string;
  pharmacistName: string;
}

export async function createControlRequisition(
  input: RequisitionInput,
): Promise<ControlRequisition> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Requisition quantity must be greater than 0.");
  }
  const timestamp = now();
  const requisition: ControlRequisition = {
    id: uid(),
    requisitionNumber: await nextRequisitionNumber(),
    type: input.type,
    medicineId: input.medicineId,
    batchId: input.batchId,
    quantity: input.quantity,
    fromLocation: input.fromLocation,
    toLocation: input.toLocation,
    pharmacistId: input.pharmacistId,
    pharmacistName: input.pharmacistName,
    status: "PENDING",
    createdAt: timestamp,
  };
  await pharmaDb.controlRequisitions.add(requisition);
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.pharmacistId,
    action: "CREATE",
    entityType: "controlRequisition",
    entityId: requisition.id,
    newValues: {
      requisitionNumber: requisition.requisitionNumber,
      type: requisition.type,
      batchId: input.batchId,
      quantity: input.quantity,
    },
    createdAt: timestamp,
  });
  return requisition;
}

/**
 * Completes a pending internal requisition by registering its movement leg on
 * the controlled register: ISSUE decrements the store batch, RECEIVE increments it.
 */
export async function completeControlRequisition(
  requisitionId: string,
  pharmacistId: string,
  pharmacistName: string,
): Promise<ControlRequisition> {
  const req = await pharmaDb.controlRequisitions.get(requisitionId);
  if (!req) throw new Error("Requisition not found.");
  if (req.status !== "PENDING") {
    throw new Error("Only pending requisitions can be completed.");
  }
  await registerMovement({
    medicineId: req.medicineId,
    batchId: req.batchId,
    transactionType: req.type === "ISSUE" ? "REQUISITION_ISSUE" : "REQUISITION_RECEIVE",
    quantity: req.quantity,
    pharmacistId,
    pharmacistName,
    reason: `Internal ${req.type.toLowerCase()} ${req.requisitionNumber}`,
  });
  const timestamp = now();
  await pharmaDb.controlRequisitions.update(requisitionId, {
    status: "COMPLETED",
    completedAt: timestamp,
  });
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: pharmacistId,
    action: "COMPLETE",
    entityType: "controlRequisition",
    entityId: req.id,
    oldValues: { status: "PENDING" },
    newValues: { status: "COMPLETED" },
    createdAt: timestamp,
  });
  return { ...req, status: "COMPLETED", completedAt: timestamp };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
