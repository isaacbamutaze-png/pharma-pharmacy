import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import { receiveStock, adjustBatch, todayISO } from "./stock";
import { round2 } from "./sales";
import type {
  Grn,
  GrnItem,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestItem,
  PurchaseRequestStatus,
  PurchaseReturn,
  PurchaseReturnItem,
  SupplierInvoice,
  SupplierInvoiceStatus,
  SupplierPayment,
  SupplierPerformance,
  SupplierPriceHistory,
  SupplierProduct,
} from "../types";

function ymd(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export async function nextDocRef(prefix: string, count: number): Promise<string> {
  return `${prefix}-${ymd()}-${String(count + 1).padStart(6, "0")}`;
}

export function grnTotal(items: GrnItem[]): number {
  return round2(items.reduce((sum, i) => sum + i.lineTotal, 0));
}

export function poTotal(items: PurchaseOrderItem[]): number {
  return round2(items.reduce((sum, i) => sum + i.lineTotal, 0));
}

export interface SupplierFinanceSummary {
  invoiced: number;
  paid: number;
  credited: number;
  balance: number;
}

export function supplierFinance(
  invoices: SupplierInvoice[],
  payments: SupplierPayment[],
  returns: PurchaseReturn[],
): SupplierFinanceSummary {
  const invoiced = round2(
    invoices
      .filter((i) => i.status !== "CANCELLED")
      .reduce((sum, i) => sum + i.total, 0),
  );
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  const credited = round2(
    returns
      .filter((r) => r.status === "COMPLETED")
      .reduce((sum, r) => sum + r.total, 0),
  );
  return {
    invoiced,
    paid,
    credited,
    balance: round2(invoiced - paid - credited),
  };
}

function purchaseRequestStatusAudit(
  id: string,
  oldStatus: PurchaseRequestStatus,
  newStatus: PurchaseRequestStatus,
  actorId?: string,
): Promise<string> {
  return pharmaDb.auditLogs.add({
    id: uid(),
    userId: actorId ?? "system",
    action: "UPDATE",
    entityType: "purchase_request",
    entityId: id,
    oldValues: { status: oldStatus },
    newValues: { status: newStatus },
    createdAt: now(),
  });
}

// ---------------------------------------------------------------------------
// Purchase Requests
// ---------------------------------------------------------------------------

export interface PurchaseRequestLineInput {
  medicineId: string;
  requestedQty: number;
  unitId?: string;
  unitName?: string;
  unitConversion?: number;
  note?: string;
}

export async function createPurchaseRequest(input: {
  lines: PurchaseRequestLineInput[];
  note?: string;
  requestedBy?: string;
  requestedByName?: string;
}): Promise<PurchaseRequest> {
  if (input.lines.length === 0) throw new Error("Add at least one medicine.");
  for (const l of input.lines) {
    if (!Number.isFinite(l.requestedQty) || l.requestedQty <= 0) {
      throw new Error("Quantity must be greater than 0.");
    }
  }
  const timestamp = now();
  const prId = uid();
  const number = await nextDocRef(
    "PR",
    await pharmaDb.purchaseRequests.count(),
  );

  const names = new Map<string, string>();
  for (const l of input.lines) {
    const m = await pharmaDb.medicines.get(l.medicineId);
    names.set(l.medicineId, m?.name ?? "Unknown medicine");
  }

  const pr: PurchaseRequest = {
    id: prId,
    number,
    status: "PENDING",
    note: input.note?.trim() || undefined,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const items: PurchaseRequestItem[] = input.lines.map((l) => ({
    id: uid(),
    purchaseRequestId: prId,
    medicineId: l.medicineId,
    medicineName: names.get(l.medicineId) ?? "Unknown medicine",
    requestedQty: l.requestedQty,
    unitName: l.unitName,
    unitConversion: l.unitConversion,
    note: l.note?.trim() || undefined,
    createdAt: timestamp,
  }));

  await pharmaDb.transaction(
    "rw",
    [pharmaDb.purchaseRequests, pharmaDb.purchaseRequestItems],
    async () => {
      await pharmaDb.purchaseRequests.add(pr);
      await pharmaDb.purchaseRequestItems.bulkAdd(items);
    },
  );
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.requestedBy ?? "system",
    action: "CREATE",
    entityType: "purchase_request",
    entityId: prId,
    newValues: { number, status: pr.status, lines: input.lines.length },
    createdAt: timestamp,
  });
  return pr;
}

export async function setPurchaseRequestStatus(
  id: string,
  status: PurchaseRequestStatus,
  actorId?: string,
): Promise<void> {
  const pr = await pharmaDb.purchaseRequests.get(id);
  if (!pr) throw new Error("Purchase request not found.");
  const old = pr.status;
  await pharmaDb.purchaseRequests.update(id, {
    status,
    updatedAt: now(),
  });
  await purchaseRequestStatusAudit(id, old, status, actorId);
}

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------

export interface PurchaseOrderLineInput {
  medicineId: string;
  unitId?: string;
  unitName?: string;
  unitConversion?: number;
  qtyOrdered: number;
  unitCost: number;
}

export async function createPurchaseOrder(input: {
  supplierId: string;
  lines: PurchaseOrderLineInput[];
  purchaseRequestId?: string;
  expectedDate?: string;
  terms?: string;
  note?: string;
  createdBy?: string;
  createdByName?: string;
}): Promise<PurchaseOrder> {
  const supplier = await pharmaDb.suppliers.get(input.supplierId);
  if (!supplier) throw new Error("Select a supplier.");
  if (input.lines.length === 0) throw new Error("Add at least one medicine.");
  for (const l of input.lines) {
    if (!Number.isFinite(l.qtyOrdered) || l.qtyOrdered <= 0) {
      throw new Error("Quantity must be greater than 0.");
    }
    if (!Number.isFinite(l.unitCost) || l.unitCost < 0) {
      throw new Error("Unit cost must be 0 or greater.");
    }
  }

  const timestamp = now();
  const poId = uid();
  const number = await nextDocRef(
    "PO",
    await pharmaDb.purchaseOrders.count(),
  );

  const names = new Map<string, string>();
  for (const l of input.lines) {
    const m = await pharmaDb.medicines.get(l.medicineId);
    names.set(l.medicineId, m?.name ?? "Unknown medicine");
  }

  const po: PurchaseOrder = {
    id: poId,
    number,
    supplierId: supplier.id,
    supplierName: supplier.name,
    status: "DRAFT",
    purchaseRequestId: input.purchaseRequestId,
    expectedDate: input.expectedDate,
    terms: input.terms?.trim() || undefined,
    note: input.note?.trim() || undefined,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const items: PurchaseOrderItem[] = input.lines.map((l) => ({
    id: uid(),
    purchaseOrderId: poId,
    medicineId: l.medicineId,
    medicineName: names.get(l.medicineId) ?? "Unknown medicine",
    unitId: l.unitId,
    unitName: l.unitName,
    unitConversion: l.unitConversion,
    qtyOrdered: l.qtyOrdered,
    qtyReceived: 0,
    unitCost: round2(l.unitCost),
    lineTotal: round2(l.qtyOrdered * l.unitCost),
  }));

  await pharmaDb.transaction(
    "rw",
    [
      pharmaDb.purchaseOrders,
      pharmaDb.purchaseOrderItems,
      pharmaDb.purchaseRequests,
    ],
    async () => {
      await pharmaDb.purchaseOrders.add(po);
      await pharmaDb.purchaseOrderItems.bulkAdd(items);
      if (input.purchaseRequestId) {
        const pr = await pharmaDb.purchaseRequests.get(input.purchaseRequestId);
        if (pr && pr.status !== "CANCELLED" && pr.status !== "REJECTED") {
          await pharmaDb.purchaseRequests.update(pr.id, {
            status: "ORDERED",
            updatedAt: timestamp,
          });
        }
      }
    },
  );
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.createdBy ?? "system",
    action: "CREATE",
    entityType: "purchase_order",
    entityId: poId,
    newValues: {
      number,
      supplierId: supplier.id,
      total: poTotal(items),
      lines: input.lines.length,
    },
    createdAt: timestamp,
  });
  return po;
}

export async function setPurchaseOrderStatus(
  id: string,
  status: PurchaseOrderStatus,
  actorId?: string,
): Promise<void> {
  const po = await pharmaDb.purchaseOrders.get(id);
  if (!po) throw new Error("Purchase order not found.");
  const old = po.status;
  await pharmaDb.purchaseOrders.update(id, {
    status,
    updatedAt: now(),
  });
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: actorId ?? "system",
    action: "UPDATE",
    entityType: "purchase_order",
    entityId: id,
    oldValues: { status: old },
    newValues: { status },
    createdAt: now(),
  });
}

// ---------------------------------------------------------------------------
// Goods Received (GRN) — the only way stock enters inventory
// ---------------------------------------------------------------------------

export interface GrnLineInput {
  poItemId: string;
  medicineId: string;
  batchNumber: string;
  expiryDate: string;
  qtyReceived: number;
  sellingPrice?: number;
  unitId?: string;
  unitName?: string;
  unitConversion?: number;
  unitCost?: number;
}

export async function receiveGoods(input: {
  poId: string;
  receivedBy?: string;
  receivedByName?: string;
  note?: string;
  lines: GrnLineInput[];
}): Promise<Grn> {
  const po = await pharmaDb.purchaseOrders.get(input.poId);
  if (!po) throw new Error("Purchase order not found.");
  if (po.status === "CANCELLED") throw new Error("Purchase order is cancelled.");
  if (po.status === "RECEIVED") throw new Error("Purchase order already fully received.");
  if (input.lines.length === 0) throw new Error("Enter at least one received line.");
  const supplier = await pharmaDb.suppliers.get(po.supplierId);
  if (!supplier) throw new Error("Supplier not found.");
  const today = todayISO();
  for (const l of input.lines) {
    if (!l.batchNumber.trim()) throw new Error("Batch number is required for every received line.");
    if (!l.expiryDate) throw new Error("Expiry date is required for every received line.");
    if (l.expiryDate < today) throw new Error("Expiry date cannot be in the past.");
    if (!Number.isFinite(l.qtyReceived) || l.qtyReceived <= 0) {
      throw new Error("Received quantity must be greater than 0.");
    }
  }

  const poItems = await pharmaDb.purchaseOrderItems
    .where("purchaseOrderId")
    .equals(po.id)
    .toArray();
  const poItemMap = new Map(poItems.map((i) => [i.id, i]));

  const timestamp = now();
  const grnId = uid();
  const number = await nextDocRef("GRN", await pharmaDb.grns.count());

  const medicineMap = new Map<string, string>();
  const defaultPrice = async (medicineId: string): Promise<number> => {
    const units = await pharmaDb.medicineUnits
      .where("medicineId")
      .equals(medicineId)
      .toArray();
    const def =
      units.find((u) => u.isDefault) ??
      units.find((u) => u.isBase) ??
      units[0];
    if (def) return def.sellingPrice;
    const m = await pharmaDb.medicines.get(medicineId);
    return m?.sellingPrice ?? 0;
  };

  const grnItems: GrnItem[] = [];

  await pharmaDb.transaction(
    "rw",
    [
      pharmaDb.purchaseOrders,
      pharmaDb.purchaseOrderItems,
      pharmaDb.medicineBatches,
      pharmaDb.stockMovements,
      pharmaDb.grns,
      pharmaDb.grnItems,
      pharmaDb.supplierProducts,
      pharmaDb.supplierPriceHistory,
      pharmaDb.supplierPerformance,
    ],
    async () => {
      for (const line of input.lines) {
        const poItem = poItemMap.get(line.poItemId);
        if (!poItem) throw new Error("Purchase order line not found.");
        const remaining = poItem.qtyOrdered - poItem.qtyReceived;
        if (line.qtyReceived > remaining) {
          throw new Error(
            `Receiving ${line.qtyReceived} exceeds the remaining ${remaining} for ${poItem.medicineName}.`,
          );
        }
        const cost = line.unitCost ?? poItem.unitCost;
        const sell = line.sellingPrice ?? (await defaultPrice(poItem.medicineId));
        const batch = await receiveStock({
          medicineId: poItem.medicineId,
          supplierId: po.supplierId,
          batchNumber: line.batchNumber.trim(),
          expiryDate: line.expiryDate,
          quantity: line.qtyReceived,
          purchasePrice: cost,
          sellingPrice: sell,
          performedBy: input.receivedBy ?? "system",
          unitId: line.unitId ?? poItem.unitId,
          unitName: line.unitName ?? poItem.unitName,
          unitConversion: line.unitConversion ?? poItem.unitConversion,
        });
        medicineMap.set(poItem.medicineId, poItem.medicineName);
        grnItems.push({
          id: uid(),
          grnId,
          poItemId: poItem.id,
          medicineId: poItem.medicineId,
          medicineName: poItem.medicineName,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          expiryDate: line.expiryDate,
          qtyReceived: line.qtyReceived,
          unitName: line.unitName ?? poItem.unitName,
          unitConversion: line.unitConversion ?? poItem.unitConversion,
          unitCost: round2(cost),
          sellingPrice: round2(sell),
          lineTotal: round2(line.qtyReceived * cost),
        });
        await pharmaDb.purchaseOrderItems.update(poItem.id, {
          qtyReceived: round2(poItem.qtyReceived + line.qtyReceived),
        });
        await upsertSupplierProduct(
          po.supplierId,
          poItem.medicineId,
          cost,
          timestamp,
        );
        await pharmaDb.supplierPriceHistory.add({
          id: uid(),
          supplierId: po.supplierId,
          medicineId: poItem.medicineId,
          unitId: line.unitId ?? poItem.unitId,
          unitName: line.unitName ?? poItem.unitName,
          price: round2(cost),
          effectiveFrom: timestamp,
          recordedBy: input.receivedBy,
          createdAt: timestamp,
        });
      }

      const newItems = await pharmaDb.purchaseOrderItems
        .where("purchaseOrderId")
        .equals(po.id)
        .toArray();
      const nextStatus = receivedStatus(newItems);
      await pharmaDb.purchaseOrders.update(po.id, {
        status: nextStatus,
        updatedAt: timestamp,
      });

      await pharmaDb.grns.add({
        id: grnId,
        number,
        poId: po.id,
        poNumber: po.number,
        supplierId: po.supplierId,
        supplierName: po.supplierName,
        receivedAt: timestamp,
        receivedBy: input.receivedBy,
        receivedByName: input.receivedByName,
        note: input.note?.trim() || undefined,
        createdAt: timestamp,
      });
      await pharmaDb.grnItems.bulkAdd(grnItems);

      await touchSupplierPerformance(po, timestamp);
    },
  );

  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.receivedBy ?? "system",
    action: "RECEIVE_GOODS",
    entityType: "grn",
    entityId: grnId,
    newValues: {
      number,
      poNumber: po.number,
      supplierId: po.supplierId,
      total: grnTotal(grnItems),
    },
    createdAt: timestamp,
  });
  return {
    id: grnId,
    number,
    poId: po.id,
    poNumber: po.number,
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    receivedAt: timestamp,
    receivedBy: input.receivedBy,
    receivedByName: input.receivedByName,
    note: input.note?.trim() || undefined,
    createdAt: timestamp,
  };
}

function receivedStatus(items: PurchaseOrderItem[]): PurchaseOrderStatus {
  if (items.length === 0) return "DRAFT";
  const ordered = items.reduce((s, i) => s + i.qtyOrdered, 0);
  const received = items.reduce((s, i) => s + i.qtyReceived, 0);
  if (received <= 0) return "DRAFT";
  if (received >= ordered) return "RECEIVED";
  return "PARTIALLY_RECEIVED";
}

async function upsertSupplierProduct(
  supplierId: string,
  medicineId: string,
  cost: number,
  timestamp: number,
): Promise<void> {
  const existing = await pharmaDb.supplierProducts
    .where("supplierId")
    .equals(supplierId)
    .and((p) => p.medicineId === medicineId)
    .first();
  if (existing) {
    await pharmaDb.supplierProducts.update(existing.id, {
      latestUnitCost: round2(cost),
      updatedAt: timestamp,
    });
  } else {
    await pharmaDb.supplierProducts.add({
      id: uid(),
      supplierId,
      medicineId,
      latestUnitCost: round2(cost),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}

async function touchSupplierPerformance(
  po: PurchaseOrder,
  timestamp: number,
): Promise<void> {
  const existing = await pharmaDb.supplierPerformance
    .where("supplierId")
    .equals(po.supplierId)
    .first();
  const onTime = po.expectedDate
    ? timestamp <= new Date(`${po.expectedDate}T23:59:59`).getTime()
    : true;
  const perf: SupplierPerformance = existing
    ? {
        ...existing,
        onTimeDeliveries:
          existing.onTimeDeliveries + (onTime ? 1 : 0),
        lateDeliveries: existing.lateDeliveries + (onTime ? 0 : 1),
        rating: ratingFor({
          onTimeDeliveries: existing.onTimeDeliveries + (onTime ? 1 : 0),
          lateDeliveries: existing.lateDeliveries + (onTime ? 0 : 1),
          returnsCount: existing.returnsCount,
        }),
        lastOrderAt: timestamp,
        updatedAt: timestamp,
      }
    : {
        id: uid(),
        supplierId: po.supplierId,
        onTimeDeliveries: onTime ? 1 : 0,
        lateDeliveries: onTime ? 0 : 1,
        returnsCount: 0,
        avgLeadDays: 0,
        rating: onTime ? 5 : 4.5,
        lastOrderAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  if (existing) {
    await pharmaDb.supplierPerformance.update(existing.id, perf);
  } else {
    await pharmaDb.supplierPerformance.add(perf);
  }
}

function ratingFor(p: {
  onTimeDeliveries: number;
  lateDeliveries: number;
  returnsCount: number;
}): number {
  const r = 5 - p.lateDeliveries * 0.5 - p.returnsCount * 0.25;
  return Math.max(0, Math.round(r * 10) / 10);
}

// ---------------------------------------------------------------------------
// Supplier invoices & payments
// ---------------------------------------------------------------------------

export async function createSupplierInvoice(input: {
  supplierId?: string;
  grnId?: string;
  amount?: number;
  tax?: number;
  dueDate?: string;
  note?: string;
}): Promise<SupplierInvoice> {
  let supplierId = input.supplierId;
  let amount = input.amount ?? 0;
  let grn: Grn | undefined;
  if (input.grnId) {
    grn = await pharmaDb.grns.get(input.grnId);
    if (!grn) throw new Error("Goods received note not found.");
    supplierId = grn.supplierId;
    const items = await pharmaDb.grnItems
      .where("grnId")
      .equals(grn.id)
      .toArray();
    amount = grnTotal(items);
  }
  if (!supplierId) throw new Error("Select a supplier.");
  const supplier = await pharmaDb.suppliers.get(supplierId);
  if (!supplier) throw new Error("Supplier not found.");
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Invalid invoice amount.");
  }

  const timestamp = now();
  const number = await nextDocRef(
    "SI",
    await pharmaDb.supplierInvoices.count(),
  );
  const tax = round2(input.tax ?? 0);
  const invoice: SupplierInvoice = {
    id: uid(),
    number,
    supplierId: supplier.id,
    supplierName: supplier.name,
    grnId: grn?.id,
    grnNumber: grn?.number,
    amount: round2(amount),
    tax,
    total: round2(amount + tax),
    dueDate: input.dueDate,
    status: "PENDING",
    note: input.note?.trim() || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await pharmaDb.supplierInvoices.add(invoice);
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: "system",
    action: "CREATE",
    entityType: "supplier_invoice",
    entityId: invoice.id,
    newValues: { number, supplierId: supplier.id, total: invoice.total },
    createdAt: timestamp,
  });
  return invoice;
}

export async function recordSupplierPayment(input: {
  supplierId: string;
  invoiceId?: string;
  amount: number;
  method: SupplierPayment["method"];
  reference?: string;
  recordedBy?: string;
  recordedByName?: string;
}): Promise<SupplierPayment> {
  const supplier = await pharmaDb.suppliers.get(input.supplierId);
  if (!supplier) throw new Error("Supplier not found.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than 0.");
  }

  let invoice: SupplierInvoice | undefined;
  if (input.invoiceId) {
    invoice = await pharmaDb.supplierInvoices.get(input.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.status === "CANCELLED") throw new Error("Invoice is cancelled.");
  }

  const timestamp = now();
  const number = await nextDocRef(
    "SP",
    await pharmaDb.supplierPayments.count(),
  );
  const paymentId = uid();

  await pharmaDb.transaction(
    "rw",
    [pharmaDb.supplierPayments, pharmaDb.supplierInvoices],
    async () => {
      await pharmaDb.supplierPayments.add({
        id: paymentId,
        number,
        supplierId: supplier.id,
        supplierName: supplier.name,
        invoiceId: invoice?.id,
        invoiceNumber: invoice?.number,
        amount: round2(input.amount),
        method: input.method,
        reference: input.reference?.trim() || undefined,
        recordedBy: input.recordedBy,
        recordedByName: input.recordedByName,
        createdAt: timestamp,
      });
      if (invoice) {
        const paid = round2(
          (await pharmaDb.supplierPayments
            .where("invoiceId")
            .equals(invoice.id)
            .toArray()).reduce((s, p) => s + p.amount, 0),
        );
        const status: SupplierInvoiceStatus =
          paid >= invoice.total ? "PAID" : "PARTIALLY_PAID";
        await pharmaDb.supplierInvoices.update(invoice.id, {
          status,
          updatedAt: timestamp,
        });
      }
    },
  );
  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.recordedBy ?? "system",
    action: "CREATE",
    entityType: "supplier_payment",
    newValues: { number, supplierId: supplier.id, amount: round2(input.amount), method: input.method },
    createdAt: timestamp,
  });
  return {
    id: paymentId,
    number,
    supplierId: supplier.id,
    supplierName: supplier.name,
    invoiceId: invoice?.id,
    invoiceNumber: invoice?.number,
    amount: round2(input.amount),
    method: input.method,
    reference: input.reference?.trim() || undefined,
    recordedBy: input.recordedBy,
    recordedByName: input.recordedByName,
    createdAt: timestamp,
  };
}

export async function setSupplierInvoiceStatus(
  id: string,
  status: SupplierInvoiceStatus,
): Promise<void> {
  const invoice = await pharmaDb.supplierInvoices.get(id);
  if (!invoice) throw new Error("Invoice not found.");
  await pharmaDb.supplierInvoices.update(id, {
    status,
    updatedAt: now(),
  });
}

// ---------------------------------------------------------------------------
// Purchase returns (credit notes + negative stock movement)
// ---------------------------------------------------------------------------

export interface PurchaseReturnLineInput {
  medicineId: string;
  batchId?: string;
  batchNumber: string;
  qty: number;
  unitName?: string;
  unitConversion?: number;
  unitCost: number;
}

export async function createPurchaseReturn(input: {
  supplierId: string;
  grnId?: string;
  reason: string;
  lines: PurchaseReturnLineInput[];
  recordedBy?: string;
  recordedByName?: string;
}): Promise<PurchaseReturn> {
  const supplier = await pharmaDb.suppliers.get(input.supplierId);
  if (!supplier) throw new Error("Supplier not found.");
  if (!input.reason.trim()) throw new Error("A reason is required for a return.");
  if (input.lines.length === 0) throw new Error("Add at least one line to return.");

  const timestamp = now();
  const number = await nextDocRef(
    "SR",
    await pharmaDb.purchaseReturns.count(),
  );
  const creditNoteRef = `CN-${ymd()}-${String(
    (await pharmaDb.purchaseReturns.count()) + 1 + 1000,
  ).padStart(6, "0")}`;

  const returnId = uid();
  const grn = input.grnId ? await pharmaDb.grns.get(input.grnId) : undefined;
  const names = new Map<string, string>();
  for (const l of input.lines) {
    const m = await pharmaDb.medicines.get(l.medicineId);
    names.set(l.medicineId, m?.name ?? "Unknown medicine");
  }

  const items: PurchaseReturnItem[] = [];
  const batchIds = new Map<string, string>();
  for (const line of input.lines) {
    const batch = line.batchId
      ? await pharmaDb.medicineBatches.get(line.batchId)
      : await pharmaDb.medicineBatches
          .where("medicineId")
          .equals(line.medicineId)
          .and((b) => b.batchNumber === line.batchNumber && b.quantityRemaining > 0)
          .first();
    if (!batch) {
      throw new Error(
        `No active batch found for ${names.get(line.medicineId)} (${line.batchNumber}).`,
      );
    }
    const conversion = line.unitConversion ?? batch.unitConversion ?? 1;
    if (line.qty * conversion > batch.quantityRemaining) {
      throw new Error(
        `Returning ${line.qty} exceeds the available stock of ${batch.batchNumber}.`,
      );
    }
    batchIds.set(line.medicineId, batch.id);
    items.push({
      id: uid(),
      purchaseReturnId: returnId,
      medicineId: line.medicineId,
      medicineName: names.get(line.medicineId) ?? "Unknown medicine",
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      qty: line.qty,
      unitName: line.unitName ?? batch.unitName,
      unitConversion: line.unitConversion ?? batch.unitConversion,
      unitCost: round2(line.unitCost),
      total: round2(line.qty * line.unitCost),
    });
  }

  const total = round2(items.reduce((s, i) => s + i.total, 0));

  await pharmaDb.transaction(
    "rw",
    [
      pharmaDb.purchaseReturns,
      pharmaDb.purchaseReturnItems,
      pharmaDb.medicineBatches,
      pharmaDb.stockMovements,
      pharmaDb.supplierPerformance,
    ],
    async () => {
      await pharmaDb.purchaseReturns.add({
        id: returnId,
        number,
        supplierId: supplier.id,
        supplierName: supplier.name,
        grnId: grn?.id,
        grnNumber: grn?.number,
        reason: input.reason.trim(),
        total,
        status: "COMPLETED",
        creditNoteRef,
        recordedBy: input.recordedBy,
        recordedByName: input.recordedByName,
        createdAt: timestamp,
      });
      await pharmaDb.purchaseReturnItems.bulkAdd(items);

      for (const line of input.lines) {
        const batchId = batchIds.get(line.medicineId);
        if (!batchId) continue;
        const batch = await pharmaDb.medicineBatches.get(batchId);
        if (!batch) continue;
        await adjustBatch(
          batch,
          "RETURN",
          line.qty,
          "REMOVE",
          input.recordedBy ?? "system",
          `Returned to supplier (${number})`,
          line.unitConversion ?? batch.unitConversion,
        );
      }

      const perf = await pharmaDb.supplierPerformance
        .where("supplierId")
        .equals(supplier.id)
        .first();
      if (perf) {
        const returnsCount = perf.returnsCount + 1;
        await pharmaDb.supplierPerformance.update(perf.id, {
          returnsCount,
          rating: ratingFor({
            onTimeDeliveries: perf.onTimeDeliveries,
            lateDeliveries: perf.lateDeliveries,
            returnsCount,
          }),
          updatedAt: timestamp,
        });
      }
    },
  );

  await pharmaDb.auditLogs.add({
    id: uid(),
    userId: input.recordedBy ?? "system",
    action: "PURCHASE_RETURN",
    entityType: "purchase_return",
    entityId: returnId,
    newValues: {
      number,
      creditNoteRef,
      supplierId: supplier.id,
      total,
    },
    createdAt: timestamp,
  });

  return {
    id: returnId,
    number,
    supplierId: supplier.id,
    supplierName: supplier.name,
    grnId: grn?.id,
    grnNumber: grn?.number,
    reason: input.reason.trim(),
    total,
    status: "COMPLETED",
    creditNoteRef,
    recordedBy: input.recordedBy,
    recordedByName: input.recordedByName,
    createdAt: timestamp,
  };
}

// ---------------------------------------------------------------------------
// Supplier Center
// ---------------------------------------------------------------------------

export function priceIncreaseAlerts(
  history: SupplierPriceHistory[],
): Array<{
  supplierId: string;
  medicineId: string;
  fromPrice: number;
  toPrice: number;
  pct: number;
}> {
  const byKey = new Map<string, SupplierPriceHistory[]>();
  for (const h of history) {
    const key = `${h.supplierId}|${h.medicineId}`;
    const list = byKey.get(key) ?? [];
    list.push(h);
    byKey.set(key, list);
  }
  const alerts: Array<{
    supplierId: string;
    medicineId: string;
    fromPrice: number;
    toPrice: number;
    pct: number;
  }> = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    if (list.length < 2) continue;
    const prev = list[list.length - 2].price;
    const last = list[list.length - 1].price;
    if (last > prev) {
      alerts.push({
        supplierId: list[0].supplierId,
        medicineId: list[0].medicineId,
        fromPrice: prev,
        toPrice: last,
        pct: Math.round(((last - prev) / prev) * 100),
      });
    }
  }
  return alerts;
}

export async function setPreferredSupplier(
  supplierId: string,
  medicineId: string,
  preferred: boolean,
): Promise<void> {
  const existing = await pharmaDb.supplierProducts
    .where("supplierId")
    .equals(supplierId)
    .and((p) => p.medicineId === medicineId)
    .first();
  if (!existing) throw new Error("Supplier product not found.");
  await pharmaDb.supplierProducts.update(existing.id, {
    isPreferred: preferred,
    updatedAt: now(),
  });
}

export type { SupplierPerformance, SupplierPriceHistory, SupplierProduct };
