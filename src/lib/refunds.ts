import { pharmaDb } from "../db";
import { uid, now } from "./utils";
import { round2 } from "./sales";
import { getGatewayConfig, nextPaymentReference } from "./payments/service";
import { getAdapter, isGatewayMethod, providerForMethod } from "./payments/gateway";
import type {
  PaymentMethod,
  PaymentTransaction,
  Refund,
  RefundItem,
  ProviderEventType,
  RefundReason,
} from "../types";

export function saleItemSoldBase(item: {
  baseQuantity?: number;
  quantity: number;
  unitConversion?: number;
}): number {
  return item.baseQuantity ?? Math.round(item.quantity * (item.unitConversion ?? 1));
}

export interface RefundLineInput {
  saleItemId: string;
  quantity: number;
}

export interface CreateRefundInput {
  saleId: string;
  lines: RefundLineInput[];
  reason: RefundReason;
  refundMethod: PaymentMethod;
  note?: string;
  recordedBy: string;
  recordedByName?: string;
}

export async function createRefund(
  input: CreateRefundInput,
): Promise<Refund> {
  if (input.lines.length === 0) {
    throw new Error("Select at least one item to return.");
  }
  for (const line of input.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error("Return quantity must be greater than 0.");
    }
  }

  // The provider refund is a network call. IndexedDB transactions cannot stay
  // open across real network awaits, so it runs after the transaction commits.
  const holder: { post?: PostRefund } = {};

  const created = await pharmaDb.transaction(
    "rw",
    [
      pharmaDb.sales,
      pharmaDb.saleItems,
      pharmaDb.refunds,
      pharmaDb.refundItems,
      pharmaDb.medicineBatches,
      pharmaDb.stockMovements,
      pharmaDb.payments,
      pharmaDb.paymentTransactions,
      pharmaDb.paymentProviderEvents,
      pharmaDb.auditLogs,
    ],
    async () => {
      const sale = await pharmaDb.sales.get(input.saleId);
      if (!sale) throw new Error("Sale not found.");
      if (sale.status !== "COMPLETED") {
        throw new Error("Only completed sales can be refunded.");
      }

      const items = await pharmaDb.saleItems
        .where("saleId")
        .equals(sale.id)
        .toArray();
      const priorRefunds = await pharmaDb.refunds
        .where("saleId")
        .equals(sale.id)
        .toArray();
      const priorRefundIds = priorRefunds.map((r) => r.id);
      const priorItems = priorRefundIds.length
        ? await pharmaDb.refundItems
            .where("refundId")
            .anyOf(priorRefundIds)
            .toArray()
        : [];
      const priorTotal = priorRefunds.reduce((sum, r) => sum + r.amount, 0);

      const alreadyBySaleItem = new Map<string, number>();
      for (const pi of priorItems) {
        alreadyBySaleItem.set(
          pi.saleItemId,
          (alreadyBySaleItem.get(pi.saleItemId) ?? 0) + pi.baseQuantity,
        );
      }

      const refundId = uid();
      const timestamp = now();
      const paymentReference = await nextPaymentReference();
      const refundItems: RefundItem[] = [];
      let refundAmount = 0;
      let refundCogs = 0;

      for (const line of input.lines) {
        const item = items.find((i) => i.id === line.saleItemId);
        if (!item) throw new Error("Sale item not found.");
        const conversion = item.unitConversion ?? 1;
        const requestedBase = Math.round(line.quantity * conversion);
        const alreadyBase = alreadyBySaleItem.get(item.id) ?? 0;
        const refundableBase = saleItemSoldBase(item) - alreadyBase;
        if (requestedBase <= 0 || requestedBase > refundableBase) {
          const maxSold = refundableBase / conversion;
          throw new Error(
            `Cannot return more than ${maxSold} ${item.unitName ?? "unit(s)"} of ${item.medicineName}.`,
          );
        }

        let toRestock = requestedBase;
        for (const allocation of item.batches) {
          if (toRestock <= 0) break;
          const batch = await pharmaDb.medicineBatches.get(allocation.batchId);
          if (!batch) continue;
          const take = Math.min(toRestock, allocation.quantity);
          const newRemaining = batch.quantityRemaining + take;
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
            quantity: take,
            referenceType: "sale_refund",
            referenceId: refundId,
            performedBy: input.recordedBy,
            reason: `Refund ${sale.invoiceNumber}`,
            createdAt: timestamp,
          });
          toRestock -= take;
        }
        if (toRestock > 0) {
          throw new Error(
            `Stock cannot be fully restored for ${item.medicineName}.`,
          );
        }

        const lineTotal = round2(line.quantity * item.unitPrice);
        refundAmount += lineTotal;
        refundCogs += item.costPrice * line.quantity;
        refundItems.push({
          id: uid(),
          refundId,
          saleId: sale.id,
          saleItemId: item.id,
          medicineId: item.medicineId,
          medicineName: item.medicineName,
          unitName: item.unitName,
          quantity: line.quantity,
          unitConversion: item.unitConversion,
          baseQuantity: requestedBase,
          unitPrice: item.unitPrice,
          lineTotal,
          costPrice: item.costPrice,
        });
      }

      refundAmount = round2(refundAmount);
      if (refundAmount <= 0) {
        throw new Error("Refund amount must be greater than 0.");
      }
      if (priorTotal + refundAmount > sale.total) {
        throw new Error(
          `Refund exceeds the sale total of ${sale.total}.`,
        );
      }

      const refund: Refund = {
        id: refundId,
        saleId: sale.id,
        invoiceNumber: sale.invoiceNumber,
        saleDate: sale.saleDate,
        saleDateKey: sale.saleDateKey,
        amount: refundAmount,
        cogs: round2(refundCogs),
        reason: input.reason,
        refundMethod: input.refundMethod,
        note: input.note?.trim() || undefined,
        recordedBy: input.recordedBy,
        recordedByName: input.recordedByName,
        createdAt: timestamp,
      };

      await pharmaDb.refunds.add(refund);
      await pharmaDb.refundItems.bulkAdd(refundItems);

      await pharmaDb.payments.add({
        id: uid(),
        saleId: sale.id,
        method: input.refundMethod,
        provider: undefined,
        providerReference: undefined,
        paymentReference,
        amount: -refundAmount,
        currency: "UGX",
        status: "SUCCESS",
        initiatedAt: sale.saleDate,
        completedAt: sale.saleDate,
        failureReason: undefined,
        note: `Refund ${sale.invoiceNumber} (${input.reason})`,
        recordedBy: input.recordedBy,
        createdAt: sale.saleDate,
      });

      const refundTxId = uid();
      let refundProvider: string | undefined;
      let refundProviderRef: string | undefined;
      let refundStatus: "SUCCESS" | "FAILED" | "PENDING" = "SUCCESS";
      let refundFailureReason: string | undefined;

      if (isGatewayMethod(input.refundMethod)) {
        const originalTx = await pharmaDb.paymentTransactions
          .where("saleId")
          .equals(sale.id)
          .filter(
            (t) =>
              t.direction === "COLLECTION" &&
              t.method === input.refundMethod &&
              t.status === "SUCCESS",
          )
          .first();

        if (originalTx?.provider && getAdapter(originalTx.provider)) {
          const providerId: string =
            providerForMethod(input.refundMethod, originalTx.provider) ??
            originalTx.provider;
          refundProvider = providerId;
          refundStatus = "PENDING";
          holder.post = {
            refundTxId,
            saleId: sale.id,
            provider: providerId,
            method: input.refundMethod,
            amount: refundAmount,
            originalTx,
          };
        }
      }

      await pharmaDb.paymentTransactions.add({
        id: refundTxId,
        paymentId: undefined,
        saleId: sale.id,
        method: input.refundMethod,
        provider: refundProvider,
        direction: "REFUND",
        amount: refundAmount,
        currency: "UGX",
        customerReference: undefined,
        providerReference: refundProviderRef,
        paymentReference,
        status: refundStatus,
        initiatedAt: timestamp,
        completedAt: refundStatus === "SUCCESS" ? timestamp : undefined,
        failureReason: refundFailureReason,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: input.recordedBy,
        action: "REFUND",
        entityType: "refund",
        entityId: refundId,
        newValues: {
          invoiceNumber: sale.invoiceNumber,
          amount: refundAmount,
          reason: input.reason,
          refundMethod: input.refundMethod,
          items: refundItems.map(
            (i) => `${i.medicineName} x${i.quantity}`,
          ),
        },
        createdAt: timestamp,
      });

      return refund;
    },
  );

  if (holder.post) await sendProviderRefund(holder.post);
  return created;
}

interface PostRefund {
  refundTxId: string;
  saleId: string;
  provider: string;
  method: PaymentMethod;
  amount: number;
  originalTx: PaymentTransaction;
}

/** Sends the refund to the provider and records what the provider answered. */
async function sendProviderRefund(post: PostRefund): Promise<void> {
  const adapter = getAdapter(post.provider);
  let status: "SUCCESS" | "FAILED" | "PENDING" = "FAILED";
  let providerRef: string | undefined;
  let failure: string | undefined = "Gateway refund call failed.";
  const events: Array<{ eventType: ProviderEventType; status: string; raw: string }> = [];
  try {
    if (!adapter) throw new Error("No gateway adapter.");
    const gateway = await getGatewayConfig(post.provider);
    const result = await adapter.refund(
      {
        transactionId: post.refundTxId,
        originalTransactionId: post.originalTx.id,
        saleId: post.saleId,
        provider: post.provider,
        method: post.method,
        amount: post.amount,
        currency: post.originalTx.currency,
        customerReference: post.originalTx.customerReference,
        gateway,
      },
      post.originalTx.providerReference ?? "",
    );
    providerRef = result.providerReference;
    status =
      result.status === "SUCCESS"
        ? "SUCCESS"
        : result.status === "PENDING"
          ? "PENDING"
          : "FAILED";
    failure = status === "FAILED" ? result.message : undefined;
    events.push(...result.events);
  } catch {
    /* keep FAILED defaults */
  }
  const timestamp = now();
  await pharmaDb.paymentTransactions.update(post.refundTxId, {
    status,
    providerReference: providerRef,
    completedAt: status === "SUCCESS" ? timestamp : undefined,
    failureReason: failure,
    updatedAt: timestamp,
  });
  for (const evt of events) {
    await pharmaDb.paymentProviderEvents.add({
      id: uid(),
      transactionId: post.refundTxId,
      saleId: post.saleId,
      provider: post.provider,
      eventType: evt.eventType,
      status: evt.status,
      raw: evt.raw,
      receivedAt: timestamp,
    });
  }
}

export function refundableForItem(
  item: { baseQuantity?: number; quantity: number; unitConversion?: number },
  alreadyRefundedBase: number,
): number {
  const refundableBase = Math.max(0, saleItemSoldBase(item) - alreadyRefundedBase);
  const conversion = item.unitConversion ?? 1;
  return Math.floor((refundableBase + 0.0001) / conversion);
}
