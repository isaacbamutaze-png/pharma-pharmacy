import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Scale, TrendingUp, Coins, Package, Users, CheckCircle2, AlertTriangle } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { SelectInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatMoney, formatDate } from "../../lib/utils";
import { todayISO } from "../../lib/stock";
import { computePeriodStats, getCustomerBalance, periodThreshold } from "../../lib/finance";
import { round2 } from "../../lib/sales";
import { PAYMENT_METHODS } from "../../lib/payments/constants";

export function BalancingPage() {
  const sales = useLiveQuery(() => pharmaDb.sales.toArray(), []) ?? [];
  const saleItems = useLiveQuery(() => pharmaDb.saleItems.toArray(), []) ?? [];
  const expenses = useLiveQuery(() => pharmaDb.expenses.toArray(), []) ?? [];
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const customers = useLiveQuery(() => pharmaDb.customers.toArray(), []) ?? [];
  const payments = useLiveQuery(() => pharmaDb.customerPayments.toArray(), []) ?? [];
  const salePayments = useLiveQuery(() => pharmaDb.payments.toArray(), []) ?? [];
  const refunds = useLiveQuery(() => pharmaDb.refunds.toArray(), []) ?? [];
  const refundItems = useLiveQuery(() => pharmaDb.refundItems.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const [period, setPeriod] = useState("TODAY");
  const threshold = periodThreshold(period);

  const stats = useMemo(
    () => computePeriodStats(sales, saleItems, expenses, refunds, refundItems, threshold),
    [sales, saleItems, expenses, refunds, refundItems, threshold],
  );

  const stock = useMemo(() => {
    const today = todayISO();
    let cost = 0;
    let sale = 0;
    let expiredCost = 0;
    let sellableUnits = 0;
    for (const b of batches) {
      if (b.quantityRemaining <= 0) continue;
      if (b.expiryDate < today) {
        expiredCost += b.quantityRemaining * b.purchasePrice;
        continue;
      }
      cost += b.quantityRemaining * b.purchasePrice;
      sale += b.quantityRemaining * b.sellingPrice;
      sellableUnits += b.quantityRemaining;
    }
    return {
      cost: round2(cost),
      sale: round2(sale),
      expiredCost: round2(expiredCost),
      sellableUnits,
    };
  }, [batches]);

  const receivables = useMemo(() => {
    return customers
      .map((c) => ({
        customer: c,
        balance: getCustomerBalance(c.id, sales, payments),
      }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }, [customers, sales, payments]);

  const totalReceivables = round2(
    receivables.reduce((sum, r) => sum + r.balance, 0),
  );

  const reconciliation = useMemo(() => {
    const thresholdMs = threshold
      ? new Date(`${threshold}T00:00:00`).getTime()
      : 0;
    const collected: Record<string, number> = {};
    let collectedTotal = 0;
    for (const p of salePayments) {
      if (p.status !== "SUCCESS") continue;
      if (p.createdAt < thresholdMs) continue;
      collected[p.method] = (collected[p.method] ?? 0) + p.amount;
      collectedTotal += p.amount;
    }
    const expectedTotal = round2(
      Object.values(stats.revenueByMethod).reduce((sum, v) => sum + v, 0),
    );
    const rows = PAYMENT_METHODS.map((m) => {
      const expected = round2(stats.revenueByMethod[m.value] ?? 0);
      const got = round2(collected[m.value] ?? 0);
      return {
        method: m.value,
        label: m.label,
        expected,
        collected: got,
        difference: round2(got - expected),
      };
    });
    const balanced = round2(collectedTotal - expectedTotal) === 0;
    return { rows, expectedTotal, collectedTotal: round2(collectedTotal), balanced };
  }, [salePayments, stats.revenueByMethod, threshold]);

  const periodLabel =
    period === "TODAY"
      ? "Today"
      : period === "WEEK"
        ? "Last 7 days"
        : period === "MONTH"
          ? "This month"
          : "All time";

  return (
    <div>
      <PageHeader
        title="Book Balancing"
        subtitle="Financial position and profit statement"
      />

      <div className="mb-4">
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
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Revenue ({periodLabel})</p>
          <p className="mt-1 text-xl font-bold text-pharma-700">
            {formatMoney(stats.revenue, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Cost of Goods Sold</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            -{formatMoney(stats.cogs, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Gross Profit</p>
          <p className="mt-1 text-xl font-bold text-green-600">
            {formatMoney(stats.grossProfit, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Expenses</p>
          <p className="mt-1 text-xl font-bold text-red-600">
            -{formatMoney(stats.expenses, currency)}
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
        <Card title="Profit Statement" subtitle={`For ${periodLabel.toLowerCase()}`}>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-700">
              <span>Sales revenue</span>
              <span className="font-medium">
                {formatMoney(stats.revenue, currency)}
              </span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span>Cost of goods sold ({stats.saleCount} sales)</span>
              <span className="font-medium">
                -{formatMoney(stats.cogs, currency)}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold text-slate-900">
              <span>Gross profit</span>
              <span>{formatMoney(stats.grossProfit, currency)}</span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span>Operating expenses</span>
              <span className="font-medium">
                -{formatMoney(stats.expenses, currency)}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
              <span className="text-slate-900">Net profit</span>
              <span
                className={
                  stats.netProfit >= 0 ? "text-green-600" : "text-red-600"
                }
              >
                {formatMoney(stats.netProfit, currency)}
              </span>
            </div>
            <div className="flex justify-between pt-1 text-xs text-slate-500">
              <span>Average sale</span>
              <span>{formatMoney(stats.avgSale, currency)}</span>
            </div>
          </div>
        </Card>

        <Card title="Revenue by Payment Method" subtitle="How money came in">
          <div className="space-y-3">
            {PAYMENT_METHODS.map((m) => {
              const amount = stats.revenueByMethod[m.value];
              const pct =
                stats.revenue > 0 ? Math.round((amount / stats.revenue) * 100) : 0;
              return (
                <div key={m.value}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{m.label}</span>
                    <span className="font-medium text-slate-900">
                      {formatMoney(amount, currency)}{" "}
                      <span className="text-xs text-slate-400">({pct}%)</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-pharma-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {stats.revenue === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">
                No sales in this period.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Payment Reconciliation"
          subtitle="Compare expected revenue by method with recorded collections"
          className="lg:col-span-2"
          action={
            reconciliation.balanced ? (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 size={14} />
                Balanced
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangle size={14} />
                Review required
              </span>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2 font-medium">Method</th>
                  <th className="py-2 pr-2 text-right font-medium">Expected</th>
                  <th className="py-2 pr-2 text-right font-medium">Collected</th>
                  <th className="py-2 pr-2 text-right font-medium">Difference</th>
                  <th className="py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconciliation.rows.map((row) => {
                  const clean =
                    row.difference === 0 ||
                    (row.method === "CREDIT" && row.expected > 0);
                  return (
                    <tr key={row.method}>
                      <td className="py-2 pr-2 text-slate-800">{row.label}</td>
                      <td className="py-2 pr-2 text-right text-slate-700">
                        {formatMoney(row.expected, currency)}
                      </td>
                      <td className="py-2 pr-2 text-right text-slate-700">
                        {formatMoney(row.collected, currency)}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right font-medium ${
                          row.difference === 0
                            ? "text-slate-400"
                            : row.difference > 0
                              ? "text-green-600"
                              : "text-amber-600"
                        }`}
                      >
                        {row.difference > 0 ? "+" : ""}
                        {formatMoney(row.difference, currency)}
                      </td>
                      <td className="py-2 text-right">
                        {clean ? (
                          <Badge tone="green">OK</Badge>
                        ) : (
                          <Badge tone="amber">Check</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td className="py-2 pr-2 font-semibold text-slate-900">Total</td>
                  <td className="py-2 pr-2 text-right font-semibold text-slate-900">
                    {formatMoney(reconciliation.expectedTotal, currency)}
                  </td>
                  <td className="py-2 pr-2 text-right font-semibold text-slate-900">
                    {formatMoney(reconciliation.collectedTotal, currency)}
                  </td>
                  <td
                    className={`py-2 pr-2 text-right font-semibold ${
                      reconciliation.balanced
                        ? "text-slate-400"
                        : "text-amber-600"
                    }`}
                  >
                    {formatMoney(
                      round2(
                        reconciliation.collectedTotal -
                          reconciliation.expectedTotal,
                      ),
                      currency,
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {reconciliation.balanced ? (
                      <Badge tone="green">Balanced</Badge>
                    ) : (
                      <Badge tone="amber">Reconcile</Badge>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Expected is the net revenue attributed to each method (sales minus
            refunds, offset to the original sale's period). Collected is what the
            Payment Center recorded through{" "}
            <span className="font-mono text-[10px]">payments</span>, including
            refunds as negative collection entries. Differences appear when a sale
            is split across several methods or when credit sales are still
            outstanding (collected as they are repaid).
          </p>
        </Card>

        <Card title="Stock Valuation" subtitle="Current inventory at book value">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 p-4">
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <Package size={14} />
                At cost price
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatMoney(stock.cost, currency)}
              </p>
              <p className="text-xs text-slate-400">{stock.sellableUnits} sellable units</p>
            </div>
            <div className="rounded-lg border border-slate-100 p-4">
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <TrendingUp size={14} />
                At selling price
              </p>
              <p className="mt-1 text-xl font-bold text-pharma-700">
                {formatMoney(stock.sale, currency)}
              </p>
              <p className="text-xs text-slate-400">
                {formatDate(Date.now())}
              </p>
            </div>
          </div>
          {stock.expiredCost > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-red-50 px-4 py-3">
              <span className="text-sm text-red-700">
                Expired stock to be written off
              </span>
              <Badge tone="red">{formatMoney(stock.expiredCost, currency)}</Badge>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">Potential margin at sale</span>
            <span className="text-sm font-semibold text-green-600">
              {formatMoney(stock.sale - stock.cost, currency)}
            </span>
          </div>
        </Card>

        <Card
          title="Receivables"
          subtitle="Credit sales outstanding from customers"
          action={
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <Scale size={14} />
              {formatMoney(totalReceivables, currency)}
            </span>
          }
        >
          {receivables.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No outstanding customer balances.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {receivables.map(({ customer, balance }) => (
                <li
                  key={customer.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      <Users size={14} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {customer.name}
                      </p>
                      {customer.phone && (
                        <p className="text-xs text-slate-400">{customer.phone}</p>
                      )}
                    </div>
                  </div>
                  <Badge tone="amber">{formatMoney(balance, currency)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
            <Coins size={20} className="text-blue-600" />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-800">
              How to reconcile
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Count the cash and mobile money in the register each day and compare
              it with the revenue figures above. Credit revenue is not in the
              till yet — it is receivable from customers. Purchases made in cash
              and expenses reduce the cash on hand. Stock value above reflects
              inventory bought but not yet sold.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
