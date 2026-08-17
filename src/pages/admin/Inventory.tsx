import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, ChevronDown, ChevronRight, PackagePlus } from "lucide-react";
import { Link } from "react-router-dom";
import { pharmaDb } from "../../db";
import type { MedicineBatch } from "../../types";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatMoney } from "../../lib/utils";
import {
  todayISO,
  daysUntil,
  formatISO,
  batchDisplayStatus,
} from "../../lib/stock";

interface StockRow {
  medicineId: string;
  name: string;
  strength?: string;
  categoryId: string;
  totalQuantity: number;
  outOfStock: boolean;
  lowStock: boolean;
  valueAtCost: number;
  valueAtSale: number;
  earliestExpiry?: string;
  expiredCount: number;
}

export function InventoryPage() {
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const categories = useLiveQuery(() => pharmaDb.medicineCategories.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const warningDays = Number(
    settings.find((s) => s.settingKey === "expiry_warning_days")?.settingValue ?? "60",
  );
  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const today = todayISO();
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const rows: StockRow[] = medicines.map((m) => {
    const medicineBatches = batches.filter((b) => b.medicineId === m.id);
    const active = medicineBatches.filter(
      (b) => b.quantityRemaining > 0 && b.expiryDate >= today,
    );
    const totalQuantity = active.reduce((s, b) => s + b.quantityRemaining, 0);
    const expiredCount = medicineBatches.filter(
      (b) => b.quantityRemaining > 0 && b.expiryDate < today,
    ).length;
    const earliest = active
      .map((b) => b.expiryDate)
      .sort()
      .shift();

    return {
      medicineId: m.id,
      name: m.name,
      strength: m.strength,
      categoryId: m.categoryId,
      totalQuantity,
      outOfStock: totalQuantity === 0 && medicineBatches.length > 0,
      lowStock: m.reorderLevel > 0 && totalQuantity > 0 && totalQuantity <= m.reorderLevel,
      valueAtCost: active.reduce((s, b) => s + b.quantityRemaining * b.purchasePrice, 0),
      valueAtSale: active.reduce((s, b) => s + b.quantityRemaining * b.sellingPrice, 0),
      earliestExpiry: earliest,
      expiredCount,
    };
  });

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      r.name.toLowerCase().includes(q) ||
      (r.strength ?? "").toLowerCase().includes(q);
    const matchesCategory = !categoryFilter || r.categoryId === categoryFilter;
    const matchesStatus =
      statusFilter === "ALL" ||
      (statusFilter === "OUT" && r.outOfStock) ||
      (statusFilter === "LOW" && r.lowStock) ||
      (statusFilter === "EXPIRED" && r.expiredCount > 0);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const totalCost = rows.reduce((s, r) => s + r.valueAtCost, 0);
  const totalSale = rows.reduce((s, r) => s + r.valueAtSale, 0);
  const lowStockCount = rows.filter((r) => r.lowStock || r.outOfStock).length;
  const expiredMedicines = rows.filter((r) => r.expiredCount > 0).length;

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Current stock position across all medicines"
        actions={
          <Link to="/admin/batches">
            <Button>
              <PackagePlus size={16} />
              Receive Stock
            </Button>
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Stock Value (Cost)</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {formatMoney(totalCost, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Stock Value (Sale)</p>
          <p className="mt-1 text-xl font-bold text-pharma-700">
            {formatMoney(totalSale, currency)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Low / Out of Stock</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{lowStockCount}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">With Expired Stock</p>
          <p className="mt-1 text-xl font-bold text-red-600">{expiredMedicines}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
              placeholder="Search medicines..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All status</option>
            <option value="LOW">Low stock</option>
            <option value="OUT">Out of stock</option>
            <option value="EXPIRED">Has expired stock</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            {medicines.length === 0
              ? "Register medicines first, then receive stock to build your inventory."
              : "No medicines match your filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium"></th>
                  <th className="px-3 py-2 font-medium">Medicine</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Total Qty</th>
                  <th className="px-3 py-2 font-medium">Value (Cost)</th>
                  <th className="px-3 py-2 font-medium">Earliest Expiry</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => {
                  const isOpen = expanded.has(r.medicineId);
                  const medicineBatches = batches
                    .filter((b) => b.medicineId === r.medicineId)
                    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
                  return (
                    <FragmentRow
                      key={r.medicineId}
                      row={r}
                      isOpen={isOpen}
                      categoryName={categoryMap.get(r.categoryId) ?? "—"}
                      currency={currency}
                      warningDays={warningDays}
                      batches={medicineBatches}
                      onToggle={() => toggleExpand(r.medicineId)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FragmentRow({
  row,
  isOpen,
  categoryName,
  currency,
  warningDays,
  batches,
  onToggle,
}: {
  row: StockRow;
  isOpen: boolean;
  categoryName: string;
  currency: string;
  warningDays: number;
  batches: MedicineBatch[];
  onToggle: () => void;
}) {
  const today = todayISO();

  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="px-3 py-3">
          {isOpen ? (
            <ChevronDown size={16} className="text-slate-400" />
          ) : (
            <ChevronRight size={16} className="text-slate-400" />
          )}
        </td>
        <td className="px-3 py-3">
          <p className="font-medium text-slate-900">{row.name}</p>
          {row.strength && (
            <p className="text-xs text-slate-500">{row.strength}</p>
          )}
        </td>
        <td className="px-3 py-3">
          <Badge>{categoryName}</Badge>
        </td>
        <td className="px-3 py-3">
          <span
            className={`font-semibold ${
              row.outOfStock
                ? "text-red-600"
                : row.lowStock
                  ? "text-amber-600"
                  : "text-slate-900"
            }`}
          >
            {row.totalQuantity}
          </span>
        </td>
        <td className="px-3 py-3 text-slate-600">
          {formatMoney(row.valueAtCost, currency)}
        </td>
        <td className="px-3 py-3 text-slate-600">
          {row.earliestExpiry
            ? formatISO(row.earliestExpiry)
            : batches.length === 0
              ? "—"
              : "All expired"}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            {row.expiredCount > 0 && <Badge tone="red">Expired</Badge>}
            {row.lowStock && <Badge tone="amber">Low</Badge>}
            {row.outOfStock && <Badge tone="red">Out</Badge>}
            {!row.expiredCount && !row.lowStock && !row.outOfStock && (
              <Badge tone="green">In Stock</Badge>
            )}
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7} className="bg-slate-50/60 px-4 py-3">
            {batches.length === 0 ? (
              <p className="py-2 text-center text-xs text-slate-400">
                No batches received yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 uppercase">
                      <th className="px-2 py-1 font-medium">Batch</th>
                      <th className="px-2 py-1 font-medium">Expiry</th>
                      <th className="px-2 py-1 font-medium">Remaining</th>
                      <th className="px-2 py-1 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((b) => {
                      const status = batchDisplayStatus(
                        b,
                        warningDays,
                      );
                      return (
                        <tr key={b.id}>
                          <td className="px-2 py-1.5 font-mono text-slate-700">
                            {b.batchNumber}
                          </td>
                          <td className="px-2 py-1.5">
                            <span
                              className={
                                b.expiryDate < today ? "text-red-600" : ""
                              }
                            >
                              {formatISO(b.expiryDate)}
                            </span>
                            {b.expiryDate >= today && (
                              <span className="text-slate-400">
                                {" "}
                                ({Math.max(0, daysUntil(b.expiryDate))}d)
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-medium text-slate-800">
                            {b.quantityRemaining}
                            <span className="text-slate-400">/{b.quantityReceived}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            {status === "EXPIRED" ? (
                              <Badge tone="red">Expired</Badge>
                            ) : status === "EXPIRING" ? (
                              <Badge tone="amber">Expiring</Badge>
                            ) : status === "DEPLETED" ? (
                              <Badge>Depleted</Badge>
                            ) : (
                              <Badge tone="green">In Stock</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
