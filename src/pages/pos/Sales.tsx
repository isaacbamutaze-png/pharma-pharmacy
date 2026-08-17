import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Eye, RotateCcw } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { SelectInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { ReceiptModal } from "../../components/sales/ReceiptModal";
import { formatMoney, formatDateTime, uid, now } from "../../lib/utils";
import { todayISO, addDaysISO } from "../../lib/stock";
import { voidSale } from "../../lib/sales";
import { useAuthStore, isAdmin } from "../../store/authStore";
import { PAYMENT_LABEL, PAYMENT_METHODS } from "../../lib/payments/constants";
import type { Sale } from "../../types";

export function SalesPage() {
  const user = useAuthStore((s) => s.user);
  const sales = useLiveQuery(
    () => pharmaDb.sales.orderBy("createdAt").reverse().limit(500).toArray(),
    [],
  ) ?? [];
  const saleItems = useLiveQuery(() => pharmaDb.saleItems.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const [period, setPeriod] = useState("TODAY");
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [viewing, setViewing] = useState<Sale | null>(null);

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const threshold = useMemo(() => {
    if (period === "TODAY") return todayISO();
    if (period === "WEEK") return addDaysISO(-7);
    return "";
  }, [period]);

  const itemsBySale = useMemo(() => {
    const map = new Map<string, typeof saleItems>();
    for (const item of saleItems) {
      const list = map.get(item.saleId);
      if (list) list.push(item);
      else map.set(item.saleId, [item]);
    }
    return map;
  }, [saleItems]);

  const filtered = sales.filter((s) => {
    const matchesPeriod = !threshold || s.saleDateKey >= threshold;
    const matchesPayment =
      paymentFilter === "ALL" || s.paymentMethod === paymentFilter;
    const matchesStatus = statusFilter === "ALL" || s.status === statusFilter;
    return matchesPeriod && matchesPayment && matchesStatus;
  });

  const stats = useMemo(() => {
    const today = todayISO();
    const daySales = sales.filter((s) => s.saleDateKey === today);
    const completed = daySales.filter((s) => s.status === "COMPLETED");
    const revenue = completed.reduce((sum, s) => sum + s.total, 0);
    let profit = 0;
    for (const s of completed) {
      const items = itemsBySale.get(s.id) ?? [];
      for (const item of items) {
        profit += (item.unitPrice - item.costPrice) * item.quantity;
      }
    }
    const average = completed.length > 0 ? revenue / completed.length : 0;
    return {
      count: completed.length,
      revenue,
      profit,
      average,
    };
  }, [sales, itemsBySale]);

  const handleVoid = async (sale: Sale) => {
    if (!user) return;
    if (!window.confirm(`Void sale ${sale.invoiceNumber} and restore stock?`)) return;
    try {
      await voidSale(sale.id, user.id);
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: user.id,
        action: "SALE_VOID",
        entityType: "sale",
        entityId: sale.id,
        newValues: { invoiceNumber: sale.invoiceNumber },
        createdAt: now(),
      });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to void sale.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle="Sale history and receipts"
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Today's Sales</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{stats.count}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Today's Revenue</p>
          <p className="mt-1 text-xl font-bold text-pharma-700">
            {formatMoney(stats.revenue, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Today's Profit</p>
          <p className="mt-1 text-xl font-bold text-green-600">
            {formatMoney(stats.profit, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Average Sale</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {formatMoney(stats.average, currency)}
          </p>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row">
          <SelectInput
            label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="lg:w-40"
          >
            <option value="TODAY">Today</option>
            <option value="WEEK">Last 7 days</option>
            <option value="ALL">All time</option>
          </SelectInput>
          <SelectInput
            label="Payment"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="lg:w-44"
          >
            <option value="ALL">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="lg:w-40"
          >
            <option value="ALL">All statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="PENDING_PAYMENT">Pending payment</option>
            <option value="VOIDED">Voided</option>
          </SelectInput>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No sales match your filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 font-mono text-xs font-medium text-slate-800">
                      {s.invoiceNumber}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {formatDateTime(s.saleDate)}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {s.customerName || "Walk-in"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone="blue">{PAYMENT_LABEL[s.paymentMethod]}</Badge>
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-900">
                      {formatMoney(s.total, currency)}
                      {s.balanceDue > 0 && (
                        <span className="ml-1 text-xs font-normal text-amber-600">
                          (due {formatMoney(s.balanceDue, currency)})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        tone={
                          s.status === "VOIDED"
                            ? "red"
                            : s.status === "PENDING_PAYMENT"
                              ? "amber"
                              : "green"
                        }
                      >
                        {s.status === "COMPLETED"
                          ? "Completed"
                          : s.status === "PENDING_PAYMENT"
                            ? "Pending Payment"
                            : "Voided"}
                      </Badge>
                      {s.status === "PENDING_PAYMENT" && (
                        <p className="mt-1 text-[11px] text-amber-600">
                          Awaiting provider confirmation
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setViewing(s)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-pharma-600"
                          aria-label="View receipt"
                          title="View receipt"
                        >
                          <Eye size={16} />
                        </button>
                        {isAdmin(user) && s.status === "COMPLETED" && (
                          <button
                            onClick={() => handleVoid(s)}
                            className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
                            aria-label="Void sale"
                            title="Void sale"
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {viewing && (
        <ReceiptModal
          sale={viewing}
          settings={settings}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
