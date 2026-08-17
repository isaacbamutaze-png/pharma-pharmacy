import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Pill,
  ShoppingCart,
  CheckCircle2,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { useAuthStore } from "../../store/authStore";
import { todayISO, daysUntil, formatISO } from "../../lib/stock";
import { formatDateTime } from "../../lib/utils";

const QUICK_ACTIONS = [
  {
    to: "/pos",
    title: "New Sale",
    desc: "Open the Point of Sale and start billing",
    icon: ShoppingCart,
    color: "bg-pharma-600 text-white",
  },
  {
    to: "/medicines",
    title: "Check Stock",
    desc: "Search medicines and available quantity",
    icon: Pill,
    color: "bg-blue-600 text-white",
  },
  {
    to: "/alerts",
    title: "Alerts",
    desc: "Low-stock and expiry notices",
    icon: Bell,
    color: "bg-amber-500 text-white",
  },
];

function hourGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function UserDashboard() {
  const { user } = useAuthStore();
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const sales =
    useLiveQuery(
      () => pharmaDb.sales.orderBy("createdAt").reverse().limit(50).toArray(),
      [],
    ) ?? [];
  const saleItems = useLiveQuery(() => pharmaDb.saleItems.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const warningDays = Number(
    settings.find((s) => s.settingKey === "expiry_warning_days")?.settingValue ?? "60",
  );
  const today = todayISO();

  const active = medicines.filter((m) => m.status === "ACTIVE");

  const stockByMedicine = new Map<string, number>();
  for (const b of batches) {
    if (b.quantityRemaining > 0 && b.expiryDate >= today) {
      stockByMedicine.set(
        b.medicineId,
        (stockByMedicine.get(b.medicineId) ?? 0) + b.quantityRemaining,
      );
    }
  }

  const inStock = active.filter((m) => (stockByMedicine.get(m.id) ?? 0) > 0).length;

  const lowStock = active
    .filter((m) => {
      const qty = stockByMedicine.get(m.id) ?? 0;
      return qty === 0 || (m.reorderLevel > 0 && qty <= m.reorderLevel);
    })
    .map((m) => ({ medicine: m, qty: stockByMedicine.get(m.id) ?? 0 }))
    .sort((a, b) => a.qty - b.qty)
    .slice(0, 6);

  const expiringSoon = batches.filter(
    (b) =>
      b.quantityRemaining > 0 &&
      b.expiryDate >= today &&
      daysUntil(b.expiryDate) <= warningDays,
  );

  const todaySales = sales.filter(
    (s) => s.saleDateKey === today && s.status === "COMPLETED",
  );

  const pendingSales = sales.filter(
    (s) => s.status === "PENDING_PAYMENT" && s.paymentStatus !== "SUCCESS",
  );
  const pendingTotal = pendingSales.reduce((sum, s) => sum + s.total, 0);
  const inProcessToday =
    pendingSales.filter((s) => s.saleDateKey === today).length +
    todaySales.length;

  const mySales = sales
    .filter((s) => s.status === "COMPLETED" && user && s.cashierId === user.id)
    .slice(0, 6);

  const itemCountBySale = new Map<string, number>();
  for (const item of saleItems) {
    itemCountBySale.set(item.saleId, (itemCountBySale.get(item.saleId) ?? 0) + item.quantity);
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-pharma-700 to-pharma-600 p-6 text-white shadow-sm">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-pharma-100">
              {hourGreeting()},{" "}
              <span className="font-semibold text-white">
                {user?.fullName?.split(" ")[0] ?? "Pharmacist"}
              </span>
            </p>
            <h2 className="mt-1 text-2xl font-bold leading-tight">
              Ready to serve your customers?
            </h2>
            <p className="mt-1 text-sm text-pharma-100">
              You've handled{" "}
              <span className="font-semibold text-white">{todaySales.length}</span>{" "}
              sale{todaySales.length === 1 ? "" : "s"} so far today.
            </p>
          </div>
          <Link
            to="/pos"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-pharma-700 shadow-sm transition-colors hover:bg-pharma-50"
          >
            <ShoppingCart size={18} />
            Start a Sale
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Medicines In Stock</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{inStock}</p>
          <p className="mt-1 text-xs text-slate-500">
            of {active.length} registered with quantity available
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Sales Today</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {todaySales.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">Completed transactions</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Stock Alerts</p>
          <p className="mt-2 text-2xl font-bold text-amber-600">{lowStock.length}</p>
          <p className="mt-1 text-xs text-slate-500">
            Low or out-of-stock medicines
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Expiring Soon</p>
          <p className="mt-2 text-2xl font-bold text-amber-600">
            {expiringSoon.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">Within {warningDays} days</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-medium text-emerald-700">
            Confirmed Sales (Today)
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-800">
            {todaySales.length}
          </p>
          <p className="mt-1 text-xs text-emerald-600">
            Provider-confirmed only
          </p>
        </div>
        <Link
          to="/payments"
          className="block rounded-xl border border-amber-200 bg-amber-50 p-5 transition-colors hover:border-amber-300"
        >
          <p className="text-sm font-medium text-amber-700">Pending Payments</p>
          <p className="mt-2 text-2xl font-bold text-amber-800">
            {pendingSales.length}
          </p>
          <p className="mt-1 text-xs text-amber-600">
            {pendingTotal} awaiting provider confirmation
          </p>
        </Link>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-sm font-medium text-blue-700">
            Sales In Process (Today)
          </p>
          <p className="mt-2 text-2xl font-bold text-blue-800">
            {inProcessToday}
          </p>
          <p className="mt-1 text-xs text-blue-600">
            Pending drafts + confirmed sales
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-pharma-300 hover:bg-pharma-50/40"
          >
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${a.color}`}
            >
              <a.icon size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">{a.title}</p>
              <p className="truncate text-xs text-slate-500">{a.desc}</p>
            </div>
            <ArrowRight
              size={16}
              className="shrink-0 text-slate-300 transition-colors group-hover:text-pharma-600"
            />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Stock Alerts" subtitle="Flagged for attention">
          {lowStock.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No low-stock medicines right now.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lowStock.map(({ medicine, qty }) => (
                <li
                  key={medicine.id}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {medicine.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      Reorder level {medicine.reorderLevel}
                    </p>
                  </div>
                  <Badge tone={qty === 0 ? "red" : "amber"}>
                    {qty === 0 ? "Out" : `${qty} left`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Expiry Notices" subtitle={`Within ${warningDays} days`}>
          {expiringSoon.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No batches expiring soon.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {expiringSoon.slice(0, 6).map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {medicines.find((m) => m.id === b.medicineId)?.name ??
                        "Unknown"}
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

        <Card title="My Recent Sales" subtitle="Transactions you processed">
          {mySales.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No sales yet. Open the Point of Sale to start billing.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {mySales.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium text-slate-800">
                      {s.invoiceNumber}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {s.customerName || "Walk-in"} •{" "}
                      {itemCountBySale.get(s.id) ?? 0} item(s)
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {formatDateTime(s.saleDate)}
                    </p>
                  </div>
                  <Badge tone="green">Done</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        <CheckCircle2 size={16} />
        <span>
          Stock reduces automatically after every sale using First-Expiry-First-Out
          (FEFO). No manual stock changes needed.
        </span>
      </div>
    </div>
  );
}
