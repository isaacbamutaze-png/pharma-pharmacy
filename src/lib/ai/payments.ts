import { round2 } from "../sales";
import { addDaysISO } from "../stock";
import { formatMoney } from "../utils";
import type { AssistantContext } from "../assistant";
import type {
  PaymentIntelPending,
  PaymentIntelTransaction,
  PaymentIntelligence,
} from "../../types";

const FAILED_STATUSES = new Set([
  "FAILED",
  "DECLINED",
  "CANCELLED",
  "TIMEOUT",
  "EXPIRED",
]);

function cleanFailureReason(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t);
      const pick = o.message ?? o.error ?? o.description ?? o.status;
      if (typeof pick === "string" && pick) return pick;
      if (o.reference) return `reference ${o.reference}`;
    } catch {
      /* not JSON — fall through */
    }
  }
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

function needsExternalConfirmation(method: string): boolean {
  return method.trim().toUpperCase() !== "CASH";
}

export function buildPaymentIntelligence(
  ctx: AssistantContext,
): PaymentIntelligence {
  const pendingSales: PaymentIntelPending[] = [];
  let pendingTotal = 0;
  for (const s of ctx.sales) {
    if (s.status === "PENDING_PAYMENT" && s.paymentStatus !== "SUCCESS") {
      pendingSales.push({
        saleId: s.id,
        invoiceNumber: s.invoiceNumber,
        total: s.total,
        method: s.paymentMethod,
        customerName: s.customerName,
      });
      pendingTotal += s.total;
    }
  }
  pendingSales.sort((a, b) => b.total - a.total);

  const cutoff = Date.now() - 30 * 86400000;
  const failedRecent: PaymentIntelTransaction[] = [];
  for (const t of ctx.paymentTransactions) {
    if (t.createdAt < cutoff) continue;
    if (!FAILED_STATUSES.has(t.status)) continue;
    failedRecent.push({
      method: t.method,
      provider: t.provider,
      amount: t.amount,
      status: t.status,
      reason: cleanFailureReason(t.failureReason),
      saleId: t.saleId,
    });
  }
  failedRecent.sort((a, b) => b.amount - a.amount);

  const confirmedPaymentIds = new Set(
    ctx.paymentConfirmations
      .filter((c) => c.verified)
      .map((c) => c.paymentId)
      .filter((id): id is string => Boolean(id)),
  );
  const confirmedTransactionIds = new Set(
    ctx.paymentConfirmations.filter((c) => c.verified).map((c) => c.transactionId),
  );
  const unmatched: PaymentIntelTransaction[] = [];
  for (const p of ctx.payments) {
    if (p.status !== "SUCCESS") continue;
    if (!needsExternalConfirmation(p.method)) continue;
    const hasConfirm =
      (p.confirmationId != null && p.confirmationId.length > 0) ||
      (p.transactionId ? confirmedTransactionIds.has(p.transactionId) : false) ||
      (p.id ? confirmedPaymentIds.has(p.id) : false);
    if (hasConfirm) continue;
    unmatched.push({
      method: p.method,
      provider: p.provider,
      amount: p.amount,
      status: p.status,
      saleId: p.saleId,
    });
  }

  const refundCutoff = addDaysISO(-29);
  const refunds30 = ctx.refunds.filter((r) => r.saleDateKey >= refundCutoff);
  const refunds30Total = round2(
    refunds30.reduce((sum, r) => sum + r.amount, 0),
  );

  const notes: string[] = [];
  const m = (v: number) => formatMoney(v, ctx.currency);
  if (pendingSales.length > 0) {
    notes.push(
      `${pendingSales.length} sale(s) await payment confirmation totalling ${m(pendingTotal)} — confirm on the Payments page.`,
    );
  }
  if (unmatched.length > 0) {
    notes.push(
      `${unmatched.length} SUCCESS payment(s) have no provider confirmation record — reconciliation review recommended.`,
    );
  }
  if (failedRecent.length > 0) {
    notes.push(
      `${failedRecent.length} failed/declined transaction(s) in the last 30 days — follow up with customers.`,
    );
  }
  if (refunds30.length > 0) {
    notes.push(
      `${refunds30.length} refund(s) in the last 30 days totalling ${m(refunds30Total)}.`,
    );
  }
  if (notes.length === 0) {
    notes.push(
      "No pending, failed or unmatched payment activity — the payment gateway remains the source of truth for confirmations.",
    );
  }

  return {
    pendingSales,
    pendingTotal: round2(pendingTotal),
    failedRecent,
    failedCount: failedRecent.length,
    unmatched,
    refunds30Count: refunds30.length,
    refunds30Total,
    notes,
  };
}
