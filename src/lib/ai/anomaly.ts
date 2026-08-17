import { addDaysISO, todayISO } from "../stock";
import type { AssistantContext } from "../assistant";
import type { AnomalyItem } from "../../types";

const OFF_HOURS_START = 7; // 07:00
const OFF_HOURS_END = 21; // 21:00

interface Builder {
  items: AnomalyItem[];
  push(
    category: string,
    severity: AnomalyItem["severity"],
    title: string,
    detail: string,
    recommendation: string,
  ): void;
}

function createBuilder(): Builder {
  return {
    items: [],
    push(category, severity, title, detail, recommendation) {
      this.items.push({ category, severity, title, detail, recommendation });
    },
  };
}

function hourOf(ts: number): number {
  return new Date(ts).getHours();
}

function isoHourOf(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-UG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildAnomalyDetection(ctx: AssistantContext): AnomalyItem[] {
  const b = createBuilder();
  const now = Date.now();
  const day = 86400000;
  const today = todayISO();

  /* ── Inventory adjustments ─────────────────────────────────────────── */
  const adj30 = ctx.stockMovements.filter(
    (sm) =>
      sm.movementType === "ADJUSTMENT" && sm.createdAt >= now - 30 * day,
  );
  if (adj30.length >= 3) {
    const magnitudes = adj30.map((sm) => Math.abs(sm.quantity)).sort((a, c) => a - c);
    const median = magnitudes[Math.floor(magnitudes.length / 2)] ?? 0;
    for (const sm of adj30) {
      const mag = Math.abs(sm.quantity);
      const reason = sm.reason || "manual adjustment";
      if (mag > Math.max(3 * median, 200)) {
        b.push(
          "INVENTORY",
          "HIGH",
          `Unusual stock adjustment: ${mag} unit(s)`,
          `A ${sm.movementType.toLowerCase()} of ${mag} units was recorded (typical adjustments around ${median}). ${reason}.`,
          "Review this adjustment in Stock Movements and the audit trail before accepting it.",
        );
      } else if (mag > Math.max(1.5 * median, 50)) {
        b.push(
          "INVENTORY",
          "MEDIUM",
          `Above-normal stock adjustment: ${mag} unit(s)`,
          `An adjustment of ${mag} units is above the usual range (median ${median}). ${reason}.`,
          "Confirm the reason for this adjustment is documented.",
        );
      }
    }
  }

  /* ── Sales volume deviation ────────────────────────────────────────── */
  const dayCount = new Map<string, number>();
  for (const s of ctx.sales) {
    if (s.status !== "COMPLETED") continue;
    if (s.saleDateKey < addDaysISO(-29)) continue;
    dayCount.set(s.saleDateKey, (dayCount.get(s.saleDateKey) ?? 0) + 1);
  }
  const counts = [...dayCount.values()];
  const mean =
    counts.length > 0 ? counts.reduce((sum, c) => sum + c, 0) / counts.length : 0;
  if (mean >= 3) {
    for (let d = 6; d >= 0; d--) {
      const key = addDaysISO(-d);
      const c = dayCount.get(key) ?? 0;
      if (c < mean * 0.3) {
        b.push(
          "SALES",
          "MEDIUM",
          `Unusually low sales on ${key}`,
          `${c} completed sale(s) on ${key}, well below the 30-day average of ${Math.round(mean * 10) / 10} per day.`,
          "Check for system, stock or staffing issues that day before assuming anything unusual.",
        );
      } else if (c > mean * 3 && c >= 3) {
        b.push(
          "SALES",
          "MEDIUM",
          `Unusual sales spike on ${key}`,
          `${c} completed sale(s) on ${key}, well above the 30-day average of ${Math.round(mean * 10) / 10}.`,
          "A spike may be legitimate (promotion or bulk order) — verify with the cashier records.",
        );
      }
    }
  }

  /* ── Refund activity ───────────────────────────────────────────────── */
  const refund30 = ctx.refunds.filter((r) => r.saleDateKey >= addDaysISO(-29));
  const refundPrev = ctx.refunds.filter(
    (r) =>
      r.saleDateKey < addDaysISO(-29) && r.saleDateKey >= addDaysISO(-59),
  );
  if (refund30.length >= 3 && refund30.length > refundPrev.length * 2) {
    b.push(
      "REFUNDS",
      refund30.length > refundPrev.length * 3 ? "HIGH" : "MEDIUM",
      `Unusual refund activity`,
      `${refund30.length} refund(s) in the last 30 days vs ${refundPrev.length} in the prior 30 days.`,
      "Review the refund register; every refund should have a recorded reason and cashier.",
    );
  }

  /* ── Payment failure spike ─────────────────────────────────────────── */
  const failed = ctx.paymentTransactions.filter((t) =>
    ["FAILED", "DECLINED", "TIMEOUT", "EXPIRED"].includes(t.status),
  );
  const failed7 = failed.filter((t) => t.createdAt >= now - 7 * day);
  const failed30 = failed.filter((t) => t.createdAt >= now - 30 * day);
  if (failed7.length >= 3 && failed7.length > (failed30.length / 30) * 7 * 2) {
    b.push(
      "PAYMENTS",
      "MEDIUM",
      "Payment failure spike",
      `${failed7.length} failed/declined transaction(s) in the last 7 days, about twice the recent average.`,
      "Check gateway status and follow up with affected customers; the gateway stays the source of truth.",
    );
  }

  /* ── Audit trail: off-hours + destructive volume ───────────────────── */
  const audit7 = ctx.auditLogs.filter((a) => a.createdAt >= now - 7 * day);
  const offHoursAudit = audit7.filter(
    (a) => hourOf(a.createdAt) < OFF_HOURS_START || hourOf(a.createdAt) >= OFF_HOURS_END,
  );
  if (offHoursAudit.length >= 3) {
    b.push(
      "AUDIT",
      "MEDIUM",
      `${offHoursAudit.length} audit action(s) outside normal working hours this week`,
      `${offHoursAudit.length} of the last 7 days' actions (total ${audit7.length}) were recorded outside ${OFF_HOURS_START}:00–${OFF_HOURS_END}:00 (e.g. first at ${isoHourOf(offHoursAudit[0].createdAt)}).`,
      "Inspect the audit trail and confirm the recorded users were on shift.",
    );
  }
  const deletes7 = audit7.filter((a) => a.action === "DELETE").length;
  if (deletes7 >= 5) {
    b.push(
      "AUDIT",
      "LOW",
      `${deletes7} deletions recorded this week`,
      "A high deletion volume is worth a quick review.",
      "Cross-check deletions against the audit trail before investigating further.",
    );
  }

  /* ── Out-of-stock of a top seller ──────────────────────────────────── */
  const units30 = new Map<string, number>();
  const saleIds = new Set(
    ctx.sales
      .filter(
        (s) => s.status === "COMPLETED" && s.saleDateKey >= addDaysISO(-29),
      )
      .map((s) => s.id),
  );
  for (const item of ctx.saleItems) {
    if (!saleIds.has(item.saleId)) continue;
    units30.set(item.medicineId, (units30.get(item.medicineId) ?? 0) + item.quantity);
  }
  const stockByMedicine = new Map<string, number>();
  for (const batch of ctx.batches) {
    if (batch.quantityRemaining > 0 && batch.expiryDate >= today) {
      stockByMedicine.set(
        batch.medicineId,
        (stockByMedicine.get(batch.medicineId) ?? 0) + batch.quantityRemaining,
      );
    }
  }
  const top30 = [...units30.entries()].sort((a, c) => c[1] - a[1]).slice(0, 5);
  const medNames = new Map(ctx.medicines.map((m) => [m.id, m.name]));
  for (const [id, units] of top30) {
    if (units >= 10 && (stockByMedicine.get(id) ?? 0) === 0) {
      b.push(
        "INVENTORY",
        "HIGH",
        `${medNames.get(id) ?? "A medicine"} sold out despite strong demand`,
        `${units} unit(s) sold in the last 30 days and the medicine is now completely out of stock.`,
        "Reorder immediately; this is a revenue risk, not a fraud flag.",
      );
    }
  }

  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return b.items.sort(
    (a, c) => rank[a.severity] - rank[c.severity] || a.title.localeCompare(c.title),
  );
}
