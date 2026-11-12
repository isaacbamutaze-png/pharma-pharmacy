import Dexie, { type EntityTable } from "dexie";
import { uid, now } from "../lib/utils";
import type {
  AssistantMessage,
  AuditLog,
  StockTake,
  StockTakeItem,
  Shift,
  CashDrawerMovement,
  ControlRequisition,
  ControlledDrugCount,
  ControlledDrugRegisterEntry,
  Customer,
  CustomerPayment,
  DispensingRecord,
  DrugInteraction,
  Expense,
  Grn,
  GrnItem,
  HeldSale,
  Medicine,
  MedicineBarcode,
  MedicineBatch,
  MedicineCategory,
  MedicineUnit,
  MedicineWarning,
  Patient,
  PatientAllergy,
  PatientMedicalHistory,
  Payment,
  PaymentConfirmation,
  PaymentGateway,
  PaymentProviderEvent,
  PaymentTransaction,
  Prescription,
  PrescriptionItem,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseRequest,
  PurchaseRequestItem,
  PurchaseReturn,
  PurchaseReturnItem,
  Refund,
  RefundItem,
  RoleRecord,
  SafetyAlertCheck,
  Sale,
  SaleItem,
  StockMovement,
  Supplier,
  SupplierInvoice,
  SupplierPayment,
  SupplierPerformance,
  SupplierPriceHistory,
  SupplierProduct,
  SystemSetting,
  UserRecord,
} from "../types";

export const pharmaDb = new Dexie("pharma") as Dexie & {
  roles: EntityTable<RoleRecord, "id">;
  users: EntityTable<UserRecord, "id">;
  medicineCategories: EntityTable<MedicineCategory, "id">;
  medicines: EntityTable<Medicine, "id">;
  medicineBarcodes: EntityTable<MedicineBarcode, "id">;
  medicineUnits: EntityTable<MedicineUnit, "id">;
  suppliers: EntityTable<Supplier, "id">;
  medicineBatches: EntityTable<MedicineBatch, "id">;
  stockMovements: EntityTable<StockMovement, "id">;
  customers: EntityTable<Customer, "id">;
  sales: EntityTable<Sale, "id">;
  saleItems: EntityTable<SaleItem, "id">;
  customerPayments: EntityTable<CustomerPayment, "id">;
  expenses: EntityTable<Expense, "id">;
  systemSettings: EntityTable<SystemSetting, "id">;
  auditLogs: EntityTable<AuditLog, "id">;
  shifts: EntityTable<Shift, "id">;
  cashDrawerMovements: EntityTable<CashDrawerMovement, "id">;
  stockTakes: EntityTable<StockTake, "id">;
  stockTakeItems: EntityTable<StockTakeItem, "id">;
  payments: EntityTable<Payment, "id">;
  paymentTransactions: EntityTable<PaymentTransaction, "id">;
  paymentProviderEvents: EntityTable<PaymentProviderEvent, "id">;
  paymentConfirmations: EntityTable<PaymentConfirmation, "id">;
  paymentGateways: EntityTable<PaymentGateway, "id">;
  heldSales: EntityTable<HeldSale, "id">;
  refunds: EntityTable<Refund, "id">;
  refundItems: EntityTable<RefundItem, "id">;
  purchaseRequests: EntityTable<PurchaseRequest, "id">;
  purchaseRequestItems: EntityTable<PurchaseRequestItem, "id">;
  purchaseOrders: EntityTable<PurchaseOrder, "id">;
  purchaseOrderItems: EntityTable<PurchaseOrderItem, "id">;
  grns: EntityTable<Grn, "id">;
  grnItems: EntityTable<GrnItem, "id">;
  supplierInvoices: EntityTable<SupplierInvoice, "id">;
  supplierPayments: EntityTable<SupplierPayment, "id">;
  purchaseReturns: EntityTable<PurchaseReturn, "id">;
  purchaseReturnItems: EntityTable<PurchaseReturnItem, "id">;
  supplierProducts: EntityTable<SupplierProduct, "id">;
  supplierPriceHistory: EntityTable<SupplierPriceHistory, "id">;
  supplierPerformance: EntityTable<SupplierPerformance, "id">;
  patients: EntityTable<Patient, "id">;
  patientAllergies: EntityTable<PatientAllergy, "id">;
  patientMedicalHistory: EntityTable<PatientMedicalHistory, "id">;
  prescriptions: EntityTable<Prescription, "id">;
  prescriptionItems: EntityTable<PrescriptionItem, "id">;
  dispensingRecords: EntityTable<DispensingRecord, "id">;
  controlledDrugRegister: EntityTable<ControlledDrugRegisterEntry, "id">;
  controlRequisitions: EntityTable<ControlRequisition, "id">;
  controlledDrugCounts: EntityTable<ControlledDrugCount, "id">;
  drugInteractions: EntityTable<DrugInteraction, "id">;
  medicineWarnings: EntityTable<MedicineWarning, "id">;
  safetyAlertChecks: EntityTable<SafetyAlertCheck, "id">;
  assistantMessages: EntityTable<AssistantMessage, "id">;
};

pharmaDb.version(1).stores({
  roles: "id, name",
  users: "id, roleId, username, status",
  medicineCategories: "id, name",
  medicines: "id, name, categoryId, status",
  medicineBarcodes: "id, medicineId, barcode",
  systemSettings: "id, settingKey",
  auditLogs: "id, userId, entityType, entityId, createdAt",
});

pharmaDb.version(2).stores({
  suppliers: "id, name, status",
  medicineBatches: "id, medicineId, supplierId, batchNumber, expiryDate, status",
  stockMovements: "id, medicineId, batchId, movementType, createdAt",
});

pharmaDb.version(3).stores({
  customers: "id, name, phone",
  sales: "id, invoiceNumber, saleDate, saleDateKey, customerId, paymentMethod, status, cashierId",
  saleItems: "id, saleId, medicineId, batchId",
});

pharmaDb.version(4).stores({
  customerPayments: "id, customerId, paymentMethod, createdAt, saleId",
  expenses: "id, expenseDate, expenseDateKey, category, recordedBy",
});

pharmaDb.version(5).stores({
  sales: "id, invoiceNumber, saleDate, saleDateKey, customerId, paymentMethod, status, cashierId, createdAt",
});

pharmaDb.version(6).stores({
  medicineBarcodes: "id, medicineId, barcode, unitId",
  medicineUnits: "id, medicineId, isDefault, isBase, canSell, canPurchase",
  payments: "id, saleId, method, status, createdAt",
  paymentTransactions:
    "id, paymentId, saleId, method, provider, status, createdAt",
  paymentProviderEvents:
    "id, transactionId, saleId, provider, eventType, status, receivedAt",
  paymentGateways: "id, provider, enabled, environment",
}).upgrade(async (tx) => {
  const medicines = await tx.table("medicines").toArray();
  const sales = await tx.table("sales").toArray();
  const barcodes = await tx.table("medicineBarcodes").toArray();
  const settings = await tx.table("systemSettings").toArray();

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  for (const med of medicines) {
    const unitName = med.baseUnit || med.unit;
    const unitCode = unitName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "UNIT";
    const unitId = uid();
    await tx.table("medicineUnits").add({
      id: unitId,
      medicineId: med.id,
      unitName,
      unitCode,
      conversionToBase: 1,
      sellingPrice: med.sellingPrice,
      costPrice: undefined,
      barcode: undefined,
      canSell: true,
      canPurchase: true,
      isDefault: true,
      isBase: true,
      sortOrder: 0,
      createdAt: now(),
      updatedAt: now(),
    });
    const medBarcodes = barcodes.filter((b) => b.medicineId === med.id);
    for (const b of medBarcodes) {
      await tx
        .table("medicineBarcodes")
        .update(b.id, { unitId, unitName: unitName as string });
    }
  }

  for (const sale of sales) {
    if (sale.status !== "COMPLETED") continue;
    await tx.table("payments").add({
      id: uid(),
      saleId: sale.id,
      method: sale.paymentMethod,
      provider: undefined,
      providerReference: undefined,
      amount: sale.amountPaid,
      currency,
      status: "SUCCESS",
      initiatedAt: sale.saleDate,
      completedAt: sale.saleDate,
      failureReason: undefined,
      note: "Backfilled from existing sale",
      recordedBy: sale.cashierId,
      createdAt: now(),
    });
  }
});

pharmaDb.version(7).stores({
  heldSales: "id, createdBy, createdAt",
});

pharmaDb.version(8).stores({
  refunds: "id, saleId, invoiceNumber, saleDateKey, createdAt",
  refundItems: "id, refundId, saleId, saleItemId",
});

pharmaDb.version(9).stores({
  purchaseRequests: "id, number, status, createdAt",
  purchaseRequestItems: "id, purchaseRequestId, medicineId",
  purchaseOrders: "id, number, supplierId, status, createdAt",
  purchaseOrderItems: "id, purchaseOrderId, medicineId",
  grns: "id, number, poId, supplierId, createdAt",
  grnItems: "id, grnId, poItemId, medicineId",
  supplierInvoices: "id, number, supplierId, status, createdAt",
  supplierPayments: "id, number, supplierId, invoiceId, createdAt",
  purchaseReturns: "id, number, supplierId, status, createdAt",
  purchaseReturnItems: "id, purchaseReturnId, medicineId",
  supplierProducts: "id, supplierId, medicineId",
  supplierPriceHistory: "id, supplierId, medicineId, createdAt",
  supplierPerformance: "id, supplierId",
});

pharmaDb.version(10).stores({
  paymentConfirmations:
    "id, paymentId, transactionId, saleId, provider, providerStatus, verified, createdAt",
});

pharmaDb.version(11).stores({
  patients: "id, patientNumber, firstName, lastName, phone, nationalId, status, createdAt",
  patientAllergies: "id, patientId, createdAt",
  patientMedicalHistory: "id, patientId, createdAt",
  prescriptions: "id, prescriptionNumber, patientId, status, prescribedDate, createdAt",
  prescriptionItems: "id, prescriptionId, medicineId",
  dispensingRecords:
    "id, prescriptionId, prescriptionItemId, saleId, medicineId, dispensedAt",
});

pharmaDb.version(12).stores({
  medicines: "id, name, categoryId, status",
  controlledDrugRegister:
    "id, entryNumber, medicineId, batchId, transactionType, patientId, prescriptionId, pharmacistId, recordedAt",
  controlRequisitions: "id, requisitionNumber, type, medicineId, batchId, pharmacistId, status, createdAt",
  controlledDrugCounts:
    "id, countNumber, medicineId, batchId, status, countedBy, countedAt",
  drugInteractions: "id, medicineAId, medicineBId, severity, createdAt",
  medicineWarnings: "id, medicineId, warningType, createdAt",
  safetyAlertChecks:
    "id, patientId, prescriptionId, checkType, outcome, checkedAt",
}).upgrade(async (tx) => {
  const medicines = await tx.table("medicines").toArray();
  for (const med of medicines) {
    if (!med.controlCategory) {
      await tx
        .table("medicines")
        .update(med.id, { controlCategory: "GENERAL" });
    }
  }
});

pharmaDb.version(13).stores({
  assistantMessages: "id, role, intent, createdAt",
});

// Additive: stock taking with variance approval.
pharmaDb.version(14).stores({
  stockTakes: "id, status, createdAt",
  stockTakeItems: "id, stockTakeId, batchId",
});

// Additive: cashier shifts and cash drawer.
pharmaDb.version(15).stores({
  shifts: "id, cashierId, status, openedAt",
  cashDrawerMovements: "id, shiftId, createdAt",
});

const TRANSACTIONAL_TABLES = [
  "sales",
  "saleItems",
  "customerPayments",
  "expenses",
  "payments",
  "paymentTransactions",
  "paymentProviderEvents",
  "paymentConfirmations",
  "heldSales",
  "refunds",
  "refundItems",
  "purchaseRequests",
  "purchaseRequestItems",
  "purchaseOrders",
  "purchaseOrderItems",
  "grns",
  "grnItems",
  "supplierInvoices",
  "supplierPayments",
  "purchaseReturns",
  "purchaseReturnItems",
  "stockMovements",
  "auditLogs",
  "stockTakes",
  "stockTakeItems",
  "shifts",
  "cashDrawerMovements",
  "safetyAlertChecks",
  "controlledDrugRegister",
  "controlRequisitions",
  "controlledDrugCounts",
  "dispensingRecords",
  "prescriptions",
  "prescriptionItems",
  "patients",
  "patientAllergies",
  "patientMedicalHistory",
  "assistantMessages",
  "medicines",
  "medicineBatches",
  "medicineBarcodes",
  "medicineUnits",
  "suppliers",
  "customers",
  "drugInteractions",
  "medicineWarnings",
  "supplierProducts",
  "supplierPriceHistory",
  "supplierPerformance",
];

export async function clearAllData(): Promise<void> {
  await pharmaDb.transaction(
    "rw",
    TRANSACTIONAL_TABLES.map((t) => pharmaDb.table(t)),
    async () => {
      for (const table of TRANSACTIONAL_TABLES) {
        await pharmaDb.table(table).clear();
      }
    },
  );
  await pharmaDb.systemSettings.where("settingKey").equals("demo_seeded").delete();
  await pharmaDb.systemSettings.where("settingKey").equals("setup_complete").delete();
}

const DEMO_ONLY_TABLES = [
  "sales",
  "saleItems",
  "customerPayments",
  "expenses",
  "payments",
  "paymentTransactions",
  "paymentProviderEvents",
  "paymentConfirmations",
  "heldSales",
  "refunds",
  "refundItems",
  "stockMovements",
  "dispensingRecords",
  "prescriptions",
  "prescriptionItems",
  "patients",
  "patientAllergies",
  "patientMedicalHistory",
  "assistantMessages",
  "drugInteractions",
  "medicineWarnings",
  "safetyAlertChecks",
  "controlledDrugRegister",
  "controlRequisitions",
  "controlledDrugCounts",
];

export async function clearDemoData(): Promise<void> {
  await pharmaDb.transaction(
    "rw",
    DEMO_ONLY_TABLES.map((t) => pharmaDb.table(t)),
    async () => {
      for (const table of DEMO_ONLY_TABLES) {
        await pharmaDb.table(table).clear();
      }
    },
  );
  await pharmaDb.systemSettings.where("settingKey").equals("demo_seeded").delete();
}
