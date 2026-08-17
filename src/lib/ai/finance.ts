import { round2 } from "../sales";
import { todayISO } from "../stock";
import { formatMoney } from "../utils";
import type { AssistantContext } from "../assistant";
import type {
  FinanceAnalysis,
  FinanceInsight,
  FinanceProductDelta,
} from "../../types";

function monthKey(offset: number): string {
  const [y, m] = todayISO().split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface MonthBundle {
  revenue: number;
  cogs: number;
  count: number;
  unitsByMedicine: Map<string, number>;
}

function bundleMonth(
  ctx: AssistantContext,
  key: string,
): MonthBundle {
  const completed = ctx.sales.filter(
    (s) => s.status === "COMPLETED" && s.saleDateKey.startsWith(key),
  );
  const itemsBySale = new Map<string, string[]>();
  for (const item of ctx.saleItems) {
    const list = itemsBySale.get(item.saleId);
    if (list) list.push(item.id);
    else itemsBySale.set(item.saleId, [item.id]);
  }
  const itemById = new Map(ctx.saleItems.map((i) => [i.id, i]));

  let revenue = 0;
  let cogs = 0;
  const unitsByMedicine = new Map<string, number>();
  for (const s of completed) {
    revenue += s.total;
    for (const itemId of itemsBySale.get(s.id) ?? []) {
      const item = itemById.get(itemId);
      if (!item) continue;
      cogs += item.costPrice * item.quantity;
      unitsByMedicine.set(
        item.medicineId,
        (unitsByMedicine.get(item.medicineId) ?? 0) + item.quantity,
      );
    }
  }
  const monthRefundIds = new Set<string>();
  let refundTotal = 0;
  let refundCogs = 0;
  for (const r of ctx.refunds) {
    if (!r.saleDateKey.startsWith(key)) continue;
    monthRefundIds.add(r.id);
    refundTotal += r.amount;
  }
  for (const ri of ctx.refundItems) {
    if (monthRefundIds.has(ri.refundId)) refundCogs += ri.costPrice * ri.quantity;
  }
  return {
    revenue: round2(revenue - refundTotal),
    cogs: round2(cogs - refundCogs),
    count: completed.length,
    unitsByMedicine,
  };
}

export function buildFinanceAnalysis(ctx: AssistantContext): FinanceAnalysis {
  const month = monthKey(0);
  const prevMonth = monthKey(-1);

  const cur = bundleMonth(ctx, month);
  const prev = bundleMonth(ctx, prevMonth);

  const expenses = round2(
    ctx.expenses
      .filter((e) => e.expenseDateKey.startsWith(month))
      .reduce((sum, e) => sum + e.amount, 0),
  );
  const grossProfit = round2(cur.revenue - cur.cogs);
  const netProfit = round2(grossProfit - expenses);
  const revenueDeltaPct =
    prev.revenue > 0
      ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 100)
      : null;

  const names = new Map(ctx.medicines.map((m) => [m.id, m.name]));
  const union = new Set([...cur.unitsByMedicine.keys(), ...prev.unitsByMedicine.keys()]);
  const topProductsDelta: FinanceProductDelta[] = [];
  for (const id of union) {
    const unitsThis = cur.unitsByMedicine.get(id) ?? 0;
    const unitsPrev = prev.unitsByMedicine.get(id) ?? 0;
    if (unitsThis === 0 && unitsPrev === 0) continue;
    topProductsDelta.push({
      name: names.get(id) ?? "Unknown",
      unitsThis,
      unitsPrev,
      deltaPct: unitsPrev > 0 ? Math.round(((unitsThis - unitsPrev) / unitsPrev) * 100) : null,
    });
  }
  topProductsDelta.sort((a, b) => b.unitsThis - a.unitsThis);

  const today = todayISO();
  const stockByMedicine = new Map<string, number>();
  for (const b of ctx.batches) {
    if (b.quantityRemaining > 0 && b.expiryDate >= today) {
      stockByMedicine.set(
        b.medicineId,
        (stockByMedicine.get(b.medicineId) ?? 0) + b.quantityRemaining,
      );
    }
  }
  const prevTopByUnits = [...prev.unitsByMedicine.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const stockoutsHurt: string[] = [];
  for (const [id, units] of prevTopByUnits) {
    if (units > 0 && (stockByMedicine.get(id) ?? 0) === 0) {
      stockoutsHurt.push(`${names.get(id) ?? "Unknown"} (${units} units last month)`);
    }
  }

  const explanation: string[] = [];
  const insights: FinanceInsight[] = [];
  const m = (v: number) => formatMoney(v, ctx.currency);

  if (revenueDeltaPct === null) {
    explanation.push(
      `Revenue this month is ${m(cur.revenue)} with no comparable month before it.`,
    );
    insights.push({
      tone: "neutral",
      text: "No prior-month baseline yet — this month establishes the comparison base.",
    });
  } else if (revenueDeltaPct > 0) {
    explanation.push(
      `Revenue is up ${revenueDeltaPct}% this month (${m(cur.revenue)} vs ${m(prev.revenue)} last month).`,
    );
    insights.push({ tone: "good", text: `Revenue grew ${revenueDeltaPct}% month on month.` });
  } else if (revenueDeltaPct < 0) {
    explanation.push(
      `Revenue is down ${Math.abs(revenueDeltaPct)}% this month (${m(cur.revenue)} vs ${m(prev.revenue)} last month).`,
    );
    insights.push({
      tone: "bad",
      text: `Revenue fell ${Math.abs(revenueDeltaPct)}% — review the product changes below.`,
    });
  }

  const drops = topProductsDelta.filter(
    (p) => p.deltaPct !== null && p.deltaPct < -25 && p.unitsPrev >= 5,
  );
  const rises = topProductsDelta.filter(
    (p) => p.deltaPct !== null && p.deltaPct > 25 && p.unitsThis >= 5,
  );
  if (drops.length > 0) {
    explanation.push(
      `Biggest unit declines: ${drops.slice(0, 4).map((p) => `${p.name} (${p.deltaPct}%)`).join(", ")}.`,
    );
  }
  if (rises.length > 0) {
    explanation.push(
      `Biggest unit gains: ${rises.slice(0, 4).map((p) => `${p.name} (+${p.deltaPct}%)`).join(", ")}.`,
    );
  }
  if (stockoutsHurt.length > 0) {
    explanation.push(
      `Some last-month best sellers are now out of stock: ${stockoutsHurt.slice(0, 4).join(", ")}. Restocking them early is likely to protect revenue.`,
    );
    insights.push({
      tone: "bad",
      text: `${stockoutsHurt.length} former top seller(s) are out of stock — reorder promptly.`,
    });
  }
  explanation.push(
    `Gross profit this month is ${m(grossProfit)} (${cur.count} sale(s), average ${m(cur.count > 0 ? cur.revenue / cur.count : 0)} per sale); expenses ${m(expenses)} leave a net of ${m(netProfit)}.`,
  );
  insights.push({ tone: "neutral", text: `Margin: gross ${m(grossProfit)} / net ${m(netProfit)}.` });

  return {
    month,
    prevMonth,
    monthRevenue: cur.revenue,
    prevRevenue: prev.revenue,
    revenueDeltaPct,
    grossProfit,
    netProfit,
    expenses,
    saleCount: cur.count,
    avgSale: cur.count > 0 ? round2(cur.revenue / cur.count) : 0,
    topProductsDelta,
    stockoutsHurt,
    explanation,
    insights,
  };
}
