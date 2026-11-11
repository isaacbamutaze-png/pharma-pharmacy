import { pharmaDb } from "../../db";
import { uid, now } from "../utils";
import { round2 } from "../sales";
import { loadPaymentsServerConfig } from "./remote";
import {
  getAdapter,
  isGatewayMethod,
  providerForMethod,
  providerLabel,
  type GatewayContext,
} from "./gateway";
import type {
  GatewayEnvironment,
  Payment,
  PaymentConfirmation,
  PaymentGateway,
  PaymentMethod,
  PaymentProviderEvent,
  PaymentStatus,
  PaymentTransaction,
} from "../../types";

function statusToPaymentStatus(
  s:
    | "PROCESSING"
    | "PENDING"
    | "SUCCESS"
    | "FAILED"
    | "DECLINED"
    | "CANCELLED"
    | "TIMEOUT"
    | "EXPIRED"
    | "UNKNOWN",
): PaymentStatus {
  switch (s) {
    case "PROCESSING":
      return "PROCESSING";
    case "PENDING":
      return "PENDING";
    case "SUCCESS":
      return "SUCCESS";
    case "FAILED":
      return "FAILED";
    case "DECLINED":
      return "DECLINED";
    case "CANCELLED":
      return "CANCELLED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "EXPIRED":
      return "EXPIRED";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

export function isFinalPaymentStatus(status: PaymentStatus): boolean {
  return (
    status === "SUCCESS" ||
    status === "FAILED" ||
    status === "DECLINED" ||
    status === "CANCELLED" ||
    status === "TIMEOUT" ||
    status === "EXPIRED"
  );
}

export function isFailedPaymentStatus(status: PaymentStatus): boolean {
  return (
    status === "FAILED" ||
    status === "DECLINED" ||
    status === "CANCELLED" ||
    status === "TIMEOUT" ||
    status === "EXPIRED"
  );
}

export async function nextPaymentReference(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const count = await pharmaDb.paymentTransactions.count();
  return `PAY-${ymd}-${String(count + 1).padStart(6, "0")}`;
}

export async function getGatewayConfig(
  provider: string,
): Promise<PaymentGateway | undefined> {
  return pharmaDb.paymentGateways
    .where("provider")
    .equals(provider)
    .first();
}

export interface GatewayConfigInput {
  provider: string;
  label?: string;
  enabled?: boolean;
  environment?: GatewayEnvironment;
  merchantId?: string;
  apiKey?: string;
  apiSecret?: string;
  webhookUrl?: string;
  config?: Record<string, string>;
}

export async function saveGatewayConfig(
  input: GatewayConfigInput,
): Promise<PaymentGateway> {
  const existing = await getGatewayConfig(input.provider);
  const timestamp = now();
  const status: "CONNECTED" | "NOT_CONFIGURED" | "ERROR" = input.apiKey
    ? "CONNECTED"
    : "NOT_CONFIGURED";

  if (existing) {
    await pharmaDb.paymentGateways.update(existing.id, {
      label: input.label ?? existing.label,
      enabled: input.enabled ?? existing.enabled,
      environment: input.environment ?? existing.environment,
      merchantId: input.merchantId,
      apiKey: input.apiKey,
      apiSecret: input.apiSecret,
      webhookUrl: input.webhookUrl,
      config: input.config,
      status,
      updatedAt: timestamp,
    });
    return {
      ...existing,
      label: input.label ?? existing.label,
      enabled: input.enabled ?? existing.enabled,
      environment: input.environment ?? existing.environment,
      merchantId: input.merchantId,
      apiKey: input.apiKey,
      apiSecret: input.apiSecret,
      webhookUrl: input.webhookUrl,
      config: input.config,
      status,
      updatedAt: timestamp,
    };
  }

  const gateway: PaymentGateway = {
    id: uid(),
    provider: input.provider,
    label: input.label ?? providerLabel(input.provider),
    enabled: input.enabled ?? false,
    environment: input.environment ?? "sandbox",
    currency: "UGX",
    merchantId: input.merchantId,
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
    webhookUrl: input.webhookUrl,
    status,
    config: input.config,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await pharmaDb.paymentGateways.add(gateway);
  return gateway;
}

async function recordEvent(
  event: Omit<PaymentProviderEvent, "id">,
): Promise<void> {
  await pharmaDb.paymentProviderEvents.add({ id: uid(), ...event });
}

export interface InitiatePaymentInput {
  saleId?: string;
  method: PaymentMethod;
  provider?: string;
  amount: number;
  currency: string;
  customerReference?: string;
  recordedBy?: string;
}

export interface InitiatePaymentResult {
  transactionId: string;
  status: PaymentStatus;
  providerReference?: string;
  paymentReference?: string;
  message?: string;
  /** Secure page the customer must open (card / bank / PayPal). */
  actionUrl?: string;
}

export async function initiatePayment(
  input: InitiatePaymentInput,
): Promise<InitiatePaymentResult> {
  if (!isGatewayMethod(input.method)) {
    throw new Error("This payment method does not use a gateway.");
  }
  const provider =
    providerForMethod(input.method, input.provider) ?? "UNKNOWN";
  const adapter = getAdapter(provider);
  if (!adapter) throw new Error(`No gateway adapter for ${provider}.`);

  const gateway = await getGatewayConfig(provider);
  const transactionId = uid();
  const timestamp = now();
  const amount = round2(input.amount);
  const paymentReference = await nextPaymentReference();

  const context: GatewayContext = {
    transactionId,
    saleId: input.saleId,
    provider,
    method: input.method,
    amount,
    currency: input.currency,
    customerReference: input.customerReference,
    gateway,
  };

  const result = await adapter.collect(context);

  const status = statusToPaymentStatus(result.status);

  await pharmaDb.paymentTransactions.add({
    id: transactionId,
    saleId: input.saleId,
    method: input.method,
    provider,
    direction: "COLLECTION",
    amount,
    currency: input.currency,
    customerReference: input.customerReference,
    providerReference: result.providerReference,
    paymentReference,
    status,
    initiatedAt: timestamp,
    requestedAt: timestamp,
    completedAt: isFinalPaymentStatus(status) ? now() : undefined,
    failureReason: isFailedPaymentStatus(status)
      ? result.message
      : undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  for (const ev of result.events) {
    await recordEvent({
      transactionId,
      saleId: input.saleId,
      provider,
      eventType: ev.eventType,
      status: ev.status,
      raw: ev.raw,
      receivedAt: now(),
    });
  }

  return {
    transactionId,
    status,
    providerReference: result.providerReference,
    paymentReference,
    message: result.message,
    actionUrl: result.actionUrl,
  };
}

export async function getVerifiedConfirmation(
  transactionId: string,
): Promise<PaymentConfirmation | undefined> {
  return pharmaDb.paymentConfirmations
    .where("transactionId")
    .equals(transactionId)
    .and((c) => c.verified && c.providerStatus === "SUCCESS")
    .sortBy("createdAt")
    .then((rows) => rows[rows.length - 1]);
}

export async function getConfirmationsForTransaction(
  transactionId: string,
): Promise<PaymentConfirmation[]> {
  return pharmaDb.paymentConfirmations
    .where("transactionId")
    .equals(transactionId)
    .sortBy("createdAt");
}

export interface ProviderConfirmationReceived {
  transactionId: string;
  confirmation?: PaymentConfirmation;
  transactionStatus: PaymentStatus;
  verified: boolean;
}

export async function receiveProviderConfirmation(
  transactionId: string,
): Promise<ProviderConfirmationReceived> {
  const tx = await pharmaDb.paymentTransactions.get(transactionId);
  if (!tx) throw new Error("Payment transaction not found.");

  const existing = await getConfirmationsForTransaction(transactionId);
  // TIMEOUT / EXPIRED are not conclusive: the customer may still approve late,
  // so they are re-checked with the provider instead of being trusted forever.
  const recheckable = tx.status === "TIMEOUT" || tx.status === "EXPIRED";
  if (isFinalPaymentStatus(tx.status) && existing.length > 0 && !recheckable) {
    const latest = existing[existing.length - 1];
    return {
      transactionId,
      confirmation: latest,
      transactionStatus: tx.status,
      verified: latest.verified,
    };
  }

  if (!tx.provider) {
    throw new Error("Payment transaction has no provider.");
  }
  const adapter = getAdapter(tx.provider);
  if (!adapter) throw new Error(`No gateway adapter for ${tx.provider}.`);

  const gateway = await getGatewayConfig(tx.provider);
  const context: GatewayContext = {
    transactionId,
    paymentId: tx.paymentId,
    saleId: tx.saleId,
    provider: tx.provider,
    method: tx.method,
    amount: tx.amount,
    currency: tx.currency,
    customerReference: tx.customerReference,
    gateway,
  };

  const result = await adapter.confirm(context, tx.providerReference ?? "");
  const status = statusToPaymentStatus(result.status);
  const timestamp = now();

  if (!isFinalPaymentStatus(status)) {
    const updates: Partial<PaymentTransaction> = {
      status,
      providerTransactionId:
        result.providerTransactionId ?? tx.providerTransactionId,
      providerConfirmation:
        result.confirmationReference ?? tx.providerConfirmation,
      updatedAt: timestamp,
    };
    await pharmaDb.paymentTransactions.update(transactionId, updates);
    if (status !== tx.status) {
      await recordEvent({
        transactionId,
        saleId: tx.saleId,
        provider: tx.provider,
        eventType: "STATUS_POLL",
        status: result.status,
        raw: result.raw,
        receivedAt: timestamp,
      });
    }
    return {
      transactionId,
      transactionStatus: status,
      verified: false,
    };
  }

  const matchesAmount =
    result.amount === undefined ||
    round2(result.amount) === round2(tx.amount);
  const verified = status === "SUCCESS" && matchesAmount;
  const confirmed = status === "SUCCESS" && verified;

  const confirmation: PaymentConfirmation = {
    id: uid(),
    paymentId: tx.paymentId,
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider,
    providerStatus: result.status,
    providerTransactionId: result.providerTransactionId,
    confirmationReference: result.confirmationReference,
    providerResponse: result.raw,
    amount: result.amount ?? tx.amount,
    currency: tx.currency,
    verified,
    verifiedAt: verified ? timestamp : undefined,
    createdAt: timestamp,
  };
  await pharmaDb.paymentConfirmations.add(confirmation);

  const updates: Partial<PaymentTransaction> = {
    status: confirmed ? "SUCCESS" : status,
    providerTransactionId:
      result.providerTransactionId ?? tx.providerTransactionId,
    providerConfirmation:
      result.confirmationReference ?? tx.providerConfirmation,
    updatedAt: timestamp,
  };
  if (confirmed) {
    updates.confirmedAt = timestamp;
    updates.verifiedAt = timestamp;
    updates.completedAt = timestamp;
    updates.failureReason = undefined;
  } else {
    updates.completedAt = timestamp;
    updates.failureReason = failureText(result.raw, status);
  }
  await pharmaDb.paymentTransactions.update(transactionId, updates);

  await recordEvent({
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider,
    eventType: "WEBHOOK",
    status: result.status,
    raw: result.raw,
    receivedAt: timestamp,
  });

  return {
    transactionId,
    confirmation,
    transactionStatus: confirmed ? "SUCCESS" : status,
    verified,
  };
}

function failureText(raw: string, status: PaymentStatus): string {
  try {
    const parsed = JSON.parse(raw) as { message?: string; note?: string };
    if (parsed.message) return parsed.message;
    if (parsed.note === "unknown_to_server")
      return "The payment never reached the provider, so no money was taken.";
  } catch {
    /* not JSON */
  }
  return `Payment ${status.toLowerCase()}.`;
}

/**
 * Marks a payment the cashier stopped waiting for as EXPIRED.
 * A late approval is still picked up if someone re-checks the payment later
 * (Payments page > re-check), because the server keeps asking the provider.
 */
export async function expirePayment(transactionId: string): Promise<void> {
  const tx = await pharmaDb.paymentTransactions.get(transactionId);
  if (!tx || isFinalPaymentStatus(tx.status)) return;
  const timestamp = now();
  await pharmaDb.paymentTransactions.update(transactionId, {
    status: "EXPIRED",
    completedAt: timestamp,
    failureReason: "No confirmation was received in time.",
    updatedAt: timestamp,
  });
  await recordEvent({
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider ?? tx.method,
    eventType: "STATUS_POLL",
    status: "EXPIRED",
    raw: "client_wait_expired",
    receivedAt: timestamp,
  });
}

export async function pollPayment(
  transactionId: string,
): Promise<PaymentStatus> {
  const result = await receiveProviderConfirmation(transactionId);
  return result.transactionStatus;
}

export async function cancelPayment(
  transactionId: string,
  actorId?: string,
): Promise<PaymentStatus> {
  const tx = await pharmaDb.paymentTransactions.get(transactionId);
  if (!tx) throw new Error("Payment transaction not found.");
  if (isFinalPaymentStatus(tx.status)) return tx.status;

  const timestamp = now();
  await pharmaDb.paymentTransactions.update(transactionId, {
    status: "CANCELLED",
    completedAt: timestamp,
    failureReason: "Cancelled by cashier.",
    updatedAt: timestamp,
  });

  await pharmaDb.paymentConfirmations.add({
    id: uid(),
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider ?? tx.method,
    providerStatus: "CANCELLED",
    verified: true,
    verifiedAt: timestamp,
    providerResponse: `cancelled by=${actorId ?? "N/A"}`,
    amount: tx.amount,
    currency: tx.currency,
    createdAt: timestamp,
  });

  await recordEvent({
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider ?? tx.method,
    eventType: "WEBHOOK",
    status: "CANCELLED",
    raw: `cancelled by=${actorId ?? "N/A"}`,
    receivedAt: timestamp,
  });

  return "CANCELLED";
}

export async function confirmBankTransfer(
  transactionId: string,
  confirmed: boolean,
  actorId?: string,
): Promise<PaymentStatus> {
  const tx = await pharmaDb.paymentTransactions.get(transactionId);
  if (!tx) throw new Error("Payment transaction not found.");
  if (tx.provider !== "BANK_TRANSFER") {
    throw new Error("Only bank transfer transactions can be manually verified.");
  }
  if (isFinalPaymentStatus(tx.status)) {
    return tx.status;
  }

  if (confirmed) {
    // With a payments server the bank payment is confirmed by the provider,
    // never by a button press.
    const gateway = await getGatewayConfig("BANK_TRANSFER");
    const demo = gateway?.config?.["demoMode"] === "true";
    if (!demo && (await loadPaymentsServerConfig())) {
      throw new Error(
        "Bank payments are confirmed automatically by the provider. Please wait for the confirmation.",
      );
    }
  }

  const status: PaymentStatus = confirmed ? "SUCCESS" : "FAILED";
  const timestamp = now();
  await pharmaDb.paymentTransactions.update(transactionId, {
    status,
    confirmedAt: confirmed ? timestamp : undefined,
    verifiedAt: timestamp,
    completedAt: timestamp,
    failureReason: confirmed
      ? undefined
      : "Bank deposit could not be verified.",
    updatedAt: timestamp,
  });

  await pharmaDb.paymentConfirmations.add({
    id: uid(),
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider,
    providerStatus: confirmed ? "SUCCESS" : "FAILED",
    providerTransactionId: tx.providerReference,
    confirmationReference: tx.providerReference,
    providerResponse: `manualVerification confirmed=${confirmed} by=${actorId ?? "N/A"}`,
    verified: true,
    verifiedAt: timestamp,
    amount: tx.amount,
    currency: tx.currency,
    createdAt: timestamp,
  });

  await recordEvent({
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider,
    eventType: "WEBHOOK",
    status,
    raw: `manualVerification confirmed=${confirmed} by=${actorId ?? "N/A"}`,
    receivedAt: timestamp,
  });

  return status;
}

export async function markPaypalCompleted(
  transactionId: string,
): Promise<PaymentStatus> {
  const tx = await pharmaDb.paymentTransactions.get(transactionId);
  if (!tx) throw new Error("Payment transaction not found.");
  if (tx.provider !== "PAYPAL") {
    throw new Error("Only PayPal transactions can be marked complete by callback.");
  }
  const paypal = await getGatewayConfig("PAYPAL");
  if (paypal?.config?.["demoMode"] !== "true") {
    throw new Error(
      "PayPal payments are confirmed automatically by PayPal. They cannot be marked paid by hand.",
    );
  }
  const status: PaymentStatus = "SUCCESS";
  const timestamp = now();
  await pharmaDb.paymentTransactions.update(transactionId, {
    status,
    confirmedAt: timestamp,
    verifiedAt: timestamp,
    completedAt: timestamp,
    failureReason: undefined,
    updatedAt: timestamp,
  });

  await pharmaDb.paymentConfirmations.add({
    id: uid(),
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider,
    providerStatus: "SUCCESS",
    providerTransactionId: tx.providerReference,
    confirmationReference: tx.providerReference,
    providerResponse: "paypalCallback approved=1 (demo mode)",
    verified: true,
    verifiedAt: timestamp,
    amount: tx.amount,
    currency: tx.currency,
    createdAt: timestamp,
  });

  await recordEvent({
    transactionId,
    saleId: tx.saleId,
    provider: tx.provider,
    eventType: "CALLBACK",
    status,
    raw: "paypalCallback approved=1",
    receivedAt: timestamp,
  });
  return status;
}

export interface PaymentRecordInput {
  saleId: string;
  method: PaymentMethod;
  provider?: string;
  providerReference?: string;
  amount: number;
  currency: string;
  status?: PaymentStatus;
  note?: string;
  recordedBy?: string;
  transactionId?: string;
  paymentReference?: string;
  confirmationId?: string;
}

export async function createPaymentRecord(
  input: PaymentRecordInput,
): Promise<Payment> {
  const timestamp = now();
  const status = input.status ?? "SUCCESS";
  const provider =
    input.provider ?? (isGatewayMethod(input.method) ? providerForMethod(input.method) : undefined);

  const existingTx = input.transactionId
    ? await pharmaDb.paymentTransactions.get(input.transactionId)
    : undefined;
  const paymentReference =
    input.paymentReference ??
    existingTx?.paymentReference ??
    (await nextPaymentReference());

  const payment: Payment = {
    id: uid(),
    saleId: input.saleId,
    method: input.method,
    provider,
    providerReference: input.providerReference,
    paymentReference,
    transactionId: existingTx?.id,
    confirmationId: input.confirmationId,
    providerTransactionId: existingTx?.providerTransactionId,
    amount: round2(input.amount),
    currency: input.currency,
    status,
    initiatedAt: existingTx?.initiatedAt ?? timestamp,
    completedAt: status === "SUCCESS" ? timestamp : undefined,
    failureReason: undefined,
    note: input.note,
    recordedBy: input.recordedBy,
    createdAt: timestamp,
  };

  await pharmaDb.payments.add(payment);

  if (existingTx) {
    const updates: Partial<PaymentTransaction> = {
      paymentId: payment.id,
      saleId: input.saleId,
      direction: "COLLECTION",
      provider,
      providerReference:
        input.providerReference ?? existingTx.providerReference,
      paymentReference,
      status,
      updatedAt: timestamp,
    };
    if (!existingTx.completedAt && status === "SUCCESS") {
      updates.completedAt = timestamp;
    }
    if (status === "SUCCESS") {
      updates.failureReason = undefined;
    }
    await pharmaDb.paymentTransactions.update(existingTx.id, updates);
    await pharmaDb.paymentConfirmations
      .where("transactionId")
      .equals(existingTx.id)
      .modify({ paymentId: payment.id, saleId: input.saleId });
  } else {
    await pharmaDb.paymentTransactions.add({
      id: uid(),
      paymentId: payment.id,
      saleId: input.saleId,
      method: input.method,
      provider,
      direction: "COLLECTION",
      amount: payment.amount,
      currency: input.currency,
      customerReference: undefined,
      providerReference: input.providerReference,
      paymentReference,
      status,
      initiatedAt: timestamp,
      completedAt: status === "SUCCESS" ? timestamp : undefined,
      failureReason: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await recordEvent({
    transactionId: existingTx?.id ?? payment.id,
    saleId: input.saleId,
    provider: provider ?? input.method,
    eventType: "REQUEST",
    status,
    raw: `recordedPayment method=${input.method} amount=${payment.amount} ref=${paymentReference}`,
    receivedAt: timestamp,
  });

  return payment;
}

export async function refundPayment(
  paymentId: string,
  actorId?: string,
  reason?: string,
): Promise<void> {
  const payment = await pharmaDb.payments.get(paymentId);
  if (!payment) throw new Error("Payment not found.");
  if (payment.status !== "SUCCESS") {
    throw new Error("Only successful payments can be refunded.");
  }

  const timestamp = now();
  const refundTxId = uid();
  const paymentReference = await nextPaymentReference();

  await recordEvent({
    transactionId: payment.id,
    saleId: payment.saleId,
    provider: payment.provider ?? payment.method,
    eventType: "WEBHOOK",
    status: "SUCCESS",
    raw: `refundInitiated amount=${payment.amount} reason=${reason ?? "N/A"} by=${actorId ?? "N/A"}`,
    receivedAt: timestamp,
  });

  await pharmaDb.payments.update(paymentId, {
    status: "REFUNDED",
    note: payment.note
      ? `${payment.note} [REFUNDED]`
      : "[REFUNDED]",
  });

  await pharmaDb.paymentTransactions.add({
    id: refundTxId,
    paymentId,
    saleId: payment.saleId,
    method: payment.method,
    provider: payment.provider,
    direction: "REFUND",
    amount: payment.amount,
    currency: payment.currency,
    customerReference: undefined,
    providerReference: payment.providerReference
      ? `REF-${payment.providerReference}`
      : undefined,
    paymentReference,
    status: "SUCCESS",
    initiatedAt: timestamp,
    completedAt: timestamp,
    failureReason: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
