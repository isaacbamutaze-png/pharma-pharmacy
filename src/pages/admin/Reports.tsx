import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3 } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { SelectInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  BarChart,
  GroupedBars,
  HorizontalBars,
  PieChart,
} from "../../components/charts/Charts";
import { formatMoney } from "../../lib/utils";
import {
  todayISO,
  addDaysISO,
  daysUntil,
  formatISO,
} from "../../lib/stock";
import { round2 } from "../../lib/sales";
import {
  computePeriodStats,
  periodThreshold,
} from "../../lib/finance";
import { PAYMENT_METHODS } from "../../lib/payments/constants";

type Tab = "OVERVIEW" | "TREND" | "PRODUCTS" | "EXPIRY";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "OVERVIEW", label: "Overview" },
  { id: "TREND", label: "Sales Trend" },
  { id: "PRODUCTS", label: "Top Products" },
  { id: "EXPIRY", label: "Expiry Outlook" },
];

function dayLabel(isoKey: string): string {
  const [, m, d] = isoKey.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

export function ReportsPage() {
  const sales = useLiveQuery(() => pharmaDb.sales.toArray(), []) ?? [];
  const saleItems = useLiveQuery(() => pharmaDb.saleItems.toArray(), []) ?? [];
  const expenses = useLiveQuery(() => pharmaDb.expenses.toArray(), []) ?? [];
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const refunds = useLiveQuery(() => pharmaDb.refunds.toArray(), []) ?? [];
  const refundItems = useLiveQuery(() => pharmaDb.refundItems.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";
  const warningDays = Number(
    settings.find((s) => s.settingKey === "expiry_warning_days")?.settingValue ?? "60",
  );

  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [period, setPeriod] = useState("MONTH");

  const threshold = periodThreshold(period);
  const medicineMap = useMemo(
    () => new Map(medicines.map((m) => [m.id, m])),
    [medicines],
  );

  const itemsBySale = useMemo(() => {
    const map = new Map<string, typeof saleItems>();
    for (const item of saleItems) {
      const list = map.get(item.saleId);
      if (list) list.push(item);
      else map.set(item.saleId, [item]);
    }
    return map;
  }, [saleItems]);

  const stats = useMemo(
    () => computePeriodStats(sales, saleItems, expenses, refunds, refundItems, threshold),
    [sales, saleItems, expenses, refunds, refundItems, threshold],
  );

  const methodBars = useMemo(
    () =>
      PAYMENT_METHODS.map((m) => ({
        label: m.label,
        value: round2(stats.revenueByMethod[m.value]),
        color: m.color,
      })).filter((d) => d.value > 0),
    [stats],
  );

  const last7 = useMemo(() => {
    const labels: string[] = [];
    const revenue: number[] = [];
    const profit: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const key = addDaysISO(-i);
      const daySales = sales.filter(
        (s) => s.saleDateKey === key && s.status === "COMPLETED",
      );
      let rev = 0;
      let prof = 0;
      for (const s of daySales) {
        rev += s.total;
        for (const item of itemsBySale.get(s.id) ?? []) {
          prof += (item.unitPrice - item.costPrice) * item.quantity;
        }
      }
      labels.push(dayLabel(key));
      revenue.push(round2(rev));
      profit.push(round2(prof));
    }
    return labels.map((label, i) => ({ label, values: [revenue[i], profit[i]] }));
  }, [sales, itemsBySale]);

  const trend30 = useMemo(() => {
    const labels: string[] = [];
    const revenue: number[] = [];
    for (let i = 29; i >= 0; i--) {
      const key = addDaysISO(-i);
      const rev = sales
        .filter((s) => s.saleDateKey === key && s.status === "COMPLETED")
        .reduce((sum, s) => sum + s.total, 0);
      labels.push(dayLabel(key));
      revenue.push(round2(rev));
    }
    return labels.map((label, i) => ({ label, value: revenue[i] }));
  }, [sales]);

  const peakDay = useMemo(() => {
    let peak = trend30[0];
    for (const d of trend30) {
      if (d.value > peak.value) peak = d;
    }
    return peak.label;
  }, [trend30]);

  const topProducts = useMemo(() => {
    const map = new Map<
      string,
      { units: number; revenue: number; cogs: number }
    >();
    const completed = sales.filter(
      (s) => (!threshold || s.saleDateKey >= threshold) && s.status === "COMPLETED",
    );
    for (const s of completed) {
      for (const item of itemsBySale.get(s.id) ?? []) {
        const cur = map.get(item.medicineId) ?? { units: 0, revenue: 0, cogs: 0 };
        cur.units += item.quantity;
        cur.revenue += item.lineTotal;
        cur.cogs += item.costPrice * item.quantity;
        map.set(item.medicineId, cur);
      }
    }
    return [...map.entries()]
      .map(([medicineId, v]) => ({
        medicineId,
        name: medicineMap.get(medicineId)?.name ?? "Unknown",
        ...v,
      }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 10);
  }, [sales, saleItems, medicineMap, threshold, itemsBySale]);

  const expiry = useMemo(() => {
    const today = todayISO();
    const now = new Date();
    const monthBuckets = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return {
        key,
        label: `${d.toLocaleString("en-UG", { month: "short" })} ${String(
          d.getFullYear(),
        ).slice(2)}`,
        units: 0,
        value: 0,
      };
    });

    const expiringList: typeof batches = [];
    const expiredList: typeof batches = [];
    let expiredValue = 0;

    for (const b of batches) {
      if (b.quantityRemaining <= 0) continue;
      if (b.expiryDate < today) {
        expiredList.push(b);
        expiredValue += b.quantityRemaining * b.purchasePrice;
        continue;
      }
      const bucket = monthBuckets.find((m) => b.expiryDate.startsWith(m.key));
      if (bucket) {
        bucket.units += b.quantityRemaining;
        bucket.value += b.quantityRemaining * b.purchasePrice;
      }
      if (daysUntil(b.expiryDate) <= warningDays) {
        expiringList.push(b);
      }
    }

    expiringList.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    expiringList.sort(
      (a, b) =>
        daysUntil(a.expiryDate) - daysUntil(b.expiryDate),
    );

    return {
      monthBuckets,
      expiringList,
      expiredList,
      expiredValue: round2(expiredValue),
    };
  }, [batches, warningDays]);

  const periodLabel =
    period === "TODAY"
      ? "today"
      : period === "WEEK"
        ? "the last 7 days"
        : period === "MONTH"
          ? "this month"
          : "all time";

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Business insights and performance"
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {(tab === "OVERVIEW" || tab === "PRODUCTS") && (
          <SelectInput
            label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="lg:w-44"
          >
            <option value="TODAY">Today</option>
            <option value="WEEK">Last 7 days</option>
            <option value="MONTH">This month</option>
            <option value="ALL">All time</option>
          </SelectInput>
        )}
      </div>

      {tab === "OVERVIEW" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="!p-4">
              <p className="text-xs font-medium text-slate-500">Revenue ({periodLabel})</p>
              <p className="mt-1 text-xl font-bold text-pharma-700">
                {formatMoney(stats.revenue, currency)}
              </p>
            </Card>
            <Card className="!p-4">
              <p className="text-xs font-medium text-slate-500">Gross Profit</p>
              <p className="mt-1 text-xl font-bold text-green-600">
                {formatMoney(stats.grossProfit, currency)}
              </p>
            </Card>
            <Card className="!p-4">
              <p className="text-xs font-medium text-slate-500">Sales</p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {stats.saleCount}
              </p>
            </Card>
            <Card className="!p-4">
              <p className="text-xs font-medium text-slate-500">Net Profit</p>
              <p
                className={`mt-1 text-xl font-bold ${
                  stats.netProfit >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatMoney(stats.netProfit, currency)}
              </p>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Revenue by Payment Method" subtitle={`${periodLabel}`}>
              {methodBars.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  No sales in this period.
                </p>
              ) : (
                <PieChart
                  data={methodBars}
                  format={(v) => formatMoney(v, currency)}
                  centerLabel="Revenue"
                />
              )}
            </Card>

            <Card title="Last 7 Days" subtitle="Daily revenue vs gross profit">
              <GroupedBars
                data={last7}
                colors={["#0f766e", "#2563eb"]}
                seriesNames={["Revenue", "Profit"]}
                format={(v) => formatMoney(v, currency)}
              />
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#0f766e]" />
                  Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
                  Gross profit
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "TREND" && (
        <Card title="Daily Revenue" subtitle="Last 30 days">
          <BarChart
            data={trend30}
            format={(v) => formatMoney(v, currency)}
            tickEvery={3}
            height={240}
          />
          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 text-sm">
            <span className="text-slate-600">Total (30 days)</span>
            <span className="font-semibold text-slate-900">
              {formatMoney(
                round2(trend30.reduce((sum, d) => sum + d.value, 0)),
                currency,
              )}
            </span>
            <span className="text-slate-500">
              Peak day: {peakDay}
            </span>
          </div>
        </Card>
      )}

      {tab === "PRODUCTS" && (
        <div className="space-y-6">
          <Card title="Top Products by Units Sold" subtitle={`${periodLabel}`}>
            {topProducts.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No product sales in this period.
              </p>
            ) : (
              <HorizontalBars
                data={topProducts.map((p) => ({
                  label: p.name,
                  value: p.units,
                }))}
                format={(v) => `${v} units`}
              />
            )}
          </Card>

          {topProducts.length > 0 && (
            <Card title="Product Revenue & Profit" subtitle="Top 10 by units sold">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 font-medium">Units</th>
                      <th className="px-3 py-2 font-medium">Revenue</th>
                      <th className="px-3 py-2 font-medium">Cost</th>
                      <th className="px-3 py-2 font-medium">Gross Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {topProducts.map((p) => (
                      <tr key={p.medicineId} className="hover:bg-slate-50">
                        <td className="px-3 py-3 font-medium text-slate-800">
                          {p.name}
                        </td>
                        <td className="px-3 py-3 text-slate-600">{p.units}</td>
                        <td className="px-3 py-3 text-slate-600">
                          {formatMoney(p.revenue, currency)}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {formatMoney(p.cogs, currency)}
                        </td>
                        <td className="px-3 py-3 font-semibold text-green-600">
                          {formatMoney(round2(p.revenue - p.cogs), currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "EXPIRY" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="!p-4">
              <p className="text-xs font-medium text-slate-500">Expired (write off)</p>
              <p className="mt-1 text-xl font-bold text-red-600">
                {formatMoney(expiry.expiredValue, currency)}
              </p>
              <p className="text-xs text-slate-400">{expiry.expiredList.length} batches</p>
            </Card>
            <Card className="!p-4">
              <p className="text-xs font-medium text-slate-500">
                Expiring Within {warningDays} Days
              </p>
              <p className="mt-1 text-xl font-bold text-amber-600">
                {expiry.expiringList.length} batches
              </p>
            </Card>
            <Card className="!p-4">
              <p className="text-xs font-medium text-slate-500">
                Stock Expiring in 6 Months
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {expiry.monthBuckets.reduce((sum, m) => sum + m.units, 0)} units
              </p>
            </Card>
          </div>

          <Card title="Units Expiring per Month" subtitle="Next 6 months">
            <BarChart
              data={expiry.monthBuckets.map((m) => ({
                label: m.label,
                value: m.units,
              }))}
              format={(v) => `${v} units`}
              height={200}
            />
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Expiring Soon" subtitle={`Within ${warningDays} days`}>
              {expiry.expiringList.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  No batches expiring soon.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {expiry.expiringList.slice(0, 20).map((b) => (
                    <li key={b.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {medicineMap.get(b.medicineId)?.name ?? "Unknown"}
                        </p>
                        <p className="text-xs text-slate-400">
                          Batch {b.batchNumber} • {b.quantityRemaining} units
                        </p>
                      </div>
                      <Badge tone="amber">
                        {formatISO(b.expiryDate)} ({daysUntil(b.expiryDate)}d)
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Already Expired" subtitle="Remove from inventory via Batches">
              {expiry.expiredList.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  No expired batches in stock.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {expiry.expiredList.slice(0, 20).map((b) => (
                    <li key={b.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {medicineMap.get(b.medicineId)?.name ?? "Unknown"}
                        </p>
                        <p className="text-xs text-slate-400">
                          Batch {b.batchNumber} • {b.quantityRemaining} units
                        </p>
                      </div>
                      <Badge tone="red">{formatISO(b.expiryDate)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <BarChart3 size={16} className="text-slate-400" />
          Reports are based on completed sales, batch costs, and recorded expenses.
        </span>
      </div>
    </div>
  );
}
