import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import { todayISO, deductStockFefo } from "./stock";
import { createPaymentRecord, isFinalPaymentStatus } from "./payments/service";
import { isGatewayMethod } from "./payments/gateway";
import type {
  PaymentMethod,
  Sale,
  SaleItem,
  SaleItemBatch,
} from "../types";

export interface CartLineInput {
  medicineId: string;
  quantity: number;
  unitPrice: number;
  unitId?: string;
  unitName?: string;
  unitConversion?: number;
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  provider?: string;
  providerReference?: string;
  transactionId?: string;
  currency: string;
  note?: string;
}

export interface CompleteSaleInput {
  lines: CartLineInput[];
  customerName?: string;
  customerPhone?: string;
  discount: number;
  taxRate: number;
  payments: PaymentInput[];
  cashierId: string;
  cashierName?: string;
  note?: string;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function nextInvoiceNumber(): Promise<string> {
  const prefixSetting = await pharmaDb.systemSettings
    .where("settingKey")
    .equals("invoice_prefix")
    .first();
  const prefix = prefixSetting?.settingValue || "INV";
  const count = await pharmaDb.sales.count();
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
}

export interface SaleDraftInput {
  lines: CartLineInput[];
  customerName?: string;
  customerPhone?: string;
  discount: number;
  taxRate: number;
  cashierId: string;
  cashierName?: string;
  note?: string;
  paymentIntents?: Array<{ method: PaymentMethod; amount: number }>;
}

async function findOrCreateCustomer(
  name: string | undefined,
  phone: string | undefined,
  timestamp: number,
): Promise<string | undefined> {
  if (!name?.trim()) return undefined;
  const cleanName = name.trim();
  const cleanPhone = phone?.trim();
  const existing = cleanPhone
    ? await pharmaDb.customers.where("phone").equals(cleanPhone).first()
    : await pharmaDb.customers.where("name").equals(cleanName).first();
  if (existing) {
    await pharmaDb.customers.update(existing.id, { updatedAt: timestamp });
    return existing.id;
  }
  const customerId = uid();
  await pharmaDb.customers.add({
    id: customerId,
    name: cleanName,
    phone: cleanPhone || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return customerId;
}

export async function createSaleDraft(
  input: SaleDraftInput,
): Promise<Sale> {
  if (input.lines.length === 0) throw new Error("Cart is empty.");
  for (const line of input.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error("Quantity must be greater than 0.");
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      throw new Error("Invalid unit price.");
    }
  }

  const timestamp = now();
  const dateKey = todayISO();
  const saleId = uid();

  return pharmaDb.transaction(
    "rw",
    [
      pharmaDb.sales,
      pharmaDb.saleItems,
      pharmaDb.customers,
      pharmaDb.systemSettings,
      pharmaDb.medicines,
    ],
    async () => {
      const prefixSetting = await pharmaDb.systemSettings
        .where("settingKey")
        .equals("invoice_prefix")
        .first();
      const prefix = prefixSetting?.settingValue || "INV";
      const count = await pharmaDb.sales.count();
      const invoiceNumber = `${prefix}-${String(count + 1).padStart(5, "0")}`;

      const medicineNames = new Map<string, string>();
      for (const line of input.lines) {
        const m = await pharmaDb.medicines.get(line.medicineId);
        medicineNames.set(line.medicineId, m?.name ?? "Unknown medicine");
      }

      const items: SaleItem[] = [];
      let subtotal = 0;
      for (const line of input.lines) {
        const baseQty = Math.round(line.quantity * (line.unitConversion ?? 1));
        if (baseQty <= 0) {
          throw new Error(
            `Invalid quantity for ${medicineNames.get(line.medicineId)}.`,
          );
        }
        const lineTotal = round2(line.quantity * line.unitPrice);
        subtotal += lineTotal;
        items.push({
          id: uid(),
          saleId,
          medicineId: line.medicineId,
          medicineName: medicineNames.get(line.medicineId) ?? "Unknown medicine",
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          unitName: line.unitName,
          unitConversion: line.unitConversion,
          baseQuantity: baseQty,
          lineTotal,
          costPrice: 0,
          batches: [],
        });
      }

      const subtotalRounded = round2(subtotal);
      const discount = round2(Math.max(0, input.discount));
      const taxRate = round2(Math.max(0, input.taxRate));
      const taxable = round2(Math.max(0, subtotalRounded - discount));
      const tax = round2((taxable * taxRate) / 100);
      const total = round2(taxable + tax);

      const customerId = await findOrCreateCustomer(
        input.customerName,
        input.customerPhone,
        timestamp,
      );

      const intents = input.paymentIntents ?? [];
      const sale: Sale = {
        id: saleId,
        invoiceNumber,
        customerId,
        customerName: input.customerName?.trim() || undefined,
        customerPhone: input.customerPhone?.trim() || undefined,
        saleDate: timestamp,
        saleDateKey: dateKey,
        subtotal: subtotalRounded,
        discount,
        taxRate,
        tax,
        total,
        amountPaid: 0,
        changeDue: 0,
        balanceDue: total,
        paymentMethod: intents[0]?.method ?? "OTHER",
        cashierId: input.cashierId,
        cashierName: input.cashierName,
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
        stockStatus: "NOT_DEDUCTED",
        receiptStatus: "NOT_ISSUED",
        paymentIntents: intents,
        note: input.note?.trim() || undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await pharmaDb.sales.add(sale);
      await pharmaDb.saleItems.bulkAdd(items);
      return sale;
    },
  );
}

export async function finalizeSale(
  saleId: string,
  payments?: PaymentInput[],
): Promise<Sale> {
  return pharmaDb.transaction(
    "rw",
    [
      pharmaDb.sales,
      pharmaDb.saleItems,
      pharmaDb.medicines,
      pharmaDb.medicineBatches,
      pharmaDb.stockMovements,
      pharmaDb.customers,
      pharmaDb.systemSettings,
      pharmaDb.payments,
      pharmaDb.paymentTransactions,
      pharmaDb.paymentProviderEvents,
      pharmaDb.paymentConfirmations,
    ],
    async () => {
      const sale = await pharmaDb.sales.get(saleId);
      if (!sale) throw new Error("Sale not found.");
      if (sale.status !== "PENDING_PAYMENT") {
        throw new Error(
          `Sale ${sale.invoiceNumber} is not awaiting payment confirmation.`,
        );
      }

      const items = await pharmaDb.saleItems
        .where("saleId")
        .equals(saleId)
        .toArray();
      const timestamp = now();

      for (const item of items) {
        const baseQty = item.baseQuantity ?? 0;
        if (baseQty <= 0) {
          throw new Error(`Invalid quantity for ${item.medicineName}.`);
        }
        const allocations = await deductStockFefo(item.medicineId, baseQty, {
          performedBy: sale.cashierId,
          referenceType: "sale",
          referenceId: saleId,
          reason: `Sale ${sale.invoiceNumber}`,
          timestamp,
        });
        const costSum = allocations.reduce(
          (sum, a) => sum + a.baseQuantity * a.costPrice,
          0,
        );
        const batches: SaleItemBatch[] = allocations.map((a) => ({
          batchId: a.batchId,
          quantity: a.baseQuantity,
          costPrice: a.costPrice,
        }));
        await pharmaDb.saleItems.update(item.id, {
          batches,
          costPrice: round2(costSum / item.quantity),
        });
      }

      const intents: PaymentInput[] =
        payments ??
        (sale.paymentIntents ?? []).map((i) => ({
          method: i.method,
          amount: i.amount,
          currency: "UGX",
        }));

      const nonGateway = intents.filter((p) => !isGatewayMethod(p.method));
      const gatewayTxns = await pharmaDb.paymentTransactions
        .where("saleId")
        .equals(saleId)
        .and((tx) => tx.direction === "COLLECTION" && tx.status === "SUCCESS")
        .toArray();

      const gatewayPayments: PaymentInput[] = [];
      for (const tx of gatewayTxns) {
        const confirmation = await pharmaDb.paymentConfirmations
          .where("transactionId")
          .equals(tx.id)
          .and((c) => c.verified && c.providerStatus === "SUCCESS")
          .first();
        if (!confirmation) {
          throw new Error(
            "A gateway payment has no verified provider confirmation. Sale cannot be completed.",
          );
        }
        gatewayPayments.push({
          method: tx.method,
          amount: tx.amount,
          provider: tx.provider,
          providerReference: tx.providerReference,
          transactionId: tx.id,
          currency: tx.currency,
        });
      }

      const paymentsToRecord: Array<PaymentInput & { confirmationId?: string }> =
        [...nonGateway, ...gatewayPayments];

      const amountPaid = round2(
        paymentsToRecord.reduce((sum, p) => sum + p.amount, 0),
      );
      const changeDue = round2(Math.max(0, amountPaid - sale.total));
      const balanceDue = round2(Math.max(0, sale.total - amountPaid));

      for (const payment of paymentsToRecord) {
        const confirmationId = payment.transactionId
          ? (
              await pharmaDb.paymentConfirmations
                .where("transactionId")
                .equals(payment.transactionId)
                .and((c) => c.verified && c.providerStatus === "SUCCESS")
                .first()
            )?.id
          : undefined;
        await createPaymentRecord({
          saleId,
          method: payment.method,
          provider: payment.provider,
          providerReference: payment.providerReference,
          transactionId: payment.transactionId,
          amount: payment.amount,
          currency: payment.currency,
          status: "SUCCESS",
          confirmationId,
          recordedBy: sale.cashierId,
        });
      }

      await pharmaDb.sales.update(saleId, {
        status: "COMPLETED",
        paymentStatus: "SUCCESS",
        stockStatus: "DEDUCTED",
        receiptStatus: "ISSUED",
        amountPaid,
        changeDue,
        balanceDue,
        updatedAt: timestamp,
        completedAt: timestamp,
      });

      return (await pharmaDb.sales.get(saleId))!;
    },
  );
}

export async function cancelSaleDraft(
  saleId: string,
  actorId?: string,
): Promise<void> {
  return pharmaDb.transaction(
    "rw",
    [
      pharmaDb.sales,
      pharmaDb.paymentTransactions,
      pharmaDb.paymentProviderEvents,
      pharmaDb.paymentConfirmations,
    ],
    async () => {
      const sale = await pharmaDb.sales.get(saleId);
      if (!sale || sale.status !== "PENDING_PAYMENT") return;
      const ts = now();
      const txns = await pharmaDb.paymentTransactions
        .where("saleId")
        .equals(saleId)
        .toArray();
      for (const tx of txns) {
        if (isFinalPaymentStatus(tx.status)) continue;
        await pharmaDb.paymentTransactions.update(tx.id, {
          status: "CANCELLED",
          completedAt: ts,
          failureReason: "Sale cancelled before payment confirmation.",
          updatedAt: ts,
        });
        await pharmaDb.paymentProviderEvents.add({
          id: uid(),
          transactionId: tx.id,
          saleId,
          provider: tx.provider ?? tx.method,
          eventType: "WEBHOOK",
          status: "CANCELLED",
          raw: `saleDraftCancelled by=${actorId ?? "N/A"}`,
          receivedAt: ts,
        });
      }
      await pharmaDb.sales.update(saleId, {
        status: "CANCELLED",
        updatedAt: ts,
      });
    },
  );
}

export async function completeSale(
  input: CompleteSaleInput,
): Promise<Sale> {
  if (input.lines.length === 0) throw new Error("Cart is empty.");
  if (input.payments.length === 0) {
    throw new Error("At least one payment is required.");
  }
  for (const line of input.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error("Quantity must be greater than 0.");
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      throw new Error("Invalid unit price.");
    }
  }
  for (const payment of input.payments) {
    if (!Number.isFinite(payment.amount) || payment.amount < 0) {
      throw new Error("Invalid payment amount.");
    }
    if (isGatewayMethod(payment.method)) {
      throw new Error(
        "Online payments (mobile money, bank, card, PayPal) require provider confirmation before the sale can be completed.",
      );
    }
  }

  const timestamp = now();
  const dateKey = todayISO();
  const saleId = uid();

  return pharmaDb.transaction(
    "rw",
    [
      pharmaDb.sales,
      pharmaDb.saleItems,
      pharmaDb.medicines,
      pharmaDb.medicineBatches,
      pharmaDb.stockMovements,
      pharmaDb.customers,
      pharmaDb.systemSettings,
      pharmaDb.payments,
      pharmaDb.paymentTransactions,
      pharmaDb.paymentProviderEvents,
      pharmaDb.paymentConfirmations,
    ],
    async () => {
      const prefixSetting = await pharmaDb.systemSettings
        .where("settingKey")
        .equals("invoice_prefix")
        .first();
      const prefix = prefixSetting?.settingValue || "INV";
      const count = await pharmaDb.sales.count();
      const invoiceNumber = `${prefix}-${String(count + 1).padStart(5, "0")}`;

      const medicineNames = new Map<string, string>();
      for (const line of input.lines) {
        const m = await pharmaDb.medicines.get(line.medicineId);
        medicineNames.set(line.medicineId, m?.name ?? "Unknown medicine");
      }

      const items: SaleItem[] = [];
      let subtotal = 0;

      for (const line of input.lines) {
        const baseQty = Math.round(line.quantity * (line.unitConversion ?? 1));
        if (baseQty <= 0) {
          throw new Error(
            `Invalid quantity for ${medicineNames.get(line.medicineId)}.`,
          );
        }

        const allocations = await deductStockFefo(line.medicineId, baseQty, {
          performedBy: input.cashierId,
          referenceType: "sale",
          referenceId: saleId,
          reason: `Sale ${invoiceNumber}`,
          timestamp,
        });

        const costSum = allocations.reduce(
          (sum, a) => sum + a.baseQuantity * a.costPrice,
          0,
        );
        const lineTotal = round2(line.quantity * line.unitPrice);
        subtotal += lineTotal;

        const batches: SaleItemBatch[] = allocations.map((a) => ({
          batchId: a.batchId,
          quantity: a.baseQuantity,
          costPrice: a.costPrice,
        }));

        items.push({
          id: uid(),
          saleId,
          medicineId: line.medicineId,
          medicineName: medicineNames.get(line.medicineId) ?? "Unknown medicine",
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          unitName: line.unitName,
          unitConversion: line.unitConversion,
          baseQuantity: baseQty,
          lineTotal,
          costPrice: round2(costSum / line.quantity),
          batches,
        });
      }

      const subtotalRounded = round2(subtotal);
      const discount = round2(Math.max(0, input.discount));
      const taxRate = round2(Math.max(0, input.taxRate));
      const taxable = round2(Math.max(0, subtotalRounded - discount));
      const tax = round2((taxable * taxRate) / 100);
      const total = round2(taxable + tax);
      const amountPaid = round2(
        input.payments.reduce((sum, p) => sum + p.amount, 0),
      );
      const changeDue = round2(Math.max(0, amountPaid - total));
      const balanceDue = round2(Math.max(0, total - amountPaid));

      let customerId: string | undefined;
      if (input.customerName?.trim()) {
        const name = input.customerName.trim();
        const phone = input.customerPhone?.trim();
        const existing = phone
          ? await pharmaDb.customers.where("phone").equals(phone).first()
          : await pharmaDb.customers.where("name").equals(name).first();
        if (existing) {
          customerId = existing.id;
          await pharmaDb.customers.update(existing.id, { updatedAt: timestamp });
        } else {
          customerId = uid();
          await pharmaDb.customers.add({
            id: customerId,
            name,
            phone: phone || undefined,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }

      const sale: Sale = {
        id: saleId,
        invoiceNumber,
        customerId,
        customerName: input.customerName?.trim() || undefined,
        customerPhone: input.customerPhone?.trim() || undefined,
        saleDate: timestamp,
        saleDateKey: dateKey,
        subtotal: subtotalRounded,
        discount,
        taxRate,
        tax,
        total,
        amountPaid,
        changeDue,
        balanceDue,
        paymentMethod: input.payments[0].method,
        cashierId: input.cashierId,
        cashierName: input.cashierName,
        status: "COMPLETED",
        note: input.note?.trim() || undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await pharmaDb.sales.add(sale);
      await pharmaDb.saleItems.bulkAdd(items);

      for (const payment of input.payments) {
        await createPaymentRecord({
          saleId,
          method: payment.method,
          provider: payment.provider,
          providerReference: payment.providerReference,
          transactionId: payment.transactionId,
          amount: payment.amount,
          currency: payment.currency,
          status: "SUCCESS",
          note: payment.note,
          recordedBy: input.cashierId,
        });
      }

      return sale;
    },
  );
}

export async function voidSale(
  saleId: string,
  performedBy: string,
): Promise<void> {
  return pharmaDb.transaction(
    "rw",
    [
      pharmaDb.sales,
      pharmaDb.saleItems,
      pharmaDb.medicineBatches,
      pharmaDb.stockMovements,
    ],
    async () => {
      const sale = await pharmaDb.sales.get(saleId);
      if (!sale) throw new Error("Sale not found.");
      if (sale.status === "VOIDED") throw new Error("Sale is already voided.");

      const items = await pharmaDb.saleItems
        .where("saleId")
        .equals(saleId)
        .toArray();
      const dateKey = todayISO();
      const timestamp = now();

      for (const item of items) {
        for (const allocation of item.batches) {
          const batch =
            await pharmaDb.medicineBatches.get(allocation.batchId);
          if (!batch) continue;
          if (batch.expiryDate < dateKey) continue;
          const newRemaining = batch.quantityRemaining + allocation.quantity;
          await pharmaDb.medicineBatches.update(batch.id, {
            quantityRemaining: newRemaining,
            status: newRemaining > 0 ? "ACTIVE" : batch.status,
            updatedAt: timestamp,
          });
          await pharmaDb.stockMovements.add({
            id: uid(),
            medicineId: item.medicineId,
            batchId: batch.id,
            movementType: "RETURN",
            quantity: allocation.quantity,
            referenceType: "sale_void",
            referenceId: saleId,
            performedBy,
            reason: `Void ${sale.invoiceNumber}`,
            createdAt: timestamp,
          });
        }
      }

      await pharmaDb.sales.update(saleId, {
        status: "VOIDED",
        updatedAt: timestamp,
      });
    },
  );
}
