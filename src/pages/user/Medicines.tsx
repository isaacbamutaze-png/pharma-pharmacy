import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search } from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatMoney } from "../../lib/utils";
import { todayISO } from "../../lib/stock";

export function UserMedicinesPage() {
  const medicines = useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const categories = useLiveQuery(() => pharmaDb.medicineCategories.toArray(), []) ?? [];
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const today = todayISO();

  const stockByMedicine = new Map<string, number>();
  for (const b of batches) {
    if (b.quantityRemaining > 0 && b.expiryDate >= today) {
      stockByMedicine.set(
        b.medicineId,
        (stockByMedicine.get(b.medicineId) ?? 0) + b.quantityRemaining,
      );
    }
  }

  const filtered = medicines.filter((m) => {
    if (m.status !== "ACTIVE") return false;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      String(m.name ?? "").toLowerCase().includes(q) ||
      String(m.genericName ?? "").toLowerCase().includes(q) ||
      String(m.strength ?? "").toLowerCase().includes(q);
    const matchesCategory = !categoryFilter || m.categoryId === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div>
      <PageHeader
        title="Medicines"
        subtitle="Stock availability lookup (view only)"
      />

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
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
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No medicines found.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{m.name}</p>
                    <p className="text-xs text-slate-500">
                      {m.genericName || "—"}
                      {m.strength ? ` • ${m.strength}` : ""}
                    </p>
                  </div>
                  <Badge>{categoryMap.get(m.categoryId)?.name ?? "—"}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-pharma-700">
                    {formatMoney(m.sellingPrice)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {m.prescriptionRequired ? "Rx required" : "OTC"}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                  <span className="text-xs text-slate-500">Available</span>
                  <Badge
                    tone={
                      (stockByMedicine.get(m.id) ?? 0) === 0
                        ? "red"
                        : (stockByMedicine.get(m.id) ?? 0) <= m.reorderLevel
                          ? "amber"
                          : "green"
                    }
                  >
                    {stockByMedicine.get(m.id) ?? 0} units
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
