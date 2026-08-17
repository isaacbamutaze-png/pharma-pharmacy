import { round2 } from "../sales";
import { todayISO } from "../stock";
import type { AssistantContext } from "../assistant";
import type { ForecastItem, ForecastOutcome } from "../../types";

export const FORECAST_HORIZON_DAYS = 30;
export const MAX_FORECAST_ITEMS = 10;

function unitsInWindow(
  ctx: AssistantContext,
  fromTs: number,
  toTs: number,
): Map<string, number> {
  const saleIds = new Set<string>();
  for (const s of ctx.sales) {
    if (s.status === "COMPLETED" && s.saleDate >= fromTs && s.saleDate < toTs) {
      saleIds.add(s.id);
    }
  }
  const map = new Map<string, number>();
  for (const item of ctx.saleItems) {
    if (!saleIds.has(item.saleId)) continue;
    map.set(item.medicineId, (map.get(item.medicineId) ?? 0) + item.quantity);
  }
  return map;
}

export function buildForecast(ctx: AssistantContext): ForecastOutcome {
  const now = Date.now();
  const day = 86400000;
  const recent = unitsInWindow(ctx, now - FORECAST_HORIZON_DAYS * day, now);
  const mid = unitsInWindow(
    ctx,
    now - 2 * FORECAST_HORIZON_DAYS * day,
    now - FORECAST_HORIZON_DAYS * day,
  );
  const old = unitsInWindow(
    ctx,
    now - 3 * FORECAST_HORIZON_DAYS * day,
    now - 2 * FORECAST_HORIZON_DAYS * day,
  );

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

  const items: ForecastItem[] = [];
  let predictedRevenue30 = 0;
  for (const med of ctx.medicines) {
    if (med.status !== "ACTIVE") continue;
    const u1 = recent.get(med.id) ?? 0;
    const u2 = mid.get(med.id) ?? 0;
    const u3 = old.get(med.id) ?? 0;
    const predicted30 = Math.round(u1 * 0.5 + u2 * 0.3 + u3 * 0.2);
    const dailyAvg = round2(u1 / FORECAST_HORIZON_DAYS);
    const stock = stockByMedicine.get(med.id) ?? 0;
    const daysToStockout =
      dailyAvg > 0 && stock > 0 ? Math.floor(stock / dailyAvg) : null;
    const stockoutRisk =
      stock < predicted30 ||
      (daysToStockout !== null && daysToStockout <= FORECAST_HORIZON_DAYS);
    if (u1 === 0 && stock === 0) continue;

    let trend: ForecastItem["trend"];
    if (u1 === 0 && u2 === 0) trend = "NO_DATA";
    else if (u2 === 0) trend = "RISING";
    else if (u1 >= u2 * 1.2) trend = "RISING";
    else if (u1 <= u2 * 0.8) trend = "FALLING";
    else trend = "STABLE";

    items.push({
      medicineId: med.id,
      medicineName: med.name,
      unitsLast30: u1,
      dailyAvg,
      trend,
      predicted30,
      currentStock: stock,
      stockoutRisk,
      daysToStockout,
    });
    predictedRevenue30 += predicted30 * med.sellingPrice;
  }

  items.sort((a, b) => {
    if (a.stockoutRisk !== b.stockoutRisk) return a.stockoutRisk ? -1 : 1;
    return b.predicted30 - a.predicted30;
  });

  return {
    horizonDays: FORECAST_HORIZON_DAYS,
    method:
      "30-day weighted moving average of your sales history (recency-weighted), with a recent-vs-prior trend check",
    items: items.slice(0, MAX_FORECAST_ITEMS),
    predictedRevenue30: round2(predictedRevenue30),
  };
}
