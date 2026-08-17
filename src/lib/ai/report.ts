import { round2 } from "../sales";
import { todayISO, daysUntil } from "../stock";
import { formatMoney, now } from "../utils";
import { monthStartISO } from "../finance";
import type { AssistantContext } from "../assistant";
import type { ManagementReport, ReportSection } from "../../types";

export const REPORT_MONTHS_LOOKBACK = 90;

function monthsLabel(): string {
  const [y, m] = todayISO().split("-").map(Number);
  return `${new Date(y, m - 1, 1).toLocaleString("en-UG", { month: "long" })} ${y}`;
}

export function buildManagementReport(ctx: AssistantContext): ManagementReport {
  const monthKey = todayISO().slice(0, 7);
  const monthStartISOValue = monthStartISO();
  const m = (v: number) => formatMoney(round2(v), ctx.currency);
  const sections: ReportSection[] = [];

  const completed = ctx.sales.filter(
    (s) => s.status === "COMPLETED" && s.saleDateKey.startsWith(monthKey),
  );
  let revenue = 0;
  let cogs = 0;
  const unitsByMedicine = new Map<string, number>();
  for (const s of completed) {
    revenue += s.total;
    for (const item of ctx.saleItems) {
      if (item.saleId !== s.id) continue;
      cogs += item.costPrice * item.quantity;
      unitsByMedicine.set(
        item.medicineId,
        (unitsByMedicine.get(item.medicineId) ?? 0) + item.quantity,
      );
    }
  }
  revenue = round2(revenue);
  cogs = round2(cogs);
  const grossProfit = round2(revenue - cogs);
  const expenses = round2(
    ctx.expenses
      .filter((e) => e.expenseDateKey.startsWith(monthKey))
      .reduce((sum, e) => sum + e.amount, 0),
  );
  const netProfit = round2(grossProfit - expenses);

  sections.push({
    title: "Revenue & profitability",
    rows: [
      { label: "Revenue", value: m(revenue) },
      { label: "Number of sales", value: String(completed.length) },
      {
        label: "Average transaction value",
        value: m(completed.length ? revenue / completed.length : 0),
      },
      { label: "Gross profit", value: m(grossProfit), tone: grossProfit >= 0 ? "good" : "bad" },
      { label: "Expenses", value: m(expenses) },
      { label: "Net profit", value: m(netProfit), tone: netProfit >= 0 ? "good" : "bad" },
    ],
  });

  const medNames = new Map(ctx.medicines.map((md) => [md.id, md.name]));
  const topProducts = [...unitsByMedicine.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  sections.push({
    title: "Top medicines this month",
    rows:
      topProducts.length > 0
        ? topProducts.map(([id, units]) => ({
            label: medNames.get(id) ?? "Unknown",
            value: `${units} unit(s)`,
          }))
        : [{ label: "No sales", value: "—" }],
  });

  const today = todayISO();
  const stockByMedicine = new Map<string, { qty: number; cost: number; sale: number }>();
  for (const batch of ctx.batches) {
    if (batch.quantityRemaining <= 0 || batch.expiryDate < today) continue;
    const cur = stockByMedicine.get(batch.medicineId) ?? { qty: 0, cost: 0, sale: 0 };
    cur.qty += batch.quantityRemaining;
    cur.cost += batch.quantityRemaining * batch.purchasePrice;
    cur.sale += batch.quantityRemaining * batch.sellingPrice;
    stockByMedicine.set(batch.medicineId, cur);
  }

  const sold90Ids = new Set<string>();
  const cutoff90 = Date.now() - REPORT_MONTHS_LOOKBACK * 86400000;
  for (const s of ctx.sales) {
    if (s.status === "COMPLETED" && s.saleDate >= cutoff90) sold90Ids.add(s.id);
  }
  const units90ByMedicine = new Map<string, number>();
  for (const item of ctx.saleItems) {
    if (!sold90Ids.has(item.saleId)) continue;
    units90ByMedicine.set(
      item.medicineId,
      (units90ByMedicine.get(item.medicineId) ?? 0) + item.quantity,
    );
  }
  const slowMovers = [...stockByMedicine.entries()]
    .filter(([id]) => (units90ByMedicine.get(id) ?? 0) === 0)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5);

  let expiredCount = 0;
  let expiredValue = 0;
  let expiringCount = 0;
  for (const batch of ctx.batches) {
    if (batch.quantityRemaining <= 0) continue;
    if (batch.expiryDate < today) {
      expiredCount += 1;
      expiredValue += batch.quantityRemaining * batch.purchasePrice;
    } else if (daysUntil(batch.expiryDate) <= ctx.warningDays) {
      expiringCount += 1;
    }
  }
  const stockCost = [...stockByMedicine.values()].reduce((sum, s) => sum + s.cost, 0);
  const stockSale = [...stockByMedicine.values()].reduce((sum, s) => sum + s.sale, 0);

  sections.push({
    title: "Stock & expiry",
    rows: [
      { label: "Stock value (selling price)", value: m(stockSale) },
      { label: "Stock value (cost)", value: m(stockCost) },
      {
        label: "Expired batches",
        value: `${expiredCount} batch(es), ${m(expiredValue)}`,
        tone: expiredCount > 0 ? "bad" : "good",
      },
      {
        label: `Expiring within ${ctx.warningDays} days`,
        value: `${expiringCount} batch(es)`,
        tone: expiringCount > 0 ? "bad" : "good",
      },
      {
        label: "Slow movers (no sales in 90 days)",
        value:
          slowMovers.length > 0
            ? slowMovers.map(([id]) => medNames.get(id) ?? "Unknown").join(", ")
            : "None",
      },
    ],
  });

  const monthStartTs = new Date(`${monthStartISOValue}T00:00:00`).getTime();
  const poThisMonth = ctx.purchaseOrders.filter((po) => po.createdAt >= monthStartTs);
  const poItemsByPo = new Map<string, number>();
  for (const poi of ctx.purchaseOrderItems) {
    poItemsByPo.set(
      poi.purchaseOrderId,
      (poItemsByPo.get(poi.purchaseOrderId) ?? 0) + poi.lineTotal,
    );
  }
  const poTotal = round2(
    poThisMonth.reduce((sum, po) => sum + (poItemsByPo.get(po.id) ?? 0), 0),
  );
  sections.push({
    title: "Purchases & expenses",
    rows: [
      { label: "Purchase orders this month", value: `${poThisMonth.length} order(s), ${m(poTotal)}` },
      { label: "Expenses this month", value: m(expenses) },
    ],
  });

  const methodTotals = new Map<string, number>();
  for (const s of completed) {
    methodTotals.set(s.paymentMethod, (methodTotals.get(s.paymentMethod) ?? 0) + s.total);
  }
  const topMethod = [...methodTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const pending = ctx.sales.filter(
    (s) => s.status === "PENDING_PAYMENT" && s.paymentStatus !== "SUCCESS",
  );
  const pendingTotal = round2(pending.reduce((sum, s) => sum + s.total, 0));
  const refundsMonth = ctx.refunds.filter((r) => r.saleDateKey.startsWith(monthKey));
  sections.push({
    title: "Payments",
    rows: [
      topMethod
        ? { label: `Top payment method (${topMethod[0]})`, value: m(topMethod[1]) }
        : { label: "Payment methods", value: "—" },
      {
        label: "Pending confirmations",
        value: `${pending.length} sale(s), ${m(pendingTotal)}`,
        tone: pending.length ? "bad" : "good",
      },
      { label: "Refunds this month", value: `${refundsMonth.length} refund(s)` },
    ],
  });

  sections.push({
    title: "Controlled medicines & compliance",
    rows: [
      {
        label: "CDR medicines",
        value: String(
          ctx.medicines.filter((md) => md.controlCategory === "CDR").length,
        ),
      },
      { label: "Register entries", value: String(ctx.controlledDrugRegister.length) },
      {
        label: "Open count variances",
        value: String(ctx.controlledDrugCounts.filter((c) => c.status === "VARIANCE").length),
        tone: ctx.controlledDrugCounts.some((c) => c.status === "VARIANCE") ? "bad" : "good",
      },
      {
        label: "Open requisitions",
        value: String(ctx.controlRequisitions.filter((r) => r.status === "PENDING").length),
      },
    ],
  });

  let customerBalances = 0;
  for (const customer of ctx.customers) {
    let owed = 0;
    for (const s of ctx.sales) {
      if (s.customerId === customer.id && s.status === "COMPLETED") owed += s.balanceDue;
    }
    let paid = 0;
    for (const p of ctx.customerPayments) {
      if (p.customerId === customer.id) paid += p.amount;
    }
    customerBalances += Math.max(0, owed - paid);
  }
  sections.push({
    title: "Outstanding balances",
    rows: [
      { label: "Pending payment confirmations", value: m(pendingTotal) },
      { label: "Customer account balances", value: m(round2(customerBalances)) },
    ],
  });

  const highlight =
    `Monthly report for ${monthsLabel()} — revenue ${m(revenue)}, gross profit ${m(grossProfit)}, net ${m(netProfit)} across ${completed.length} sale(s)${topProducts.length ? `; top product ${medNames.get(topProducts[0][0]) ?? "—"}` : ""}.`;

  return {
    generatedAt: now(),
    period: monthsLabel(),
    highlight,
    sections,
  };
}
