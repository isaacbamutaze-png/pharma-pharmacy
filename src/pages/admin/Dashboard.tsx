import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarClock,
  Eye,
  Flame,
  PackagePlus,
  PackageX,
  Pill,
  Printer,
  Scale,
  ShoppingCart,
  Timer,
  TrendingUp,
  Undo2,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import {
  BarChart,
  GroupedBars,
  HorizontalBars,
  LineChart,
  PieChart,
} from "../../components/charts/Charts";
import { ReceiptModal } from "../../components/sales/ReceiptModal";
import { formatMoney, formatDateTime } from "../../lib/utils";
import { todayISO, addDaysISO, daysUntil, formatISO } from "../../lib/stock";
import { round2 } from "../../lib/sales";
import {
  PAYMENT_METHODS,
  PAYMENT_SHORT,
  emptyMethodTotals,
} from "../../lib/payments/constants";
import type { ExpenseCategory, Sale } from "../../types";

const REV_COLOR = "#2563eb";
const PROF_COLOR = "#16a34a";
const EXP_COLOR = "#ef4444";

const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  SALARIES: "Salaries",
  UTILITIES: "Utilities",
  SUPPLIES: "Supplies",
  EQUIPMENT: "Equipment",
  MAINTENANCE: "Maintenance",
  TRANSPORT: "Transport",
  MARKETING: "Marketing",
  OTHER: "Other",
};

const EXPENSE_ORDER: ExpenseCategory[] = [
  "RENT",
  "SALARIES",
  "UTILITIES",
  "SUPPLIES",
  "EQUIPMENT",
  "MAINTENANCE",
  "TRANSPORT",
  "MARKETING",
  "OTHER",
];

const EXPENSE_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#ec4899",
  "#64748b",
];

function dayShort(isoKey: string): string {
  const [, m, d] = isoKey.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

function monthLabelKey(isoKey: string): string {
  return isoKey.slice(0, 7);
}

function mondayISO(isoKey: string): string {
  const [y, m, d] = isoKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - dow);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function lastDays(n: number, labelFn: (k: string) => string) {
  const arr: Array<{ key: string; label: string }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addDaysISO(-i);
    arr.push({ key, label: labelFn(key) });
  }
  return arr;
}

function lastMonthKeys(n: number) {
  const now = new Date();
  const arr: Array<{ key: string; label: string }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en", { month: "short" }),
    });
  }
  return arr;
}

function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function TrendChip({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-slate-400">no prior day</span>;
  }
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        up ? "text-green-600" : "text-red-600"
      }`}
    >
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(value)}% vs yesterday
    </span>
  );
}

function KpiCard({
  label,
  value,
  icon,
  iconTone,
  sub,
  to,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  iconTone: string;
  sub?: ReactNode;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconTone}`}
        >
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <div className="mt-1.5">{sub}</div>}
    </Link>
  );
}

function AlertCard({
  label,
  count,
  sub,
  icon,
  iconTone,
  badgeTone,
  to,
}: {
  label: string;
  count: number;
  sub: string;
  icon: ReactNode;
  iconTone: string;
  badgeTone: "red" | "amber";
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconTone}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-lg font-bold text-slate-900">{count}</p>
          <Badge tone={badgeTone}>{label}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>
      </div>
    </Link>
  );
}

function MiniStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-slate-100 p-4">
      <div className="flex items-center gap-2">
        <span className={tone}>{icon}</span>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

type RevPeriod = "TODAY" | "DAYS7" | "DAYS30" | "MONTHS3";
type Metric = "REVENUE" | "SALES" | "PROFIT";
type Granularity = "DAILY" | "WEEKLY" | "MONTHLY";

export function AdminDashboard() {
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const categories =
    useLiveQuery(() => pharmaDb.medicineCategories.toArray(), []) ?? [];
  const sales = useLiveQuery(() => pharmaDb.sales.toArray(), []) ?? [];
  const saleItems = useLiveQuery(() => pharmaDb.saleItems.toArray(), []) ?? [];
  const batches =
    useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const expenses = useLiveQuery(() => pharmaDb.expenses.toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];
  const userNames =
    useLiveQuery(
      () =>
        pharmaDb.users.toArray().then((us) =>
          Object.fromEntries(us.map((u) => [u.id, u.fullName])),
        ),
      [],
    ) ?? {};

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";
  const warningDays = Number(
    settings.find((s) => s.settingKey === "expiry_warning_days")?.settingValue ??
      "60",
  );

  const [revPeriod, setRevPeriod] = useState<RevPeriod>("DAYS7");
  const [metric, setMetric] = useState<Metric>("REVENUE");
  const [granularity, setGranularity] = useState<Granularity>("DAILY");
  const [viewSale, setViewSale] = useState<Sale | null>(null);

  const today = todayISO();
  const completed = useMemo(
    () => sales.filter((s) => s.status === "COMPLETED"),
    [sales],
  );
  const pendingSales = useMemo(
    () =>
      sales.filter(
        (s) => s.status === "PENDING_PAYMENT" && s.paymentStatus !== "SUCCESS",
      ),
    [sales],
  );
  const pendingTotal = round2(
    pendingSales.reduce((sum, s) => sum + s.total, 0),
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

  const medicineMap = useMemo(
    () => new Map(medicines.map((m) => [m.id, m])),
    [medicines],
  );
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const yesterday = addDaysISO(-1);
  const todaySales = completed.filter((s) => s.saleDateKey === today);
  const yestSales = completed.filter((s) => s.saleDateKey === yesterday);
  const inProcessToday =
    pendingSales.filter((s) => s.saleDateKey === today).length +
    todaySales.length;

  const profitOf = (list: typeof completed) => {
    let p = 0;
    for (const s of list) {
      for (const item of itemsBySale.get(s.id) ?? []) {
        p += (item.unitPrice - item.costPrice) * item.quantity;
      }
    }
    return round2(p);
  };

  const revenueToday = round2(todaySales.reduce((sum, s) => sum + s.total, 0));
  const revenueYest = round2(yestSales.reduce((sum, s) => sum + s.total, 0));
  const profitToday = profitOf(todaySales);
  const profitYest = profitOf(yestSales);

  const stockValue = useMemo(() => {
    let cost = 0;
    let sale = 0;
    const ids = new Set<string>();
    for (const b of batches) {
      if (b.quantityRemaining <= 0 || b.expiryDate < today) continue;
      cost += b.quantityRemaining * b.purchasePrice;
      sale += b.quantityRemaining * b.sellingPrice;
      ids.add(b.medicineId);
    }
    return { cost: round2(cost), sale: round2(sale), products: ids.size };
  }, [batches, today]);

  const stockByMedicine = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of batches) {
      if (b.quantityRemaining > 0 && b.expiryDate >= today) {
        map.set(
          b.medicineId,
          (map.get(b.medicineId) ?? 0) + b.quantityRemaining,
        );
      }
    }
    return map;
  }, [batches, today]);

  const alertStats = useMemo(() => {
    let low = 0;
    let out = 0;
    const lowList: Array<{ name: string; qty: number; reorderLevel: number }> =
      [];
    for (const m of medicines) {
      if (m.status !== "ACTIVE") continue;
      const qty = stockByMedicine.get(m.id) ?? 0;
      if (qty === 0) out += 1;
      else if (m.reorderLevel > 0 && qty <= m.reorderLevel) {
        low += 1;
        lowList.push({ name: m.name, qty, reorderLevel: m.reorderLevel });
      }
    }
    lowList.sort((a, b) => a.qty - b.qty);
    let expiring = 0;
    let expired = 0;
    const expiringList = batches.filter((b) => {
      if (b.quantityRemaining <= 0) return false;
      if (b.expiryDate < today) {
        expired += 1;
        return false;
      }
      if (daysUntil(b.expiryDate) <= warningDays) {
        expiring += 1;
        return true;
      }
      return false;
    });
    expiringList.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    return { low, out, expiring, expired, lowList, expiringList };
  }, [medicines, batches, stockByMedicine, warningDays, today]);

  const revBuckets = useMemo(() => {
    if (revPeriod === "DAYS30") return lastDays(30, dayShort);
    if (revPeriod === "MONTHS3") return lastMonthKeys(3);
    return lastDays(7, dayShort);
  }, [revPeriod]);

  const revSeries = useMemo(
    () =>
      revBuckets.map((b) => {
        let revenue = 0;
        let sales = 0;
        let profit = 0;
        for (const s of completed) {
          const key =
            revPeriod === "MONTHS3"
              ? monthLabelKey(s.saleDateKey)
              : s.saleDateKey;
          if (key !== b.key) continue;
          sales += 1;
          revenue += s.total;
          for (const item of itemsBySale.get(s.id) ?? []) {
            profit += (item.unitPrice - item.costPrice) * item.quantity;
          }
        }
        return {
          revenue: round2(revenue),
          sales,
          profit: round2(profit),
        };
      }),
    [completed, itemsBySale, revBuckets, revPeriod],
  );

  const metricLabel =
    metric === "REVENUE" ? "Revenue" : metric === "SALES" ? "Sales" : "Profit";
  const lineData = revBuckets.map((b, i) => ({
    label: b.label,
    values: [
      metric === "REVENUE"
        ? revSeries[i].revenue
        : metric === "SALES"
          ? revSeries[i].sales
          : revSeries[i].profit,
    ],
  }));

  const methodTotals = useMemo(() => {
    const totals = emptyMethodTotals();
    const threshold = addDaysISO(-7);
    for (const s of completed) {
      if (s.saleDateKey >= threshold) totals[s.paymentMethod] += s.total;
    }
    return totals;
  }, [completed]);

  const donutData = PAYMENT_METHODS.map((m) => ({
    label: m.shortLabel,
    value: round2(methodTotals[m.value]),
    color: m.color,
  })).filter((d) => d.value > 0);

  const perfBuckets = useMemo(() => {
    const buckets =
      granularity === "WEEKLY"
        ? Array.from({ length: 8 }, (_, i) => {
            const key = mondayISO(addDaysISO(-i * 7));
            return { key, label: dayShort(key) };
          }).reverse()
        : granularity === "MONTHLY"
          ? lastMonthKeys(6)
          : lastDays(14, dayShort);
    return buckets.map((b) => {
      let revenue = 0;
      let profit = 0;
      let discount = 0;
      let count = 0;
      for (const s of completed) {
        const key =
          granularity === "MONTHLY"
            ? monthLabelKey(s.saleDateKey)
            : granularity === "WEEKLY"
              ? mondayISO(s.saleDateKey)
              : s.saleDateKey;
        if (key !== b.key) continue;
        count += 1;
        revenue += s.total;
        discount += s.discount;
        for (const item of itemsBySale.get(s.id) ?? []) {
          profit += (item.unitPrice - item.costPrice) * item.quantity;
        }
      }
      return {
        label: b.label,
        values: [round2(revenue), round2(profit)],
        revenue: round2(revenue),
        discount: round2(discount),
        count,
      };
    });
  }, [completed, itemsBySale, granularity]);

  const perfTotals = useMemo(() => {
    return perfBuckets.reduce(
      (acc, b) => ({
        count: acc.count + b.count,
        revenue: round2(acc.revenue + b.revenue),
        discount: round2(acc.discount + b.discount),
      }),
      { count: 0, revenue: 0, discount: 0 },
    );
  }, [perfBuckets]);

  const formRevenue = useMemo(() => {
    const map = new Map<string, number>();
    const threshold = addDaysISO(-30);
    for (const s of completed) {
      if (s.saleDateKey < threshold) continue;
      for (const item of itemsBySale.get(s.id) ?? []) {
        const med = medicineMap.get(item.medicineId);
        const cat = med
          ? (categoryName.get(med.categoryId) ?? "Other")
          : "Other";
        map.set(cat, (map.get(cat) ?? 0) + item.lineTotal);
      }
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value: round2(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 9);
  }, [completed, itemsBySale, medicineMap, categoryName]);

  const topMedicines = useMemo(() => {
    const map = new Map<
      string,
      { units: number; revenue: number; profit: number }
    >();
    const threshold = addDaysISO(-30);
    for (const s of completed) {
      if (s.saleDateKey < threshold) continue;
      for (const item of itemsBySale.get(s.id) ?? []) {
        const cur = map.get(item.medicineId) ?? {
          units: 0,
          revenue: 0,
          profit: 0,
        };
        cur.units += item.quantity;
        cur.revenue += item.lineTotal;
        cur.profit += (item.unitPrice - item.costPrice) * item.quantity;
        map.set(item.medicineId, cur);
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({
        id,
        name: medicineMap.get(id)?.name ?? "Unknown",
        units: v.units,
        revenue: round2(v.revenue),
        profit: round2(v.profit),
      }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 10);
  }, [completed, itemsBySale, medicineMap]);

  const monthFin = useMemo(
    () =>
      lastMonthKeys(6).map((m) => {
        let revenue = 0;
        for (const s of completed) {
          if (monthLabelKey(s.saleDateKey) === m.key) revenue += s.total;
        }
        const exp = expenses
          .filter((e) => monthLabelKey(e.expenseDateKey) === m.key)
          .reduce((sum, e) => sum + e.amount, 0);
        return { label: m.label, values: [round2(revenue), round2(exp)] };
      }),
    [completed, expenses],
  );

  const expensePie = useMemo(() => {
    const data = EXPENSE_ORDER.map((cat, i) => ({
      label: EXPENSE_LABELS[cat],
      value: round2(
        expenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
      ),
      color: EXPENSE_COLORS[i],
    })).filter((d) => d.value > 0);
    return data;
  }, [expenses]);

  const inventoryAnalytics = useMemo(() => {
    const unitsSold = new Map<string, number>();
    const threshold = addDaysISO(-30);
    for (const s of completed) {
      if (s.saleDateKey < threshold) continue;
      for (const item of itemsBySale.get(s.id) ?? []) {
        unitsSold.set(
          item.medicineId,
          (unitsSold.get(item.medicineId) ?? 0) + item.quantity,
        );
      }
    }
    const sellers = [...unitsSold.entries()].filter(([, u]) => u > 0);
    let fast = 0;
    if (sellers.length > 0) {
      const sorted = sellers.map(([, u]) => u).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      fast = sellers.filter(([, u]) => u >= median).length;
    }
    let slow = 0;
    for (const m of medicines) {
      const qty = stockByMedicine.get(m.id) ?? 0;
      if (qty > 0 && (unitsSold.get(m.id) ?? 0) === 0) slow += 1;
    }
    const fastBars = sellers
      .map(([id, u]) => ({
        name: medicineMap.get(id)?.name ?? "Unknown",
        units: u,
      }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);
    return { fast, slow, fastBars };
  }, [completed, itemsBySale, medicines, stockByMedicine, medicineMap]);

  const expiryBuckets = useMemo(() => {
    const buckets = [
      { label: "Expired", color: "#ef4444", value: 0 },
      { label: "0–30 days", color: "#f97316", value: 0 },
      { label: "31–60 days", color: "#f59e0b", value: 0 },
      { label: "61–90 days", color: "#eab308", value: 0 },
      { label: "90+ days", color: "#10b981", value: 0 },
    ];
    for (const b of batches) {
      if (b.quantityRemaining <= 0) continue;
      const days = daysUntil(b.expiryDate);
      if (days < 0) buckets[0].value += 1;
      else if (days <= 30) buckets[1].value += 1;
      else if (days <= 60) buckets[2].value += 1;
      else if (days <= 90) buckets[3].value += 1;
      else buckets[4].value += 1;
    }
    return buckets;
  }, [batches]);

  const recentSales = [...completed]
    .sort((a, b) => b.saleDate - a.saleDate)
    .slice(0, 8);

  const cashSalesToday = round2(
    todaySales
      .filter((s) => s.paymentMethod === "CASH")
      .reduce((sum, s) => sum + s.amountPaid, 0),
  );
  const expensesToday = round2(
    expenses
      .filter((e) => e.expenseDateKey === today)
      .reduce((sum, e) => sum + e.amount, 0),
  );
  const expectedCash = round2(cashSalesToday - expensesToday);

  const quickActions = [
    { to: "/admin/pos", label: "New Sale", icon: ShoppingCart, color: "bg-blue-600 text-white hover:bg-blue-700" },
    { to: "/admin/medicines", label: "Add Medicine", icon: Pill, color: "bg-emerald-600 text-white hover:bg-emerald-700" },
    { to: "/admin/batches", label: "Receive Stock", icon: PackagePlus, color: "bg-teal-600 text-white hover:bg-teal-700" },
    { to: "/admin/expenses", label: "Add Expense", icon: Wallet, color: "bg-amber-500 text-white hover:bg-amber-600" },
    { to: "/admin/reports", label: "Reports", icon: BarChart3, color: "bg-violet-600 text-white hover:bg-violet-700" },
    { to: "/admin/balancing", label: "Book Balance", icon: Scale, color: "bg-indigo-600 text-white hover:bg-indigo-700" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {quickActions.map((a) => (
          <Link
            key={a.label}
            to={a.to}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium shadow-sm transition-colors ${a.color}`}
          >
            <a.icon size={16} />
            {a.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Today's Revenue"
          value={formatMoney(revenueToday, currency)}
          icon={<Wallet size={20} />}
          iconTone="text-blue-600 bg-blue-50"
          sub={<TrendChip value={deltaPct(revenueToday, revenueYest)} />}
          to="/admin/reports"
        />
        <KpiCard
          label="Today's Sales"
          value={String(todaySales.length)}
          icon={<ShoppingCart size={20} />}
          iconTone="text-cyan-600 bg-cyan-50"
          sub={<TrendChip value={deltaPct(todaySales.length, yestSales.length)} />}
          to="/admin/sales"
        />
        <KpiCard
          label="Today's Gross Profit"
          value={formatMoney(profitToday, currency)}
          icon={<TrendingUp size={20} />}
          iconTone="text-green-600 bg-green-50"
          sub={<TrendChip value={deltaPct(profitToday, profitYest)} />}
          to="/admin/balancing"
        />
        <KpiCard
          label="Current Stock Value"
          value={formatMoney(stockValue.sale, currency)}
          icon={<Boxes size={20} />}
          iconTone="text-indigo-600 bg-indigo-50"
          sub={
            <span className="text-xs text-slate-500">
              {stockValue.products} products at selling price
            </span>
          }
          to="/admin/inventory"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Confirmed Sales (Today)"
          value={String(todaySales.length)}
          icon={<ShoppingCart size={20} />}
          iconTone="text-emerald-600 bg-emerald-50"
          sub={
            <span className="text-xs text-slate-500">
              {formatMoney(revenueToday, currency)} — provider-confirmed only
            </span>
          }
          to="/admin/sales"
        />
        <AlertCard
          label="Pending Payments"
          count={pendingSales.length}
          sub={`${formatMoney(pendingTotal, currency)} awaiting provider confirmation`}
          icon={<Timer size={20} />}
          iconTone="text-amber-600 bg-amber-50"
          badgeTone="amber"
          to="/admin/payments"
        />
        <KpiCard
          label="Sales In Process (Today)"
          value={String(inProcessToday)}
          icon={<CalendarClock size={20} />}
          iconTone="text-blue-600 bg-blue-50"
          sub={
            <span className="text-xs text-slate-500">
              Pending drafts + confirmed sales
            </span>
          }
          to="/admin/payments"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AlertCard
          label="Low Stock"
          count={alertStats.low}
          sub="Medicines below reorder level"
          icon={<PackageX size={20} />}
          iconTone="text-amber-600 bg-amber-50"
          badgeTone="amber"
          to="/admin/inventory"
        />
        <AlertCard
          label="Out of Stock"
          count={alertStats.out}
          sub="Medicines unavailable"
          icon={<AlertTriangle size={20} />}
          iconTone="text-red-600 bg-red-50"
          badgeTone="red"
          to="/admin/inventory"
        />
        <AlertCard
          label="Expiring Soon"
          count={alertStats.expiring}
          sub={`Expiring within ${warningDays} days`}
          icon={<CalendarClock size={20} />}
          iconTone="text-orange-600 bg-orange-50"
          badgeTone="amber"
          to="/admin/batches"
        />
        <AlertCard
          label="Expired"
          count={alertStats.expired}
          sub="Require immediate attention"
          icon={<Timer size={20} />}
          iconTone="text-red-600 bg-red-50"
          badgeTone="red"
          to="/admin/batches"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          title="Revenue Overview"
          subtitle="Generated from completed sales"
          className="lg:col-span-2"
          action={
            <div className="flex flex-wrap items-center gap-1">
              <div className="flex rounded-lg bg-slate-100 p-0.5">
                {(["TODAY", "DAYS7", "DAYS30", "MONTHS3"] as RevPeriod[]).map(
                  (p) => (
                    <button
                      key={p}
                      onClick={() => setRevPeriod(p)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        revPeriod === p
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {p === "TODAY"
                        ? "Today"
                        : p === "DAYS7"
                          ? "7D"
                          : p === "DAYS30"
                            ? "30D"
                            : "3M"}
                    </button>
                  ),
                )}
              </div>
              <div className="flex rounded-lg bg-slate-100 p-0.5">
                {(["REVENUE", "SALES", "PROFIT"] as Metric[]).map((mt) => (
                  <button
                    key={mt}
                    onClick={() => setMetric(mt)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                      metric === mt
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {mt.toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <LineChart
            data={lineData}
            colors={[REV_COLOR]}
            seriesNames={[metricLabel]}
            format={(v) => formatMoney(v, currency)}
            tickEvery={revPeriod === "DAYS30" ? 4 : revPeriod === "MONTHS3" ? 1 : 2}
            height={260}
          />
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
            {metricLabel} ({revPeriod === "MONTHS3" ? "monthly" : "daily"})
          </div>
        </Card>

        <Card title="Payment Methods" subtitle="Revenue split, last 7 days">
          {donutData.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No sales recorded yet.
            </p>
          ) : (
            <PieChart
              data={donutData}
              format={(v) => formatMoney(v, currency)}
              centerLabel="Revenue"
            />
          )}
        </Card>
      </div>

      <Card
        title="Sales Performance"
        subtitle="Revenue vs gross profit"
        action={
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {(["DAILY", "WEEKLY", "MONTHLY"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  granularity === g
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {g.toLowerCase()}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MiniStat
            label="Sales"
            value={String(perfTotals.count)}
            icon={<ShoppingCart size={15} className="text-blue-600" />}
            tone="text-blue-600"
          />
          <MiniStat
            label="Revenue"
            value={formatMoney(perfTotals.revenue, currency)}
            icon={<Wallet size={15} className="text-blue-600" />}
            tone="text-blue-600"
          />
          <MiniStat
            label="Avg Transaction"
            value={formatMoney(
              perfTotals.count > 0 ? perfTotals.revenue / perfTotals.count : 0,
              currency,
            )}
            icon={<TrendingUp size={15} className="text-green-600" />}
            tone="text-green-600"
          />
          <MiniStat
            label="Discounts"
            value={formatMoney(perfTotals.discount, currency)}
            icon={<ArrowDownRight size={15} className="text-amber-600" />}
            tone="text-amber-600"
          />
          <MiniStat
            label="Returns"
            value="0"
            icon={<Undo2 size={15} className="text-slate-400" />}
            tone="text-slate-400"
          />
        </div>
        <GroupedBars
          data={perfBuckets.map((b) => ({ label: b.label, values: b.values }))}
          colors={[REV_COLOR, PROF_COLOR]}
          seriesNames={["Revenue", "Profit"]}
          format={(v) => formatMoney(v, currency)}
          tickEvery={granularity === "DAILY" ? 2 : 1}
          height={200}
        />
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
            Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#16a34a]" />
            Gross profit
          </span>
          <span className="ml-auto">
            {granularity === "DAILY"
              ? "Last 14 days"
              : granularity === "WEEKLY"
                ? "Last 8 weeks"
                : "Last 6 months"}
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Sales by Medicine Form" subtitle="Revenue, last 30 days">
          {formRevenue.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No sales in this period.
            </p>
          ) : (
            <HorizontalBars
              data={formRevenue.map((f) => ({ label: f.label, value: f.value }))}
              format={(v) => formatMoney(v, currency)}
            />
          )}
        </Card>

        <Card
          title="Top Medicines"
          subtitle="Units sold, last 30 days"
          className="lg:col-span-2"
          action={
            <Link
              to="/admin/reports"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              View full report
            </Link>
          }
        >
          {topMedicines.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No product sales yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Medicine</th>
                    <th className="px-3 py-2 text-right font-medium">Units</th>
                    <th className="px-3 py-2 text-right font-medium">Revenue</th>
                    <th className="px-3 py-2 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topMedicines.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        {m.name}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600">
                        {m.units}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-600">
                        {formatMoney(m.revenue, currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-green-600">
                        {formatMoney(m.profit, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          title="Revenue vs Expenses"
          subtitle="Last 6 months"
          className="lg:col-span-2"
        >
          <GroupedBars
            data={monthFin}
            colors={[REV_COLOR, EXP_COLOR]}
            seriesNames={["Revenue", "Expenses"]}
            format={(v) => formatMoney(v, currency)}
            height={210}
          />
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
              Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#ef4444]" />
              Expenses
            </span>
          </div>
        </Card>

        <Card title="Expense Distribution" subtitle="By category">
          {expensePie.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No expenses recorded yet.
            </p>
          ) : (
            <PieChart
              data={expensePie}
              format={(v) => formatMoney(v, currency)}
              centerLabel="Expenses"
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          title="Inventory Analytics"
          subtitle="Stock health, last 30 days"
          className="lg:col-span-1"
          action={
            <Link
              to="/admin/inventory"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Inventory
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <MiniStat
              label="Total Stock Items"
              value={String(stockValue.products)}
              icon={<Boxes size={15} className="text-indigo-600" />}
              tone="text-indigo-600"
            />
            <MiniStat
              label="Stock Value"
              value={formatMoney(stockValue.cost, currency)}
              icon={<Wallet size={15} className="text-blue-600" />}
              tone="text-blue-600"
            />
            <MiniStat
              label="Fast Moving"
              value={String(inventoryAnalytics.fast)}
              icon={<Flame size={15} className="text-orange-500" />}
              tone="text-orange-500"
            />
            <MiniStat
              label="Slow Moving"
              value={String(inventoryAnalytics.slow)}
              icon={<Timer size={15} className="text-slate-500" />}
              tone="text-slate-500"
            />
          </div>
        </Card>

        <Card
          title="Expiry Status"
          subtitle="Batches by remaining shelf life"
          className="lg:col-span-1"
          action={
            <Link
              to="/admin/batches"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Manage batches
            </Link>
          }
        >
          <BarChart
            data={expiryBuckets.map((b) => ({
              label: b.label,
              value: b.value,
              color: b.color,
            }))}
            format={(v) => `${v} batches`}
            height={210}
          />
        </Card>

        <Card title="Fast Movers" subtitle="Top selling medicines (units)">
          {inventoryAnalytics.fastBars.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No sales recorded yet.
            </p>
          ) : (
            <HorizontalBars
              data={inventoryAnalytics.fastBars.map((f) => ({
                label: f.name,
                value: f.units,
              }))}
              format={(v) => `${v} units`}
            />
          )}
        </Card>
      </div>

      <Card
        title="Recent Transactions"
        subtitle="Latest completed sales"
        action={
          <Link
            to="/admin/sales"
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            View all
          </Link>
        }
      >
        {recentSales.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            No sales yet. Open the Point of Sale to take your first sale.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentSales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono text-xs font-medium text-slate-800">
                      {s.invoiceNumber}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">
                      {formatDateTime(s.saleDate)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {userNames[s.cashierId] ?? s.cashierName ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {s.customerName || "Walk-in"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-900">
                      {formatMoney(s.total, currency)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone="blue">{PAYMENT_SHORT[s.paymentMethod]}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={s.status === "VOIDED" ? "red" : "green"}>
                        {s.status === "COMPLETED" ? "Paid" : "Voided"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewSale(s)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
                          title="View receipt"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => setViewSale(s)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
                          title="Print receipt"
                        >
                          <Printer size={16} />
                        </button>
                        <Link
                          to="/admin/sales"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-amber-600"
                          title="Returns"
                        >
                          <Undo2 size={16} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Low Stock"
          subtitle="Needs restocking"
          action={
            <Link
              to="/admin/inventory"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              View all
            </Link>
          }
        >
          {alertStats.lowList.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              All medicines are adequately stocked.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alertStats.lowList.slice(0, 6).map((m) => (
                <li
                  key={m.name}
                  className="flex items-center justify-between py-2.5"
                >
                  <span className="truncate text-sm font-medium text-slate-800">
                    {m.name}
                  </span>
                  <Badge tone="amber">{m.qty} left</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Expiring Soon"
          subtitle={`Within ${warningDays} days`}
          action={
            <Link
              to="/admin/batches"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              View all
            </Link>
          }
        >
          {alertStats.expiringList.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No batches expiring soon.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alertStats.expiringList.slice(0, 6).map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
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
      </div>

      <Card title="Daily Cash Position" subtitle="Financial reconciliation">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-2 text-sm lg:col-span-2">
            <div className="flex justify-between text-slate-700">
              <span>Opening cash</span>
              <span className="font-medium">
                {formatMoney(0, currency)}
              </span>
            </div>
            <div className="flex justify-between text-green-700">
              <span>Cash sales</span>
              <span className="font-medium">
                +{formatMoney(cashSalesToday, currency)}
              </span>
            </div>
            <div className="flex justify-between text-red-700">
              <span>Expenses</span>
              <span className="font-medium">
                -{formatMoney(expensesToday, currency)}
              </span>
            </div>
            <div className="flex justify-between text-red-700">
              <span>Refunds</span>
              <span className="font-medium">-{formatMoney(0, currency)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Expected cash</span>
              <span>{formatMoney(expectedCash, currency)}</span>
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-lg border border-slate-100 p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Actual cash counted</span>
                <span className="font-medium text-slate-400">—</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Difference</span>
                <Badge tone="slate">Not counted</Badge>
              </div>
            </div>
            <Link
              to="/admin/balancing"
              className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Scale size={16} />
              Open Book Balancing
            </Link>
          </div>
        </div>
      </Card>

      {viewSale && (
        <ReceiptModal
          sale={viewSale}
          settings={settings}
          onClose={() => setViewSale(null)}
        />
      )}
    </div>
  );
}
